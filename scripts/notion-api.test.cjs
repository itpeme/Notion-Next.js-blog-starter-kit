/* eslint-disable @typescript-eslint/no-var-requires -- Node.js CommonJS 테스트. */
/* global globalThis */
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');

// OpenNext 빌드 도구에 포함된 esbuild로 실제 워크스페이스 코드를 메모리에서 불러온다.
const root = path.resolve(__dirname, '..');
const { outputFiles } = require('esbuild').buildSync({
  stdin: {
    contents: `
      export { NotionAPI } from './packages/notion-client/notion-api';
      export { getAllPagesInSpace } from './packages/notion-utils/get-all-pages-in-space';
    `,
    resolveDir: root,
  },
  alias: {
    'notion-utils': path.join(root, 'packages/notion-utils/index.ts'),
    'notion-types': path.join(root, 'packages/notion-types/index.ts'),
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
const compiled = new Module(__filename, module);
compiled._compile(outputFiles[0].text, __filename);
const { NotionAPI, getAllPagesInSpace } = compiled.exports;

const pageId = '12345678-1234-1234-1234-123456789abc';
const fileId = '12345678-1234-1234-1234-123456789abd';
let originalFetch;
let originalWarn;
let originalTimeout;
let logs;
let delays;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalWarn = console.warn;
  originalTimeout = globalThis.setTimeout;
  logs = [];
  delays = [];
  console.warn = (...args) => logs.push(args);
  globalThis.setTimeout = (callback, ms, ...args) => {
    delays.push(ms);
    queueMicrotask(() => callback(...args));
    return { unref() {} };
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  globalThis.setTimeout = originalTimeout;
});

function recordMap(cover, withFile = false) {
  return {
    block: {
      [pageId]: {
        value: {
          id: pageId,
          type: 'page',
          format: { page_cover: cover },
          content: withFile ? [fileId] : [],
        },
      },
      ...(withFile && {
        [fileId]: {
          value: {
            id: fileId,
            type: 'file',
            properties: { source: [['https://prod-files-secure.s3.us-west-2.amazonaws.com/file']] },
          },
        },
      }),
    },
  };
}

test('does not sign relative or absolute Notion default covers', async () => {
  const api = new NotionAPI();
  api.getSignedFileUrls = async () => assert.fail('default covers must not be signed');
  for (const prefix of ['', 'https://www.notion.so', 'https://app.notion.com']) {
    const map = recordMap(`${prefix}/images/page-cover/texturelabs_metal_261S.jpg`);
    await api.addSignedUrls({ recordMap: map });
    assert.deepEqual(map.signed_urls, {});
    assert.equal(map.block[pageId].value.format.page_cover.startsWith(prefix), true);
  }
});

test('still signs uploaded files beside a default cover and preserves URL-to-block mapping', async () => {
  const api = new NotionAPI();
  const map = recordMap('/images/page-cover/default.jpg', true);
  api.getSignedFileUrls = async files => {
    assert.equal(files.length, 1);
    assert.equal(files[0].permissionRecord.id, fileId);
    return { signedUrls: ['https://signed.example/file'] };
  };
  await api.addSignedUrls({ recordMap: map });
  assert.deepEqual(map.signed_urls, { [fileId]: 'https://signed.example/file' });
});

test('keeps uploaded covers and similarly named external paths in the signing flow', async () => {
  const api = new NotionAPI();
  for (const source of [
    'https://prod-files-secure.s3.us-west-2.amazonaws.com/cover',
    'https://example.com/images/page-cover/cover.jpg',
  ]) {
    api.getSignedFileUrls = async files => {
      assert.equal(files[0].url, source);
      return { signedUrls: ['https://signed.example/cover'] };
    };
    const map = recordMap(source);
    await api.addSignedUrls({ recordMap: map });
    assert.equal(map.signed_urls[pageId], 'https://signed.example/cover');
  }
});

test('propagates page context through author, missing blocks, collections and file signing', async () => {
  const api = new NotionAPI();
  const map = recordMap('https://uploaded.example/cover');
  map.block[pageId].value.created_by_id = 'author';
  map.block[pageId].value.content = [fileId];
  const seen = [];
  api.fetch = async ({ endpoint, gotOptions }) => {
    seen.push({ endpoint, pageId: gotOptions?.pageId });
    if (endpoint === 'loadPageChunk') return { recordMap: map };
    if (endpoint === 'getRecordValues') return { results: [{}] };
    if (endpoint === 'syncRecordValues') {
      return {
        recordMap: {
          block: {
            [fileId]: {
              value: {
                id: fileId,
                type: 'collection_view',
                collection_id: 'collection',
                view_ids: ['view'],
              },
            },
          },
        },
      };
    }
    if (endpoint === 'queryCollection') return { recordMap: {}, result: {} };
    if (endpoint === 'getSignedFileUrls') return { signedUrls: ['signed'] };
    assert.fail(endpoint);
  };
  await api.getPage(pageId);
  assert.deepEqual(
    seen.map(x => x.endpoint),
    [
      'loadPageChunk',
      'getRecordValues',
      'syncRecordValues',
      'queryCollection',
      'getSignedFileUrls',
    ],
  );
  assert.ok(seen.every(x => x.pageId === pageId));
});

test('logs HTTP 400 once without retrying or exposing request headers and URLs', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{}', { status: 400, statusText: 'Bad Request' });
  };
  const api = new NotionAPI({ authToken: 'SECRET_COOKIE' });
  await assert.rejects(
    api.fetch({
      endpoint: 'getSignedFileUrls',
      body: { urls: ['https://secret.example/?signature=SECRET_SIGNATURE'] },
      gotOptions: { pageId, headers: { authorization: 'SECRET_AUTHORIZATION' } },
    }),
    error => error.response.statusCode === 400 && error.notionRequest.pageId === pageId,
  );
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
  assert.equal(logs.length, 1);
  const details = JSON.parse(logs[0][1]);
  assert.equal(details.statusCode, 400);
  assert.equal(details.reason, 'http_error');
  assert.equal(details.retrying, false);
  assert.equal(details.retryDelayMs, 0);
  assert.equal(details.endpoint, 'getSignedFileUrls');
  assert.equal(details.pageId, pageId);
  assert.equal(details.attempt, 1);
  assert.ok(details.durationMs >= 0 && details.elapsedMs >= 0);
  assert.doesNotMatch(JSON.stringify(logs), /SECRET_|secret.example|authorization|cookie/i);
});

