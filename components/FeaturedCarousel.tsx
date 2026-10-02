import Link from 'next/link';
import * as React from 'react';

import { HomePost } from 'lib/home-posts';

interface FeaturedCarouselProps {
  posts: HomePost[];
  mapPageUrl: (pageId: string) => string;
}

/**
 * 홈 상단 추천 슬라이드. 노션 `추천`을 체크한 글을 최신순으로 최대 5개 보여준다.
 * 별도 라이브러리 없이 CSS scroll-snap과 버튼 두 개로 동작한다.
 */
export const FeaturedCarousel: React.FC<FeaturedCarouselProps> = ({ posts, mapPageUrl }) => {
  const trackRef = React.useRef<HTMLDivElement>(null);

  const scrollByPage = React.useCallback((direction: 1 | -1) => {
    const track = trackRef.current;

    if (!track) return;

    track.scrollBy({ left: direction * track.clientWidth, behavior: 'smooth' });
  }, []);

  if (!posts.length) return null;

  return (
    <section className="home-carousel" aria-label="추천 글">
      <div className="home-carousel-track" ref={trackRef}>
        {posts.map(post => (
          <Link key={post.id} href={mapPageUrl(post.id)} className="home-carousel-slide">
            <div className="home-carousel-text">
              {post.category && <span className="home-badge">{post.category}</span>}
              <h2>{post.title}</h2>
              {post.description && <p>{post.description}</p>}
            </div>

            <div className="home-carousel-media">
              {post.cover ? <img src={post.cover} alt="" loading="lazy" /> : null}
            </div>
          </Link>
        ))}
      </div>

      {posts.length > 1 && (
        <div className="home-carousel-controls">
          <button type="button" aria-label="이전 글" onClick={() => scrollByPage(-1)}>
            ‹
          </button>
          <button type="button" aria-label="다음 글" onClick={() => scrollByPage(1)}>
            ›
          </button>
        </div>
      )}
    </section>
  );
};
