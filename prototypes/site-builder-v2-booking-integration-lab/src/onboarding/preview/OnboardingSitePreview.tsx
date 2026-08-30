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
import {
  aboutPresetSupportsElement,
  resolveAboutBio,
} from '../model/about';
import { createOnboardingBookingFixture } from '../model/booking-preview';
import { resolveOnboardingImageUrl } from '../integrations/adapters/media';
import { getPublicContactActions } from '../model/contact';
import {
  getPublicWeeklyHours,
  getWeeklyHoursPreviewStatus,
  type WeeklyHoursPreviewStatus,
} from '../model/hours';
import { getMinimumNoticeCopy } from '../model/minimum-notice';
import {
  getPublicDirectionsAction,
  getPublicLocationPreview,
} from '../model/location';
import {
  deriveDepositPolicySummary,
  getDepositsAndCancellationsDisplayWording,
  getPolicyDisplayWording,
  isDepositsAndCancellationsComplete,
} from '../model/policies';
import { SITE_PALETTE_BY_ID } from '../model/palettes';
import { getCustomerProfileFacts } from '../model/profile-facts';
import type {
  AboutElementId,
  AboutPresetId,
  BusinessProfileDraft,
  OnboardingLabState,
  OnboardingSiteRecipe,
  PolicySectionId,
  SiteStylePresetId,
} from '../model/types';
import { OnboardingCustomDesignSections } from './OnboardingCustomDesignSections';

export type OnboardingPreviewDevice = 'phone' | 'tablet' | 'desktop';
export type OnboardingPreviewInitialTarget = 'top' | 'about';
export type OnboardingPreviewInteractionMode = 'inline' | 'interactive';

type PreviewBounds = {
  height: number;
  width: number;
};

export const ONBOARDING_PREVIEW_VIEWPORTS: Record<OnboardingPreviewDevice, {
  height: number;
  width: number;
}> = {
  desktop: { height: 760, width: 1180 },
  phone: { height: 780, width: 390 },
  tablet: { height: 900, width: 768 },
};

export const calculateOnboardingPreviewScale = (
  available: PreviewBounds,
  target: PreviewBounds,
): number => {
  const nextScale = Math.min(
    1,
    available.width / target.width,
    available.height / target.height,
  );
  return Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1;
};

export type StyleRoles = {
  accent: string;
  bodyFont: string;
  buttonRadius: string;
  ground: string;
  headingFont: string;
  ink: string;
  line: string;
  muted: string;
  radius: string;
  secondaryAccent: string;
  spacingMood: string;
  surface: string;
};

