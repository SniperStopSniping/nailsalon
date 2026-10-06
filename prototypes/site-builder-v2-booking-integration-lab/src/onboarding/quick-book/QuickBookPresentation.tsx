import type { ReactNode } from 'react';

import { ApprovedQuickBookComposition, isApprovedQuickBookLayout } from './ApprovedQuickBookComposition';
import { getQuickBookLayout } from './layouts';
import { isMediaQuickBookLayout } from './media-layouts';
import { MediaQuickBookHeader } from './MediaQuickBookHeader';
import { BookButton, Facts, Gallery, Identity, QuickBookCover as Cover, QuickBookLogo as Logo, QuickBookPortrait as Portrait, type QuickBookPresentationProps, QuickBookSecondaryDetails as Actions, Story } from './QuickBookPrimitives';

export type { QuickBookPresentationProps } from './QuickBookPrimitives';

export function QuickBookPresentation({
  profile,
  headingId,
  headingProps,
  bookingHref,
  onBook,
  bookingLabel = 'Book an appointment',
  galleryItemHref,
}: QuickBookPresentationProps) {
  const layout = getQuickBookLayout(profile.presentation.layoutId);
  if (isMediaQuickBookLayout(layout.id)) {
    return <MediaQuickBookHeader bookingHref={bookingHref} bookingLabel={bookingLabel} headingId={headingId} headingProps={headingProps} layoutId={layout.id} onBook={onBook} profile={profile} />;
  }
  if (isApprovedQuickBookLayout(layout.id)) {
    return <ApprovedQuickBookComposition bookingHref={bookingHref} bookingLabel={bookingLabel} headingId={headingId} headingProps={headingProps} layout={layout.id} onBook={onBook} profile={profile} />;
  }
  const { presentation, identity } = profile;
  const portrait = <Portrait shape={layout.portraitShape === 'tall' ? 'tall' : 'circle'} slot={presentation.portrait} />;
  const cover = <Cover slot={presentation.cover} text={presentation.coverText} />;
  const book = <BookButton href={bookingHref} label={bookingLabel} onBook={onBook} />;
  // The content recipe, not the presence of a field, decides what this
  // composition puts above booking. Anything it leaves out stays reachable
  // through Salon details, About or Before you book.
  const showLogo = layout.logo !== 'omitted' && (Boolean(identity.logoUrl) || !['compact_dropdown', 'ultra_minimal', 'clean_card'].includes(layout.id));
  const logoNode = showLogo
    ? <Logo name={identity.salonName} src={identity.logoUrl} />
    : null;
  const factsNode = <Facts profile={profile} variant={layout.facts} />;

  const actionsNode = <Actions layout={layout} profile={profile} />;
  const coverUrl = presentation.cover?.kind === 'custom' ? presentation.cover.url : null;
  const galleryItems = layout.id === 'gallery_header' && presentation.cover?.kind === 'custom'
    ? presentation.gallery.filter(item => item.url !== coverUrl)
    : presentation.gallery;
  const gallery = <Gallery galleryItemHref={galleryItemHref} items={galleryItems} />;
  const identityProps = { headingId, headingProps, profile };
  const centred = layout.id === 'profile_overlay' || layout.id === 'story_banner';
  const usesInlineStory = layout.story;

  let body: ReactNode;
  switch (layout.id) {
    case 'portrait_rail':
      body = (
        <>
          <div className="qb-rail">
            <div className="qb-rail__copy">
              <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
              {presentation.coverText ? <p className="qb-tagline">{presentation.coverText}</p> : null}
            </div>
            {portrait}
          </div>
          {factsNode}
          {book}
        </>
      );
      break;
    case 'floating_profile':
      body = (
        <>
          <div className="qb-band qb-float">
            <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
            <span className="qb-blob">{portrait}</span>
          </div>
          {factsNode}
          {book}
        </>
      );
      break;
    case 'signature_stack':
      body = (
        <>
          <div className="qb-band qb-float">
            <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
            <span className="qb-blob">{portrait}</span>
          </div>
          <Story greeting={false} profile={profile} />
          {factsNode}
          {book}
        </>
      );
      break;
    case 'concierge_panel':
      body = (
        <>
          <Identity {...identityProps} showLogo={showLogo} showPerson={false} showSpecialties={false} />
          <div className="qb-panel" data-qb-block="person-card">
            {portrait}
            <div className="qb-panel__copy">
              {identity.technicianName
                ? <p className="qb-panel__name">{identity.technicianName}</p>
                : <p className="qb-panel__name">{identity.salonName}</p>}
              <p className="qb-panel__role">{identity.technicianName ? 'Your nail tech' : 'Nail studio'}</p>
              {profile.bio ? <p className="qb-panel__bio" data-testid="quick-book-bio">{profile.bio}</p> : null}
            </div>
          </div>
          {factsNode}
          {book}
        </>
      );
      break;
    case 'premium_split':
      body = (
        <>
          <div className="qb-split">
            <div className="qb-split__panel">
              {logoNode}
              <h1 {...headingProps} className="qb-name qb-split__title" id={headingId}>{identity.salonName}</h1>
              {presentation.coverText ? <p className="qb-split__copy">{presentation.coverText}</p> : null}
            </div>
            <Cover slot={presentation.cover} text={null} />
          </div>
          {identity.technicianName || presentation.specialties.length > 0 || presentation.portrait.kind !== 'none'
            ? (
                <div className="qb-band">
                  <Identity {...identityProps} nameInPanel showLogo={false} showSpecialties={false} />
                  {portrait}
                </div>
              )
            : null}
          {factsNode}
          {book}
        </>
      );
      break;
    case 'asymmetric_luxe':
      body = (
        <>
          <div className="qb-luxe">
            <Cover slot={presentation.cover} text={null} />
            <div className="qb-luxe__panel">
              <h1 {...headingProps} className="qb-name qb-luxe__title" id={headingId}>{identity.salonName}</h1>
              {presentation.coverText ? <p className="qb-luxe__copy">{presentation.coverText}</p> : null}
              {logoNode}
            </div>
            {portrait}
          </div>
          {identity.technicianName || presentation.specialties.length > 0
            ? <Identity {...identityProps} nameInPanel showLogo={false} showSpecialties={false} />
            : null}
          {factsNode}
          {book}
        </>
      );
      break;
    case 'profile_overlay':
    case 'story_banner':
      body = (
        <>
          <div className="qb-cover-stack">
            {cover}
            {logoNode}
          </div>
          <div className="qb-overlap">{portrait}</div>
          <Identity {...identityProps} align="center" showLogo={false} showSpecialties={false} />
          {usesInlineStory ? <Story greeting={false} profile={profile} /> : null}
          {factsNode}
          {book}
        </>
      );
      break;
    case 'hero_ribbon':
      body = (
        <>
          <div className="qb-ribbon">
            {cover}
            {logoNode}
            {portrait}
          </div>
          <Identity {...identityProps} showLogo={false} showSpecialties={false} />
          {factsNode}
          {book}
        </>
      );
      break;
    case 'hero_banner':
    case 'story_intro':
    case 'gallery_header':
      body = (
        <>
          {cover}
          {/* The gallery strip sits under a flush band; the other two overlap the cover edge. */}
          <div className={layout.id === 'gallery_header' ? 'qb-band' : 'qb-band qb-band--overlap'}>
            <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
            {portrait}
          </div>
          {layout.id === 'gallery_header' ? gallery : null}
          {usesInlineStory ? <Story greeting={false} profile={profile} /> : null}
          {factsNode}
          {book}
        </>
      );
      break;
    case 'compact_details':
      body = (
        <>
          <div className="qb-band">
            <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
            {portrait}
          </div>
          {factsNode}
          {book}
        </>
      );
      break;
    case 'clean_card_pro':
      body = (
        <>
          <div className="qb-band">
            <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
            {portrait}
          </div>
          {factsNode}
          {book}
        </>
      );
      break;
    case 'editorial_split':
      body = (
        <>
          <div className="qb-band qb-band--editorial">
            <div className="qb-band__copy">
              {logoNode}
              <Identity {...identityProps} showLogo={false} showSpecialties={false} />
            </div>
            <span className="qb-blob qb-blob--small">{portrait}</span>
          </div>
          {factsNode}
          {book}
        </>
      );
      break;
    case 'compact_dropdown':
      body = (
        <>
          <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
          {factsNode}
        </>
      );
      break;
    case 'ultra_minimal':
      body = (
        <div className="qb-minimal">
          <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
          {factsNode}
        </div>
      );
      break;
    case 'clean_card':
      body = (
        <>
          <Identity {...identityProps} align="center" showLogo={showLogo} showSpecialties={false} />
          {factsNode}
          {book}
        </>
      );
      break;
    case 'profile_story':
      body = (
        <>
          <div className="qb-band">
            <Identity {...identityProps} showLogo={false} showSpecialties={false} />
            {portrait}
          </div>
          <Story greeting={false} profile={profile} />
          {factsNode}
          {book}
        </>
      );
      break;
    case 'side_portrait':
    default:
      body = (
        <>
          <div className="qb-band">
            <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
            {portrait}
          </div>
          {factsNode}
          {book}
        </>
      );
      break;
  }

  return (
    <div
      className="qb-presentation"
      data-qb-centred={centred ? 'true' : undefined}
      data-qb-family={layout.family}
      data-qb-layout={layout.id}
      data-qb-long-name={identity.salonName.length > 26 ? 'true' : undefined}
    >
      <div className="qb-main">{body}</div>
      {actionsNode}
    </div>
  );
}
