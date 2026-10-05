import { NextApiRequest, NextApiResponse } from 'next';

import { enableComment } from '~/lib/config';
import { MAX_POSTS, getRecentComments } from '~/lib/recent-comments';

// 홈 사이드바의 '최근 댓글'. 화면에 보이는 공개 글 ID(최신 글 위주)를 받아 그 글들의 댓글만 모은다.
export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (!enableComment || !process.env.NOTION_API_KEY) {
    return res.status(200).json({ results: [] });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'method not allowed' });
  }

  const ids = Array.isArray(req.body?.ids)
    ? (req.body.ids as unknown[])
        .filter((id): id is string => typeof id === 'string' && id.length <= 40)
        .slice(0, MAX_POSTS)
    : [];

  if (!ids.length) {
    return res.status(200).json({ results: [] });
  }

  try {
    const results = await getRecentComments(ids);

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=300');
    return res.status(200).json({ results });
  } catch (error) {
    console.error('recent comments error', error);
    return res.status(502).json({ message: 'failed to load recent comments' });
  }
};
