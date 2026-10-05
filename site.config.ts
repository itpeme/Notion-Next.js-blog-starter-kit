import { siteConfig } from './lib/site-config';

export default siteConfig({
  // the site's root Notion page (required)
  rootNotionPageId: '3ed45f955e1681c0bb2ede1030189d87',

  // if you want to restrict pages to a single notion workspace (optional)
  // (this should be a Notion ID; see the docs for how to extract this)
  rootNotionSpaceId: null,

  // basic site info (required)
  name: '끊임없이 진화하라',
  domain: 'itpe.me',
  author: 'thinkmaniac',
  language: 'ko',

  // open graph metadata (optional)
  description: 'SAP, 제품리뷰, 테니스, 각종 팁을 공유합니다.',

  // social usernames (optional)
  // twitter: 'transitive_bs',
  github: 'itpeme',
  // linkedin: 'fisch2',
  // newsletter: '#', // optional newsletter URL
  // youtube: '#', // optional youtube channel name or `channel/UCGbXXXXXXXXXXXXXXXXXXXXXX`

  // default notion icon and cover images for site-wide consistency (optional)
  // page-specific values will override these site-wide defaults
  defaultPageIcon: null,
  defaultPageCover: null,
  defaultPageCoverPosition: 0.5,

  // whether or not to enable support for LQIP preview images (optional)
  // Cloudflare Workers에서는 sharp(lqip-modern)를 쓸 수 없어 끈다
  isPreviewImageSupportEnabled: false,

  // whether or not redis is enabled for caching generated preview images (optional)
  // NOTE: if you enable redis, you need to set the `REDIS_HOST` and `REDIS_PASSWORD`
  // environment variables. see the readme for more info
  isRedisEnabled: false,

  // map of notion page IDs to URL paths (optional)
  // any pages defined here will override their default URL paths
  // example:
  //
  // pageUrlOverrides: {
  //   '/foo': '067dd719a912471ea9a3ac10710e7fdf',
  //   '/bar': '0be6efce9daf42688f65c76b89f8eb27'
  // }
  // URL에 노션 ID를 붙이지 않고 Slug만 사용 (개발/운영 동일하게 동작)
  includeNotionIdInUrls: false,

  pageUrlOverrides: null,

  // whether to use the default notion navigation style or a custom one with links to
  // important pages
  navigationStyle: 'custom',
  navigationLinks: [
    {
      title: '소개',
      pageId: '3ed45f955e1681599dc4c2b84149228c',
    },
    {
      // 문의 폼 링크는 여기 한 곳에서만 관리 (다른 폼 서비스로 바꿀 때 이 URL만 교체)
      title: '문의',
      url: 'https://elastic-harp-7d4.notion.site/609b96b48a6b442d8bed3e340020cbab',
    },
    {
      title: '갤러리',
      pageId: '3f045f955e1681dd9e13e2d7a271634c',
    },
    {
      title: '카테고리',
      pageId: '3ed45f955e168180bebef2a835ca6790',
      menuPage: true,
    },
  ],

  // 푸터 링크 (페이지는 pageId, 외부 링크는 url)
  footerLinks: [
    {
      title: '소개',
      pageId: '3ed45f955e1681599dc4c2b84149228c',
    },
    {
      title: '문의',
      url: 'https://elastic-harp-7d4.notion.site/609b96b48a6b442d8bed3e340020cbab',
    },
    {
      title: '갤러리',
      pageId: '3f045f955e1681dd9e13e2d7a271634c',
    },
    {
      title: '개인정보처리방침',
      pageId: '3ed45f955e16818ab938cfc8e4daa1d9',
    },
  ],

  // -------- custom configs (2skydev) -------------

  // date-fns format string
  dateformat: 'yyyy년 MM월 dd일',

  // post page - hidden properties
  hiddenPostProperties: ['설명', '상태', '최하위 정렬', 'Slug', '인기', '추천'],

  // contentPosition (table of contents) text align
  contentPositionTextAlign: 'left',

  // default theme color
  defaultTheme: 'system',

  // enable comment
  // 댓글 보강(페이지 검증, 스팸 방어) 완료 전까지 비활성화 - docs/blog_design.md §4
  enableComment: false,
});
