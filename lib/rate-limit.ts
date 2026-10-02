import { db } from './db';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * 고정 윈도우 방식 요청 제한. 저장소는 lib/db(기본 메모리, Redis 활성화 시 Redis)를 쓴다.
 * 메모리 저장소는 서버리스 인스턴스마다 따로 동작하므로, 운영에서 엄격히 막으려면 Redis를 켠다.
 */
export async function checkRateLimit(
  key: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number },
): Promise<RateLimitResult> {
  const storeKey = `rate-limit:${key}`;
  const now = Date.now();

  let entry: RateLimitEntry | undefined;

  try {
    entry = (await db.get(storeKey)) as RateLimitEntry | undefined;
  } catch {
    // 저장소 오류 시에는 막지 않는다
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (!entry || entry.resetAt <= now) {
    entry = { count: 1, resetAt: now + windowSeconds * 1000 };
  } else if (entry.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  } else {
    entry = { ...entry, count: entry.count + 1 };
  }

  try {
    await db.set(storeKey, entry, entry.resetAt - now);
  } catch {
    // ignore
  }

  return { allowed: true, retryAfterSeconds: 0 };
}
