/* eslint-disable @typescript-eslint/no-var-requires -- Node.js 통합 테스트. */
/* global globalThis */
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { test, before } = require('node:test');
const root = path.resolve(__dirname, '..');
let api;
let fixture;

before(async () => {
  const { outputFiles } = await require('esbuild').build({
    stdin: {
      contents: `
        export { default as worker } from './custom-worker';
        export { BlogRefreshJob } from './lib/content-refresh-job';
        export { handleAdminRefresh } from './lib/admin-refresh';
        export { readPublishedPage, readPublishedIndex } from './lib/published-content';
        export { contentStorePrefix, revisionKey } from './lib/content-paths';
        export { rootNotionPageId, site } from './lib/config';
        export { createNotionFileHandler } from './lib/notion-file';
        export { withStableNotionFiles, notionFileUrl } from './lib/notion-file-url';
        export { cleanupPublishedContent } from './lib/content-cleanup';
      `,
      resolveDir: root,
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { 'notion-types': path.join(root, 'packages/notion-types/index.ts') },
    plugins: [
      {
        name: 'fixtures',
        setup(build) {
          build.onResolve({ filter: /^notion-client$/ }, () => ({
            path: 'client',
            namespace: 'fixture',
          }));
          build.onResolve({ filter: /^notion-utils$/ }, () => ({
            path: 'utils',
            namespace: 'fixture',
          }));
          build.onResolve({ filter: /^@opennextjs\/cloudflare$/ }, () => ({
            path: 'context',
            namespace: 'fixture',
          }));
          build.onResolve({ filter: /\.open-next\/worker\.js$/ }, () => ({
            path: 'handler',
            namespace: 'fixture',
          }));
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
            contents:
              name === 'client'
                ? `export class NotionAPI { getPage(id) { return globalThis.refreshFixture.getPage(id); } }`
                : name === 'utils'
                ? `export * from ${JSON.stringify(
                    path.join(root, 'packages/notion-utils/index.ts'),
                  )}; export async function getAllPagesInSpace(root,space,getPage) { const result={}; for (const id of Object.keys(globalThis.refreshFixture.pages)) result[id]=await getPage(id); return result; }`
                : name === 'context'
                ? `export function getCloudflareContext() { return { env: globalThis.refreshFixture.env }; }`
                : `export default { fetch(request, env) { return globalThis.refreshFixture.handler(request, env); } };`,
            resolveDir: root,
          }));
        },
      },
    ],
  });
  const compiled = new Module(__filename, module);
  compiled._compile(outputFiles[0].text, __filename);
  api = compiled.exports;
});

const postId = '11111111-1111-4111-8111-111111111111';
const draftId = '22222222-2222-4222-8222-222222222222';
const childId = '33333333-3333-4333-8333-333333333333';
const collectionId = '44444444-4444-4444-8444-444444444444';
const uuid = id => id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');

