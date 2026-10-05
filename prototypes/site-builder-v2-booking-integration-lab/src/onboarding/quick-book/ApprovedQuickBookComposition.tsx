import { ArrowRight } from 'lucide-react';

import { BalancedFacts, selectPrimaryFacts } from './BalancedFacts';
import { getQuickBookLayout } from './layouts';
import type { QuickBookPresentationProps } from './QuickBookPrimitives';
import { QuickBookCover, QuickBookLogo, QuickBookPortrait, QuickBookSecondaryDetails } from './QuickBookPrimitives';

export const APPROVED_QUICK_BOOK_LAYOUTS = ['compact_dropdown', 'side_portrait', 'hero_banner'] as const;
export type ApprovedQuickBookLayout = typeof APPROVED_QUICK_BOOK_LAYOUTS[number];

export function isApprovedQuickBookLayout(id: string | null | undefined): id is ApprovedQuickBookLayout {
  return typeof id === 'string' && (APPROVED_QUICK_BOOK_LAYOUTS as readonly string[]).includes(id);
}

function BrandIdentity({ profile, headingId, headingProps }: Pick<QuickBookPresentationProps, 'profile' | 'headingId' | 'headingProps'>) {
  const logo = profile.identity.logoUrl ? <QuickBookLogo name={profile.identity.salonName} src={profile.identity.logoUrl} /> : null;
  const title = <h1 {...headingProps} id={headingId}>{profile.identity.salonName}</h1>;
  if (profile.presentation.layoutId === 'compact_dropdown') {
    return (
      <header className="qbp-brand" data-long-name={profile.identity.salonName.length > 26}>
        {logo}
        <div className="qbp-brand-copy">
          {title}
          {profile.identity.technicianName ? <p>{profile.identity.technicianName}</p> : null}
        </div>
      </header>
    );
  }
  return (
    <header className="qbp-brand" data-long-name={profile.identity.salonName.length > 26}>
      {title}
      {logo}
      {profile.presentation.layoutId !== 'side_portrait' && profile.identity.technicianName ? <p>{profile.identity.technicianName}</p> : null}
    </header>
  );
}

function BookingCTA({ bookingHref, bookingLabel, onBook }: Pick<QuickBookPresentationProps, 'bookingHref' | 'bookingLabel' | 'onBook'>) {
  return (
    <a className="qbp-cta" data-qb-block="book" data-testid="quick-book-book-button" href={bookingHref} onClick={onBook}>
      {bookingLabel}
      <ArrowRight aria-hidden="true" size={18} />
    </a>
  );
}

export function ApprovedQuickBookComposition({ profile, layout, headingId, headingProps, bookingHref, bookingLabel = 'Book an appointment', onBook }: QuickBookPresentationProps & { layout: ApprovedQuickBookLayout }) {
  const facts = selectPrimaryFacts(profile, layout === 'compact_dropdown' ? 3 : 4);
  // Adapters can already include booking status in permitted policies. Keep one
  // occurrence in the disclosure rather than repeating the same saved value.
  const secondaryFacts = facts.secondary.filter(fact => !profile.policies.some(policy => policy.text === fact.value));
  const privacyNotes = facts.privacyNotes.filter(note => !profile.location?.instructionLines.includes(note));
  const secondary = (
    <QuickBookSecondaryDetails
      additionalDetails={secondaryFacts.length || privacyNotes.length
        ? (
            <section>
              <h2>Business details</h2>
              <dl className="qbp-secondary-facts">
                {secondaryFacts.map(fact => (
                  <div key={fact.id}>
                    <dt>{fact.label}</dt>
                    <dd>
                      {fact.value}
                      {fact.detail ? <small>{fact.detail}</small> : null}
                    </dd>
                  </div>
                ))}
              </dl>
              {privacyNotes.map(note => <p key={note}>{note}</p>)}
            </section>
          )
        : undefined}
      layout={getQuickBookLayout(layout)}
      profile={profile}
      summaryLabel={profile.policies.length ? 'Before you book' : layout === 'side_portrait' ? `About ${profile.identity.technicianName ?? 'the studio'}` : 'Details'}
    />
  );
  const brand = <BrandIdentity headingId={headingId} headingProps={headingProps} profile={profile} />;
  const practical = <BalancedFacts facts={facts.primary} hours={profile.hours} />;
  if (layout === 'compact_dropdown') {
    return (
      <div aria-labelledby={headingId} data-qb-layout={layout} className="qbp-header qbp-compact">
        {brand}
        {practical}
        {secondary}
      </div>
    );
  }
  if (layout === 'side_portrait') {
    return (
      <div aria-labelledby={headingId} data-qb-layout={layout} className="qbp-header qbp-personal">
        {brand}
        <div className="qbp-person-composition" data-long-person={(profile.identity.technicianName?.length ?? 0) > 25}>
          <QuickBookPortrait shape="tall" slot={profile.presentation.portrait} />
          <div className="qbp-person-copy">
            {profile.identity.technicianName ? <p className="qbp-artist">{profile.identity.technicianName}</p> : null}
            {profile.bio ? <p className="qbp-intro">{profile.bio}</p> : null}
          </div>
        </div>
        {practical}
        <BookingCTA bookingHref={bookingHref} bookingLabel={bookingLabel} onBook={onBook} />
        {secondary}
      </div>
    );
  }
  return (
    <div aria-labelledby={headingId} data-qb-layout={layout} className="qbp-header qbp-visual" data-cover={profile.presentation.cover?.kind ?? 'none'}>
      <QuickBookCover slot={profile.presentation.cover} text={null} />
      <div className="qbp-hero-copy">
        {brand}
        {profile.presentation.coverText ? <p className="qbp-intro">{profile.presentation.coverText}</p> : null}
        {practical}
        <BookingCTA bookingHref={bookingHref} bookingLabel={bookingLabel} onBook={onBook} />
        {secondary}
      </div>
    </div>
  );
}
