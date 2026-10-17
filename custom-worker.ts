// @ts-ignore OpenNext가 빌드 시 생성하는 엔트리.
import handler from './.open-next/worker.js';
import type { ContentEnv, ContentPointer } from './lib/content-types';
import { BOOTSTRAP_CONTENT_PATH, contentStorePrefix, revisionKey } from './lib/content-paths';
import { rootNotionPageId } from './lib/config';
import { handleAdminRefresh } from './lib/admin-refresh';
export { BlogRefreshJob } from './lib/content-refresh-job';

export default {
  async fetch(request: Request, env: ContentEnv, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response(null, { status: 400 });
    }
    // 내부 부트스트랩 파일을 ASSETS binding 외부로 공개하지 않는다.
    if (pathname === BOOTSTRAP_CONTENT_PATH || pathname.startsWith(`${BOOTSTRAP_CONTENT_PATH}/`)) {
      return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    if (pathname === '/api/admin/refresh') return handleAdminRefresh(request, env);
    if (
      pathname.startsWith('/_next/static/') ||
      pathname.startsWith('/fonts/') ||
      pathname.startsWith('/wp-content/')
    )
      return env.ASSETS.fetch(request);
    if (!pathname.startsWith('/_next/data/') && /\.(png|gif|ico|json)$/.test(pathname)) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.ok) return asset;
    }
    const isDocument = pathname === '/sitemap.xml' || pathname === '/feed.xml';
    const prefix = contentStorePrefix(rootNotionPageId, env.BLOG_CONTENT_PREFIX);
    const stored = await env.NEXT_INC_CACHE_R2_BUCKET.get(`${prefix}/current.json`);
    const pointer = stored ? await stored.json<ContentPointer>() : null;
    if (isDocument && pointer) {
      const file = await env.NEXT_INC_CACHE_R2_BUCKET.get(
        revisionKey(prefix, pointer.revision, pathname.slice(1)),
      );
      if (!file) return new Response('게시 데이터를 불러오지 못했습니다.', { status: 503 });
      return new Response(request.method === 'HEAD' ? null : file.body, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'no-cache',
          'X-Blog-Revision': pointer.revision,
        },
      });
    }
    const runtimeEnv = pointer
      ? {
          ...env,
          BLOG_CONTENT_REVISION: pointer.revision,
          NEXT_INC_CACHE_R2_PREFIX: `${prefix}/html/${pointer.revision}`,
        }
      : { ...env };
    const response = await handler.fetch(request, runtimeEnv, ctx);
    const headers = new Headers(response.headers);
    if (pointer) headers.set('X-Blog-Revision', pointer.revision);
    // 브라우저/CDN의 이전 HTML·JSON이 새 게시 버전을 가리지 않도록 한다.
    headers.set('Cache-Control', 'no-cache');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