function setup() {
  const rootId = uuid(api.rootNotionPageId);
  const page = (id, title, status) => ({
    value: {
      id,
      type: 'page',
      content: id === draftId ? [childId] : [],
      parent_id: status ? collectionId : 'space',
      parent_table: status ? 'collection' : 'space',
      properties: { title: [[title]], status: [[status]], slug: [[title]] },
    },
  });
  const blocks = {
    [rootId]: page(rootId, 'home'),
    [postId]: page(postId, 'new-post', '공개'),
    [draftId]: page(draftId, 'secret-draft', '작성 중'),
    [childId]: {
      value: {
        id: childId,
        type: 'text',
        parent_id: draftId,
        properties: { title: [['PRIVATE BODY']] },
      },
    },
  };
  const collection = {
    [collectionId]: {
      value: {
        id: collectionId,
        parent_id: rootId,
        parent_table: 'block',
        schema: { status: { name: '상태', type: 'select' }, slug: { name: 'Slug', type: 'text' } },
      },
    },
  };
  const pages = Object.fromEntries(
    [rootId, postId, draftId].map(id => [
      id,
      {
        block: { [id]: blocks[id], ...blocks },
        collection,
        collection_view: {},
        collection_query: {
          [collectionId]: { view: { collection_group_results: { blockIds: [postId, draftId] } } },
        },
      },
    ]),
  );
  const values = new Map();
  const uploaded = new Map();
  const deleted = [];
  const writes = [];
  const bucket = {
    async get(key) {
      if (!values.has(key)) return null;
      const value = values.get(key);
      return {
        json: async () => JSON.parse(value),
        text: async () => value,
        body: new Response(value).body,
      };
    },
    async put(key, value) {
      writes.push(key);
      values.set(key, value);
      uploaded.set(key, new Date());
    },
    async list({ prefix, cursor, limit }) {
      const keys = [...values.keys()].filter(key => key.startsWith(prefix)).sort();
      const offset = cursor ? Number(cursor) : 0;
      // Small pages deliberately exercise cursor handling with fewer results than requested.
      const count = Math.min(limit, 3);
      const objects = keys.slice(offset, offset + count).map(key => ({
        key,
        size: Buffer.byteLength(values.get(key)),
        uploaded: uploaded.get(key) || new Date(),
      }));
      return {
        objects,
        truncated: offset + count < keys.length,
        cursor: String(offset + count),
      };
    },
    async delete(keys) {
      deleted.push(...keys);
      for (const key of keys) {
        values.delete(key);
        uploaded.delete(key);
      }
    },
  };
  const storage = new Map();
  fixture = {
    pages,
    values,
    uploaded,
    deleted,
    writes,
    storage,
    getPage: async id => structuredClone(pages[id] || { block: {}, collection: {} }),
    env: {
      NEXT_INC_CACHE_R2_BUCKET: bucket,
      ADMIN_REFRESH_SECRET: 's'.repeat(48),
      ASSETS: { fetch: async () => new Response('static') },
      BLOG_REFRESH: {
        idFromName: id => id,
        get: () => ({ fetch: request => fixture.job.fetch(request) }),
      },
    },
    handler: async (request, env) => {
      fixture.lastEnv = env;
      return new Response('rendered', { headers: { 'Cache-Control': 'public,max-age=600' } });
    },
  };
  globalThis.refreshFixture = fixture;
  fixture.job = new api.BlogRefreshJob(
    {
      storage: {
        get: async key => structuredClone(storage.get(key)),
        put: async (key, value) => {
          storage.set(key, structuredClone(value));
        },
        setAlarm: async () => {
          fixture.alarms = (fixture.alarms || 0) + 1;
        },
      },
      blockConcurrencyWhile: callback => callback(),
    },
    fixture.env,
  );
  return fixture;
}

function request(method, token, origin) {
  return new Request('https://blog.example/api/admin/refresh', {
    method,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(origin && { Origin: origin }),
    },
  });
}

test('admin endpoint requires the configured secret and rejects cross-origin mutation', async () => {
  const f = setup();
  assert.equal((await api.handleAdminRefresh(request('POST'), f.env)).status, 401);
  assert.equal((await api.handleAdminRefresh(request('POST', 'wrong'), f.env)).status, 401);
  assert.equal(
    (
      await api.handleAdminRefresh(
        request('POST', f.env.ADMIN_REFRESH_SECRET, 'https://other.example'),
        f.env,
      )
    ).status,
    403,
  );
  assert.equal((await api.handleAdminRefresh(request('DELETE'), f.env)).status, 405);
  assert.equal(
    (await api.handleAdminRefresh(request('POST'), { ...f.env, ADMIN_REFRESH_SECRET: '' })).status,
    503,
  );
  assert.equal(f.storage.size, 0);
});

test('repeated button presses reuse one durable job and status responses cannot be cached', async () => {
  const f = setup();
  const first = await api.handleAdminRefresh(request('POST', f.env.ADMIN_REFRESH_SECRET), f.env);
  const second = await api.handleAdminRefresh(request('POST', f.env.ADMIN_REFRESH_SECRET), f.env);
  assert.equal(first.status, 202);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal((await first.json()).id, (await second.json()).id);
  assert.equal(f.alarms, 1);
});

async function publish(f) {
  await f.job.fetch(new Request('https://internal/job', { method: 'POST' }));
  await f.job.alarm();
  const status = f.storage.get('job');
  assert.equal(status.state, 'complete', status.error);
  return status.published;
}

