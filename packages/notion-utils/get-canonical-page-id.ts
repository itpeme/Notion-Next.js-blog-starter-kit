import { ExtendedRecordMap } from 'notion-types'
import { uuidToId } from './uuid-to-id'
import { getBlockTitle } from './get-block-title'
import { getPageProperty } from './get-page-property'
import { normalizeTitle } from './normalize-title'

/**
 * Slug 속성 값을 URL에 쓸 수 있게 정리한다.
 * - 앞뒤 공백, 앞뒤의 `/` 제거 (예: 워드프레스 주소를 그대로 붙여넣은 `my-post/`)
 * - 퍼센트 인코딩된 값(`%ea%b0%80...`)은 디코딩
 */
const normalizeSlug = (slug: string | null | undefined): string | null => {
  if (!slug) return null

  let normalized = slug.trim()

  try {
    normalized = decodeURIComponent(normalized)
  } catch {
    // 잘못된 인코딩이면 원문 그대로 사용
  }

  normalized = normalized.replace(/^\/+|\/+$/g, '').trim()

  return normalized || null
}

/**
 * Gets the canonical, display-friendly version of a page's ID for use in URLs.
 */
export const getCanonicalPageId = (
  pageId: string,
  recordMap: ExtendedRecordMap,
  { uuid = true }: { uuid?: boolean } = {}
): string | null => {
  if (!pageId || !recordMap) return null

  const id = uuidToId(pageId)
  const block = recordMap.block[pageId]?.value

  if (block) {
    const slug =
      normalizeSlug(getPageProperty('slug', block, recordMap) as string | null) ||
      normalizeSlug(getPageProperty('Slug', block, recordMap) as string | null) ||
      normalizeTitle(getBlockTitle(block, recordMap))

    if (slug) {
      if (uuid) {
        return `${slug}-${id}`
      } else {
        return slug
      }
    }
  }

  return id
}
