import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache';
import memoryQueue from '@opennextjs/cloudflare/overrides/queue/memory-queue';

// ISR(revalidate) 결과 캐시를 R2 버킷에 저장하고, 시간 기반 재생성 요청은 메모리 큐로 처리한다
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  queue: memoryQueue,
});
