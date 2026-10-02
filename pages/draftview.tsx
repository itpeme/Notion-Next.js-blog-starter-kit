import * as React from 'react';

import { NotionPage } from 'components';
import { domain } from 'lib/config';
import { resolveNotionPage } from 'lib/resolve-notion-page';
import { showDrafts } from 'lib/post-status';

export const getServerSideProps = async () => {
  // 운영 환경에서는 비공개 글 목록이 노출되지 않도록 막는다 (미리보기는 SHOW_DRAFTS=true 로 로컬에서)
  if (process.env.NODE_ENV === 'production' && !showDrafts) {
    return { notFound: true };
  }

  try {
    const props = await resolveNotionPage(domain, null, { draftView: true });

    return { props };
  } catch (err) {
    console.error('page error', domain, err);

    // we don't want to publish the error version of this page, so
    // let next.js know explicitly that incremental SSG failed
    throw err;
  }
};

export default function NotionDomainPage(props) {
  // console.log(props);
  return <NotionPage draftView {...props} />;
}
