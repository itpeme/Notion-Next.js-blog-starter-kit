/** 빌드 후 실행: node scripts/content-refresh.integration.mjs [--live-notion]
 * workerd와 격리된 로컬 R2에서 실제 Next.js HTML/JSON 캐시 전환을 검증한다.
 * --live-notion은 Durable Object alarm의 실제 공개 Notion 수집까지 검증한다.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestHarness } from 'wrangler';

const root = process.cwd();
const snapshot = path.join(root, 'public/_blog-data');
const index = JSON.parse(await fs.readFile(path.join(snapshot, 'index.json'), 'utf8'));
const prefix = `integration/${randomUUID()}`;
const secret = randomUUID() + randomUUID();
const server = createTestHarness({
  root,
  workers: [
    {
      configPath: './wrangler.jsonc',
      vars: { BLOG_CONTENT_PREFIX: prefix },
      secrets: { ADMIN_REFRESH_SECRET: secret },
    },
  ],
});

try {
  await server.listen();
  const worker = server.getWorker();
  const env = await worker.getEnv();
  const bucket = env.NEXT_INC_CACHE_R2_BUCKET;
  async function check(url, expected = 200, init) {
    const response = await worker.fetch(url, init);
    const body = await response.text();
    assert.equal(response.status, expected, `${url}: ${body.slice(0, 400)}`);
    return { response, body };
  }
  const headers = { Authorization: `Bearer ${secret}` };
  const newId = randomUUID();
  const newSlug = `갱신-검증.${Date.now()}`;
  const encoded = encodeURIComponent(newSlug);
  const originalId = index.canonicalPageMap['9'];
  const props = JSON.parse(
    await fs.readFile(path.join(snapshot, `pages/${originalId.replace(/-/g, '')}.json`), 'utf8'),
  );
  const newProps = structuredClone(props);
  const main = newProps.recordMap.block[originalId];
  delete newProps.recordMap.block[originalId];
  main.value.id = newId;
  const schema = newProps.recordMap.collection[main.value.parent_id].value.schema;
  const slugKey = Object.keys(schema).find(key => schema[key].name?.toLowerCase() === 'slug');
  main.value.properties[slugKey] = [[newSlug]];
  main.value.properties.title = [['관리자 갱신 통합 검증 글']];
  newProps.pageId = newId;
  newProps.recordMap.block = { [newId]: main, ...newProps.recordMap.block };
  for (const entry of Object.values(newProps.recordMap.block)) {
    if (entry.value?.parent_id === originalId) entry.value.parent_id = newId;
  }
  console.log('Checking bootstrap pages and authentication');
  await check('/admin');
  await check('/');
  await check('/9');
  await check('/소개');
  await check(`/${encoded}`, 404);
  await check('/api/admin/refresh', 401, { method: 'POST' });
  for (const url of [
    '/_blog-data/index.json',
    '/%5Fblog-data%2Findex.json',
    '/_blog-data/pages/x.json',
  ])
    await check(url, 404);

  const buildId = (await fs.readFile(path.join(root, '.next/BUILD_ID'), 'utf8')).trim();
  async function publishFixture(includePost) {
    const revision = randomUUID();
    const base = `${prefix}/revisions/${revision}`;
    for (const file of await fs.readdir(path.join(snapshot, 'pages'))) {
      let saved = JSON.parse(await fs.readFile(path.join(snapshot, 'pages', file), 'utf8'));
      if (includePost && file === `${index.rootPageId}.json`) {
        saved.recordMap.block[newId] = structuredClone(main);
        const views = Object.values(saved.recordMap.collection_query[main.value.parent_id]);
        for (const view of views)
          if (view.collection_group_results?.blockIds)
            view.collection_group_results.blockIds.unshift(newId);
      }
      await bucket.put(`${base}/pages/${file}`, JSON.stringify(saved));
    }
    await bucket.put(`${base}/pages/${newId.replace(/-/g, '')}.json`, JSON.stringify(newProps));
    const nextIndex = structuredClone(index);
    if (includePost) nextIndex.canonicalPageMap[newSlug] = newId;
    await bucket.put(`${base}/index.json`, JSON.stringify(nextIndex));
    for (const name of ['sitemap.xml', 'feed.xml'])
      await bucket.put(`${base}/${name}`, `<test>${includePost ? encoded : 'removed'}</test>`);
    await bucket.put(
      `${prefix}/current.json`,
      JSON.stringify({
        revision,
        updatedAt: new Date().toISOString(),
        pageCount: 144,
        postCount: 132,
      }),
    );
    return revision;
  }
  console.log('Publishing new address without a rebuild');
  const revision = await publishFixture(true);
  const post = await check(`/${encoded}`);
  assert.equal(post.response.headers.get('X-Blog-Revision'), revision);
  assert.ok(post.body.includes('관리자 갱신 통합 검증 글'));
  assert.ok(post.body.includes(buildId), 'same Next.js build');
  const home = await check('/');
  assert.ok(home.body.includes('관리자 갱신 통합 검증 글'), 'home list refreshes');
  const data = await check(`/_next/data/${buildId}/${encoded}.json`);
  assert.equal(JSON.parse(data.body).pageProps.pageId, newId);
  for (const name of ['sitemap.xml', 'feed.xml'])
    assert.ok((await check(`/${name}`)).body.includes(encoded));
  await check('/소개');
  console.log('Removing published address without a rebuild');
  await publishFixture(false);
  await check(`/${encoded}`, 404);
  await check(`/_next/data/${buildId}/${encoded}.json`, 404);

  if (process.argv.includes('--live-notion')) {
    console.log('Starting real Notion refresh through authenticated Durable Object alarm');
    const started = await check('/api/admin/refresh', 202, { method: 'POST', headers });
    const job = JSON.parse(started.body);
    assert.equal(
      JSON.parse((await check('/api/admin/refresh', 202, { method: 'POST', headers })).body).id,
      job.id,
    );
    const deadline = Date.now() + 15 * 60 * 1000;
    let lastProgress;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const status = JSON.parse((await check('/api/admin/refresh', 200, { headers })).body);
      const progress = `${status.state}: ${status.completed}/${status.total || '?'}`;
      if (lastProgress !== progress) {
        console.log(progress);
        lastProgress = progress;
      }
      assert.notEqual(status.state, 'failed', status.error);
      if (status.state === 'complete') {
        assert.equal(
          (await check('/')).response.headers.get('X-Blog-Revision'),
          status.published.revision,
        );
        for (const name of ['sitemap.xml', 'feed.xml'])
          assert.ok((await check(`/${name}`)).body.includes('https://itpe.me/'));
        console.log(
          `Real refresh complete: ${status.published.pageCount} pages, ${status.published.postCount} posts`,
        );
        break;
      }
      if (Date.now() >= deadline - 3000) throw new Error('Refresh timed out');
    }
  }
  console.log(
    'PASS: HTML, client navigation JSON, home, XML, private assets, and cache revision switch',
  );
} finally {
  const errors = server.getLogs().filter(log => log.level === 'error');
  if (errors.length) console.error(errors);
  await server.close();
}
