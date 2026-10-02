# itpe.me 블로그 설계 (Notion 신규 시작)

> 이 문서는 [wordpress_to_notion_migration_guide.md](./wordpress_to_notion_migration_guide.md)를 대체한다.
> 전제가 "자동 마이그레이션"에서 "Notion에서 새로 시작, 과거 글은 수기 입력"으로 바뀌었다.
> 이전 가이드의 XML 변환·임포트·이미지 이전 파이프라인은 **모두 폐기**한다.

## 0. 확정된 결정

| 항목 | 결정 |
|---|---|
| 방식 | Notion 신규 시작. 과거 글은 운영자가 수기 입력 |
| 도메인 | `itpe.me` 유지 (DNS 전환) |
| 방문자 참여 | **글 댓글** + **노션 폼 문의**. 공개 게시판 없음 |
| 기존 댓글, KBoard | 이전하지 않음 (백업만 보관) |
| 광고 | AdSense 계속 사용 |
| 노션 속성 | 한글 규약 유지 (`Slug`, `Published`만 코드가 영문명으로 읽음) |

## 1. 기능 판단 요약

| 기능 | 상태 | 비고 |
|---|---|---|
| 글 작성·게시(ISR) | 구현됨 | `revalidate: 10` |
| 검색 | 구현됨 | `api/search-notion` (비공식 API 의존, 최근 수정 이력 있음) |
| 댓글 | 구현됨, **보강 필요** | §4 |
| RSS / sitemap / robots / OG 이미지 | 구현됨 | `/feed` 경로 확인 필요 |
| 다크모드, 목차, LQIP | 구현됨 | |
| 문의 | 노션 폼으로 해결 | 코드 변경 거의 없음 |
| 게시 상태 필터 | **미구현, 필수** | §3 |
| AdSense | **미구현** | §5 |
| 공개 게시판, 로그인 | 불가·제외 | 정적 사이트 + 노션으로는 안전하게 불가 |

## 2. 노션 구조와 DB 스키마

```
루트 페이지 (rootNotionPageId)
├── 블로그 DB (글)
├── 카테고리 페이지 (navigationLinks 대상)
└── 소개 / 정책 페이지 (개인정보처리방침 등)
문의 폼 DB   ← 루트 하위에 두지 않는다 (사이트맵·피드 노출 방지)
```

블로그 DB 속성:

| 속성 | 타입 | 용도 |
|---|---|---|
| `이름` | Title | 제목 |
| `Slug` | Text | URL. 코드가 `slug`/`Slug`로 읽음. **한글 슬러그는 디코딩된 원문 저장**, 숫자 슬러그도 텍스트로 |
| `Published` | Date | 발행일. 피드가 읽음 |
| `설명` | Text | meta description. 피드가 읽음 |
| `상태` | Select: `공개`/`비공개` | 게시 제어 (§3) |
| `카테고리` | Select | 대분류 |
| `하위 카테고리` | Select | 소분류 (§13-1) |
| `태그` | Multi-select | 태그 |

- `hiddenPostProperties`에 `상태`, `설명`을 유지한다. (`최하위 정렬`은 원작자용이므로 사용 여부 확인 후 정리)
- 과거 글 수기 입력 시 **기존 URL 슬러그를 그대로 `Slug`에 입력**하면 리디렉션 없이 SEO가 유지된다 (§6).

## 3. 게시 상태 필터 (구현 완료)

`상태`가 `공개`가 아닌 글(글 DB에 `상태` 속성이 있을 때만 적용)은 아래에서 모두 제외한다. 구현은 [lib/post-status.ts](../lib/post-status.ts).

- 사이트맵·피드·정적 경로: [lib/get-site-map.ts](../lib/get-site-map.ts)에서 제외
- 슬러그 또는 노션 ID로 직접 접근: [lib/resolve-notion-page.ts](../lib/resolve-notion-page.ts)에서 404
- 루트·카테고리 페이지의 목록(컬렉션 뷰)과 페이지 데이터: 숨김 글과 그 본문 블록 제거
- 검색 결과: [lib/notion.ts](../lib/notion.ts)에서 제외 (비공개 목록은 5분 캐시)
- `/draftview`: 운영 환경에서는 404. 로컬에서 비공개 글을 미리 보려면 `SHOW_DRAFTS=true`로 실행
- `상태`가 비어 있는 글도 비공개로 취급한다 (공개로 명시한 글만 노출)

