// eslint-disable-next-line @typescript-eslint/no-var-requires
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

module.exports = withBundleAnalyzer({
  staticPageGenerationTimeout: 300,
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