test('publishes complete immutable snapshots, hides drafts and switches the pointer last', async () => {
  const f = setup();
  const pointer = await publish(f);
  const prefix = api.contentStorePrefix(api.rootNotionPageId);
  assert.equal(f.writes.at(-1), `${prefix}/current.json`);
  const index = JSON.parse(f.values.get(api.revisionKey(prefix, pointer.revision, 'index.json')));
  assert.equal(index.canonicalPageMap['new-post'], postId);
  assert.equal(index.canonicalPageMap['secret-draft'], undefined);
  assert.deepEqual(index.hiddenPageIds, [draftId]);
  const props = JSON.parse(
    f.values.get(api.revisionKey(prefix, pointer.revision, `pages/${api.rootNotionPageId}.json`)),
  );
  assert.equal(props.recordMap.block[draftId], undefined);
  assert.equal(props.recordMap.block[childId], undefined);
  assert.deepEqual(
    props.recordMap.collection_query[collectionId].view.collection_group_results.blockIds,
    [postId],
  );
  assert.ok(
    f.values.get(api.revisionKey(prefix, pointer.revision, 'sitemap.xml')).includes('/new-post'),
  );
  assert.ok(
    f.values.get(api.revisionKey(prefix, pointer.revision, 'feed.xml')).includes('/new-post'),
  );
});

test('a failed refresh keeps the previous published pointer and permits retry', async () => {
  const f = setup();
  const pointer = await publish(f);
  const key = `${api.contentStorePrefix(api.rootNotionPageId)}/current.json`;
  const previous = f.values.get(key);
  f.env.NEXT_INC_CACHE_R2_BUCKET.put = async () => {
    throw new Error('R2 unavailable');
  };
  await f.job.fetch(new Request('https://internal/job', { method: 'POST' }));
  const originalError = console.error;
  console.error = () => {};
  try {
    await f.job.alarm();
  } finally {
    console.error = originalError;
  }
  assert.equal(f.values.get(key), previous);
  assert.equal(f.storage.get('job').state, 'failed');
  assert.notEqual(f.storage.get('job').id, pointer.revision);
});

test('unknown and draft addresses become fast 404s, and new slugs use stored page props', async () => {
  const f = setup();
  const pointer = await publish(f);
  f.env.BLOG_CONTENT_REVISION = pointer.revision;
  f.getPage = () => assert.fail('visitors must not query Notion');
  assert.equal((await api.readPublishedPage('new-post')).pageId, postId);
  assert.equal((await api.readPublishedPage(postId)).pageId, postId);
  for (const slug of ['missing', 'secret-draft', draftId]) {
    assert.equal((await api.readPublishedPage(slug)).error.statusCode, 404);
  }
});

test('worker applies the revision to dotted slugs, JSON navigation and search APIs', async () => {
  const f = setup();
  const pointer = await publish(f);
  for (const pathname of [
    '/new.post',
    '/한글-주소',
    '/_next/data/build/new-post.json',
    '/api/search-notion',
  ]) {
    const response = await api.worker.fetch(
      new Request(`https://blog.example${pathname}`),
      f.env,
      {},
    );
    assert.equal(response.headers.get('X-Blog-Revision'), pointer.revision);
    assert.equal(response.headers.get('Cache-Control'), 'no-cache');
    assert.equal(f.lastEnv.BLOG_CONTENT_REVISION, pointer.revision);
    assert.ok(f.lastEnv.NEXT_INC_CACHE_R2_PREFIX.endsWith(`/html/${pointer.revision}`));
  }
  assert.equal(
    f.env.BLOG_CONTENT_REVISION,
    undefined,
    'request context must not mutate global env',
  );
});

test('worker serves current XML and blocks private bootstrap snapshots including encoded paths', async () => {
  const f = setup();
  await publish(f);
  for (const pathname of ['/sitemap.xml', '/feed.xml']) {
    const response = await api.worker.fetch(
      new Request(`https://blog.example${pathname}`),
      f.env,
      {},
    );
    assert.equal(response.headers.get('Content-Type'), 'application/xml; charset=utf-8');
    assert.ok((await response.text()).includes('/new-post'));
  }
  for (const pathname of [
    '/_blog-data',
    '/_blog-data/index.json',
    '/%5Fblog-data%2Fpages/x.json',
  ]) {
    assert.equal(
      (await api.worker.fetch(new Request(`https://blog.example${pathname}`), f.env, {})).status,
      404,
    );
  }
  assert.equal(
    (await api.worker.fetch(new Request('https://blog.example/_next/static/chunk.js'), f.env, {}))
      .status,
    200,
  );
});

test('an interrupted job can be restarted after its heartbeat expires', async () => {
  const f = setup();
  await f.job.fetch(new Request('https://internal/job', { method: 'POST' }));
  const first = f.storage.get('job');
  f.storage.set('job', {
    ...first,
    updatedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
  });
  assert.equal(
    (await (await f.job.fetch(new Request('https://internal/job'))).json()).state,
    'failed',
  );
  await f.job.fetch(new Request('https://internal/job', { method: 'POST' }));
  assert.notEqual(f.storage.get('job').id, first.id);
  assert.equal(f.storage.get('job').state, 'queued');
});

