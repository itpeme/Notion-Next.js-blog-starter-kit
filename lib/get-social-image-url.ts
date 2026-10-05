/**
 * 소셜(OG) 이미지 주소. 예전에는 Edge 런타임 API(`/api/social-image`)로 동적 생성했지만,
 * Cloudflare Workers(OpenNext)는 Edge 런타임 라우트를 지원하지 않아 제거했다.
 * null을 돌려주면 호출하는 쪽이 페이지 커버 이미지 등으로 대체한다.
 */
export function getSocialImageUrl(_pageId: string): string | null {
  return null
}
