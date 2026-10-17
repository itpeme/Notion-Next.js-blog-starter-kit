import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache';

// 관리자 갱신 시 게시 버전별 캐시 영역을 교체한다. 시간 기반 재생성 큐는 사용하지 않는다.
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});
