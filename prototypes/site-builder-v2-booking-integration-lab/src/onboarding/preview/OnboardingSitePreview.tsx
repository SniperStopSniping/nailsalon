import {
  CalendarDays,
  Clock3,
  Instagram,
  MapPin,
  MessageCircle,
  Sparkles,
} from 'lucide-react';
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { BookingSectionRenderer } from '../../booking/BookingSectionRenderer';
import { createEmptyBookingSession, summarizeSelection } from '../../booking/helpers';
import { createDefaultBookingPresentationSettings } from '../../booking/presentation';
import type { BookingSessionState } from '../../booking/types';
import type { CustomDesignDocumentNavigationTarget } from '../../custom-design/integration/document-actions';
import { useCustomDesignAssetMap } from '../../custom-design/integration/CustomDesignAssetProvider';
import { getStarterDocumentOutline } from '../../model/starters';
import type { SiteBuilderDocument } from '../../model/types';
import { bookingPreferencesPort } from '../integrations/adapters/booking-preferences';
import { aboutPresetSupportsElement } from '../model/about';
import { createOnboardingBookingFixture } from '../model/booking-preview';
import { resolveOnboardingImageUrl } from '../integrations/adapters/media';
import { getPublicContactActions } from '../model/contact';
import {
  getPublicWeeklyHours,
  getWeeklyHoursPreviewStatus,
  type WeeklyHoursPreviewStatus,
} from '../model/hours';
import {
  getPublicDirectionsAction,
  getPublicLocationPreview,
} from '../model/location';
import {
  deriveDepositPolicySummary,
  getPolicyDisplayWording,
} from '../model/policies';
import { getCustomerProfileFacts } from '../model/profile-facts';
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
export type OnboardingPreviewInitialTarget = 'top' | 'about';
export type OnboardingPreviewInteractionMode = 'inline' | 'interactive';

export const ONBOARDING_PREVIEW_VIEWPORTS: Record<OnboardingPreviewDevice, {
  height: number;
  width: number;
}> = {
  desktop: { height: 760, width: 1180 },
  phone: { height: 780, width: 390 },
  tablet: { height: 900, width: 768 },
};

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
): string => getPolicyDisplayWording(profile.policies, sectionId);

const isAboutVisible = (
  visibility: Record<AboutElementId, boolean>,
  id: AboutElementId,
): boolean => visibility[id];

function Portrait({
  large = false,
  profile,
  respectAboutVisibility = false,
}: {
  large?: boolean;
  profile: BusinessProfileDraft;
  respectAboutVisibility?: boolean;
}) {
  const assetIds = profile.profilePhoto?.storageId
    ? [profile.profilePhoto.storageId]
    : [];
  const assets = useCustomDesignAssetMap(assetIds);
  const source = resolveOnboardingImageUrl(profile.profilePhoto, assets);
  const visibleIdentity = respectAboutVisibility
    ? (profile.about.visibility.owner_name ? profile.ownerName : '')
      || (profile.about.visibility.salon_name ? profile.businessName : '')
    : profile.ownerName || profile.businessName;
  const initials = (visibleIdentity || 'L')
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return source ? (
    <img
      alt={profile.profilePhoto?.altText || `${visibleIdentity || 'Business owner'} portrait`}
      className={`onboarding-customer-portrait${large ? ' is-large' : ''}`}
      src={source}
    />
  ) : (
    <span
      aria-label={`${visibleIdentity || 'Business owner'} portrait placeholder`}
      className={`onboarding-customer-portrait onboarding-customer-portrait--initials${large ? ' is-large' : ''}`}
      role="img"
    >
      {initials || 'L'}
    </span>
  );
}