test('preserves Retry-After handling, recovery, and request context without sending pageId metadata', async () => {
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), {
      pageId,
      limit: 100,
      chunkNumber: 0,
      cursor: { stack: [] },
      verticalColumns: false,
    });
    assert.equal(options.headers.pageId, undefined);
    if (++calls === 1) return new Response('{}', { status: 429, headers: { 'Retry-After': '3' } });
    return new Response(JSON.stringify({ ok: true }));
  };
  assert.deepEqual(await new NotionAPI().getPageRaw(pageId), { ok: true });
  assert.deepEqual(delays, [3000]);
  assert.equal(logs.length, 1);
  const details = JSON.parse(logs[0][1]);
  assert.equal(details.reason, 'rate_limit');
  assert.equal(details.retryDelayMs, 3000);
  assert.equal(details.retrying, true);
  assert.equal(details.pageId, pageId);
});

test('preserves six attempts and exponential delays for server and network failures', async () => {
  for (const network of [false, true]) {
    logs.length = 0;
    delays.length = 0;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (network) throw new TypeError('fetch failed', { cause: { code: 'ETIMEDOUT' } });
      return new Response('{}', { status: 503, statusText: 'Unavailable' });
    };
    await assert.rejects(new NotionAPI().fetch({ endpoint: 'loadPageChunk', body: { pageId } }));
    assert.equal(calls, 6);
    assert.deepEqual(delays, [1000, 2000, 4000, 8000, 15000]);
    assert.equal(logs.length, 6);
    const last = JSON.parse(logs[5][1]);
    assert.equal(last.attempt, 6);
    assert.equal(last.retrying, false);
    assert.equal(last.reason, network ? 'network_error' : 'server_error');
    if (network) assert.equal(last.errorCode, 'ETIMEDOUT');
  }
});

test('crawl logs distinguish page retries from HTTP retries and redact URLs', async () => {
  let calls = 0;
  const pages = await getAllPagesInSpace(pageId, undefined, async () => {
    if (++calls === 1) {
      const error = new Error('Failed https://secret.example/?signature=SECRET');
      error.notionRequest = {
        endpoint: 'loadPageChunk',
        attempt: 6,
        statusCode: 503,
        retrying: false,
      };
      throw error;
    }
    return recordMap('/images/page-cover/default.jpg');
  });
  assert.ok(pages[pageId]);
  assert.equal(calls, 2);
  const details = JSON.parse(logs[0][1]);
  assert.equal(logs[0][0], '[notion-crawl] page attempt failed');
  assert.equal(details.pageId, pageId);
  assert.equal(details.attempt, 1);
  assert.equal(details.retriesLeft, 3);
  assert.equal(details.retrying, true);
  assert.equal(details.request.attempt, 6);
  assert.equal(details.request.statusCode, 503);
  assert.equal(details.request.retrying, false);
  assert.ok(details.durationMs >= 0 && details.elapsedMs >= 0);
  assert.doesNotMatch(JSON.stringify(logs), /secret.example|SECRET/);
});
