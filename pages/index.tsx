import * as React from 'react';

import { NotionPage } from 'components';
import { domain } from 'lib/config';
import { resolveNotionPage } from 'lib/resolve-notion-page';

export const getStaticProps = async a => {
  try {
    const props = await resolveNotionPage(domain);

    // 관리자가 게시 버전을 교체하면 별도의 캐시 영역에서 새 페이지를 생성한다.
    return { props, revalidate: false };
  } catch (err) {
    console.error('page error', domain, err);

    // we don't want to publish the error version of this page, so
    // let next.js know explicitly that incremental SSG failed
    throw err;
  }
};

export default function NotionDomainPage(props) {
  // console.log(props);
  return <NotionPage {...props} />;
}