export const ONBOARDING_STYLE_ROLES: Record<SiteStylePresetId, StyleRoles> = {
  modern: {
    accent: '#a44f3e',
    bodyFont: "Inter, ui-sans-serif, system-ui, sans-serif",
    buttonRadius: '16px',
    ground: '#f7f0e6',
    headingFont: "Newsreader, Georgia, 'Times New Roman', serif",
    ink: '#332824',
    line: '#ddcfc5',
    muted: '#756761',
    radius: '24px',
    secondaryAccent: '#d9a07d',
    spacingMood: 'clamp(28px, 7cqw, 72px)',
    surface: '#fffcf8',
  },
  editorial: {
    accent: '#771d36',
    bodyFont: "Inter, ui-sans-serif, system-ui, sans-serif",
    buttonRadius: '2px',
    ground: '#fbf7ef',
    headingFont: "Newsreader, Georgia, 'Times New Roman', serif",
    ink: '#20191a',
    line: '#c9beb2',
    muted: '#6f625d',
    radius: '4px',
    secondaryAccent: '#c79280',
    spacingMood: 'clamp(32px, 8cqw, 84px)',
    surface: '#fffdf8',
  },
  soft: {
    accent: '#9d5374',
    bodyFont: "Inter, ui-sans-serif, system-ui, sans-serif",
    buttonRadius: '999px',
    ground: '#fff2f5',
    headingFont: "Newsreader, Georgia, 'Times New Roman', serif",
    ink: '#4b303a',
    line: '#ead4dc',
    muted: '#806a73',
    radius: '32px',
    secondaryAccent: '#c7a5d5',
    spacingMood: 'clamp(30px, 8cqw, 78px)',
    surface: '#fffefe',
  },
  minimal: {
    accent: '#285346',
    bodyFont: "Inter, ui-sans-serif, system-ui, sans-serif",
    buttonRadius: '6px',
    ground: '#f5f6f1',
    headingFont: "Inter, ui-sans-serif, system-ui, sans-serif",
    ink: '#202823',
    line: '#d2d9d1',
    muted: '#647069',
    radius: '10px',
    secondaryAccent: '#98a997',
    spacingMood: 'clamp(24px, 6cqw, 64px)',
    surface: '#ffffff',
  },
  bold: {
    accent: '#c9322c',
    bodyFont: "Inter, ui-sans-serif, system-ui, sans-serif",
    buttonRadius: '4px',
    ground: '#f4df53',
    headingFont: "Arial Black, Inter, ui-sans-serif, sans-serif",
    ink: '#171717',
    line: '#171717',
    muted: '#514a24',
    radius: '0px',
    secondaryAccent: '#1646b7',
    spacingMood: 'clamp(26px, 7cqw, 70px)',
    surface: '#fff8dc',
  },
  luxury: {
    accent: '#c9a45f',
    bodyFont: "Inter, ui-sans-serif, system-ui, sans-serif",
    buttonRadius: '2px',
    ground: '#171315',
    headingFont: "Newsreader, Georgia, 'Times New Roman', serif",
    ink: '#f9eedc',
    line: '#514349',
    muted: '#c8b8ae',
    radius: '10px',
    secondaryAccent: '#6e294f',
    spacingMood: 'clamp(34px, 9cqw, 88px)',
    surface: '#231c21',
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

const identityInitials = (value: string, fallback = 'L'): string => {
  const initials = value
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join('');
  return initials || fallback;
};

function Brand({ profile }: { profile: BusinessProfileDraft }) {
  const assetIds = profile.logo?.storageId ? [profile.logo.storageId] : [];
  const assets = useCustomDesignAssetMap(assetIds);
  const source = resolveOnboardingImageUrl(profile.logo, assets);
  const title = profile.businessName.trim() || 'Your nail studio';

  return (
    <span className="onboarding-customer-brand" title={title}>
      {source ? (
        <img
          alt={`${title} logo`}
          data-media-role="logo"
          src={source}
        />
      ) : (
        <i aria-hidden="true">{identityInitials(title)}</i>
      )}
      <strong>{title}</strong>
    </span>
  );
}

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
  const initials = identityInitials(visibleIdentity);
  const altText = profile.profilePhoto?.source === 'fixture'
    && profile.profilePhoto.altText?.trim()
    ? profile.profilePhoto.altText
    : `${visibleIdentity || 'Business owner'} profile photo`;

  return source ? (
    <img
      alt={altText}
      className={`onboarding-customer-portrait${large ? ' is-large' : ''}`}
      data-media-role="profile"
      src={source}
    />
  ) : (
    <span
      aria-label={`${visibleIdentity || 'Business owner'} portrait placeholder`}
      className={`onboarding-customer-portrait onboarding-customer-portrait--initials${large ? ' is-large' : ''}`}
      data-media-role="profile"
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
          <Instagram aria-hidden="true" size={16} /> @{instagram.detail}
        </a>
      ) : null}
    </div>
  );
}

type AboutFact = {
  label: string;
  value: string;
};

const getAboutFacts = (
  profile: BusinessProfileDraft,
  hoursStatus: WeeklyHoursPreviewStatus | null,
): AboutFact[] => {
  const visibility = profile.about.visibility;
  const facts: Array<{ label: string; value: string }> = [];
  if (isAboutVisible(visibility, 'experience') && profile.about.yearsOfExperience.trim()) {
    const years = profile.about.yearsOfExperience.trim();
    facts.push({
      label: 'Experience',
      value: /^\d+$/u.test(years) ? `${years} years` : years,
    });
  }
  for (const fact of getCustomerProfileFacts(profile).filter(
    (item) => item.id === 'service_location',
  )) {
    facts.push({ label: fact.label, value: fact.value });
  }
  const visitMode = labelForVisitMode(profile);
  if (isAboutVisible(visibility, 'appointment_status') && visitMode) {
    facts.push({ label: 'Appointments', value: visitMode });
  }
  const newClients = labelForNewClients(profile);
  if (isAboutVisible(visibility, 'new_client_status') && newClients) {
    facts.push({ label: 'New clients', value: newClients });
  }
  if (isAboutVisible(visibility, 'certifications') && profile.about.certifications.length > 0) {
    facts.push({ label: 'Certifications', value: profile.about.certifications.join(' · ') });
  }
  if (isAboutVisible(visibility, 'languages') && profile.about.languages.length > 0) {
    facts.push({ label: 'Languages', value: profile.about.languages.join(' · ') });
  }
  if (hoursStatus) facts.push({ label: 'Hours', value: hoursStatus.label });

  return facts;
};

