import * as React from 'react';

const ONE_DAY = 24 * 60 * 60;
import { GetStaticProps } from 'next';
import { isDev, domain } from 'lib/config';
import { getSiteMap } from 'lib/get-site-map';
import { resolveNotionPage } from 'lib/resolve-notion-page';
import { PageProps, Params } from 'lib/types';
import { NotionPage } from 'components';

export const getStaticProps: GetStaticProps<PageProps, Params> = async context => {
  const rawPageId = context.params.pageId as string;

  try {
    const props = await resolveNotionPage(domain, rawPageId);

    // 없는 주소(또는 비공개 글)는 404 화면만 보여주고 상태코드는 200이었다.
    // 검색엔진이 옛 워드프레스 주소를 정상 페이지로 수집하게 되므로 진짜 404로 응답한다.
    if (props?.error?.statusCode === 404) {
      return { notFound: true, revalidate: ONE_DAY };
    }

    // 재생성 결과가 캐시에 반영되지 않아(OpenNext ISR 미해결) 10초마다 재생성이 쌓였다.
    // 노션 수정은 재빌드로 반영하고, 평소에는 캐시에서만 응답한다.
    return { props, revalidate: ONE_DAY };
  } catch (err) {
    console.error('page error', domain, rawPageId, err);

    // we don't want to publish the error version of this page, so
    // let next.js know explicitly that incremental SSG failed
    throw err;
  }
};

// pages/ 아래 파일이 이미 가지고 있는 경로 (여기에 걸리는 Slug는 글 주소로 쓸 수 없다)
const RESERVED_PATHS = new Set([
  '404',
  '500',
  'feed',
  'feed.xml',
  'draftview',
  'robots.txt',
  'sitemap.xml',
  'ads.txt',
]);

export async function getStaticPaths() {
  if (isDev) {
    return {
      paths: [],
      fallback: true,
    };
  }

  const siteMap = await getSiteMap();

  const staticPaths = {
    paths: Object.keys(siteMap.canonicalPageMap)
      // Next.js가 먼저 차지하는 경로(404/500 등)와 Slug가 겹치면 빌드가 'Conflicting paths'로 실패한다.
      // 노션에서 Slug를 고치는 것이 정답이지만, 빌드가 통째로 깨지지 않도록 여기서도 걸러 둔다.
      .filter(pageId => !RESERVED_PATHS.has(pageId))
      .map(pageId => ({
        params: {
          pageId,
        },
      })),
    // 'blocking'이었을 때는 목록에 없는 주소가 들어오면 그때마다 resolveNotionPage가
    // getSiteMap()으로 노션 145페이지를 전부 다시 긁었다. 운영 Worker에는 빌드 때 쓰는 파일 캐시가
    // 없어서, 없는 주소와 비공개 글이 404 대신 2~3분 무응답이 됐다(측정: 60/90/170초 타임아웃).
    // 옛 워드프레스 주소를 긁는 검색엔진이 매번 여기에 걸리므로 수집 속도까지 떨어진다.
    // 'false'면 아래 목록에 없는 주소는 노션을 보지 않고 즉시 404 페이지로 답한다.
    // 대신 노션에 새로 공개한 글은 재빌드해야 열린다 — revalidate가 1일이라 어차피 홈 목록과
    // 사이트맵에도 재빌드 전에는 안 나오므로, 반영 경로를 재빌드 하나로 통일한다.
    fallback: false as const,
  };

  return staticPaths;
}

export default function NotionDomainDynamicPage(props) {
  return <NotionPage {...props} />;
}
