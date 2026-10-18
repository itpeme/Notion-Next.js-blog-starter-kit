import { getBlockParentPage, parsePageId } from 'notion-utils';
import type { ContentEnv } from './content-types';
import { readPublishedIndexFromEnv, readPublishedPageFromEnv } from './published-content';
import { getNotionFileSource, isNotionFileUrl } from './notion-file-url';

interface SignedFile {
  url: string;
  expiresAt: number;
}

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const error = (message: string, status: number) =>
  new Response(message, { status, headers: HEADERS });

// 짧은 메모리 캐시만 사용하고 HTML/R2에는 새 서명 URL을 저장하지 않는다.
export function createNotionFileHandler(fetcher: typeof fetch = fetch) {
  const cache = new Map<string, SignedFile>();
  const pending = new Map<string, Promise<SignedFile>>();
  async function sign(key: string, blockId: string, source: string): Promise<SignedFile> {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached;
    cache.delete(key);
    if (pending.has(key)) return pending.get(key);
    const promise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetcher('https://www.notion.so/api/v3/getSignedFileUrls', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'itpe-blog/1.0 (+https://itpe.me)',
          },
          body: JSON.stringify({
            urls: [{ permissionRecord: { table: 'block', id: blockId }, url: source }],
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Signing unavailable');
        const data = (await response.json()) as { signedUrls?: string[] };
        const url = data.signedUrls?.length === 1 ? data.signedUrls[0] : null;
        if (typeof url !== 'string' || !isNotionFileUrl(url)) throw new Error('Invalid file URL');
        const query = new URL(url).searchParams;
        let expiry: number | undefined;
        if (query.has('expirationTimestamp')) expiry = Number(query.get('expirationTimestamp'));
        else if (query.has('Expires')) expiry = Number(query.get('Expires')) * 1000;
        else if (query.has('X-Amz-Date') && query.has('X-Amz-Expires')) {
          const date = query
            .get('X-Amz-Date')
            .replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
          expiry = Date.parse(date) + Number(query.get('X-Amz-Expires')) * 1000;
        }
        const expiresAt =
          expiry === undefined ? Date.now() + 60000 : Math.min(Date.now() + 60000, expiry - 30000);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
          throw new Error('Expired file URL');
        const file = { url, expiresAt };
        if (cache.size >= 256) cache.delete(cache.keys().next().value);
        cache.set(key, file);
        return file;
      } finally {
        clearTimeout(timer);
      }
    })();
    pending.set(key, promise);
    try {
      return await promise;
    } finally {
      pending.delete(key);
    }
  }

  return async (request: Request, env: ContentEnv): Promise<Response> => {
    if (!['GET', 'HEAD'].includes(request.method))
      return new Response(null, { status: 405, headers: { ...HEADERS, Allow: 'GET, HEAD' } });
    const params = new URL(request.url).searchParams;
    const validId = (value: string) =>
      /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(value || '');
    if (!validId(params.get('pageId')) || !validId(params.get('blockId')))
      return error('파일을 찾을 수 없습니다.', 404);
    const pageId = parsePageId(params.get('pageId'));
    const blockId = parsePageId(params.get('blockId'));
    try {
      // 캐시에 서명이 있어도 현재 게시본의 공개 여부부터 매번 검사한다.
      const index = await readPublishedIndexFromEnv(env);
      const allowed = new Set(Object.values(index.canonicalPageMap));
      if (!allowed.has(pageId)) return error('파일을 찾을 수 없습니다.', 404);
      const page = await readPublishedPageFromEnv(env, pageId, index);
      const block = page.recordMap?.block?.[blockId]?.value;
      const source = getNotionFileSource(block);
      const owner = block && getBlockParentPage(block, page.recordMap, { inclusive: true });
      if (page.error || !source || !owner || !allowed.has(owner.id))
        return error('파일을 찾을 수 없습니다.', 404);
      const key = JSON.stringify([
        env.BLOG_CONTENT_PREFIX,
        env.BLOG_CONTENT_REVISION,
        index.updatedAt,
        pageId,
        blockId,
        source,
      ]);
      const signed = await sign(key, blockId, source);
      return new Response(null, { status: 302, headers: { ...HEADERS, Location: signed.url } });
    } catch {
      // URL, 서명, upstream 응답은 로그나 오류 본문에 노출하지 않는다.
      return error('파일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', 503);
    }
  };
}

export const handleNotionFile = createNotionFileHandler();
