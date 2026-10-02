import Script from 'next/script';
import * as React from 'react';

import cs from 'classnames';

import { isDev } from 'lib/config';

// 예: ca-pub-1234567890123456 (NEXT_PUBLIC_ 변수는 빌드 때 값이 치환되므로 직접 참조해야 한다)
const rawClient = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;

export const adsenseClient = rawClient && /^ca-pub-\d+$/.test(rawClient) ? rawClient : null;

// 수동 광고 단위(슬롯) ID. 없으면 자동 광고만 사용한다.
export const adsensePostSlot = process.env.NEXT_PUBLIC_ADSENSE_SLOT_POST || null;

// 홈 사이드바 광고 단위(슬롯) ID
export const adsenseSidebarSlot = process.env.NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR || null;

// 개발 중에는 광고를 불러오지 않는다 (본인 광고 노출·클릭은 정책 위반 소지)
const isAdsEnabled = !!adsenseClient && !isDev;

/**
 * 애드센스 스크립트. 광고를 보여줄 페이지(콘텐츠가 있는 글 페이지)에서만 렌더링한다.
 * 문의, 404, 에러, 로딩 화면처럼 게시자 콘텐츠가 없는 페이지에는 넣지 않는다.
 */
export const AdSenseScript: React.FC = () => {
  if (!isAdsEnabled) return null;

  return (
    <Script
      id="adsense-script"
      async
      strategy="afterInteractive"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClient}`}
      crossOrigin="anonymous"
    />
  );
};

interface AdUnitProps {
  slot: string;
  format?: string;
  responsive?: boolean;
  className?: string;
}

/**
 * 수동 광고 단위. 슬롯 ID가 있을 때만 사용한다.
 * 글이 바뀌면 새로 마운트되도록 호출하는 쪽에서 key(예: pageId)를 지정한다.
 */
export const AdUnit: React.FC<AdUnitProps> = ({
  slot,
  format = 'auto',
  responsive = true,
  className,
}) => {
  React.useEffect(() => {
    if (!isAdsEnabled) return;

    try {
      const w = window as any;
      (w.adsbygoogle = w.adsbygoogle || []).push({});
    } catch (err) {
      console.error('adsense push error', err);
    }
  }, []);

  // 개발 환경에서는 광고 대신 자리 표시만 보여줘서 배치를 확인할 수 있게 한다
  if (isDev) {
    return <div className={cs('ad-placeholder', className)}>광고 영역 (개발 환경 미리보기)</div>;
  }

  if (!isAdsEnabled) return null;

  return (
    <div
      className={className}
      style={{ margin: '2rem 0', textAlign: 'center', overflow: 'hidden' }}
    >
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={adsenseClient}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive={responsive ? 'true' : 'false'}
      />
    </div>
  );
};
