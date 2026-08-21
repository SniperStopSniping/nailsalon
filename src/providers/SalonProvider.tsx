'use client';

import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
} from 'react';

import { BOOKING_EXPERIENCE_DEFAULTS } from '@/libs/bookingExperience';
import type { BookingPageConfigSide } from '@/libs/bookingPageConfig';
import type { OwnerPreviewActorType } from '@/libs/ownerPreview';
import { EMPTY_SALON_CONTENT, type SalonContent } from '@/libs/salonContent';
import { DEFAULT_BOOKING_TIME_ZONE } from '@/libs/timeZone';
import type { SalonStatus } from '@/models/Schema';
import type { BookingExperience } from '@/types/salonPolicy';

export type SalonOwnerPreviewState = {
  isPreviewing: boolean;
  actorType: OwnerPreviewActorType;
};

const EMPTY_OWNER_PREVIEW: SalonOwnerPreviewState = {
  isPreviewing: false,
  actorType: null,
};

/**
 * Client-safe duplicate of `@/libs/bookingPageConfig`'s `createDefaultSide()`
 * output (`BOOKING_PAGE_CONFIG_SIDE_DEFAULTS`). That module (`import { db }
 * from '@/libs/DB'`, which is `import 'server-only'`) can never be imported
 * for a runtime value from this 'use client' file — only `import type` is
 * safe, same rule `BookServiceClient.tsx`'s `QUICK_BOOK_SECTION_ORDER_FALLBACK`
 * and `admin/booking-page/page.tsx`'s option lists already follow for the
 * same reason. Keep this literal in sync with `createDefaultSide()` if that
 * ever changes — nothing reads `bookingPage` off an un-provisioned context
 * yet (see the field's own doc comment below), so this is purely a safe,
 * always-renderable placeholder.
 */
const CLIENT_SAFE_BOOKING_PAGE_SIDE_DEFAULTS: BookingPageConfigSide = {
  layout: 'quick_book',
  stylePack: 'default',
  tokenOverrides: null,
  sectionOrder: ['salonProfile', 'serviceMenu', 'featuredServices', 'policies', 'socialLinks', 'bookingCta'],
  sectionVariants: {},
  hiddenSections: [],
  businessMode: 'solo',
  startMode: 'services_first',
};

// Empty values force callers to resolve tenant context explicitly.
const EMPTY_SALON = {
  id: '',
  name: '',
  slug: '',
  themeKey: '',
  status: null as SalonStatus | null,
  bookingExperience: BOOKING_EXPERIENCE_DEFAULTS,
  bookingTimeZone: DEFAULT_BOOKING_TIME_ZONE,
  // The resolved bookingPage side (draft or live — PR3 owns *which* side
  // gets resolved, not what renders from it; nothing reads this yet, the
  // section registry in PR4 is the first consumer). Defaults to the live
  // shape's defaults so an un-provisioned context never accidentally
  // implies "previewing".
  bookingPage: CLIENT_SAFE_BOOKING_PAGE_SIDE_DEFAULTS,
  ownerPreview: EMPTY_OWNER_PREVIEW,
  // Server-resolved SalonContent (Luster UI/UX plan rev 3, section 4A.A /
  // PR 4). An un-provisioned context gets the safe, always-renderable empty
  // value rather than undefined, so a consumer reading `useSalon().salonContent`
  // before a given route threads the real value never crashes.
  salonContent: EMPTY_SALON_CONTENT,
};

/**
 * Salon context value - provides tenant information to all child components
 */
export type SalonContextValue = {
  /** Unique identifier for the salon (used for multi-tenant scoping) */
  salonId: string;
  /** The display name of the current salon/organization */
  salonName: string;
  /** URL-friendly slug (used for subdomain/routing) */
  salonSlug: string;
  /** Theme key for looking up salon's visual theme */
  themeKey: string;
  /** Current salon status (active, trial, suspended, cancelled) */
  status: SalonStatus | null;
  /** Resolved public booking-page customization with safe defaults applied */
  bookingExperience: BookingExperience;
  /** Validated IANA timezone used for salon-local booking deadlines. */
  bookingTimeZone: string;
  /**
   * The resolved `bookingPage` draft/live side for this request, already
   * chosen server-side by the owner-preview gate in
   * `[locale]/[slug]/layout.tsx`: `.draft` only for an authorized owner or
   * impersonating super admin, `.live` for everyone else. Nothing renders
   * from this yet (PR4's section registry is the first consumer) — PR3's
   * job is only to make sure the correct side is already resolved by the
   * time a later PR reads it, so the security decision is never re-made.
   */
  bookingPage: BookingPageConfigSide;
  /** Owner-preview state for this request, resolved by the same gate. */
  ownerPreview: SalonOwnerPreviewState;
  /**
   * Server-resolved SalonContent (Luster UI/UX plan rev 3, section 4A.A) —
   * identity/people/catalog/place/policies/social/proof, resolved once per
   * page render and threaded down rather than refetched per section. Falls
   * back to `EMPTY_SALON_CONTENT` (always safe to render, never crashes a
   * consumer) on routes that have not wired a real value through yet.
   */
  salonContent: SalonContent;
  /** Whether the salon is accessible (true for active/trial, false for suspended/cancelled) */
  isAccessible: boolean;
};

