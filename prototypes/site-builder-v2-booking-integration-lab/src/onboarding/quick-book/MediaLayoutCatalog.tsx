import { ChevronDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { getMediaQuickBookLayout, isMediaQuickBookLayout, type MediaConfiguration, type MediaLayoutDefinition, QUICK_BOOK_MEDIA_GROUPS, QUICK_BOOK_MEDIA_LAYOUTS } from './media-layouts';

/** Media never gates browsing. One expanded group keeps mobile scanning light. */
export function MediaLayoutCatalog({ selectedId, renderCard }: { selectedId: string; renderCard: (layout: MediaLayoutDefinition) => ReactNode }) {
  const [openGroup, setOpenGroup] = useState<MediaConfiguration | null>(() => isMediaQuickBookLayout(selectedId) ? getMediaQuickBookLayout(selectedId).mediaConfiguration : 'text');
  return (
    <div className="qbm-catalog">
      <p className="qbm-catalog-intro">
        <strong>24 designs total.</strong>
        <span>Open any group below to see its 3 layouts.</span>
      </p>
      {QUICK_BOOK_MEDIA_GROUPS.map(group => (
        <details data-media-group={group.id} key={group.id} open={group.id === openGroup}>
          {/* Native summary activates click from Enter/Space; keep its disclosure semantics. */}
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <summary onClick={(event) => {
            event.preventDefault();
            setOpenGroup(current => current === group.id ? null : group.id);
          }}
          >
            <span className="qbm-catalog-group-label">
              <span>{group.label}</span>
              <small>{group.id === openGroup ? '3 designs · Tap to hide' : '3 designs · Tap to view'}</small>
            </span>
            <ChevronDown className="qbm-catalog-chevron" aria-hidden="true" />
          </summary>
          <div className="qbm-catalog-grid">{QUICK_BOOK_MEDIA_LAYOUTS.filter(layout => layout.mediaConfiguration === group.id).map(renderCard)}</div>
        </details>
      ))}
    </div>
  );
}
