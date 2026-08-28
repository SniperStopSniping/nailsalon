import {
  CalendarDays,
  Clock3,
  Instagram,
  MapPin,
  MessageCircle,
  Sparkles,
} from 'lucide-react';
import {
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { BookingSectionRenderer } from '../../booking/BookingSectionRenderer';
import { createEmptyBookingSession, summarizeSelection } from '../../booking/helpers';
import { createDefaultBookingPresentationSettings } from '../../booking/presentation';
import type { BookingSessionState } from '../../booking/types';
import type { SiteBuilderDocument } from '../../model/types';
import {
  createOnboardingBookingFixture,
  ONBOARDING_NEXT_AVAILABILITY_LABEL,
} from '../model/booking-preview';
import type {
  AboutElementId,
  AboutPresetId,
  BusinessProfileDraft,
  OnboardingLabState,
  PolicySectionId,
  SiteStylePresetId,
} from '../model/types';
import { OnboardingCustomDesignSections } from './OnboardingCustomDesignSections';

export type OnboardingPreviewDevice = 'phone' | 'tablet' | 'desktop';

type StyleRoles = {
  accent: string;
  bodyFont: string;
  buttonRadius: string;
  ground: string;
  headingFont: string;
  ink: string;
  line: string;
  muted: string;
  radius: string;
  surface: string;
};

export const ONBOARDING_STYLE_ROLES: Record<SiteStylePresetId, StyleRoles> = {
  modern: {
    accent: '#81536c',
    bodyFont: "Inter, ui-sans-serif, system-ui, sans-serif",
    buttonRadius: '999px',
    ground: '#f7f3f0',
    headingFont: "Inter, ui-sans-serif, system-ui, sans-serif",
    ink: '#2f272b',
    line: '#ded4d7',
    muted: '#74676d',
    radius: '24px',
    surface: '#fffdfb',
  },
  editorial: {
    accent: '#6e243e',
    bodyFont: "Inter, ui-sans-serif, system-ui, sans-serif",
    buttonRadius: '2px',
    ground: '#f4efe9',
    headingFont: "Georgia, 'Times New Roman', serif",
    ink: '#211b1d',
    line: '#cfc1ba',
    muted: '#71645f',
    radius: '4px',
    surface: '#fffaf3',
  },
  soft: {
    accent: '#a45578',
    bodyFont: "Inter, ui-sans-serif, system-ui, sans-serif",
    buttonRadius: '999px',
    ground: '#fff5f7',
    headingFont: "Georgia, 'Times New Roman', serif",
    ink: '#412d36',
    line: '#ecd6de',
    muted: '#806c75',
    radius: '32px',
    surface: '#fffefe',
  },
  minimal: {
    accent: '#303b39',
    bodyFont: "Inter, ui-sans-serif, system-ui, sans-serif",
    buttonRadius: '8px',
    ground: '#f4f5f2',
    headingFont: "Inter, ui-sans-serif, system-ui, sans-serif",
    ink: '#202522',
    line: '#d5d9d3',
    muted: '#68706b',
    radius: '12px',
    surface: '#ffffff',
  },
  bold: {
    accent: '#ff5a5f',
    bodyFont: "Inter, ui-sans-serif, system-ui, sans-serif",
    buttonRadius: '0px',
    ground: '#f4df55',
    headingFont: "Arial Black, Inter, ui-sans-serif, sans-serif",
    ink: '#181818',
    line: '#181818',
    muted: '#514b28',
    radius: '0px',
    surface: '#fffdf2',
  },
  luxury: {
    accent: '#b89a5f',
    bodyFont: "Inter, ui-sans-serif, system-ui, sans-serif",
    buttonRadius: '2px',
    ground: '#171514',
    headingFont: "Georgia, 'Times New Roman', serif",
    ink: '#f6f0e5',
    line: '#4a4339',
    muted: '#bdb3a4',
    radius: '2px',
    surface: '#24211e',
  },
};

const createPreviewBookingSession = (): BookingSessionState => ({
  ...createEmptyBookingSession(),
  selection: {
    serviceId: 'svc-manicure-russian',
    addOnIds: ['addon-french'],
  },
});

const labelForVisitMode = (profile: BusinessProfileDraft): string | null => {
  switch (profile.bookingPreferences.visitMode) {
    case 'appointment_only': return 'Appointment only';
    case 'walk_ins_only': return 'Walk-ins welcome';
    case 'appointments_and_walk_ins': return 'Appointments + walk-ins';
    default: return null;
  }
};

const labelForNewClients = (profile: BusinessProfileDraft): string | null => {
  switch (profile.bookingPreferences.newClientStatus) {
    case 'yes': return 'Accepting new clients';
    case 'no': return 'Returning clients';
    case 'ask_first': return 'New clients: ask first';
    case 'waitlist_only': return 'Waitlist only';
    default: return null;
  }
};

const textForPolicy = (
  profile: BusinessProfileDraft,
  sectionId: PolicySectionId,
): string => {
  const copy = profile.policies.copy[sectionId];
  if (!copy.visible) return '';
  return copy.useSuggestedWording
    ? copy.suggestedWording.trim()
    : copy.wordingOverride.trim();
};

const isAboutVisible = (
  visibility: Record<AboutElementId, boolean>,
  id: AboutElementId,
): boolean => visibility[id];

function Portrait({ profile, large = false }: { profile: BusinessProfileDraft; large?: boolean }) {
  const source = profile.profilePhoto?.previewUrl;
  const initials = (profile.ownerName || profile.businessName || 'L')
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return source ? (
    <img
      alt={profile.profilePhoto?.altText || `${profile.ownerName || 'Business owner'} portrait`}
      className={`onboarding-customer-portrait${large ? ' is-large' : ''}`}
      src={source}
    />
  ) : (
    <span
      aria-label={`${profile.ownerName || 'Business owner'} portrait placeholder`}
      className={`onboarding-customer-portrait onboarding-customer-portrait--initials${large ? ' is-large' : ''}`}
      role="img"
    >
      {initials || 'L'}
    </span>
  );
}

function AboutActions({ profile }: { profile: BusinessProfileDraft }) {
  const visibility = profile.about.visibility;
  const hasInstagram = isAboutVisible(visibility, 'instagram') && profile.instagram.trim();
  const hasBooking = isAboutVisible(visibility, 'book_button');
  if (!hasInstagram && !hasBooking) return null;

  return (
    <div className="onboarding-customer-actions">
      {hasBooking ? <button type="button"><CalendarDays aria-hidden="true" size={16} /> Book now</button> : null}
      {hasInstagram ? <button className="is-secondary" type="button"><Instagram aria-hidden="true" size={16} /> {profile.instagram}</button> : null}
    </div>
  );
}

function AboutFacts({ profile }: { profile: BusinessProfileDraft }) {
  const visibility = profile.about.visibility;
  const facts: Array<{ label: string; value: string }> = [];
  if (isAboutVisible(visibility, 'specialties') && profile.about.specialties.length > 0) {
    facts.push({ label: 'Specialties', value: profile.about.specialties.join(' · ') });
  }
  if (isAboutVisible(visibility, 'experience') && profile.about.yearsOfExperience.trim()) {
    facts.push({ label: 'Experience', value: profile.about.yearsOfExperience.trim() });
  }
  if (isAboutVisible(visibility, 'certifications') && profile.about.certifications.length > 0) {
    facts.push({ label: 'Certifications', value: profile.about.certifications.join(' · ') });
  }
  if (isAboutVisible(visibility, 'languages') && profile.about.languages.length > 0) {
    facts.push({ label: 'Languages', value: profile.about.languages.join(' · ') });
  }
  const visitMode = labelForVisitMode(profile);
  if (isAboutVisible(visibility, 'appointment_status') && visitMode) {
    facts.push({ label: 'Visits', value: visitMode });
  }
  const newClients = labelForNewClients(profile);
  if (isAboutVisible(visibility, 'new_client_status') && newClients) {
    facts.push({ label: 'New clients', value: newClients });
  }
  if (facts.length === 0) return null;
  return (
    <dl className="onboarding-about-facts">
      {facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
    </dl>
  );
}

function AboutCopy({ profile, long = false }: { profile: BusinessProfileDraft; long?: boolean }) {
  const visibility = profile.about.visibility;
  const copy = long && profile.about.fullBio.trim()
    ? profile.about.fullBio.trim()
    : profile.about.shortBio.trim();
  const heading = isAboutVisible(visibility, 'owner_name') && profile.ownerName.trim()
    ? profile.ownerName.trim()
    : profile.businessName.trim()
      ? `About ${profile.businessName.trim()}`
      : 'About your nail artist';
  return (
    <div className="onboarding-about-copy">
      <p className="onboarding-customer-eyebrow">Meet your nail artist</p>
      <h2>{heading}</h2>
      {isAboutVisible(visibility, 'salon_name') && profile.businessName.trim()
        ? <p className="onboarding-about-salon">{profile.businessName.trim()}</p>
        : null}
      {isAboutVisible(visibility, 'bio') && copy ? <p>{copy}</p> : null}
      {profile.about.clientAppreciation.trim() ? <blockquote>“{profile.about.clientAppreciation.trim()}”</blockquote> : null}
    </div>
  );
}

function PolicySummary({ profile }: { profile: BusinessProfileDraft }) {
  const values: string[] = [];
  const notice = profile.policies.cancellations.notice;
  if (notice && notice !== 'custom') values.push(notice.replace('_', '-').replace('hours', 'hour notice'));
  if (profile.policies.deposits.required && profile.policies.deposits.amount.trim()) {
    values.push(profile.policies.deposits.amountType === 'percentage'
      ? `${profile.policies.deposits.amount.trim()}% deposit`
      : `$${profile.policies.deposits.amount.trim().replace(/^\$/u, '')} deposit`);
  }
  if (profile.policies.lateArrivals.gracePeriodMinutes.trim()) {
    values.push(`${profile.policies.lateArrivals.gracePeriodMinutes.trim()}-minute late limit`);
  }
  return values.length > 0 ? <p className="onboarding-policy-summary">{values.join(' · ')}</p> : null;
}

function AboutSection({ preset, profile, showPolicySummary }: {
  preset: AboutPresetId;
  profile: BusinessProfileDraft;
  showPolicySummary: boolean;
}) {
  const visibility = profile.about.visibility;
  const showPortrait = isAboutVisible(visibility, 'profile_photo');
  const policySummary = showPolicySummary && isAboutVisible(visibility, 'policy_summary')
    ? <PolicySummary profile={profile} />
    : null;

  if (preset === 'editorial_portrait') {
    return (
      <section aria-label="About" className="onboarding-customer-about is-editorial">
        {showPortrait ? <Portrait large profile={profile} /> : null}
        <AboutCopy long profile={profile} />
        <AboutActions profile={profile} />
      </section>
    );
  }

  if (preset === 'profile_quick_facts') {
    return (
      <section aria-label="About" className="onboarding-customer-about is-quick-facts">
        {showPortrait ? <Portrait profile={profile} /> : null}
        <AboutCopy profile={profile} />
        <AboutFacts profile={profile} />
        <AboutActions profile={profile} />
      </section>
    );
  }

  if (preset === 'about_before_you_book') {
    return (
      <section aria-label="About and before you book" className="onboarding-customer-about is-before-booking">
        <div className="onboarding-about-profile">
          {showPortrait ? <Portrait profile={profile} /> : null}
          <AboutCopy profile={profile} />
        </div>
        <div className="onboarding-before-booking-card">
          <h3>Before you book</h3>
          {labelForVisitMode(profile) ? <p><Clock3 aria-hidden="true" size={16} /> {labelForVisitMode(profile)}</p> : null}
          {labelForNewClients(profile) ? <p><Sparkles aria-hidden="true" size={16} /> {labelForNewClients(profile)}</p> : null}
          {policySummary}
        </div>
        <AboutActions profile={profile} />
      </section>
    );
  }

  return (
    <section aria-label="About" className="onboarding-customer-about is-photo-right">
      <div><AboutCopy profile={profile} /><AboutFacts profile={profile} />{policySummary}<AboutActions profile={profile} /></div>
      {showPortrait ? <Portrait large profile={profile} /> : null}
    </section>
  );
}

function ContactSection({ profile }: { profile: BusinessProfileDraft }) {
  const area = profile.location.addressVisibility === 'public' && profile.location.exactAddress.trim()
    ? profile.location.exactAddress.trim()
    : profile.location.cityOrArea.trim();
  const contact = profile.bookingOnlyContact
    ? 'Booking is the best way to reach us'
    : profile.email.trim() || profile.textPhone.trim() || profile.phone.trim() || profile.instagram.trim();
  if (!area && !contact) return null;
  return (
    <section aria-label="Visit and contact" className="onboarding-customer-contact">
      <div>
        <p className="onboarding-customer-eyebrow">Visit us</p>
        <h2>Plan your appointment</h2>
        {area ? <p><MapPin aria-hidden="true" size={17} /> {area}</p> : null}
        {profile.location.parking.trim() ? <small>{profile.location.parking.trim()}</small> : null}
      </div>
      <div className="onboarding-customer-actions">
        {area ? <button className="is-secondary" type="button">Directions</button> : null}
        {contact ? <button className="is-secondary" type="button"><MessageCircle aria-hidden="true" size={16} /> Contact</button> : null}
      </div>
    </section>
  );
}

function PoliciesSection({ profile }: { profile: BusinessProfileDraft }) {
  const cards = (['cancellations', 'deposits', 'late_arrivals', 'no_shows', 'repairs', 'other'] as const)
    .map((id) => ({ id, text: textForPolicy(profile, id) }))
    .filter((card) => card.text);
  if (cards.length === 0) return null;
  return (
    <section aria-label="Policies" className="onboarding-customer-policies">
      <p className="onboarding-customer-eyebrow">Good to know</p>
      <h2>Appointment policies</h2>
      <PolicySummary profile={profile} />
      <div className="onboarding-policy-grid">
        {cards.map((card) => (
          <article key={card.id}>
            <h3>{card.id.replace('_', ' ')}</h3>
            <p>{card.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function GallerySection({ state }: { state: OnboardingLabState }) {
  if (!state.recipe.galleryEnabled) return null;
  const images = state.gallery.images;
  const tiles: ReactNode[] = images.length > 0
    ? images.map((image, index) => image.previewUrl ? (
        <img alt={image.altText || `Portfolio work ${index + 1}`} key={image.id} src={image.previewUrl} />
      ) : <span aria-label={`Portfolio work ${index + 1}`} key={image.id} role="img" />)
    : [1, 2, 3, 4].map((index) => <span aria-label={`Luster portfolio example ${index}`} key={index} role="img" />);
  return (
    <section aria-label="Gallery" className={`onboarding-customer-gallery is-${state.gallery.layout}`}>
      <p className="onboarding-customer-eyebrow">Recent work</p>
      <h2>A little nail inspiration</h2>
      <div>{tiles}</div>
    </section>
  );
}

function BookingSection({
  document,
  device,
  profile,
}: {
  document: SiteBuilderDocument | null;
  device: OnboardingPreviewDevice;
  profile: BusinessProfileDraft;
}) {
  const bookingSettings = document?.pages
    .flatMap((page) => page.sections)
    .find((section) => section.sectionType === 'booking')?.settings
    ?? createDefaultBookingPresentationSettings();
  const fixture = useMemo(
    () => createOnboardingBookingFixture(profile),
    [profile],
  );
  const [session, setSession] = useState<BookingSessionState>(createPreviewBookingSession);
  const summary = useMemo(() => summarizeSelection(
    session.selection,
    fixture.services,
    fixture.addOns,
  ), [fixture.addOns, fixture.services, session.selection]);

  return (
    <section aria-label="Booking" className="onboarding-customer-booking">
      {summary ? (
        <div className="onboarding-booking-example" data-testid="canonical-booking-example">
          <span>Selected</span>
          <strong>{summary.service.name} + {summary.addOns.map((addOn) => addOn.name).join(' + ')}</strong>
          <small>{summary.durationLabel} · {summary.price.label}</small>
        </div>
      ) : null}
      <BookingSectionRenderer
        fixture={fixture}
        headingLevel="h2"
        mode="preview"
        onSessionChange={setSession}
        presentationSettings={bookingSettings}
        previewViewport={device === 'phone' ? 'mobile' : device}
        session={session}
        tokenPreset="warm"
      />
    </section>
  );
}

export type OnboardingDocumentBookingSequence = {
  afterBookingCustomDesignIds: string[];
  beforeBookingCustomDesignIds: string[];
  pageId: string;
};

export const getOnboardingDocumentBookingSequence = (
  document: SiteBuilderDocument | null,
): OnboardingDocumentBookingSequence | null => {
  if (!document) return null;

  const pages = [...document.pages].sort((left, right) => left.order - right.order);
  const bookingLocations = pages.flatMap((page) => page.sections.flatMap((section) => (
    section.sectionType === 'booking' ? [{ page, sectionId: section.id }] : []
  )));
  if (bookingLocations.length !== 1) return null;

  const location = bookingLocations[0];
  if (!location) return null;
  const orderedSections = [...location.page.sections]
    .sort((left, right) => left.order - right.order);
  const bookingIndex = orderedSections.findIndex(
    (section) => section.id === location.sectionId,
  );
  if (bookingIndex < 0) return null;

  return {
    afterBookingCustomDesignIds: orderedSections.slice(bookingIndex + 1)
      .filter((section) => section.sectionType === 'custom_design')
      .map((section) => section.id),
    beforeBookingCustomDesignIds: orderedSections.slice(0, bookingIndex)
      .filter((section) => section.sectionType === 'custom_design')
      .map((section) => section.id),
    pageId: location.page.id,
  };
};

function BookingDocumentSections({
  device,
  document,
  profile,
  showCustomDesign,
}: {
  device: OnboardingPreviewDevice;
  document: SiteBuilderDocument | null;
  profile: BusinessProfileDraft;
  showCustomDesign: boolean;
}) {
  const sequence = useMemo(
    () => getOnboardingDocumentBookingSequence(document),
    [document],
  );

  return (
    <>
      {showCustomDesign && sequence?.beforeBookingCustomDesignIds.length ? (
        <OnboardingCustomDesignSections
          document={document}
          pageId={sequence.pageId}
          sectionIds={sequence.beforeBookingCustomDesignIds}
        />
      ) : null}
      <BookingSection device={device} document={document} profile={profile} />
      {showCustomDesign && sequence?.afterBookingCustomDesignIds.length ? (
        <OnboardingCustomDesignSections
          document={document}
          pageId={sequence.pageId}
          sectionIds={sequence.afterBookingCustomDesignIds}
        />
      ) : null}
    </>
  );
}

export type OnboardingSitePreviewProps = {
  device?: OnboardingPreviewDevice;
  document: SiteBuilderDocument | null;
  includeOptionalSections?: boolean;
  label?: string;
  state: OnboardingLabState;
};

export function OnboardingSitePreview({
  device = 'phone',
  document,
  includeOptionalSections = true,
  label = 'Customer website preview',
  state,
}: OnboardingSitePreviewProps) {
  const { profile, recipe } = state;
  const roles = ONBOARDING_STYLE_ROLES[recipe.stylePreset];
  const style = {
    '--customer-accent': roles.accent,
    '--customer-body-font': roles.bodyFont,
    '--customer-button-radius': roles.buttonRadius,
    '--customer-ground': roles.ground,
    '--customer-heading-font': roles.headingFont,
    '--customer-ink': roles.ink,
    '--customer-line': roles.line,
    '--customer-muted': roles.muted,
    '--customer-radius': roles.radius,
    '--customer-surface': roles.surface,
  } as CSSProperties;
  const visitMode = labelForVisitMode(profile);
  const newClients = labelForNewClients(profile);
  const title = profile.businessName.trim() || 'Your nail studio';
  const area = profile.location.cityOrArea.trim();

  return (
    <section
      aria-label={label}
      className={`onboarding-preview-frame is-${device}`}
      data-preview-device={device}
      data-style-preset={recipe.stylePreset}
    >
      <div className="onboarding-site-preview" style={style}>
        <header className="onboarding-customer-header">
          <span className="onboarding-customer-brand"><i aria-hidden="true">L</i><strong>{title}</strong></span>
          <nav aria-label="Customer preview navigation">
            {recipe.starter === 'multi_page' ? <><button type="button">Home</button><button type="button">Services</button><button type="button">About</button></> : null}
            <button type="button">Book</button>
          </nav>
        </header>

        <div className="onboarding-customer-content">
          <section className="onboarding-customer-hero">
            <div>
              <p className="onboarding-customer-eyebrow">{area || 'Independent nail care'}</p>
              <h2>{title}</h2>
              <p>Thoughtful nail care, shaped around you.</p>
              <div className="onboarding-customer-statuses">
                {visitMode ? <span>{visitMode}</span> : null}
                {newClients ? <span>{newClients}</span> : null}
                <span>Next opening · {ONBOARDING_NEXT_AVAILABILITY_LABEL}</span>
              </div>
              <button className="onboarding-customer-primary" type="button">Book an appointment</button>
            </div>
            {profile.profilePhoto || profile.ownerName.trim() ? <Portrait large profile={profile} /> : null}
          </section>

          {includeOptionalSections && recipe.aboutEnabled ? (
            <AboutSection
              preset={recipe.aboutPreset}
              profile={profile}
              showPolicySummary={recipe.policiesEnabled}
            />
          ) : null}
          {includeOptionalSections ? <GallerySection state={state} /> : null}
          <BookingDocumentSections
            device={device}
            document={document}
            profile={profile}
            showCustomDesign={includeOptionalSections}
          />
          {includeOptionalSections && recipe.policiesEnabled ? <PoliciesSection profile={profile} /> : null}
          <ContactSection profile={profile} />
        </div>

        <footer className="onboarding-customer-footer">
          <strong>{title}</strong>
          {area ? <span>{area}</span> : null}
          <small>Website preview · Powered by Luster</small>
        </footer>
      </div>
    </section>
  );
}