test('a failed collection query cannot replace an existing blog with an empty list', async () => {
  const f = setup();
  await publish(f);
  const key = `${api.contentStorePrefix(api.rootNotionPageId)}/current.json`;
  const previous = f.values.get(key);
  const rootId = uuid(api.rootNotionPageId);
  const viewBlock = '55555555-5555-4555-8555-555555555555';
  f.pages[rootId].block[rootId].value.content = [viewBlock];
  f.pages[rootId].block[viewBlock] = {
    value: {
      id: viewBlock,
      type: 'collection_view',
      collection_id: collectionId,
      view_ids: ['missing-view'],
    },
  };
  await f.job.fetch(new Request('https://internal/job', { method: 'POST' }));
  const originalError = console.error;
  console.error = () => {};
  try {
    await f.job.alarm();
  } finally {
    console.error = originalError;
  }
  assert.equal(f.storage.get('job').state, 'failed');
  assert.equal(f.values.get(key), previous);
});

const fileId = '66666666-6666-4666-8666-666666666666';
const originalFileSource = `attachment:${fileId}:example.pdf`;
function addFile(f, type = 'file', source = originalFileSource) {
  f.pages[postId].block[postId].value.content.push(fileId);
  for (const page of Object.values(f.pages)) {
    page.block[fileId] = {
      value: {
        id: fileId,
        type,
        parent_id: postId,
        parent_table: 'block',
        properties: { source: [[source]], title: [['example.pdf']] },
      },
    };
    page.signed_urls = {
      [fileId]: 'https://file.notion.so/expired?expirationTimestamp=1&signature=OLD',
    };
  }
}
const fileRequest = (pageId = postId, blockId = fileId, method = 'GET') =>
  new Request(`https://blog.example${api.notionFileUrl(pageId, blockId)}`, { method });
const freshUrl = () =>
  `https://file.notion.so/fresh?expirationTimestamp=${Date.now() + 3600000}&signature=NEW`;
async function publishFiles(f) {
  f.env.BLOG_CONTENT_REVISION = (await publish(f)).revision;
}

test('rendering uses stable file links for uploaded media and covers without mutating snapshots', () => {
  const f = setup();
  for (const type of ['file', 'image', 'pdf', 'audio', 'video']) {
    addFile(f, type);
    const original = structuredClone(f.pages[postId]);
    const rendered = api.withStableNotionFiles(original, postId);
    assert.equal(rendered.signed_urls[fileId], api.notionFileUrl(postId, fileId));
    assert.equal(
      rendered.block[fileId].value.properties.source[0][0],
      api.notionFileUrl(postId, fileId),
    );
    assert.equal(original.block[fileId].value.properties.source[0][0], originalFileSource);
    assert.ok(original.signed_urls[fileId].includes('signature=OLD'));
  }
  const original = f.pages[postId];
  original.block[postId].value.format = { page_cover: originalFileSource };
  const rendered = api.withStableNotionFiles(original, postId);
  assert.equal(rendered.block[postId].value.format.page_cover, api.notionFileUrl(postId, postId));
  assert.equal(original.block[postId].value.format.page_cover, originalFileSource);
  original.block[fileId].value.properties.source = [['https://external.example/audio.mp3']];
  assert.equal(api.withStableNotionFiles(original, postId).block[fileId], original.block[fileId]);
});

