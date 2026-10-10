import * as React from 'react';

const ONE_DAY = 24 * 60 * 60;

import { NotionPage } from 'components';
import { domain } from 'lib/config';
import { resolveNotionPage } from 'lib/resolve-notion-page';

export const getStaticProps = async a => {
  try {
    const props = await resolveNotionPage(domain);

    // 재생성 결과가 캐시에 반영되지 않아(OpenNext ISR 미해결) 10초마다 재생성이 쌓였다.
    // 노션 수정은 재빌드로 반영하고, 평소에는 캐시에서만 응답한다.
    return { props, revalidate: ONE_DAY };
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
