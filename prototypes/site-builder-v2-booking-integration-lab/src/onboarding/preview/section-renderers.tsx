/**
 * Customer renderers for the V1 section library types that are new in v2.
 *
 * The pre-library renderers (hero, about, gallery, booking, contact, and
 * custom design) stay in OnboardingSitePreview.tsx; the dispatch there falls
 * through to this map for the library-owned types, including the composite
 * Before You Book presentation. Each
 * renderer binds to its shared authority (profile, hours, policies, catalogue)
 * or `siteContent` records by id — never to copied business data — and shows
 * nothing it cannot show truthfully.
 */

import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useState } from 'react';

import {
  CalendarDays,
  Instagram,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
} from 'lucide-react';

import { CANONICAL_SERVICES } from '../../booking/data';
import { formatDuration, formatPrice } from '../../booking/helpers';
import { useCustomDesignAssetMap } from '../../custom-design/integration/CustomDesignAssetProvider';
import {
  sectionOwnsContent,
  type SiteContentKey,
  type SiteContentPlacementPlan,
} from '../../model/content-placement';
import { NAVIGABLE_SECTION_TYPES } from '../../model/section-library/registry';
import type { SiteLibraryContext } from '../../model/section-library/registry';
import {
  POLICY_TOGGLE_IDS,
  type BoundText,
  type PolicyToggleId,
} from '../../model/section-library/settings';
import type { SitePlanSection } from '../../model/site-plan';
import type {
  LibrarySectionInstance,
  LibrarySectionType,
} from '../../model/types';
import { resolveOnboardingImageUrl } from '../integrations/adapters/media';
import {
  getPublicContactActions,
  type PublicContactAction,
} from '../model/contact';
import {
  getPublicWeeklyHours,
  getWeeklyHoursPreviewStatus,
} from '../model/hours';
import {
  getPublicDirectionsAction,
  getPublicLocationPreview,
} from '../model/location';
import {
  deriveDepositsAndCancellationsSummary,
  getDepositsAndCancellationsDisplayWording,
  getPolicyDisplayWording,
  isDepositsAndCancellationsComplete,
  isDepositsAndCancellationsVisible,
} from '../model/policies';
import type {
  OnboardingLabState,
  PoliciesDraft,
  PolicySectionId,
} from '../model/types';
import {
  labelForMinimumNotice,
  labelForNewClients,
  labelForVisitMode,
} from './customer-facts';
import { sectionAnchorId } from './section-anchors';

export type LibraryPreviewBookHandler = (
  event: ReactMouseEvent<HTMLAnchorElement>,
) => void;

/** Everything a library renderer may bind to, resolved once per preview. */
export type LibraryPreviewShared = {
  state: OnboardingLabState;
  context: SiteLibraryContext;
  onBook: LibraryPreviewBookHandler;
  contentPlacement: SiteContentPlacementPlan;
  pageId: string;
  /** Rendered plan sections on the page this section sits on (for anchors). */
  pageSections: readonly SitePlanSection[];
  /** Every section type rendering anywhere on the site (for auto summaries). */
  presentTypes: ReadonlySet<string>;
  title: string;
  area: string;
};

export type LibraryPreviewSectionProps = {
  planSection: SitePlanSection;
  section: LibrarySectionInstance;
  shared: LibraryPreviewShared;
};

type LibraryPreviewRenderer = (props: LibraryPreviewSectionProps) => ReactNode;

/** Mirrors the Contact section's per-method marks so the two agree. */
const ContactMark = ({ method }: { method: PublicContactAction['method'] }) => {
  if (method === 'booking') return <CalendarDays aria-hidden="true" size={15} />;
  if (method === 'instagram') return <Instagram aria-hidden="true" size={15} />;
  if (method === 'call') return <Phone aria-hidden="true" size={15} />;
  if (method === 'email') return <Mail aria-hidden="true" size={15} />;
  return <MessageCircle aria-hidden="true" size={15} />;
};

const resolveBound = (bound: BoundText, sharedValue: string): string =>
  bound.source === 'override' && bound.value.trim()
    ? bound.value
    : sharedValue;

const sectionAttributes = (
  planSection: SitePlanSection,
  type: LibrarySectionType,
) => ({
  'data-attached': planSection.attachedToPrevious ? 'true' : undefined,
  'data-library-type': type,
  'data-section-id': planSection.id,
  'data-surface': planSection.surface,
});

