import { type ReactNode, useState } from 'react';

import { getMediaQuickBookLayout, isMediaQuickBookLayout, QUICK_BOOK_MEDIA_GROUPS, QUICK_BOOK_MEDIA_LAYOUTS, type MediaConfiguration, type MediaLayoutDefinition } from './media-layouts';

/** Media never gates browsing. One expanded group keeps mobile scanning light. */
export function MediaLayoutCatalog({ selectedId, renderCard }: { selectedId: string; renderCard: (layout: MediaLayoutDefinition) => ReactNode }) {
  const [openGroup, setOpenGroup] = useState<MediaConfiguration | null>(() => isMediaQuickBookLayout(selectedId) ? getMediaQuickBookLayout(selectedId).mediaConfiguration : 'text');
  return (
    <div className="qbm-catalog">
      {QUICK_BOOK_MEDIA_GROUPS.map((group, index) => (
        <details data-media-group={group.id} key={group.id} open={group.id === openGroup}>
          <summary onClick={(event) => { event.preventDefault(); setOpenGroup(current => current === group.id ? null : group.id); }}>{`${index < 4 ? 'No cover' : 'With cover'} · ${group.label}`}<small>{' · 3 designs'}</small></summary>
          <div className="qbm-catalog-grid">{QUICK_BOOK_MEDIA_LAYOUTS.filter(layout => layout.mediaConfiguration === group.id).map(renderCard)}</div>
        </details>
      ))}
    </div>
  );
}