function AboutActions({ profile }: { profile: BusinessProfileDraft }) {
  const visibility = profile.about.visibility;
  const instagram = getPublicContactActions(profile).find(
    (action) => action.method === 'instagram',
  );
  const hasInstagram = isAboutVisible(visibility, 'instagram')
    && instagram;
  const hasBooking = isAboutVisible(visibility, 'book_button');
  if (!hasInstagram && !hasBooking) return null;

  return (
    <div className="onboarding-customer-actions">
      {hasBooking ? <a href="#booking"><CalendarDays aria-hidden="true" size={16} /> Book now</a> : null}
      {hasInstagram ? (
        <a
          className="is-secondary"
          href={instagram.href}
          rel={instagram.rel}
          target={instagram.target}
        >
          <Instagram aria-hidden="true" size={16} /> {profile.instagram}
        </a>
      ) : null}
    </div>
  );
}

function AboutFacts({
  hoursStatus,
  profile,
  scope = 'all',
}: {
  hoursStatus: WeeklyHoursPreviewStatus | null;
  profile: BusinessProfileDraft;
  scope?: 'all' | 'profile';
}) {
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
  for (const fact of getCustomerProfileFacts(profile)) {
    facts.push({ label: fact.label, value: fact.value });
  }
  if (scope === 'all') {
    const visitMode = labelForVisitMode(profile);
    if (isAboutVisible(visibility, 'appointment_status') && visitMode) {
      facts.push({ label: 'Appointments', value: visitMode });
    }
    const newClients = labelForNewClients(profile);
    if (isAboutVisible(visibility, 'new_client_status') && newClients) {
      facts.push({ label: 'New clients', value: newClients });
    }
    if (hoursStatus) {
      facts.push({ label: 'Hours', value: hoursStatus.label });
    }
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
    : isAboutVisible(visibility, 'salon_name') && profile.businessName.trim()
      ? `About ${profile.businessName.trim()}`
      : 'About';
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
  if (
    profile.policies.copy.cancellations.visible
    && notice
    && notice !== 'custom'
  ) values.push(notice.replace('_', '-').replace('hours', 'hour notice'));
  const depositSummary = deriveDepositPolicySummary(profile.policies);
  if (profile.policies.copy.deposits.visible && depositSummary) {
    values.push(depositSummary);
  }
  if (
    profile.policies.copy.late_arrivals.visible
    && profile.policies.lateArrivals.gracePeriodMinutes.trim()
  ) {
    values.push(`${profile.policies.lateArrivals.gracePeriodMinutes.trim()}-minute late limit`);
  }
  return values.length > 0 ? <p className="onboarding-policy-summary">{values.join(' · ')}</p> : null;
}

function AboutSection({ hoursStatus, preset, profile, showPolicySummary }: {
  hoursStatus: WeeklyHoursPreviewStatus | null;
  preset: AboutPresetId;
  profile: BusinessProfileDraft;
  showPolicySummary: boolean;
}) {
  const visibility = profile.about.visibility;
  const supports = (id: AboutElementId) => aboutPresetSupportsElement(preset, id);
  const showPortrait = supports('profile_photo')
    && isAboutVisible(visibility, 'profile_photo');
  const policySummary = showPolicySummary
    && supports('policy_summary')
    && isAboutVisible(visibility, 'policy_summary')
    ? <PolicySummary profile={profile} />
    : null;

  if (preset === 'editorial_portrait') {
    return (
      <section
        aria-label="About"
        className="onboarding-customer-about is-editorial"
        data-preview-target="about"
      >
        {showPortrait ? <Portrait large profile={profile} respectAboutVisibility /> : null}
        <AboutCopy long profile={profile} />
        <AboutFacts hoursStatus={hoursStatus} profile={profile} />
        {policySummary}
        <AboutActions profile={profile} />
      </section>
    );
  }

  if (preset === 'profile_quick_facts') {
    return (
      <section
        aria-label="About"
        className="onboarding-customer-about is-quick-facts"
        data-preview-target="about"
      >
        {showPortrait ? <Portrait profile={profile} respectAboutVisibility /> : null}
        <AboutCopy profile={profile} />
        <AboutFacts hoursStatus={hoursStatus} profile={profile} />
        {policySummary}
        <AboutActions profile={profile} />
      </section>
    );
  }

  if (preset === 'about_before_you_book') {
    return (
      <section
        aria-label="About and before you book"
        className="onboarding-customer-about is-before-booking"
        data-preview-target="about"
      >
        <div className="onboarding-about-profile">
          {showPortrait ? <Portrait profile={profile} respectAboutVisibility /> : null}
          <AboutCopy profile={profile} />
          <AboutFacts hoursStatus={hoursStatus} profile={profile} scope="profile" />
        </div>
        <div className="onboarding-before-booking-card">
          <h3>Before you book</h3>
          {isAboutVisible(visibility, 'appointment_status') && labelForVisitMode(profile)
            ? <p><Clock3 aria-hidden="true" size={16} /> {labelForVisitMode(profile)}</p>
            : null}
          {isAboutVisible(visibility, 'new_client_status') && labelForNewClients(profile)
            ? <p><Sparkles aria-hidden="true" size={16} /> {labelForNewClients(profile)}</p>
            : null}
          {hoursStatus ? <p><Clock3 aria-hidden="true" size={16} /> {hoursStatus.label}</p> : null}
          {policySummary}
        </div>
        <AboutActions profile={profile} />
      </section>
    );
  }

  return (
    <section
      aria-label="About"
      className="onboarding-customer-about is-photo-right"
      data-preview-target="about"
    >
      <div><AboutCopy profile={profile} /><AboutFacts hoursStatus={hoursStatus} profile={profile} />{policySummary}<AboutActions profile={profile} /></div>
      {showPortrait ? <Portrait large profile={profile} respectAboutVisibility /> : null}
    </section>
  );
}

function ContactSection({ profile }: { profile: BusinessProfileDraft }) {
  const location = getPublicLocationPreview(profile.location);
  const contacts = getPublicContactActions(profile);
  const directions = getPublicDirectionsAction(profile.location);
  const weeklyHours = getPublicWeeklyHours(profile.hours);
  const serviceLocation = getCustomerProfileFacts(profile).find(
    (fact) => fact.id === 'service_location',
  );
  if (
    !location.primary
    && !serviceLocation
    && contacts.length === 0
    && weeklyHours.length === 0
  ) return null;
  return (
    <section aria-label="Visit and contact" className="onboarding-customer-contact">
      <div>
        <p className="onboarding-customer-eyebrow">Visit us</p>
        <h2>Plan your appointment</h2>
        {location.primary ? (
          <p><MapPin aria-hidden="true" size={17} /> {location.primary}</p>
        ) : null}
        {location.detail ? <small>{location.detail}</small> : null}
        {serviceLocation ? <small>{serviceLocation.value}</small> : null}
        {profile.location.parking.trim() ? <small>{profile.location.parking.trim()}</small> : null}
      </div>
      {weeklyHours.length > 0 ? (
        <div aria-label="Weekly hours" className="onboarding-customer-weekly-hours" role="group">
          <h3>Hours</h3>
          <dl>
            {weeklyHours.map((day) => (
              <div key={day.weekday}><dt>{day.label}</dt><dd>{day.hours}</dd></div>
            ))}
          </dl>
        </div>
      ) : null}
      <div className="onboarding-customer-actions">
        {directions ? (
          <a
            aria-label={directions.accessibleLabel}
            className="is-secondary"
            href={directions.href}
            rel={directions.rel}
            target={directions.target}
          >Directions</a>
        ) : null}
        {contacts.map((contact) => (
          <a
            className={contact.preferred ? 'is-preferred' : 'is-secondary'}
            data-contact-method={contact.method}
            href={contact.href}
            key={`${contact.method}-${contact.href}`}
            rel={contact.rel}
            target={contact.target}
          >
            <MessageCircle aria-hidden="true" size={16} />
            {contact.actionLabel}{contact.preferred && contact.method !== 'booking' ? ' · Preferred' : ''}
          </a>
        ))}
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
  const images = state.gallery.images;
  const assetIds = images.flatMap((image) => image.storageId ? [image.storageId] : []);
  const assets = useCustomDesignAssetMap(assetIds);
  if (!state.recipe.galleryEnabled) return null;
  if (images.length === 0) return null;
  const tiles: ReactNode[] = images.flatMap((image, index) => {
    const source = resolveOnboardingImageUrl(image, assets);
    return source ? [(
      <img alt={image.altText || `Portfolio work ${index + 1}`} key={image.id} src={source} />
    )] : [];
  });
  if (tiles.length === 0) return null;
  return (
    <section aria-label="Gallery" className={`onboarding-customer-gallery is-${state.gallery.layout}`}>
      <p className="onboarding-customer-eyebrow">Recent work</p>
      <h2>A little nail inspiration</h2>
      <div>{tiles}</div>
    </section>
  );
}

const STARTER_STRUCTURE_COPY = {
  multi_page: {
    heading: 'Explore each part of the studio',
    eyebrow: 'Five-page website',
  },
  one_page: {
    heading: 'Everything in one easy scroll',
    eyebrow: 'One-page website',
  },
  quick_book: {
    heading: 'A direct path to booking',
    eyebrow: 'Quick Book',
  },
} as const;

function StarterStructure({ document }: { document: SiteBuilderDocument | null }) {
  const outline = useMemo(() => getStarterDocumentOutline(document), [document]);
  if (!document || outline.length === 0) return null;
  const copy = STARTER_STRUCTURE_COPY[document.originStarter];
  return (
    <section
      aria-label={`${copy.eyebrow} structure`}
      className={`onboarding-customer-structure is-${document.originStarter}`}
      data-starter-structure={document.originStarter}
    >
      <p className="onboarding-customer-eyebrow">{copy.eyebrow}</p>
      <h2>{copy.heading}</h2>
      <div className="onboarding-customer-structure__pages">
        {outline.map((page) => (
          <article
            data-preview-page-id={page.id}
            id={`preview-page-${page.id}`}
            key={page.id}
          >
            {outline.length > 1 ? <h3>{page.label}</h3> : null}
            <ol>
              {page.sections
                .filter((section) => section.sectionType !== 'custom_design')
                .map((section) => (
                  <li data-preview-outline-section-id={section.id} key={section.id}>
                    {section.label}
                  </li>
                ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}

function BookingSection({
  document,
  device,
  previewTimestamp,
  profile,
}: {
  document: SiteBuilderDocument | null;
  device: OnboardingPreviewDevice;
  previewTimestamp: string;
  profile: BusinessProfileDraft;
}) {
  const bookingSettings = document?.pages
    .flatMap((page) => page.sections)
    .find((section) => section.sectionType === 'booking')?.settings
    ?? createDefaultBookingPresentationSettings();
  const bookingSectionId = document?.pages
    .flatMap((page) => page.sections)
    .find((section) => section.sectionType === 'booking')?.id;
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
  const availabilityPreview = useMemo(
    () => bookingPreferencesPort.getAvailabilityPreview(
      profile.bookingPreferences.minimumNoticeMinutes,
      previewTimestamp,
    ),
    [previewTimestamp, profile.bookingPreferences.minimumNoticeMinutes],
  );

  return (
    <section
      aria-label="Booking"
      className="onboarding-customer-booking"
      data-section-id={bookingSectionId}
      id="booking"
    >
      {summary ? (
        <div className="onboarding-booking-example" data-testid="canonical-booking-example">
          <span>Selected</span>
          <strong>{summary.service.name} + {summary.addOns.map((addOn) => addOn.name).join(' + ')}</strong>
          <small>{summary.durationLabel} · {summary.price.label}</small>
        </div>
      ) : null}
      <section
        aria-label="Available appointment times"
        className="onboarding-customer-bookable-times"
        data-availability-source={availabilityPreview.source}
      >
        <div>
          <span>Available appointment times</span>
          <small>Based on the minimum booking notice</small>
        </div>
        {availabilityPreview.bookableTimes.length > 0 ? (
          <div>
            {availabilityPreview.bookableTimes.slice(0, 4).map((time) => (
              <span data-bookable-time={time.startsAt} key={time.id}>{time.label}</span>
            ))}
          </div>
        ) : <p>No appointment times are shown in this preview window.</p>}
      </section>
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
  previewTimestamp,
  profile,
  onDocumentTarget,
  showCustomDesign,
}: {
  device: OnboardingPreviewDevice;
  document: SiteBuilderDocument | null;
  onDocumentTarget: (target: CustomDesignDocumentNavigationTarget) => void;
  previewTimestamp: string;
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
          onDocumentTarget={onDocumentTarget}
          pageId={sequence.pageId}
          sectionIds={sequence.beforeBookingCustomDesignIds}
        />
      ) : null}
      <BookingSection
        device={device}
        document={document}
        previewTimestamp={previewTimestamp}
        profile={profile}
      />
      {showCustomDesign && sequence?.afterBookingCustomDesignIds.length ? (
        <OnboardingCustomDesignSections
          document={document}
          onDocumentTarget={onDocumentTarget}
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
  fitAvailable?: boolean;
  includeOptionalSections?: boolean;
  initialTarget?: OnboardingPreviewInitialTarget;
  interactionMode?: OnboardingPreviewInteractionMode;
  label?: string;
  state: OnboardingLabState;
};

export function OnboardingSitePreview({
  device = 'phone',
  document,
  fitAvailable = false,
  includeOptionalSections = true,
  initialTarget = 'top',
  interactionMode = 'inline',
  label = 'Customer website preview',
  state,
}: OnboardingSitePreviewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const summaryId = useId();
  const viewport = ONBOARDING_PREVIEW_VIEWPORTS[device];
  const [previewScale, setPreviewScale] = useState(1);
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
  const heroDescription = profile.businessStructure === 'multi_tech'
    ? 'Thoughtful nail care from a team, shaped around you.'
    : 'Thoughtful nail care, shaped around you.';
  const hoursStatus = getWeeklyHoursPreviewStatus(
    profile.hours,
    state.reviewOptions.previewTimestamp,
  );
  const title = profile.businessName.trim() || 'Your nail studio';
  const area = profile.location.cityOrArea.trim();
  const navigationItems = useMemo(() => {
    if (!document?.navigation.enabled) return [];
    const pagesById = new Map(document.pages.map((page) => [page.id, page]));
    return [...document.navigation.items]
      .sort((left, right) => left.order - right.order)
      .filter((item) => pagesById.get(item.pageId)?.visibleInNavigation)
      .map((item) => ({ label: item.label, pageId: item.pageId }));
  }, [document]);
  const revealDocumentTarget = useCallback((target: CustomDesignDocumentNavigationTarget) => {
    const preview = previewRef.current;
    if (!preview) return;
    const targetElement = target.sectionId
      ? [...preview.querySelectorAll<HTMLElement>('[data-section-id]')]
        .find((element) => element.dataset.sectionId === target.sectionId)
        ?? [...preview.querySelectorAll<HTMLElement>('[data-preview-outline-section-id]')]
          .find((element) => element.dataset.previewOutlineSectionId === target.sectionId)
      : [...preview.querySelectorAll<HTMLElement>('[data-preview-page-id]')]
        .find((element) => element.dataset.previewPageId === target.pageId);
    targetElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const updateScale = () => {
      const availableWidth = stage.clientWidth || viewport.width;
      const availableHeight = stage.clientHeight || viewport.height;
      const nextScale = Math.min(
        1,
        availableWidth / viewport.width,
        availableHeight / viewport.height,
      );
      setPreviewScale(Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1);
    };
    updateScale();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateScale);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [fitAvailable, viewport.height, viewport.width]);

  useLayoutEffect(() => {
    if (previewRef.current) {
      previewRef.current.inert = interactionMode === 'inline';
    }
  }, [interactionMode]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const target = initialTarget === 'about'
      ? frame.querySelector<HTMLElement>('[data-preview-target="about"]')
      : null;
    frame.scrollTop = target?.offsetTop ?? 0;
  }, [device, includeOptionalSections, initialTarget, recipe.aboutEnabled, recipe.aboutPreset]);

  const stageStyle = {
    '--preview-scale': String(previewScale),
    '--preview-stage-height': `${Math.round(viewport.height * previewScale)}px`,
    '--preview-target-height': `${viewport.height}px`,
    '--preview-target-width': `${viewport.width}px`,
  } as CSSProperties;

  return (
    <section
      aria-label={label}
      aria-describedby={summaryId}
      className={`onboarding-preview-stage is-${device}${fitAvailable ? ' is-fit-available' : ''}`}
      data-preview-device={device}
      data-preview-initial-target={initialTarget}
      data-preview-interaction={interactionMode}
      data-preview-scale={previewScale.toFixed(4)}
      ref={stageRef}
      style={stageStyle}
    >
      <span className="visually-hidden" id={summaryId}>
        Visual preview of {title} at a {viewport.width}-pixel {device} viewport.
        {interactionMode === 'inline' ? ' Open the full preview to use customer controls.' : ''}
      </span>
      <div
        className={`onboarding-preview-frame is-${device}`}
        data-preview-device={device}
        data-preview-scroll-container="true"
        data-style-preset={recipe.stylePreset}
        ref={frameRef}
      >
      <div className="onboarding-site-preview" ref={previewRef} style={style}>
        <header className="onboarding-customer-header">
          <span className="onboarding-customer-brand" title={title}><i aria-hidden="true">L</i><strong>{title}</strong></span>
          <nav aria-label="Customer preview navigation">
            {navigationItems.slice(0, 4).map((item) => (
              <a href={`#preview-page-${item.pageId}`} key={item.pageId}>
                {item.label}
              </a>
            ))}
            <a href="#booking">Book</a>
          </nav>
        </header>

        <div className="onboarding-customer-content">
          <StarterStructure document={document} />

          <section className="onboarding-customer-hero">
            <div>
              <p className="onboarding-customer-eyebrow">{area || 'Independent nail care'}</p>
              <h2>{title}</h2>
              <p>{heroDescription}</p>
              <div className="onboarding-customer-statuses">
                {visitMode ? <span>{visitMode}</span> : null}
                {newClients ? <span>{newClients}</span> : null}
                {hoursStatus ? <span data-hours-status={hoursStatus.kind}>{hoursStatus.label}</span> : null}
              </div>
              <a className="onboarding-customer-primary" href="#booking">Book an appointment</a>
            </div>
            {profile.profilePhoto || profile.ownerName.trim() ? <Portrait large profile={profile} /> : null}
          </section>

          {includeOptionalSections && recipe.aboutEnabled ? (
            <AboutSection
              hoursStatus={hoursStatus}
              preset={recipe.aboutPreset}
              profile={profile}
              showPolicySummary={recipe.policiesEnabled}
            />
          ) : null}
          {includeOptionalSections ? <GallerySection state={state} /> : null}
          <BookingDocumentSections
            device={device}
            document={document}
            onDocumentTarget={revealDocumentTarget}
            previewTimestamp={state.reviewOptions.previewTimestamp}
            profile={profile}
            showCustomDesign={includeOptionalSections}
          />
          {includeOptionalSections && recipe.policiesEnabled ? <PoliciesSection profile={profile} /> : null}
          <ContactSection profile={profile} />
        </div>

        <footer className="onboarding-customer-footer">
          <strong>{title}</strong>
          {area ? <span>{area}</span> : null}
          <small>Powered by Luster</small>
        </footer>
      </div>
      </div>
    </section>
  );
}
