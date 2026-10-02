import Link from 'next/link';
import * as React from 'react';

import { AdUnit, adsenseSidebarSlot } from './AdSense';

import { isDev } from 'lib/config';
import { HomePost, getCategoryCounts, getPopularPosts } from 'lib/home-posts';

interface HomeSidebarProps {
  posts: HomePost[];
  mapPageUrl: (pageId: string) => string;
  // 카테고리 목록 링크가 향할 노션 페이지 ID (없으면 링크 없이 표시)
  categoryPageId?: string | null;
}

/**
 * 홈 오른쪽 사이드바: 인기 있는 글(노션 `인기` 순위), 카테고리(글 수), 광고.
 */
export const HomeSidebar: React.FC<HomeSidebarProps> = ({ posts, mapPageUrl, categoryPageId }) => {
  const popular = getPopularPosts(posts);
  const categories = getCategoryCounts(posts);
  const categoryUrl = categoryPageId ? mapPageUrl(categoryPageId) : null;
  // 개발 환경에서는 슬롯 ID가 없어도 광고 자리를 미리 볼 수 있게 한다
  const adSlot = adsenseSidebarSlot || (isDev ? 'dev-preview' : null);

  return (
    <aside className="home-sidebar" aria-label="사이드바">
      {popular.length > 0 && (
        <section className="home-widget">
          <h3>인기 있는 글</h3>
          <ol className="home-popular">
            {popular.map((post, index) => (
              <li key={post.id}>
                <Link href={mapPageUrl(post.id)}>
                  <span className="home-popular-rank">{index + 1}</span>
                  <span className="home-popular-body">
                    <span className="home-popular-title">{post.title}</span>
                    {post.category && <span className="home-popular-meta">{post.category}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {categories.length > 0 && (
        <section className="home-widget">
          <h3>카테고리</h3>
          <ul className="home-categories">
            {categories.map(category => (
              <li key={category.name}>
                {categoryUrl ? (
                  <Link href={categoryUrl}>
                    <span>{category.name}</span>
                    <span className="home-category-count">{category.count}</span>
                  </Link>
                ) : (
                  <span className="home-category-row">
                    <span>{category.name}</span>
                    <span className="home-category-count">{category.count}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {adSlot && (
        <section className="home-widget home-widget-ad">
          <AdUnit slot={adSlot} />
        </section>
      )}
    </aside>
  );
};
