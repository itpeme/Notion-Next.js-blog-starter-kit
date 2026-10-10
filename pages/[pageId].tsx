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
const RESERVED_PATHS = new Set(['404', '500', 'feed', 'draftview', 'robots.txt', 'sitemap.xml', 'ads.txt']);

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
    // paths: [],
    // 'blocking': 처음 요청되는 새 글은 서버에서 만들어 응답 (Cloudflare/OpenNext는 fallback: true의 로딩 셸 캐시를 지원하지 않음)
    fallback: 'blocking' as const,
  };

  return staticPaths;
}

export default function NotionDomainDynamicPage(props) {
  return <NotionPage {...props} />;
}
