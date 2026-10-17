import type { ExtendedRecordMap } from 'notion-types';
import * as acl from './acl';
import { site } from './config';
import { isHiddenPost, removeHiddenPostsFromCollections } from './post-status';
import { removeEmptyCollectionSections } from './empty-sections';
import { trimPreviewContent } from './trim-preview-content';

export async function prepareNotionPage(pageId: string, recordMap: ExtendedRecordMap) {
  if (isHiddenPost(recordMap?.block?.[pageId]?.value, recordMap)) {
    return { error: { statusCode: 404, message: 'Page not found' } };
  }
  removeHiddenPostsFromCollections(recordMap);
  removeEmptyCollectionSections(recordMap);
  trimPreviewContent(recordMap, pageId);
  const props = { site, recordMap, pageId };
  return { ...props, ...(await acl.pageAcl(props)) };
}
