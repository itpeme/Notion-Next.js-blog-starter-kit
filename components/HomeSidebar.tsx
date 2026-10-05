import Link from 'next/link';
import * as React from 'react';

import { AdUnit, adsenseClient, adsenseSidebarSlot } from './AdSense';

import { enableComment } from 'lib/config';
import { HomePost, getCategoryCounts, getPopularPosts, sortByLatest } from 'lib/home-posts';

interface HomeSidebarProps {
  posts: HomePost[];
  mapPageUrl: (pageId: string) => string;
  // 카테고리 목록 링크가 향할 노션 페이지 ID (없으면 링크 없이 표시)
  categoryPageId?: string | null;
}

interface RecentComment {
  id: string;
  pageId: string;
  content: string;
  createdTime: string;
}

// 최근 댓글을 조회할 글 수 (최신 글부터). 서버의 조회 상한과 맞춘다.
const RECENT_COMMENT_POSTS = 20;

const formatRelativeTime = (iso: string) => {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);

  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}시간 전`;
  if (minutes < 60 * 24 * 30) return `${Math.floor(minutes / (60 * 24))}일 전`;

  return new Date(iso).toLocaleDateString('ko-KR');
};

/**
 * 홈 오른쪽 사이드바: 카테고리(글 수), 인기 있는 글(노션 `인기` 순위), 최근 댓글, 광고.
 */
export const HomeSidebar: React.FC<HomeSidebarProps> = ({ posts, mapPageUrl, categoryPageId }) => {
  const rankedPosts = getPopularPosts(posts);
  // `인기` 순위가 하나도 지정되지 않았으면 위젯이 비지 않도록 최신 글을 대신 보여준다
  const hasRanking = rankedPosts.length > 0;
  const popular = hasRanking ? rankedPosts : sortByLatest(posts).slice(0, 5);
  const categories = getCategoryCounts(posts);
  const categoryUrl = categoryPageId ? mapPageUrl(categoryPageId) : null;
  const [recentComments, setRecentComments] = React.useState<RecentComment[]>([]);
  // 선택한 카테고리의 글만 홈 목록에 보여준다 (null이면 전체)
  const [selectedCategory, setSelectedCategory] = React.useState<string | null>(null);

  // 주소의 ?category= 값으로 시작할 수 있게 한다 (공유·새로고침용)
  React.useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('category');

    if (initial) setSelectedCategory(initial);
  }, []);

  const selectCategory = (name: string | null) => {
    const next = name && name === selectedCategory ? null : name;
    const url = new URL(window.location.href);

    if (next) {
      url.searchParams.set('category', next);
    } else {
      url.searchParams.delete('category');
    }

    window.history.replaceState(window.history.state, '', url);
    setSelectedCategory(next);
  };

  // 홈 카드 목록에서 선택한 카테고리가 아닌 카드를 숨긴다 (카드는 늦게 그려질 수 있어 DOM 변화를 관찰)
  React.useEffect(() => {
    const getCards = () =>
      document.querySelectorAll<HTMLElement>('.notion-collection .notion-collection-card');

    const apply = () => {
      getCards().forEach(card => {
        const category = card.querySelector('.notion-property-select-item')?.textContent || '';

        card.style.display = !selectedCategory || category === selectedCategory ? '' : 'none';
      });
    };

    apply();

    const observer = new MutationObserver(apply);

    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      getCards().forEach(card => {
        card.style.display = '';
      });
    };
  }, [selectedCategory]);

  // 최근 댓글: 최신 공개 글들의 댓글을 서버에서 모아 온다 (댓글 기능이 켜져 있을 때만)
  const recentPostIds = React.useMemo(
    () => sortByLatest(posts).slice(0, RECENT_COMMENT_POSTS).map(post => post.id),
    [posts],
  );
  const postById = React.useMemo(() => new Map(posts.map(post => [post.id, post])), [posts]);

  React.useEffect(() => {
    if (!enableComment || !recentPostIds.length) return;

    let cancelled = false;

    fetch('/api/recent-comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: recentPostIds }),
    })
      .then(res => (res.ok ? res.json() : { results: [] }))
      .then(data => {
        if (!cancelled) setRecentComments(data.results || []);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [recentPostIds]);

  // 애드센스 ID와 슬롯 ID가 모두 있을 때만 광고 영역을 보여준다 (개발 환경 포함)
  const adSlot = adsenseClient ? adsenseSidebarSlot : null;

  return (
    <aside className="home-sidebar" aria-label="사이드바">
      {categories.length > 0 && (
        <section className="home-widget">
          <h3>카테고리</h3>
          <ul className="home-categories">
            <li>
              <button
                type="button"
                className={selectedCategory ? 'home-category-row' : 'home-category-row active'}
                aria-pressed={!selectedCategory}
                onClick={() => selectCategory(null)}
              >
                <span>전체</span>
                <span className="home-category-count">{posts.length}</span>
              </button>
            </li>
            {categories.map(category => (
              <li key={category.name}>
                <button
                  type="button"
                  className={
                    selectedCategory === category.name
                      ? 'home-category-row active'
                      : 'home-category-row'
                  }
                  aria-pressed={selectedCategory === category.name}
                  onClick={() => selectCategory(category.name)}
                >
                  <span>{category.name}</span>
                  <span className="home-category-count">{category.count}</span>
                </button>
              </li>
            ))}
          </ul>
          {categoryUrl && (
            <Link href={categoryUrl} className="home-category-all">
              카테고리별 글 목록 보기 →
            </Link>
          )}
        </section>
      )}

      {popular.length > 0 && (
        <section className="home-widget">
          <h3>{hasRanking ? '인기 있는 글' : '최신 글'}</h3>
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

      {recentComments.length > 0 && (
        <section className="home-widget">
          <h3>최근 댓글</h3>
          <ul className="home-comments">
            {recentComments.map(comment => {
              const post = postById.get(comment.pageId);

              return (
                <li key={comment.id}>
                  <Link href={mapPageUrl(comment.pageId)}>
                    <span className="home-comment-text">{comment.content}</span>
                    <span className="home-comment-meta">
                      {post?.title && <span className="home-comment-post">{post.title}</span>}
                      <span>{formatRelativeTime(comment.createdTime)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
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