function AboutFacts({
  excludeLabels = [],
  hoursStatus,
  maxVisible = 4,
  presentation = 'grid',
  profile,
}: {
  excludeLabels?: readonly string[];
  hoursStatus: WeeklyHoursPreviewStatus | null;
  maxVisible?: number;
  presentation?: 'grid' | 'pills';
  profile: BusinessProfileDraft;
}) {
  const facts = getAboutFacts(profile, hoursStatus)
    .filter((fact) => !excludeLabels.includes(fact.label));
  if (facts.length === 0) return null;
  const visibleFacts = facts.slice(0, maxVisible);
  const additionalFacts = facts.slice(maxVisible);

  return (
    <div className="onboarding-about-facts-wrap">
      <dl className={`onboarding-about-facts is-${presentation}`}>
        {visibleFacts.map((fact) => (
          <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
        ))}
      </dl>
      {additionalFacts.length > 0 ? (
        <details className="onboarding-about-facts-more">
          <summary>More details</summary>
          <dl>
            {additionalFacts.map((fact) => (
              <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}

function AboutSpecialties({ profile }: { profile: BusinessProfileDraft }) {
  const specialties = isAboutVisible(profile.about.visibility, 'specialties')
    ? profile.about.specialties.filter((specialty) => specialty.trim())
    : [];
  if (specialties.length === 0) return null;
  return (
    <ul aria-label="Specialties" className="onboarding-about-specialties">
      {specialties.map((specialty) => <li key={specialty}>{specialty}</li>)}
    </ul>
  );
}

function AboutCopy({ profile }: { profile: BusinessProfileDraft }) {
  const visibility = profile.about.visibility;
  const bio = resolveAboutBio(profile.about.shortBio, profile.about.fullBio);
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
      {isAboutVisible(visibility, 'bio') && bio.lead ? (
        <div className="onboarding-about-biography">
          <p>{bio.lead}</p>
          {bio.expanded ? (
            <details>
              <summary>Read more</summary>
              <p>{bio.expanded}</p>
            </details>
          ) : null}
        </div>
      ) : null}
      {profile.about.clientAppreciation.trim() ? (
        <blockquote>“{profile.about.clientAppreciation.trim()}”</blockquote>
      ) : null}
    </div>
  );
}

const getPolicySummaryText = (profile: BusinessProfileDraft): string => {
  const values: string[] = [];
  const notice = profile.policies.cancellations.notice;
  if (isDepositsAndCancellationsComplete(profile.policies)) {
    if (
      profile.policies.copy.cancellations.visible
      && notice
      && notice !== 'custom'
    ) values.push(notice.replace('_', '-').replace('hours', 'hour notice'));
    const depositSummary = deriveDepositPolicySummary(profile.policies);
    if (profile.policies.copy.deposits.visible && depositSummary) {
      values.push(depositSummary);
    }
  }
  if (
    profile.policies.copy.late_arrivals.visible
    && profile.policies.lateArrivals.gracePeriodMinutes.trim()
  ) {
    values.push(`${profile.policies.lateArrivals.gracePeriodMinutes.trim()}-minute late limit`);
  }
  return values.join(' · ');
};

function PolicySummary({ profile }: { profile: BusinessProfileDraft }) {
  const summary = getPolicySummaryText(profile);
  return summary ? <p className="onboarding-policy-summary">{summary}</p> : null;
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
  const policySummaryText = showPolicySummary
    && supports('policy_summary')
    && isAboutVisible(visibility, 'policy_summary')
    ? getPolicySummaryText(profile)
    : '';
  const bookingCardItems = [
    isAboutVisible(visibility, 'appointment_status') ? labelForVisitMode(profile) : null,
    isAboutVisible(visibility, 'new_client_status') ? labelForNewClients(profile) : null,
    policySummaryText || null,
  ].filter((value): value is string => Boolean(value)).slice(0, 3);

  if (preset === 'editorial_portrait') {
    return (
      <section
        aria-label="About"
        className={`onboarding-customer-about is-editorial${showPortrait ? ' has-portrait' : ''}`}
        data-preview-target="about"
      >
        {showPortrait ? <Portrait large profile={profile} respectAboutVisibility /> : null}
        <div className="onboarding-about-editorial-story">
          <AboutCopy profile={profile} />
          <AboutSpecialties profile={profile} />
          <AboutActions profile={profile} />
          <AboutFacts hoursStatus={hoursStatus} maxVisible={2} presentation="pills" profile={profile} />
          {policySummary}
        </div>
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
        <div className="onboarding-about-quick-identity">
          {showPortrait ? <Portrait profile={profile} respectAboutVisibility /> : null}
          <AboutCopy profile={profile} />
        </div>
        <AboutActions profile={profile} />
        <AboutFacts hoursStatus={hoursStatus} profile={profile} />
        <AboutSpecialties profile={profile} />
        {policySummary}
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
          <div className="onboarding-about-before-identity">
            {showPortrait ? <Portrait profile={profile} respectAboutVisibility /> : null}
            <AboutCopy profile={profile} />
          </div>
          <AboutSpecialties profile={profile} />
          <AboutActions profile={profile} />
        </div>
        {bookingCardItems.length > 0 ? (
          <div className="onboarding-before-booking-card">
            <h3>Before you book</h3>
            {bookingCardItems.map((item, index) => (
              <p className={item === policySummaryText ? 'onboarding-policy-summary' : undefined} key={item}>
                {index === 1
                  ? <Sparkles aria-hidden="true" size={16} />
                  : <Clock3 aria-hidden="true" size={16} />}
                {item}
              </p>
            ))}
          </div>
        ) : null}
        <AboutFacts
          excludeLabels={['Appointments', 'New clients']}
          hoursStatus={hoursStatus}
          maxVisible={2}
          presentation="pills"
          profile={profile}
        />
      </section>
    );
  }

  return (
    <section
      aria-label="About"
      className={`onboarding-customer-about is-photo-right${showPortrait ? ' has-portrait' : ''}`}
      data-preview-target="about"
    >
      <div className="onboarding-about-photo-copy">
        <AboutCopy profile={profile} />
        <AboutSpecialties profile={profile} />
        <AboutActions profile={profile} />
        <AboutFacts hoursStatus={hoursStatus} maxVisible={2} presentation="pills" profile={profile} />
        {policySummary}
      </div>
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
  const combinedPolicyText = isDepositsAndCancellationsComplete(profile.policies)
    ? getDepositsAndCancellationsDisplayWording(profile.policies)
    : '';
  const cards = [
    {
      id: 'deposits_cancellations',
      label: 'Deposits & cancellations',
      text: combinedPolicyText,
    },
    ...(['late_arrivals', 'no_shows', 'repairs', 'other'] as const).map((id) => ({
      id,
      label: {
        late_arrivals: 'Late arrivals',
        no_shows: 'No-shows',
        other: 'Guests & appointment details',
        repairs: 'Repairs',
      }[id],
      text: textForPolicy(profile, id),
    })),
  ]
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
            <h3>{card.label}</h3>
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

type CurrentPreviewOutlineSection = {
  id: string;
  label: string;
  sectionType: string;
};

type CurrentPreviewOutlinePage = {
  id: string;
  label: string;
  sections: CurrentPreviewOutlineSection[];
};

type CurrentPreviewOutlineOptions = {
  galleryHasContent?: boolean;
  includeOptionalSections?: boolean;
  policiesHaveContent?: boolean;
};

const insertPreviewSection = (
  pages: CurrentPreviewOutlinePage[],
  section: CurrentPreviewOutlineSection,
  placement: 'before_booking' | 'after_booking',
): void => {
  if (pages.some((page) => page.sections.some((item) => (
    item.label.toLowerCase().includes(section.label.toLowerCase())
  )))) return;
  const target = pages.find((page) => page.sections.some(
    (item) => item.sectionType === 'booking',
  )) ?? pages[0];
  if (!target) return;
  const bookingIndex = target.sections.findIndex((item) => item.sectionType === 'booking');
  const insertionIndex = bookingIndex < 0
    ? target.sections.length
    : placement === 'before_booking'
      ? bookingIndex
      : bookingIndex + 1;
  target.sections.splice(insertionIndex, 0, section);
};

/**
 * A truthful outline of the current preview. It starts with the real universal
 * starter document and filters isolated onboarding-preview modules without
 * mutating or pretending they are universal document sections.
 */
export const getCurrentPreviewOutline = (
  document: SiteBuilderDocument | null,
  recipe: OnboardingSiteRecipe,
  {
    galleryHasContent = recipe.galleryEnabled,
    includeOptionalSections = true,
    policiesHaveContent = recipe.policiesEnabled,
  }: CurrentPreviewOutlineOptions = {},
): CurrentPreviewOutlinePage[] => {
  const pages: CurrentPreviewOutlinePage[] = getStarterDocumentOutline(document)
    .map((page) => ({
      ...page,
      sections: page.sections
        .filter((section) => {
          if (!includeOptionalSections) return true;
          const label = section.label.toLowerCase();
          if (label.includes('about')) return recipe.aboutEnabled;
          if (label.includes('gallery') || label.includes('featured work')) {
            return recipe.galleryEnabled && galleryHasContent;
          }
          if (section.sectionType === 'custom_design') return recipe.canvaEnabled;
          return true;
        })
        .map((section) => ({
          ...section,
          label: section.sectionType === 'custom_design' ? 'Canva design' : section.label,
        })),
    }))
    .filter((page) => page.sections.length > 0);
  if (!includeOptionalSections) return pages;
  if (recipe.aboutEnabled) {
    insertPreviewSection(pages, {
      id: 'onboarding-preview-about',
      label: 'About',
      sectionType: 'onboarding_preview_about',
    }, 'before_booking');
  }
  const hasGalleryOutline = pages.some((page) => page.sections.some((item) => {
    const label = item.label.toLowerCase();
    return label.includes('gallery') || label.includes('featured work');
  }));
  if (recipe.galleryEnabled && galleryHasContent && !hasGalleryOutline) {
    insertPreviewSection(pages, {
      id: 'onboarding-preview-gallery',
      label: 'Gallery',
      sectionType: 'onboarding_preview_gallery',
    }, 'before_booking');
  }
  if (recipe.policiesEnabled && policiesHaveContent) {
    insertPreviewSection(pages, {
      id: 'onboarding-preview-policies',
      label: 'Policies',
      sectionType: 'onboarding_preview_policies',
    }, 'after_booking');
  }
  return pages;
};

function StarterStructure({
  document,
  outline,
}: {
  document: SiteBuilderDocument | null;
  outline: CurrentPreviewOutlinePage[];
}) {
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
              {page.sections.map((section) => (
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
  const minimumNoticeCopy = useMemo(
    () => getMinimumNoticeCopy(profile.bookingPreferences.minimumNoticeMinutes),
    [profile.bookingPreferences.minimumNoticeMinutes],
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
        aria-label="Minimum booking notice"
        className="onboarding-customer-booking-notice"
      >
        <span>Minimum booking notice</span>
        <strong>{minimumNoticeCopy.customer}</strong>
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
  profile,
  onDocumentTarget,
  showCustomDesign,
}: {
  device: OnboardingPreviewDevice;
  document: SiteBuilderDocument | null;
  onDocumentTarget: (target: CustomDesignDocumentNavigationTarget) => void;
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
  const measurementHostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const summaryId = useId();
  const viewport = ONBOARDING_PREVIEW_VIEWPORTS[device];
  const [previewScale, setPreviewScale] = useState(1);
  const { profile, recipe } = state;
  const roles = ONBOARDING_STYLE_ROLES[recipe.stylePreset];
  const palette = SITE_PALETTE_BY_ID[recipe.palettePreset];
  const style = {
    '--customer-accent': palette.roles.accent,
    '--customer-body-font': roles.bodyFont,
    '--customer-button': palette.roles.button,
    '--customer-button-text': palette.roles.buttonText,
    '--customer-button-radius': roles.buttonRadius,
    '--customer-focus-ring': palette.roles.focusRing,
    '--customer-ground': palette.roles.ground,
    '--customer-heading-font': roles.headingFont,
    '--customer-ink': palette.roles.ink,
    '--customer-line': palette.roles.line,
    '--customer-muted': palette.roles.muted,
    '--customer-radius': roles.radius,
    '--customer-secondary-accent': palette.roles.secondaryAccent,
    '--customer-section-space': roles.spacingMood,
    '--customer-surface': palette.roles.surface,
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
  const policiesHaveContent = recipe.policiesEnabled && (
    (
      isDepositsAndCancellationsComplete(profile.policies)
      && Boolean(getDepositsAndCancellationsDisplayWording(profile.policies))
    )
    || (['late_arrivals', 'no_shows', 'repairs', 'other'] as const)
      .some((id) => Boolean(textForPolicy(profile, id)))
  );
  const currentOutline = useMemo(
    () => getCurrentPreviewOutline(document, recipe, {
      galleryHasContent: state.gallery.images.length > 0,
      includeOptionalSections,
      policiesHaveContent,
    }),
    [
      document,
      includeOptionalSections,
      policiesHaveContent,
      recipe,
      state.gallery.images.length,
    ],
  );
  const navigationItems = useMemo(() => {
    if (!document?.navigation.enabled) return [];
    const pagesById = new Map(document.pages.map((page) => [page.id, page]));
    const visiblePageIds = new Set(currentOutline.map((page) => page.id));
    return [...document.navigation.items]
      .sort((left, right) => left.order - right.order)
      .filter((item) => (
        pagesById.get(item.pageId)?.visibleInNavigation
        && visiblePageIds.has(item.pageId)
      ))
      .map((item) => ({ label: item.label, pageId: item.pageId }));
  }, [currentOutline, document]);
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
    const measurementHost = measurementHostRef.current;
    if (!measurementHost) return undefined;
    let measurementFrame: number | null = null;
    const updateScale = () => {
      measurementFrame = null;
      const bounds = measurementHost.getBoundingClientRect();
      const nextScale = calculateOnboardingPreviewScale({
        height: bounds.height || measurementHost.clientHeight || viewport.height,
        width: bounds.width || measurementHost.clientWidth || viewport.width,
      }, viewport);
      setPreviewScale((current) => (
        Math.abs(current - nextScale) < 0.0001 ? current : nextScale
      ));
    };
    const scheduleScaleUpdate = () => {
      if (measurementFrame !== null) return;
      measurementFrame = window.requestAnimationFrame(updateScale);
    };
    const visualViewport = window.visualViewport;
    updateScale();
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleScaleUpdate);
    observer?.observe(measurementHost);
    window.addEventListener('resize', scheduleScaleUpdate);
    window.addEventListener('orientationchange', scheduleScaleUpdate);
    visualViewport?.addEventListener('resize', scheduleScaleUpdate);
    return () => {
      if (measurementFrame !== null) window.cancelAnimationFrame(measurementFrame);
      observer?.disconnect();
      window.removeEventListener('resize', scheduleScaleUpdate);
      window.removeEventListener('orientationchange', scheduleScaleUpdate);
      visualViewport?.removeEventListener('resize', scheduleScaleUpdate);
    };
  }, [fitAvailable, viewport.height, viewport.width]);

  useLayoutEffect(() => {
    if (frameRef.current) {
      frameRef.current.inert = interactionMode === 'inline';
    }
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
      style={stageStyle}
    >
      <div
        aria-hidden="true"
        className="onboarding-preview-measurement-host"
        data-preview-measurement-host="true"
        ref={measurementHostRef}
      />
      <span className="visually-hidden" id={summaryId}>
        Visual preview of {title} at a {viewport.width}-pixel {device} viewport.
        {interactionMode === 'inline' ? ' Open the full preview to use customer controls.' : ''}
      </span>
      <div
        className={`onboarding-preview-frame is-${device}`}
        data-preview-device={device}
        data-preview-scroll-container="true"
        data-palette-preset={recipe.palettePreset}
        data-style-preset={recipe.stylePreset}
        ref={frameRef}
        tabIndex={interactionMode === 'inline' ? -1 : 0}
      >
      <div className="onboarding-site-preview" ref={previewRef} style={style}>
        <header className="onboarding-customer-header">
          <Brand profile={profile} />
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
          <StarterStructure document={document} outline={currentOutline} />

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