한계: 노션의 "웹에 게시"는 하위 페이지도 `notion.site` 주소로 공개한다. 비공개 글의 `notion.site` 주소를 알면 노션에서 직접 열 수 있으므로, **민감한 내용은 블로그 DB에 두지 않는다**.

## 4. 댓글 (보강 코드 구현 완료, 계정 연동은 대기)

[pages/api/comments/[id].ts](../pages/api/comments/[id].ts), [components/Comments/Comments.tsx](../components/Comments/Comments.tsx).

동작: 방문자가 입력하면 서버가 통합(Integration) 토큰으로 노션 페이지 댓글을 만든다. 로그인 없이 쓸 수 있고 화면에는 "익명"으로 보인다. 운영자가 노션에서 직접 답하면 소유자 표시로 나온다.

구현된 보강:
- **대상 검증** ([lib/comment-guard.ts](../lib/comment-guard.ts)): 루트 페이지 아래 글 DB의 **공개 글**만 허용. 문의 DB, 비공개 글, 임의 페이지 ID는 404
- **입력 검증**: 2,000자 제한, 링크 3개 이상 거부, 공백 거부
- **요청 제한** ([lib/rate-limit.ts](../lib/rate-limit.ts)): IP당 10분에 5회. 저장소는 lib/db (Redis를 켜지 않으면 서버 인스턴스별 메모리)
- **허니팟**: 숨김 입력란이 채워지면 봇으로 보고 성공처럼 응답만 하고 저장하지 않음
- **Origin 검사**: 다른 사이트에서 보낸 POST는 403
- **응답 최소화**: 목록 조회 시 화면에 필요한 필드만 반환, 에러 상세는 노출하지 않음
- **Turnstile** ([lib/turnstile.ts](../lib/turnstile.ts)): `TURNSTILE_SECRET_KEY`(서버)와 `NEXT_PUBLIC_TURNSTILE_SITE_KEY`(클라이언트)가 있으면 활성화, 없으면 건너뜀
- **이메일 알림** ([lib/notify-comment.ts](../lib/notify-comment.ts)): `RESEND_API_KEY`, `COMMENT_NOTIFY_TO`(, `COMMENT_NOTIFY_FROM`)가 있으면 발송, 없으면 건너뜀. 실패해도 댓글 등록은 성공 처리

켜는 순서(나중에): Cloudflare Turnstile 키 발급 → Resend 키 발급 → Vercel 환경변수 등록 → `site.config.ts`의 `enableComment`를 `true`로.

남은 한계:
- 노션 API 특성상 댓글 삭제는 노션에서 수동. 스팸은 노션 화면에서 지운다
- 메모리 기반 요청 제한은 서버리스에서 인스턴스마다 따로 센다. 엄격히 막으려면 Redis 활성화
- 이메일을 알림으로만 쓰므로, 운영자가 노션 댓글 알림을 별도로 받는 설정은 하지 않았다

## 5. AdSense / GA4 (애드센스 코드 구현 완료, 발행자 ID 대기)

- **환경변수**(Vercel): `NEXT_PUBLIC_ADSENSE_CLIENT`(`ca-pub-숫자`), `NEXT_PUBLIC_ADSENSE_SLOT_POST`(선택, 글 하단 수동 광고 슬롯), `NEXT_PUBLIC_GA_MEASUREMENT_ID`. GA4는 `site.config.ts`가 아니라 환경변수다.
- **스크립트** ([components/AdSense.tsx](../components/AdSense.tsx)): `next/script`(`afterInteractive`)로 로드. **글 페이지(글 DB의 행)에서만** 로드하고, 홈·카테고리·소개·문의·404·에러·로딩·미리보기 화면에는 로드하지 않는다. 개발 환경에서는 광고를 불러오지 않는다.
- **광고 단위**: `AdUnit`을 글 본문 아래(댓글 위)에 둔다. 슬롯 ID가 없으면 자동 광고만 사용.
- **ads.txt** ([pages/ads.txt.tsx](../pages/ads.txt.tsx)): 발행자 ID로 `/ads.txt`를 동적 생성(`google.com, pub-…, DIRECT, f08c47fec0942fa0`). ID가 없으면 404.
- **robots.txt**: 운영 환경에서 `Mediapartners-Google`에 전체 허용 명시.
- **켜는 순서(나중에)**: 애드센스 발행자 ID 확인 → Vercel 환경변수 `NEXT_PUBLIC_ADSENSE_CLIENT` 등록 → 재배포 → 애드센스 콘솔에서 사이트 확인 → (선택) 광고 단위 생성 후 슬롯 ID 등록.
- **정책 리스크**
  - 과거 글이 줄어들면 "가치 없는 콘텐츠" 심사에 걸릴 수 있다. 초기에는 **핵심 글부터 충분히 입력한 뒤** 광고를 켠다.
  - **개인정보처리방침 페이지**를 만들어 노션에 두고 푸터에 링크한다. EEA 트래픽이 있으면 동의 관리(CMP) 필요(미구현).
  - 도메인을 유지하므로 기존 사이트 승인은 이어지지만, 전환 직후 심사 상태를 애드센스 콘솔에서 확인한다.

