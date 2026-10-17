/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS 설정과 공유하며 Node 모듈은 빌드에서만 읽는다. */
// next.config.js와 서버 코드에서 함께 사용한다. 경로는 빌드 프로세스에만 전달하고
// next.config.env나 public/에 넣지 않아 운영 번들과 Cloudflare 빌드 캐시에 원본이 포함되지 않게 한다.
const inFlight = new Map();
let hits = 0;
let fetches = 0;
let reportRegistered = false;

function initializeNotionBuildCache() {
  // Next.js가 만든 자식 프로세스는 부모의 디렉터리를 그대로 사용한다.
  if (process.env.NOTION_BUILD_CACHE_DIR) return;

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itpe-notion-build-'));
  process.env.NOTION_BUILD_CACHE_DIR = directory;

  process.once('exit', () => {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch {
      // 강제 종료 등으로 정리하지 못해도 다음 빌드는 새 디렉터리를 사용한다.
    }
  });
}

function cacheFile(namespace, key) {
  const directory = process.env.NOTION_BUILD_CACHE_DIR;
  if (process.env.NODE_ENV !== 'production' || !directory) return null;

  const { createHash } = require('node:crypto');
  const path = require('node:path');
  const hash = createHash('sha256').update(key).digest('hex');
  return path.join(directory, `${namespace}-${hash}.json`);
}

function readBuildCache(namespace, key) {
  const file = cacheFile(namespace, key);
  if (!file) return null;

  try {
    // 매번 파싱한 복사본을 반환하므로 게시 필터·본문 축소가 저장된 원본을 수정하지 않는다.
    return JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeBuildCache(namespace, key, value) {
  const file = cacheFile(namespace, key);
  if (!file) return;

  const fs = require('node:fs');
  const { randomUUID } = require('node:crypto');
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch {
    // 저장 실패는 원래 Notion 조회 동작을 막지 않는다.
    try {
      fs.unlinkSync(temporary);
    } catch {
      // 임시 파일을 만들지 못했거나 이미 정리된 경우.
    }
  }
}

// 옵션의 기본값과 키 순서를 맞춰 같은 조회만 재사용한다. 간략한 메뉴 조회와
// 전체 본문 조회, 초안 조회 등 결과가 다른 요청은 별도 항목으로 저장한다.
function pageCacheKey(pageId, options) {
  const normalized = {
    concurrency: options.concurrency ?? 3,
    fetchMissingBlocks: options.fetchMissingBlocks ?? true,
    fetchCollections: options.fetchCollections ?? true,
    signFileUrls: options.signFileUrls ?? true,
    chunkLimit: options.chunkLimit ?? 100,
    chunkNumber: options.chunkNumber ?? 0,
    draftView: options.draftView ?? false,
    gotOptions: options.gotOptions,
  };
  return JSON.stringify(
    [process.env.NOTION_API_BASE_URL, pageId.replace(/-/g, '').toLowerCase(), normalized],
    (_key, value) => {
      if (!value || Array.isArray(value) || typeof value !== 'object') return value;
      return Object.keys(value)
        .sort()
        .reduce((sorted, key) => ({ ...sorted, [key]: value[key] }), {});
    },
  );
}

async function withBuildPageCache(pageId, options, load) {
  const key = pageCacheKey(pageId, options);
  const file = cacheFile('page', key);
  // 개발·운영 중에는 기존처럼 조회한다. 빌드용 환경변수는 Wrangler에 등록하지 않는다.
  if (!file) return load();

  if (!reportRegistered) {
    reportRegistered = true;
    process.once('exit', () => {
      console.log(`[notion-build-cache] pages: ${hits} reused, ${fetches} fetched`);
    });
  }

  const cached = readBuildCache('page', key);
  if (cached?.block) {
    hits++;
    return cached;
  }

  // 같은 프로세스의 동시 요청은 하나의 조회를 기다린 뒤 각자 복사본을 받는다.
  let pending = inFlight.get(file);
  if (pending) {
    hits++;
  } else {
    fetches++;
    pending = (async () => {
      const value = await load();
      if (value?.block) writeBuildCache('page', key, value);
      return JSON.stringify(value);
    })();
    inFlight.set(file, pending);
  }

  try {
    return JSON.parse(await pending);
  } finally {
    // 실패한 조회는 캐시에 남기지 않아 다음 호출에서 다시 시도할 수 있다.
    if (inFlight.get(file) === pending) inFlight.delete(file);
  }
}

module.exports = {
  initializeNotionBuildCache,
  readBuildCache,
  writeBuildCache,
  withBuildPageCache,
};
