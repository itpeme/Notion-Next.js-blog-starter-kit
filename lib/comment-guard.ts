import ExpiryMap from 'expiry-map';
import pMemoize from 'p-memoize';
import { getBlockParentPage, getBlockTitle, idToUuid, parsePageId } from 'notion-utils';

import { rootNotionPageId } from './config';
import { notion } from './notion-api';
import { isHiddenPost } from './post-status';

export interface CommentablePost {
  pageId: string;
  title: string;
}

/**
 * 댓글을 달거나 읽을 수 있는 페이지인지 검증한다.
 * 공개 상태의 블로그 글(글 DB의 행)만 허용하고, 그 외(문의 DB, 비공개 글, 임의 페이지 ID)는 null.
 */
async function getCommentablePostImpl(rawId: string): Promise<CommentablePost | null> {
  const pageId = parsePageId(rawId);

  if (!pageId) return null;

  let recordMap;

  try {
    recordMap = await notion.getPage(pageId, {
      chunkLimit: 1,
      fetchMissingBlocks: false,
      fetchCollections: false,
      signFileUrls: false,
    });
  } catch {
    return null;
  }

  const block = recordMap?.block?.[pageId]?.value;

  if (!block || block.type !== 'page' || block.parent_table !== 'collection') return null;
  if (isHiddenPost(block, recordMap)) return null;

  // 블로그 루트 페이지 아래의 DB에 속한 글만 허용
  const parentPage = getBlockParentPage(block, recordMap);

  if (parentPage?.id !== idToUuid(rootNotionPageId)) return null;

  return { pageId, title: getBlockTitle(block, recordMap) || '' };
}

// 같은 글에 대한 댓글 요청마다 노션을 다시 조회하지 않도록 짧게 캐시
export const getCommentablePost = pMemoize(getCommentablePostImpl, {
  cache: new ExpiryMap(60 * 1000),
  cacheKey: ([rawId]) => String(rawId),
});