## 6. 도메인·URL·SEO

- 새 사이트도 `/{Slug}` 구조이므로 **같은 슬러그로 수기 입력한 글은 URL이 유지**된다.
- WP URL 샘플 분석:
  - `https://itpe.me/n8n-docker...%ea.../` → `/%postname%/` 구조. 슬러그를 디코딩해 `Slug`에 입력. Next.js가 `%eb`(소문자)와 `%EB`(대문자) 인코딩을 모두 디코딩해 매칭. 끝 `/`는 Next.js가 308로 `/x`로 정리.
  - `https://itpe.me/8/` → 정체 확인 필요(숫자 슬러그 글/페이지, 글 ID 대체, 또는 KBoard 게시글). KBoard면 폐기 대상.
- **옮기지 않는 글의 URL 처리** (색인 오류 방지):
  - 수기 입력 전까지 기존 색인된 글은 404가 된다. 전환 전에 Search Console에서 **색인된 URL 목록을 내보내** 옮길 글과 버릴 글을 구분한다.
  - 버릴 글 URL은 `redirects`로 홈 301 또는 `410`(영구 삭제) 처리. 목록이 길면 `redirects.json`을 두고 `next.config.js`에서 읽는다.
  - 영구 보존 글은 WP에서 슬러그와 발행일만이라도 먼저 옮겨 둔다.
- **고정 리디렉션**: `/feed/` → `/feed.xml`, `/wp-sitemap.xml`·`/sitemap_index.xml` → `/sitemap.xml`, `/category/*`·`/tag/*` → 해당 노션 페이지 또는 홈, `/wp-content/uploads/*`는 원본 이미지를 쓰는 외부 링크가 있다면 선택 (없으면 410).
- **KBoard 구 URL**: 패턴 확인 후 홈 또는 문의 안내로 301 / `410`. 쿼리 기반은 `has: [{ type: 'query', key: ... }]`.
- **사이트맵 재제출**: Google Search Console, Naver Search Advisor. 인증 파일을 본인 것으로 교체 (`public/naver...html` 현재는 원작자 것).

## 7. 문의 창구

- 노션 폼(별도 DB). 속성: `이름`, `이메일`, `제목`, `내용`, `접수일`.
- 폼 링크는 `navigationLinks`의 외부 링크 또는 푸터에서 **한 곳**으로 관리 → 나중에 Tally 등으로 교체 쉬움.
- 폼 DB는 블로그 루트 하위에 두지 않고, §4-1의 댓글 검증으로 접근 불가함을 보장한다.
- 스팸 방어가 약하므로 필요 시 외부 폼(Tally + 알림)으로 교체.
- 폼 접수 알림은 노션 알림을 켠다.

## 8. 코드 정리 (포크 → 내 블로그)

