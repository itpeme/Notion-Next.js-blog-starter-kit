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

// 사이트맵 한 번을 만들려면 노션의 모든 페이지를 긁어야 한다(지금 145개).
// 캐시가 10초였을 때는 페이지를 만들 때마다 이 크롤링이 다시 돌아 노션이 429로 막았다.
const SITE_MAP_TTL = 5 * 60 * 1000;
const cache = new ExpiryMap(SITE_MAP_TTL);

// 빌드는 getStaticPaths(메인 프로세스)와 페이지 렌더(워커 프로세스)가 따로 돈다.
// 메모리 캐시는 프로세스 사이에 공유되지 않고, 페이지가 300초를 넘겨 워커가 다시 뜨면
// 그때마다 전체 크롤링이 처음부터 시작돼 빌드가 영영 끝나지 않는다.
// 그래서 slug -> pageId 표만 파일로 남겨 워커들이 그대로 읽게 한다.
// (운영 Worker에는 이 파일이 없으므로 읽기가 실패하고 평소대로 노션을 조회한다.)
const BUILD_CACHE_FILE = '.next/cache/notion-site-map.json';
const buildCacheUsable = process.env.NODE_ENV === 'production';
// 한 번의 빌드를 넘기기 위한 캐시다. 다음 빌드가 옛 표를 쓰지 않도록 수명을 둔다.
const BUILD_CACHE_TTL = 2 * 60 * 60 * 1000;

type CachedSiteMap = Pick<types.SiteMap, 'canonicalPageMap'> & { hiddenPageIds: string[] };

function readBuildCache(): CachedSiteMap | null {
  if (!buildCacheUsable) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    const cached = JSON.parse(fs.readFileSync(BUILD_CACHE_FILE, 'utf8'));
    const fresh = Date.now() - (cached?.savedAt || 0) < BUILD_CACHE_TTL;

    if (fresh && cached?.canonicalPageMap && Object.keys(cached.canonicalPageMap).length > 0) {
      return cached;
    }
  } catch {
    // 파일이 없거나 fs를 쓸 수 없는 환경(운영 Worker)이면 그냥 노션을 조회한다
  }

  return null;
}

function writeBuildCache(siteMap: Partial<types.SiteMap>) {
  if (!buildCacheUsable) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    fs.mkdirSync('.next/cache', { recursive: true });
    fs.writeFileSync(
      BUILD_CACHE_FILE,
      JSON.stringify({
        savedAt: Date.now(),
        canonicalPageMap: siteMap.canonicalPageMap,
        hiddenPageIds: siteMap.hiddenPageIds,
      }),
    );
  } catch {
    // 캐시를 못 남겨도 빌드 자체는 계속 진행한다
  }
}

export async function getSiteMap(): Promise<types.SiteMap> {
  const cached = readBuildCache();

  if (cached) {
    // pageMap 은 용량이 커서 파일에 담지 않는다. 지금 이 캐시를 쓰는 곳(정적 경로 목록,
    // slug 변환)은 pageMap 을 보지 않고, pageMap 이 필요한 피드는 운영에서 따로 조회한다.
    return {
      site: config.site,
      pageMap: {},
      ...cached,
    } as types.SiteMap;
  }

  const partialSiteMap = await getAllPages(config.rootNotionPageId, config.rootNotionSpaceId);
  writeBuildCache(partialSiteMap);

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

// 루트 페이지 하위에 있고 공개 상태인 페이지 ID (검색 결과를 이 범위로 제한할 때 사용)
export const getSearchablePageIds = pMemoize(
  async (): Promise<Set<string>> => {
    const siteMap = await getSiteMap();
    return new Set(Object.values(siteMap.canonicalPageMap || {}));
  },
  { cache: new ExpiryMap(HIDDEN_PAGE_IDS_TTL), cacheKey: () => 'searchable-page-ids' },
);
