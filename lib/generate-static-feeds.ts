/**
 * 빌드 때 노션 전체 크롤링 결과로 `/sitemap.xml`과 `/feed.xml`을 미리 만들어 `public/`에 둔다.
 *
 * 두 주소는 원래 `getServerSideProps` 라우트였고 요청마다 `getSiteMap()`으로 노션 145페이지를
 * 다시 긁었다. 그래서 운영에서 사이트맵 86~138초, 피드 148초가 걸렸고(엣지 캐시도 안 걸려서
 * 매 요청이 그대로 노션으로 갔다) 검색엔진에 제출하면 "가져올 수 없음"으로 떨어졌다.
 * 빌드는 어차피 전체 크롤링을 한 번 하므로, 그 결과를 그대로 정적 파일로 떨어뜨리면
 * 노션 호출이 0회가 되고 Worker도 거치지 않는다.
 */
import RSS from 'rss';
import { getBlockParentPage, getBlockTitle, getPageProperty, idToUuid } from 'notion-utils';
import { ExtendedRecordMap, PageMap } from 'notion-types';

import * as config from './config';
import * as types from './types';

const SITEMAP_FILE = 'sitemap.xml';
const FEED_FILE = 'feed.xml';
const FEED_TTL_MINUTES = 24 * 60;

// 운영 Worker에는 쓸 수 있는 파일 시스템이 없다. 한 번 실패하면 다시 시도하지 않는다.
let unavailable = false;

type Entry = {
  path: string;
  url: string;
  title: string;
  description: string;
  date?: Date;
  isBlogPost: boolean;
};

/**
 * 두 파일이 이미 있는지 본다. 사이트맵 파일 캐시(`.next/cache/notion-site-map.json`)에는
 * pageMap 이 없어서 그 캐시만으로는 이 파일들을 만들 수 없다. 그래서 파일이 아직 없으면
 * 캐시를 쓰지 말고 전체 크롤링을 해야 한다(그 판단은 get-site-map 쪽에서 한다).
 */
export function staticFeedsExist(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const publicDir = path.join(process.cwd(), 'public');

    return [SITEMAP_FILE, FEED_FILE].every(name => fs.existsSync(path.join(publicDir, name)));
  } catch {
    // 운영 Worker 처럼 파일 시스템이 없는 환경
    return false;
  }
}

export function writeStaticFeeds(siteMap: Partial<types.SiteMap>): void {
  if (unavailable) return;
  // 빌드(= next build)에서만 만든다. dev 서버에서는 두 파일이 없어 404가 되는 것이 정상이다.
  if (process.env.NODE_ENV !== 'production') return;

  const canonicalPageMap = siteMap.canonicalPageMap;
  const pageMap = siteMap.pageMap;

  // 파일 캐시에서 되살린 사이트맵은 pageMap이 비어 있다(용량 때문에 저장하지 않는다).
  // 그때는 제목·날짜를 알 수 없으니 기존 파일을 그대로 둔다.
  if (!canonicalPageMap || !pageMap || !Object.keys(pageMap).length) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const publicDir = path.join(process.cwd(), 'public');

    if (!fs.existsSync(publicDir)) {
      unavailable = true;
      return;
    }

    const entries = collectEntries(canonicalPageMap, pageMap);
    const posts = entries.filter(entry => entry.isBlogPost);

    writeAtomic(fs, path.join(publicDir, SITEMAP_FILE), createSitemap(entries));
    writeAtomic(fs, path.join(publicDir, FEED_FILE), createFeed(posts));

    console.log(
      `[static-feeds] sitemap.xml: ${entries.length + 1} urls, feed.xml: ${posts.length} items`,
    );
  } catch (err) {
    // 파일을 못 쓰는 환경(운영 Worker)이면 정상이다. 빌드 중이라면 로그로 드러난다.
    unavailable = true;
    console.warn('[static-feeds] 생성 건너뜀:', (err as Error)?.message);
  }
}

