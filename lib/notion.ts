import { ExtendedRecordMap, SearchParams, SearchResults } from 'notion-types';
import { idToUuid, mergeRecordMaps } from 'notion-utils';
import ExpiryMap from 'expiry-map';
import pMap from 'p-map';
import pMemoize from 'p-memoize';

import {
  isPreviewImageSupportEnabled,
  navigationStyle,
  navigationLinks,
  footerLinks,
} from './config';
import { getHiddenPageIds } from './get-site-map';
import { notion } from './notion-api';
import { getPreviewImageMap } from './preview-images';

// 메뉴에 연결된 페이지 정보는 5분마다 새로 불러온다 (제목·아이콘 변경 반영)
const NAVIGATION_PAGES_TTL = 5 * 60 * 1000;

const getNavigationLinkPages = pMemoize(
  async (): Promise<ExtendedRecordMap[]> => {
    // 메뉴와 푸터에 연결된 페이지의 제목·URL 정보를 함께 불러온다 (중복 제거)
    const navigationLinkPageIds = Array.from(
      new Set(
        [...(navigationLinks || []), ...(footerLinks || [])]
          .map(link => link?.pageId)
          .filter(Boolean),
      ),
    );

    if (navigationStyle !== 'default' && navigationLinkPageIds.length) {
      return pMap(
        navigationLinkPageIds,
        async navigationLinkPageId =>
          notion.getPage(navigationLinkPageId, {
            chunkLimit: 1,
            fetchMissingBlocks: false,
            fetchCollections: false,
            signFileUrls: false,
          }),
        {
          concurrency: 4,
        },
      );
    }

    return [];
  },
  { cache: new ExpiryMap(NAVIGATION_PAGES_TTL), cacheKey: () => 'navigation-link-pages' },
);

const RECORD_MAP_KEYS = [
  'block',
  'collection',
  'collection_view',
  'notion_user',
  'collection_query',
  'signed_urls',
  'preview_images',
] as const;

/**
 * 지금 불러온 페이지 데이터(fresh)가 메뉴용 페이지 정보(캐시됨)보다 우선하도록 병합한다.
 * 화면은 recordMap.block의 첫 번째 블록을 현재 페이지로 쓰므로 fresh의 키 순서를 앞에 유지한다.
 */
function mergeRecordMapsPreferFirst(
  fresh: ExtendedRecordMap,
  extra: ExtendedRecordMap,
): ExtendedRecordMap {
  const merged = mergeRecordMaps(extra, fresh);

  for (const key of RECORD_MAP_KEYS) {
    (merged as any)[key] = { ...(fresh as any)[key], ...(merged as any)[key] };
  }

  return merged;
}

export interface GetPageOptions {
  draftView?: boolean;
}

export async function getPage(
  pageId: string,
  options: GetPageOptions = {},
): Promise<ExtendedRecordMap> {
  let recordMap = await notion.getPage(pageId, options);

  if (navigationStyle !== 'default') {
    // ensure that any pages linked to in the custom navigation header have
    // their block info fully resolved in the page record map so we know
    // the page title, slug, etc.
    const navigationLinkRecordMaps = await getNavigationLinkPages();

    if (navigationLinkRecordMaps?.length) {
      recordMap = navigationLinkRecordMaps.reduce(
        (map, navigationLinkRecordMap) => mergeRecordMapsPreferFirst(map, navigationLinkRecordMap),
        recordMap,
      );
    }
  }

  if (isPreviewImageSupportEnabled) {
    const previewImageMap = await getPreviewImageMap(recordMap);
    (recordMap as any).preview_images = previewImageMap;
  }

  return recordMap;
}

export async function search(params: SearchParams): Promise<SearchResults> {
  const results = await notion.search(params);
  const hiddenPageIds = await getHiddenPageIds();

  if (!hiddenPageIds.size || !results?.results) {
    return results;
  }

  // 검색 결과에서 비공개 글 제거
  results.results = results.results.filter(item => !hiddenPageIds.has(idToUuid(item.id)));

  for (const hiddenPageId of hiddenPageIds) {
    delete results.recordMap?.block?.[hiddenPageId];
  }

  return results;
}
