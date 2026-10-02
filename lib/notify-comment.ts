import { host } from './config';

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

/**
 * 새 댓글 이메일 알림 (Resend). 아래 환경변수가 모두 있을 때만 발송한다.
 * - RESEND_API_KEY: Resend API 키
 * - COMMENT_NOTIFY_TO: 알림 받을 이메일
 * - COMMENT_NOTIFY_FROM: (선택) 발신 주소. 기본값은 Resend 테스트 발신 주소
 * 알림 실패가 댓글 등록 자체를 막지 않도록 예외를 던지지 않는다.
 */
export async function notifyNewComment({
  pageId,
  title,
  content,
}: {
  pageId: string;
  title: string;
  content: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.COMMENT_NOTIFY_TO;

  if (!apiKey || !to) return;

  const from = process.env.COMMENT_NOTIFY_FROM || 'onboarding@resend.dev';
  const postUrl = `${host}/${pageId.replace(/-/g, '')}`;
  const subject = `[새 댓글] ${title || '제목 없음'}`.slice(0, 200);

  const html = `
    <p><strong>${escapeHtml(title || '제목 없음')}</strong> 글에 새 댓글이 달렸습니다.</p>
    <blockquote style="white-space:pre-wrap">${escapeHtml(content)}</blockquote>
    <p><a href="${postUrl}">${escapeHtml(postUrl)}</a></p>
  `;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      console.error('comment notify failed', res.status);
    }
  } catch (err) {
    console.error('comment notify error', err);
  }
}