- [site.config.ts](../site.config.ts): `rootNotionPageId`, `domain: 'itpe.me'`, `name`, `author`, `description`, `defaultPageIcon`, `navigationLinks`(pageId), `github`
- `readme.md`, `package.json`(author, repository, contributors), `public/manifest.json`, 파비콘
- [pages/_document.tsx](../pages/_document.tsx): `lang`, 폰트, 애드센스 스크립트
- 불필요 항목 제거: `posthog`, 사용하지 않을 분석 도구
- 환경변수: `NOTION_API_KEY` ([.env](../.env)), `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `NEXT_PUBLIC_ADSENSE_CLIENT`
- 설정 점검: `includeNotionIdInUrls`는 기본 `isDev`이므로 프로덕션에서 꺼져 있음(OK)
- 의존성 정리: `@next/bundle-analyzer` 12 → 14 정렬, Node `engines`를 `>=18.17`로 수정

## 9. 리스크

1. **비공식 Notion API 의존**: 깨지면 빌드·검색이 영향받는다. 대응: 에러 모니터링, 정기 점검, `packages/*`를 직접 수정할 수 있는 현재 구조 활용.
2. **노션 의존·백업**: 월 1회 노션 워크스페이스 내보내기. 소스 저장소(Git)는 코드만이므로 콘텐츠는 노션에만 있다.
3. **AdSense**: 콘텐츠 양과 정책 (§5).
4. **SEO 하락**: 옮기지 않는 글 처리(§6)에 따라 달라짐.
5. **댓글 스팸**: §4 보강 전에는 댓글 기능을 켜지 않는다.

## 10. 구현 순서

1. 포크 정리 + 사이트 설정 교체 + Vercel 1차 배포 (`*.vercel.app`)
2. 노션 DB 구성, 샘플 글 3~5개, 렌더링 확인
3. **상태 필터** 구현 (§3)
4. **댓글 보강** (§4) — 페이지 검증, rate limit, Turnstile, 알림
5. 문의 폼 + 정책 페이지 + 푸터/메뉴 연결
6. GA4, AdSense(`ads.txt`, 스크립트), 인증 파일 교체
7. 과거 글 수기 입력(핵심 글 우선) + 리디렉션 목록 작성
8. 컷오버: TTL 낮춤 → Vercel에 `itpe.me`/`www` 추가 → DNS 전환(`A 76.76.21.21`, `www CNAME cname.vercel-dns.com`) → 사이트맵 재제출. **MX 등 이메일 레코드는 유지**, WP 호스팅은 최소 30일 유지(롤백 대비)

## 11. 검증 체크리스트

- [ ] `비공개` 글이 사이트맵·피드·검색·직접 URL에서 모두 노출되지 않음
- [ ] 댓글 API가 공개 글이 아닌 `id`를 거부 (문의 DB, 임의 페이지)
- [ ] 댓글 스팸 방어 동작 (rate limit, Turnstile)
- [ ] `/feed`, `/sitemap.xml`, `/robots.txt`, `/ads.txt` 정상
- [ ] 한글 슬러그·숫자 슬러그 접속 정상, 구 URL 샘플 301/410 확인 (`curl -I`)
- [ ] GA4 실시간 수집, 광고 노출, 문의·404 페이지에는 광고 없음
- [ ] Lighthouse SEO/성능, OG 이미지

## 12. 확정·미결 사항

확정:
- `https://itpe.me/8/`은 **글 URL**이다. 숫자 슬러그 `8`로 입력하면 URL이 유지된다. (글 ID 기반인지 슬러그가 숫자인지는 옮길 때 편집 화면의 `post=` 값으로 확인)
- 과거 글은 전체 592건 중 **필요한 글만 수기 입력**. 옮기지 않는 글은 §6의 301/410 처리.
- 다른 DNS 레코드 없음 → 컷오버 시 레코드 보존 부담 없음.
- 댓글 알림은 **노션 알림 + 이메일**. (통합이 단 댓글은 노션 알림이 가지 않을 수 있으므로 이메일 발송을 주 경로로 두고 노션 알림은 보조)

- 카테고리: **A+B 혼합** (§13). 글 DB `카테고리` 속성 + 카테고리 모음 페이지의 필터 보기
- 스팸 방어: **Cloudflare Turnstile 사용** (무료). 허니팟·rate limit 병행
- 댓글 알림 수신 이메일: 환경변수 `COMMENT_NOTIFY_TO`로 지정 (저장소에는 적지 않음)

미결:
1. 이메일 발송 수단 (Resend 무료 플랜 등 / SMTP). 발신 도메인 인증이 필요하면 `itpe.me` DNS에 레코드 추가
2. 옮길 글 선별 기준 (Search Console 트래픽·색인 기준 권장)
3. 사이트 기본 정보: 블로그 이름, 작성자 표기, 한 줄 설명, 노션 루트 페이지 ID, GitHub 계정

## 13. 카테고리 구조 비교

현재 코드 구조: 상단 메뉴의 `navigationLinks`는 노션 **페이지 1개**를 연결하는 방식이다. 글 목록은 블로그 DB의 **보기(View)** 가 보여주며, 이 포크는 보기 형태와 속성 순서가 맞아야 디자인이 맞는다(readme 3번). 초안/공개 구분도 노션 DB 보기의 필터로 목록에서 숨기는 방식이다.

| 방식 | 구성 | 장점 | 단점 |
|---|---|---|---|
| A. DB 속성 + 보기 | 글 DB에 `카테고리`(Select) 속성. 카테고리 페이지에 같은 DB의 **필터된 보기**를 카테고리 수만큼 배치 | 코드 수정 없음. 글 하나에 속성만 지정하면 자동 분류 | 카테고리 URL이 없음(전용 `/category/x` 불가). 카테고리 추가 시 보기를 수동으로 추가 |
| B. 카테고리별 페이지 | 카테고리마다 노션 페이지 + 필터된 보기. 메뉴에 각각 연결 | 카테고리 URL이 생겨 SEO·공유에 유리. 메뉴 직관적 | 페이지·보기 수동 관리 |
| C. 코드로 동적 생성 | `pages/category/[name].tsx`를 만들어 DB를 읽고 목록 생성 | 완전 자동, 정식 URL | 개발 필요. 비공식 API 의존 증가. 디자인 직접 구현 |

권장: **초기는 A+B 혼합** (카테고리 5~8개 이내). 글 DB의 `카테고리` 속성을 단일 진실로 두고, 카테고리 전용 페이지(`navigationLinks` → 카테고리 모음 페이지 1개)에 필터 보기를 둔다. 카테고리가 늘거나 URL이 필요해지면 C로 확장한다.
기존 WP `/category/x`는 해당 카테고리 페이지 또는 홈으로 301.

## 13-1. 확정 카테고리 (2레벨, 노션 속성 2개)

`카테고리`(대분류) + `하위 카테고리`(소분류). 값은 언제든 노션에서 추가할 수 있다.

| 대분류 | 하위 카테고리 | 구 WP 슬러그 |
|---|---|---|
| SAP | ABAP, BC, BSP, BW, EP, Fiori, HANA, HR, NWDS, SAPGUI, SAPUI5, SRM, VMS, WD4A, Web Intelligence, Xcelsius | `jobsap`, `jobabap`, `jobbc`, `jobbsp`, `jobbw`, `jobep`, `jobfiori`, `jobhana`, `jobhr`, `jobnwds`, `sapgui`, `jobsapui5`, `jobsrm`, `jobvms`, `jobwd4a`, `jobweb-intelligence`, `jobxcelsius` |
| AI | LLM, Service | `ai`, `ai_llm`, `ai_service` |
| Study | Colab, python | `study`, `colab`, `python` |
| ERP, Digital, Downloads, News, Notice, Review, Tennis, Thinkpad, Tip, Utility, Wordpress | (없음) | `joberp`, `digital`, `downloads`, `news`, `notice`, `review`, `tennis`, `digitalthinkpad`, `tip`, `utility`, `wordpress` |

- WP의 `Uncategorized`(13건)는 제외. 옮기는 글은 적절한 카테고리를 지정한다.
- WP 카테고리 URL(`/category/<슬러그>`)은 위 표로 새 카테고리 페이지에 301 매핑한다.
- 소분류가 많아 카테고리별 수동 보기 관리가 번거로우면 C안(동적 `/category/[name]` 페이지)을 재검토한다.

## 13-2. 노션 보기 구성 (구현 완료)

글 DB(`글`)의 보기:
1. **블로그 글** (갤러리, 첫 번째 탭이어야 함): `상태 = 공개`, `Published` 내림차순, 표시 `이름·설명·카테고리·태그·Published`
2. **관리 (전체)** (표): 비공개 글을 포함한 전체 편집용. `Published` 내림차순

이 포크는 **첫 번째 탭의 보기만** 공개 화면에 보여준다. 갤러리를 첫 번째 탭으로 옮기는 것은 노션 화면에서 직접 한다(탭을 드래그).

카테고리 페이지: 대분류 14개 각각 제목(`## SAP` 등) + 연결된 보기(목록, `상태 = 공개` AND `카테고리 = 대분류`, 표시 `하위 카테고리·Published`). 카테고리나 소개가 늘면 같은 방식으로 보기를 추가한다. 노션의 그룹(GROUP BY) 보기는 이 포크의 비공식 API 조회가 400 오류를 내서 사용하지 않는다.

코드 변경: 메뉴용 페이지 캐시 5분 TTL + 현재 페이지 데이터 우선 병합 ([lib/notion.ts](../lib/notion.ts)), 목록 위 DB 이름("글") 숨김 ([styles/custom/notion.scss](../styles/custom/notion.scss)).
