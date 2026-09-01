import {
  CalendarDays,
  Instagram,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
} from 'lucide-react';
import {
  type CSSProperties,
  Fragment,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import {
  BookingSectionRenderer,
  type BookingSessionUpdater,
} from '../../booking/BookingSectionRenderer';
import { createEmptyBookingSession, summarizeSelection } from '../../booking/helpers';
import { createDefaultBookingPresentationSettings } from '../../booking/presentation';
import type { BookingSessionState } from '../../booking/types';
import { useCustomDesignAssetMap } from '../../custom-design/integration/CustomDesignAssetProvider';
import type { CustomDesignDocumentNavigationTarget } from '../../custom-design/integration/document-actions';
import { hasRenderableCustomDesignContent } from '../../custom-design/model/settings';
import type { CustomDesignSettings } from '../../custom-design/model/types';
import { isLibrarySection } from '../../model/section-library/registry';
import type {
  GalleryPresetId,
  GallerySelection,
} from '../../model/section-library/settings';
import {
  sectionOwnsContent,
  type SiteContentKey,
  type SiteContentPlacementPlan,
} from '../../model/content-placement';
import {
  buildCustomerSiteComposition,
  filterCustomerPagePlanSections,
  type SitePlanPage,
  type SitePlanSection,
} from '../../model/site-plan';
import { initializeStarter } from '../../model/starters';
import type { SectionType, SiteBuilderDocument } from '../../model/types';
import { resolveOnboardingImageUrl } from '../integrations/adapters/media';
import {
  aboutPresetSupportsElement,
  resolveAboutBio,
} from '../model/about';
import { createOnboardingBookingFixture } from '../model/booking-preview';
import {
  getPublicContactActions,
  type PublicContactAction,
} from '../model/contact';
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
import { getCustomerProfileFacts } from '../model/profile-facts';
import { applyOnboardingSitePresentation } from '../model/site-document-presentation';
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
import { sectionAnchorId } from './section-anchors';
import {
  getBeforeYouBookEntries,
  LIBRARY_SECTION_PREVIEW_RENDERERS,
  type LibraryPreviewShared,
} from './section-renderers';

export type OnboardingPreviewDevice = 'phone' | 'tablet' | 'desktop';
export type OnboardingPreviewInitialTarget = 'top' | 'about';
export type OnboardingPreviewInteractionMode = 'inline' | 'interactive';
export type OnboardingPreviewOverlayMode = 'contained' | 'page';

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

/**
 * Each contact method gets its own mark. A single generic glyph made
 * "Book now" and "Instagram" look like the same action.
 */
const ContactMethodIcon = ({ method }: {
  method: PublicContactAction['method'];
}) => {
  if (method === 'booking') return <CalendarDays aria-hidden="true" size={16} />;
  if (method === 'instagram') return <Instagram aria-hidden="true" size={16} />;
  if (method === 'call') return <Phone aria-hidden="true" size={16} />;
  if (method === 'email') return <Mail aria-hidden="true" size={16} />;
  return <MessageCircle aria-hidden="true" size={16} />;
};

const contentKeyForContactMethod = (
  method: PublicContactAction['method'],
): SiteContentKey | null => {
  if (method === 'instagram') return 'instagram';
  if (method === 'call') return 'phone';
  if (method === 'text') return 'text';
  if (method === 'email') return 'email';
  return null;
};

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

const V1_SECTION_NAVIGATION_LABELS: Partial<Record<SectionType, string>> = {
  about: 'About',
  booking: 'Services & Booking',
  gallery: 'Gallery',
  hero: 'Home',
  policies: 'Before You Book',
  reviews: 'Reviews',
  team: 'About',
  visit_us: 'Visit & Contact',
};

/** A style-owned no-media treatment; it never borrows Profile or Logo. */
function HeroDecoration({ title }: { title: string }) {
  return (
    <div className="onboarding-customer-hero__media is-emblem">
      <i aria-hidden="true">{identityInitials(title, 'L')}</i>
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
          data-content-key="brand_logo"
          data-content-owner="site_header"
          data-media-id={profile.logo?.storageId ?? profile.logo?.id}
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
  ownerId,
  profile,
  respectAboutVisibility = false,
}: {
  large?: boolean;
  ownerId: string;
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
      data-content-key="owner_profile_photo"
      data-content-owner={ownerId}
      data-media-id={profile.profilePhoto?.storageId ?? profile.profilePhoto?.id}
      data-media-role="profile"
      src={source}
    />
  ) : (
    <span
      aria-label={`${visibleIdentity || 'Business owner'} portrait placeholder`}
      className={`onboarding-customer-portrait onboarding-customer-portrait--initials${large ? ' is-large' : ''}`}
      data-content-key="owner_profile_photo"
      data-content-owner={ownerId}
      data-media-role="profile"
      role="img"
    >
      {initials || 'L'}
    </span>
  );
}

type PreviewBookHandler = (event: ReactMouseEvent<HTMLAnchorElement>) => void;

type AboutFact = {
  contentKey?: SiteContentKey;
  label: string;
  value: string;
};

const EMPTY_ABOUT_FACT_LABELS: readonly string[] = [];

const getAboutFacts = (
  profile: BusinessProfileDraft,
  hoursStatus: WeeklyHoursPreviewStatus | null,
): AboutFact[] => {
  const visibility = profile.about.visibility;
  const facts: AboutFact[] = [];
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
    facts.push({ contentKey: 'location', label: fact.label, value: fact.value });
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
  if (hoursStatus) {
    facts.push({
      contentKey: 'business_hours',
      label: 'Hours',
      value: hoursStatus.label,
    });
  }

  const appointment = facts.find(fact => fact.label === 'Appointments');
  if (appointment) appointment.contentKey = 'appointment_mode';
  const newClientsFact = facts.find(fact => fact.label === 'New clients');
  if (newClientsFact) newClientsFact.contentKey = 'new_client_status';

  return facts;
};

function AboutFacts({
  contentPlacement,
  excludeLabels = EMPTY_ABOUT_FACT_LABELS,
  hoursStatus,
  maxVisible = 4,
  pageId,
  presentation = 'grid',
  profile,
  sectionId,
}: {
  contentPlacement: SiteContentPlacementPlan;
  excludeLabels?: readonly string[];
  hoursStatus: WeeklyHoursPreviewStatus | null;
  maxVisible?: number;
  pageId: string;
  presentation?: 'grid' | 'pills';
  profile: BusinessProfileDraft;
  sectionId: string;
}) {
  const facts = getAboutFacts(profile, hoursStatus)
    .filter((fact) => !excludeLabels.includes(fact.label))
    .filter(fact => !fact.contentKey || sectionOwnsContent(
      contentPlacement,
      fact.contentKey,
      sectionId,
      pageId,
    ));
  if (facts.length === 0) return null;
  const visibleFacts = facts.slice(0, maxVisible);
  const additionalFacts = facts.slice(maxVisible);

  return (
    <div className="onboarding-about-facts-wrap">
      <dl className={`onboarding-about-facts is-${presentation}`}>
        {visibleFacts.map((fact) => (
          <div
            data-content-key={fact.contentKey}
            data-content-owner={fact.contentKey ? sectionId : undefined}
            key={fact.label}
          >
            <dt>{fact.label}</dt><dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {additionalFacts.length > 0 ? (
        <details className="onboarding-about-facts-more">
          <summary>More details</summary>
          <dl>
            {additionalFacts.map((fact) => (
              <div
                data-content-key={fact.contentKey}
                data-content-owner={fact.contentKey ? sectionId : undefined}
                key={fact.label}
              >
                <dt>{fact.label}</dt><dd>{fact.value}</dd>
              </div>
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

function AboutSection({
  contentPlacement,
  hoursStatus,
  introOverride,
  pageId,
  preset,
  profile,
  sectionId,
}: {
  contentPlacement: SiteContentPlacementPlan;
  hoursStatus: WeeklyHoursPreviewStatus | null;
  introOverride?: string;
  pageId: string;
  preset: AboutPresetId;
  profile: BusinessProfileDraft;
  sectionId: string;
}) {
  const visibility = profile.about.visibility;
  const supports = (id: AboutElementId) => aboutPresetSupportsElement(preset, id);
  const showPortrait = supports('profile_photo')
    && isAboutVisible(visibility, 'profile_photo')
    && sectionOwnsContent(
      contentPlacement,
      'owner_profile_photo',
      sectionId,
      pageId,
    );
  const facts = (props: Pick<Parameters<typeof AboutFacts>[0],
    'excludeLabels' | 'maxVisible' | 'presentation'> = {}) => (
      <AboutFacts
        {...props}
        contentPlacement={contentPlacement}
        hoursStatus={hoursStatus}
        pageId={pageId}
        profile={profile}
        sectionId={sectionId}
      />
    );

  if (preset === 'editorial_portrait') {
    return (
      <section
        aria-label="About"
        className={`onboarding-customer-about is-editorial${showPortrait ? ' has-portrait' : ''}`}
        data-section-id={sectionId}
        data-preview-target="about"
        id={sectionId ? sectionAnchorId(sectionId, 'about') : undefined}
      >
        {showPortrait ? (
          <Portrait large ownerId={sectionId} profile={profile} respectAboutVisibility />
        ) : null}
        <div className="onboarding-about-editorial-story">
          <AboutCopy introOverride={introOverride} profile={profile} />
          <AboutSpecialties profile={profile} />
          {facts({ maxVisible: 2, presentation: 'pills' })}
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
        id={sectionId ? sectionAnchorId(sectionId, 'about') : undefined}
      >
        <div className="onboarding-about-quick-identity">
          {showPortrait ? (
            <Portrait ownerId={sectionId} profile={profile} respectAboutVisibility />
          ) : null}
          <AboutCopy introOverride={introOverride} profile={profile} />
        </div>
        {facts()}
        <AboutSpecialties profile={profile} />
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
        id={sectionId ? sectionAnchorId(sectionId, 'about') : undefined}
      >
        <div className="onboarding-about-profile">
          <div className="onboarding-about-before-identity">
            {showPortrait ? (
              <Portrait ownerId={sectionId} profile={profile} respectAboutVisibility />
            ) : null}
            <AboutCopy introOverride={introOverride} profile={profile} />
          </div>
          <AboutSpecialties profile={profile} />
        </div>
        {facts({
          excludeLabels: ['Appointments', 'New clients'],
          maxVisible: 2,
          presentation: 'pills',
        })}
      </section>
    );
  }

  return (
    <section
      aria-label="About"
      className={`onboarding-customer-about is-photo-right${showPortrait ? ' has-portrait' : ''}`}
      data-section-id={sectionId}
      data-preview-target="about"
      id={sectionId ? sectionAnchorId(sectionId, 'about') : undefined}
    >
      <div className="onboarding-about-photo-copy">
        <AboutCopy introOverride={introOverride} profile={profile} />
        <AboutSpecialties profile={profile} />
        {facts({ maxVisible: 2, presentation: 'pills' })}
      </div>
      {showPortrait ? (
        <Portrait large ownerId={sectionId} profile={profile} respectAboutVisibility />
      ) : null}
    </section>
  );
}

function ContactSection({ contentPlacement, pageId, profile, sectionId }: {
  contentPlacement: SiteContentPlacementPlan;
  pageId: string;
  profile: BusinessProfileDraft;
  sectionId: string;
}) {
  const location = getPublicLocationPreview(profile.location);
  const ownsLocation = sectionOwnsContent(
    contentPlacement,
    'location',
    sectionId,
    pageId,
  );
  const ownsHours = sectionOwnsContent(
    contentPlacement,
    'business_hours',
    sectionId,
    pageId,
  );
  type ContactPlacementAction = {
    contact: PublicContactAction;
    contentKey: SiteContentKey | null;
  };
  const contacts = getPublicContactActions(profile).flatMap(
    (contact): ContactPlacementAction[] => {
    // Booking already has canonical actions in the Hero, shell shortcut, and
    // Services & Booking. Visit & Contact owns only public contact methods.
    if (contact.method === 'booking') return [];
    const contentKey = contentKeyForContactMethod(contact.method);
    return contentKey && sectionOwnsContent(
      contentPlacement,
      contentKey,
      sectionId,
      pageId,
    )
      ? [{ contact, contentKey }]
      : [];
    },
  );
  const directions = getPublicDirectionsAction(profile.location);
  const weeklyHours = ownsHours ? getPublicWeeklyHours(profile.hours) : [];
  const serviceLocation = getCustomerProfileFacts(profile).find(
    (fact) => fact.id === 'service_location',
  );
  const publicContacts = contacts.filter(({ contentKey }) => contentKey !== null);
  if ((!ownsLocation || !location.primary)
    && publicContacts.length === 0
    && weeklyHours.length === 0
    && !profile.bookingOnlyContact) return null;
  return (
    <section
      aria-label="Visit and contact"
      className="onboarding-customer-contact"
      data-section-id={sectionId}
      id={sectionId ? sectionAnchorId(sectionId, 'contact') : undefined}
    >
      <div>
        <p className="onboarding-customer-eyebrow">Visit &amp; Contact</p>
        <h2>Find or contact the salon</h2>
        {ownsLocation && location.primary ? (
          <p data-content-key="location" data-content-owner={sectionId}>
            <MapPin aria-hidden="true" size={17} />
            {' '}
            {profile.location.addressVisibility === 'public'
              && profile.location.exactAddress.trim() === location.primary ? (
                <span data-content-key="exact_address" data-content-owner={sectionId}>
                  {location.primary}
                </span>
              ) : location.primary}
          </p>
        ) : null}
        {ownsLocation && location.detail ? <small>{location.detail}</small> : null}
        {ownsLocation && serviceLocation ? <small>{serviceLocation.value}</small> : null}
        {profile.bookingOnlyContact ? (
          <small data-content-key="booking_only_contact" data-content-owner={sectionId}>
            Contact is kept private. Please use online booking to arrange your appointment.
          </small>
        ) : null}
      </div>
      {weeklyHours.length > 0 ? (
        <div
          aria-label="Weekly hours"
          className="onboarding-customer-weekly-hours"
          data-content-key="business_hours"
          data-content-owner={sectionId}
          role="group"
        >
          <h3>Hours</h3>
          <dl>
            {weeklyHours.map((day) => (
              <div key={day.weekday}><dt>{day.label}</dt><dd>{day.hours}</dd></div>
            ))}
          </dl>
        </div>
      ) : null}
      <div className="onboarding-customer-actions">
        {/* The preferred way to reach the salon leads; Directions follows it. */}
        {contacts.map(({ contact, contentKey }, index) => (
          <Fragment key={`${contact.method}-${contact.href}`}>
          <a
            className={contact.preferred ? 'is-preferred' : 'is-secondary'}
            data-content-key={contentKey ?? undefined}
            data-content-owner={contentKey ? sectionId : undefined}
            data-contact-method={contact.method}
            href={contact.href}
            rel={contact.rel}
            target={contact.target}
          >
            <ContactMethodIcon method={contact.method} />
            {contact.actionLabel}{contact.preferred && contact.method !== 'booking' ? ' · Preferred' : ''}
          </a>
          {index === 0 && ownsLocation && directions ? (
            <a
              aria-label={directions.accessibleLabel}
              className="is-secondary"
              href={directions.href}
              rel={directions.rel}
              target={directions.target}
            >
              <MapPin aria-hidden="true" size={16} /> Directions
            </a>
          ) : null}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function GallerySection({ compact = false, preset, sectionId, selection, state }: {
  compact?: boolean;
  preset?: GalleryPresetId;
  sectionId?: string;
  selection?: GallerySelection;
  state: OnboardingLabState;
}) {
  // A deliberate picked selection shows exactly those photos, in that order;
  // ids that no longer exist simply don't render.
  const selectedImages = selection?.mode === 'picked'
    ? selection.imageIds.flatMap((imageId) => {
        const image = state.gallery.images.find(candidate => candidate.id === imageId);
        return image ? [image] : [];
      })
    : state.gallery.images;
  const images = selectedImages.slice(0, compact ? 4 : 6);
  const assetIds = images.flatMap((image) => image.storageId ? [image.storageId] : []);
  const assets = useCustomDesignAssetMap(assetIds);
  if (!state.recipe.galleryEnabled) return null;
  if (images.length === 0) return null;
  const tiles: ReactNode[] = images.flatMap((image, index) => {
    const source = resolveOnboardingImageUrl(image, assets);
    return source ? [(
      <img
        alt={image.altText || `Portfolio work ${index + 1}`}
        data-media-id={image.storageId ?? image.id}
        data-media-role="gallery"
        key={image.id}
        src={source}
      />
    )] : [];
  });
  if (tiles.length === 0) return null;
  return (
    <section
      aria-label="Gallery"
      className={`onboarding-customer-gallery is-${preset ?? state.gallery.layout}${compact ? ' is-compact' : ''}`}
      data-content-key="gallery_media"
      data-content-owner={sectionId}
      data-section-id={sectionId}
      id={sectionId ? sectionAnchorId(sectionId, 'gallery') : undefined}
    >
      <p className="onboarding-customer-eyebrow">Recent work</p>
      <h2>A little nail inspiration</h2>
      <div>{tiles}</div>
    </section>
  );
}

function BookingSection({
  compactPolicies = false,
  contentPlacement,
  document,
  device,
  onSessionChange,
  overlayHost,
  pageId,
  profile,
  sectionId,
  session,
}: {
  compactPolicies?: boolean;
  contentPlacement: SiteContentPlacementPlan;
  document: SiteBuilderDocument | null;
  device: OnboardingPreviewDevice;
  onSessionChange?: BookingSessionUpdater;
  overlayHost?: HTMLElement | null;
  pageId: string;
  profile: BusinessProfileDraft;
  sectionId?: string;
  session?: BookingSessionState;
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
  const placementAwareBookingSettings = bookingSettings.layout === 'visual_grid'
    && !contentPlacement.showBookingFeaturedRail
    ? {
        ...bookingSettings,
        layoutSettings: {
          ...bookingSettings.layoutSettings,
          showFeatured: false,
        },
      }
    : bookingSettings;
  const ownsBookingFact = (contentKey: Extract<SiteContentKey,
    'appointment_mode' | 'new_client_status' | 'minimum_notice'>) => sectionOwnsContent(
      contentPlacement,
      contentKey,
      sectionId ?? null,
      pageId,
    );
  const fixture = useMemo(
    () => {
      const created = createOnboardingBookingFixture(profile);
      return {
        ...created,
        salon: {
          ...created.salon,
          // Booking remains operational without republishing a customer-facing
          // address already owned by Visit Us, Contact, or Quick Info.
          location: 'Location shared during booking',
        },
      };
    },
    [profile],
  );
  const [internalSession, setInternalSession] = useState<BookingSessionState>(
    createPreviewBookingSession,
  );
  const effectiveSession = session ?? internalSession;
  const updateSession = onSessionChange ?? setInternalSession;
  const summary = useMemo(() => summarizeSelection(
    effectiveSession.selection,
    fixture.services,
    fixture.addOns,
  ), [effectiveSession.selection, fixture.addOns, fixture.services]);
  const minimumNoticeCopy = useMemo(
    () => getMinimumNoticeCopy(profile.bookingPreferences.minimumNoticeMinutes),
    [profile.bookingPreferences.minimumNoticeMinutes],
  );
  const bookingFacts = [
    {
      contentKey: 'appointment_mode' as const,
      label: 'Appointments',
      value: labelForVisitMode(profile),
    },
    {
      contentKey: 'new_client_status' as const,
      label: 'New clients',
      value: labelForNewClients(profile),
    },
    {
      contentKey: 'minimum_notice' as const,
      label: 'Minimum booking notice',
      value: minimumNoticeCopy.customer,
    },
  ].filter(fact => fact.value && ownsBookingFact(fact.contentKey));
  const policyEntries = compactPolicies
    ? getBeforeYouBookEntries(profile.policies).filter(entry => sectionOwnsContent(
        contentPlacement,
        entry.contentKey,
        sectionId ?? null,
        pageId,
      ))
    : [];

  return (
    <section
      aria-label="Booking"
      className="onboarding-customer-booking"
      data-content-key="service_catalogue"
      data-content-owner={sectionId ?? documentBookingSection?.id}
      data-section-id={sectionId ?? documentBookingSection?.id}
      id={sectionAnchorId(sectionId ?? documentBookingSection?.id ?? '', 'booking')}
    >
      {summary ? (
        <div className="onboarding-booking-example" data-testid="canonical-booking-example">
          <span>Selected</span>
          <strong>{summary.service.name} + {summary.addOns.map((addOn) => addOn.name).join(' + ')}</strong>
          <small>{summary.durationLabel} · {summary.price.label}</small>
        </div>
      ) : null}
      {bookingFacts.map(fact => (
        <section
          aria-label={fact.label}
          className="onboarding-customer-booking-notice"
          data-content-key={fact.contentKey}
          data-content-owner={sectionId}
          key={fact.contentKey}
        >
          <span>{fact.label}</span>
          <strong>{fact.value}</strong>
        </section>
      ))}
      <BookingSectionRenderer
        fixture={fixture}
        headingLevel="h2"
        mode="preview"
        onSessionChange={updateSession}
        overlayHost={overlayHost}
        presentationSettings={placementAwareBookingSettings}
        previewViewport={device === 'phone' ? 'mobile' : device}
        session={effectiveSession}
        summaryHost={overlayHost}
        tokenPreset="warm"
      />
      {policyEntries.length > 0 ? (
        <details className="onboarding-quick-book-policies">
          <summary>Before you book</summary>
          <dl>
            {policyEntries.map(entry => (
              <div
                data-content-key={entry.contentKey}
                data-content-owner={sectionId}
                key={entry.id}
              >
                <dt>{entry.heading}</dt>
                <dd>{entry.wording}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
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
  bookingSession?: BookingSessionState;
  customerPagePlan?: SitePlanPage[];
  device?: OnboardingPreviewDevice;
  document: SiteBuilderDocument | null;
  fitAvailable?: boolean;
  includeOptionalSections?: boolean;
  initialPageId?: string;
  initialTarget?: OnboardingPreviewInitialTarget;
  interactionMode?: OnboardingPreviewInteractionMode;
  label?: string;
  onActivePageChange?: (pageId: string) => void;
  onBookingSessionChange?: BookingSessionUpdater;
  overlayMode?: OnboardingPreviewOverlayMode;
  preserveDocumentPresentation?: boolean;
  state: OnboardingLabState;
};

export function OnboardingSitePreview({
  bookingSession,
  customerPagePlan,
  device = 'phone',
  document,
  fitAvailable = false,
  includeOptionalSections = true,
  initialPageId,
  initialTarget = 'top',
  interactionMode = 'inline',
  label = 'Customer website preview',
  onActivePageChange,
  onBookingSessionChange,
  overlayMode = 'contained',
  preserveDocumentPresentation = false,
  state,
}: OnboardingSitePreviewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const measurementHostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const pendingDocumentTargetRef = useRef<CustomDesignDocumentNavigationTarget | null>(null);
  const pendingPageNavigationFocusRef = useRef(false);
  const summaryId = useId();
  const viewport = ONBOARDING_PREVIEW_VIEWPORTS[device];
  const [activePageId, setActivePageId] = useState<string | null>(initialPageId ?? null);
  const [heroActionVisible, setHeroActionVisible] = useState(true);
  const [overlayHost, setOverlayHost] = useState<HTMLDivElement | null>(null);
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
    let baseDocument = document;
    if (!baseDocument) {
      let counter = 0;
      baseDocument = initializeStarter(starter, {
        idFactory: kind => `onboarding-preview-${starter}-${kind}-${counter++}`,
      });
    }
    return preserveDocumentPresentation
      ? baseDocument
      : applyOnboardingSitePresentation(baseDocument, {
        aboutPreset: recipe.aboutPreset,
        galleryLayout: state.gallery.layout,
      });
  }, [
    document,
    preserveDocumentPresentation,
    recipe.aboutPreset,
    starter,
    state.gallery.layout,
  ]);
  const customDesignAssetIds = useMemo(() => [
    ...effectiveDocument.pages.flatMap(page => page.sections.flatMap(section => (
      section.sectionType === 'custom_design'
        ? section.settings.images.map(image => image.assetId)
        : []
    ))),
    ...(customerPagePlan?.flatMap(page => page.sections.flatMap(planSection => (
      planSection.section.sectionType === 'custom_design'
        ? planSection.section.settings.images.map(image => image.assetId)
        : []
    ))) ?? []),
  ], [customerPagePlan, effectiveDocument]);
  const customDesignAssets = useCustomDesignAssetMap(customDesignAssetIds);
  const customDesignIsRenderable = useCallback((settings: CustomDesignSettings) => (
    hasRenderableCustomDesignContent(settings, assetId => {
      const status = customDesignAssets.get(assetId)?.original.status;
      return status === 'loading' || status === 'ready';
    })
  ), [customDesignAssets]);
  const libraryContext = useMemo(
    () => deriveSiteLibraryContext(state, effectiveDocument),
    [effectiveDocument, state],
  );
  const derivedComposition = useMemo(
    () => buildCustomerSiteComposition(effectiveDocument, {
      context: libraryContext,
      customDesignIsRenderable,
      includeOptionalSections,
      toggles: deriveSitePlanToggles(state),
    }),
    [
      customDesignIsRenderable,
      effectiveDocument,
      includeOptionalSections,
      libraryContext,
      state,
    ],
  );
  // Account-backed Preview passes the exact persisted customer page plan.
  // Final Review derives the same shape from the in-progress Builder document.
  const pagePlan = useMemo(() => customerPagePlan
    ? filterCustomerPagePlanSections(customerPagePlan, planSection => (
        planSection.section.sectionType !== 'custom_design'
        || customDesignIsRenderable(planSection.section.settings)
      ))
    : derivedComposition.pages, [customerPagePlan, customDesignIsRenderable, derivedComposition.pages]);
  // External saved/account previews can provide their already-filtered page
  // plan, but ownership still comes from the same full document composition so
  // suppressed sections continue to influence deterministic fallbacks.
  const contentPlacement = derivedComposition.contentPlacement;
  const presentTypes = useMemo(() => new Set(
    pagePlan.flatMap(page => page.sections.map(section => section.sectionType)),
  ), [pagePlan]);
  const activePage = pagePlan.find(page => page.id === activePageId) ?? pagePlan[0] ?? null;
  const navigationItems = useMemo(() => {
    if (!effectiveDocument.navigation.enabled) return [];
    const pagesById = new Map(effectiveDocument.pages.map((page) => [page.id, page]));
    const visiblePageIds = new Set(pagePlan.map((page) => page.id));
    return [...effectiveDocument.navigation.items]
      .sort((left, right) => left.order - right.order)
      .filter((item) => (
        pagesById.get(item.pageId)?.visibleInNavigation
        && visiblePageIds.has(item.pageId)
      ))
      .map((item) => ({ label: item.label, pageId: item.pageId }));
  }, [effectiveDocument, pagePlan]);
  const onePageNavigationItems = useMemo(() => starter === 'one_page'
    ? (pagePlan[0]?.sections.flatMap(section => {
        const label = V1_SECTION_NAVIGATION_LABELS[section.sectionType];
        return label ? [{ label, section }] : [];
      }) ?? [])
    : [], [pagePlan, starter]);
  const bookingPage = pagePlan.find(page => page.sections.some(section => (
    section.sectionType === 'booking'
  ))) ?? null;
  const revealCurrentDocumentTarget = useCallback((target: CustomDesignDocumentNavigationTarget) => {
    const frame = frameRef.current;
    const preview = previewRef.current;
    if (!frame || !preview) return;
    const targetElement = target.sectionId
      ? [...preview.querySelectorAll<HTMLElement>('[data-section-id]')]
        .find((element) => element.dataset.sectionId === target.sectionId)
      : [...preview.querySelectorAll<HTMLElement>('[data-preview-page-id]')]
        .find((element) => element.dataset.previewPageId === target.pageId);
    if (!targetElement) return;
    const headerHeight = preview.querySelector<HTMLElement>('.onboarding-customer-header')
      ?.getBoundingClientRect().height ?? 0;
    const frameTop = frame.getBoundingClientRect().top;
    const targetTop = targetElement.getBoundingClientRect().top;
    const top = Math.max(0, frame.scrollTop + targetTop - frameTop - headerHeight - 8);
    if (typeof frame.scrollTo === 'function') {
      frame.scrollTo({ behavior: 'smooth', top });
    } else {
      // jsdom and a small number of embedded browsers do not expose
      // Element.scrollTo. Preserve the same frame-scoped navigation without
      // falling back to document scrolling.
      frame.scrollTop = top;
    }
    const focusTarget = targetElement.querySelector<HTMLElement>('h1, h2') ?? targetElement;
    if (!focusTarget.hasAttribute('tabindex')) focusTarget.tabIndex = -1;
    focusTarget.focus({ preventScroll: true });
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
      : pagePlan.find(page => page.id === initialPageId) ?? pagePlan[0];
    setActivePageId((current) => (
      initialTarget === 'about'
      || (initialPageId !== undefined && targetPage?.id !== current)
      || !pagePlan.some(page => page.id === current)
        ? targetPage?.id ?? null
        : current
    ));
  }, [initialPageId, initialTarget, pagePlan]);

  useEffect(() => {
    if (activePage) onActivePageChange?.(activePage.id);
  }, [activePage, onActivePageChange]);

  useLayoutEffect(() => {
    const pendingTarget = pendingDocumentTargetRef.current;
    if (!pendingTarget || pendingTarget.pageId !== activePage?.id) return;
    pendingDocumentTargetRef.current = null;
    revealCurrentDocumentTarget(pendingTarget);
  }, [activePage?.id, revealCurrentDocumentTarget]);

  useLayoutEffect(() => {
    if (!pendingPageNavigationFocusRef.current || !activePage) return;
    pendingPageNavigationFocusRef.current = false;
    [...(frameRef.current?.querySelectorAll<HTMLElement>('[data-preview-page-id]') ?? [])]
      .find((page) => page.dataset.previewPageId === activePage.id)
      ?.querySelector<HTMLElement>('[data-preview-page-heading="true"]')
      ?.focus({ preventScroll: true });
  }, [activePage]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const heroAction = previewRef.current?.querySelector<HTMLElement>(
      '[data-hero-book-action="true"]',
    );
    if (!frame || !heroAction) {
      setHeroActionVisible(false);
      return undefined;
    }
    if (typeof IntersectionObserver === 'undefined') {
      setHeroActionVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setHeroActionVisible(Boolean(entry?.isIntersecting));
    }, {
      root: frame,
      threshold: 0.01,
    });
    observer.observe(heroAction);
    return () => observer.disconnect();
  }, [activePage?.id, device, pagePlan, starter]);

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
  const overlayHostElement = (
    <div
      aria-hidden={interactionMode === 'inline' ? 'true' : undefined}
      className={`onboarding-preview-overlay-host${overlayMode === 'page' ? ' is-page-viewport' : ''}`}
      data-preview-viewport={device === 'phone' ? 'mobile' : device}
      ref={setOverlayHost}
      style={stageStyle}
    />
  );
  let renderedOverlayHost: ReactNode = overlayHostElement;
  if (overlayMode === 'page' && typeof window !== 'undefined') {
    renderedOverlayHost = createPortal(overlayHostElement, window.document.body);
  }
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
          id={sectionAnchorId(planSection.id, 'hero')}
          key={planSection.id}
        >
          <div>
            {heroSettings?.showLocationEyebrow !== false ? (
              <p className="onboarding-customer-eyebrow">Independent nail care</p>
            ) : null}
            <h1 data-preview-page-heading="true" tabIndex={-1}>{headline}</h1>
            <p>{intro}</p>
            <a
              className="onboarding-customer-primary"
              data-hero-book-action="true"
              href="#booking"
              onClick={navigateToBooking}
            >
              {heroSettings?.primaryCtaLabel.trim() || 'Book an appointment'}
            </a>
          </div>
          {heroSettings && heroSettings.preset !== 'booking_first' ? (
            <HeroDecoration title={title} />
          ) : null}
        </section>
      );
    }
    if (planSection.sectionType === 'about') {
      // Live onboarding lets the About design screen drive the preset; the
      // saved plan renders the preset the compiler stamped into the section.
      const aboutPreset = (customerPagePlan || preserveDocumentPresentation)
        && instance.sectionType === 'about'
        ? instance.settings.preset
        : recipe.aboutPreset;
      const aboutIntroOverride = instance.sectionType === 'about'
        && instance.settings.intro.source === 'override'
        ? instance.settings.intro.value
        : undefined;
      return (
        <AboutSection
          contentPlacement={contentPlacement}
          key={planSection.id}
          hoursStatus={hoursStatus}
          introOverride={aboutIntroOverride}
          pageId={page.id}
          preset={aboutPreset}
          profile={profile}
          sectionId={planSection.id}
        />
      );
    }
    if (planSection.sectionType === 'gallery') {
      return (
        <GallerySection
          compact={starter === 'quick_book'}
          key={planSection.id}
          preset={instance.sectionType === 'gallery' ? instance.settings.preset : undefined}
          sectionId={planSection.id}
          selection={instance.sectionType === 'gallery' ? instance.settings.selection : undefined}
          state={state}
        />
      );
    }
    if (planSection.sectionType === 'booking') {
      return (
        <BookingSection
          compactPolicies={starter === 'quick_book' && state.recipe.policiesEnabled}
          contentPlacement={contentPlacement}
          key={planSection.id}
          device={device}
          document={document}
          onSessionChange={onBookingSessionChange}
          overlayHost={overlayHost}
          pageId={page.id}
          profile={profile}
          sectionId={planSection.id}
          session={bookingSession}
        />
      );
    }
    if (planSection.sectionType === 'contact') {
      return (
        <ContactSection
          contentPlacement={contentPlacement}
          key={planSection.id}
          pageId={page.id}
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
      contentPlacement,
      context: libraryContext,
      onBook: navigateToBooking,
      pageSections: page.sections,
      pageId: page.id,
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
        <header className={`onboarding-customer-header${starter === 'multi_page' ? ' has-page-navigation' : ''}${starter === 'one_page' ? ' has-anchor-navigation' : ''}`}>
          <Brand profile={profile} />
          <nav
            aria-label="Customer preview navigation"
            className={starter === 'multi_page'
              ? 'is-page-navigation'
              : starter === 'one_page'
                ? 'is-anchor-navigation'
                : undefined}
          >
              {starter === 'multi_page' ? navigationItems.map((item) => (
                <a
                  aria-current={activePage?.id === item.pageId ? 'page' : undefined}
                  href={`#preview-page-${item.pageId}`}
                  key={item.pageId}
                  onClick={(event) => {
                    event.preventDefault();
                    pendingDocumentTargetRef.current = null;
                    pendingPageNavigationFocusRef.current = true;
                    setActivePageId(item.pageId);
                    if (frameRef.current) frameRef.current.scrollTop = 0;
                  }}
                >
                  {item.label}
                </a>
              )) : null}
              {starter === 'one_page' ? onePageNavigationItems.map(({ label: itemLabel, section }) => (
                <a
                  href={`#${sectionAnchorId(section.id, section.sectionType)}`}
                  key={section.id}
                  onClick={(event) => {
                    event.preventDefault();
                    revealCurrentDocumentTarget({
                      kind: section.sectionType === 'booking' ? 'booking' : 'internal',
                      pageId: activePage?.id ?? pagePlan[0]?.id ?? '',
                      relationship: 'same_page',
                      sectionId: section.id,
                    });
                  }}
                >
                  {itemLabel}
                </a>
              )) : null}
              {bookingPage ? (
                <a
                  aria-hidden={device === 'phone' && heroActionVisible ? 'true' : undefined}
                  className={`customer-book-shortcut${device === 'phone' && heroActionVisible ? ' is-hidden' : ''}`}
                  href="#booking"
                  onClick={navigateToBooking}
                  tabIndex={device === 'phone' && heroActionVisible ? -1 : undefined}
                >
                  Book
                </a>
              ) : null}
          </nav>
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
              {starter === 'multi_page'
                && !page.sections.some(section => section.sectionType === 'hero') ? (
                  <h1
                    className="onboarding-customer-page-title"
                    data-preview-page-heading="true"
                    tabIndex={-1}
                  >
                    {page.label}
                  </h1>
                ) : null}
              {page.sections.map(section => renderPreviewSection(page, section))}
            </div>
          ))}
        </div>

        {presentTypes.has('footer') ? null : (
          <footer className="onboarding-customer-footer">
            <strong>{title}</strong>
            <small>Powered by Luster</small>
          </footer>
        )}
      </div>
      </div>
      {renderedOverlayHost}
    </section>
  );
}
