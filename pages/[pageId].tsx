import * as React from 'react';
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

    return { props, revalidate: 10 };
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
