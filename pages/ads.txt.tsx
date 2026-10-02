import type { GetServerSideProps } from 'next';

// 구글 애드센스 ads.txt. 발행자 ID(NEXT_PUBLIC_ADSENSE_CLIENT=ca-pub-...)로 생성한다.
// 구글 인증 기관 ID(f08c47fec0942fa0)는 모든 애드센스 계정에서 같다.
export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
  const publisherId = client && /^ca-pub-\d+$/.test(client) ? client.replace(/^ca-/, '') : null;

  if (!publisherId) {
    return { notFound: true };
  }

  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=86400');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.write(`google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`);
  res.end();

  return {
    props: {},
  };
};

export default () => null;
