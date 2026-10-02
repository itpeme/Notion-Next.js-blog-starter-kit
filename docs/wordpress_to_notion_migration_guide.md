# WordPress에서 Next.js \+ Notion 블로그 이전 가이드 및 작업 순서

본 문서는 기존 워드프레스(WordPress) 호스팅 기반의 블로그를 노션(Notion)을 CMS로 활용하고 Next.js 및 Vercel로 호스팅하는 정적/ISR 기반 블로그로 이전하기 위한 작업 가이드입니다.

---

## 1\. 아키텍처 및 요구사항 정의

### 1.1 시스템 아키텍처

- **CMS (콘텐츠 관리)**: Notion (데이터베이스 기반 포스트 관리)  
- **프론트엔드 / 빌드 엔진**: Next.js (ISR: Incremental Static Regeneration 기반)  
- **오픈소스 베이스**: [transitive-bullshit/nextjs-notion-starter-kit](https://github.com/transitive-bullshit/nextjs-notion-starter-kit) 및 [2skydev/Notion-Next.js-blog-starter-kit](https://github.com/2skydev/Notion-Next.js-blog-starter-kit)  
- **호스팅 및 배포**: Vercel (CI/CD, 전역 CDN, 무료 SSL 제공)

### 1.2 핵심 요구사항 및 기술 해결 전략

1. **수백 개 포스트 및 이미지 마이그레이션**:  
   - `wordpress-export-to-markdown` CLI를 통한 일괄 XML 파싱, 이미지 로컬 다운로드, 마크다운 변환.  
   - 노션 대량 임포트 및 스타터킷 내 이미지 프록시/Next.js Image 캐싱 활용(노션 AWS S3 임시 URL 만료 방지).  
2. **커스텀 도메인 승계 및 SEO 유지**:  
   - 기존 워드프레스 슬러그(Slug)를 노션 데이터베이스의 Slug 속성과 1:1 매칭.  
   - 고유주소(Permalink) 구조 변경 시 `next.config.js`의 `redirects`를 통한 301 영구 리디렉션 설정.  
   - Vercel DNS A/CNAME 레코드 연동.  
3. **구글 애널리틱스(GA4) 및 애드센스(AdSense) 유지**:  
   - GA4: `site.config.ts`의 `googleAnalyticsId` 설정.  
   - 애드센스: `public/ads.txt` 배치, `pages/_document.tsx`에 스크립트 삽입, 광고 단위 컴포넌트 배치.

---

## 2\. 전체 작업 순서도 (Action Checklist)

\[Phase 1: 사전 준비 및 기반 환경 구축\]

  ├── 1.1 GitHub, Vercel, Notion 계정 확인 및 템플릿 레포지토리 Fork

  ├── 1.2 노션 블로그 루트 페이지 및 데이터베이스 테이블 생성

  └── 1.3 기본 설정값(site.config.ts) 매핑 및 1차 Vercel 배포 테스트

\[Phase 2: 애드센스 & GA4 & 부가 기능 커스터마이징\]

  ├── 2.1 public/ads.txt 파일 추가

  ├── 2.2 pages/\_document.tsx 에 Google AdSense 스크립트 추가

  ├── 2.3 광고 단위(Ad Unit) React 컴포넌트 생성 및 레이아웃 배치

  └── 2.4 site.config.ts 에 GA4 측정 ID 및 사이트 메타데이터 반영

\[Phase 3: 워드프레스 데이터 마이그레이션\]

  ├── 3.1 워드프레스 전체 XML 백업 다운로드

  ├── 3.2 wordpress-export-to-markdown 으로 Markdown \+ 이미지 일괄 추출

  ├── 3.3 노션에 Markdown 일괄 가져오기 (Import)

  └── 3.4 노션 데이터베이스 속성(Slug, Date, Tag, Status) 검증 및 정리

\[Phase 4: SEO 최적화 및 리디렉션 세팅\]

  ├── 4.1 기존 고유주소(Permalink) 분석

  └── 4.2 next.config.js 에 필요 시 301 리디렉션 규칙 작성

\[Phase 5: 커스텀 도메인 연결 및 최종 검증\]

  ├── 5.1 Vercel에 커스텀 도메인 등록

  ├── 5.2 DNS 레코드 변경 (A / CNAME)

  ├── 5.3 Google Search Console 및 Naver Search Advisor에 새 sitemap.xml 제출

  └── 5.4 광고 송출, GA4 실시간 유입, 리디렉션 최종 확인

---

## 3\. 단계별 세부 작업 가이드

### Phase 1: 기반 환경 구축

1. **GitHub 저장소 준비**:  
   - [2skydev/Notion-Next.js-blog-starter-kit](https://github.com/2skydev/Notion-Next.js-blog-starter-kit) 접속 후 **Fork** 실행.  
2. **노션 데이터베이스 세팅**:  
   - 노션에 새 페이지 생성 후 데이터베이스(테이블 보기) 생성.  
   - 필수 컬럼 설정:  
     - `Name` (제목, Title)  
     - `Slug` (고유 URL 주소, Text)  
     - `Status` (게시 상태, Select: `Published`, `Draft`)  
     - `Date` (발행일, Date)  
     - `Tags` (태그/카테고리, Multi-select)  
   - 노션 페이지 우측 상단 `공유(Share) > 웹에 공유(Share to web)` 활성화.  
   - 공개 링크 주소에서 32자리 `Page ID` 추출.  
3. **`site.config.ts` 기본 설정**:  
   - `rootNotionPageId`: 위에서 추출한 노션 32자리 Page ID 입력.  
   - `name`, `domain`, `author`, `description` 기본 정보 수정.  
4. **Vercel 초기 연동**:  
   - Vercel에 접속하여 Fork한 GitHub 저장소를 Import 후 Deploy (빌드 성공 여부 확인).

---

### Phase 2: GA4 및 애드센스 연동

1. **`public/ads.txt` 배치**:  
   - 기존 워드프레스 루트의 `ads.txt` 내용을 `public/ads.txt`로 저장.

   

   google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0

   

2. **`pages/_document.tsx` 수정 (애드센스 스크립트)**:  
   - `<Head>` 태그 내부에 AdSense 자동 광고 스크립트 추가:

   

   \<script

   

     async

   

     src="https\://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX"

   

     crossOrigin="anonymous"

   

   /\>

   

3. **애드센스 단위 광고 컴포넌트 (`components/AdSense.tsx`)**:  
     
   import { useEffect } from 'react'  
     
   interface AdSenseProps {  
     
     slot: string  
     
     format?: string  
     
     responsive?: string  
     
   }  
     
   export const AdSense \= ({ slot, format \= 'auto', responsive \= 'true' }: AdSenseProps) \=\> {  
     
     useEffect(() \=\> {  
     
       try {  
     
         // @ts-ignore  
     
         ;(window.adsbygoogle \= window.adsbygoogle || \[\]).push({})  
     
       } catch (err) {  
     
         console.error(err)  
     
       }  
     
     }, \[\])  
     
     return (  
     
       \<div style={{ margin: '20px 0', textAlign: 'center' }}\>  
     
         \<ins  
     
           className="adsbygoogle"  
     
           style={{ display: 'block' }}  
     
           data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"  
     
           data-ad-slot={slot}  
     
           data-ad-format={format}  
     
           data-full-width-responsive={responsive}  
     
         /\>  
     
       \</div\>  
     
     )  
     
   }  
     
   - 필요 위치(예: 포스트 본문 상단/하단)에 배치.  
4. **구글 애널리틱스(GA4)**:  
   - `site.config.ts` 파일 내 `googleAnalyticsId: 'G-XXXXXXXXXX'` 입력.

---

### Phase 3: 워드프레스 포스트 & 이미지 마이그레이션

1. **워드프레스 XML 내보내기**:  
   - 워드프레스 관리자 \> `도구(Tools)` \> `내보내기(Export)` \> '모든 콘텐츠' 선택 후 XML 파일 다운로드.  
2. **마크다운 및 이미지 변환 실행**:  
   - Node.js 환경에서 아래 명령어 실행:

   

   npx wordpress-export-to-markdown

   

   - 프롬프트에 따라 다운로드한 XML 파일 경로를 지정하고, 이미지 저장 폴더 옵션을 활성화합니다.  
   - 변환 완료 시 각 포스트별 `.md` 파일과 다운로드된 로컬 이미지가 생성됩니다.  
3. **노션으로 가져오기 (Import)**:  
   - 노션 좌측 하단 `설정 > 가져오기(Import) > 마크다운(Markdown & CSV)` 선택.  
   - 변환된 마크다운 파일들을 가져온 뒤, 생성된 페이지들을 블로그 데이터베이스 테이블로 이동.  
   - 기존 메타데이터(Frontmatter의 slug, date, tags 등)가 노션 속성 컬럼과 일치하도록 정리.

---

### Phase 4: SEO 유지 및 301 리디렉션

- 기존 워드프레스 URL이 날짜 형식을 포함하고 있었을 경우(예: `/2023/05/my-post-title/`), `next.config.js`에 리디렉션 규칙을 추가하여 기존 백링크 및 검색 트래픽 유실을 방지합니다:

// next.config.js

module.exports \= {

  async redirects() {

    return \[

      {

        source: '/:year/:month/:slug',

        destination: '/:slug',

        permanent: true, // 301 Redirect

      },

    \]

  },

}

---

### Phase 5: 커스텀 도메인 전환 및 마무리

1. **Vercel 도메인 추가**:  
   - Vercel 프로젝트 설정 \> `Domains`에서 도메인 추가 (예: `example.com` 또는 `blog.example.com`).  
2. **DNS 레코드 설정**:  
   - **루트 도메인 (`example.com`)**: `A` 레코드 → `76.76.21.21`  
   - **서브 도메인 (`blog.example.com`)**: `CNAME` 레코드 → `cname.vercel-dns.com`  
3. **검색 포털 사이트맵 갱신**:  
   - 도메인 DNS 전파 완료 후 `https://yourdomain.com/sitemap.xml` 접속 확인.  
   - Google Search Console 및 Naver Search Advisor에 새 사이트맵 등록.  
4. **최종 점검**:  
   - 기존 주요 글 URL 접속 시 301 리디렉션 정상 동작 여부.  
   - 애드센스 광고 단위 노출 및 `domain.com/ads.txt` 접근 가능 여부.  
   - GA4 실시간 유입 트래픽 기록 확인.