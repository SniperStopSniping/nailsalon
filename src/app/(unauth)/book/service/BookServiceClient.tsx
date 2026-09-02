'use client';

import { Facebook, Info, Instagram, Music2, ShieldCheck } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';

import { BookingStepHeader } from '@/components/booking/BookingStepHeader';
import {
  SectionOrderRenderer,
  type SectionVariantRenderers,
} from '@/components/booking/SectionOrderRenderer';
import { ServiceCardImage } from '@/components/booking/ServiceCardImage';
import { TechnicianAvatar } from '@/components/booking/TechnicianAvatar';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StateCard } from '@/components/ui/state-card';
import { useBookingState } from '@/hooks/useBookingState';
import { BOOKING_CATEGORY_META } from '@/libs/bookingCategory';
import { type BookingStep, getFirstStep, getNextStep, getPrevStep } from '@/libs/bookingFlow';
import { getFeaturedServices, sortServicesForCategory } from '@/libs/bookingMerchandising';
import type { SectionId } from '@/libs/bookingPageConfig';
import { buildBookingUrl, parseSelectedAddOnsParam, type SelectedAddOnParam, serializeSelectedAddOns } from '@/libs/bookingParams';
import { triggerHaptic } from '@/libs/haptics';
import {
  getPublicTechnicianCompatibility,
  type PublicTechnicianPreview,
  technicianSupportsPublicLocation,
} from '@/libs/publicTechnicianCompatibility';
import {
  resolveQuickBookPublicSectionOrder,
  usesCompactQuickBookProfile,
} from '@/libs/quickBookProfilePresentation';
import { EMPTY_SALON_CONTENT } from '@/libs/salonContent';
import { deriveSalonProfileHeroAlt, resolveSectionPresentation } from '@/libs/sectionPresentation';
import {
  resolveSectionDecisionPlan,
  resolveVisitContent,
  SECTION_REGISTRY,
  shouldRenderSection,
} from '@/libs/sectionRegistry';
import { getPublicTechnicianRatingDisplay } from '@/libs/technicianRating';
import { BOOKING_CATEGORIES, type BookingCategory } from '@/models/Schema';
import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';
import { formatDuration } from '@/utils/Helpers';

import type { QuickBookProfileView } from './quickBookProfile';
import { QuickBookProfileHeader } from './QuickBookProfileHeader';

type ServiceCategory =
  | 'manicure'
  | 'builder_gel'
  | 'extensions'
  | 'pedicure'
  | 'hands'
  | 'feet'
  | 'combo';

type AddOnCategory = 'nail_art' | 'repair' | 'removal' | 'pedicure_addon';
type AddOnPricingType = 'fixed' | 'per_unit';
type SelectionMode = 'optional' | 'required' | 'conditional';

export type ServiceData = {
  id: string;
  name: string;
  description: string | null;
  descriptionItems: string[];
  durationMinutes: number;
  priceCents: number;
  priceDisplayText: string | null;
  category: ServiceCategory;
  bookingCategory: BookingCategory;
  templateKey: string | null;
  featuredOrder: number | null;
  imageUrl: string;
  resolvedIntroPriceLabel: string | null;
  sortOrder?: number | null;
};

export type AddOnData = {
  id: string;
  name: string;
  descriptionItems: string[];
  category: AddOnCategory;
  pricingType: AddOnPricingType;
  unitLabel: string | null;
  maxQuantity: number | null;
  durationMinutes: number;
  priceCents: number;
  priceDisplayText: string | null;
  isActive: boolean;
};

export type ServiceAddOnRule = {
  id: string;
  serviceId: string;
  addOnId: string;
  selectionMode: SelectionMode;
  defaultQuantity: number | null;
  maxQuantityOverride: number | null;
  displayOrder: number;
};

export type LocationData = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
  isPrimary: boolean;
};

type TechnicianPreviewData = PublicTechnicianPreview;

type BookServiceClientProps = {
  services: ServiceData[];
  addOns?: AddOnData[];
  serviceAddOnRules?: ServiceAddOnRule[];
  bookingFlow: BookingStep[];
  locations: LocationData[];
  technicians?: TechnicianPreviewData[];
  currency?: string;
  showNewClientPromo?: boolean;
  lusterFeaturingEnabled?: boolean;
  showServiceImages?: boolean;
  /**
   * Authorized owner-builder iframe rendering blocks scripts by design. Keep
   * the real hydration lifecycle untouched while making its server-rendered
   * entrance state visible without waiting for an effect that cannot run.
   */
  isEmbeddedBuilderPreview?: boolean;
  /** Server-projected public data; disabled Quick Book fields never reach the client. */
  quickBookProfile?: QuickBookProfileView;
};

// Height reserved for the fixed CTA bar. The in-page spacer and the tenant
// footer clearance var must stay byte-identical, or the last card / footer
// links end up underneath the bar on short viewports.
const STICKY_FOOTER_CLEARANCE = 'calc(4.75rem + env(safe-area-inset-bottom, 0px) + var(--ios-chrome-viewport-bottom, 0px))';

// Editorial layout only (Rev 3 plan section 6, PR 6): the `#services`
// anchor wrapper below carries `scroll-mt-4` (1rem = 16px) so an anchor-link
// jump (Skip to services / the hero CTA) doesn't dock content flush to the
// very top edge. Native `scrollIntoView` honours that same scroll-margin
// and rests with the anchor's top a few px short of 0 (measured ~16.7px in
// practice — sub-pixel layout rounding, not exactly 16) — a strict `<= 16`
// check still misses it by a hair, so this is 16 plus a deliberate safety
// margin rather than the bare CSS value.
const SERVICES_ANCHOR_SCROLL_MARGIN_PX = 24;

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function buildServiceRows(services: ServiceData[]): ServiceData[][] {
  const rows: ServiceData[][] = [];
  let currentRow: ServiceData[] = [];

  for (const service of services) {
    if (service.bookingCategory === 'combo') {
      if (currentRow.length > 0) {
        rows.push(currentRow);
        currentRow = [];
      }
      rows.push([service]);
      continue;
    }

    currentRow.push(service);
    if (currentRow.length === 2) {
      rows.push(currentRow);
      currentRow = [];
    }
  }

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  return rows;
}

function buildDefaultSelectedAddOns(
  serviceId: string | null,
  rules: ServiceAddOnRule[],
  addOns: AddOnData[],
  current: SelectedAddOnParam[],
): SelectedAddOnParam[] {
  if (!serviceId) {
    return [];
  }

  const relevantRules = rules
    .filter(rule => rule.serviceId === serviceId)
    .sort((a, b) => a.displayOrder - b.displayOrder);
  const addOnsById = new Map(addOns.map(addOn => [addOn.id, addOn]));
  const currentById = new Map(current.map(item => [item.addOnId, item.quantity ?? 1]));
  const normalized: SelectedAddOnParam[] = [];

  for (const rule of relevantRules) {
    const addOn = addOnsById.get(rule.addOnId);
    if (!addOn || !addOn.isActive) {
      continue;
    }

    const existingQuantity = currentById.get(rule.addOnId);
    const rawQuantity = existingQuantity ?? rule.defaultQuantity ?? (rule.selectionMode === 'required' ? 1 : 0);
    const maxQuantity = rule.maxQuantityOverride ?? addOn.maxQuantity ?? 10;
    const normalizedQuantity = Math.min(
      maxQuantity,
      Math.max(addOn.pricingType === 'per_unit' ? 1 : 1, rawQuantity),
    );

    if (existingQuantity !== undefined || rule.selectionMode === 'required' || rule.defaultQuantity) {
      normalized.push({
        addOnId: rule.addOnId,
        quantity: addOn.pricingType === 'per_unit' ? normalizedQuantity : 1,
      });
    }
  }

  return normalized;
}

const EMPTY_ADD_ONS: AddOnData[] = [];
const EMPTY_ADD_ON_RULES: ServiceAddOnRule[] = [];
const EMPTY_TECHNICIANS: TechnicianPreviewData[] = [];
/**
 * Mirrors `DEFAULT_SECTION_ORDER` / `BOOKING_PAGE_CONFIG_SIDE_DEFAULTS.sectionOrder`
 * in `@/libs/bookingPageConfig` (PR 2) exactly. Not imported directly: that
 * module also exports `updateBookingPageDraft`, which imports `@/libs/DB`
 * (`import 'server-only'`) — importing ANY value from it, even an unrelated
 * constant, would drag that server-only module graph into this 'use client'
 * component's bundle. `useSalon().bookingPage.sectionOrder` (the real,
 * server-resolved value threaded through `SalonProvider`) is what actually
 * drives rendering in production; this literal is only a same-shape fallback
 * for the rare case that value is missing (a test double stubbing
 * `useSalon()` with a partial object). If PR 2's default ever changes, update
 * both — there is currently no client-safe way to import one from the other.
 */
const QUICK_BOOK_SECTION_ORDER_FALLBACK: SectionId[] = [
  'salonProfile',
  'serviceMenu',
  'featuredServices',
  'policies',
  'socialLinks',
  'bookingCta',
];
const SOCIAL_LINKS = [
  { key: 'instagram', label: 'Instagram', Icon: Instagram },
  { key: 'facebook', label: 'Facebook', Icon: Facebook },
  { key: 'tiktok', label: 'TikTok', Icon: Music2 },
] as const;

