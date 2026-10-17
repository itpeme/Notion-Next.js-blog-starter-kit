import { NotionAPI } from 'notion-client';
import { withBuildPageCache } from './notion-build-cache';

// 빌드의 공통 클라이언트에만 적용한다. 운영 요청에는 빌드용 대기열을 만들지 않는다.
const requestIntervalMs = process.env.NOTION_BUILD_CACHE_DIR ? 350 : 0;
export const notion = new NotionAPI({
  apiBaseUrl: process.env.NOTION_API_BASE_URL,
  requestIntervalMs,
});

if (requestIntervalMs) {
  console.log('[notion-api] build request pacing enabled', JSON.stringify({ requestIntervalMs }));
}

export function getNotionPage(
  pageId: string,
  options: Parameters<NotionAPI['getPage']>[1] = {},
): ReturnType<NotionAPI['getPage']> {
  return withBuildPageCache(pageId, options, () => notion.getPage(pageId, options));
}
