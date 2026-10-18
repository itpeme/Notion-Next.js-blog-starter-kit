import type { Block, ExtendedRecordMap } from 'notion-types';

export const NOTION_FILE_PATH = '/api/notion-file';

export function isNotionFileUrl(source: string): boolean {
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    return (
      url.hostname === 'file.notion.so' ||
      url.hostname === 'secure.notion-static.com' ||
      /^prod-files-secure\.s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(url.hostname) ||
      /^secure\.notion-static\.com\.s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(url.hostname) ||
      (/^s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(url.hostname) &&
        url.pathname.startsWith('/secure.notion-static.com/'))
    );
  } catch {
    return false;
  }
}

export function getNotionFileSource(block?: Block): string | null {
  if (!block || !['page', 'file', 'image', 'pdf', 'audio', 'video'].includes(block.type))
    return null;
  const source =
    block.type === 'page' ? block.format?.page_cover : block.properties?.source?.[0]?.[0];
  if (typeof source !== 'string') return null;
  return /^attachment:[a-f0-9-]{36}:/i.test(source) || isNotionFileUrl(source) ? source : null;
}

export function notionFileUrl(pageId: string, blockId: string): string {
  const query = new URLSearchParams({
    pageId: pageId.replace(/-/g, ''),
    blockId: blockId.replace(/-/g, ''),
  });
  return `${NOTION_FILE_PATH}?${query}`;
}

/** 렌더링할 복사본만 바꾼다. 게시 원본의 파일 주소는 재서명에 사용한다. */
export function withStableNotionFiles(recordMap: ExtendedRecordMap, pageId: string) {
  if (!recordMap || !pageId) return recordMap;
  const block = { ...recordMap.block };
  const signed_urls = { ...recordMap.signed_urls };
  for (const [id, entry] of Object.entries(block)) {
    const value = entry?.value;
    if (!getNotionFileSource(value)) continue;
    const url = notionFileUrl(pageId, id);
    signed_urls[id] = url;
    block[id] = {
      ...entry,
      value: {
        ...value,
        ...(value.type === 'page'
          ? { format: { ...value.format, page_cover: url } }
          : { properties: { ...value.properties, source: [[url]] } }),
      } as Block,
    };
  }
  return { ...recordMap, block, signed_urls };
}
