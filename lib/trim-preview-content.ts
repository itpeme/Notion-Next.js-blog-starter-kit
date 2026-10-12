import { Block, ExtendedRecordMap } from 'notion-types';
import { idToUuid } from 'notion-utils';

/**
 * 목록 카드(collection-card.tsx)는 글 본문에서 첫 이미지 한 장만 쓴다. 그런데 노션은
 * 컬렉션 조회 결과에 각 행의 본문 앞부분까지 함께 담아 주기 때문에, 글이 늘어나자
 * 홈 응답이 1.9MB(본문 블록 1,111개)까지 커졌다.
 *
 * 그래서 지금 보고 있는 페이지를 빼고, 나머지 페이지의 본문 블록을 응답에서 걷어낸다.
 * 썸네일용 첫 이미지와 하위 페이지 블록(푸터/메뉴 링크가 참조한다)은 남긴다.
 */
export const trimPreviewContent = (recordMap: ExtendedRecordMap, keepPageId: string) => {
  const blocks = recordMap.block || {};
  // 홈은 하이픈 없는 rootNotionPageId가 넘어오고, 블록 키는 하이픈 있는 UUID다
  const keepId = keepPageId ? idToUuid(keepPageId.replace(/-/g, '')) : null;

  const removeSubtree = (id: string) => {
    const value = blocks[id]?.value as any;

    if (!value) return;

    const content = value.content as string[] | undefined;

    if (Array.isArray(content)) content.forEach(removeSubtree);

    delete blocks[id];
  };

  for (const [id, entry] of Object.entries(blocks)) {
    const page = entry?.value as Block | undefined;
    const content = (page as any)?.content as string[] | undefined;

    // 보고 있는 페이지의 본문은 그대로 둔다
    if (page?.type !== 'page' || id === keepId || !Array.isArray(content)) continue;

    const keepIds: string[] = [];
    const removeIds: string[] = [];
    let keptImage = false;

    for (const childId of content) {
      const child = blocks[childId]?.value as any;

      if (!child) continue;

      if (!keptImage && child.type === 'image') {
        keptImage = true;
        keepIds.push(childId);
      } else if (child.type === 'page') {
        keepIds.push(childId);
      } else {
        removeIds.push(childId);
      }
    }

    if (!removeIds.length) continue;

    removeIds.forEach(removeSubtree);
    (page as any).content = keepIds;
  }

  return recordMap;
};