test('expired stored URLs are re-signed from the published source, concurrent requests share a short cache', async () => {
  const f = setup();
  addFile(f);
  await publishFiles(f);
  let calls = 0;
  const signed = freshUrl();
  const handler = api.createNotionFileHandler(async (url, init) => {
    calls++;
    assert.equal(url, 'https://www.notion.so/api/v3/getSignedFileUrls');
    assert.ok(init.signal);
    assert.deepEqual(JSON.parse(init.body), {
      urls: [{ permissionRecord: { table: 'block', id: fileId }, url: originalFileSource }],
    });
    await new Promise(resolve => setTimeout(resolve, 5));
    return Response.json({ signedUrls: [signed] });
  });
  const responses = await Promise.all([
    handler(fileRequest(), f.env),
    handler(fileRequest(), f.env),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('Location'), signed);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  const injected = new Request(`${fileRequest().url}&url=https://evil.example/`);
  assert.equal((await handler(injected, f.env)).status, 302);
  assert.equal(calls, 1);
});

test('current publication is authorized before cached files, including deletion and private transitions', async () => {
  const f = setup();
  addFile(f);
  await publishFiles(f);
  let calls = 0;
  const handler = api.createNotionFileHandler(async () => {
    calls++;
    return Response.json({ signedUrls: [freshUrl()] });
  });
  assert.equal((await handler(fileRequest(), f.env)).status, 302);
  for (const request of [
    fileRequest(draftId),
    fileRequest(postId, childId),
    fileRequest('bad-id'),
    fileRequest(postId, fileId, 'POST'),
  ]) {
    assert.ok([404, 405].includes((await handler(request, f.env)).status));
  }
  assert.equal(calls, 1);
  for (const page of Object.values(f.pages)) delete page.block[fileId];
  await publishFiles(f);
  assert.equal((await handler(fileRequest(), f.env)).status, 404);
  addFile(f);
  f.pages[postId].block[postId].value.properties.status = [['작성 중']];
  await publishFiles(f);
  assert.equal((await handler(fileRequest(), f.env)).status, 404);
  assert.equal(calls, 1);
  assert.equal(
    (await api.worker.fetch(new Request('https://blog.example/api/notion-file'), f.env, {})).status,
    404,
  );
});

test('external sources and files owned by unpublished pages cannot use the signing endpoint', async () => {
  const f = setup();
  addFile(f, 'file', 'https://external.example/file.pdf');
  await publishFiles(f);
  const handler = api.createNotionFileHandler(() =>
    assert.fail('must not sign unapproved sources'),
  );
  assert.equal((await handler(fileRequest(), f.env)).status, 404);
  addFile(f);
  // 공개 페이지의 recordMap에 섞인 비공개 페이지 파일도 허용하지 않는다.
  for (const page of Object.values(f.pages)) page.block[fileId].value.parent_id = draftId;
  await publishFiles(f);
  assert.equal((await handler(fileRequest(), f.env)).status, 404);
});

test('signing failures and expired or foreign redirects fail closed and do not poison the cache', async () => {
  const f = setup();
  addFile(f);
  await publishFiles(f);
  for (const url of [
    'https://evil.example/file',
    'http://file.notion.so/file',
    'https://file.notion.so.evil.example/file',
    'https://file.notion.so/old?expirationTimestamp=1',
    'https://s3.us-west-2.amazonaws.com/secure.notion-static.com/old?Expires=1',
  ]) {
    let calls = 0;
    const handler = api.createNotionFileHandler(async () => {
      calls++;
      return Response.json({ signedUrls: [calls === 1 ? url : freshUrl()] });
    });
    const failed = await handler(fileRequest(), f.env);
    assert.equal(failed.status, 503);
    assert.equal(failed.headers.get('Cache-Control'), 'no-store');
    assert.ok(!(await failed.text()).includes(url));
    assert.equal((await handler(fileRequest(), f.env)).status, 302);
    assert.equal(calls, 2);
  }
  const unavailable = api.createNotionFileHandler(
    async () => new Response('upstream secret', { status: 429 }),
  );
  assert.equal((await unavailable(fileRequest(), f.env)).status, 503);
  const networkError = api.createNotionFileHandler(async () => {
    throw new Error('secret file URL');
  });
  assert.ok(!(await (await networkError(fileRequest(), f.env)).text()).includes('secret'));
});

test('a near-expiry signature is renewed before expiration and a new snapshot never reuses it', async () => {
  const f = setup();
  addFile(f);
  await publishFiles(f);
  let calls = 0;
  const handler = api.createNotionFileHandler(async () => {
    calls++;
    return Response.json({
      signedUrls: [
        `https://file.notion.so/file?expirationTimestamp=${Date.now() + 35000}&signature=${calls}`,
      ],
    });
  });
  assert.equal((await handler(fileRequest(postId, fileId, 'HEAD'), f.env)).status, 302);
  const originalNow = Date.now;
  const now = originalNow();
  Date.now = () => now + 6000;
  try {
    assert.equal((await handler(fileRequest(), f.env)).status, 302);
  } finally {
    Date.now = originalNow;
  }
  assert.equal(calls, 2);
  await publishFiles(f);
  assert.equal((await handler(fileRequest(), f.env)).status, 302);
  assert.equal(calls, 3);
});

test('bootstrap snapshots support stable files and unrelated navigation pages cannot authorize them', async () => {
  const f = setup();
  addFile(f);
  await publishFiles(f);
  const prefix = api.contentStorePrefix(api.rootNotionPageId);
  const base = `${prefix}/revisions/${f.env.BLOG_CONTENT_REVISION}`;
  const fileKey = `pages/${postId.replace(/-/g, '')}.json`;
  f.env.ASSETS.fetch = async request => {
    const key = new URL(request.url).pathname.replace('/_blog-data/', '');
    const value = f.values.get(`${base}/${key}`);
    return new Response(value || '', { status: value ? 200 : 404 });
  };
  let calls = 0;
  const handler = api.createNotionFileHandler(async () => {
    calls++;
    return Response.json({ signedUrls: [freshUrl()] });
  });
  delete f.env.BLOG_CONTENT_REVISION;
  assert.equal((await handler(fileRequest(), f.env)).status, 302);
  const saved = JSON.parse(f.values.get(`${base}/${fileKey}`));
  const unrelated = '99999999-9999-4999-8999-999999999999';
  saved.recordMap.block[unrelated] = {
    value: { id: unrelated, type: 'page', parent_table: 'space' },
  };
  saved.recordMap.block[fileId].value.parent_id = unrelated;
  f.values.set(`${base}/${fileKey}`, JSON.stringify(saved));
  assert.equal((await handler(fileRequest(), f.env)).status, 404);
  assert.equal(calls, 1);
});

function cleanupFixture() {
  const f = setup();
  f.prefix = api.contentStorePrefix(api.rootNotionPageId);
  f.cleanupRevision = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
  f.seed = (key, ageDays) => {
    f.values.set(key, '{}');
    f.uploaded.set(key, new Date(Date.now() - ageDays * 86400000));
    return key;
  };
  f.seedSnapshot = (n, ageDays, complete = true) => {
    const revision = f.cleanupRevision(n);
    for (const file of complete
      ? [
          'index.json',
          'feed.xml',
          'sitemap.xml',
          `pages/${api.rootNotionPageId.replace(/-/g, '')}.json`,
        ]
      : ['pages/partial.json'])
      f.seed(`${f.prefix}/revisions/${revision}/${file}`, ageDays);
    f.seed(`${f.prefix}/html/${revision}/build/page.cache`, ageDays);
    return revision;
  };
  f.current = f.seedSnapshot(1, 90);
  f.previous = [f.seedSnapshot(2, 10), f.seedSnapshot(3, 11)];
  f.obsolete = f.seedSnapshot(4, 12);
  f.pointerKey = `${f.prefix}/current.json`;
  f.values.set(f.pointerKey, JSON.stringify({ revision: f.current }));
  f.cleanup = execute =>
    api.cleanupPublishedContent(
      f.env.NEXT_INC_CACHE_R2_BUCKET,
      f.prefix,
      api.rootNotionPageId,
      execute,
    );
  return f;
}

test('cleanup previews without writes and preserves current, two backups, recent and unrelated data', async () => {
  const f = cleanupFixture();
  const recent = f.seedSnapshot(5, 1, false);
  const abandoned = f.seedSnapshot(6, 20, false);
  const orphan = f.seed(`${f.prefix}/html/${f.cleanupRevision(7)}/build/orphan.cache`, 30);
  const unrelated = [
    'incremental-cache/old-build/file.cache',
    'other-site/revisions/file.json',
    `${f.prefix}/revisions/unrecognized/file.json`,
    `${f.prefix}/html/unrecognized/file.cache`,
  ].map(key => f.seed(key, 90));
  const before = new Map(f.values);
  const preview = await f.cleanup(false);
  assert.equal(preview.state, 'planned');
  assert.equal(preview.candidateObjects, 8);
  assert.deepEqual(new Set(preview.retainedRevisions), new Set([f.current, ...f.previous]));
  assert.deepEqual(f.values, before);
  assert.equal(f.deleted.length, 0);
  const result = await f.cleanup(true);
  assert.equal(result.state, 'complete');
  assert.equal(result.deletedObjects, 8);
  assert.equal(result.deletedBytes, 16);
  assert.equal(f.values.has(orphan), false);
  for (const key of f.deleted) assert.ok(!f.values.has(key));
  for (const id of [f.obsolete, abandoned])
    assert.ok(![...f.values.keys()].some(key => key.includes(id)));
  for (const id of [f.current, ...f.previous, recent])
    assert.ok([...f.values.keys()].some(key => key.includes(id)));
  for (const key of unrelated) assert.ok(f.values.has(key));
  assert.equal(JSON.parse(f.values.get(f.pointerKey)).revision, f.current);
  assert.equal((await f.cleanup(true)).deletedObjects, 0);
});

test('cleanup keeps whole snapshots with a recent write and retains the two latest complete backups', async () => {
  const f = cleanupFixture();
  const recentComplete = f.seedSnapshot(5, 1);
  f.seed(`${f.prefix}/revisions/${f.obsolete}/pages/recent.json`, 1);
  const result = await f.cleanup(true);
  assert.deepEqual(
    new Set(result.retainedRevisions),
    new Set([f.current, recentComplete, f.obsolete]),
  );
  assert.ok(f.deleted.every(key => f.previous.some(id => key.includes(id))));
  assert.ok(f.values.has(`${f.prefix}/revisions/${f.obsolete}/index.json`));
});

test('cleanup refuses missing or malformed pointers and incomplete active snapshots', async () => {
  for (const value of [null, '{broken', JSON.stringify({ revision: '../escape' })]) {
    const f = cleanupFixture();
    if (value === null) f.values.delete(f.pointerKey);
    else f.values.set(f.pointerKey, value);
    await assert.rejects(f.cleanup(true));
    assert.equal(f.deleted.length, 0);
  }
  const f = cleanupFixture();
  f.values.delete(`${f.prefix}/revisions/${f.current}/feed.xml`);
  await assert.rejects(f.cleanup(true), /incomplete/);
  assert.equal(f.deleted.length, 0);
});

test('cleanup rejects unscoped prefixes and incomplete or invalid inventories before deleting', async () => {
  const f = cleanupFixture();
  for (const prefix of ['', 'published-content', 'published-content/v1/../escape'])
    await assert.rejects(
      api.cleanupPublishedContent(
        f.env.NEXT_INC_CACHE_R2_BUCKET,
        prefix,
        api.rootNotionPageId,
        true,
      ),
      /scoped/,
    );
  const bucket = f.env.NEXT_INC_CACHE_R2_BUCKET;
  const list = bucket.list.bind(bucket);
  bucket.list = async options => {
    if (options.prefix.endsWith('/html/')) throw new Error('R2 unavailable');
    return list(options);
  };
  await assert.rejects(f.cleanup(true), /unavailable/);
  bucket.list = async () => ({ objects: [], truncated: true });
  await assert.rejects(f.cleanup(true), /cursor/);
  bucket.list = async () => ({
    objects: [{ key: 'other-site/file', size: 1, uploaded: new Date() }],
    truncated: false,
  });
  await assert.rejects(f.cleanup(true), /Invalid storage inventory/);
  assert.equal(f.deleted.length, 0);
});

test('cleanup rechecks the current revision before deletion', async () => {
  const f = cleanupFixture();
  const bucket = f.env.NEXT_INC_CACHE_R2_BUCKET;
  const list = bucket.list.bind(bucket);
  bucket.list = async options => {
    const result = await list(options);
    if (options.prefix.endsWith('/html/') && !result.truncated)
      f.values.set(f.pointerKey, JSON.stringify({ revision: f.previous[0] }));
    return result;
  };
  await assert.rejects(f.cleanup(true), /revision changed/);
  assert.equal(f.deleted.length, 0);
});

test('cleanup stops later deletion batches when the published revision changes', async () => {
  const f = cleanupFixture();
  const orphan = f.cleanupRevision(8);
  for (let n = 0; n < 300; n++) f.seed(`${f.prefix}/html/${orphan}/build/${n}.cache`, 30);
  const bucket = f.env.NEXT_INC_CACHE_R2_BUCKET;
  const remove = bucket.delete.bind(bucket);
  bucket.delete = async keys => {
    await remove(keys);
    f.values.set(f.pointerKey, JSON.stringify({ revision: f.previous[0] }));
  };
  await assert.rejects(f.cleanup(true), /revision changed/);
  assert.equal(f.deleted.length, 200);
  assert.ok(f.values.has(`${f.prefix}/revisions/${f.current}/index.json`));
  assert.ok(f.values.has(`${f.prefix}/revisions/${f.previous[0]}/index.json`));
});

test('cleanup fails closed on repeating cursors, invalid dates and oversized inventories', async () => {
  const f = cleanupFixture();
  const bucket = f.env.NEXT_INC_CACHE_R2_BUCKET;
  bucket.list = async () => ({ objects: [], truncated: true, cursor: 'repeated' });
  await assert.rejects(f.cleanup(true), /cursor/);
  bucket.list = async () => ({
    objects: [{ key: `${f.prefix}/revisions/bad`, size: 1, uploaded: new Date('invalid') }],
    truncated: false,
  });
  await assert.rejects(f.cleanup(true), /inventory/);
  let page = 0;
  bucket.list = async () => ({
    objects: Array.from({ length: 1000 }, (_, n) => ({
      key: `${f.prefix}/revisions/${page}/${n}`,
      size: 1,
      uploaded: new Date(),
    })),
    truncated: true,
    cursor: String(++page),
  });
  await assert.rejects(f.cleanup(true), /limit exceeded/);
  assert.equal(f.deleted.length, 0);
});

test('cleanup caps each execution and can continue safely on the next run', async () => {
  const f = cleanupFixture();
  const orphan = f.cleanupRevision(8);
  for (let n = 0; n < 2100; n++) f.seed(`${f.prefix}/html/${orphan}/build/${n}.cache`, 30);
  const result = await f.cleanup(true);
  assert.equal(result.state, 'partial');
  assert.equal(result.deletedObjects, 2000);
  assert.equal(result.remainingObjects, 105);
  const next = await f.cleanup(true);
  assert.equal(next.state, 'complete');
  assert.equal(next.deletedObjects, 105);
  assert.ok(f.values.has(`${f.prefix}/revisions/${f.current}/index.json`));
});

function cleanupRequest(f, method = 'GET', pathname = '/api/admin/cleanup') {
  return new Request(`https://blog.example${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${f.env.ADMIN_REFRESH_SECRET}` },
  });
}

