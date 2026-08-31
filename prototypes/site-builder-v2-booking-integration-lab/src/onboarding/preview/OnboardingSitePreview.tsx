import {
  CalendarDays,
  Clock3,
  Instagram,
  MapPin,
  MessageCircle,
  Sparkles,
} from 'lucide-react';
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { BookingSectionRenderer } from '../../booking/BookingSectionRenderer';
import { createEmptyBookingSession, summarizeSelection } from '../../booking/helpers';
import { createDefaultBookingPresentationSettings } from '../../booking/presentation';
import type { BookingSessionState } from '../../booking/types';
import { useCustomDesignAssetMap } from '../../custom-design/integration/CustomDesignAssetProvider';
import type { CustomDesignDocumentNavigationTarget } from '../../custom-design/integration/document-actions';
import { isLibrarySection } from '../../model/section-library/registry';
import type { GallerySelection, HeroMediaChoice } from '../../model/section-library/settings';
import {
  buildCustomerPagePlan,
  type SitePlanPage,
  type SitePlanSection,
} from '../../model/site-plan';
import { initializeStarter } from '../../model/starters';
import type { SiteBuilderDocument } from '../../model/types';
import { resolveOnboardingImageUrl } from '../integrations/adapters/media';
import {
  aboutPresetSupportsElement,
  resolveAboutBio,
} from '../model/about';
import { createOnboardingBookingFixture } from '../model/booking-preview';
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
import { getMinimumNoticeCopy } from '../model/minimum-notice';
import { SITE_PALETTE_BY_ID } from '../model/palettes';
import {
  deriveDepositPolicySummary,
  isDepositsAndCancellationsComplete,
} from '../model/policies';
import { getCustomerProfileFacts } from '../model/profile-facts';
import type {
  AboutElementId,
  AboutPresetId,
  BusinessProfileDraft,
  OnboardingLabState,
  SiteStylePresetId,
} from '../model/types';
import {
  deriveSiteLibraryContext,
  deriveSitePlanToggles,
} from '../model/site-library-context';
import { labelForNewClients, labelForVisitMode } from './customer-facts';
import { OnboardingCustomDesignSections } from './OnboardingCustomDesignSections';
import {
  LIBRARY_SECTION_PREVIEW_RENDERERS,
  type LibraryPreviewShared,
} from './section-renderers';

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

/**
 * Honest hero imagery: a photo or emblem renders only from the owner's own
 * shared assets; with nothing to show, the gradient backdrop stands alone.
 */
function HeroMedia({ media, profile }: {
  media: HeroMediaChoice;
  profile: BusinessProfileDraft;
}) {
  const image = media === 'profile_photo' ? profile.profilePhoto : profile.logo;
  const assetIds = image?.storageId ? [image.storageId] : [];
  const assets = useCustomDesignAssetMap(assetIds);
  if (media === 'gradient') return null;
  const source = resolveOnboardingImageUrl(image, assets);
  if (media === 'profile_photo') {
    return source
      ? (
          <div className="onboarding-customer-hero__media">
            <img alt="" src={source} />
          </div>
        )
      : null;
  }
  return (
    <div className="onboarding-customer-hero__media is-emblem">
      {source
        ? <img alt="" src={source} />
        : (
            <i aria-hidden="true">
              {identityInitials(profile.businessName, 'L')}
            </i>
          )}
    </div>
  );
}

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

type PreviewBookHandler = (event: ReactMouseEvent<HTMLAnchorElement>) => void;

