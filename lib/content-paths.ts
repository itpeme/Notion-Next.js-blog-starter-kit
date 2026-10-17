export const RESERVED_CONTENT_PATHS = new Set([
  '404',
  '500',
  'feed',
  'feed.xml',
  'draftview',
  'robots.txt',
  'sitemap.xml',
  'ads.txt',
  'admin',
  'api',
  '_next',
  '_blog-data',
]);

export const BOOTSTRAP_CONTENT_PATH = '/_blog-data';

export function contentStorePrefix(rootPageId: string, override?: string): string {
  return override || `published-content/v1/${rootPageId.replace(/-/g, '').toLowerCase()}`;
}

export function revisionKey(prefix: string, revision: string, file: string): string {
  return `${prefix}/revisions/${revision}/${file}`;
}
