import { Block, ExtendedRecordMap } from 'notion-types';
import { getPageProperty, idToUuid } from 'notion-utils';

// 글 DB의 게시 상태 속성명과 공개로 취급하는 값
export const STATUS_PROPERTY_NAME = '상태';
export const PUBLISHED_STATUS_VALUE = '공개';

// 개발 중 비공개 글을 미리 보고 싶을 때 SHOW_DRAFTS=true 로 필터를 끈다
export const showDrafts = process.env.SHOW_DRAFTS === 'true';

/**
 * 컬렉션(DB)에 `상태` 속성이 있고 그 값이 `공개`가 아닌 글이면 숨김 대상이다.
 * - `상태` 속성이 없는 DB의 페이지나 DB 밖의 페이지(루트, 소개 등)는 영향받지 않는다.
 * - 컬렉션 스키마를 알 수 없으면(recordMap에 없으면) 판단하지 않고 공개로 취급한다.
 */
export const isHiddenPost = (
  block: Block | null | undefined,
  recordMap: ExtendedRecordMap,
): boolean => {
  if (showDrafts) return false;
  if (!block || block.type !== 'page' || block.parent_table !== 'collection') return false;

  const collection = recordMap.collection?.[block.parent_id]?.value;
  const schema = (collection?.schema || {}) as Record<string, { name?: string }>;
  const hasStatusProperty = Object.values(schema).some(
    property => property?.name === STATUS_PROPERTY_NAME,
  );

  if (!hasStatusProperty) return false;

  return getPageProperty<string>(STATUS_PROPERTY_NAME, block, recordMap) !== PUBLISHED_STATUS_VALUE;
};

/**
 * 컬렉션 뷰 조회 결과에서 숨김 글을 제거한다. (목록, 갤러리 등 화면과 페이지 데이터 모두)
 */
export const removeHiddenPostsFromCollections = (recordMap: ExtendedRecordMap) => {
  const hiddenIds = new Set<string>();

  for (const [blockId, entry] of Object.entries(recordMap.block || {})) {
    if (isHiddenPost(entry?.value, recordMap)) {
      hiddenIds.add(blockId);
    }
  }

  if (!hiddenIds.size) return recordMap;

  for (const views of Object.values(recordMap.collection_query || {})) {
    for (const reducerResults of Object.values(views || {}) as any[]) {
      for (const result of Object.values(reducerResults || {}) as any[]) {
        if (Array.isArray(result?.blockIds)) {
          result.blockIds = result.blockIds.filter(
            (id: string) => !hiddenIds.has(id) && !hiddenIds.has(idToUuid(id)),
          );
        }
      }
    }
  }

  // 숨긴 글 본문 블록(미리보기용으로 함께 내려오는 자식 블록 포함)도 페이지 데이터에서 제거
  const removedIds = new Set(hiddenIds);
  let changed = true;

  while (changed) {
    changed = false;

    for (const [blockId, entry] of Object.entries(recordMap.block || {})) {
      const parentId = entry?.value?.parent_id;

      if (!removedIds.has(blockId) && parentId && removedIds.has(parentId)) {
        removedIds.add(blockId);
        changed = true;
      }
    }
  }

  for (const blockId of removedIds) {
    delete recordMap.block[blockId];
  }

  return recordMap;
};