const contentAttributes = (
  shared: LibraryPreviewShared,
  key: SiteContentKey,
  sectionId: string,
) => sectionOwnsContent(shared.contentPlacement, key, sectionId, shared.pageId)
  ? {
      'data-content-key': key,
      'data-content-owner': sectionId,
    }
  : {};

const settingsOf = <T extends LibrarySectionType>(
  section: LibrarySectionInstance,
  type: T,
): LibrarySectionInstance<T>['settings'] | null =>
  section.sectionType === type
    ? (section as LibrarySectionInstance<T>).settings
    : null;

function AnnouncementBar({ planSection, section, shared }: LibraryPreviewSectionProps) {
  const settings = settingsOf(section, 'announcement_bar');
  const [dismissed, setDismissed] = useState(false);
  if (!settings || dismissed) return null;
  const message = settings.message.trim();
  if (!message) return null;
  const action = settings.action;
  return (
    <aside
      {...sectionAttributes(planSection, 'announcement_bar')}
      aria-label="Announcement"
      className={`customer-lib-announcement is-${settings.tone}`}
    >
      <p className="customer-lib-announcement-message">{message}</p>
      {action?.kind === 'booking' ? (
        <a className="customer-lib-announcement-action" href="#booking" onClick={shared.onBook}>
          {action.label}
        </a>
      ) : null}
      {action?.kind === 'url' && action.url.trim() ? (
        <a
          className="customer-lib-announcement-action"
          href={action.url}
          rel="noopener noreferrer"
          target="_blank"
        >
          {action.label}
        </a>
      ) : null}
      {settings.reassurance.trim() ? (
        <span className="customer-lib-announcement-note">{settings.reassurance}</span>
      ) : null}
      {settings.dismissible ? (
        <button
          aria-label="Dismiss announcement"
          className="customer-lib-announcement-dismiss"
          onClick={() => setDismissed(true)}
          type="button"
        >
          ×
        </button>
      ) : null}
    </aside>
  );
}

