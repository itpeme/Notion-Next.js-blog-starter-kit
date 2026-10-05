import { Client } from '@notionhq/client';
import ExpiryMap from 'expiry-map';
import pMap from 'p-map';
import pMemoize from 'p-memoize';

import { idToUuid } from 'notion-utils';

import { getSearchablePageIds } from './get-site-map';

export interface RecentComment {
  id: string;
  pageId: string;
  content: string;
  createdTime: string;
}

// 노션 API에는 전체 댓글 조회가 없어 글별로 조회한다. 호출 수와 응답 시간을 묶어 두기 위한 제한값
export const MAX_POSTS = 20;
const COMMENTS_PER_POST = 5;
const CONCURRENCY = 4;
const EXCERPT_LENGTH = 90;
const CACHE_TTL = 5 * 60 * 1000;

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function getRecentCommentsImpl(pageIds: string[]): Promise<RecentComment[]> {
  // 공개된 글만 조회 (비공개 글/임의 ID 차단)
  const searchable = await getSearchablePageIds();
  const targets = pageIds
    .map(id => idToUuid(id.replace(/-/g, '')))
    .filter(id => searchable.has(id));

  const perPost = await pMap(
    targets.slice(0, MAX_POSTS),
    async pageId => {
      try {
        const result = await notion.comments.list({ block_id: pageId, page_size: 100 });

        return result.results.slice(-COMMENTS_PER_POST).map((item: any) => ({
          id: item.id as string,
          pageId,
          content: (item.rich_text || [])
            .map((text: any) => text.plain_text)
            .join('')
            .trim(),
          createdTime: item.created_time as string,
        }));
      } catch (error) {
        console.error('recent comments list error', pageId, error?.code, error?.status);
        return [] as RecentComment[];
      }
    },
    { concurrency: CONCURRENCY },
  );

  return perPost
    .flat()
    .filter(comment => comment.content)
    .map(comment => ({
      ...comment,
      content:
        comment.content.length > EXCERPT_LENGTH
          ? `${comment.content.slice(0, EXCERPT_LENGTH)}…`
          : comment.content,
    }))
    .sort((a, b) => b.createdTime.localeCompare(a.createdTime))
    .slice(0, 5);
}

export const getRecentComments = pMemoize(getRecentCommentsImpl, {
  cache: new ExpiryMap(CACHE_TTL),
  cacheKey: ([pageIds]) => [...pageIds].sort().join(','),
});
