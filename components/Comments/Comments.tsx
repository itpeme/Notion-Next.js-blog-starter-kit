import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import axios from 'axios';
import cs from 'classnames';
import { formatDistance } from 'date-fns';
import ko from 'date-fns/locale/ko';
import { useFormik } from 'formik';
import useSWR from 'swr';

import { ExtendedRecordMap } from '~/packages/notion-types';

const MAX_COMMENT_LENGTH = 2000;
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

const ERROR_MESSAGES: Record<number, string> = {
  400: '내용을 확인하거나 보안 확인을 다시 진행해주세요.',
  404: '댓글을 작성할 수 없는 글입니다.',
  429: '댓글을 너무 자주 작성했어요. 잠시 후 다시 시도해주세요.',
};

interface CommentsProps {
  pageId: string;
  recordMap: ExtendedRecordMap;
}

const Comments = ({ pageId, recordMap }: CommentsProps) => {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);
  const { data, mutate } = useSWR(`/api/comments/${pageId}`);

  // Cloudflare Turnstile (NEXT_PUBLIC_TURNSTILE_SITE_KEY가 있을 때만 사용)
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileRef.current) return;

    const w = window as any;

    const render = () => {
      if (!w.turnstile || !turnstileRef.current || turnstileWidgetId.current !== null) return;

      turnstileWidgetId.current = w.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
      });
    };

    if (w.turnstile) {
      render();
    } else {
      let script = document.querySelector<HTMLScriptElement>(
        `script[src="${TURNSTILE_SCRIPT_SRC}"]`,
      );

      if (!script) {
        script = document.createElement('script');
        script.src = TURNSTILE_SCRIPT_SRC;
        script.async = true;
        document.head.appendChild(script);
      }

      script.addEventListener('load', render);

      return () => script?.removeEventListener('load', render);
    }

    return () => {
      if (turnstileWidgetId.current !== null && w.turnstile) {
        w.turnstile.remove(turnstileWidgetId.current);
        turnstileWidgetId.current = null;
      }
    };
  }, []);

  const formik = useFormik({
    initialValues: {
      content: '',
      website: '', // 허니팟: 사람에게는 보이지 않는 입력란
    },
    onSubmit: async values => {
      if (values.content.trim()) {
        if (TURNSTILE_SITE_KEY && !turnstileToken) {
          setErrorMessage('보안 확인이 끝난 뒤 다시 시도해주세요.');
          return;
        }

        setLoading(true);
        setErrorMessage('');

        try {
          await axios.post(`/api/comments/${pageId}`, {
            content: values.content.trim(),
            website: values.website,
            turnstileToken,
          });

          formik.resetForm();
          await mutate();
        } catch (err) {
          const status = err?.response?.status;
          setErrorMessage(
            ERROR_MESSAGES[status] || '댓글을 등록하지 못했어요. 잠시 후 다시 시도해주세요.',
          );
        } finally {
          setLoading(false);

          // Turnstile 토큰은 1회용이므로 요청 후 초기화
          if (TURNSTILE_SITE_KEY && turnstileWidgetId.current !== null) {
            (window as any).turnstile?.reset(turnstileWidgetId.current);
            setTurnstileToken('');
          }
        }
      }
    },
  });

  const comments = (data?.results || []).map(item => {
    const user = recordMap.notion_user[item.created_by.id]?.value || {
      id: 'guest',
      name: '익명',
      profile_photo: '/comment.png',
    };

    return {
      id: item.id,
      user: user,
      text: item?.rich_text?.[0]?.plain_text || '내용을 불러올 수 없습니다.',
      isOwner: user?.id !== 'guest',
      createdAt: formatDistance(new Date(), new Date(item.created_time), {
        locale: ko,
      }),
    };
  });

  return (
    <div className="notion-comments">
      <h2 className="notion-h notion-h1">댓글</h2>

      <form className={cs('item', loading && 'loading')} onSubmit={formik.handleSubmit}>
        <img className="profileImage guest" src="/comment.png" alt="guest" />

        <div className="right">
          <div className="content">
            <div className="bg" />
            <textarea
              name="content"
              placeholder={`안녕하세요 👋\n이곳에 댓글 내용을 작성해주세요.`}
              rows={6}
              maxLength={MAX_COMMENT_LENGTH}
              value={formik.values.content}
              onChange={formik.handleChange}
            />

            <input
              className="honeypot"
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={formik.values.website}
              onChange={formik.handleChange}
            />

            <button type="submit">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                <path d="M16 2H8C4.691 2 2 4.691 2 8v12a1 1 0 0 0 1 1h13c3.309 0 6-2.691 6-6V8c0-3.309-2.691-6-6-6zm4 13c0 2.206-1.794 4-4 4H4V8c0-2.206 1.794-4 4-4h8c2.206 0 4 1.794 4 4v7z"></path>
                <circle cx="9.5" cy="11.5" r="1.5"></circle>
                <circle cx="14.5" cy="11.5" r="1.5"></circle>
              </svg>
            </button>
          </div>

          {TURNSTILE_SITE_KEY && <div className="turnstile" ref={turnstileRef} />}
          {errorMessage && <p className="error">{errorMessage}</p>}
        </div>
      </form>

      <div className="items">
        {comments.map(item => (
          <div key={item.id} className={cs('item', item.isOwner && 'reverse')}>
            <img
              className={cs('profileImage', item.user.id === 'guest' && 'guest')}
              src={item.user.profile_photo}
              alt={item.user.name}
            />

            <div className="right">
              <div className="content">
                <div className="bg" />
                <div className="texts">
                  {item.text.split('\n').map((text, i) => (
                    <React.Fragment key={i}>
                      {text}
                      <br />
                    </React.Fragment>
                  ))}
                </div>
              </div>

              <div className="profile">
                <div className="name">
                  {item.isOwner && (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                      <path d="M20.995 6.9a.998.998 0 0 0-.548-.795l-8-4a1 1 0 0 0-.895 0l-8 4a1.002 1.002 0 0 0-.547.795c-.011.107-.961 10.767 8.589 15.014a.987.987 0 0 0 .812 0c9.55-4.247 8.6-14.906 8.589-15.014zM12 19.897C5.231 16.625 4.911 9.642 4.966 7.635L12 4.118l7.029 3.515c.037 1.989-.328 9.018-7.029 12.264z"></path>
                      <path d="m11 12.586-2.293-2.293-1.414 1.414L11 15.414l5.707-5.707-1.414-1.414z"></path>
                    </svg>
                  )}

                  {item.user.name}
                </div>

                <div className="createdAt">{item.createdAt}전</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Comments;
