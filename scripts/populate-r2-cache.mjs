/**
 * 빌드 때 만들어진 ISR 캐시(.open-next/cache)를 원격 R2 버킷에 올린다.
 *
 * `opennextjs-cloudflare deploy`에 내장된 같은 단계는 Workers Builds(API 토큰 인증)와 Windows에서
 * 인증 확인(`wrangler auth token`)에 실패하므로, 같은 키 규칙으로 `wrangler r2 object put`을 직접 호출한다.
 * 실패해도 배포는 계속한다 (캐시가 비어 있으면 첫 요청 때 서버에서 만들어 R2에 저장된다).
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const BUCKET = 'itpe-blog-opennext-cache';

const root = process.cwd();
const dist = path.join(root, 'node_modules/@opennextjs/cloudflare/dist');
const { getCacheAssets } = await import(
  pathToFileURL(path.join(dist, 'cli/commands/populate-cache.js')).href
);
const { computeCacheKey } = await import(
  pathToFileURL(path.join(dist, 'api/overrides/internal.js')).href
);

const assets = getCacheAssets({ outputDir: path.join(root, '.open-next') });
let uploaded = 0;

for (const asset of assets) {
  const key = computeCacheKey(asset.key, {
    buildId: asset.buildId,
    cacheType: asset.isFetch ? 'fetch' : 'cache',
  });
  const result = spawnSync(
    'npx',
    ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', asset.fullPath, '--remote'],
    { shell: true, encoding: 'utf8' },
  );

  if (result.status === 0) {
    uploaded++;
  } else {
    console.warn('R2 upload failed:', key, (result.stderr || result.stdout || '').slice(-300));
  }
}

console.log(`R2 cache populated: ${uploaded}/${assets.length}`);
