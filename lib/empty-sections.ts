import { Block, ExtendedRecordMap } from 'notion-types';
import { idToUuid } from 'notion-utils';

const HEADING_TYPES = new Set(['header', 'sub_header', 'sub_sub_header']);

const getVisibleItemCount = (block: any, recordMap: ExtendedRecordMap): number | null => {
  const collectionId = block.collection_id || block.format?.collection_pointer?.id;
  const viewId = block.view_ids?.[0];

  if (!collectionId || !viewId) return null;

  const views = recordMap.collection_query?.[collectionId] || recordMap.collection_query?.[idToUuid(collectionId)];
  const reducerResults = views?.[viewId] || views?.[idToUuid(viewId)];

  // 조회 결과를 모르면(조회 실패 등) 비어 있다고 판단하지 않는다
  if (!reducerResults) return null;

  const blockIds = reducerResults.collection_group_results?.blockIds;

  return Array.isArray(blockIds) ? blockIds.length : null;
};

/**
 * 항목이 하나도 없는 컬렉션 뷰 섹션(바로 앞의 제목 포함)을 페이지에서 제거한다.
 * (갤러리/카테고리 페이지처럼 `## 제목` + 필터 뷰로 구성된 페이지에서 빈 섹션을 숨기기 위함)
 * 제목이 바로 앞에 없는 컬렉션 뷰(예: 홈의 글 목록)는 그대로 둔다.
 */
export const removeEmptyCollectionSections = (recordMap: ExtendedRecordMap) => {
  for (const entry of Object.values(recordMap.block || {})) {
    const parent = entry?.value as Block | undefined;
    const content = (parent as any)?.content as string[] | undefined;

    if (parent?.type !== 'page' || !Array.isArray(content)) continue;

    const removeIds = new Set<string>();

    content.forEach((id, index) => {
      const child = recordMap.block[id]?.value as any;

      if (child?.type !== 'collection_view' || getVisibleItemCount(child, recordMap) !== 0) return;

      const previousId = content[index - 1];
      const previous = previousId ? (recordMap.block[previousId]?.value as any) : null;

      // 제목이 앞에 있는 섹션만 제거 (제목 없이 단독으로 놓인 뷰는 유지)
      if (!previous || !HEADING_TYPES.has(previous.type)) return;

      removeIds.add(id);
      removeIds.add(previousId);
    });

    if (removeIds.size) {
      (parent as any).content = content.filter(id => !removeIds.has(id));
    }
  }

  return recordMap;
};