function writeAtomic(fs: any, file: string, contents: string) {
  // 빌드는 메인 프로세스와 워커 프로세스가 같이 돌아서 같은 파일을 두 번 쓸 수 있다.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, file);
}

function collectEntries(canonicalPageMap: types.CanonicalPageMap, pageMap: PageMap): Entry[] {
  const rootUuid = idToUuid(config.rootNotionPageId);

  const entries = Object.keys(canonicalPageMap)
    // 루트(홈) 페이지는 Slug 주소('/홈')로도 잡히는데 내용이 '/' 와 같다.
    // 사이트맵에 둘 다 넣으면 중복 콘텐츠가 되므로 '/' 만 남긴다.
    .filter(pagePath => !isRootPage(canonicalPageMap[pagePath]))
    .map((pagePath): Entry => {
      const pageId = canonicalPageMap[pagePath];
      const recordMap = pageMap[pageId] as ExtendedRecordMap;
      const block = getPageBlock(recordMap, pageId);
      const url = `${config.host}/${encodeURIComponent(pagePath)}`;

      if (!block || !recordMap) {
        return { path: pagePath, url, title: config.name, description: '', isBlogPost: false };
      }

      // 글 DB의 글만 피드에 넣는다 (소개·카테고리·갤러리 같은 일반 페이지는 제외)
      const parentPage = getBlockParentPage(block, recordMap);
      const isBlogPost =
        block.type === 'page' && block.parent_table === 'collection' && parentPage?.id === rootUuid;

      const lastUpdatedTime = getPageProperty<number>('Last Updated', block, recordMap);
      const publishedTime = getPageProperty<number>('Published', block, recordMap);
      const timestamp = lastUpdatedTime || publishedTime;

      return {
        path: pagePath,
        url,
        title: getBlockTitle(block, recordMap) || config.name,
        description: getPageProperty<string>('설명', block, recordMap) || config.description,
        date: timestamp ? new Date(timestamp) : undefined,
        isBlogPost,
      };
    });

  return entries.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
}

export function isRootPage(pageId: string): boolean {
  return (pageId || '').replace(/-/g, '') === config.rootNotionPageId.replace(/-/g, '');
}

function getPageBlock(recordMap: ExtendedRecordMap, pageId: string) {
  // pageMap의 키와 recordMap.block의 키가 하이픈 유무로 어긋날 수 있다.
  const direct = recordMap?.block?.[pageId]?.value;
  if (direct) return direct;

  const hyphenated = recordMap?.block?.[idToUuid(pageId.replace(/-/g, ''))]?.value;
  if (hyphenated) return hyphenated;

  const firstKey = Object.keys(recordMap?.block || {})[0];
  return recordMap?.block?.[firstKey]?.value;
}

function createSitemap(entries: Entry[]) {
  // 홈의 lastmod는 가장 최근에 수정된 글 날짜로 둔다 (목록이 바뀌는 시점이라서)
  const newest = entries.find(entry => entry.date)?.date;

  const urls = [
    toSitemapUrl(`${config.host}/`, newest),
    ...entries.map(entry => toSitemapUrl(entry.url, entry.date)),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

function toSitemapUrl(loc: string, date?: Date) {
  const lastmod = date ? `\n    <lastmod>${date.toISOString()}</lastmod>` : '';
  return `  <url>\n    <loc>${loc}</loc>${lastmod}\n  </url>`;
}

function createFeed(posts: Entry[]) {
  const feed = new RSS({
    title: config.name,
    description: config.description,
    site_url: config.host,
    feed_url: `${config.host}/${FEED_FILE}`,
    language: config.language,
    ttl: FEED_TTL_MINUTES,
  });

  for (const post of posts) {
    feed.item({
      title: post.title,
      url: post.url,
      date: post.date,
      description: post.description,
    });
  }

  return feed.xml({ indent: true });
}