const SalonContext = createContext<SalonContextValue>({
  salonId: EMPTY_SALON.id,
  salonName: EMPTY_SALON.name,
  salonSlug: EMPTY_SALON.slug,
  themeKey: EMPTY_SALON.themeKey,
  status: EMPTY_SALON.status,
  bookingExperience: EMPTY_SALON.bookingExperience,
  bookingTimeZone: EMPTY_SALON.bookingTimeZone,
  bookingPage: EMPTY_SALON.bookingPage,
  ownerPreview: EMPTY_SALON.ownerPreview,
  salonContent: EMPTY_SALON.salonContent,
  isAccessible: false,
});

export type SalonProviderProps = {
  children: ReactNode;
  /** Salon ID for multi-tenant data scoping */
  salonId?: string;
  /** Optional salon name override. Falls back to default if not provided. */
  salonName?: string;
  /** Salon slug for routing */
  salonSlug?: string;
  /** Theme key for visual customization */
  themeKey?: string;
  /** Current salon status */
  status?: SalonStatus | null;
  /** Resolved public booking-page customization */
  bookingExperience?: BookingExperience;
  /** Validated IANA timezone used for salon-local booking deadlines */
  bookingTimeZone?: string;
  /** The resolved bookingPage draft/live side, already gated server-side */
  bookingPage?: BookingPageConfigSide;
  /** Owner-preview state, already gated server-side */
  ownerPreview?: SalonOwnerPreviewState;
  /** Server-resolved SalonContent, already resolved once for this request */
  salonContent?: SalonContent;
};

/**
 * SalonProvider - Provides the current salon/organization context to all child components.
 *
 * For multi-tenant setups, salon data can be passed from:
 * - Server-side DB lookup in the layout
 * - URL/subdomain parsing
 * - Environment variable
 *
 * Leaves salon fields empty if tenant context has not been resolved yet.
 *
 * @example
 * // In layout.tsx (server component)
 * const salon = await getSalonBySlug('nail-salon-no5');
 * return (
 *   <SalonProvider
 *     salonId={salon.id}
 *     salonName={salon.name}
 *     salonSlug={salon.slug}
 *     themeKey={salon.themeKey}
 *   >
 *     {children}
 *   </SalonProvider>
 * );
 */
export function SalonProvider({
  children,
  salonId,
  salonName,
  salonSlug,
  themeKey,
  status,
  bookingExperience,
  bookingTimeZone,
  bookingPage,
  ownerPreview,
  salonContent,
}: SalonProviderProps) {
  const value = useMemo<SalonContextValue>(() => {
    const currentStatus = status ?? EMPTY_SALON.status;
    // Salon is accessible if status is active or trial (not suspended or cancelled)
    const isAccessible = currentStatus === 'active' || currentStatus === 'trial';

    return {
      salonId: salonId || EMPTY_SALON.id,
      salonName: salonName || EMPTY_SALON.name,
      salonSlug: salonSlug || EMPTY_SALON.slug,
      themeKey: themeKey || EMPTY_SALON.themeKey,
      status: currentStatus,
      bookingExperience: bookingExperience ?? EMPTY_SALON.bookingExperience,
      bookingTimeZone: bookingTimeZone ?? EMPTY_SALON.bookingTimeZone,
      bookingPage: bookingPage ?? EMPTY_SALON.bookingPage,
      ownerPreview: ownerPreview ?? EMPTY_SALON.ownerPreview,
      salonContent: salonContent ?? EMPTY_SALON.salonContent,
      isAccessible,
    };
  }, [bookingExperience, bookingPage, bookingTimeZone, ownerPreview, salonContent, salonId, salonName, salonSlug, themeKey, status]);

  return (
    <SalonContext.Provider value={value}>{children}</SalonContext.Provider>
  );
}

/**
 * useSalon - Hook to access the current salon context.
 *
 * @returns {SalonContextValue} The salon context with all tenant information.
 *
 * @example
 * const { salonId, salonName, salonSlug, themeKey, status, isAccessible } = useSalon();
 *
 * // Use salonId for data fetching
 * const services = await getServicesBySalonId(salonId);
 *
 * // Check if salon is accessible before allowing actions
 * if (!isAccessible) {
 *   return <SuspendedMessage />;
 * }
 *
 * // Use salonName for display
 * return <h1>{salonName}</h1>;
 */
export function useSalon(): SalonContextValue {
  return useContext(SalonContext);
}
