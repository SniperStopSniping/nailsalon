/**
 * Miniature, schematic thumbnail of one Quick Book layout.
 *
 * Used by the onboarding Design step and the dashboard Layouts panel. It is
 * driven by the shared registry and by the SAME image-state rules as the
 * real renderer (custom image → that image, essential slot → default,
 * optional slot → nothing), so a thumbnail can never promise a composition
 * the published page will not produce. Decorative only (`aria-hidden`); the
 * accessible name of the owning control is the layout name.
 */
import type { CSSProperties } from 'react';

import { DefaultCoverIllustration, DefaultPortraitIllustration } from './DefaultImagery';
import { getQuickBookLayout, type QuickBookLayoutId } from './layouts';
import {
  type QuickBookCoverSlot,
  quickBookMonogram,
  type QuickBookPortraitSlot,
  resolveQuickBookCoverSlot,
  resolveQuickBookPortraitSlot,
} from './presentation-view';

export type QuickBookLayoutPosterProps = {
  layout: QuickBookLayoutId;
  businessName: string;
  technicianName: string | null;
  logoUrl: string | null;
  /** The owner's real portrait URL when one exists and is shown publicly. */
  portraitUrl: string | null;
  portraitVisible: boolean;
  /** The owner's custom cover URL, or null for the default. */
  coverUrl: string | null;
  specialties?: readonly string[];
  hasStory?: boolean;
  galleryCount?: number;
  style?: CSSProperties;
  className?: string;
};

const NO_SPECIALTIES: readonly string[] = [];

function PosterPortrait({ slot }: { slot: QuickBookPortraitSlot }) {
  if (slot.kind === 'none') {
    return null;
  }
  return (
    <span className="qb-poster__portrait" data-qb-image={slot.kind}>
      {slot.kind === 'custom' ? <img alt="" src={slot.url} /> : <DefaultPortraitIllustration />}
    </span>
  );
}

function PosterCover({ slot }: { slot: QuickBookCoverSlot }) {
  if (!slot) {
    return null;
  }
  return (
    <span className="qb-poster__cover" data-qb-image={slot.kind}>
      {slot.kind === 'custom' ? <img alt="" src={slot.url} /> : <DefaultCoverIllustration />}
    </span>
  );
}

export function QuickBookLayoutPoster({
  layout,
  businessName,
  technicianName,
  logoUrl,
  portraitUrl,
  portraitVisible,
  coverUrl,
  specialties = NO_SPECIALTIES,
  hasStory = false,
  galleryCount = 0,
  style,
  className,
}: QuickBookLayoutPosterProps) {
  const definition = getQuickBookLayout(layout);
  const portrait = resolveQuickBookPortraitSlot({
    layout,
    url: portraitUrl,
    alt: '',
    focal: null,
    visible: portraitVisible,
  });
  const cover = resolveQuickBookCoverSlot({ layout, url: coverUrl, focal: null });
  const name = businessName.trim() || 'Your business';
  const chips = definition.specialties ? specialties.slice(0, 3) : [];
  const galleryTiles = definition.gallery ? Math.min(Math.max(galleryCount, 0), 4) : 0;

  return (
    <span
      aria-hidden="true"
      className={`qb-poster${className ? ` ${className}` : ''}`}
      data-qb-family={definition.family}
      data-qb-layout={layout}
      data-testid={`quick-book-layout-poster-${layout}`}
      style={style}
    >
      <PosterCover slot={cover} />
      <span className="qb-poster__identity">
        <span className="qb-poster__logo">
          {logoUrl ? <img alt="" src={logoUrl} /> : <i>{quickBookMonogram(name)}</i>}
        </span>
        <span className="qb-poster__copy">
          <b>{name}</b>
          {technicianName ? <small>{technicianName}</small> : null}
          {chips.length > 0
            ? <span className="qb-poster__chips">{chips.map(chip => <i key={chip}>{chip}</i>)}</span>
            : null}
        </span>
        <PosterPortrait slot={portrait} />
      </span>
      {galleryTiles > 0
        ? (
            <span className="qb-poster__gallery">
              {Array.from({ length: galleryTiles }, (_, index) => <i key={index} />)}
            </span>
          )
        : null}
      {definition.story && hasStory ? <span className="qb-poster__story" /> : null}
      <span className="qb-poster__facts">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="qb-poster__book" />
    </span>
  );
}