function AboutActions({ onBook, profile }: {
  onBook: PreviewBookHandler;
  profile: BusinessProfileDraft;
}) {
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
      {hasBooking ? <a href="#booking" onClick={onBook}><CalendarDays aria-hidden="true" size={16} /> Book now</a> : null}
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

const EMPTY_ABOUT_FACT_LABELS: readonly string[] = [];

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
  excludeLabels = EMPTY_ABOUT_FACT_LABELS,
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

function AboutCopy({ introOverride, profile }: {
  introOverride?: string;
  profile: BusinessProfileDraft;
}) {
  const visibility = profile.about.visibility;
  const sharedBio = resolveAboutBio(profile.about.shortBio, profile.about.fullBio);
  // A deliberate section-level intro replaces only the lead line; the shared
  // expanded biography still comes from the Business Profile.
  const bio = introOverride?.trim()
    ? { ...sharedBio, lead: introOverride.trim() }
    : sharedBio;
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
      {(introOverride?.trim() || isAboutVisible(visibility, 'bio')) && bio.lead ? (
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

function AboutSection({ hoursStatus, introOverride, onBook, preset, profile, sectionId, showPolicySummary }: {
  hoursStatus: WeeklyHoursPreviewStatus | null;
  introOverride?: string;
  onBook: PreviewBookHandler;
  preset: AboutPresetId;
  profile: BusinessProfileDraft;
  sectionId?: string;
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
        data-section-id={sectionId}
        data-preview-target="about"
      >
        {showPortrait ? <Portrait large profile={profile} respectAboutVisibility /> : null}
        <div className="onboarding-about-editorial-story">
          <AboutCopy introOverride={introOverride} profile={profile} />
          <AboutSpecialties profile={profile} />
          <AboutActions onBook={onBook} profile={profile} />
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
        data-section-id={sectionId}
        data-preview-target="about"
      >
        <div className="onboarding-about-quick-identity">
          {showPortrait ? <Portrait profile={profile} respectAboutVisibility /> : null}
          <AboutCopy introOverride={introOverride} profile={profile} />
        </div>
        <AboutActions onBook={onBook} profile={profile} />
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
        data-section-id={sectionId}
        data-preview-target="about"
      >
        <div className="onboarding-about-profile">
          <div className="onboarding-about-before-identity">
            {showPortrait ? <Portrait profile={profile} respectAboutVisibility /> : null}
            <AboutCopy introOverride={introOverride} profile={profile} />
          </div>
          <AboutSpecialties profile={profile} />
          <AboutActions onBook={onBook} profile={profile} />
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
      data-section-id={sectionId}
      data-preview-target="about"
    >
      <div className="onboarding-about-photo-copy">
        <AboutCopy introOverride={introOverride} profile={profile} />
        <AboutSpecialties profile={profile} />
        <AboutActions onBook={onBook} profile={profile} />
        <AboutFacts hoursStatus={hoursStatus} maxVisible={2} presentation="pills" profile={profile} />
        {policySummary}
      </div>
      {showPortrait ? <Portrait large profile={profile} respectAboutVisibility /> : null}
    </section>
  );
}

const hasPublicContactSectionContent = (profile: BusinessProfileDraft): boolean => {
  const location = getPublicLocationPreview(profile.location);
  const contacts = getPublicContactActions(profile).filter(
    action => action.method !== 'booking',
  );
  const weeklyHours = getPublicWeeklyHours(profile.hours);
  const serviceLocation = getCustomerProfileFacts(profile).some(
    (fact) => fact.id === 'service_location',
  );
  return Boolean(
    location.primary
    || serviceLocation
    || contacts.length > 0
    || weeklyHours.length > 0
  );
};

function ContactSection({ onBook, profile, sectionId }: {
  onBook: PreviewBookHandler;
  profile: BusinessProfileDraft;
  sectionId?: string;
}) {
  const location = getPublicLocationPreview(profile.location);
  const contacts = getPublicContactActions(profile);
  const directions = getPublicDirectionsAction(profile.location);
  const weeklyHours = getPublicWeeklyHours(profile.hours);
  const serviceLocation = getCustomerProfileFacts(profile).find(
    (fact) => fact.id === 'service_location',
  );
  if (!hasPublicContactSectionContent(profile)) return null;
  return (
    <section
      aria-label="Visit and contact"
      className="onboarding-customer-contact"
      data-section-id={sectionId}
    >
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
            onClick={contact.method === 'booking' ? onBook : undefined}
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

function GallerySection({ sectionId, selection, state }: {
  sectionId?: string;
  selection?: GallerySelection;
  state: OnboardingLabState;
}) {
  // A deliberate picked selection shows exactly those photos, in that order;
  // ids that no longer exist simply don't render.
  const images = selection?.mode === 'picked'
    ? selection.imageIds.flatMap((imageId) => {
        const image = state.gallery.images.find(candidate => candidate.id === imageId);
        return image ? [image] : [];
      })
    : state.gallery.images;
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
    <section
      aria-label="Gallery"
      className={`onboarding-customer-gallery is-${state.gallery.layout}`}
      data-section-id={sectionId}
    >
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
  sectionId,
}: {
  document: SiteBuilderDocument | null;
  device: OnboardingPreviewDevice;
  profile: BusinessProfileDraft;
  sectionId?: string;
}) {
  const documentBookingSection = document?.pages
    .flatMap((page) => page.sections)
    .find((section) => (
      section.sectionType === 'booking'
      && (!sectionId || section.id === sectionId)
    ));
  const bookingSettings = documentBookingSection?.sectionType === 'booking'
    ? documentBookingSection.settings
    : createDefaultBookingPresentationSettings();
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
      data-section-id={sectionId ?? documentBookingSection?.id}
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

export type OnboardingSitePreviewProps = {
  customerPagePlan?: SitePlanPage[];
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
  customerPagePlan,
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
  const pendingDocumentTargetRef = useRef<CustomDesignDocumentNavigationTarget | null>(null);
  const summaryId = useId();
  const viewport = ONBOARDING_PREVIEW_VIEWPORTS[device];
  const [activePageId, setActivePageId] = useState<string | null>(null);
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
  const starter = document?.originStarter ?? recipe.starter ?? 'quick_book';
  // Before the Builder document exists, the preview plans against a pristine
  // starter document with deterministic ids, so both eras share one ladder.
  const effectiveDocument = useMemo(() => {
    if (document) return document;
    let counter = 0;
    return initializeStarter(starter, {
      idFactory: kind => `onboarding-preview-${starter}-${kind}-${counter++}`,
    });
  }, [document, starter]);
  const libraryContext = useMemo(
    () => deriveSiteLibraryContext(state, effectiveDocument),
    [effectiveDocument, state],
  );
  const derivedPagePlan = useMemo(
    () => buildCustomerPagePlan(effectiveDocument, {
      context: libraryContext,
      includeOptionalSections,
      toggles: deriveSitePlanToggles(state),
    }),
    [effectiveDocument, includeOptionalSections, libraryContext, state],
  );
  // Account-backed Preview passes the exact persisted customer page plan.
  // Final Review derives the same shape from the in-progress Builder document.
  const pagePlan = customerPagePlan ?? derivedPagePlan;
  const presentTypes = useMemo(() => new Set(
    pagePlan.flatMap(page => page.sections.map(section => section.sectionType)),
  ), [pagePlan]);
  const activePage = pagePlan.find(page => page.id === activePageId) ?? pagePlan[0] ?? null;
  const navigationItems = useMemo(() => {
    if (!document?.navigation.enabled) return [];
    const pagesById = new Map(document.pages.map((page) => [page.id, page]));
    const visiblePageIds = new Set(pagePlan.map((page) => page.id));
    return [...document.navigation.items]
      .sort((left, right) => left.order - right.order)
      .filter((item) => (
        pagesById.get(item.pageId)?.visibleInNavigation
        && visiblePageIds.has(item.pageId)
      ))
      .map((item) => ({ label: item.label, pageId: item.pageId }));
  }, [document, pagePlan]);
  const bookingPage = pagePlan.find(page => page.sections.some(section => (
    section.sectionType === 'booking'
  ))) ?? null;
  const revealCurrentDocumentTarget = useCallback((target: CustomDesignDocumentNavigationTarget) => {
    const preview = previewRef.current;
    if (!preview) return;
    const targetElement = target.sectionId
      ? [...preview.querySelectorAll<HTMLElement>('[data-section-id]')]
        .find((element) => element.dataset.sectionId === target.sectionId)
      : [...preview.querySelectorAll<HTMLElement>('[data-preview-page-id]')]
        .find((element) => element.dataset.previewPageId === target.pageId);
    targetElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const revealDocumentTarget = useCallback((target: CustomDesignDocumentNavigationTarget) => {
    if (pagePlan.length <= 1 || activePage?.id === target.pageId) {
      revealCurrentDocumentTarget(target);
      return;
    }
    if (!pagePlan.some(page => page.id === target.pageId)) return;
    pendingDocumentTargetRef.current = target;
    setActivePageId(target.pageId);
  }, [activePage?.id, pagePlan, revealCurrentDocumentTarget]);
  const navigateToBooking = useCallback<PreviewBookHandler>((event) => {
    event.preventDefault();
    if (!bookingPage) return;
    revealDocumentTarget({
      kind: 'booking',
      pageId: bookingPage.id,
      relationship: activePage?.id === bookingPage.id ? 'same_page' : 'cross_page',
      sectionId: bookingPage.sections.find(section => section.sectionType === 'booking')?.id,
    });
  }, [activePage?.id, bookingPage, revealDocumentTarget]);

  useLayoutEffect(() => {
    const targetPage = initialTarget === 'about'
      ? pagePlan.find(page => page.sections.some(section => section.sectionType === 'about'))
      : pagePlan[0];
    setActivePageId((current) => (
      initialTarget === 'about' || !pagePlan.some(page => page.id === current)
        ? targetPage?.id ?? null
        : current
    ));
  }, [initialTarget, pagePlan]);

  useLayoutEffect(() => {
    const pendingTarget = pendingDocumentTargetRef.current;
    if (!pendingTarget || pendingTarget.pageId !== activePage?.id) return;
    pendingDocumentTargetRef.current = null;
    revealCurrentDocumentTarget(pendingTarget);
  }, [activePage?.id, revealCurrentDocumentTarget]);

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
  }, [fitAvailable, viewport]);

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
  }, [activePage?.id, device, includeOptionalSections, initialTarget, recipe.aboutEnabled, recipe.aboutPreset]);

  const stageStyle = {
    '--preview-scale': String(previewScale),
    '--preview-stage-height': `${Math.round(viewport.height * previewScale)}px`,
    '--preview-target-height': `${viewport.height}px`,
    '--preview-target-width': `${viewport.width}px`,
  } as CSSProperties;
  const renderedPages = starter === 'multi_page'
    ? (activePage ? [activePage] : [])
    : pagePlan;
  const renderPreviewSection = (
    page: SitePlanPage,
    planSection: SitePlanSection,
  ): ReactNode => {
    const instance = planSection.section;
    if (planSection.sectionType === 'hero') {
      const heroSettings = instance.sectionType === 'hero' ? instance.settings : null;
      const headline = heroSettings && heroSettings.headline.source === 'override'
        && heroSettings.headline.value.trim()
        ? heroSettings.headline.value
        : title;
      const intro = heroSettings && heroSettings.intro.source === 'override'
        && heroSettings.intro.value.trim()
        ? heroSettings.intro.value
        : heroDescription;
      return (
        <section
          className={`onboarding-customer-hero is-${heroSettings?.preset ?? 'booking_first'}`}
          data-section-id={planSection.id}
          data-surface={planSection.surface}
          key={planSection.id}
        >
          <div>
            {heroSettings?.showLocationEyebrow !== false ? (
              <p className="onboarding-customer-eyebrow">{area || 'Independent nail care'}</p>
            ) : null}
            <h2>{headline}</h2>
            <p>{intro}</p>
            {heroSettings?.showStatusLine !== false ? (
              <div className="onboarding-customer-statuses">
                {visitMode ? <span>{visitMode}</span> : null}
                {newClients ? <span>{newClients}</span> : null}
                {hoursStatus ? <span data-hours-status={hoursStatus.kind}>{hoursStatus.label}</span> : null}
              </div>
            ) : null}
            <a className="onboarding-customer-primary" href="#booking" onClick={navigateToBooking}>
              {heroSettings?.primaryCtaLabel.trim() || 'Book an appointment'}
            </a>
          </div>
          {heroSettings && heroSettings.preset !== 'booking_first' ? (
            <HeroMedia media={heroSettings.media} profile={profile} />
          ) : null}
        </section>
      );
    }
    if (planSection.sectionType === 'about') {
      // Live onboarding lets the About design screen drive the preset; the
      // saved plan renders the preset the compiler stamped into the section.
      const aboutPreset = customerPagePlan && instance.sectionType === 'about'
        ? instance.settings.preset
        : recipe.aboutPreset;
      const aboutIntroOverride = instance.sectionType === 'about'
        && instance.settings.intro.source === 'override'
        ? instance.settings.intro.value
        : undefined;
      return (
        <AboutSection
          key={planSection.id}
          hoursStatus={hoursStatus}
          introOverride={aboutIntroOverride}
          onBook={navigateToBooking}
          preset={aboutPreset}
          profile={profile}
          sectionId={planSection.id}
          showPolicySummary={recipe.policiesEnabled}
        />
      );
    }
    if (planSection.sectionType === 'gallery') {
      return (
        <GallerySection
          key={planSection.id}
          sectionId={planSection.id}
          selection={instance.sectionType === 'gallery' ? instance.settings.selection : undefined}
          state={state}
        />
      );
    }
    if (planSection.sectionType === 'booking') {
      return (
        <BookingSection
          key={planSection.id}
          device={device}
          document={document}
          profile={profile}
          sectionId={planSection.id}
        />
      );
    }
    if (planSection.sectionType === 'contact') {
      return (
        <ContactSection
          key={planSection.id}
          onBook={navigateToBooking}
          profile={profile}
          sectionId={planSection.id}
        />
      );
    }
    if (planSection.sectionType === 'custom_design') {
      return (
        <OnboardingCustomDesignSections
          key={planSection.id}
          document={document}
          onDocumentTarget={revealDocumentTarget}
          pageId={page.id}
          sectionIds={[planSection.id]}
        />
      );
    }
    if (!isLibrarySection(instance)) return null;
    const Renderer = LIBRARY_SECTION_PREVIEW_RENDERERS[instance.sectionType];
    if (!Renderer) return null;
    const shared: LibraryPreviewShared = {
      area,
      context: libraryContext,
      onBook: navigateToBooking,
      pageSections: page.sections,
      presentTypes,
      state,
      title,
    };
    return (
      <Renderer
        key={planSection.id}
        planSection={planSection}
        section={instance}
        shared={shared}
      />
    );
  };

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
        aria-label={interactionMode === 'interactive' ? 'Customer website viewport' : undefined}
        className={`onboarding-preview-frame is-${device}`}
        data-preview-device={device}
        data-preview-scroll-container="true"
        data-palette-preset={recipe.palettePreset}
        data-style-preset={recipe.stylePreset}
        ref={frameRef}
        role={interactionMode === 'interactive' ? 'region' : undefined}
        tabIndex={interactionMode === 'inline' ? -1 : 0}
      >
      <div className="onboarding-site-preview" ref={previewRef} style={style}>
        <header className={`onboarding-customer-header${starter === 'multi_page' ? ' has-page-navigation' : ''}`}>
          <Brand profile={profile} />
          {starter !== 'quick_book' ? (
            <nav
              aria-label="Customer preview navigation"
              className={starter === 'multi_page' ? 'is-page-navigation' : undefined}
            >
              {starter === 'multi_page' ? navigationItems.map((item) => (
                <a
                  aria-current={activePage?.id === item.pageId ? 'page' : undefined}
                  href={`#preview-page-${item.pageId}`}
                  key={item.pageId}
                  onClick={(event) => {
                    event.preventDefault();
                    pendingDocumentTargetRef.current = null;
                    setActivePageId(item.pageId);
                    if (frameRef.current) frameRef.current.scrollTop = 0;
                  }}
                >
                  {item.label}
                </a>
              )) : null}
              {bookingPage ? <a href="#booking" onClick={navigateToBooking}>Book</a> : null}
            </nav>
          ) : null}
        </header>

        <div className="onboarding-customer-content">
          {renderedPages.map((page) => (
            <div
              aria-label={starter === 'multi_page' ? `${page.label} page` : undefined}
              className="onboarding-customer-page"
              data-preview-page-id={page.id}
              id={`preview-page-${page.id}`}
              key={page.id}
              role={starter === 'multi_page' ? 'region' : undefined}
            >
              {page.sections.map(section => renderPreviewSection(page, section))}
            </div>
          ))}
        </div>

        {presentTypes.has('footer') ? null : (
          <footer className="onboarding-customer-footer">
            <strong>{title}</strong>
            {area ? <span>{area}</span> : null}
            <small>Powered by Luster</small>
          </footer>
        )}
      </div>
      </div>
    </section>
  );
}
