import { NotionAPI } from 'notion-client';
import {
  getAllPagesInSpace,
  getPageContentBlockIds,
  getBlockCollectionId,
  parsePageId,
} from 'notion-utils';
import pMap from 'p-map';
import type { ContentEnv, ContentPointer, PublishedIndex, RefreshStatus } from './content-types';
import { contentStorePrefix, RESERVED_CONTENT_PATHS, revisionKey } from './content-paths';
import { getCanonicalPageId } from './get-canonical-page-id';
import { createFeedDocuments } from './generate-static-feeds';
import { isHiddenPost, showDrafts } from './post-status';
import { prepareNotionPage } from './prepare-notion-page';
import { mergeRecordMapsPreferFirst, navigationLinkPageIds } from './notion';
import * as config from './config';

interface JobState {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    setAlarm(time: number): Promise<void>;
  };
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

const isActive = (status?: RefreshStatus) =>
  status && !['complete', 'failed'].includes(status.state);
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Durable Object의 alarm으로 실행해 브라우저를 닫아도 게시 작업이 계속된다.
export class BlogRefreshJob {
  constructor(private readonly ctx: JobState, private readonly env: ContentEnv) {}

  async fetch(request: Request): Promise<Response> {
    let status = await this.ctx.storage.get<RefreshStatus>('job');
    if (
      isActive(status) &&
      Date.now() - Math.min(Date.parse(status.startedAt), Date.parse(status.updatedAt)) >
        15 * 60 * 1000
    ) {
      status = {
        ...status,
        state: 'failed',
        error: '갱신 시간이 초과되었습니다. 다시 시도해 주세요.',
      };
      await this.ctx.storage.put('job', status);
    }
    if (request.method === 'GET') return json(status || null);
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    return this.ctx.blockConcurrencyWhile(async () => {
      const existing = await this.ctx.storage.get<RefreshStatus>('job');
      if (isActive(existing)) return json(existing, 202);
      const now = new Date().toISOString();
      const job: RefreshStatus = {
        id: crypto.randomUUID(),
        state: 'queued',
        startedAt: now,
        updatedAt: now,
        completed: 0,
      };
      await this.ctx.storage.put('job', job);
      await this.ctx.storage.setAlarm(Date.now() + 100);
      return json(job, 202);
    });
  }

