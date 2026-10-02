// Cloudflare Turnstile 서버 검증. TURNSTILE_SECRET_KEY가 없으면 검증을 건너뛴다(개발/미연동 상태).
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const isTurnstileEnabled = !!process.env.TURNSTILE_SECRET_KEY;

export async function verifyTurnstile(token: unknown, remoteIp?: string): Promise<boolean> {
  if (!isTurnstileEnabled) return true;
  if (typeof token !== 'string' || !token || token.length > 2048) return false;

  try {
    const body = new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY as string,
      response: token,
    });

    if (remoteIp) body.set('remoteip', remoteIp);

    const res = await fetch(VERIFY_URL, { method: 'POST', body });
    const data = (await res.json()) as { success?: boolean };

    return !!data.success;
  } catch (err) {
    console.error('turnstile verify error', err);
    return false;
  }
}
