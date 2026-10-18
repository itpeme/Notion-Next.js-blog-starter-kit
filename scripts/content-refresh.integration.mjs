/** 빌드 후 실행: node scripts/content-refresh.integration.mjs [--live-notion] [--live-files]
 * workerd와 격리된 로컬 R2에서 실제 Next.js HTML/JSON 캐시 전환을 검증한다.
 * --live-notion은 Durable Object alarm의 실제 공개 Notion 수집까지 검증한다.
 * --live-files는 실제 업로드 파일의 URL 재서명과 파일 응답을 검증한다.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestHarness } from 'wrangler';

const root = process.cwd();
const snapshot = path.join(root, 'public/_blog-data');
const index = JSON.parse(await fs.readFile(path.join(snapshot, 'index.json'), 'utf8'));
const prefix = `published-content/v1/integration-${randomUUID()}`;
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
  function checkHomeLayout(body) {
    assert.ok(/class="[^"]*\bindexPage\b/.test(body), 'home layout class is preserved');
    assert.ok(/class="[^"]*\bindex-page\b/.test(body), 'home content layout is preserved');
    assert.ok(body.includes('class="home-sidebar"'), 'home sidebar is rendered');
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
  let uploaded;
  for (const file of await fs.readdir(path.join(snapshot, 'pages'))) {
    const saved = JSON.parse(await fs.readFile(path.join(snapshot, 'pages', file), 'utf8'));
    uploaded = Object.values(saved.recordMap.block).find(
      entry =>
        entry.value?.type === 'image' &&
        entry.value.properties?.source?.[0]?.[0]?.startsWith('attachment:'),
    )?.value;
    if (uploaded) break;
  }
  assert.ok(uploaded, 'a real uploaded file is available for fixture signing');
  const fileId = uploaded.id;
  const fileUrl = `/api/notion-file?${new URLSearchParams({
    pageId: newId.replace(/-/g, ''),
    blockId: fileId.replace(/-/g, ''),
  })}`;
  newProps.recordMap.block[fileId] = {
    value: {
      ...structuredClone(uploaded),
      type: 'file',
      parent_id: newId,
      parent_table: 'block',
      properties: { source: uploaded.properties.source, title: [['유효기간 검증 첨부파일']] },
    },
  };
  main.value.content = [...(main.value.content || []), fileId];
  newProps.recordMap.signed_urls = {
    ...newProps.recordMap.signed_urls,
    [fileId]: 'https://file.notion.so/expired?expirationTimestamp=1&signature=OLD',
  };
  console.log('Checking bootstrap pages and authentication');
  await check('/admin');
  checkHomeLayout((await check('/')).body);
  const originalPost = await check('/9');
  assert.ok(!originalPost.body.includes('class="home-sidebar"'), 'posts do not use home layout');
  await check('/소개');
  await check(`/${encoded}`, 404);
  await check(fileUrl, 404);
  await check('/api/admin/refresh', 401, { method: 'POST' });
  await check('/api/admin/cleanup', 401, { method: 'POST' });
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
      if (file === `${index.rootPageId}.json`) {
        // 관리자 수집은 빌드와 달리 하이픈 있는 UUID를 pageId로 저장한다.
        saved.pageId = saved.recordMap.block[Object.keys(saved.recordMap.block)[0]].value.id;
        assert.notEqual(saved.pageId, saved.site.rootNotionPageId);
        assert.equal(saved.pageId.replace(/-/g, ''), saved.site.rootNotionPageId);
        if (includePost) {
          saved.recordMap.block[newId] = structuredClone(main);
          const views = Object.values(saved.recordMap.collection_query[main.value.parent_id]);
          for (const view of views)
            if (view.collection_group_results?.blockIds)
              view.collection_group_results.blockIds.unshift(newId);
        }
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
  assert.ok(
    post.body.includes(`href="${fileUrl.replace(/&/g, '&amp;')}"`),
    'cached HTML contains a stable attachment link',
  );
  await check(fileUrl, 405, { method: 'POST' });
  if (process.argv.includes('--live-files')) {
    console.log('Re-signing an expired fixture URL using the actual public Notion file');
    const file = await check(fileUrl, 302, { redirect: 'manual' });
    assert.equal(file.response.headers.get('Cache-Control'), 'no-store');
    const location = file.response.headers.get('Location');
    const renewed = new URL(location);
    assert.equal(renewed.protocol, 'https:');
    if (renewed.searchParams.has('expirationTimestamp'))
      assert.ok(Number(renewed.searchParams.get('expirationTimestamp')) > Date.now() + 30000);
    const content = await fetch(location, {
      headers: { Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(15000),
    });
    assert.ok(content.ok, `fresh signed file responds with HTTP ${content.status}`);
    await content.body?.cancel();
  }
  const home = await check('/');
  checkHomeLayout(home.body);
  assert.ok(home.body.includes('관리자 갱신 통합 검증 글'), 'home list refreshes');
  const data = await check(`/_next/data/${buildId}/${encoded}.json`);
  assert.equal(JSON.parse(data.body).pageProps.pageId, newId);
  for (const name of ['sitemap.xml', 'feed.xml'])
    assert.ok((await check(`/${name}`)).body.includes(encoded));
  await check('/소개');
  console.log('Removing published address without a rebuild');
  await publishFixture(false);
  checkHomeLayout((await check('/')).body);
  await check(`/${encoded}`, 404);
  await check(fileUrl, 404);
  await check(`/_next/data/${buildId}/${encoded}.json`, 404);

  console.log('Checking cleanup preview and execution against native R2 storage');
  const preview = JSON.parse((await check('/api/admin/cleanup', 200, { headers })).body);
  assert.equal(preview.state, 'planned');
  assert.equal(preview.candidateObjects, 0, 'recent snapshots must be preserved');
  const cleanup = JSON.parse(
    (await check('/api/admin/cleanup', 200, { method: 'POST', headers })).body,
  );
  assert.equal(cleanup.deletedObjects, 0);
  const scheduled = await worker.scheduled({ cron: '20 18 * * *', scheduledTime: new Date() });
  assert.equal(scheduled.outcome, 'ok', 'native scheduled handler completes');
  // Age only this isolated test inventory through the internal function; the public API has no clock override.
  await publishFixture(false);
  const current = await publishFixture(false);
  const orphan = `${prefix}/html/${randomUUID()}/test-build/orphan.cache`;
  await bucket.put(orphan, 'orphan');
  const { build } = await import('esbuild');
  const { outputFiles } = await build({
    entryPoints: [path.join(root, 'lib/content-cleanup.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const { cleanupPublishedContent } = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
  );
  const expired = await cleanupPublishedContent(
    bucket,
    prefix,
    index.rootPageId,
    true,
    Date.now() + 8 * 86400000,
  );
  assert.equal(expired.state, 'complete');
  assert.ok(expired.deletedObjects > 100, 'an obsolete snapshot and cache were deleted');
  assert.equal(await bucket.get(`${prefix}/revisions/${revision}/index.json`), null);
  assert.equal(await bucket.get(orphan), null);
  assert.equal((await (await bucket.get(`${prefix}/current.json`)).json()).revision, current);
  for (const retained of expired.retainedRevisions)
    assert.ok(await bucket.get(`${prefix}/revisions/${retained}/index.json`));
  const afterCleanup = await check('/');
  checkHomeLayout(afterCleanup.body);
  assert.equal(afterCleanup.response.headers.get('X-Blog-Revision'), current);
  await check('/9');

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
        checkHomeLayout((await check('/')).body);
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
    'PASS: HTML, client navigation JSON, home, XML, stable files, private assets, cache revision switch, and native R2 cleanup',
  );
} finally {
  const errors = server.getLogs().filter(log => log.level === 'error');
  if (errors.length) console.error(errors);
  await server.close();
}
