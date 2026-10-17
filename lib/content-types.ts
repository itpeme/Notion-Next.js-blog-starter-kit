import type { PageProps, CanonicalPageMap } from './types';

export interface PublishedIndex {
  schema: 1;
  rootPageId: string;
  updatedAt: string;
  canonicalPageMap: CanonicalPageMap;
  hiddenPageIds: string[];
}

export interface ContentPointer {
  revision: string;
  updatedAt: string;
  pageCount: number;
  postCount: number;
}

export interface ContentBucket {
  get(key: string): Promise<{
    json<T>(): Promise<T>;
    text(): Promise<string>;
    body: ReadableStream;
  } | null>;
  put(key: string, value: string): Promise<unknown>;
}

export interface ContentEnv {
  NEXT_INC_CACHE_R2_BUCKET: ContentBucket;
  ASSETS: { fetch(request: Request): Promise<Response> };
  BLOG_CONTENT_PREFIX?: string;
  BLOG_CONTENT_REVISION?: string;
  ADMIN_REFRESH_SECRET?: string;
  BLOG_REFRESH: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
}

export interface RefreshStatus {
  id: string;
  state: 'queued' | 'collecting' | 'saving' | 'complete' | 'failed';
  startedAt: string;
  updatedAt: string;
  completed: number;
  total?: number;
  published?: ContentPointer;
  error?: string;
}

export type SavedPage = PageProps;
