import * as React from 'react';
import { createPortal } from 'react-dom';

const ALL = '전체';
const ANCHOR_ID = 'gallery-filter-anchor';

/**
 * 갤러리 페이지의 카드 목록 위에 카테고리 필터(칩)를 붙인다.
 * 노션 갤러리 뷰의 카드에 표시된 `카테고리` 값을 읽어 필터 목록을 만들고,
 * 선택한 카테고리가 아닌 카드는 숨긴다. (카드는 클라이언트에서 늦게 그려질 수 있어 DOM 변화를 관찰한다)
 */
export const GalleryFilter: React.FC = () => {
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [categories, setCategories] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState(ALL);
  const selectedRef = React.useRef(selected);

  selectedRef.current = selected;

  const applyFilter = React.useCallback(() => {
    const cards = document.querySelectorAll<HTMLElement>('.notion-collection .notion-collection-card');

    cards.forEach(card => {
      const category = card.querySelector('.notion-property-select-item')?.textContent || '';
      const visible = selectedRef.current === ALL || category === selectedRef.current;

      card.style.display = visible ? '' : 'none';
    });
  }, []);

  React.useEffect(() => {
    const sync = () => {
      const collection = document.querySelector('.notion-collection');

      if (!collection?.parentNode) return;

      if (!document.getElementById(ANCHOR_ID)) {
        const bar = document.createElement('div');

        bar.id = ANCHOR_ID;
        collection.parentNode.insertBefore(bar, collection);
        setAnchor(bar);
      }

      const found = new Set<string>();

      collection.querySelectorAll('.notion-collection-card .notion-property-select-item').forEach(el => {
        if (el.textContent) found.add(el.textContent);
      });

      const next = Array.from(found).sort((a, b) => a.localeCompare(b));

      setCategories(prev => (prev.join('\n') === next.join('\n') ? prev : next));
      applyFilter();
    };

    sync();

    const observer = new MutationObserver(sync);

    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.getElementById(ANCHOR_ID)?.remove();
    };
  }, [applyFilter]);

  React.useEffect(() => {
    applyFilter();
  }, [selected, categories, applyFilter]);

  if (!anchor || !categories.length) return null;

  return createPortal(
    <div className="gallery-filter" role="tablist" aria-label="카테고리 필터">
      {[ALL, ...categories].map(name => (
        <button
          key={name}
          type="button"
          role="tab"
          aria-selected={selected === name}
          className={selected === name ? 'gallery-filter-chip active' : 'gallery-filter-chip'}
          onClick={() => setSelected(name)}
        >
          {name}
        </button>
      ))}
    </div>,
    anchor,
  );
};
