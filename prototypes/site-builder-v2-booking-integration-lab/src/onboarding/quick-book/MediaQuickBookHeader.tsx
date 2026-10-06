import { ArrowRight, Instagram } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { BalancedFacts, selectPrimaryFacts } from './BalancedFacts';
import { getMediaQuickBookLayout, type MediaLayoutId } from './media-layouts';
import { DEFAULT_COVER_FOCAL_POINT, DEFAULT_PORTRAIT_FOCAL_POINT, focalPointToObjectPosition } from './presentation-view';
import { type QuickBookPresentationProps, QuickBookSecondaryDetails } from './QuickBookPrimitives';

const PLACEHOLDERS = '/quick-book/placeholders';

/** Resize delivery copies, never the saved upload. Signed/other URLs stay intact. */
export function quickBookMediaUrl(src: string, width: number): string {
  if (src.startsWith(`${PLACEHOLDERS}/`)) {
    return width <= 480 ? src.replace('.webp', '-thumb.webp') : src;
  }
  try {
    const url = new URL(src);
    if (url.hostname === 'res.cloudinary.com' && url.protocol === 'https:' && url.pathname.includes('/image/upload/') && !url.pathname.includes('/s--')) {
      url.pathname = url.pathname.replace('/image/upload/', `/image/upload/f_auto,q_auto,c_limit,w_${width}/`);
      return url.toString();
    }
  } catch { /* Local and non-Cloudinary uploads use native lazy loading. */ }
  return src;
}

