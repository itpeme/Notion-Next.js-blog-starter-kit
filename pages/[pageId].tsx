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

export async function getStaticPaths() {
  if (isDev) {
    return {
      paths: [],
      fallback: true,
    };
  }

  const siteMap = await getSiteMap();

  const staticPaths = {
    paths: Object.keys(siteMap.canonicalPageMap).map(pageId => ({
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