export function BookServiceClient({
  services,
  addOns = EMPTY_ADD_ONS,
  serviceAddOnRules = EMPTY_ADD_ON_RULES,
  bookingFlow,
  locations,
  technicians = EMPTY_TECHNICIANS,
  currency = 'CAD',
  showNewClientPromo = false,
  lusterFeaturingEnabled = true,
  showServiceImages = true,
  isEmbeddedBuilderPreview = false,
  quickBookProfile,
}: BookServiceClientProps) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { bookingExperience, salonName, salonSlug, bookingPage, salonContent } = useSalon();
  const locale = (params?.locale as string) || 'en';
  const routeSalonSlug = typeof params?.slug === 'string' ? params.slug : null;
  // Luster UI/UX plan rev 3, PR 4: iterate the resolved Quick Book section
  // order rather than re-deciding it here. `bookingPage`/`salonContent` are
  // only undefined in test doubles that mock `useSalon()` with a partial
  // object; the real SalonProvider always supplies both, resolved
  // server-side, so these fallbacks only ever apply outside production.
  const layout = bookingPage?.layout ?? 'quick_book';
  const compactQuickBookProfileEnabled = layout === 'quick_book'
    && usesCompactQuickBookProfile(bookingPage?.quickBookProfile);
  const quickBookSectionOrder = resolveQuickBookPublicSectionOrder(
    layout,
    bookingPage?.sectionOrder ?? QUICK_BOOK_SECTION_ORDER_FALLBACK,
    bookingPage?.quickBookProfile,
  );
  // Post-launch fix: resolved `bookingPage.{draft,live}.hiddenSections` —
  // previously written by the admin surface, validated by
  // validateSectionOrder, and round-tripped through publish/revert, but
  // never actually read anywhere in the render path (the bug this fix
  // closes). Defaults to none-hidden for the same test-double reason as
  // quickBookSectionOrder above. Threaded into SectionOrderRenderer below
  // (the one choke point for section visibility) AND used here to compute
  // presentation flags for the content that stays structurally embedded
  // inside the shared `serviceMenu` block — see `renderServiceMenuContent`'s
  // own doc comment for why SectionOrderRenderer alone cannot govern that
  // embedded content.
  const quickBookHiddenSections = bookingPage?.hiddenSections ?? [];
  const featuredServices = getFeaturedServices(services, { lusterFeaturingEnabled });
  // The real SalonProvider always supplies one public-safe canonical content
  // object. The fallback exists only for narrow legacy test doubles which
  // omit that provider field; it mirrors the same public projections so the
  // renderer never overlays or rewrites an existing canonical object.
  const quickBookContent = salonContent
    ?? {
      ...EMPTY_SALON_CONTENT,
      identity: { ...EMPTY_SALON_CONTENT.identity, name: salonName },
      catalog: {
        ...EMPTY_SALON_CONTENT.catalog,
        services,
        featuredServices,
      },
      policies: {
        policy: bookingExperience.policy,
        quickFacts: bookingExperience.quickFacts,
      },
      social: bookingExperience.socialLinks,
    };
  const resolvedQuickBookProfile: QuickBookProfileView = quickBookProfile ?? {
    identity: {
      salonName,
      logoUrl: quickBookContent.identity.logoUrl,
      technicianName: null,
      technicianPhotoUrl: null,
    },
    location: null,
    hours: null,
    contact: null,
    policies: [],
    reviews: null,
    instagram: null,
    bio: null,
  };
  const sectionPresentation = resolveSectionPresentation({
    layout,
    sectionVariants: bookingPage?.sectionVariants,
    content: quickBookContent,
  });
  const usesEditorialBookingHandoff = sectionPresentation.bookingAccess === 'editorial-handoff';
  const hasBookingBrandColor = bookingExperience.primaryColor !== null;
  const bookingBrandForeground = hasBookingBrandColor
    ? 'var(--booking-brand-foreground, #000000)'
    : undefined;
  const configuredSocialLinks = SOCIAL_LINKS.flatMap(({ key, label, Icon }) => {
    const href = quickBookContent.social[key];
    return href ? [{ key, label, Icon, href }] : [];
  });
  const serviceQuickFacts = [
    {
      key: 'appointment-only',
      ...quickBookContent.policies.quickFacts.appointmentOnly,
    },
    {
      key: 'deposit-notice',
      ...quickBookContent.policies.quickFacts.depositNotice,
    },
    {
      key: 'cancellation-notice',
      ...quickBookContent.policies.quickFacts.cancellationNotice,
    },
  ].flatMap(fact =>
    fact.enabled && fact.label?.trim()
      ? [{ key: fact.key, label: fact.label }]
      : []);
  const servicePagePolicyText = quickBookContent.policies.policy.enabled
    && quickBookContent.policies.policy.showOnServicePage
    && quickBookContent.policies.policy.text?.trim()
    ? quickBookContent.policies.policy.text
    : null;

  const isFirstStep = getFirstStep(bookingFlow) === 'service';
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';
  const manageToken = searchParams.get('manageToken') || '';
  const campaignToken = searchParams.get('campaign') || '';
  const urlLocationId = searchParams.get('locationId') || '';
  const urlBaseServiceId = searchParams.get('baseServiceId');
  const urlTechId = searchParams.get('techId');
  const urlSelectedAddOns = parseSelectedAddOnsParam(searchParams.get('selectedAddOns'));
  const legacyServiceIds = searchParams.get('serviceIds')?.split(',').filter(Boolean) ?? [];

  const {
    technicianId = null,
    technicianSelectionSource = null,
    locationId: storedLocationId = null,
    setTechnicianId = () => {},
    setBaseServiceId = () => {},
    setSelectedAddOns = () => {},
    setServiceIds = () => {},
    setLocationId = () => {},
    syncFromUrl = () => {},
    isHydrated = false,
  } = useBookingState(salonSlug);

  const primaryLocation = locations.find(l => l.isPrimary) || locations[0];
  const showLocationPicker = locations.length >= 2;
  const urlLocationValid = urlLocationId && locations.some(l => l.id === urlLocationId);
  const hadInvalidLocation = !!(urlLocationId && !urlLocationValid && showLocationPicker);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(() => {
    if (urlLocationValid) {
      return urlLocationId;
    }
    return primaryLocation?.id || null;
  });
  const [showLocationFallbackToast, setShowLocationFallbackToast] = useState(hadInvalidLocation);

  const urlDrivenBaseServiceId = urlBaseServiceId ?? legacyServiceIds[0] ?? null;
  const initialBaseServiceId = urlDrivenBaseServiceId ?? null;
  const initialSelectedService = services.find(service => service.id === initialBaseServiceId) ?? null;
  // Manicure is the default tab, unless the salon offers nothing under it —
  // then land on the first tab (in canonical order) that has services.
  const firstNonEmptyCategory: BookingCategory
    = BOOKING_CATEGORIES.find(category =>
      services.some(service => service.bookingCategory === category)) ?? 'manicure';
  const initialCategory: BookingCategory = initialSelectedService?.bookingCategory ?? firstNonEmptyCategory;
  const initialSelectedAddOns = initialBaseServiceId
    ? buildDefaultSelectedAddOns(
      initialBaseServiceId,
      serviceAddOnRules,
      addOns,
      urlSelectedAddOns,
    )
    : [];

  const [selectedCategory, setSelectedCategory] = useState<BookingCategory>(initialCategory);
  const [selectedBaseServiceId, setSelectedBaseServiceIdState] = useState<string | null>(initialBaseServiceId);
  const [selectedAddOnsState, setSelectedAddOnsState] = useState<SelectedAddOnParam[]>(initialSelectedAddOns);
  const [addOnAnnouncement, setAddOnAnnouncement] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [mounted, setMounted] = useState(false);
  // Display-only readiness for the view-only, script-blocked builder iframe.
  // `mounted` itself must remain the hydration gate for URL synchronization
  // and every booking interaction below.
  const previewContentReady = isEmbeddedBuilderPreview || mounted;
  const [campaignOffer, setCampaignOffer] = useState<{
    name: string;
    displayOffer: string;
    code: string | null;
  } | null>(null);
  const [campaignUnavailable, setCampaignUnavailable] = useState(false);
  const hasUserChangedSelectionRef = useRef(false);
  const hasAppliedHydratedBookingStateRef = useRef(false);
  const hasPendingAddOnAnnouncementRef = useRef(false);
  const searchCardRef = useRef<HTMLDivElement>(null);
  // Editorial's sticky-CTA handoff (Rev 3 plan section 6): "the sticky Book
  // CTA scrolls to #services then hands over to the sticky Continue bar —
  // the two must never both be visible." `servicesAnchorRef` is the #services
  // wrapper itself; `hasReachedServicesAnchor` flips true once its top edge
  // has scrolled to or above the viewport's top edge. Defaults to false (the
  // page always loads scrolled to the top, above #services).
  const servicesAnchorRef = useRef<HTMLDivElement | null>(null);
  const [hasReachedServicesAnchor, setHasReachedServicesAnchor] = useState(false);
  // Review finding (PR6, High, fixed): tracked separately from
  // `hasReachedServicesAnchor` above. That flag used to double as BOTH "the
  // user has actually scrolled the anchor to the top of the viewport" AND
  // "the anchor can never geometrically reach that threshold, so hand off
  // to the Continue bar anyway" — collapsing them into one boolean meant
  // the editorial "Book appointment" jump CTA's render gate
  // (`!hasReachedServicesAnchor`) went false the instant a short page was
  // detected as unreachable, EVEN BEFORE any service was selected. Since
  // the Continue bar itself is separately gated on `selectedService` (there
  // is nothing to "continue" until a service is chosen), that left a
  // genuinely-unreachable page with literally no visible sticky CTA at all
  // for every first-time visitor, from the very first paint. Keeping this
  // as its own signal lets the render logic below require a real selection
  // before treating "unreachable" as license to hide the jump link.
  const [isServicesAnchorUnreachable, setIsServicesAnchorUnreachable] = useState(false);

  // On touch devices the on-screen keyboard eats the lower half of the viewport,
  // so the salon header above the search bar can push the first result row out of
  // sight. Pin the search bar to the top on focus so matches land in the space
  // above the keyboard. Desktop (fine pointer) keeps its normal scroll position.
  const handleSearchFocus = () => {
    const el = searchCardRef.current;
    if (!el || typeof el.scrollIntoView !== 'function') {
      return;
    }

    const isCoarsePointer = typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches;
    if (!isCoarsePointer) {
      return;
    }

    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // Editorial-only: drive the sticky-CTA handoff from real scroll position.
  // jsdom has no IntersectionObserver/ResizeObserver by default, so this
  // effect no-ops for most of the existing suite; the Editorial test file
  // stubs both constructors globally and drives their captured callbacks
  // directly to exercise this logic deterministically.
  //
  // Review finding (PR6, High, fixed): on a short Editorial page — a small
  // catalog, a brief bio, one address line, one policy sentence — the
  // document may not have enough scrollable height below #services for its
  // top edge to ever reach SERVICES_ANCHOR_SCROLL_MARGIN_PX, even scrolled
  // all the way to the bottom. The intersection-based check alone would
  // then never flip `hasReachedServicesAnchor` to true, permanently
  // trapping the user behind the dead "Book appointment" jump link with no
  // way to reach the real Continue button. `isServicesAnchorGeometricallyReachable`
  // detects that case by computing whether scrolling to the document's
  // absolute current maximum could ever satisfy the threshold.
  //
  // A second, previously-unfixed bug lived in how that detection was wired
  // up: the very first measurement — taken at mount, before images have
  // loaded, fonts have swapped in, or responsive content has settled —
  // decided the verdict via a one-way `unreachable` flag. Once that flag
  // was set true on a false-negative first read, the effect returned early
  // and never attached either observer, so the page stayed wrongly latched
  // in the Continue-bar fallback forever, even after the layout grew enough
  // moments later for the anchor to become genuinely reachable (observed in
  // review: a real page measured 1773px tall pre-load and 1849px once
  // settled). `recomputeReachability` below is now a pure function of
  // current geometry — it is re-run from scratch on every trigger, in
  // either direction, and both observers are always attached up front so a
  // bad first reading can never suppress future recomputation.
  //
  // A third gap, found only by driving this against a real Chromium render
  // (a synthetic IntersectionObserver entry in a unit test cannot exercise
  // it): a plain `threshold: [0, 1]` IntersectionObserver only fires at the
  // anchor's full enter/exit of the viewport. #services (a search bar plus
  // a handful of cards) is frequently SHORTER than the viewport, so once it
  // is fully visible (ratio 1) it can keep scrolling — its top edge moving
  // from, say, 135px down to 16px — without ever crossing another
  // threshold, silently skipping the exact crossing this feature needs to
  // detect. `attachIntersectionObserver` fixes this generically with a
  // `rootMargin` that shrinks the observed viewport down to a thin
  // `SERVICES_ANCHOR_SCROLL_MARGIN_PX`-tall strip at its very top, so a
  // notification fires exactly when the anchor's top edge crosses that
  // strip, regardless of the anchor's own height relative to the viewport.
  useEffect(() => {
    if (!usesEditorialBookingHandoff) {
      setHasReachedServicesAnchor(false);
      setIsServicesAnchorUnreachable(false);
      return undefined;
    }

    const node = servicesAnchorRef.current;
    if (!node) {
      return undefined;
    }

    const isServicesAnchorGeometricallyReachable = (): boolean => {
      if (typeof window === 'undefined' || typeof document === 'undefined' || !document.documentElement) {
        return true;
      }
      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const topAtMaxScroll = node.getBoundingClientRect().top + window.scrollY - maxScrollY;
      return topAtMaxScroll <= SERVICES_ANCHOR_SCROLL_MARGIN_PX;
    };

    // Most recent "has the anchor's top edge actually scrolled to/past the
    // viewport's top edge" reading from the IntersectionObserver below.
    // `null` until it has fired at least once, matching the default
    // `false` state (the page always loads scrolled above #services). The
    // arithmetic `<= SERVICES_ANCHOR_SCROLL_MARGIN_PX` comparison (not
    // `isIntersecting`) is what keeps this correctly "reached" even after
    // scrolling further past the anchor — its top only gets more negative —
    // while still correctly reverting to "not reached" if the user scrolls
    // back up above it; the observer below fires on both transitions.
    let lastIntersectionTop: number | null = null;

    // Derives the rendered state from the two signals above. Never a
    // one-way latch — every call re-reads current geometry and the latest
    // known intersection reading from scratch, so the state can flip in
    // EITHER direction as the page changes after mount.
    const applyReachability = () => {
      // Review finding (PR6, High, fixed): this used to fold "geometrically
      // unreachable" into `hasReachedServicesAnchor` itself (setting it
      // `true` as a fallback signal). That collapsed two different meanings
      // into one flag and, downstream, hid the editorial jump CTA any time
      // the page was short — even before the visitor had selected a
      // service, when the Continue bar (gated on `selectedService`) has
      // nothing to show either, leaving zero sticky CTAs visible. The two
      // signals are now tracked independently; the render logic below is
      // responsible for combining them so a real selection is required
      // before "unreachable" hides the jump link.
      setIsServicesAnchorUnreachable(!isServicesAnchorGeometricallyReachable());
      // Always derived purely from the last real intersection reading (if
      // the IntersectionObserver has already fired at least once) — never
      // forced by geometry — so it reflects only "has the user actually
      // scrolled the anchor to/past the viewport's top edge".
      setHasReachedServicesAnchor(
        lastIntersectionTop !== null && lastIntersectionTop <= SERVICES_ANCHOR_SCROLL_MARGIN_PX,
      );
    };

    let observer: IntersectionObserver | undefined;

    // (Re)creates the IntersectionObserver — see the effect's doc comment
    // above for why its `rootMargin` (not a plain full-viewport threshold)
    // is the correct primitive here. Recreated, not just re-observed, on
    // every trigger below: `rootMargin` bakes in a pixel value computed
    // from `window.innerHeight` at creation time, so it drifts if the
    // viewport is resized afterward — recreating also guarantees a fresh
    // initial notification reflecting current geometry, per spec, which is
    // what makes a resize/content-growth trigger (not just a user scroll)
    // correctly resolve this if it was the last thing blocking an accurate
    // reading.
    const attachIntersectionObserver = () => {
      observer?.disconnect();
      observer = undefined;
      if (typeof IntersectionObserver === 'undefined' || typeof window === 'undefined') {
        return;
      }
      const bandHeightPx = Math.max(0, window.innerHeight - SERVICES_ANCHOR_SCROLL_MARGIN_PX);
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry) {
            return;
          }
          // "Scrolled to or past" the anchor: its top edge is at or above the
          // viewport's top edge. boundingClientRect (not isIntersecting) is
          // what distinguishes "not yet reached" from "already scrolled past"
          // — both otherwise read as simply "not intersecting". The threshold
          // is SERVICES_ANCHOR_SCROLL_MARGIN_PX, not a strict 0: the anchor
          // wrapper below carries `scroll-mt-4` (1rem) so an anchor-link jump
          // (Skip to services / the hero CTA) doesn't dock content flush to
          // the very top edge — native `scrollIntoView` honours that same
          // scroll-margin and rests with the anchor's top a few px short of 0,
          // which a strict `<= 0` check would never count as "reached".
          lastIntersectionTop = entry.boundingClientRect.top;
          applyReachability();
        },
        { rootMargin: `0px 0px -${bandHeightPx}px 0px` },
      );
      observer.observe(node);
    };

    const recomputeReachability = () => {
      attachIntersectionObserver();
      applyReachability();
    };

    // Attach both observers BEFORE the first measurement below, so an early
    // false-negative measurement can never permanently prevent them from
    // being attached (see the effect's doc comment above).
    window.addEventListener('resize', recomputeReachability);

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      // Watches real document geometry generically, so any post-mount
      // height change re-triggers the check — image load, font swap,
      // search filtering the catalog, add-on panel expanding — rather than
      // depending on a fragile single-purpose signal like a hero `onLoad`
      // handler or a `setTimeout` guess at "the layout has settled".
      resizeObserver = new ResizeObserver(recomputeReachability);
      resizeObserver.observe(document.documentElement);
    }

    // Initial measurement, taken after the ResizeObserver above is already
    // attached (and this call itself attaches the IntersectionObserver), so
    // a false negative here can never suppress the recomputation that a
    // later resize/observer trigger would otherwise provide.
    recomputeReachability();

    return () => {
      window.removeEventListener('resize', recomputeReachability);
      resizeObserver?.disconnect();
      observer?.disconnect();
    };
  }, [usesEditorialBookingHandoff]);

  useEffect(() => {
    if (!campaignToken || !salonSlug) {
      setCampaignOffer(null);
      setCampaignUnavailable(false);
      return undefined;
    }

    let active = true;
    const loadCampaign = async () => {
      try {
        const response = await fetch(
          `/api/public/retention-campaigns/${encodeURIComponent(campaignToken)}?salonSlug=${encodeURIComponent(salonSlug)}`,
          { cache: 'no-store' },
        );
        const payload = await response.json().catch(() => null);
        if (!active) {
          return;
        }
        const campaign = payload?.data?.campaign;
        if (!response.ok || !campaign?.displayOffer || !campaign?.promotion?.name) {
          setCampaignOffer(null);
          setCampaignUnavailable(true);
          return;
        }
        setCampaignOffer({
          name: campaign.promotion.name,
          displayOffer: campaign.displayOffer,
          code: campaign.promotion.code ?? null,
        });
        setCampaignUnavailable(false);
      } catch {
        if (active) {
          setCampaignOffer(null);
          setCampaignUnavailable(true);
        }
      }
    };

    void loadCampaign();
    return () => {
      active = false;
    };
  }, [campaignToken, salonSlug]);

  // iOS Chrome can leave fixed elements attached to the layout viewport while
  // its bottom toolbar changes the visible viewport. Keep a CSS offset in sync
  // with that gap. Safari is deliberately excluded because it already places
  // fixed elements against its visual viewport correctly.
  useEffect(() => {
    const visualViewport = window.visualViewport;
    const isIosChrome = /CriOS/i.test(window.navigator.userAgent);

    if (!isIosChrome || !visualViewport) {
      return undefined;
    }

    const updateViewportBottom = () => {
      const viewportBottom = visualViewport.offsetTop + visualViewport.height;
      const bottomInset = Math.max(0, window.innerHeight - viewportBottom);
      document.documentElement.style.setProperty('--ios-chrome-viewport-bottom', `${bottomInset}px`);
    };

    updateViewportBottom();
    visualViewport.addEventListener('resize', updateViewportBottom);
    visualViewport.addEventListener('scroll', updateViewportBottom);

    return () => {
      visualViewport.removeEventListener('resize', updateViewportBottom);
      visualViewport.removeEventListener('scroll', updateViewportBottom);
      document.documentElement.style.removeProperty('--ios-chrome-viewport-bottom');
    };
  }, []);

  // Location is the only thing persisted state may restore. The service pick is
  // deliberately NOT restored: the stored blob outlives a finished booking, so
  // restoring it re-pressed the last service — and expanded its add-on panel over
  // the whole menu — before the client had seen anything. A pick now survives
  // browser back and reload through the URL mirror below instead.
  useEffect(() => {
    if (!isHydrated || hasAppliedHydratedBookingStateRef.current || hasUserChangedSelectionRef.current) {
      return;
    }

    if (!urlLocationId && storedLocationId && locations.some(location => location.id === storedLocationId)) {
      setSelectedLocationId(storedLocationId);
    }

    hasAppliedHydratedBookingStateRef.current = true;
  }, [isHydrated, locations, storedLocationId, urlLocationId]);

  useEffect(() => {
    if (hadInvalidLocation && primaryLocation?.id) {
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.set('locationId', primaryLocation.id);
      window.history.replaceState(null, '', `?${newParams.toString()}`);
    }
  }, [hadInvalidLocation, primaryLocation?.id, searchParams]);

  // Mirror the selection into the URL (shallow — no navigation, no history entry)
  // so browser back, gesture back, and reload all restore the client's pick. Same
  // approach as syncSelectedDateToUrl on the time step. Gated on `mounted` so the
  // first paint never rewrites an incoming deep link, and clearing the selection
  // deletes the params rather than leaving them to resurrect it on reload.
  useEffect(() => {
    if (!mounted) {
      return;
    }

    const newParams = new URLSearchParams(searchParams.toString());
    const serializedAddOns = selectedBaseServiceId
      ? serializeSelectedAddOns(selectedAddOnsState)
      : null;

    if (selectedBaseServiceId) {
      newParams.set('baseServiceId', selectedBaseServiceId);
    } else {
      newParams.delete('baseServiceId');
    }

    if (serializedAddOns) {
      newParams.set('selectedAddOns', serializedAddOns);
    } else {
      newParams.delete('selectedAddOns');
    }

    // Next keeps useSearchParams in sync with replaceState, so an unguarded write
    // would re-trigger this effect on its own output.
    const nextQuery = newParams.toString();
    if (nextQuery === searchParams.toString()) {
      return;
    }

    window.history.replaceState(null, '', `?${nextQuery}`);
  }, [mounted, searchParams, selectedAddOnsState, selectedBaseServiceId]);

  useEffect(() => {
    if (urlBaseServiceId || legacyServiceIds[0] || urlTechId) {
      syncFromUrl({
        techId: urlTechId,
        technicianSelectionSource: urlTechId && urlTechId !== 'any' ? 'explicit' : null,
        baseServiceId: urlBaseServiceId ?? legacyServiceIds[0] ?? null,
        selectedAddOns: urlSelectedAddOns,
        serviceIds: legacyServiceIds,
        locationId: selectedLocationId,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (!selectedBaseServiceId) {
      if (selectedAddOnsState.length > 0) {
        setSelectedAddOnsState([]);
      }
      setBaseServiceId(null);
      setServiceIds([]);
      setSelectedAddOns([]);
      return;
    }

    const normalized = buildDefaultSelectedAddOns(
      selectedBaseServiceId,
      serviceAddOnRules,
      addOns,
      selectedAddOnsState,
    );

    const sameSelection = normalized.length === selectedAddOnsState.length
      && normalized.every((item, index) => (
        item.addOnId === selectedAddOnsState[index]?.addOnId
        && (item.quantity ?? 1) === (selectedAddOnsState[index]?.quantity ?? 1)
      ));

    if (!sameSelection) {
      setSelectedAddOnsState(normalized);
    }

    setBaseServiceId(selectedBaseServiceId);
    setServiceIds([selectedBaseServiceId]);
    setSelectedAddOns(normalized);
  }, [addOns, isHydrated, selectedAddOnsState, selectedBaseServiceId, serviceAddOnRules, setBaseServiceId, setSelectedAddOns, setServiceIds]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    setLocationId(selectedLocationId);
  }, [isHydrated, selectedLocationId, setLocationId]);

  const handleServiceSelection = (service: ServiceData) => {
    hasUserChangedSelectionRef.current = true;

    if (selectedBaseServiceId === service.id) {
      setSelectedBaseServiceIdState(null);
      setSelectedAddOnsState([]);
      if (technicianSelectionSource === 'auto') {
        setTechnicianId(null, null);
      }
    } else {
      setSelectedBaseServiceIdState(service.id);
      setSelectedCategory(service.bookingCategory);
    }

    triggerHaptic('select');
  };

  // An active search collapses the category chrome and searches every category at
  // once, so the query drives the whole "is this a search view?" decision below.
  // Trim so a whitespace-only value never flips into the search/empty state.
  const trimmedQuery = searchQuery.trim();
  const isSearching = trimmedQuery.length > 0;
  const normalizedQuery = trimmedQuery.toLowerCase();

  const filteredServices = isSearching
    ? services.filter((service) => {
      const haystacks = [
        service.name,
        service.description ?? '',
        ...service.descriptionItems,
      ];
      return haystacks.some(text => text.toLowerCase().includes(normalizedQuery));
    })
    : sortServicesForCategory(
      services.filter(service => service.bookingCategory === selectedCategory),
      selectedCategory,
    );

  const selectedService = services.find(service => service.id === selectedBaseServiceId) ?? null;
  const selectedRules = selectedBaseServiceId
    ? serviceAddOnRules
      .filter(rule => rule.serviceId === selectedBaseServiceId)
      .sort((a, b) => a.displayOrder - b.displayOrder)
    : [];
  const addOnsById = new Map(addOns.map(addOn => [addOn.id, addOn]));
  const selectedAddOnsById = new Map(selectedAddOnsState.map(item => [item.addOnId, item.quantity ?? 1]));
  const allowedAddOns = selectedRules
    .map((rule) => {
      const addOn = addOnsById.get(rule.addOnId);
      if (!addOn || !addOn.isActive) {
        return null;
      }

      return {
        rule,
        addOn,
        quantity: selectedAddOnsById.get(addOn.id) ?? 0,
      };
    })
    .filter(Boolean);
  const hasVisibleAddOns = Boolean(selectedService && allowedAddOns.length > 0);
  const hasRequiredAddOns = allowedAddOns.some(item => item?.rule.selectionMode === 'required');
  const hasOptionalAddOns = allowedAddOns.some(item => item?.rule.selectionMode === 'optional');
  const addOnCompositionLabel = hasRequiredAddOns && hasOptionalAddOns
    ? 'Required and optional add-ons'
    : hasRequiredAddOns
      ? 'Required add-ons'
      : 'Optional add-ons';
  const addOnStickyLabel = hasRequiredAddOns && hasOptionalAddOns
    ? 'Required and optional add-ons'
    : hasRequiredAddOns
      ? 'Required add-ons included'
      : 'Optional add-ons available';
  const locationCompatiblePreviewTechnicians = technicians.filter(technician =>
    technicianSupportsPublicLocation({
      technician,
      locationId: selectedLocationId,
    }),
  );
  const compatiblePreviewTechnicians = selectedService
    ? locationCompatiblePreviewTechnicians.filter(technician =>
      getPublicTechnicianCompatibility({
        selectionMode: 'base-service',
        technician,
        requestedServices: [{ id: selectedService.id, name: selectedService.name, category: selectedService.category }],
      }).bookable,
    )
    : [];
  const hasSingleTechnicianSalonPreview = !selectedService && locationCompatiblePreviewTechnicians.length === 1;
  const soleCompatiblePreviewTechnician = compatiblePreviewTechnicians.length === 1
    ? compatiblePreviewTechnicians[0] ?? null
    : null;
  const hasConflictingExplicitTechnician = Boolean(
    technicianSelectionSource === 'explicit'
    && technicianId
    && soleCompatiblePreviewTechnician
    && technicianId !== soleCompatiblePreviewTechnician.id,
  );
  const shouldPreviewAutoSkipTech = Boolean(
    bookingFlow.includes('tech')
    && soleCompatiblePreviewTechnician
    && !hasConflictingExplicitTechnician,
  );
  const shouldCollapseTechStepInHeader = Boolean(
    bookingFlow.includes('tech')
    && (hasSingleTechnicianSalonPreview || shouldPreviewAutoSkipTech),
  );
  const effectiveBookingFlow = shouldCollapseTechStepInHeader
    ? bookingFlow.filter(step => step !== 'tech')
    : bookingFlow;

  // The Free Luster footer is rendered by the tenant layout after this page.
  // Reserve the complete fixed CTA height after that footer only while the CTA
  // is visible, so the natural scroll end never leaves its links underneath
  // iPhone Chrome's visual viewport or browser controls.
  useEffect(() => {
    const footerClearanceProperty = '--service-sticky-footer-clearance';

    if (!selectedService) {
      document.documentElement.style.removeProperty(footerClearanceProperty);
      return undefined;
    }

    document.documentElement.style.setProperty(
      footerClearanceProperty,
      STICKY_FOOTER_CLEARANCE,
    );

    return () => {
      document.documentElement.style.removeProperty(footerClearanceProperty);
    };
  }, [selectedService]);

  useEffect(() => {
    if (!isHydrated || !bookingFlow.includes('tech')) {
      return;
    }

    if (!selectedBaseServiceId) {
      if (technicianSelectionSource === 'auto' || technicianId) {
        setTechnicianId(null, null);
      }
      return;
    }

    const compatibleTechnicianIds = new Set(compatiblePreviewTechnicians.map(technician => technician.id));
    const hasValidExplicitTechnician = Boolean(
      technicianSelectionSource === 'explicit'
      && technicianId
      && compatibleTechnicianIds.has(technicianId),
    );

    if (technicianSelectionSource === 'explicit' && technicianId && !hasValidExplicitTechnician) {
      setTechnicianId(null, null);
      return;
    }

    if (technicianSelectionSource === 'auto') {
      if (!soleCompatiblePreviewTechnician || technicianId !== soleCompatiblePreviewTechnician.id) {
        setTechnicianId(null, null);
        return;
      }
    }

    if (!technicianId && soleCompatiblePreviewTechnician) {
      setTechnicianId(soleCompatiblePreviewTechnician.id, 'auto');
    }
  }, [
    bookingFlow,
    compatiblePreviewTechnicians,
    isHydrated,
    selectedBaseServiceId,
    setTechnicianId,
    soleCompatiblePreviewTechnician,
    technicianId,
    technicianSelectionSource,
  ]);

  const totalPriceCents = (selectedService?.priceCents ?? 0) + allowedAddOns.reduce(
    (sum, item) => {
      if (!item || item.quantity <= 0) {
        return sum;
      }
      return sum + (item.addOn.priceCents * item.quantity);
    },
    0,
  );
  const totalDurationMinutes = (selectedService?.durationMinutes ?? 0) + allowedAddOns.reduce(
    (sum, item) => {
      if (!item || item.quantity <= 0) {
        return sum;
      }
      return sum + (item.addOn.durationMinutes * item.quantity);
    },
    0,
  );
  const totalPriceLabel = formatMoney(totalPriceCents, currency);
  const totalDurationLabel = formatDuration(totalDurationMinutes);

  useEffect(() => {
    if (!hasPendingAddOnAnnouncementRef.current) {
      return;
    }

    hasPendingAddOnAnnouncementRef.current = false;
    setAddOnAnnouncement(
      `Booking total updated. Price ${totalPriceLabel}. Duration ${totalDurationLabel}.`,
    );
  }, [selectedAddOnsState, totalDurationLabel, totalPriceLabel]);

  const sectionPlan = resolveSectionDecisionPlan({
    order: quickBookSectionOrder,
    hiddenSections: quickBookHiddenSections,
    content: quickBookContent,
    announcement: bookingExperience.bookingMessage,
  });
  const serviceRows = buildServiceRows(filteredServices);
  const groupedServiceRows = BOOKING_CATEGORIES.flatMap((category) => {
    const categoryServices = sortServicesForCategory(
      (isSearching ? filteredServices : services).filter(
        service => service.bookingCategory === category,
      ),
      category,
    );
    const rows = buildServiceRows(categoryServices);

    return rows.length > 0 ? [{ category, rows }] : [];
  });
  const soleCompatiblePreviewRating = soleCompatiblePreviewTechnician
    ? getPublicTechnicianRatingDisplay({
      rating: soleCompatiblePreviewTechnician.rating,
      reviewCount: soleCompatiblePreviewTechnician.reviewCount,
    })
    : null;
  const effectiveContinueTechnicianId = shouldPreviewAutoSkipTech
    ? soleCompatiblePreviewTechnician?.id ?? null
    : technicianSelectionSource === 'explicit' && technicianId && compatiblePreviewTechnicians.some(
      technician => technician.id === technicianId,
    )
      ? technicianId
      : null;
  const effectiveContinueTechnicianSelectionSource = effectiveContinueTechnicianId
    ? (
        technicianSelectionSource === 'explicit' && technicianId === effectiveContinueTechnicianId
          ? 'explicit'
          : shouldPreviewAutoSkipTech
            ? 'auto'
            : 'explicit'
      )
    : null;

  const goToNextStep = (baseServiceIdValue: string, selectedAddOnsValue: SelectedAddOnParam[]) => {
    const nextStep = getNextStep('service', effectiveBookingFlow);
    if (!nextStep) {
      return;
    }

    if (effectiveContinueTechnicianId) {
      setTechnicianId(
        effectiveContinueTechnicianId,
        effectiveContinueTechnicianSelectionSource,
      );
    }

    router.push(buildBookingUrl(`/${locale}/book/${nextStep}`, {
      salonSlug,
      baseServiceId: baseServiceIdValue,
      selectedAddOns: selectedAddOnsValue,
      techId: effectiveContinueTechnicianId,
      originalAppointmentId,
      manageToken,
      campaignToken,
      locationId: selectedLocationId,
    }, {
      routeSalonSlug,
      locale,
    }));
  };

  const handleBack = () => {
    const prevStep = getPrevStep('service', bookingFlow);
    if (prevStep) {
      router.push(buildBookingUrl(`/${locale}/book/${prevStep}`, {
        salonSlug,
        baseServiceId: selectedBaseServiceId,
        selectedAddOns: selectedAddOnsState,
        originalAppointmentId,
        manageToken,
        campaignToken,
        locationId: selectedLocationId,
      }, {
        routeSalonSlug,
        locale,
      }));
    } else {
      router.back();
    }
  };

  const handleContinue = () => {
    if (!selectedBaseServiceId) {
      return;
    }

    triggerHaptic('confirm');

    goToNextStep(selectedBaseServiceId, selectedAddOnsState);
  };

  const handleAddOnToggle = (addOnId: string, nextQuantity?: number) => {
    if (!selectedBaseServiceId) {
      return;
    }

    const rule = selectedRules.find(item => item.addOnId === addOnId);
    const addOn = addOnsById.get(addOnId);
    if (!rule || !addOn) {
      return;
    }

    const isRequired = rule.selectionMode === 'required';
    const maxQuantity = rule.maxQuantityOverride ?? addOn.maxQuantity ?? 10;

    const existing = selectedAddOnsState.find(item => item.addOnId === addOnId);
    const existingQuantity = existing?.quantity ?? 1;
    const resolvedQuantity = nextQuantity ?? (addOn.pricingType === 'per_unit'
      ? Math.min(maxQuantity, existingQuantity + 1)
      : existing
        ? 0
        : 1);

    let nextSelected = selectedAddOnsState.filter(item => item.addOnId !== addOnId);

    if (resolvedQuantity > 0 || isRequired) {
      nextSelected = [
        ...nextSelected,
        {
          addOnId,
          quantity: addOn.pricingType === 'per_unit'
            ? Math.min(maxQuantity, Math.max(1, resolvedQuantity))
            : 1,
        },
      ];
    }

    const normalized = buildDefaultSelectedAddOns(selectedBaseServiceId, serviceAddOnRules, addOns, nextSelected)
      .sort((a, b) => {
        const orderA = selectedRules.find(ruleItem => ruleItem.addOnId === a.addOnId)?.displayOrder ?? 0;
        const orderB = selectedRules.find(ruleItem => ruleItem.addOnId === b.addOnId)?.displayOrder ?? 0;
        return orderA - orderB;
      });

    hasUserChangedSelectionRef.current = true;
    hasPendingAddOnAnnouncementRef.current = true;
    setSelectedAddOnsState(normalized);
    setSelectedAddOns(normalized);
    triggerHaptic('select');
  };

  return (
    <main
      className="service-page-viewport"
      style={{
        background: hasBookingBrandColor
          ? `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background})`
          : `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <span
        data-testid="service-addon-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {addOnAnnouncement}
      </span>
      <div
        className={
          // Rev 3 plan section 6 (PR 6): Editorial's front-of-page content
          // (hero, signature services, about, visit, policies) gets a real
          // desktop-width column at the `lg` breakpoint instead of staying
          // pinned to Quick Book's mobile column — the shared `serviceMenu`
          // engine block re-narrows itself back to `max-w-[430px]` inside
          // this wider shell (see the `serviceMenu.list` variant below),
          // since that booking engine is explicitly out of scope for this
          // PR's redesign. This is presentation-plan chrome, not a second
          // conditional booking-engine body.
          sectionPresentation.pageFrame === 'editorial'
            ? 'mx-auto flex w-full max-w-[430px] flex-col px-4 pb-10 lg:max-w-5xl lg:px-10'
            : 'mx-auto flex w-full max-w-[430px] flex-col px-4 pb-10'
        }
      >
        {/*
          Stage 4 keeps one service-selection engine and gives the canonical
          renderer typed insertion slots at its existing Featured, policy,
          and social positions. The Stage 2 decision plan admits each slot;
          the Stage 4 presentation plan decides only whether that admitted
          section is in flow or hosted by this service-menu variant. The
          sticky Continue bar remains a system affordance outside owner-
          authored section pixels.
        */}
        {(() => {
          // Every presentation calls this exact search/pills/cards/add-on
          // engine. Typed slot nodes preserve legacy DOM positions without a
          // Quick Book or Editorial renderer fork.
          const renderServiceMenuContent = ({
            featuredServicesSlot,
            policiesSlot,
            socialLinksSlot,
            menuVariant,
          }: {
            featuredServicesSlot: ReactNode;
            policiesSlot: ReactNode;
            socialLinksSlot: ReactNode;
            menuVariant: 'list' | 'grouped_categories';
          }) => (
            <>
              {(shouldRenderSection(sectionPlan, 'announcement') || (
                !compactQuickBookProfileEnabled && shouldRenderSection(sectionPlan, 'bookingFacts')
              )) && (
                <section
                  data-public-surfaces="announcement bookingFacts"
                  data-testid="booking-experience-intro"
                  aria-label="Booking information"
                  className="mb-4 space-y-2.5"
                >
                  {!compactQuickBookProfileEnabled
                  && shouldRenderSection(sectionPlan, 'bookingFacts')
                  && serviceQuickFacts.length > 0 && (
                    <ul
                      data-public-surface="bookingFacts"
                      data-testid="booking-quick-facts"
                      aria-label="Booking quick facts"
                      className="flex flex-wrap gap-2"
                    >
                      {serviceQuickFacts.map(fact => (
                        <li
                          key={fact.key}
                          data-testid={fact.key === 'appointment-only'
                            ? 'booking-appointment-only'
                            : `booking-quick-fact-${fact.key}`}
                          className="inline-flex min-w-0 max-w-full rounded-full border px-2.5 py-1 text-xs font-medium leading-4 text-neutral-700"
                          style={{
                            borderColor: hasBookingBrandColor
                              ? 'color-mix(in srgb, var(--booking-brand-state-border, var(--theme-primary)) 42%, transparent)'
                              : themeVars.cardBorder,
                            backgroundColor: hasBookingBrandColor
                              ? 'color-mix(in srgb, var(--booking-brand-primary) 8%, white)'
                              : themeVars.surfaceAlt,
                          }}
                        >
                          <span className="min-w-0 break-words">{fact.label}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {shouldRenderSection(sectionPlan, 'announcement') && bookingExperience.bookingMessage && (
                    <div
                      data-testid="booking-message-card"
                      className="flex items-start gap-2.5 rounded-xl border px-3 py-2.5"
                      style={{
                        borderColor: hasBookingBrandColor
                          ? 'color-mix(in srgb, var(--booking-brand-state-border, var(--theme-primary)) 34%, transparent)'
                          : `color-mix(in srgb, ${themeVars.accent} 20%, ${themeVars.cardBorder})`,
                        backgroundColor: hasBookingBrandColor
                          ? 'color-mix(in srgb, var(--booking-brand-primary) 6%, white)'
                          : `color-mix(in srgb, white 92%, ${themeVars.accent})`,
                      }}
                    >
                      <Info
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0"
                        style={{
                          color: hasBookingBrandColor
                            ? 'var(--booking-brand-state-border, var(--theme-primary))'
                            : themeVars.primaryDark,
                        }}
                      />
                      <p
                        data-testid="booking-message"
                        className="whitespace-pre-line break-words text-sm leading-5 text-neutral-700"
                      >
                        {bookingExperience.bookingMessage}
                      </p>
                    </div>
                  )}
                </section>
              )}

              {campaignUnavailable && (
                <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  This promotion link is no longer available. You can still book at the regular price.
                </div>
              )}

              <div
                data-public-surface="serviceSelectionControls"
                ref={searchCardRef}
                className="mb-4 scroll-mt-3"
                style={{
                  opacity: previewContentReady ? 1 : 0,
                  transform: previewContentReady ? 'translateY(0)' : 'translateY(10px)',
                  transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
                }}
              >
                <Card className="flex items-center px-4 py-0.5 shadow-sm">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-3 text-neutral-400">
                    <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
                    <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <Input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onFocus={handleSearchFocus}
                    placeholder="Search services..."
                    className="h-11 flex-1 border-0 bg-transparent p-0 text-base text-neutral-800 shadow-none focus-visible:ring-0"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                      className="ml-2 flex size-11 shrink-0 items-center justify-center rounded-full bg-neutral-100 transition-colors hover:bg-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                </Card>
              </div>

              {showLocationFallbackToast && (
                <div
                  className="mb-4 flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3"
                  style={{
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    borderColor: '#fbbf24',
                    opacity: previewContentReady ? 1 : 0,
                    transform: previewContentReady ? 'translateY(0)' : 'translateY(10px)',
                    transition: 'opacity 300ms ease-out 110ms, transform 300ms ease-out 110ms',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-amber-600">⚠️</span>
                    <span className="text-sm text-amber-800">
                      Location not found, defaulted to
                      {' '}
                      {primaryLocation?.name || 'primary location'}
                      .
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowLocationFallbackToast(false)}
                    className="ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-amber-600 hover:text-amber-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    aria-label="Dismiss"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              )}

              {showLocationPicker && (
                <div
                  className="mb-4"
                  style={{
                    opacity: previewContentReady ? 1 : 0,
                    transform: previewContentReady ? 'translateY(0)' : 'translateY(10px)',
                    transition: 'opacity 300ms ease-out 120ms, transform 300ms ease-out 120ms',
                  }}
                >
                  <div className="mb-2 text-center text-sm font-medium text-neutral-600">
                    📍 Choose a location
                  </div>
                  <div className="flex flex-col gap-2">
                    {locations.map((location) => {
                      const isSelected = selectedLocationId === location.id;
                      return (
                        <button
                          key={location.id}
                          type="button"
                          onClick={() => {
                            if (selectedLocationId !== location.id) {
                              hasUserChangedSelectionRef.current = true;
                              setSelectedLocationId(location.id);
                              triggerHaptic('select');
                            }
                          }}
                          className="relative overflow-hidden rounded-xl p-3 text-left transition-all duration-200"
                          style={{
                            backgroundColor: isSelected
                              ? hasBookingBrandColor
                                ? 'var(--booking-brand-selection-background, white)'
                                : `color-mix(in srgb, ${themeVars.primary} 15%, white)`
                              : 'white',
                            borderWidth: '1px',
                            borderStyle: 'solid',
                            borderColor: isSelected
                              ? hasBookingBrandColor
                                ? 'var(--booking-brand-state-border, var(--theme-primary))'
                                : themeVars.primary
                              : themeVars.cardBorder,
                            boxShadow: isSelected ? '0 4px 12px rgba(0,0,0,0.08)' : '0 2px 8px rgba(0,0,0,0.04)',
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-neutral-900">{location.name}</span>
                                {location.isPrimary && (
                                  <span
                                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                                    style={{ backgroundColor: `color-mix(in srgb, ${themeVars.accent} 15%, white)`, color: themeVars.accent }}
                                  >
                                    Primary
                                  </span>
                                )}
                              </div>
                              {location.address && (
                                <div className="mt-0.5 text-sm text-neutral-500">
                                  {location.address}
                                  {location.city && `, ${location.city}`}
                                  {location.state && ` ${location.state}`}
                                </div>
                              )}
                            </div>
                            <div
                              className="flex size-6 shrink-0 items-center justify-center rounded-full transition-all"
                              style={{
                                backgroundColor: isSelected
                                  ? hasBookingBrandColor
                                    ? 'var(--booking-brand-primary)'
                                    : themeVars.primary
                                  : 'transparent',
                                borderWidth: isSelected ? 0 : '2px',
                                borderStyle: 'solid',
                                borderColor: isSelected ? 'transparent' : '#d4d4d4',
                                color: isSelected ? bookingBrandForeground : undefined,
                              }}
                            >
                              {isSelected && (
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  className={hasBookingBrandColor ? undefined : 'text-white'}
                                >
                                  <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedService && shouldPreviewAutoSkipTech && soleCompatiblePreviewTechnician && (
                <div
                  data-testid="service-auto-technician-preview"
                  className="mb-4 flex items-center gap-3 rounded-full border bg-white/90 px-3 py-2 shadow-[0_4px_18px_rgba(0,0,0,0.05)] backdrop-blur-sm"
                  style={{
                    borderColor: hasBookingBrandColor
                      ? 'var(--booking-brand-state-border, var(--theme-card-border))'
                      : `color-mix(in srgb, ${themeVars.primary} 20%, ${themeVars.cardBorder})`,
                    opacity: previewContentReady ? 1 : 0,
                    transform: previewContentReady ? 'translateY(0)' : 'translateY(10px)',
                    transition: 'opacity 300ms ease-out 130ms, transform 300ms ease-out 130ms',
                  }}
                >
                  <TechnicianAvatar
                    name={soleCompatiblePreviewTechnician.name}
                    imageUrl={soleCompatiblePreviewTechnician.imageUrl}
                    className="size-10 shrink-0"
                    sizes="40px"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                      Your artist
                    </div>
                    <div className="truncate text-sm font-semibold text-neutral-900">
                      {soleCompatiblePreviewTechnician.name}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-neutral-500">
                    {soleCompatiblePreviewRating?.kind === 'rated'
                      ? (
                          <>
                            <div className="font-semibold text-neutral-800">
                              {soleCompatiblePreviewRating.ratingText}
                              {' '}
                              ★
                            </div>
                            <div>
                              {soleCompatiblePreviewRating.reviewCountText}
                              {' '}
                              reviews
                            </div>
                          </>
                        )
                      : 'New artist'}
                  </div>
                </div>
              )}

              {services.length === 0
                ? (
                    <StateCard
                      className="shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
                      contentClassName="py-8"
                      icon="🗓️"
                      title="Online booking is not ready yet"
                      description={(
                        <>
                          This salon does not have any active services available to book right now.
                          {' '}
                          Please contact the salon directly to make an appointment.
                        </>
                      )}
                    />
                  )
                : (
                    <>
                      {featuredServicesSlot}

                      {/* Category chips are useless during a search (results already span
                    every category), so they collapse too — only results remain. */}
                      {menuVariant === 'list' && !isSearching && (
                        <div
                          className="scrollbar-hide -mx-4 mb-5 w-[calc(100%+2rem)] overflow-x-auto overflow-y-hidden px-4 md:mx-0 md:w-full md:overflow-visible md:px-0"
                          style={{
                            opacity: previewContentReady ? 1 : 0,
                            transition: 'opacity 300ms ease-out 150ms',
                          }}
                          data-testid="service-category-scroll"
                        >
                          <div
                            className="flex min-w-max flex-nowrap gap-1.5 md:min-w-0 md:flex-wrap md:justify-center md:gap-2"
                            data-testid="service-category-track"
                          >
                            {BOOKING_CATEGORIES.map((category) => {
                              const active = category === selectedCategory;
                              const meta = BOOKING_CATEGORY_META[category];
                              return (
                                <button
                                  key={category}
                                  type="button"
                                  disabled={!isHydrated}
                                  aria-pressed={active}
                                  onClick={() => {
                                    if (category !== selectedCategory) {
                                      setSelectedCategory(category);
                                      triggerHaptic('select');
                                    }
                                  }}
                                  className={`flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2.5 text-sm font-semibold transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none md:gap-2 md:px-5 ${
                                    active && hasBookingBrandColor
                                      ? 'bg-[var(--booking-brand-primary)] text-[var(--booking-brand-foreground)]'
                                      : ''
                                  }`}
                                  style={{
                                    backgroundColor: active
                                      ? hasBookingBrandColor
                                        ? 'var(--booking-brand-primary)'
                                        : themeVars.accent
                                      : 'white',
                                    color: active
                                      ? bookingBrandForeground ?? 'white'
                                      : '#525252',
                                    borderWidth: active
                                      ? hasBookingBrandColor
                                        ? '2px'
                                        : 0
                                      : '1px',
                                    borderStyle: 'solid',
                                    borderColor: active
                                      ? hasBookingBrandColor
                                        ? 'var(--booking-brand-state-border)'
                                        : 'transparent'
                                      : themeVars.cardBorder,
                                    boxShadow: active ? '0 4px 6px -1px rgb(0 0 0 / 0.1)' : undefined,
                                  }}
                                >
                                  <span className="shrink-0">{meta.icon}</span>
                                  <span className="shrink-0 whitespace-nowrap">{meta.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div
                        className="space-y-4"
                        data-testid={menuVariant === 'grouped_categories'
                          ? 'service-menu-grouped-categories'
                          : 'service-menu-list'}
                      >
                        {menuVariant === 'grouped_categories' && (
                          <h2 className="text-base font-semibold text-neutral-900">
                            Services
                          </h2>
                        )}
                        {menuVariant === 'list' && !isSearching && filteredServices.length === 0 && (
                          <div
                            data-testid="service-category-empty"
                            className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-neutral-500"
                            style={{ borderColor: themeVars.cardBorder }}
                          >
                            No
                            {' '}
                            {selectedCategory}
                            {' '}
                            services available yet.
                          </div>
                        )}
                        {isSearching && filteredServices.length === 0 && (
                          <div
                            data-testid="service-search-empty"
                            className="rounded-2xl border border-dashed px-4 py-8 text-center"
                            style={{ borderColor: themeVars.cardBorder }}
                          >
                            <div className="text-sm font-semibold text-neutral-700">
                              No services found
                            </div>
                            <div className="mt-1 text-[13px] text-neutral-500">
                              Try a different name, or clear the search to browse the full menu.
                            </div>
                          </div>
                        )}
                        {(menuVariant === 'grouped_categories'
                          ? groupedServiceRows
                          : [{ category: null, rows: serviceRows }]).map((group, groupIndex) => {
                          const groupHeadingId = group.category
                            ? `service-category-heading-${group.category}`
                            : undefined;

                          return (
                            <div
                              key={group.category ?? 'selected-category'}
                              role={group.category ? 'group' : undefined}
                              aria-labelledby={groupHeadingId}
                              data-testid={group.category
                                ? `service-category-group-${group.category}`
                                : undefined}
                              className="space-y-3"
                            >
                              {group.category && (
                                <h3
                                  id={groupHeadingId}
                                  className="flex items-center gap-2 text-sm font-semibold text-neutral-800"
                                >
                                  <span aria-hidden="true">{BOOKING_CATEGORY_META[group.category].icon}</span>
                                  <span>{BOOKING_CATEGORY_META[group.category].label}</span>
                                </h3>
                              )}
                              <div className="space-y-2">
                                {group.rows.map((row, rowIndex) => {
                                  const rowContainsSelectedService = row.some(service => service.id === selectedBaseServiceId);

                                  return (
                                    <div key={`service-row-${row.map(service => service.id).join('-')}`} className="space-y-2">
                                      <div className="grid grid-cols-2 gap-3">
                                        {row.map((service, serviceIndex) => {
                                          const isSelected = selectedBaseServiceId === service.id;
                                          const previewDescription = service.descriptionItems[0] ?? service.description ?? 'Bookable base service';
                                          const animationIndex = groupIndex * 2 + rowIndex * 2 + serviceIndex;

                                          return (
                                            <button
                                              key={service.id}
                                              type="button"
                                              disabled={!isHydrated}
                                              onClick={() => handleServiceSelection(service)}
                                              data-testid={`service-card-${service.id}`}
                                              data-selected={isSelected ? 'true' : 'false'}
                                              aria-pressed={isSelected}
                                              className={`relative flex h-full flex-col overflow-hidden rounded-2xl text-left transition-all duration-200 ${
                                                service.bookingCategory === 'combo' ? 'col-span-full' : ''
                                              }`}
                                              style={{
                                                transform: previewContentReady ? 'translateY(0)' : 'translateY(15px)',
                                                opacity: previewContentReady ? 1 : 0,
                                                background: isSelected
                                                  ? hasBookingBrandColor
                                                    ? 'var(--booking-brand-selection-background, #fdf8f1)'
                                                    : '#fdf8f1'
                                                  : 'white',
                                                boxShadow: isSelected
                                                  ? '0 10px 22px rgba(0,0,0,0.08)'
                                                  : '0 4px 20px rgba(0,0,0,0.06)',
                                                borderWidth: '1px',
                                                borderStyle: 'solid',
                                                borderColor: isSelected
                                                  ? hasBookingBrandColor
                                                    ? 'var(--booking-brand-state-border, var(--theme-primary))'
                                                    : themeVars.primary
                                                  : themeVars.cardBorder,
                                                transition: `opacity 300ms ease-out ${200 + animationIndex * 50}ms, transform 300ms ease-out ${200 + animationIndex * 50}ms, box-shadow 200ms ease-out, border-color 200ms ease-out`,
                                              }}
                                            >
                                              {showServiceImages && (
                                                <div
                                                  data-testid={`service-card-image-${service.id}`}
                                                  className={`relative overflow-hidden ${service.bookingCategory === 'combo' ? 'h-[96px]' : 'h-[68px]'}`}
                                                  style={{
                                                    background: hasBookingBrandColor
                                                      ? `linear-gradient(to bottom right, ${themeVars.background}, ${themeVars.selectedBackground})`
                                                      : `linear-gradient(to bottom right, color-mix(in srgb, ${themeVars.background} 80%, ${themeVars.primaryDark}), color-mix(in srgb, ${themeVars.selectedBackground} 90%, ${themeVars.primaryDark}))`,
                                                  }}
                                                >
                                                  <ServiceCardImage
                                                    src={service.imageUrl}
                                                    alt={`${service.name} nail service`}
                                                    imageTestId={`service-card-image-element-${service.id}`}
                                                    placeholderTestId={`service-card-image-placeholder-${service.id}`}
                                                    className={`object-cover transition-transform duration-300 ${isSelected ? 'scale-105' : ''}`}
                                                  />
                                                  {service.resolvedIntroPriceLabel && (
                                                    <div
                                                      data-testid={`service-card-intro-badge-${service.id}`}
                                                      className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-800 shadow-sm"
                                                    >
                                                      {service.resolvedIntroPriceLabel}
                                                    </div>
                                                  )}
                                                </div>
                                              )}

                                              <div
                                                data-testid={`service-card-content-${service.id}`}
                                                className={`flex flex-1 flex-col ${service.bookingCategory === 'combo' ? 'p-2.5' : 'min-h-[104px] p-2.5'}`}
                                              >
                                                {!showServiceImages && service.resolvedIntroPriceLabel && (
                                                  <div
                                                    data-testid={`service-card-intro-badge-${service.id}`}
                                                    className="mb-1 w-fit max-w-full whitespace-normal break-words rounded-full bg-neutral-100 px-2 py-1 text-[10px] font-semibold uppercase leading-tight tracking-[0.08em] text-neutral-800"
                                                  >
                                                    {service.resolvedIntroPriceLabel}
                                                  </div>
                                                )}
                                                <div className="break-words text-[14px] font-bold leading-tight text-neutral-900">
                                                  {service.name}
                                                </div>
                                                <div className="mt-0.5 line-clamp-2 text-[10px] leading-[1.35] text-neutral-500">
                                                  {previewDescription}
                                                </div>
                                                {isSelected && hasVisibleAddOns && (
                                                  <div
                                                    data-testid={`service-card-addon-cue-${service.id}`}
                                                    className="mt-1 inline-flex items-center text-[8px] font-medium tracking-[0.01em]"
                                                    style={{
                                                      color: hasBookingBrandColor
                                                        ? '#525252'
                                                        : `color-mix(in srgb, ${themeVars.primaryDark} 62%, #9b7a35)`,
                                                    }}
                                                  >
                                                    Add-ons available
                                                  </div>
                                                )}
                                                <div
                                                  data-testid={`service-card-meta-row-${service.id}`}
                                                  className="mt-auto flex items-end justify-between gap-3 pt-2.5"
                                                >
                                                  <span className="text-[11px] leading-none text-neutral-500">
                                                    {formatDuration(service.durationMinutes)}
                                                  </span>
                                                  <span
                                                    data-testid={`service-card-price-${service.id}`}
                                                    className="shrink-0 text-right text-lg font-bold leading-none"
                                                    style={{ color: themeVars.accent }}
                                                  >
                                                    {service.priceDisplayText || formatMoney(service.priceCents, currency)}
                                                  </span>
                                                </div>
                                              </div>
                                            </button>
                                          );
                                        })}
                                      </div>

                                      {rowContainsSelectedService && hasVisibleAddOns && selectedService && (
                                        <div
                                          data-testid="service-inline-addons-panel"
                                          className="w-full rounded-[24px] bg-white px-3.5 py-3 shadow-[0_8px_22px_rgba(0,0,0,0.04)] sm:px-4 sm:py-3.5"
                                          style={{
                                            borderWidth: '1px',
                                            borderStyle: 'solid',
                                            borderColor: themeVars.cardBorder,
                                          }}
                                        >
                                          <div className="mb-2">
                                            <div className="text-[15px] font-semibold text-neutral-900">
                                              Customize your service
                                            </div>
                                            <div className="mt-0.5 text-[11px] leading-4 text-neutral-500">
                                              {addOnCompositionLabel}
                                              {' '}
                                              for
                                              {' '}
                                              {selectedService.name}
                                            </div>
                                          </div>

                                          <div className="space-y-1.5">
                                            {allowedAddOns.map((item) => {
                                              if (!item) {
                                                return null;
                                              }

                                              const { addOn, rule, quantity } = item;
                                              const isSelected = quantity > 0;
                                              const isRequired = rule.selectionMode === 'required';
                                              const maxQuantity = rule.maxQuantityOverride ?? addOn.maxQuantity ?? 10;
                                              const lineTotalCents = addOn.priceCents * Math.max(quantity, 1);
                                              const lineDurationMinutes = addOn.durationMinutes * Math.max(quantity, 1);

                                              return (
                                                <div
                                                  key={addOn.id}
                                                  data-testid={`service-addon-row-${addOn.id}`}
                                                  className="rounded-[18px] border px-3 py-2 sm:px-3.5 sm:py-2.5"
                                                  style={{
                                                    borderColor: isSelected
                                                      ? hasBookingBrandColor
                                                        ? 'var(--booking-brand-state-border, var(--theme-primary))'
                                                        : themeVars.primary
                                                      : themeVars.cardBorder,
                                                    backgroundColor: isSelected
                                                      ? hasBookingBrandColor
                                                        ? 'var(--booking-brand-selection-background, white)'
                                                        : `color-mix(in srgb, ${themeVars.primary} 5%, white)`
                                                      : 'white',
                                                  }}
                                                >
                                                  <div className="flex items-center justify-between gap-2.5">
                                                    <div className="min-w-0 flex-1">
                                                      <div className="flex items-center gap-2">
                                                        <div className="text-sm font-semibold text-neutral-900">{addOn.name}</div>
                                                        {isRequired && (
                                                          <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white">
                                                            Required
                                                          </span>
                                                        )}
                                                      </div>
                                                      {addOn.descriptionItems[0] && (
                                                        <div className="mt-0.5 text-[12px] leading-4 text-neutral-500">
                                                          {addOn.descriptionItems[0]}
                                                        </div>
                                                      )}
                                                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                                                        <span>{addOn.priceDisplayText || formatMoney(addOn.priceCents, currency)}</span>
                                                        <span>{formatDuration(addOn.durationMinutes)}</span>
                                                        {isSelected && (
                                                          <span>
                                                            Selected:
                                                            {' '}
                                                            {formatMoney(lineTotalCents, currency)}
                                                            {' '}
                                                            ·
                                                            {' '}
                                                            {formatDuration(lineDurationMinutes)}
                                                          </span>
                                                        )}
                                                      </div>
                                                    </div>

                                                    {addOn.pricingType === 'per_unit'
                                                      ? (
                                                          <div className="flex items-center gap-1">
                                                            <button
                                                              type="button"
                                                              aria-label={`Decrease ${addOn.name} quantity`}
                                                              onClick={() => handleAddOnToggle(addOn.id, isRequired ? Math.max(1, quantity - 1) : Math.max(0, quantity - 1))}
                                                              disabled={isRequired ? quantity <= 1 : quantity <= 0}
                                                              className="flex size-11 items-center justify-center rounded-full border border-neutral-200 text-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                                                            >
                                                              -
                                                            </button>
                                                            <div className="min-w-6 text-center text-sm font-semibold text-neutral-900">
                                                              {quantity}
                                                            </div>
                                                            <button
                                                              type="button"
                                                              aria-label={`Increase ${addOn.name} quantity`}
                                                              onClick={() => handleAddOnToggle(addOn.id, Math.min(maxQuantity, Math.max(quantity, 0) + 1))}
                                                              disabled={quantity >= maxQuantity}
                                                              className="flex size-11 items-center justify-center rounded-full border border-neutral-200 text-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                                                            >
                                                              +
                                                            </button>
                                                          </div>
                                                        )
                                                      : (
                                                          <button
                                                            type="button"
                                                            aria-label={isRequired
                                                              ? `${addOn.name} included`
                                                              : `${isSelected ? 'Remove' : 'Add'} ${addOn.name}`}
                                                            onClick={() => handleAddOnToggle(addOn.id)}
                                                            disabled={isRequired}
                                                            className="min-h-11 min-w-11 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed motion-reduce:transition-none"
                                                            style={{
                                                              backgroundColor: isSelected || isRequired
                                                                ? hasBookingBrandColor
                                                                  ? 'var(--booking-brand-primary)'
                                                                  : themeVars.primary
                                                                : '#f5f5f5',
                                                              color: isSelected || isRequired
                                                                ? bookingBrandForeground ?? '#171717'
                                                                : '#404040',
                                                            }}
                                                          >
                                                            {isRequired ? 'Included' : isSelected ? 'Added' : 'Add'}
                                                          </button>
                                                        )}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

              {policiesSlot}

              {socialLinksSlot}

              {selectedService && (
                <div
                  data-testid="service-sticky-spacer"
                  aria-hidden="true"
                  style={{ height: STICKY_FOOTER_CLEARANCE }}
                />
              )}
            </>
          );

          const profiledTechnicians = quickBookContent.people.technicians.filter(
            technician => Boolean(technician.bio?.trim()) || Boolean(technician.avatarUrl?.trim()),
          );

          // Stage 4: one section-keyed registry with real, section-compatible
          // presentation variants. Layout identity is absent from this tree;
          // it resolves defaults/placement in `sectionPresentation` above.
          const sectionRenderers: SectionVariantRenderers = {
            salonProfile: {
              compact: () => {
                const announcement = campaignOffer
                  ? (
                      <div className="inline-flex max-w-full items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-center text-[11px] font-semibold leading-tight text-emerald-900 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
                        ✨
                        {' '}
                        {campaignOffer.name}
                        {' · '}
                        {campaignOffer.displayOffer}
                        {campaignOffer.code ? ` · ${campaignOffer.code}` : ''}
                      </div>
                    )
                  : showNewClientPromo
                    ? (
                        <div
                          className="inline-flex max-w-full items-center justify-center rounded-full border px-3 py-1.5 text-center text-[11px] font-medium leading-tight shadow-[0_4px_14px_rgba(0,0,0,0.04)]"
                          style={{
                            borderColor: `color-mix(in srgb, ${themeVars.accent} 18%, ${themeVars.cardBorder})`,
                            backgroundColor: `color-mix(in srgb, white 84%, ${themeVars.accent} 16%)`,
                            color: hasBookingBrandColor
                              ? themeVars.accent
                              : `color-mix(in srgb, ${themeVars.primaryDark} 74%, ${themeVars.accent})`,
                          }}
                        >
                          ✨ 25% off for new clients — until April 30
                        </div>
                      )
                    : undefined;

                return compactQuickBookProfileEnabled
                  ? (
                      <QuickBookProfileHeader
                        profile={resolvedQuickBookProfile}
                        mounted={previewContentReady}
                        bookingFlow={effectiveBookingFlow}
                        announcement={announcement}
                      />
                    )
                  : (
                      <BookingStepHeader
                        salonName={salonName}
                        mounted={previewContentReady}
                        salonNameVariant="editorial"
                        announcement={announcement}
                        title="Choose Your Service"
                        description="Pick your main service, then add optional extras."
                        bookingFlow={effectiveBookingFlow}
                        currentStep="service"
                        isFirstStep={isFirstStep}
                        onBack={handleBack}
                        className="-mb-1"
                      />
                    );
              },
              hero_image: () => (
                <section data-public-surface="salonProfile" data-testid="editorial-hero" className="-mx-4 -mt-4 mb-4 lg:mx-0 lg:mb-8 lg:mt-0">
                  <div className="relative aspect-[4/5] w-full overflow-hidden sm:aspect-video lg:aspect-[21/9] lg:rounded-3xl">
                    <img
                      src={quickBookContent.identity.heroImageUrl!}
                      alt={deriveSalonProfileHeroAlt(quickBookContent.identity)}
                      data-testid="editorial-hero-image"
                      className="absolute inset-0 size-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-4 pb-6 text-center text-white lg:gap-4 lg:pb-12">
                      <h1 className="text-2xl font-semibold lg:text-5xl">{salonName}</h1>
                      {quickBookContent.identity.specialtyLine && (
                        <p data-testid="editorial-specialty-line" className="text-sm text-white/90 lg:text-lg">
                          {quickBookContent.identity.specialtyLine}
                        </p>
                      )}
                      <a
                        href="#services"
                        data-testid="editorial-hero-book-cta"
                        className="inline-flex min-h-11 items-center rounded-full px-6 py-2.5 text-sm font-bold shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 lg:px-8 lg:py-3 lg:text-base"
                        style={{ background: themeVars.accent, color: '#1a1a1a' }}
                      >
                        Book appointment
                      </a>
                      <a
                        href="#services"
                        data-testid="editorial-skip-to-services"
                        className="inline-flex min-h-11 items-center text-xs font-medium text-white/80 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 lg:text-sm"
                      >
                        Skip to services ↓
                      </a>
                    </div>
                  </div>
                </section>
              ),
            },
            technicianProfile: {
              full: () => {
                return (
                  <section data-public-surface="technicianProfile" data-testid="editorial-about" className="mb-6 lg:mb-10">
                    <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500 lg:mb-4 lg:text-xs">
                      About
                    </h2>
                    <div className="space-y-4 lg:grid lg:grid-cols-2 lg:gap-x-8 lg:gap-y-6 lg:space-y-0">
                      {profiledTechnicians.map(technician => (
                        <div key={technician.id} data-testid={`editorial-technician-${technician.id}`} className="flex gap-3 lg:gap-4">
                          <TechnicianAvatar
                            name={technician.name}
                            imageUrl={technician.avatarUrl}
                            className="size-16 shrink-0 lg:size-20"
                            sizes="64px"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-neutral-900 lg:text-lg">{technician.name}</div>
                            {(technician.specialties.length > 0 || technician.languages.length > 0) && (
                              <div className="mt-0.5 text-[12px] text-neutral-500 lg:text-sm">
                                {[...technician.specialties, ...technician.languages].join(' · ')}
                              </div>
                            )}
                            {technician.bio && (
                              <p className="mt-1.5 text-sm text-neutral-700 lg:text-base">{technician.bio}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              },
              cards: () => (
                <section
                  data-public-surface="technicianProfile"
                  data-testid="technician-profile-cards"
                  className="mb-6 lg:mb-10"
                >
                  <h2 className="mb-3 text-base font-semibold text-neutral-900 lg:mb-4 lg:text-lg">
                    Meet the team
                  </h2>
                  <div role="list" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {profiledTechnicians.map(technician => (
                      <article
                        key={technician.id}
                        role="listitem"
                        data-testid={`technician-profile-card-${technician.id}`}
                        className="min-w-0 rounded-2xl border bg-white p-4 shadow-[0_4px_18px_rgba(0,0,0,0.05)]"
                        style={{ borderColor: themeVars.cardBorder }}
                      >
                        <div className="flex items-center gap-3">
                          <TechnicianAvatar
                            name={technician.name}
                            imageUrl={technician.avatarUrl}
                            className="size-14 shrink-0"
                            sizes="56px"
                          />
                          <div className="min-w-0">
                            <h3 className="break-words font-semibold text-neutral-900">
                              {technician.name}
                            </h3>
                            {(technician.specialties.length > 0 || technician.languages.length > 0) && (
                              <p className="mt-0.5 break-words text-xs text-neutral-500">
                                {[...technician.specialties, ...technician.languages].join(' · ')}
                              </p>
                            )}
                          </div>
                        </div>
                        {technician.bio && (
                          <p className="mt-3 break-words text-sm leading-5 text-neutral-700">
                            {technician.bio}
                          </p>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              ),
            },
            featuredServices: {
              carousel: () => (
                <>
                  {!isSearching && featuredServices.length > 0 && (
                    <div
                      data-public-surface="featuredServices"
                      className="scrollbar-hide -mx-4 mb-2.5 w-[calc(100%+2rem)] overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:w-full sm:overflow-visible sm:px-0"
                      style={{
                        opacity: previewContentReady ? 1 : 0,
                        transition: 'opacity 300ms ease-out 150ms',
                      }}
                      data-testid="featured-services-scroll"
                    >
                      <div className="mb-2.5">
                        <div className="mb-1 px-4 sm:px-0">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                            Featured services
                          </div>
                          <div className="mt-0.5 text-[13px] font-semibold text-neutral-900">
                            Popular premium sets and combo appointments
                          </div>
                        </div>
                        <div
                          className="scrollbar-hide -mx-4 overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:px-0"
                          role="region"
                          aria-label="Featured services"
                        >
                          <div className="flex min-w-max gap-2">
                            {featuredServices.map((service, featuredIndex) => {
                              const isSelected = selectedBaseServiceId === service.id;
                              const featuredBadgeLabel = featuredIndex === 0 && service.bookingCategory === 'combo'
                                ? 'Best value'
                                : BOOKING_CATEGORY_META[service.bookingCategory].label;
                              return (
                                <button
                                  key={`featured-${service.id}`}
                                  type="button"
                                  disabled={!isHydrated}
                                  onClick={() => handleServiceSelection(service)}
                                  data-testid={`featured-service-card-${service.id}`}
                                  aria-pressed={isSelected}
                                  aria-label={`${service.name}, ${formatDuration(service.durationMinutes)}, ${service.priceDisplayText || formatMoney(service.priceCents, currency)}`}
                                  className={`relative w-[min(272px,calc(100vw-4rem))] shrink-0 overflow-hidden rounded-2xl text-left transition-all duration-200 ${
                                    service.bookingCategory === 'combo' ? 'sm:w-[320px]' : 'sm:w-[280px]'
                                  }`}
                                  style={{
                                    background: isSelected
                                      ? hasBookingBrandColor
                                        ? 'var(--booking-brand-selection-background, white)'
                                        : `linear-gradient(to bottom right, color-mix(in srgb, ${themeVars.primary} 24%, transparent), color-mix(in srgb, ${themeVars.primaryDark} 12%, transparent))`
                                      : 'white',
                                    boxShadow: isSelected ? '0 14px 28px rgba(0,0,0,0.14)' : '0 4px 20px rgba(0,0,0,0.06)',
                                    borderWidth: '1px',
                                    borderStyle: 'solid',
                                    borderColor: isSelected
                                      ? hasBookingBrandColor
                                        ? 'var(--booking-brand-state-border, var(--theme-primary))'
                                        : themeVars.primary
                                      : themeVars.cardBorder,
                                  }}
                                >
                                  {showServiceImages && (
                                    <div
                                      data-testid={`featured-service-card-image-container-${service.id}`}
                                      className="relative h-[80px] overflow-hidden sm:h-[96px]"
                                    >
                                      <ServiceCardImage
                                        src={service.imageUrl}
                                        alt={`${service.name} nail service`}
                                        imageTestId={`featured-service-card-image-${service.id}`}
                                        className="object-cover transition-transform duration-300"
                                      />
                                      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/45 to-transparent sm:h-20" />
                                      <div
                                        data-testid={`featured-service-card-badge-${service.id}`}
                                        className="absolute left-3 top-3 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-800 shadow-sm"
                                      >
                                        {featuredBadgeLabel}
                                      </div>
                                    </div>
                                  )}
                                  <div className="p-2">
                                    {!showServiceImages && (
                                      <div
                                        data-testid={`featured-service-card-badge-${service.id}`}
                                        className="mb-1 w-fit max-w-full whitespace-normal break-words rounded-full bg-neutral-100 px-2 py-1 text-[10px] font-semibold uppercase leading-tight tracking-[0.08em] text-neutral-800"
                                      >
                                        {featuredBadgeLabel}
                                      </div>
                                    )}
                                    <div className="line-clamp-2 break-words text-[13px] font-bold leading-tight text-neutral-900 sm:text-[14px]">
                                      {service.name}
                                    </div>
                                    <div className="mt-0.5 line-clamp-1 text-[10px] leading-[1.35] text-neutral-500 sm:line-clamp-2">
                                      {service.descriptionItems[0] ?? service.description ?? 'Bookable base service'}
                                    </div>
                                    <div className="mt-0.5 flex items-center justify-between gap-3 sm:mt-1">
                                      <span className="text-[12px] text-neutral-500">
                                        {formatDuration(service.durationMinutes)}
                                      </span>
                                      <span className="text-[15px] font-bold" style={{ color: themeVars.accent }}>
                                        {service.priceDisplayText || formatMoney(service.priceCents, currency)}
                                      </span>
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ),
              signature: () => (
                <section data-public-surface="featuredServices" data-testid="editorial-featured-services" className="mb-6 lg:mb-10">
                  <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500 lg:mb-4 lg:text-xs">
                    Signature services
                  </h2>
                  <div className="scrollbar-hide -mx-4 flex min-w-max gap-2 overflow-x-auto px-4 lg:mx-0 lg:grid lg:min-w-0 lg:grid-cols-4 lg:gap-5 lg:overflow-visible lg:px-0">
                    {quickBookContent.catalog.featuredServices.map(service => (
                      <div
                        key={`editorial-featured-${service.id}`}
                        data-testid={`editorial-featured-service-${service.id}`}
                        className="w-[200px] shrink-0 overflow-hidden rounded-2xl border bg-white lg:w-auto"
                        style={{ borderColor: themeVars.cardBorder }}
                      >
                        <div className="relative h-24 lg:h-40">
                          <ServiceCardImage src={service.imageUrl} alt={`${service.name} nail service`} className="object-cover" />
                        </div>
                        <div className="p-2.5 lg:p-4">
                          <div className="line-clamp-1 text-[13px] font-semibold text-neutral-900 lg:text-sm">{service.name}</div>
                          <div className="mt-0.5 flex items-center justify-between text-[11px] text-neutral-500 lg:text-xs">
                            <span>{formatDuration(service.durationMinutes)}</span>
                            <span className="font-semibold" style={{ color: themeVars.accent }}>
                              {service.priceDisplayText || formatMoney(service.priceCents, currency)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ),
            },
            serviceMenu: {
              list: ({ renderSlot }) => {
                const serviceMenu = renderServiceMenuContent({
                  featuredServicesSlot: renderSlot('featuredServices'),
                  policiesSlot: renderSlot('policies'),
                  socialLinksSlot: renderSlot('socialLinks'),
                  menuVariant: 'list',
                });
                return sectionPresentation.serviceMenuFrame === 'services-anchor'
                  ? (
                      <div id="services" ref={servicesAnchorRef} className="scroll-mt-4 lg:mx-auto lg:w-full lg:max-w-[430px]">
                        {serviceMenu}
                      </div>
                    )
                  : serviceMenu;
              },
              grouped_categories: ({ renderSlot }) => {
                const serviceMenu = renderServiceMenuContent({
                  featuredServicesSlot: renderSlot('featuredServices'),
                  policiesSlot: renderSlot('policies'),
                  socialLinksSlot: renderSlot('socialLinks'),
                  menuVariant: 'grouped_categories',
                });
                return sectionPresentation.serviceMenuFrame === 'services-anchor'
                  ? (
                      <div id="services" ref={servicesAnchorRef} className="scroll-mt-4 lg:mx-auto lg:w-full lg:max-w-[430px]">
                        {serviceMenu}
                      </div>
                    )
                  : serviceMenu;
              },
            },
            hoursLocation: {
              full: () => {
                const { entranceInstructions } = quickBookContent.place;
                const { resolvedAddress, resolvedCity } = resolveVisitContent(quickBookContent);
                return (
                  <section data-public-surface="hoursLocation" data-testid="editorial-visit" className="mb-6 lg:mb-10 lg:max-w-2xl">
                    <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500 lg:mb-3 lg:text-xs">
                      Visit
                    </h2>
                    {(resolvedAddress || resolvedCity) && (
                      <p data-testid="editorial-visit-address" className="text-sm text-neutral-700 lg:text-base">
                        {[resolvedAddress, resolvedCity].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {entranceInstructions && (
                      <p data-testid="editorial-visit-entrance" className="mt-1 text-sm text-neutral-500 lg:text-base">
                        {entranceInstructions}
                      </p>
                    )}
                  </section>
                );
              },
              location_cards: () => {
                const { entranceInstructions, locations: canonicalLocations } = quickBookContent.place;
                const { resolvedAddress, resolvedCity } = resolveVisitContent(quickBookContent);
                const displayLocations = canonicalLocations.length > 0
                  ? canonicalLocations
                  : resolvedAddress || resolvedCity
                    ? [{
                        id: 'canonical-primary-location',
                        name: quickBookContent.identity.name,
                        address: resolvedAddress,
                        city: resolvedCity,
                        state: null,
                      }]
                    : [];

                return (
                  <section
                    data-public-surface="hoursLocation"
                    data-testid="location-cards"
                    className="mb-6 lg:mb-10"
                  >
                    <h2 className="mb-3 text-base font-semibold text-neutral-900 lg:text-lg">
                      Visit
                    </h2>
                    {displayLocations.length > 0 && (
                      <div role="list" className="grid gap-3 sm:grid-cols-2">
                        {displayLocations.map(location => (
                          <article
                            key={location.id}
                            role="listitem"
                            className="min-w-0 rounded-2xl border bg-white p-4 shadow-[0_4px_18px_rgba(0,0,0,0.05)]"
                            style={{ borderColor: themeVars.cardBorder }}
                          >
                            <h3 className="break-words font-semibold text-neutral-900">
                              {location.name}
                            </h3>
                            {(location.address || location.city || location.state) && (
                              <p className="mt-1 break-words text-sm leading-5 text-neutral-600">
                                {[location.address, location.city, location.state].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </article>
                        ))}
                      </div>
                    )}
                    {entranceInstructions && (
                      <p className="mt-3 break-words text-sm leading-5 text-neutral-600">
                        {entranceInstructions}
                      </p>
                    )}
                  </section>
                );
              },
            },
            policies: {
              card: () => (
                <section
                  data-public-surface="policies"
                  data-testid="booking-policy"
                  aria-labelledby={quickBookContent.policies.policy.title ? 'booking-policy-title' : undefined}
                  aria-label={quickBookContent.policies.policy.title ? undefined : 'Booking policy'}
                  className="mt-5 rounded-xl border px-3.5 py-3"
                  style={{
                    borderColor: hasBookingBrandColor
                      ? 'color-mix(in srgb, var(--booking-brand-state-border, var(--theme-primary)) 34%, transparent)'
                      : `color-mix(in srgb, ${themeVars.accent} 20%, ${themeVars.cardBorder})`,
                    backgroundColor: hasBookingBrandColor
                      ? 'color-mix(in srgb, var(--booking-brand-primary) 6%, white)'
                      : `color-mix(in srgb, white 92%, ${themeVars.accent})`,
                  }}
                >
                  <div className="flex items-start gap-2.5">
                    <ShieldCheck
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0"
                      style={{
                        color: hasBookingBrandColor
                          ? 'var(--booking-brand-state-border, var(--theme-primary))'
                          : themeVars.primaryDark,
                      }}
                    />
                    <div className="min-w-0">
                      {quickBookContent.policies.policy.title && (
                        <h2 id="booking-policy-title" className="mb-1 min-w-0 break-words text-sm font-semibold text-neutral-900">
                          {quickBookContent.policies.policy.title}
                        </h2>
                      )}
                      <p className="whitespace-pre-line break-words text-sm leading-5 text-neutral-700">
                        {servicePagePolicyText}
                      </p>
                    </div>
                  </div>
                </section>
              ),
              inline: () => (
                <section data-public-surface="policies" data-testid="editorial-policies" className="mb-6 lg:mb-10 lg:max-w-2xl">
                  <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500 lg:mb-3 lg:text-xs">
                    Policies
                  </h2>
                  <p className="text-sm text-neutral-700 lg:text-base">{quickBookContent.policies.policy.text}</p>
                </section>
              ),
            },
            socialLinks: {
              icons: () => (
                <nav
                  data-public-surface="socialLinks"
                  data-testid="booking-social-links"
                  aria-label="Salon social links"
                  className="mt-4 flex items-center justify-center gap-3"
                >
                  {configuredSocialLinks.map(({ key, label, Icon, href }) => (
                    <a
                      key={key}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Visit ${salonName} on ${label}`}
                      className="flex size-11 items-center justify-center rounded-full border bg-white text-neutral-800 shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                      style={{
                        'borderColor': hasBookingBrandColor
                          ? 'var(--booking-brand-state-border, var(--theme-primary))'
                          : themeVars.cardBorder,
                        '--tw-ring-color': hasBookingBrandColor
                          ? 'var(--booking-brand-state-border, var(--theme-primary))'
                          : themeVars.selectedRing,
                      } as CSSProperties}
                    >
                      <Icon className="size-5" aria-hidden="true" />
                    </a>
                  ))}
                </nav>
              ),
              labeled: () => (
                <nav
                  data-public-surface="socialLinks"
                  data-testid="booking-social-links-labeled"
                  aria-label="Salon social links"
                  className="mt-4 grid gap-2 sm:grid-cols-2"
                >
                  {configuredSocialLinks.map(({ key, label, Icon, href }) => (
                    <a
                      key={key}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Visit ${salonName} on ${label}`}
                      className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl border bg-white px-3 py-2 text-sm font-semibold text-neutral-800 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none"
                      style={{
                        'borderColor': hasBookingBrandColor
                          ? 'var(--booking-brand-state-border, var(--theme-primary))'
                          : themeVars.cardBorder,
                        '--tw-ring-color': hasBookingBrandColor
                          ? 'var(--booking-brand-state-border, var(--theme-primary))'
                          : themeVars.selectedRing,
                      } as CSSProperties}
                    >
                      <Icon className="size-5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 break-words">{label}</span>
                    </a>
                  ))}
                </nav>
              ),
            },
          };

          const reorderableSectionOrder = sectionPlan.orderedIds.filter(sectionId => (
            SECTION_REGISTRY[sectionId].ownerConfigurable
            && sectionPresentation.placements[sectionId] === 'flow'
          ));

          return (
            <>
              <SectionOrderRenderer
                plan={sectionPlan}
                presentation={sectionPresentation}
                renderers={sectionRenderers}
              />
              {isEmbeddedBuilderPreview
                ? (
                    <span
                      aria-hidden="true"
                      data-builder-reorderable-section-order={reorderableSectionOrder.join(' ')}
                      hidden
                    />
                  )
                : null}
            </>
          );
        })()}
      </div>

      {usesEditorialBookingHandoff && !selectedService && (!hasReachedServicesAnchor || isServicesAnchorUnreachable) && (
        <a
          data-public-surface="editorialStickyBookingCta"
          href="#services"
          data-testid="editorial-sticky-cta"
          className="fixed inset-x-0 bottom-0 z-[60] block border-t bg-white/90 px-4 py-3 text-center text-[15px] font-bold shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur-lg"
          style={{
            bottom: 'var(--ios-chrome-viewport-bottom, 0px)',
            paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
            color: themeVars.accent,
            borderColor: themeVars.cardBorder,
          }}
        >
          Book appointment
        </a>
      )}

      {selectedService && (
        <div
          data-public-surface="selectedServiceContinueBar"
          data-testid="service-sticky-bar"
          className="supports-[backdrop-filter]:bg-white/82 fixed inset-x-0 bottom-0 z-[60] border-t border-white/40 bg-white/85 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur-lg"
          style={{
            animation: 'slideUp 0.3s ease-out',
            bottom: 'var(--ios-chrome-viewport-bottom, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          <style jsx>
            {`
              @keyframes slideUp {
                from {
                  transform: translateY(100%);
                }
                to {
                  transform: translateY(0);
                }
              }
            `}
          </style>
          <div className="mx-auto flex max-w-[430px] flex-nowrap items-center justify-between gap-3 px-4 py-1.5 sm:py-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="truncate text-[11px] leading-none text-neutral-500">
                {selectedAddOnsState.length > 0
                  ? `1 service + ${selectedAddOnsState.length} add-on${selectedAddOnsState.length === 1 ? '' : 's'}`
                  : '1 service'}
              </div>
              {hasVisibleAddOns && (
                <div
                  data-testid="service-sticky-addon-note"
                  className="truncate text-[9px] font-medium leading-none"
                  style={{ color: themeVars.accent }}
                >
                  {addOnStickyLabel}
                </div>
              )}
              <div className="flex items-baseline gap-2 pt-0.5">
                <div className="text-[17px] font-bold leading-none text-neutral-900">
                  {totalPriceLabel}
                </div>
                <div className="text-[11px] leading-none text-neutral-500">
                  {totalDurationLabel}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleContinue}
              data-testid="service-continue-button"
              className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[14px] font-bold shadow-md transition-all hover:scale-[1.02] hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:transform-none motion-reduce:active:transform-none sm:gap-2 sm:px-5 sm:py-2.5 sm:text-[15px] ${
                hasBookingBrandColor
                  ? 'text-[var(--booking-brand-foreground)]'
                  : 'text-neutral-900'
              }`}
              style={{
                background: hasBookingBrandColor
                  ? 'var(--booking-brand-primary)'
                  : `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`,
                color: bookingBrandForeground,
              }}
            >
              Continue
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
