import { Client } from '@notionhq/client';

import { NextApiRequest, NextApiResponse } from 'next';

import { getCommentablePost } from '~/lib/comment-guard';
import { enableComment } from '~/lib/config';
import { notifyNewComment } from '~/lib/notify-comment';
import { checkRateLimit } from '~/lib/rate-limit';
import { verifyTurnstile } from '~/lib/turnstile';

const MAX_COMMENT_LENGTH = 2000; // Notion rich_text 한 덩어리의 최대 길이
const MAX_LINKS = 2;
const RATE_LIMIT = { limit: 5, windowSeconds: 10 * 60 };

const notion = new Client({ auth: process.env.NOTION_API_KEY });

// Next.js에서 제공하는 res.json은 \n을 자동으로 추가하기 때문에 새로 만든 함수입니다.
const responseJSON = (res: NextApiResponse, status: number, json: any) => {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').send(json);
};

const getClientIp = (req: NextApiRequest) => {
  // Cloudflare 뒤에서는 cf-connecting-ip가 실제 방문자 IP다
  const cloudflareIp = req.headers['cf-connecting-ip'];

  if (typeof cloudflareIp === 'string' && cloudflareIp) return cloudflareIp;

  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();

  return (req.headers['x-real-ip'] as string) || first || req.socket.remoteAddress || 'unknown';
};

// 브라우저가 보낸 Origin이 이 사이트와 같은지 확인 (다른 사이트에서의 요청 차단)
const isSameOrigin = (req: NextApiRequest) => {
  const origin = req.headers.origin;

  if (!origin) return true;

  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
};

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (!enableComment) {
    return responseJSON(res, 404, { message: 'comments are disabled' });
  }

  if (!process.env.NOTION_API_KEY) {
    return responseJSON(res, 503, { message: 'comments are not configured' });
  }

  const { id, cursor } = req.query;

  // 공개된 블로그 글에 대해서만 허용 (문의 DB, 비공개 글, 임의 페이지 ID 차단)
  const post = typeof id === 'string' ? await getCommentablePost(id) : null;

  if (!post) {
    return responseJSON(res, 404, { message: 'not found' });
  }

  if (req.method === 'POST') {
    if (!isSameOrigin(req)) {
      return responseJSON(res, 403, { message: 'forbidden' });
    }

    const { content, website, turnstileToken } = req.body ?? {};

    // 허니팟: 사람 눈에는 안 보이는 입력란이 채워져 있으면 봇. 성공한 것처럼 응답만 한다.
    if (typeof website === 'string' && website.trim()) {
      return responseJSON(res, 200, { ok: true });
    }

    if (typeof content !== 'string' || !content.trim()) {
      return responseJSON(res, 400, { message: 'content is required' });
    }

    const text = content.trim();

    if (text.length > MAX_COMMENT_LENGTH) {
      return responseJSON(res, 400, {
        message: `content must be ${MAX_COMMENT_LENGTH} characters or fewer`,
      });
    }

    if ((text.match(/https?:\/\//gi) || []).length > MAX_LINKS) {
      return responseJSON(res, 400, { message: 'too many links' });
    }

    const ip = getClientIp(req);
    const rate = await checkRateLimit(`comment:${ip}`, RATE_LIMIT);

    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return responseJSON(res, 429, { message: 'too many requests' });
    }

    if (!(await verifyTurnstile(turnstileToken, ip))) {
      return responseJSON(res, 400, { message: 'captcha verification failed' });
    }

    try {
      await notion.comments.create({
        parent: { page_id: post.pageId },
        rich_text: [{ text: { content: text } }],
      });
    } catch (error) {
      console.error('comment create error', error?.code, error?.status);
      return responseJSON(res, 502, { message: 'failed to create comment' });
    }

    await notifyNewComment({ pageId: post.pageId, title: post.title, content: text });

    return responseJSON(res, 200, { ok: true });
  }

  if (req.method === 'GET') {
    try {
      const result = await notion.comments.list({
        block_id: post.pageId,
        ...(typeof cursor === 'string' && cursor && { start_cursor: cursor }),
      });

      // 화면에 필요한 값만 내려준다
      return responseJSON(res, 200, {
        results: result.results.map((item: any) => ({
          id: item.id,
          created_time: item.created_time,
          created_by: { id: item.created_by?.id },
          rich_text: (item.rich_text || []).map((text: any) => ({ plain_text: text.plain_text })),
        })),
        has_more: result.has_more,
        next_cursor: result.next_cursor,
      });
    } catch (error) {
      console.error('comment list error', error?.code, error?.status);
      return responseJSON(res, 502, { message: 'failed to load comments' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return responseJSON(res, 405, { message: 'method not allowed' });
};
