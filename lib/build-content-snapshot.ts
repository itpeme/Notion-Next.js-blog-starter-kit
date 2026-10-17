/* eslint-disable @typescript-eslint/no-var-requires -- Node.js 빌드에서만 파일을 쓴다. */
import type { PublishedIndex, SavedPage } from './content-types';
import { BOOTSTRAP_CONTENT_PATH } from './content-paths';

function write(file: string, value: unknown) {
  if (process.env.NODE_ENV !== 'production' || !process.env.NOTION_BUILD_CACHE_DIR) return;
  const fs = require('node:fs');
  const path = require('node:path');
  const directory = path.join(process.cwd(), 'public', BOOTSTRAP_CONTENT_PATH);
  const destination = path.join(directory, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${require('node:crypto').randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), 'utf8');
  fs.renameSync(temporary, destination);
}

export function writeBootstrapIndex(index: PublishedIndex) {
  write('index.json', index);
}

export function writeBootstrapPage(page: SavedPage) {
  if (page.error || !page.pageId) return;
  write(`pages/${page.pageId.replace(/-/g, '').toLowerCase()}.json`, page);
}