test('cleanup API uses existing admin authentication, origin validation and no-store responses', async () => {
  const f = cleanupFixture();
  const url = 'https://blog.example/api/admin/cleanup';
  assert.equal((await api.worker.fetch(new Request(url, { method: 'POST' }), f.env)).status, 401);
  assert.equal((await api.worker.fetch(new Request(url, { method: 'DELETE' }), f.env)).status, 405);
  const crossOrigin = cleanupRequest(f, 'POST');
  crossOrigin.headers.set('Origin', 'https://other.example');
  assert.equal((await api.worker.fetch(crossOrigin, f.env)).status, 403);
  const preview = await api.worker.fetch(cleanupRequest(f), f.env);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('cache-control'), 'no-store');
  assert.equal((await preview.json()).state, 'planned');
  assert.equal(f.deleted.length, 0);
  const response = await api.worker.fetch(cleanupRequest(f, 'POST', '/api/admin/%63leanup'), f.env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state, 'complete');
  assert.equal(f.storage.has('job'), false);
  assert.equal(f.storage.get('cleanup').deletedObjects, 5);
});

test('scheduled cleanup skips an active refresh and cleans without starting a publish job', async () => {
  const f = cleanupFixture();
  await f.job.fetch(new Request('https://internal/job', { method: 'POST' }));
  const active = structuredClone(f.storage.get('job'));
  assert.equal((await api.worker.fetch(cleanupRequest(f, 'POST'), f.env)).status, 409);
  await api.worker.scheduled({}, f.env);
  assert.deepEqual(f.storage.get('job'), active);
  assert.equal(f.deleted.length, 0);
  f.storage.set('job', { ...active, state: 'complete' });
  await api.worker.scheduled({}, f.env);
  assert.equal(f.storage.get('cleanup').state, 'complete');
  assert.equal(f.deleted.length, 5);
  assert.equal(f.storage.get('job').id, active.id);
});

test('cleanup storage errors leave publication status unchanged and scheduled failures surface', async () => {
  const f = cleanupFixture();
  const status = { id: f.current, state: 'complete' };
  f.storage.set('job', status);
  f.env.NEXT_INC_CACHE_R2_BUCKET.delete = async () => {
    throw new Error('R2 delete failed');
  };
  assert.equal((await api.worker.fetch(cleanupRequest(f, 'POST'), f.env)).status, 503);
  assert.deepEqual(f.storage.get('job'), status);
  assert.equal(JSON.parse(f.values.get(f.pointerKey)).revision, f.current);
  await assert.rejects(api.worker.scheduled({}, f.env), /Scheduled content cleanup failed/);
});
