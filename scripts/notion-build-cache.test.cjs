/* eslint-disable @typescript-eslint/no-var-requires -- Node.js CommonJS 테스트. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const { withBuildPageCache } = require('../lib/notion-build-cache');

const pageId = '12345678-1234-1234-1234-123456789abc';
const modulePath = require.resolve('../lib/notion-build-cache');
const configPath = require.resolve('../next.config');
let directory;
let previousEnv;

function page() {
  return { block: { [pageId]: { value: { title: 'original', content: ['body'] } } } };
}

beforeEach(() => {
  previousEnv = {
    NODE_ENV: process.env.NODE_ENV,
    NOTION_BUILD_CACHE_DIR: process.env.NOTION_BUILD_CACHE_DIR,
  };
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-cache-test-'));
  process.env.NODE_ENV = 'production';
  process.env.NOTION_BUILD_CACHE_DIR = directory;
});

afterEach(() => {
  assert.equal(path.dirname(directory), os.tmpdir());
  assert.ok(path.basename(directory).startsWith('notion-cache-test-'));
  fs.rmSync(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('reuses the crawl response without sharing mutations between rendered pages', async () => {
  let requests = 0;
  const load = async () => {
    requests++;
    return page();
  };
  const first = await withBuildPageCache(pageId, {}, load);
  first.block[pageId].value.content.length = 0;
  delete first.block[pageId].value.title;

  const second = await withBuildPageCache(
    pageId.replace(/-/g, '').toUpperCase(),
    { draftView: false },
    load,
  );
  assert.deepEqual(second, page());
  assert.equal(requests, 1);
});

test('coalesces concurrent requests and returns a separate copy to each caller', async () => {
  let requests = 0;
  const load = async () => {
    requests++;
    await new Promise(resolve => setTimeout(resolve, 10));
    return page();
  };
  const [first, second] = await Promise.all([
    withBuildPageCache(pageId, {}, load),
    withBuildPageCache(pageId, {}, load),
  ]);
  first.block[pageId].value.title = 'modified';
  assert.equal(second.block[pageId].value.title, 'original');
  assert.equal(requests, 1);
});

test('keeps full pages, menu metadata and draft views separate', async () => {
  let requests = 0;
  const load = async () => {
    requests++;
    return page();
  };
  for (let repeat = 0; repeat < 2; repeat++) {
    await withBuildPageCache(pageId, {}, load);
    await withBuildPageCache(pageId, { fetchCollections: false, chunkLimit: 1 }, load);
    await withBuildPageCache(pageId, { draftView: true }, load);
  }
  assert.equal(requests, 3);
});

test('retries after a rejected request instead of caching the failure', async () => {
  let requests = 0;
  const load = async () => {
    if (++requests === 1) throw new Error('temporary Notion failure');
    return page();
  };
  await assert.rejects(withBuildPageCache(pageId, {}, load), /temporary Notion failure/);
  assert.deepEqual(await withBuildPageCache(pageId, {}, load), page());
  assert.equal(requests, 2);
});

test('recovers from a corrupt file and continues when cache writes are unavailable', async () => {
  await withBuildPageCache(pageId, {}, async () => page());
  const file = path.join(directory, fs.readdirSync(directory)[0]);
  fs.writeFileSync(file, '{incomplete');
  let requests = 0;
  const load = async () => {
    requests++;
    return page();
  };
  assert.deepEqual(await withBuildPageCache(pageId, {}, load), page());
  process.env.NOTION_BUILD_CACHE_DIR = path.join(directory, 'missing-directory');
  assert.deepEqual(await withBuildPageCache(pageId, {}, load), page());
  assert.equal(requests, 2);
});

test('does not reuse pages in development or production requests outside a build', async () => {
  let requests = 0;
  const load = async () => {
    requests++;
    return page();
  };
  delete process.env.NOTION_BUILD_CACHE_DIR;
  await withBuildPageCache(pageId, {}, load);
  await withBuildPageCache(pageId, {}, load);
  process.env.NOTION_BUILD_CACHE_DIR = directory;
  process.env.NODE_ENV = 'development';
  await withBuildPageCache(pageId, {}, load);
  await withBuildPageCache(pageId, {}, load);
  assert.equal(requests, 4);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('another build worker reads the same response without fetching Notion', async () => {
  await withBuildPageCache(pageId, {}, async () => page());
  const code = `
    const { withBuildPageCache } = require(${JSON.stringify(modulePath)});
    withBuildPageCache(${JSON.stringify(pageId)}, {}, () => {
      throw new Error('worker must reuse the crawl response');
    }).then(value => {
      require('node:assert/strict').equal(value.block[${JSON.stringify(
        pageId,
      )}].value.title, 'original');
      console.log('WORKER_REUSED_PAGE');
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const output = execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' });
  assert.match(output, /WORKER_REUSED_PAGE/);
});

test('each build gets a fresh directory, workers inherit it, and the owner cleans up', () => {
  const code = `
    delete process.env.NOTION_BUILD_CACHE_DIR;
    const config = require(${JSON.stringify(configPath)});
    config(require('next/constants').PHASE_PRODUCTION_BUILD);
    const directory = process.env.NOTION_BUILD_CACHE_DIR;
    const worker = require('node:child_process').execFileSync(process.execPath, ['-e',
      'require(' + ${JSON.stringify(
        JSON.stringify(configPath),
      )} + ')(require("next/constants").PHASE_PRODUCTION_BUILD);console.log(process.env.NOTION_BUILD_CACHE_DIR)'
    ], { encoding: 'utf8' }).trim();
    require('node:assert/strict').equal(worker, directory);
    console.log(directory);
  `;
  const run = () => execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' }).trim();
  const first = run();
  const second = run();
  assert.notEqual(first, second);
  assert.equal(fs.existsSync(first), false);
  assert.equal(fs.existsSync(second), false);
});
