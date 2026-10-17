import { timingSafeEqual } from 'node:crypto';
import type { ContentEnv } from './content-types';
import { contentStorePrefix } from './content-paths';
import { rootNotionPageId } from './config';

function reply(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function handleAdminRefresh(request: Request, env: ContentEnv): Promise<Response> {
  if (!['GET', 'POST'].includes(request.method)) return reply('지원하지 않는 요청입니다.', 405);
  const secret = env.ADMIN_REFRESH_SECRET;
  if (!secret || secret.length < 32) return reply('관리자 비밀번호 설정이 필요합니다.', 503);
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  const supplied = Buffer.from(token);
  const expected = Buffer.from(secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return reply('관리자 비밀번호를 확인해 주세요.', 401);
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    return reply('허용되지 않은 요청입니다.', 403);
  const prefix = contentStorePrefix(rootNotionPageId, env.BLOG_CONTENT_PREFIX);
  const job = env.BLOG_REFRESH.get(env.BLOG_REFRESH.idFromName(prefix));
  const response = await job.fetch(
    new Request('https://refresh.internal/job', { method: request.method }),
  );
  return new Response(response.body, {
    status: response.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
