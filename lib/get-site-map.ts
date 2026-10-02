import pMemoize from 'p-memoize';
import { getAllPagesInSpace } from 'notion-utils';
import ExpiryMap from 'expiry-map';

import { includeNotionIdInUrls } from './config';
import { notion } from './notion-api';
import { getCanonicalPageId } from './get-canonical-page-id';
import { isHiddenPost } from './post-status';
import * as config from './config';
import * as types from './types';

const uuid = !!includeNotionIdInUrls;
const cache = new ExpiryMap(10000);

export async function getSiteMap(): Promise<types.SiteMap> {
  const partialSiteMap = await getAllPages(config.rootNotionPageId, config.rootNotionSpaceId);

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
  const getPage = async (pageId: string, ...args) => {
    return notion.getPage(pageId, ...args);
  };

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
