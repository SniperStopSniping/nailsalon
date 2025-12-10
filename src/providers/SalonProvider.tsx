'use client';

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';

import type { SalonStatus } from '@/models/Schema';

// Default values for development when no salon is fetched
const DEFAULT_SALON = {
  id: 'salon_nail-salon-no5',
  name: 'Nail Salon No.5',
  slug: 'nail-salon-no5',
  themeKey: 'nail-salon-no5',
  status: 'active' as SalonStatus,
};

/**
 * Salon context value - provides tenant information to all child components
 */
export interface SalonContextValue {
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
}

const SalonContext = createContext<SalonContextValue>({
  salonId: DEFAULT_SALON.id,
  salonName: DEFAULT_SALON.name,
  salonSlug: DEFAULT_SALON.slug,
  themeKey: DEFAULT_SALON.themeKey,
  status: DEFAULT_SALON.status,
  isAccessible: true,
});

export interface SalonProviderProps {
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
}

/**
 * SalonProvider - Provides the current salon/organization context to all child components.
 *
 * For multi-tenant setups, salon data can be passed from:
 * - Server-side DB lookup in the layout
 * - URL/subdomain parsing
 * - Environment variable
 *
 * Falls back to DEFAULT_SALON values if not provided.
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
    const currentStatus = status ?? DEFAULT_SALON.status;
    // Salon is accessible if status is active or trial (not suspended or cancelled)
    const isAccessible = currentStatus === 'active' || currentStatus === 'trial';
    
    return {
      salonId: salonId || DEFAULT_SALON.id,
      salonName: salonName || DEFAULT_SALON.name,
      salonSlug: salonSlug || DEFAULT_SALON.slug,
      themeKey: themeKey || DEFAULT_SALON.themeKey,
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
