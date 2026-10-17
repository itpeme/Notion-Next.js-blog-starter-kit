import * as React from 'react';

import { GetStaticProps } from 'next';
import { isDev, domain } from 'lib/config';
import { getSiteMap } from 'lib/get-site-map';
import { resolveNotionPage } from 'lib/resolve-notion-page';
import { PageProps, Params } from 'lib/types';
import { NotionPage } from 'components';
import { RESERVED_CONTENT_PATHS } from 'lib/content-paths';

// 빌드가 미리 만드는 경로에는 퍼센트 인코딩된 복사본(`%EC%86%8C...`)이 섞여 있다(아래 getStaticPaths 주석).
// 노션 Slug 표의 키는 디코딩된 원래 문자열이므로 조회 전에 되돌린다.
// 요청 시 렌더되는 경로는 Next 가 이미 디코딩해 주므로 이 함수는 그때도 안전하게 그대로 통과한다.
function decodeSlug(rawPageId: string) {
  try {
    return decodeURIComponent(rawPageId);
  } catch {
    // 잘못된 인코딩이면 원문 그대로 둔다(어차피 404로 끝난다)
    return rawPageId;
  }
}

export const getStaticProps: GetStaticProps<PageProps, Params> = async context => {
  const rawPageId = decodeSlug(context.params.pageId as string);

  try {
    const props = await resolveNotionPage(domain, rawPageId);

    // 없는 주소(또는 비공개 글)는 404 화면만 보여주고 상태코드는 200이었다.
    // 검색엔진이 옛 워드프레스 주소를 정상 페이지로 수집하게 되므로 진짜 404로 응답한다.
    if (props?.error?.statusCode === 404) {
      return { notFound: true, revalidate: false };
    }

    return { props, revalidate: false };
  } catch (err) {
    console.error('page error', domain, rawPageId, err);

    // we don't want to publish the error version of this page, so
    // let next.js know explicitly that incremental SSG failed
    throw err;
  }
};

// pages/ 아래 파일이 이미 가지고 있는 경로 (여기에 걸리는 Slug는 글 주소로 쓸 수 없다)
const RESERVED_PATHS = RESERVED_CONTENT_PATHS;

export async function getStaticPaths() {
  if (isDev) {
    return {
      paths: [],
      fallback: true,
    };
  }

  const siteMap = await getSiteMap();

  const pageIds = Object.keys(siteMap.canonicalPageMap)
    // Next.js가 먼저 차지하는 경로(404/500 등)와 Slug가 겹치면 빌드가 'Conflicting paths'로 실패한다.
    // 노션에서 Slug를 고치는 것이 정답이지만, 빌드가 통째로 깨지지 않도록 여기서도 걸러 둔다.
    .filter(pageId => !RESERVED_PATHS.has(pageId));

  // 기존 OpenNext 캐시의 한글 경로와 호환되도록 인코딩된 경로도 미리 생성한다.
  const encodedVariants = pageIds
    .map(pageId => encodeURIComponent(pageId))
    .filter((encoded, index) => encoded !== pageIds[index]);

  const staticPaths = {
    paths: [...pageIds, ...encodedVariants].map(pageId => ({
      params: {
        pageId,
      },
    })),
    // 운영 요청은 저장된 게시 목록과 본문만 읽는다. 새 주소 생성도 전체 Notion 조회 없이 처리한다.
    fallback: 'blocking' as const,
  };

  return staticPaths;
}

export default function NotionDomainDynamicPage(props) {
  return <NotionPage {...props} />;
}
