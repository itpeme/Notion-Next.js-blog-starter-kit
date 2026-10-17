/**
 * 빌드 때 만들어진 ISR 캐시(.open-next/cache)를 원격 R2 버킷에 올린다.
 *
 * `opennextjs-cloudflare deploy`에 내장된 같은 단계는 Workers Builds(API 토큰 인증)와 Windows에서
 * 인증 확인(`wrangler auth token`)에 실패하므로, 같은 키 규칙으로 `wrangler r2 object put`을 직접 호출한다.
 * 실패해도 배포는 계속한다 (캐시가 비어 있으면 첫 요청 때 서버에서 만들어 R2에 저장된다).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import pMap from 'p-map';

const BUCKET = 'itpe-blog-opennext-cache';
const concurrency = Number(process.env.R2_CACHE_UPLOAD_CONCURRENCY || 4);

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
  throw new Error('R2_CACHE_UPLOAD_CONCURRENCY must be an integer between 1 and 8');
}

const root = process.cwd();
const require = createRequire(import.meta.url);
const wranglerPackage = require.resolve('wrangler/package.json');
const wranglerCli = path.resolve(path.dirname(wranglerPackage), 'bin/wrangler.js');

// 사이트맵/피드는 빌드 중(lib/generate-static-feeds.ts)에 public/ 로 떨어지고 여기까지 복사돼야 한다.
// 조용히 빠지면 robots.txt 가 가리키는 /sitemap.xml 이 404 인 채로 배포되므로 그 전에 멈춘다.
const requiredAssets = ['sitemap.xml', 'feed.xml'];
const missing = requiredAssets.filter(
  name => !fs.existsSync(path.join(root, '.open-next/assets', name)),
);

if (missing.length) {
  console.error(
    `정적 자산이 없습니다: ${missing.join(', ')}
` + '빌드 로그에서 "[static-feeds]" 줄을 확인하세요 (노션 크롤링이 실패하면 생성되지 않습니다).',
  );
  process.exit(1);
}

const dist = path.join(root, 'node_modules/@opennextjs/cloudflare/dist');
const { getCacheAssets } = await import(
  pathToFileURL(path.join(dist, 'cli/commands/populate-cache.js')).href
);
const { computeCacheKey } = await import(
  pathToFileURL(path.join(dist, 'api/overrides/internal.js')).href
);

const assets = getCacheAssets({ outputDir: path.join(root, '.open-next') });
const uploads = assets.map(asset => ({
  file: asset.fullPath,
  key: computeCacheKey(asset.key, {
    buildId: asset.buildId,
    cacheType: asset.isFetch ? 'fetch' : 'cache',
  }),
}));

// 업로드 계획만 확인할 때 사용한다. 원격 요청이나 Wrangler 프로세스를 실행하지 않는다.
if (process.argv.includes('--dry-run')) {
  console.log(`R2 cache upload plan: ${uploads.length} files, concurrency ${concurrency}`);
  for (const upload of uploads.slice(0, 3)) console.log(`${BUCKET}/${upload.key}`);
  process.exit(0);
}

const startedAt = performance.now();
let uploaded = 0;
let completed = 0;

console.log(`R2 cache upload starting: ${uploads.length} files, concurrency ${concurrency}`);

// 파일마다 npx를 시작하고 순서대로 기다리는 비용을 줄인다. Notion 조회 동시성에는 영향이 없다.
await pMap(
  uploads,
  async ({ file, key }) => {
    const result = await new Promise(resolve => {
      const child = spawn(
        process.execPath,
        [wranglerCli, 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file, '--remote'],
        { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', chunk => {
        stdout = (stdout + chunk).slice(-1000);
      });
      child.stderr.on('data', chunk => {
        stderr = (stderr + chunk).slice(-1000);
      });
      child.on('error', error => {
        stderr = error.message;
      });
      child.on('close', code => resolve({ ok: code === 0, detail: stderr || stdout }));
    });

    if (result.ok) {
      uploaded++;
    } else {
      console.warn('R2 upload failed:', key, result.detail.slice(-300));
    }

    completed++;
    if (completed % 25 === 0 || completed === uploads.length) {
      console.log(`R2 cache progress: ${completed}/${uploads.length}`);
    }
  },
  { concurrency },
);

const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
console.log(`R2 cache populated: ${uploaded}/${uploads.length} in ${seconds}s`);