function QuickInfo({ planSection, section, shared }: LibraryPreviewSectionProps) {
  const settings = settingsOf(section, 'quick_info');
  if (!settings) return null;
  const { profile } = shared.state;
  const hoursStatus = getWeeklyHoursPreviewStatus(
    profile.hours,
    shared.state.reviewOptions.previewTimestamp,
    profile.timeZone,
  );
  const factValues: Record<string, { contentKey: SiteContentKey; value: string | null }> = {
    location: {
      contentKey: 'location',
      value: getPublicLocationPreview(profile.location).primary.trim() || null,
    },
    minimum_notice: {
      contentKey: 'minimum_notice',
      value: labelForMinimumNotice(profile),
    },
    new_clients: {
      contentKey: 'new_client_status',
      value: labelForNewClients(profile),
    },
    open_status: {
      contentKey: 'business_hours',
      value: hoursStatus?.label ?? null,
    },
    visit_mode: {
      contentKey: 'appointment_mode',
      value: labelForVisitMode(profile),
    },
  };
  const facts = settings.facts
    .flatMap((factId) => {
      const fact = factValues[factId];
      return fact?.value
        ? [{ contentKey: fact.contentKey, factId, value: fact.value }]
        : [];
    })
    .filter(fact => sectionOwnsContent(
      shared.contentPlacement,
      fact.contentKey,
      planSection.id,
      shared.pageId,
    ))
    .slice(0, 4);
  if (facts.length === 0) return null;
  return (
    <section
      {...sectionAttributes(planSection, 'quick_info')}
      aria-label="Quick info"
      className="customer-lib-quick-info"
    >
      <ul>
        {facts.map(fact => (
          <li
            {...contentAttributes(shared, fact.contentKey, planSection.id)}
            data-fact={fact.factId}
            key={fact.factId}
          >
            {fact.factId === 'location'
              && profile.location.addressVisibility === 'public'
              && profile.location.exactAddress.trim() === fact.value ? (
                <span {...contentAttributes(shared, 'exact_address', planSection.id)}>
                  {fact.value}
                </span>
              ) : fact.value}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionNavigation({ planSection, section, shared }: LibraryPreviewSectionProps) {
  const settings = settingsOf(section, 'section_navigation');
  if (!settings) return null;
  const targets = shared.pageSections
    .filter(candidate => NAVIGABLE_SECTION_TYPES.has(candidate.sectionType))
    .map(candidate => ({
      id: candidate.id,
      label: settings.labelOverrides[candidate.id]?.trim() || candidate.label,
      sectionType: candidate.sectionType,
    }));
  if (targets.length < 2) return null;
  return (
    <nav
      {...sectionAttributes(planSection, 'section_navigation')}
      aria-label="On this page"
      className={`customer-lib-section-nav${settings.sticky ? ' is-sticky' : ''}`}
    >
      {targets.map(target => (
        <a
          href={`#${sectionAnchorId(target.id, target.sectionType)}`}
          key={target.id}
          onClick={target.sectionType === 'booking' ? shared.onBook : undefined}
        >
          {target.label}
        </a>
      ))}
    </nav>
  );
}

function FeaturedServices({ planSection, section, shared }: LibraryPreviewSectionProps) {
  const settings = settingsOf(section, 'featured_services');
  if (!settings) return null;
  const selectedIds = new Set(shared.context.canonicalServiceIds);
  const ids = settings.source === 'featured'
    ? shared.context.featuredServiceIds
    : settings.serviceIds.filter(id => selectedIds.has(id));
  const services = ids
    .map(id => CANONICAL_SERVICES.find(service => service.id === id))
    .filter((service): service is (typeof CANONICAL_SERVICES)[number] => Boolean(service))
    .slice(0, 6);
  if (services.length === 0) return null;
  return (
    <section
      {...sectionAttributes(planSection, 'featured_services')}
      {...contentAttributes(shared, 'service_marketing', planSection.id)}
      aria-label="Featured services"
      className={`customer-lib-featured is-${settings.preset}`}
      id={sectionAnchorId(planSection.id, 'featured_services')}
    >
      <p className="onboarding-customer-eyebrow">Services</p>
      <h2>{settings.preset === 'editorial' ? 'Signature services' : 'Popular services'}</h2>
      <div className="customer-lib-featured-items">
        {services.map(service => (
          <article className="customer-lib-featured-card" key={service.id}>
            {settings.preset !== 'editorial' && service.image ? (
              <img
                alt={service.image.alt}
                data-media-id={service.id}
                data-media-role="service"
                loading="lazy"
                src={service.image.src}
              />
            ) : null}
            <div className="customer-lib-featured-body">
              {service.badge ? <span className="customer-lib-badge">{service.badge}</span> : null}
              <h3>{service.name}</h3>
              <p>{service.shortDescription}</p>
              <p className="customer-lib-featured-meta">
                <span>{formatPrice(service.price)}</span>
                <span aria-hidden="true">·</span>
                <span>{formatDuration(service.durationMinutes)}</span>
              </p>
              <a className="customer-lib-text-cta" href="#booking" onClick={shared.onBook}>
                Book this
              </a>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Offers({ planSection, section, shared }: LibraryPreviewSectionProps) {
  const settings = settingsOf(section, 'offers');
  if (!settings) return null;
  const byId = new Map(shared.context.siteContent.offers.map(offer => [offer.id, offer]));
  const offers = settings.offerIds
    .map(id => byId.get(id))
    .filter((offer): offer is NonNullable<typeof offer> => Boolean(offer));
  if (offers.length === 0) return null;
  const now = Date.parse(shared.state.reviewOptions.previewTimestamp);
  return (
    <section
      {...sectionAttributes(planSection, 'offers')}
      aria-label="Offers"
      className={`customer-lib-offers is-${settings.preset}`}
      id={sectionAnchorId(planSection.id, 'offers')}
    >
      <p className="onboarding-customer-eyebrow">Offers</p>
      <h2>Current offers</h2>
      <div className="customer-lib-offers-items">
        {offers.map((offer) => {
          const expires = offer.expiresAt ? Date.parse(offer.expiresAt) : Number.NaN;
          const expiryLabel = Number.isFinite(expires) && Number.isFinite(now) && expires > now
            ? new Date(expires).toLocaleDateString('en-CA', { day: 'numeric', month: 'long' })
            : null;
          return (
            <article className="customer-lib-offer-card" key={offer.id}>
              <h3>{offer.title}</h3>
              {offer.detail.trim() ? <p>{offer.detail}</p> : null}
              <p className="customer-lib-offer-meta">
                {offer.terms.trim() ? <span>{offer.terms}</span> : null}
                {expiryLabel ? <span>Ends {expiryLabel}</span> : null}
              </p>
              <a className="customer-lib-text-cta" href="#booking" onClick={shared.onBook}>
                {offer.actionLabel?.trim() || 'Book now'}
              </a>
            </article>
          );
        })}
      </div>
    </section>
  );
}

const initialsOf = (name: string): string =>
  name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');

function Team({ planSection, section, shared }: LibraryPreviewSectionProps) {
  const settings = settingsOf(section, 'team');
  if (!settings) return null;
  const profileAssetIds = shared.state.profile.profilePhoto?.storageId
    ? [shared.state.profile.profilePhoto.storageId]
    : [];
  const profileAssets = useCustomDesignAssetMap(profileAssetIds);
  const profileSource = resolveOnboardingImageUrl(
    shared.state.profile.profilePhoto,
    profileAssets,
  );
  const ownsOwnerProfile = sectionOwnsContent(
    shared.contentPlacement,
    'owner_profile_photo',
    planSection.id,
    shared.pageId,
  );
  const byId = new Map(shared.context.siteContent.staff.map(member => [member.id, member]));
  const members = settings.memberIds
    .map(id => byId.get(id))
    .filter((member): member is NonNullable<typeof member> => Boolean(member));
  if (members.length === 0) return null;
  return (
    <section
      {...sectionAttributes(planSection, 'team')}
      {...contentAttributes(shared, 'team_profiles', planSection.id)}
      aria-label="Team"
      className={`customer-lib-team is-${settings.preset}`}
      id={sectionAnchorId(planSection.id, 'team')}
    >
      <p className="onboarding-customer-eyebrow">The team</p>
      <h2>Who you’ll see</h2>
      <div className="customer-lib-team-items">
        {members.map(member => (
          <article className="customer-lib-team-card" key={member.id}>
            {ownsOwnerProfile
              && member.id === shared.context.ownerStaffMemberId
              && profileSource
              ? (
                  // The lab renders local/object URLs that Next Image cannot own.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={`${member.name} profile photo`}
                    className="customer-lib-avatar is-image"
                    data-content-key="owner_profile_photo"
                    data-content-owner={planSection.id}
                    data-media-id={shared.state.profile.profilePhoto?.storageId
                      ?? shared.state.profile.profilePhoto?.id}
                    data-media-role="profile"
                    src={profileSource}
                  />
                )
              : (
                  <span aria-hidden="true" className="customer-lib-avatar">
                    {initialsOf(member.name)}
                  </span>
                )}
            <h3>{member.name}</h3>
            {member.title.trim() ? <p className="customer-lib-team-title">{member.title}</p> : null}
            {member.specialties.length > 0 ? (
              <p className="customer-lib-team-specialties">{member.specialties.join(' · ')}</p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function Reviews({ planSection, section, shared }: LibraryPreviewSectionProps) {
  const settings = settingsOf(section, 'reviews');
  if (!settings) return null;
  const byId = new Map(shared.context.siteContent.reviews.map(review => [review.id, review]));
  const reviews = settings.reviewIds
    .map(id => byId.get(id))
    .filter((review): review is NonNullable<typeof review> => Boolean(review?.visible))
    .slice(0, 3);
  if (reviews.length === 0) return null;
  return (
    <section
      {...sectionAttributes(planSection, 'reviews')}
      {...contentAttributes(shared, 'reviews', planSection.id)}
      aria-label="Reviews"
      className={`customer-lib-reviews is-${settings.preset}`}
      id={sectionAnchorId(planSection.id, 'reviews')}
    >
      <p className="onboarding-customer-eyebrow">Kind words</p>
      <h2>What clients say</h2>
      <div className="customer-lib-reviews-items">
        {reviews.map(review => (
          <blockquote className="customer-lib-review-card" key={review.id}>
            {settings.showRatings && review.rating !== null ? (
              <span
                aria-label={`Rated ${review.rating} out of 5`}
                className="customer-lib-review-stars"
                role="img"
              >
                {'★★★★★'.slice(0, Math.max(1, Math.min(5, Math.round(review.rating))))}
              </span>
            ) : null}
            <p>“{review.quote}”</p>
            <footer>
              <cite>{review.authorName}</cite>
              {review.source === 'google' ? <span> · Google review</span> : null}
            </footer>
          </blockquote>
        ))}
      </div>
    </section>
  );
}

function DepositsCancellations({ planSection, section, shared }: LibraryPreviewSectionProps) {
  const settings = settingsOf(section, 'deposits_cancellations');
  if (!settings) return null;
  const { policies } = shared.state.profile;
  // The one-line summary exists only once the deposit/cancellation rules are
  // complete; before that its helper returns owner-facing prompt copy, which
  // must never reach a customer. Fall back to the full owner-authored wording.
  // The summary is also derived straight from the answers, so it has to be
  // gated on the same visibility flags the long wording honours — otherwise
  // an owner who hid this copy still sees it published.
  const wording = settings.wordingMode === 'summary'
    && isDepositsAndCancellationsVisible(policies)
    && isDepositsAndCancellationsComplete(policies)
    ? deriveDepositsAndCancellationsSummary(policies)
    : getDepositsAndCancellationsDisplayWording(policies);
  if (!wording.trim()) return null;
  return (
    <section
      {...sectionAttributes(planSection, 'deposits_cancellations')}
      {...contentAttributes(shared, 'deposit_cancellation_policy', planSection.id)}
      aria-label="Deposits and cancellations"
      className="customer-lib-deposits"
      id={sectionAnchorId(planSection.id, 'deposits_cancellations')}
    >
      <p className="onboarding-customer-eyebrow">Before you book</p>
      <h2>Deposits &amp; cancellations</h2>
      <p className="customer-lib-policy-body">{wording}</p>
    </section>
  );
}

const POLICY_TOGGLE_TO_SECTION: Record<PolicyToggleId, PolicySectionId> = {
  late_arrivals: 'late_arrivals',
  no_shows: 'no_shows',
  other: 'other',
  repairs: 'repairs',
};

const POLICY_HEADINGS: Record<PolicyToggleId, string> = {
  late_arrivals: 'Late arrivals',
  no_shows: 'No-shows',
  other: 'Good to know',
  repairs: 'Repairs',
};

export type BeforeYouBookEntry = Readonly<{
  contentKey: 'before_you_book_policies' | 'deposit_cancellation_policy';
  heading: string;
  id: 'deposits_cancellations' | PolicyToggleId;
  wording: string;
}>;

/**
 * Resolves the one customer-facing Before You Book summary from the existing
 * shared policy authority. Quick Book can reuse this exact entry list inside
 * Booking; the standalone one-page/multi-page section renders the same list.
 */
export const getBeforeYouBookEntries = (
  policies: PoliciesDraft,
  includedSections: readonly PolicyToggleId[] = POLICY_TOGGLE_IDS,
): BeforeYouBookEntry[] => {
  const depositsAndCancellations = isDepositsAndCancellationsVisible(policies)
    ? (
        isDepositsAndCancellationsComplete(policies)
          ? deriveDepositsAndCancellationsSummary(policies)
          : getDepositsAndCancellationsDisplayWording(policies)
      ).trim()
    : '';
  const entries: BeforeYouBookEntry[] = depositsAndCancellations
    ? [{
        contentKey: 'deposit_cancellation_policy',
        heading: 'Deposits & cancellations',
        id: 'deposits_cancellations',
        wording: depositsAndCancellations,
      }]
    : [];

  includedSections.forEach((toggleId) => {
    const sectionId = POLICY_TOGGLE_TO_SECTION[toggleId];
    const wording = getPolicyDisplayWording(policies, sectionId).trim();
    if (!wording) return;
    entries.push({
      contentKey: 'before_you_book_policies',
      heading: POLICY_HEADINGS[toggleId],
      id: toggleId,
      wording,
    });
  });

  return entries;
};

function Policies({ planSection, section, shared }: LibraryPreviewSectionProps) {
  const settings = settingsOf(section, 'policies');
  if (!settings) return null;
  const { policies } = shared.state.profile;
  const entries = getBeforeYouBookEntries(policies, settings.includedSections)
    .filter(entry => sectionOwnsContent(
      shared.contentPlacement,
      entry.contentKey,
      planSection.id,
      shared.pageId,
    ));
  if (entries.length === 0) return null;
  const firstGeneralPolicyIndex = entries.findIndex(
    entry => entry.contentKey === 'before_you_book_policies',
  );
  return (
    <section
      {...sectionAttributes(planSection, 'policies')}
      aria-label="Before you book"
      className="customer-lib-policies"
      id={sectionAnchorId(planSection.id, 'policies')}
    >
      <p className="onboarding-customer-eyebrow">Appointment details</p>
      <h2>Before you book</h2>
      <dl>
        {entries.map((entry, index) => (
          <div
            {...(entry.contentKey === 'deposit_cancellation_policy'
              || index === firstGeneralPolicyIndex
              ? contentAttributes(shared, entry.contentKey, planSection.id)
              : {})}
            data-policy={entry.id}
            key={entry.id}
          >
            <dt>{entry.heading}</dt>
            <dd>{entry.wording}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Faq({ planSection, section, shared }: LibraryPreviewSectionProps) {
  const settings = settingsOf(section, 'faq');
  if (!settings) return null;
  const byId = new Map(shared.context.siteContent.faq.map(item => [item.id, item]));
  const items = settings.itemIds
    .map(id => byId.get(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (items.length === 0) return null;
  return (
    <section
      {...sectionAttributes(planSection, 'faq')}
      aria-label="Frequently asked questions"
      className="customer-lib-faq"
      id={sectionAnchorId(planSection.id, 'faq')}
    >
      <p className="onboarding-customer-eyebrow">Questions</p>
      <h2>Good to know</h2>
      <div className="customer-lib-faq-items">
        {items.map(item => (
          <details key={item.id}>
            <summary>{item.question}</summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Hours({ planSection, section, shared }: LibraryPreviewSectionProps) {
  const settings = settingsOf(section, 'hours');
  if (!settings) return null;
  const { profile } = shared.state;
  const rows = getPublicWeeklyHours(profile.hours);
  if (rows.length === 0) return null;
  const status = getWeeklyHoursPreviewStatus(
    profile.hours,
    shared.state.reviewOptions.previewTimestamp,
    profile.timeZone,
  );
  const openRows = rows.filter(row => row.hours !== 'Closed');
  const closedRows = rows.filter(row => row.hours === 'Closed');
  const compact = settings.layout === 'compact';
  return (
    <section
      {...sectionAttributes(planSection, 'hours')}
      {...contentAttributes(shared, 'business_hours', planSection.id)}
      aria-label="Hours"
      className={`customer-lib-hours is-${settings.layout}`}
      id={sectionAnchorId(planSection.id, 'hours')}
    >
      <p className="onboarding-customer-eyebrow">Hours</p>
      <h2>When we’re open</h2>
      {status ? (
        <p className="customer-lib-hours-status" data-hours-status={status.kind}>
          {status.label}
        </p>
      ) : null}
      <dl className="customer-lib-hours-rows">
        {(compact ? openRows : rows).map(row => (
          <div key={row.weekday}>
            <dt>{compact ? row.label.slice(0, 3) : row.label}</dt>
            <dd data-closed={row.hours === 'Closed' ? 'true' : undefined}>{row.hours}</dd>
          </div>
        ))}
      </dl>
      {compact && closedRows.length > 0 ? (
        <p className="customer-lib-hours-closed">
          Closed {closedRows.map(row => row.label).join(' and ')}.
        </p>
      ) : null}
    </section>
  );
}

function VisitUs({ planSection, section, shared }: LibraryPreviewSectionProps) {
  const settings = settingsOf(section, 'visit_us');
  if (!settings) return null;
  const { profile } = shared.state;
  const location = getPublicLocationPreview(profile.location);
  const directions = getPublicDirectionsAction(profile.location);
  const ownsLocation = sectionOwnsContent(
    shared.contentPlacement,
    'location',
    planSection.id,
  );
  const ownsHours = sectionOwnsContent(
    shared.contentPlacement,
    'business_hours',
    planSection.id,
  ) && settings.hoursSummary !== 'hide';
  const ownsArrivalDetails = sectionOwnsContent(
    shared.contentPlacement,
    'arrival_details',
    planSection.id,
    shared.pageId,
  );
  const hoursRows = ownsHours ? getPublicWeeklyHours(profile.hours) : [];
  const contentKeyForMethod = (method: PublicContactAction['method']): SiteContentKey | null => {
    if (method === 'instagram') return 'instagram';
    if (method === 'call') return 'phone';
    if (method === 'text') return 'text';
    if (method === 'email') return 'email';
    return null;
  };
  const contactActions = settings.contactSummary === 'hide'
    ? []
    : getPublicContactActions(profile)
    .flatMap((action) => {
      const contentKey = contentKeyForMethod(action.method);
      return contentKey && sectionOwnsContent(
        shared.contentPlacement,
        contentKey,
        planSection.id,
      )
        ? [{ action, contentKey }]
        : [];
    });
  const practicalNotes = ownsArrivalDetails
    && profile.location.addressVisibility === 'public' ? [
    settings.showParking ? profile.location.parking.trim() : '',
    settings.showEntrance ? profile.location.entranceInstructions.trim() : '',
    settings.showTransit ? profile.location.transitInformation.trim() : '',
  ].filter(Boolean) : [];
  const showBookingOnlyContact = settings.contactSummary !== 'hide'
    && profile.bookingOnlyContact;
  const quickBookMapLocation = shared.state.recipe.starter === 'quick_book'
    && ownsLocation
    ? location.primary.trim()
    : '';
  const quickBookMapSrc = quickBookMapLocation
    ? `https://www.google.com/maps?q=${encodeURIComponent(quickBookMapLocation)}&output=embed`
    : null;
  if ((!ownsLocation || !location.primary.trim())
    && practicalNotes.length === 0
    && hoursRows.length === 0
    && contactActions.length === 0
    && !showBookingOnlyContact) return null;
  return (
    <section
      {...sectionAttributes(planSection, 'visit_us')}
      aria-label="Visit and contact"
      className={`customer-lib-visit is-${settings.preset}`}
      id={sectionAnchorId(planSection.id, 'visit_us')}
    >
      <p className="onboarding-customer-eyebrow">Visit &amp; contact</p>
      <h2>Plan your visit</h2>
      <div className="customer-lib-visit-body">
        <div className="customer-lib-visit-place">
          {(ownsLocation && location.primary.trim()) || practicalNotes.length > 0 ? (
            <h3>Visit</h3>
          ) : null}
          {ownsLocation && location.primary.trim() ? (
            <p
              {...contentAttributes(shared, 'location', planSection.id)}
              className="customer-lib-visit-primary"
            >
              {profile.location.addressVisibility === 'public'
                && profile.location.exactAddress.trim() === location.primary ? (
                  <span {...contentAttributes(shared, 'exact_address', planSection.id)}>
                    {location.primary}
                  </span>
                ) : location.primary}
            </p>
          ) : null}
          {ownsLocation && location.detail ? <p className="customer-lib-visit-detail">{location.detail}</p> : null}
          {ownsLocation && directions ? (
            <a
              aria-label={directions.accessibleLabel}
              className="customer-lib-text-cta"
              href={directions.href}
              rel={directions.rel}
              target={directions.target}
            >
              <MapPin aria-hidden="true" size={15} /> Get directions
            </a>
          ) : null}
          {practicalNotes.length > 0 ? (
            <ul
              {...contentAttributes(shared, 'arrival_details', planSection.id)}
              className="customer-lib-visit-notes"
            >
              {practicalNotes.map(note => <li key={note}>{note}</li>)}
            </ul>
          ) : null}
        </div>
        {quickBookMapSrc ? (
          <div className="customer-lib-visit-map">
            <iframe
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              src={quickBookMapSrc}
              title={`Map showing ${quickBookMapLocation}`}
            />
          </div>
        ) : null}
        {hoursRows.length > 0 ? (
          <div
            {...contentAttributes(shared, 'business_hours', planSection.id)}
            className="customer-lib-visit-hours"
          >
            <h3>Hours</h3>
            <dl className="customer-lib-hours-rows is-summary">
              {hoursRows.filter(row => row.hours !== 'Closed').map(row => (
                <div key={row.weekday}>
                  <dt>{row.label.slice(0, 3)}</dt>
                  <dd>{row.hours}</dd>
                </div>
              ))}
            </dl>
            {/* Name the closed days rather than leaving a silent gap. */}
            {hoursRows.some(row => row.hours === 'Closed') ? (
              <p className="customer-lib-hours-closed">
                Closed
                {' '}
                {hoursRows
                  .filter(row => row.hours === 'Closed')
                  .map(row => row.label)
                  .join(' and ')}
                .
              </p>
            ) : null}
          </div>
        ) : null}
        {contactActions.length > 0 || showBookingOnlyContact ? (
          <div className="customer-lib-visit-contact-group">
            <h3>Contact</h3>
            {showBookingOnlyContact ? (
              <p
                {...contentAttributes(shared, 'booking_only_contact', planSection.id)}
                className="customer-lib-visit-detail"
              >
                Online booking is the best way to reach us.
              </p>
            ) : null}
            {contactActions.length > 0 ? (
              <p className="customer-lib-visit-contact">
                {contactActions.map(({ action, contentKey }) => (
                  <a
                    {...contentAttributes(shared, contentKey, planSection.id)}
                    href={action.href}
                    key={action.method}
                    rel={action.rel}
                    target={action.target}
                  >
                    <ContactMark method={action.method} />
                    {action.actionLabel}
                  </a>
                ))}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function FinalCta({ planSection, section, shared }: LibraryPreviewSectionProps) {
  const settings = settingsOf(section, 'final_cta');
  if (!settings) return null;
  const headline = resolveBound(settings.headline, `Ready when you are`);
  return (
    <section
      {...sectionAttributes(planSection, 'final_cta')}
      aria-label="Book an appointment"
      className={`customer-lib-final-cta is-${settings.preset}`}
    >
      <h2>{headline}</h2>
      <p>Pick a service and a time that suits you — it only takes a minute.</p>
      <a className="onboarding-customer-primary" href="#booking" onClick={shared.onBook}>
        Book an appointment
      </a>
    </section>
  );
}

function Footer({ planSection, section, shared }: LibraryPreviewSectionProps) {
  const settings = settingsOf(section, 'footer');
  if (!settings) return null;
  const { profile } = shared.state;
  const contactActions = getPublicContactActions(profile)
    .flatMap((action) => {
      const contentKey: SiteContentKey | null = action.method === 'instagram'
        ? 'instagram'
        : action.method === 'call'
          ? 'phone'
          : action.method === 'text'
            ? 'text'
            : action.method === 'email'
              ? 'email'
              : null;
      return contentKey && sectionOwnsContent(
        shared.contentPlacement,
        contentKey,
        planSection.id,
      )
        ? [{ action, contentKey }]
        : [];
    });
  return (
    <footer
      {...sectionAttributes(planSection, 'footer')}
      aria-label={`${shared.title} site footer`}
      className={`customer-lib-footer is-${settings.preset}`}
    >
      <div className="customer-lib-footer-brand">
        <strong>{shared.title}</strong>
      </div>
      {contactActions.length > 0 ? (
        <div className="customer-lib-footer-links">
          {contactActions.map(({ action, contentKey }) => (
            <a
              {...contentAttributes(shared, contentKey, planSection.id)}
              href={action.href}
              key={action.method}
              rel={action.rel}
              target={action.target}
            >
              {action.actionLabel}
            </a>
          ))}
        </div>
      ) : null}
      {settings.showAttribution ? <small>Powered by Luster</small> : null}
    </footer>
  );
}

/**
 * Renderers for the library types OnboardingSitePreview does not render with
 * its pre-library components. Keys deliberately omit hero/about/gallery and
 * contact — the dispatch handles those first.
 */
export const LIBRARY_SECTION_PREVIEW_RENDERERS: Partial<
  Record<LibrarySectionType, LibraryPreviewRenderer>
> = {
  announcement_bar: AnnouncementBar,
  deposits_cancellations: DepositsCancellations,
  faq: Faq,
  featured_services: FeaturedServices,
  final_cta: FinalCta,
  footer: Footer,
  hours: Hours,
  offers: Offers,
  policies: Policies,
  quick_info: QuickInfo,
  reviews: Reviews,
  section_navigation: SectionNavigation,
  team: Team,
  visit_us: VisitUs,
};
