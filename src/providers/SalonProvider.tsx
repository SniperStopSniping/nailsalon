'use client';

import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
} from 'react';

import type { SalonStatus } from '@/models/Schema';

// Empty values force callers to resolve tenant context explicitly.
const EMPTY_SALON = {
  id: '',
  name: '',
  slug: '',
  themeKey: '',
  status: null as SalonStatus | null,
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
  /** Whether the salon is accessible (true for active/trial, false for suspended/cancelled) */
  isAccessible: boolean;
};

const SalonContext = createContext<SalonContextValue>({
  salonId: EMPTY_SALON.id,
  salonName: EMPTY_SALON.name,
  salonSlug: EMPTY_SALON.slug,
  themeKey: EMPTY_SALON.themeKey,
  status: EMPTY_SALON.status,
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
      isAccessible,
    };
  }, [salonId, salonName, salonSlug, themeKey, status]);

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
