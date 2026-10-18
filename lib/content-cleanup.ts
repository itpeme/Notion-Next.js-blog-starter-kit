import type { ContentBucket, ContentPointer } from './content-types';

const RETENTION_DAYS = 7;
const PREVIOUS_REVISIONS = 2;
const MAX_SCAN_OBJECTS = 50000;
const MAX_DELETE_OBJECTS = 2000;
const REVISION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type StoredObject = { key: string; size: number; uploaded: Date };

interface CleanupPlan {
  revision: string;
  retainedRevisions: string[];
  scannedObjects: number;
  candidates: StoredObject[];
}

async function currentRevision(bucket: ContentBucket, prefix: string) {
  const stored = await bucket.get(`${prefix}/current.json`);
  const pointer = stored ? await stored.json<ContentPointer>() : null;
  if (!pointer || !REVISION.test(pointer.revision)) {
    throw new Error('A valid published revision is required for cleanup');
  }
  return pointer.revision;
}

async function listObjects(bucket: ContentBucket, prefix: string, deadline: number) {
  const objects: StoredObject[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    if (Date.now() > deadline) throw new Error('Cleanup scan timed out; nothing was deleted');
    const result = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const object of result.objects) {
      if (
        !object.key.startsWith(prefix) ||
        !Number.isFinite(object.uploaded.getTime()) ||
        !Number.isFinite(object.size) ||
        object.size < 0
      )
        throw new Error('Invalid storage inventory; nothing was deleted');
      objects.push(object);
    }
    if (objects.length > MAX_SCAN_OBJECTS) throw new Error('Cleanup inventory limit exceeded');
    if (!result.truncated) break;
    if (!result.cursor || cursors.has(result.cursor)) throw new Error('Invalid storage cursor');
    cursor = result.cursor;
    cursors.add(cursor);
  } while (cursor);
  return objects;
}

async function planCleanup(
  bucket: ContentBucket,
  prefix: string,
  rootPageId: string,
  now: number,
  deadline: number,
): Promise<CleanupPlan> {
  // Never turn a malformed override into a bucket-wide deletion.
  if (!/^published-content\/v1\/[a-zA-Z0-9_-]+$/.test(prefix))
    throw new Error('Cleanup requires a scoped published-content prefix');
  const revision = await currentRevision(bucket, prefix);
  const snapshots = await listObjects(bucket, `${prefix}/revisions/`, deadline);
  const html = await listObjects(bucket, `${prefix}/html/`, deadline);
  const groups = new Map<string, { objects: StoredObject[]; files: Set<string>; newest: number }>();
  for (const object of snapshots) {
    const [id, ...parts] = object.key.slice(`${prefix}/revisions/`.length).split('/');
    if (!REVISION.test(id)) continue;
    const group = groups.get(id) || { objects: [], files: new Set<string>(), newest: 0 };
    group.objects.push(object);
    group.files.add(parts.join('/'));
    group.newest = Math.max(group.newest, object.uploaded.getTime());
    groups.set(id, group);
  }
  const required = [
    'index.json',
    'feed.xml',
    'sitemap.xml',
    `pages/${rootPageId.replace(/-/g, '')}.json`,
  ];
  const complete = (id: string) => required.every(file => groups.get(id)?.files.has(file));
  if (!complete(revision)) throw new Error('Current published snapshot is incomplete');
  const previous = [...groups.keys()]
    .filter(id => id !== revision && complete(id))
    .sort((a, b) => groups.get(b)!.newest - groups.get(a)!.newest || a.localeCompare(b))
    .slice(0, PREVIOUS_REVISIONS);
  const retained = new Set([revision, ...previous]);
  const cutoff = now - RETENTION_DAYS * 86400000;
  const candidates = [...groups.entries()]
    .filter(([id, group]) => !retained.has(id) && group.newest < cutoff)
    .flatMap(([, group]) => group.objects);
  for (const object of html) {
    const [id] = object.key.slice(`${prefix}/html/`.length).split('/');
    if (!REVISION.test(id) || retained.has(id) || object.uploaded.getTime() >= cutoff) continue;
    // A recently written snapshot can still have older cache entries.
    if ((groups.get(id)?.newest || 0) >= cutoff) continue;
    candidates.push(object);
  }
  return {
    revision,
    retainedRevisions: [...retained],
    scannedObjects: snapshots.length + html.length,
    candidates,
  };
}

// Called only while the publishing Durable Object holds its concurrency lock.
export async function cleanupPublishedContent(
  bucket: ContentBucket,
  prefix: string,
  rootPageId: string,
  execute: boolean,
  now = Date.now(),
) {
  const deadline = Date.now() + 20000;
  const plan = await planCleanup(bucket, prefix, rootPageId, now, deadline);
  let deletedObjects = 0;
  let deletedBytes = 0;
  if (execute) {
    const batchLimit = Math.min(plan.candidates.length, MAX_DELETE_OBJECTS);
    for (let offset = 0; offset < batchLimit; offset += 200) {
      if (Date.now() > deadline) break;
      if ((await currentRevision(bucket, prefix)) !== plan.revision)
        throw new Error('Published revision changed; cleanup stopped');
      const batch = plan.candidates.slice(offset, Math.min(offset + 200, batchLimit));
      await bucket.delete(batch.map(object => object.key));
      deletedObjects += batch.length;
      deletedBytes += batch.reduce((bytes, object) => bytes + object.size, 0);
    }
  }
  return {
    state: execute
      ? deletedObjects === plan.candidates.length
        ? 'complete'
        : 'partial'
      : 'planned',
    retentionDays: RETENTION_DAYS,
    previousRevisions: PREVIOUS_REVISIONS,
    currentRevision: plan.revision,
    retainedRevisions: plan.retainedRevisions,
    scannedObjects: plan.scannedObjects,
    candidateObjects: plan.candidates.length,
    candidateBytes: plan.candidates.reduce((bytes, object) => bytes + object.size, 0),
    deletedObjects,
    deletedBytes,
    remainingObjects: plan.candidates.length - deletedObjects,
    checkedAt: new Date(now).toISOString(),
  };
}
