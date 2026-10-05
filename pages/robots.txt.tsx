import type { GetServerSideProps } from 'next';

import { host } from 'lib/config';

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  // if (req.method !== 'GET') {
  //   res.statusCode = 405;
  //   res.setHeader('Content-Type', 'application/json');
  //   res.write(JSON.stringify({ error: 'method not allowed' }));
  //   res.end();

  //   return {
  //     props: {},
  //   };
  // }

  // cache for up to one day
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.setHeader('Content-Type', 'text/plain');

  // only allow the site to be crawlable on the production deployment
  // Vercel은 VERCEL_ENV, 그 외 호스팅(Cloudflare 등)은 SITE_ENV=production 으로 운영을 구분한다
  if (process.env.VERCEL_ENV === 'production' || process.env.SITE_ENV === 'production') {
    res.write(`User-agent: Mediapartners-Google
Allow: /

User-agent: *
Allow: /
Disallow: /api/get-tweet-ast/*
Disallow: /api/search-notion
Disallow: /draftview

Sitemap: ${host}/sitemap.xml
`);
  } else {
    res.write(`User-agent: *
Disallow: /

Sitemap: ${host}/sitemap.xml
`);
  }

  res.end();

  return {
    props: {},
  };
};

export default () => null;
