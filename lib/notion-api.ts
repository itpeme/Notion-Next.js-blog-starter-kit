import { NotionAPI } from 'notion-client';
import { withBuildPageCache } from './notion-build-cache';

export const notion = new NotionAPI({
  apiBaseUrl: process.env.NOTION_API_BASE_URL,
});

export function getNotionPage(
  pageId: string,
  options: Parameters<NotionAPI['getPage']>[1] = {},
): ReturnType<NotionAPI['getPage']> {
  return withBuildPageCache(pageId, options, () => notion.getPage(pageId, options));
}
