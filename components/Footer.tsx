import Link from 'next/link';
import * as React from 'react';

import * as config from 'lib/config';

interface FooterProps {
  // 노션 pageId를 사이트 URL로 바꾸는 함수 (NotionPage의 mapPageUrl)
  mapPageUrl: (pageId: string) => string;
}

export const FooterImpl: React.FC<FooterProps> = ({ mapPageUrl }) => {
  const year = 2008; // 블로그를 시작한 해
  const links = (config.footerLinks || []).filter(link => link && (link.pageId || link.url));

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <strong>{config.name}</strong>
          {config.description && <p>{config.description}</p>}
        </div>

        <nav className="site-footer-links" aria-label="푸터 메뉴">
          {links.map((link, index) =>
            link.pageId ? (
              <Link key={index} href={mapPageUrl(link.pageId)}>
                {link.title}
              </Link>
            ) : (
              <a key={index} href={link.url} target="_blank" rel="noopener noreferrer">
                {link.title}
              </a>
            ),
          )}
          <a href="/feed" target="_blank" rel="noopener noreferrer">
            RSS
          </a>
          {config.github && (
            <a
              href={`https://github.com/${config.github}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          )}
        </nav>

        <div className="site-footer-copyright">
          © {year} {config.author}. All rights reserved.
        </div>
      </div>
    </footer>
  );
};

export const Footer = React.memo(FooterImpl);
