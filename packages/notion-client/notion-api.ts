// import { promises as fs } from 'fs'
import * as notion from 'notion-types';
import { parsePageId, getPageContentBlockIds, uuidToId, getBlockCollectionId } from 'notion-utils';
import pMap from 'p-map';

import * as types from './types';
import { NotionRequestScheduler, parseRetryAfter } from './request-scheduler';

// pageId는 병렬 조회의 진단 로그에만 사용하며 HTTP 요청에는 포함하지 않는다.
export interface FetchOptions {
  headers?: Record<string, string>;
  pageId?: string;
}

/**
 * Main Notion API client.
 */
export class NotionAPI {
  private readonly _apiBaseUrl: string;
  private readonly _authToken?: string;
  private readonly _activeUser?: string;
  private readonly _userTimeZone: string;
  private readonly _requestScheduler?: NotionRequestScheduler;
  private readonly _requestTimeoutMs: number;

  constructor({
    apiBaseUrl = 'https://www.notion.so/api/v3',
    authToken,
    activeUser,
    userTimeZone = 'America/New_York',
    requestIntervalMs = 0,
    requestIntervalMsByEndpoint = {},
    requestTimeoutMs = 0,
  }: {
    apiBaseUrl?: string;
    authToken?: string;
    userLocale?: string;
    userTimeZone?: string;
    activeUser?: string;
    requestIntervalMs?: number;
    requestIntervalMsByEndpoint?: Readonly<Record<string, number>>;
    requestTimeoutMs?: number;
  } = {}) {
    this._apiBaseUrl = apiBaseUrl;
    this._authToken = authToken;
    this._activeUser = activeUser;
    this._userTimeZone = userTimeZone;
    this._requestTimeoutMs = requestTimeoutMs;
    const intervalMs =
      Number.isFinite(requestIntervalMs) && requestIntervalMs > 0 ? requestIntervalMs : 0;
    const intervalMsByEndpoint = Object.fromEntries(
      Object.entries(requestIntervalMsByEndpoint).filter(([, ms]) => Number.isFinite(ms) && ms > 0),
    );
    if (intervalMs || Object.keys(intervalMsByEndpoint).length) {
      this._requestScheduler = new NotionRequestScheduler(
        intervalMs,
        undefined,
        intervalMsByEndpoint,
      );
    }
  }