  async alarm(): Promise<void> {
    const job = await this.ctx.storage.get<RefreshStatus>('job');
    if (!isActive(job)) return;
    const prefix = contentStorePrefix(config.rootNotionPageId, this.env.BLOG_CONTENT_PREFIX);
    const bucket = this.env.NEXT_INC_CACHE_R2_BUCKET;
    const update = async (changes: Partial<RefreshStatus>) => {
      const latest = await this.ctx.storage.get<RefreshStatus>('job');
      if (latest?.id !== job.id || latest.state === 'failed') throw new Error('Refresh superseded');
      Object.assign(job, changes, { updatedAt: new Date().toISOString() });
      await this.ctx.storage.put('job', job);
    };
    try {
      if (showDrafts) throw new Error('Draft preview mode cannot publish content');
      await update({ state: 'collecting', completed: 0 });
      const api = new NotionAPI({
        requestIntervalMs: 150,
        requestIntervalMsByEndpoint: { loadPageChunk: 1300 },
        requestTimeoutMs: 20000,
      });
      const loaded = new Set<string>();
      const pageMap = await getAllPagesInSpace(
        config.rootNotionPageId,
        config.rootNotionSpaceId,
        async id => {
          const page = await api.getPage(id);
          // Notion 클라이언트는 컬렉션 실패를 경고만 남기고 반환한다. 이를 빈 목록으로 게시하지 않는다.
          for (const blockId of getPageContentBlockIds(page)) {
            const block = page.block[blockId]?.value;
            if (block?.type !== 'collection_view' && block?.type !== 'collection_view_page')
              continue;
            const collectionId = getBlockCollectionId(block, page);
            const viewId = block.view_ids?.[0];
            if (
              collectionId &&
              viewId &&
              !Array.isArray(
                page.collection_query?.[collectionId]?.[viewId]?.collection_group_results?.blockIds,
              )
            ) {
              throw new Error('Notion collection response is incomplete');
            }
          }
          loaded.add(id);
          if (loaded.size % 5 === 0) await update({ completed: loaded.size });
          return page;
        },
      );
      const canonicalPageMap: Record<string, string> = {};
      const hiddenPageIds: string[] = [];
      for (const [id, page] of Object.entries(pageMap)) {
        if (!page?.block?.[id]?.value) throw new Error('Incomplete Notion response');
        if (isHiddenPost(page.block[id].value, page)) {
          hiddenPageIds.push(id);
          continue;
        }
        const slug = getCanonicalPageId(id, page, { uuid: !!config.includeNotionIdInUrls });
        if (slug && !RESERVED_CONTENT_PATHS.has(slug) && !canonicalPageMap[slug])
          canonicalPageMap[slug] = id;
      }
      const rootId = parsePageId(config.rootNotionPageId);
      if (!Object.values(canonicalPageMap).includes(rootId))
        throw new Error('Home page is missing');
      const publishedMap = Object.fromEntries(
        Object.values(canonicalPageMap).map(id => [id, pageMap[id]]),
      );
      const documents = createFeedDocuments({ canonicalPageMap, pageMap: publishedMap });
      const navigation = await pMap(
        navigationLinkPageIds,
        id =>
          api.getPage(id, {
            chunkLimit: 1,
            fetchMissingBlocks: false,
            fetchCollections: false,
            signFileUrls: false,
          }),
        { concurrency: 2 },
      );
      const ids = [...new Set(Object.values(canonicalPageMap))];
      await update({ state: 'saving', completed: 0, total: ids.length });
      let saved = 0;
      await pMap(
        ids,
        async id => {
          const raw = JSON.parse(JSON.stringify(pageMap[id]));
          const recordMap = navigation.reduce(
            (map, extra) => mergeRecordMapsPreferFirst(map, extra),
            raw,
          );
          const props = await prepareNotionPage(id, recordMap);
          if (props.error) throw new Error('Page could not be published');
          await bucket.put(
            revisionKey(prefix, job.id, `pages/${id.replace(/-/g, '')}.json`),
            JSON.stringify(props),
          );
          saved++;
          if (saved % 5 === 0 || saved === ids.length) await update({ completed: saved });
        },
        { concurrency: 2 },
      );
      const index: PublishedIndex = {
        schema: 1,
        rootPageId: config.rootNotionPageId,
        updatedAt: new Date().toISOString(),
        canonicalPageMap,
        hiddenPageIds,
      };
      await bucket.put(revisionKey(prefix, job.id, 'index.json'), JSON.stringify(index));
      await bucket.put(revisionKey(prefix, job.id, 'sitemap.xml'), documents.sitemap);
      await bucket.put(revisionKey(prefix, job.id, 'feed.xml'), documents.feed);
      await update({ completed: saved });
      const pointer: ContentPointer = {
        revision: job.id,
        updatedAt: index.updatedAt,
        pageCount: ids.length,
        postCount: documents.postCount,
      };
      // 공개 포인터는 모든 파일을 저장한 뒤 한 번만 교체한다. 실패 시 기존 게시 버전이 유지된다.
      await bucket.put(`${prefix}/current.json`, JSON.stringify(pointer));
      await update({ state: 'complete', published: pointer });
    } catch (error) {
      console.error('[blog-refresh] failed', job.id, error?.message);
      const latest = await this.ctx.storage.get<RefreshStatus>('job');
      if (latest?.id === job.id) {
        const current = await bucket.get(`${prefix}/current.json`);
        const published = current ? await current.json<ContentPointer>() : null;
        if (published?.revision === job.id) {
          await this.ctx.storage.put('job', {
            ...job,
            state: 'complete',
            published,
            updatedAt: new Date().toISOString(),
          });
          return;
        }
        await this.ctx.storage.put('job', {
          ...job,
          state: 'failed',
          updatedAt: new Date().toISOString(),
          error:
            '갱신을 완료하지 못했습니다. 기존 게시 내용은 유지됩니다. 잠시 후 다시 시도해 주세요.',
        });
      }
    }
  }
}
