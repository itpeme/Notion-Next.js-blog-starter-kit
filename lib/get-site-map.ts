import pMemoize from 'p-memoize';
import { getAllPagesInSpace } from 'notion-utils';
import ExpiryMap from 'expiry-map';

import { includeNotionIdInUrls } from './config';
import { getNotionPage } from './notion-api';
import { readBuildCache, writeBuildCache } from './notion-build-cache';
import { getCanonicalPageId } from './get-canonical-page-id';
import { isHiddenPost } from './post-status';
import { staticFeedsExist, writeStaticFeeds } from './generate-static-feeds';
import * as config from './config';
import * as types from './types';

const uuid = !!includeNotionIdInUrls;

// 사이트맵 한 번을 만들려면 노션의 모든 페이지를 긁어야 한다(지금 145개).
// 캐시가 10초였을 때는 페이지를 만들 때마다 이 크롤링이 다시 돌아 노션이 429로 막았다.
const SITE_MAP_TTL = 5 * 60 * 1000;
const cache = new ExpiryMap(SITE_MAP_TTL);

type CachedSiteMap = Pick<types.SiteMap, 'canonicalPageMap'> & { hiddenPageIds: string[] };

export async function getSiteMap(): Promise<types.SiteMap> {
  // 원본 페이지와 주소 표 모두 이번 빌드에서만 공유한다. 이전 빌드의 표는 복원하지 않는다.
  // 표에는 pageMap이 없으므로 사이트맵/피드가 먼저 생성되어 있어야 사용할 수 있다.
  const cached: CachedSiteMap | null = staticFeedsExist()
    ? readBuildCache('site-map', config.rootNotionPageId)
    : null;

  if (cached) {
    // 각 페이지 원본은 getNotionPage가 별도 파일로 공유한다. 주소 조회에는 표만 있으면 된다.
    return {
      site: config.site,
      pageMap: {},
      ...cached,
    } as types.SiteMap;
  }

  const partialSiteMap = await getAllPages(config.rootNotionPageId, config.rootNotionSpaceId);
  // 전체 크롤링이 끝난 지금이 사이트맵/피드를 만들 수 있는 유일한 지점이다(pageMap이 여기에만 있다).
  writeStaticFeeds(partialSiteMap);
  writeBuildCache('site-map', config.rootNotionPageId, {
    canonicalPageMap: partialSiteMap.canonicalPageMap,
    hiddenPageIds: partialSiteMap.hiddenPageIds,
  });

  return {
    site: config.site,
    ...partialSiteMap,
  } as types.SiteMap;
}

const getAllPages = pMemoize(getAllPagesImpl, {
  cacheKey: (...args) => JSON.stringify(args),
  cache,
});

async function getAllPagesImpl(
  rootNotionPageId: string,
  rootNotionSpaceId: string,
): Promise<Partial<types.SiteMap>> {
  const getPage = (pageId: string) => getNotionPage(pageId);

  const pageMap = await getAllPagesInSpace(rootNotionPageId, rootNotionSpaceId, getPage);

  const hiddenPageIds: string[] = [];

  const canonicalPageMap = Object.keys(pageMap).reduce((map, pageId: string) => {
    const recordMap = pageMap[pageId];
    if (!recordMap) {
      throw new Error(`Error loading page "${pageId}"`);
    }

    // 게시 상태가 공개가 아닌 글은 사이트맵, 피드, 정적 경로 대상에서 제외
    if (isHiddenPost(recordMap.block?.[pageId]?.value, recordMap)) {
      hiddenPageIds.push(pageId);
      return map;
    }

    const canonicalPageId = getCanonicalPageId(pageId, recordMap, {
      uuid,
    });

    if (map[canonicalPageId]) {
      // you can have multiple pages in different collections that have the same id
      // TODO: we may want to error if neither entry is a collection page
      console.warn('error duplicate canonical page id', {
        canonicalPageId,
        pageId,
        existingPageId: map[canonicalPageId],
      });

      return map;
    } else {
      return {
        ...map,
        [canonicalPageId]: pageId,
      };
    }
  }, {});

  return {
    pageMap,
    canonicalPageMap,
    hiddenPageIds,
  };
}

const HIDDEN_PAGE_IDS_TTL = 5 * 60 * 1000;

// 검색 API처럼 자주 호출되는 곳에서 전체 사이트맵 조회가 반복되지 않도록 길게 캐시
export const getHiddenPageIds = pMemoize(
  async (): Promise<Set<string>> => {
    const siteMap = await getSiteMap();
    return new Set(siteMap.hiddenPageIds || []);
  },
  { cache: new ExpiryMap(HIDDEN_PAGE_IDS_TTL), cacheKey: () => 'hidden-page-ids' },
);

// 루트 페이지 하위에 있고 공개 상태인 페이지 ID (검색 결과를 이 범위로 제한할 때 사용)
export const getSearchablePageIds = pMemoize(
  async (): Promise<Set<string>> => {
    const siteMap = await getSiteMap();
    return new Set(Object.values(siteMap.canonicalPageMap || {}));
  },
  { cache: new ExpiryMap(HIDDEN_PAGE_IDS_TTL), cacheKey: () => 'searchable-page-ids' },
);