  public async getPage(
    pageId: string,
    {
      concurrency = 3,
      fetchMissingBlocks = true,
      fetchCollections = true,
      signFileUrls = true,
      chunkLimit = 100,
      chunkNumber = 0,
      gotOptions,
      draftView = false,
    }: {
      concurrency?: number;
      fetchMissingBlocks?: boolean;
      fetchCollections?: boolean;
      signFileUrls?: boolean;
      chunkLimit?: number;
      chunkNumber?: number;
      gotOptions?: FetchOptions;
      draftView?: boolean;
    } = {},
  ): Promise<notion.ExtendedRecordMap> {
    gotOptions = { ...gotOptions, pageId: parsePageId(pageId) || undefined };
    const page = await this.getPageRaw(pageId, {
      chunkLimit,
      chunkNumber,
      gotOptions,
    });

    const recordMap = page?.recordMap as notion.ExtendedRecordMap;

    if (!recordMap?.block) {
      throw new Error(`Notion page not found "${uuidToId(pageId)}"`);
    }

    // CUSTOM: 작성자 유저 정보 가져오도록 처리
    const pageBlockId = Object.keys(recordMap.block)[0];
    const pageBlock = recordMap.block[pageBlockId].value;
    // 비로그인 공개 조회에서는 created_by_id가 내려오지 않을 수 있으므로 있을 때만 조회
    const authorId = pageBlock.created_by_id;

    if (authorId) {
      try {
        const users = await this.getUsers([authorId], gotOptions);
        const author = users.results[0];

        recordMap.notion_user = {
          [authorId]: author,
        };
      } catch (err) {
        console.warn('NotionAPI getUsers error', pageId, err.message);
      }
    }

    // ensure that all top-level maps exist
    recordMap.collection = recordMap.collection ?? {};
    recordMap.collection_view = recordMap.collection_view ?? {};
    recordMap.notion_user = recordMap.notion_user ?? {};

    // additional mappings added for convenience
    // note: these are not native notion objects
    recordMap.collection_query = {};
    recordMap.signed_urls = {};

    if (fetchMissingBlocks) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // fetch any missing content blocks
        const pendingBlockIds = getPageContentBlockIds(recordMap).filter(
          id => !recordMap.block[id],
        );

        if (!pendingBlockIds.length) {
          break;
        }

        const newBlocks = await this.getBlocks(pendingBlockIds, gotOptions).then(
          res => res.recordMap.block,
        );

        recordMap.block = { ...recordMap.block, ...newBlocks };
      }
    }

    const contentBlockIds = getPageContentBlockIds(recordMap);

    // Optionally fetch all data for embedded collections and their associated views.
    // NOTE: We're eagerly fetching *all* data for each collection and all of its views.
    // This is really convenient in order to ensure that all data needed for a given
    // Notion page is readily available for use cases involving server-side rendering
    // and edge caching.
    if (fetchCollections) {
      const allCollectionInstances: Array<{
        collectionId: string;
        collectionViewId: string;
      }> = contentBlockIds.flatMap(blockId => {
        const block = recordMap.block[blockId].value;
        const collectionId =
          block &&
          (block.type === 'collection_view' || block.type === 'collection_view_page') &&
          getBlockCollectionId(block, recordMap);

        if (collectionId) {
          return block.view_ids?.map(collectionViewId => ({
            collectionId,
            collectionViewId,
          }));
        } else {
          return [];
        }
      });

      // fetch data for all collection view instances
      await pMap(
        allCollectionInstances,
        async collectionInstance => {
          const { collectionId, collectionViewId } = collectionInstance;
          const collectionView = recordMap.collection_view[collectionViewId]?.value;

          try {
            const collectionData = await this.getCollectionData(
              collectionId,
              collectionViewId,
              collectionView,
              {
                gotOptions,
                draftView,
              },
            );

            // await fs.writeFile(
            //   `${collectionId}-${collectionViewId}.json`,
            //   JSON.stringify(collectionData.result, null, 2)
            // )

            recordMap.block = {
              ...recordMap.block,
              ...collectionData.recordMap.block,
            };

            recordMap.collection = {
              ...recordMap.collection,
              ...collectionData.recordMap.collection,
            };

            recordMap.collection_view = {
              ...recordMap.collection_view,
              ...collectionData.recordMap.collection_view,
            };

            recordMap.notion_user = {
              ...recordMap.notion_user,
              ...collectionData.recordMap.notion_user,
            };

            recordMap.collection_query![collectionId] = {
              ...recordMap.collection_query![collectionId],
              [collectionViewId]: (collectionData.result as any)?.reducerResults,
            };
          } catch (err) {
            // It's possible for public pages to link to private collections, in which case
            // Notion returns a 400 error
            console.warn('NotionAPI collectionQuery error', pageId, err.message);
            console.error(err);
          }
        },
        {
          concurrency,
        },
      );
    }

    // Optionally fetch signed URLs for any embedded files.
    // NOTE: Similar to collection data, we default to eagerly fetching signed URL info
    // because it is preferable for many use cases as opposed to making these API calls
    // lazily from the client-side.
    if (signFileUrls) {
      await this.addSignedUrls({ recordMap, contentBlockIds, gotOptions });
    }

    return recordMap;
  }

  public async addSignedUrls({
    recordMap,
    contentBlockIds,
    gotOptions = {},
  }: {
    recordMap: notion.ExtendedRecordMap;
    contentBlockIds?: string[];
    gotOptions?: FetchOptions;
  }) {
    recordMap.signed_urls = {};

    if (!contentBlockIds) {
      contentBlockIds = getPageContentBlockIds(recordMap);
    }

    const allFileInstances = contentBlockIds.flatMap(blockId => {
      const block = recordMap.block[blockId].value;

      if (
        block &&
        (block.type === 'pdf' ||
          block.type === 'audio' ||
          (block.type === 'image' && block.file_ids?.length) ||
          block.type === 'video' ||
          block.type === 'file' ||
          block.type === 'page')
      ) {
        const source =
          block.type === 'page' ? block.format?.page_cover : block.properties?.source?.[0]?.[0];

        if (source) {
          if (
            source.indexOf('youtube') >= 0 ||
            source.indexOf('vimeo') >= 0 ||
            source.includes('splash') ||
            // Notion 기본 커버는 공개 정적 이미지이므로 파일 서명 대상이 아니다.
            (block.type === 'page' && isDefaultPageCover(source))
          ) {
            return [];
          }

          return {
            permissionRecord: {
              table: 'block',
              id: block.id,
            },
            url: source,
          };
        }
      }

      return [];
    });

    if (allFileInstances.length > 0) {
      try {
        const { signedUrls } = await this.getSignedFileUrls(allFileInstances, gotOptions);

        if (signedUrls.length === allFileInstances.length) {
          for (let i = 0; i < allFileInstances.length; ++i) {
            const file = allFileInstances[i];
            const signedUrl = signedUrls[i];

            recordMap.signed_urls[file.permissionRecord.id] = signedUrl;
          }
        }
      } catch (err) {
        console.warn('NotionAPI getSignedfileUrls error', err);
      }
    }
  }

  public async getPageRaw(
    pageId: string,
    {
      gotOptions,
      chunkLimit = 100,
      chunkNumber = 0,
    }: {
      chunkLimit?: number;
      chunkNumber?: number;
      gotOptions?: FetchOptions;
    } = {},
  ) {
    const parsedPageId = parsePageId(pageId);

    if (!parsedPageId) {
      throw new Error(`invalid notion pageId "${pageId}"`);
    }

    const body = {
      pageId: parsedPageId,
      limit: chunkLimit,
      chunkNumber: chunkNumber,
      cursor: { stack: [] },
      verticalColumns: false,
    };

    return this.fetch<notion.PageChunk>({
      endpoint: 'loadPageChunk',
      body,
      gotOptions,
    });
  }

  public async getCollectionData(
    collectionId: string,
    collectionViewId: string,
    collectionView: any,
    {
      limit = 9999,
      searchQuery = '',
      userTimeZone = this._userTimeZone,
      loadContentCover = true,
      draftView = false,
      gotOptions,
    }: {
      type?: notion.CollectionViewType;
      limit?: number;
      searchQuery?: string;
      userTimeZone?: string;
      userLocale?: string;
      loadContentCover?: boolean;
      draftView?: boolean;
      gotOptions?: FetchOptions;
    } = {},
  ) {
    const type = collectionView?.type;
    const isBoardType = type === 'board';
    const groupBy =
      collectionView?.format?.board_columns_by || collectionView?.format?.collection_group_by;

    let loader: any = {
      type: 'reducer',
      reducers: {
        collection_group_results: {
          type: 'results',
          limit,
          loadContentCover,
        },
      },
      sort: [],
      ...collectionView?.query2,
      searchQuery,
      userTimeZone,
    };

    // CUSTOM: 필터 작동하도록 처리
    if (collectionView?.format?.property_filters?.length) {
      loader.filter = {
        operator: 'and',
        filters: collectionView.format.property_filters
          .map(filter => filter.filter)
          .filter(draftView ? filter => filter.filter.operator !== 'status_is' : () => true),
      };
    }

    if (groupBy) {
      const groups =
        collectionView?.format?.board_columns || collectionView?.format?.collection_groups || [];
      const iterators = [isBoardType ? 'board' : 'group_aggregation', 'results'];
      const operators = {
        checkbox: 'checkbox_is',
        url: 'string_starts_with',
        text: 'string_starts_with',
        select: 'enum_is',
        multi_select: 'enum_contains',
        created_time: 'date_is_within',
        ['undefined']: 'is_empty',
      };

      const reducersQuery = {};
      for (const group of groups) {
        const {
          property,
          value: { value, type },
        } = group;

        for (const iterator of iterators) {
          const iteratorProps =
            iterator === 'results'
              ? {
                  type: iterator,
                  limit,
                }
              : {
                  type: 'aggregation',
                  aggregation: {
                    aggregator: 'count',
                  },
                };

          const isUncategorizedValue = typeof value === 'undefined';
          const isDateValue = value?.range;
          // TODO: review dates reducers
          const queryLabel = isUncategorizedValue
            ? 'uncategorized'
            : isDateValue
            ? value.range?.start_date || value.range?.end_date
            : value?.value || value;

          const queryValue = !isUncategorizedValue && (isDateValue || value?.value || value);

          reducersQuery[`${iterator}:${type}:${queryLabel}`] = {
            ...iteratorProps,
            filter: {
              operator: 'and',
              filters: [
                {
                  property,
                  filter: {
                    operator: !isUncategorizedValue ? operators[type] : 'is_empty',
                    ...(!isUncategorizedValue && {
                      value: {
                        type: 'exact',
                        value: queryValue,
                      },
                    }),
                  },
                },
              ],
            },
          };
        }
      }

      const reducerLabel = isBoardType ? 'board_columns' : `${type}_groups`;
      loader = {
        type: 'reducer',
        reducers: {
          [reducerLabel]: {
            type: 'groups',
            groupBy,
            ...(collectionView?.query2?.filter && {
              filter: collectionView?.query2?.filter,
            }),
            groupSortPreference: groups.map(group => group?.value),
            limit,
          },
          ...reducersQuery,
        },
        ...collectionView?.query2,
        searchQuery,
        userTimeZone,
        //TODO: add filters here
        // filter: {
        //   filters: filters,
        //   operator: 'and'
        // }
      };
    }

    return this.fetch<notion.CollectionInstance>({
      endpoint: 'queryCollection',
      body: {
        collection: {
          id: collectionId,
        },
        collectionView: {
          id: collectionViewId,
        },
        loader,
      },
      gotOptions,
    });
  }

  public async getUsers(userIds: string[], gotOptions?: FetchOptions) {
    // CUSTOM: 타입 수정
    return this.fetch<
      notion.RecordValues<{
        role: notion.Role;
        value: notion.User;
      }>
    >({
      endpoint: 'getRecordValues',
      body: {
        requests: userIds.map(id => ({ id, table: 'notion_user' })),
      },
      gotOptions,
    });
  }

  public async getBlocks(blockIds: string[], gotOptions?: FetchOptions) {
    return this.fetch<notion.PageChunk>({
      endpoint: 'syncRecordValues',
      body: {
        requests: blockIds.map(blockId => ({
          // TODO: when to use table 'space' vs 'block'?
          table: 'block',
          id: blockId,
          version: -1,
        })),
      },
      gotOptions,
    });
  }

  public async getSignedFileUrls(urls: types.SignedUrlRequest[], gotOptions?: FetchOptions) {
    return this.fetch<types.SignedUrlResponse>({
      endpoint: 'getSignedFileUrls',
      body: {
        urls,
      },
      gotOptions,
    });
  }

  public async search(params: notion.SearchParams, gotOptions?: FetchOptions) {
    const body = {
      type: 'BlocksInAncestor',
      query: params.query,
      ancestorId: parsePageId(params.ancestorId),
      filters: {
        isDeletedOnly: false,
        excludeTemplates: false,
        navigableBlockContentOnly: false,
        requireEditPermissions: false,
        includePublicPagesWithoutExplicitAccess: true,
        ancestors: [],
        createdBy: [],
        editedBy: [],
        lastEditedTime: {},
        createdTime: {},
        inTeams: [],
        ...params.filters,
      },
      sort: {
        field: 'relevance',
      },
      limit: params.limit || 20,
      source: 'quick_find_input_change',
      searchExperimentOverrides: {},
      searchSessionId: params.searchSessionId,
      searchSessionFlowNumber: 1,
      excludedBlockIds: [],
    };

    return this.fetch<notion.SearchResults>({
      endpoint: 'search',
      body,
      gotOptions,
    });
  }

  public async fetch<T>({
    endpoint,
    body,
    gotOptions,
    headers: clientHeaders,
  }: {
    endpoint: string;
    body: object;
    gotOptions?: FetchOptions;
    headers?: any;
  }): Promise<T> {
    // Notion이 got 기본 User-Agent를 403으로 차단하므로 식별 가능한 UA를 기본값으로 사용
    const headers: any = {
      'user-agent': 'itpe-blog/1.0 (+https://itpe.me)',
      ...clientHeaders,
      ...gotOptions?.headers,
      'Content-Type': 'application/json',
    };

    if (this._authToken) {
      headers.cookie = `token_v2=${this._authToken}`;
    }

    if (this._activeUser) {
      headers['x-notion-active-user-header'] = this._activeUser;
    }

    const url = `${this._apiBaseUrl}/${endpoint}`;

    // got 대신 fetch를 쓴다 (Cloudflare Workers 등 Node 전용 모듈이 없는 런타임에서도 동작).
    // 네트워크 오류, 429, 5xx는 재시도한다 (429는 Retry-After 헤더를 따르고, 빌드 중 동시 요청이 많아 여유 있게 시도).
    const maxRetries = 5;
    const startedAt = Date.now();
    const requestBody = body as {
      pageId?: string;
      collection?: { id?: string };
      collectionView?: { id?: string };
    };
    let retryAfterMs = 0;
    let response: T | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const queuedAt = Date.now();
      await this._requestScheduler?.waitForTurn(endpoint);
      const attemptStartedAt = Date.now();
      let statusCode: number | undefined;
      let retryable = true;
      let error: any;
      const controller = this._requestTimeoutMs > 0 ? new AbortController() : undefined;
      const timer = controller
        ? setTimeout(() => controller.abort(), this._requestTimeoutMs)
        : undefined;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller?.signal,
        });
        statusCode = res.status;

        if (res.ok) {
          response = (await res.json()) as T;
          break;
        }

        retryable = res.status === 429 || res.status >= 500;
        retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
        error = new Error(`Response code ${res.status} (${res.statusText})`);
        error.response = { statusCode: res.status };
      } catch (err) {
        error = err;
        retryable = !err?.response;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }

      // 지정된 대기 시간을 15초로 자르지 않고 서버가 요청한 시간을 지킨다.
      const backoffMs = Math.min(1000 * 2 ** attempt, 15000);
      const delay = Math.max(
        retryAfterMs,
        backoffMs,
        statusCode === 429 && this._requestScheduler && !retryAfterMs ? 15000 : 0,
      );
      // 마지막 시도가 실패해도 공통 대기는 유지해 다른 페이지의 요청 폭주를 막는다.
      const sharedCooldownMs =
        statusCode === 429 ? this._requestScheduler?.pause(delay) : undefined;
      const retrying = retryable && attempt < maxRetries;
      const details = {
        endpoint,
        pageId: gotOptions?.pageId || requestBody.pageId,
        collectionId: requestBody.collection?.id,
        collectionViewId: requestBody.collectionView?.id,
        statusCode,
        attempt: attempt + 1,
        maxAttempts: maxRetries + 1,
        durationMs: Date.now() - attemptStartedAt,
        queueWaitMs: attemptStartedAt - queuedAt,
        elapsedMs: Date.now() - startedAt,
        reason:
          statusCode === 429
            ? 'rate_limit'
            : statusCode >= 500
            ? 'server_error'
            : statusCode >= 400
            ? 'http_error'
            : statusCode
            ? 'response_error'
            : 'network_error',
        errorName: error?.name,
        errorCode: error?.cause?.code || error?.code,
        retrying,
        retryAfterMs,
        sharedCooldownMs,
        retryDelayMs: retrying ? delay : 0,
      };

      // 본문·헤더·파일 URL은 기록하지 않는다. 최종 오류의 정보는 페이지 재시도 로그에도 전달한다.
      console.warn('[notion-api] request failed', JSON.stringify(details));
      if (error instanceof Error) error['notionRequest'] = details;
      if (!retrying) throw error;

      retryAfterMs = 0;
      // 429는 다음 차례에서 공통 대기열을 통과하므로 개별 타이머를 중복해서 걸지 않는다.
      if (sharedCooldownMs === undefined) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return normalizeRecordMapValues(response);
  }
}

function isDefaultPageCover(source: string): boolean {
  if (source.startsWith('/images/page-cover/')) return true;

  try {
    const url = new URL(source);
    return (
      ['www.notion.so', 'notion.so', 'www.notion.com', 'notion.com', 'app.notion.com'].includes(
        url.hostname,
      ) && url.pathname.startsWith('/images/page-cover/')
    );
  } catch {
    return false;
  }
}

/**
 * Notion 비공식 API가 recordMap의 각 항목을 `{ value: { value, role } }` 형태로 한 번 더
 * 감싸서 내려주는 변경에 대응한다. 기존 코드가 기대하는 `{ role, value }`로 풀어준다.
 */
function normalizeRecordMapValues<T>(response: T): T {
  const recordMap = (response as any)?.recordMap;

  if (!recordMap || typeof recordMap !== 'object') {
    return response;
  }

  for (const mapName of Object.keys(recordMap)) {
    const map = recordMap[mapName];

    if (!map || typeof map !== 'object') continue;

    for (const key of Object.keys(map)) {
      const entry = map[key];
      const inner = entry?.value;

      if (inner && typeof inner === 'object' && 'value' in inner && 'role' in inner) {
        map[key] = { role: inner.role, value: inner.value };
      }
    }
  }

  return response;
}
