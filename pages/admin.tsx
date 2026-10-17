import Head from 'next/head';
import * as React from 'react';
import type { RefreshStatus } from 'lib/content-types';

const ACTIVE = new Set(['queued', 'collecting', 'saving']);

export default function AdminPage() {
  const [password, setPassword] = React.useState('');
  const [status, setStatus] = React.useState<RefreshStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const active = ACTIVE.has(status?.state);

  async function request(method: 'GET' | 'POST') {
    const response = await fetch('/api/admin/refresh', {
      method,
      headers: { Authorization: `Bearer ${password}` },
      cache: 'no-store',
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || '갱신 상태를 확인하지 못했습니다.');
    return value as RefreshStatus | null;
  }

  React.useEffect(() => {
    if (!active || !password) return;
    let cancelled = false;
    const timer = setInterval(() => {
      request('GET')
        .then(value => {
          if (!cancelled) {
            setStatus(value);
            setError('');
          }
        })
        .catch(err => {
          if (!cancelled) setError(err.message);
        });
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, password]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      setStatus(await request('POST'));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const labels = {
    queued: '갱신을 준비하고 있습니다.',
    collecting: 'Notion에서 글을 불러오고 있습니다.',
    saving: '새 게시 내용을 저장하고 있습니다.',
    complete: '블로그 갱신이 완료되었습니다.',
    failed: status?.error,
  };
  return (
    <>
      <Head>
        <title>블로그 갱신 · 관리자</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <main className="admin-refresh">
        <a href="/" className="home-link">
          ← 블로그로 돌아가기
        </a>
        <h1>블로그 갱신</h1>
        <p>Notion에서 공개한 새 글과 수정 내용을 블로그에 반영합니다.</p>
        <form onSubmit={submit}>
          <label htmlFor="admin-password">관리자 비밀번호</label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={event => setPassword(event.target.value)}
            disabled={busy || active}
          />
          <button type="submit" disabled={busy || active || !password}>
            {busy || active ? '갱신 중…' : '블로그 갱신'}
          </button>
        </form>
        <p className="help">
          갱신 중에도 기존 글은 계속 표시됩니다. 창을 닫아도 시작한 작업은 계속됩니다.
        </p>
        {status && (
          <section aria-live="polite" className="status">
            <strong>{labels[status.state]}</strong>
            {active && (
              <p>
                {status.completed}개{status.total ? ` / ${status.total}개` : ''} 처리
              </p>
            )}
            {status.state === 'complete' && (
              <p>
                글 {status.published?.postCount}개 · 목록, 사이트맵, RSS 반영 완료
                <br />
                <a href="/" target="_blank" rel="noreferrer">
                  블로그 확인하기 ↗
                </a>
              </p>
            )}
          </section>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </main>
      <style jsx>{`
        .admin-refresh {
          max-width: 620px;
          margin: 64px auto;
          padding: 28px;
          font-family: system-ui, sans-serif;
          line-height: 1.7;
        }
        h1 {
          font-size: 30px;
          margin: 24px 0 8px;
        }
        p {
          color: #5b6470;
        }
        a {
          color: #2865b1;
        }
        form {
          display: grid;
          gap: 10px;
          margin-top: 28px;
        }
        label {
          font-weight: 600;
        }
        input {
          font: inherit;
          padding: 10px 14px;
          border: 1px solid #bac2cb;
          border-radius: 8px;
          min-width: 0;
        }
        button {
          font: inherit;
          font-weight: 600;
          color: white;
          background: #2865b1;
          border: 0;
          border-radius: 8px;
          padding: 12px;
          cursor: pointer;
          margin-top: 8px;
        }
        button:disabled {
          opacity: 0.55;
          cursor: default;
        }
        .help {
          font-size: 14px;
          margin-top: 18px;
        }
        .status {
          padding: 18px;
          border-radius: 10px;
          background: #f0f6fc;
          margin-top: 28px;
        }
        .status p {
          margin-bottom: 0;
        }
        .error {
          color: #b42318;
        }
        .home-link {
          font-size: 14px;
        }
        @media (max-width: 600px) {
          .admin-refresh {
            margin: 20px auto;
            padding: 20px;
          }
        }
      `}</style>
    </>
  );
}
