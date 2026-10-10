// eslint-disable-next-line @typescript-eslint/no-var-requires
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

module.exports = withBundleAnalyzer({
  staticPageGenerationTimeout: 300,
  // 워드프레스 시절 주소를 새 사이트의 대응 경로로 넘긴다 (서치 콘솔 클릭 기준).
  // 글 주소는 Slug 를 그대로 유지했으므로 따로 규칙이 필요하지 않다.
  async redirects() {
    const CATEGORIES = '/%EC%B9%B4%ED%85%8C%EA%B3%A0%EB%A6%AC'; // '/카테고리' (한글 경로라 인코딩해서 쓴다)
    return [
      // 태그/카테고리 아카이브는 새 사이트에 없다 → 카테고리 페이지로
      { source: '/tag/:path*', destination: CATEGORIES, permanent: true },
      { source: '/category/:path*', destination: CATEGORIES, permanent: true },
      // 이전하지 않은 KBoard 게시판(질의응답)과 작성자/페이지 아카이브는 홈으로
      { source: '/qna/:path*', destination: '/', permanent: true },
      { source: '/qna', destination: '/', permanent: true },
      { source: '/author/:path*', destination: '/', permanent: true },
      { source: '/page/:path*', destination: '/', permanent: true },
      // 워드프레스 사이트맵 → 새 사이트맵
      { source: '/wp-sitemap.xml', destination: '/sitemap.xml', permanent: true },
      { source: '/wp-sitemap-:path(.*)', destination: '/sitemap.xml', permanent: true },
      // Slug 가 Next.js 예약 경로(404/500)와 겹쳐 노션에서 이름을 바꾼 글
      { source: '/404', destination: '/cbo-table-archiving', permanent: true },
      { source: '/500', destination: '/co-pa-transaction-tables', permanent: true },
      // 노션 본문에서 링크하는데 이전하지 않은 글
      { source: '/sapgui-770-news', destination: '/sapgui-770-installation-file', permanent: true },
    ];
  },
  experimental: {
    // 빌드 중 정적 페이지 생성이 노션 비공식 API를 동시에 너무 많이 호출해서 429(요청 제한)로 실패한다.
    // 워커를 1개로 줄여 노션 호출을 순차화하고, 사이트맵 조회 결과도 한 프로세스에서 재사용하게 한다.
    cpus: 1,
    staticGenerationMaxConcurrency: 2,
  },
  // next/router를 쓰는 외부 패키지는 Next가 직접 컴파일해야 Cloudflare(OpenNext) 번들에서도 라우터 컨텍스트가 하나로 합쳐진다
  transpilePackages: ['nextjs-google-analytics'],
  images: {
    // 노션 이미지 프록시(www.notion.so/image)는 Node의 기본 User-Agent 요청을 403으로 막아서
    // Next.js 이미지 최적화(서버가 대신 가져오기)가 실패한다. 브라우저가 직접 불러오게 한다.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'www.notion.so',
      },
      {
        protocol: 'https',
        hostname: 'notion.so',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: '**.twimg.com',
      },
      {
        protocol: 'https',
        hostname: 's3.*.amazonaws.com',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
});
