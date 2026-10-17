import { getCloudflareContext } from '@opennextjs/cloudflare';
import { parsePageId } from 'notion-utils';
import type { ContentEnv, PublishedIndex, SavedPage } from './content-types';
import { BOOTSTRAP_CONTENT_PATH, contentStorePrefix, revisionKey } from './content-paths';
import * as config from './config';

function runtimeEnv(): ContentEnv | null {
  if (process.env.NOTION_BUILD_CACHE_DIR) return null;
  try {
    const { env } = getCloudflareContext();
    return env as unknown as ContentEnv;
  } catch {
    return null; // next dev / next build는 기존 조회 경로를 사용한다.
  }
}

async function read<T>(env: ContentEnv, file: string): Promise<T> {
  if (env.BLOG_CONTENT_REVISION) {
    const prefix = contentStorePrefix(config.rootNotionPageId, env.BLOG_CONTENT_PREFIX);
    const value = await env.NEXT_INC_CACHE_R2_BUCKET.get(
      revisionKey(prefix, env.BLOG_CONTENT_REVISION, file),
    );
    if (!value) throw new Error('Published content is incomplete');
    return value.json<T>();
  }
  // ASSETS 내부 접근만 허용하고 공개 URL은 custom-worker에서 차단한다.
  const response = await env.ASSETS.fetch(
    new Request(`https://assets.internal${BOOTSTRAP_CONTENT_PATH}/${file}`),
  );
  if (!response.ok) throw new Error('Build content snapshot is unavailable');
  return response.json() as Promise<T>;
}

export async function readPublishedIndex(): Promise<PublishedIndex | null> {
  const env = runtimeEnv();
  if (!env) return null;
  const index = await read<PublishedIndex>(env, 'index.json');
  if (index.schema !== 1 || index.rootPageId !== config.rootNotionPageId) {
    throw new Error('Published content version does not match this site');
  }
  return index;
}

export async function readPublishedPage(rawPageId?: string): Promise<SavedPage | null> {
  const env = runtimeEnv();
  if (!env) return null;
  const index = await readPublishedIndex();
  const allowed = new Set(Object.values(index.canonicalPageMap));
  const parsed = rawPageId ? parsePageId(rawPageId) : parsePageId(config.rootNotionPageId);
  const pageId =
    !rawPageId || rawPageId === 'index'
      ? parsePageId(config.rootNotionPageId)
      : index.canonicalPageMap[rawPageId] || (allowed.has(parsed) ? parsed : undefined);
  if (!pageId) return { error: { statusCode: 404, message: 'Page not found' } };
  const page = await read<SavedPage>(env, `pages/${pageId.replace(/-/g, '').toLowerCase()}.json`);
  return { ...page, site: config.site };
}
