type Clock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

/** 한 클라이언트의 모든 API와 재시도가 요청 시작 간격·429 대기를 공유한다. */
export class NotionRequestScheduler {
  private nextStartAt = 0;
  private cooldownUntil = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly intervalMs: number,
    private readonly clock: Clock = {
      now: () => Date.now(),
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    },
  ) {}

  public waitForTurn(): Promise<void> {
    const turn = this.queue.then(async () => {
      // 대기 중 다른 요청이 429를 받으면 연장된 공통 대기 시간을 다시 확인한다.
      let delay = Math.max(this.nextStartAt, this.cooldownUntil) - this.clock.now();
      while (delay > 0) {
        // 긴 Retry-After도 타이머 정수 범위를 넘지 않도록 나눠서 기다린다.
        await this.clock.sleep(Math.min(delay, 60000));
        delay = Math.max(this.nextStartAt, this.cooldownUntil) - this.clock.now();
      }
      this.nextStartAt = this.clock.now() + this.intervalMs;
    });
    // 응답 완료가 아니라 요청 시작만 순서대로 허용해 느린 요청이 나머지를 막지 않는다.
    this.queue = turn.catch(() => {});
    return turn;
  }

  public pause(delayMs: number): number {
    const now = this.clock.now();
    this.cooldownUntil = Math.max(this.cooldownUntil, now + delayMs);
    return this.cooldownUntil - now;
  }
}

/** Retry-After의 초 단위와 HTTP-date 형식을 모두 지원한다 (RFC 9110 §10.2.3). */
export function parseRetryAfter(value: string | null, now = Date.now()): number {
  if (!value?.trim()) return 0;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const delay = Number(trimmed) * 1000;
    return Number.isFinite(delay) ? delay : 0;
  }
  // 음수나 소수를 Date.parse가 날짜로 오인하지 않게 한다.
  if (!/^[a-z]/i.test(trimmed)) return 0;
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}