function Media({ asset, src, alt, position, thumbnail }: {
  asset: 'logo' | 'profile' | 'cover';
  src: string | null;
  alt: string;
  position?: string;
  thumbnail: boolean;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const ref = useRef<HTMLImageElement>(null);
  const placeholder = !src || failedSource === src;
  const source = placeholder ? `${PLACEHOLDERS}/${asset}.webp` : src;
  const width = thumbnail ? asset === 'cover' ? 480 : 160 : asset === 'cover' ? 1280 : 640;
  useEffect(() => {
    if (src && ref.current?.complete && !ref.current.naturalWidth) {
      setFailedSource(src);
    }
  }, [src]);
  return (
    <span className={`qbm-media qbm-${asset}`} data-qb-block={asset === 'profile' ? 'portrait' : asset} data-qb-image={placeholder ? 'default' : 'custom'}>
      <img
        alt={placeholder || asset === 'cover' ? '' : alt}
        decoding="async"
        loading={thumbnail ? 'lazy' : 'eager'}
        onError={() => {
          if (!placeholder) {
            setFailedSource(src);
          }
        }}
        ref={ref}
        src={quickBookMediaUrl(source, width)}
        style={{ objectPosition: placeholder ? '50% 50%' : position }}
      />
    </span>
  );
}

/** The same header mounts in public, full preview and scaled picker cards. */
export function MediaQuickBookHeader({ profile, layoutId, headingId, headingProps, bookingHref, bookingLabel = 'Book an appointment', onBook, thumbnail = false }: QuickBookPresentationProps & { layoutId: MediaLayoutId; thumbnail?: boolean }) {
  const layout = getMediaQuickBookLayout(layoutId);
  const { identity, presentation } = profile;
  const selected = selectPrimaryFacts(profile, 4);
  const secondaryFacts = selected.secondary.filter(fact => !profile.policies.some(policy => policy.text === fact.value));
  const logo = layout.supportsLogo
    ? <Media alt={`${identity.salonName} logo`} asset="logo" src={identity.logoUrl} thumbnail={thumbnail} />
    : null;
  const portrait = layout.supportsProfile
    ? <Media alt={identity.technicianName ?? identity.salonName} position={focalPointToObjectPosition(presentation.portrait.kind === 'custom' ? presentation.portrait.focal : null, DEFAULT_PORTRAIT_FOCAL_POINT)} asset="profile" src={presentation.portrait.kind === 'custom' ? presentation.portrait.url : null} thumbnail={thumbnail} />
    : null;
  const cover = layout.supportsCover
    ? <Media alt="" position={focalPointToObjectPosition(presentation.cover?.kind === 'custom' ? presentation.cover.focal : null, DEFAULT_COVER_FOCAL_POINT)} asset="cover" src={presentation.cover?.kind === 'custom' ? presentation.cover.url : null} thumbnail={thumbnail} />
    : null;
  const title = <h1 {...headingProps} id={headingId}>{identity.salonName}</h1>;
  const social = profile.instagram
    ? (
        <a className="qbm-social" href={profile.instagram.href} rel="noopener noreferrer" target="_blank">
          <Instagram aria-hidden="true" size={15} />
          {profile.instagram.label}
        </a>
      )
    : null;
  const identityCopy = (
    <div className="qbm-identity">
      {title}
      {!layout.supportsProfile && identity.technicianName ? <p className="qbm-technician">{identity.technicianName}</p> : null}
      {layout.variant === 'b' ? social : null}
    </div>
  );
  const artistCopy = identity.technicianName || profile.bio || (layout.variant !== 'b' && social)
    ? (
        <div className="qbm-artist-copy">
          {identity.technicianName ? <p className="qbm-technician">{identity.technicianName}</p> : null}
          {profile.bio ? <p className="qbm-intro">{profile.bio}</p> : null}
          {layout.variant !== 'b' ? social : null}
        </div>
      )
    : null;
  const artist = portrait
    ? (
        <div className="qbm-artist">
          {portrait}
          {artistCopy}
        </div>
      )
    : null;
  const brand = (
    <div className="qbm-brand">
      {logo}
      {identityCopy}
    </div>
  );
  const facts = <BalancedFacts facts={selected.primary} hours={profile.hours} />;
  const cta = (
    <a className="qbm-cta" data-qb-block="book" data-testid="quick-book-book-button" href={bookingHref} onClick={onBook}>
      {bookingLabel}
      <ArrowRight aria-hidden="true" size={18} />
    </a>
  );
  const secondary = (
    <QuickBookSecondaryDetails
      additionalDetails={secondaryFacts.length || selected.privacyNotes.length
        ? (
            <section>
              <h2>Business details</h2>
              {secondaryFacts.map(fact => (
                <p key={fact.id}>
                  <strong>{fact.label}</strong>
                  {' — '}
                  {fact.value}
                  {fact.detail ? ` · ${fact.detail}` : ''}
                </p>
              ))}
              {selected.privacyNotes.filter(note => !profile.location?.instructionLines.includes(note)).map(note => <p key={note}>{note}</p>)}
            </section>
          )
        : undefined}
      layout={layout}
      profile={profile}
      summaryLabel={profile.policies.length ? 'Before you book' : 'Details'}
    />
  );
  const booking = (
    <div className="qbm-booking">
      {facts}
      {cta}
      {secondary}
    </div>
  );
  let composition;
  switch (layoutId) {
    case 'text_editorial':
      composition = (
        <>
          <div className="qbm-masthead">
            {identityCopy}
            {cta}
          </div>
          <div className="qbm-footer">
            {facts}
            {secondary}
          </div>
        </>
      );
      break;
    case 'text_centered':
      composition = (
        <>
          <div className="qbm-center">{identityCopy}</div>
          {booking}
        </>
      );
      break;
    case 'text_booking_card':
      composition = (
        <div className="qbm-card">
          <div className="qbm-card-intro">
            {identityCopy}
            {profile.bio ? <p className="qbm-intro">{profile.bio}</p> : null}
          </div>
          {booking}
        </div>
      );
      break;
    case 'logo_lockup':
      composition = (
        <>
          {brand}
          {booking}
        </>
      );
      break;
    case 'logo_centered':
      composition = (
        <>
          <div className="qbm-center">
            {logo}
            {identityCopy}
          </div>
          {booking}
        </>
      );
      break;
    case 'logo_rail':
      composition = (
        <>
          <div className="qbm-brand-rail">
            {logo}
            <div className="qbm-copy">{identityCopy}</div>
          </div>
          {booking}
        </>
      );
      break;
    case 'profile_side':
      composition = (
        <>
          {identityCopy}
          <div className="qbm-person-row">{artist}</div>
          {booking}
        </>
      );
      break;
    case 'profile_overlap':
      composition = (
        <>
          <div className="qbm-tint">{identityCopy}</div>
          <div className="qbm-cameo">{artist}</div>
          {booking}
        </>
      );
      break;
    case 'profile_editorial':
      composition = (
        <div className="qbm-editorial-person">
          {portrait}
          <div className="qbm-copy">
            {identityCopy}
            {artistCopy}
            {booking}
          </div>
        </div>
      );
      break;
    case 'brand_artist_split':
      composition = (
        <>
          {brand}
          {artist}
          {booking}
        </>
      );
      break;
    case 'brand_artist_centered':
      composition = (
        <>
          <div className="qbm-center">
            {identityCopy}
            <div className="qbm-signature-media">
              {portrait}
              {logo}
            </div>
            {artistCopy}
          </div>
          {booking}
        </>
      );
      break;
    case 'brand_artist_card':
      composition = (
        <div className="qbm-studio-panel">
          <div className="qbm-copy">
            {brand}
            {booking}
          </div>
          <div className="qbm-artist-panel">{artist}</div>
        </div>
      );
      break;
    case 'cover_hero':
      composition = (
        <>
          <div className="qbm-photo-hero">
            {cover}
            <div className="qbm-photo-title">{identityCopy}</div>
          </div>
          {booking}
        </>
      );
      break;
    case 'cover_split':
      composition = (
        <div className="qbm-split">
          {cover}
          <div className="qbm-copy">
            {identityCopy}
            {booking}
          </div>
        </div>
      );
      break;
    case 'cover_attached':
      composition = (
        <>
          <div className="qbm-inset-cover">{cover}</div>
          <div className="qbm-attached">
            {identityCopy}
            {booking}
          </div>
        </>
      );
      break;
    case 'cover_logo_float':
      composition = (
        <>
          <div className="qbm-float-cover">
            {cover}
            {logo}
          </div>
          {identityCopy}
          {booking}
        </>
      );
      break;
    case 'cover_logo_card':
      composition = (
        <>
          {cover}
          <div className="qbm-attached qbm-card">
            {brand}
            {booking}
          </div>
        </>
      );
      break;
    case 'cover_logo_split':
      composition = (
        <div className="qbm-split qbm-split--brand">
          <div className="qbm-copy">
            {brand}
            {booking}
          </div>
          {cover}
        </div>
      );
      break;
    case 'cover_profile_overlap':
      composition = (
        <>
          {cover}
          <div className="qbm-overlap">
            {portrait}
            {identityCopy}
          </div>
          {artistCopy}
          {booking}
        </>
      );
      break;
    case 'cover_profile_side':
      composition = (
        <>
          {cover}
          <div className="qbm-person-row">
            {identityCopy}
            {artist}
          </div>
          {booking}
        </>
      );
      break;
    case 'cover_profile_editorial':
      composition = (
        <>
          {identityCopy}
          <div className="qbm-editorial-media">
            {cover}
            {portrait}
          </div>
          {artistCopy}
          {booking}
        </>
      );
      break;
    case 'complete_masthead':
      composition = (
        <>
          {brand}
          {cover}
          <div className="qbm-cameo">{artist}</div>
          {booking}
        </>
      );
      break;
    case 'complete_split':
      composition = (
        <div className="qbm-split qbm-split--complete">
          <div className="qbm-copy">
            {brand}
            {artist}
            {booking}
          </div>
          {cover}
        </div>
      );
      break;
    case 'complete_editorial':
      composition = (
        <>
          <div className="qbm-editorial-masthead">
            {identityCopy}
            {logo}
          </div>
          <div className="qbm-editorial-media">
            {cover}
            {artist}
          </div>
          {booking}
        </>
      );
      break;
  }
  return <div aria-labelledby={headingId} className="qbm-header" data-qb-layout={layoutId} data-media-configuration={layout.mediaConfiguration} data-variant={layout.variant}>{composition}</div>;
}
