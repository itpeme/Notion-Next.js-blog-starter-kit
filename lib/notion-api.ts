import { NotionAPI } from 'notion-client';
import { withBuildPageCache } from './notion-build-cache';

// 빌드의 공통 클라이언트에만 적용한다. 운영 요청에는 빌드용 대기열을 만들지 않는다.
const isBuild = !!process.env.NOTION_BUILD_CACHE_DIR;
const requestIntervalMs = isBuild ? 150 : 0;
// Cloudflare 로그에서 429가 집중된 글 조회만 더 천천히 시작한다. 나머지 API는 별도로 진행한다.
const requestIntervalMsByEndpoint = isBuild ? { loadPageChunk: 1300 } : {};
export const notion = new NotionAPI({
  apiBaseUrl: process.env.NOTION_API_BASE_URL,
  requestIntervalMs,
  requestIntervalMsByEndpoint,
});

if (requestIntervalMs) {
  console.log(
    '[notion-api] build request pacing enabled',
    JSON.stringify({ requestIntervalMs, requestIntervalMsByEndpoint }),
  );
}

export function getNotionPage(
  pageId: string,
  options: Parameters<NotionAPI['getPage']>[1] = {},
): ReturnType<NotionAPI['getPage']> {
  return withBuildPageCache(pageId, options, () => notion.getPage(pageId, options));
}
