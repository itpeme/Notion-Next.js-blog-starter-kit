import { ExtendedRecordMap } from 'notion-types';
import { getBlockTitle, getPageProperty } from 'notion-utils';

import { mapImageUrl } from './map-image-url';

export interface HomePost {
  id: string;
  title: string;
  description: string;
  category: string;
  subCategory: string;
  publishedAt: number | null;
  popularRank: number | null; // 노션 `인기` 속성 (1이 가장 위)
  featured: boolean; // 노션 `추천` 체크 여부
  cover: string | null;
}

/**
 * 홈 화면(추천 슬라이드, 인기 글, 카테고리 목록)에서 쓸 글 목록을 recordMap에서 뽑는다.
 * 비공개 글은 recordMap에서 이미 제거되어 있으므로 공개된 글만 들어온다.
 */
export function getHomePosts(recordMap: ExtendedRecordMap): HomePost[] {
  const posts: HomePost[] = [];

  for (const [id, entry] of Object.entries(recordMap?.block || {})) {
    const block = entry?.value;

    if (!block || block.type !== 'page' || block.parent_table !== 'collection') continue;

    const title = getBlockTitle(block, recordMap);

    // 제목이 없는 행(작성 중에 만들어진 빈 행)은 제외
    if (!title) continue;

    const rank = Number(getPageProperty<string>('인기', block, recordMap));
    const published = getPageProperty<number | number[]>('Published', block, recordMap);
    const pageCover = (block as any).format?.page_cover as string | undefined;

    posts.push({
      id,
      title,
      description: getPageProperty<string>('설명', block, recordMap) || '',
      category: getPageProperty<string>('카테고리', block, recordMap) || '',
      subCategory: getPageProperty<string>('하위 카테고리', block, recordMap) || '',
      publishedAt: typeof published === 'number' ? published : null,
      popularRank: Number.isFinite(rank) && rank > 0 ? rank : null,
      featured: getPageProperty<boolean>('추천', block, recordMap) === true,
      cover: pageCover ? mapImageUrl(pageCover, block) : null,
    });
  }

  return posts;
}

export const sortByLatest = (posts: HomePost[]) =>
  [...posts].sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

export const getPopularPosts = (posts: HomePost[], limit = 5) =>
  posts
    .filter(post => post.popularRank !== null)
    .sort((a, b) => (a.popularRank as number) - (b.popularRank as number))
    .slice(0, limit);

export const getFeaturedPosts = (posts: HomePost[], limit = 5) =>
  sortByLatest(posts.filter(post => post.featured)).slice(0, limit);

export const getCategoryCounts = (posts: HomePost[]) => {
  const counts = new Map<string, number>();

  for (const post of posts) {
    if (post.category) {
      counts.set(post.category, (counts.get(post.category) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};
