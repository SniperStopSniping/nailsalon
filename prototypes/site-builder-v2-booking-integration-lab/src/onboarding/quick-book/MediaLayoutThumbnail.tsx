import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';

import type { MediaLayoutId } from './media-layouts';
import { MediaQuickBookHeader } from './MediaQuickBookHeader';
import { deriveQuickBookPresentation, type QuickBookPresentationProfile, resolveQuickBookCoverSlot, resolveQuickBookPortraitSlot } from './presentation-view';
import type { QuickBookLayoutPosterProps } from './QuickBookLayoutPoster';

export function MediaLayoutThumbnail({ layout, businessName, technicianName, logoUrl, portraitUrl, portraitVisible, coverUrl, style, className, profile }: QuickBookLayoutPosterProps & { layout: MediaLayoutId }) {
  const ref = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [bounds, setBounds] = useState({ width: 300, height: 450 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '250px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setBounds({ width: ref.current?.clientWidth || 300, height: canvas.current?.offsetHeight || 450 });
    });
    observer.observe(ref.current);
    if (canvas.current) observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [visible]);
  const seed = profile ?? {
    identity: { salonName: businessName, technicianName, logoUrl, technicianPhotoUrl: portraitVisible ? portraitUrl : null },
    location: null, hours: null, contact: null, policies: [], reviews: null, instagram: null, bio: null,
  };
  const presentation = deriveQuickBookPresentation(seed, layout);
  const preview: QuickBookPresentationProfile = {
    ...seed,
    identity: { ...seed.identity, salonName: businessName, technicianName, logoUrl, technicianPhotoUrl: portraitVisible ? portraitUrl : null },
    presentation: {
      ...presentation,
      ...(profile?.presentation ?? {}),
      layoutId: layout,
      cover: resolveQuickBookCoverSlot({ layout, url: coverUrl, focal: profile?.presentation.cover?.kind === 'custom' ? profile.presentation.cover.focal : null }),
      portrait: resolveQuickBookPortraitSlot({ layout, url: portraitUrl, alt: technicianName ?? businessName, visible: portraitVisible, focal: profile?.presentation.portrait.kind === 'custom' ? profile.presentation.portrait.focal : null }),
      gallery: [],
    },
  };
  const scale = bounds.width / 390;
  return (
    <span aria-hidden="true" className={`qb-poster qbm-thumbnail ${className ?? ''}`} data-qb-layout={layout} data-testid={`quick-book-layout-poster-${layout}`} ref={ref} style={{ ...style, height: visible ? bounds.height * scale : 240 } as CSSProperties}>
      {visible ? <div className="qbm-thumbnail-canvas" inert ref={canvas} style={{ transform: `scale(${scale})` }}><MediaQuickBookHeader bookingHref="#booking" headingId={`thumbnail-${id}`} layoutId={layout} profile={preview} thumbnail /></div> : null}
    </span>
  );
}
