'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SelectedAddOnParam } from '@/libs/bookingParams';

const BOOKING_STATE_KEY_PREFIX = 'booking_state:v2';

export type BookingTechnicianSelectionSource = 'explicit' | 'auto' | null;

type BookingState = {
  technicianId: string | null; // null means "any artist", empty string means not selected
  technicianSelectionSource: BookingTechnicianSelectionSource;
  serviceIds: string[];
  baseServiceId: string | null;
  selectedAddOns: SelectedAddOnParam[];
  locationId: string | null;
};

const defaultState: BookingState = {
  technicianId: null,
  technicianSelectionSource: null,
  serviceIds: [],
  baseServiceId: null,
  selectedAddOns: [],
  locationId: null,
};

/**
 * Tenant-scoped booking state that persists across page reloads and navigation.
 * Each salon receives an isolated storage key so selections cannot leak between tenants.
 */
export function useBookingState(salonSlug: string) {
  const storageKey = useMemo(() => {
    const normalizedSalonSlug = salonSlug.trim().toLowerCase();
    return normalizedSalonSlug
      ? `${BOOKING_STATE_KEY_PREFIX}:${normalizedSalonSlug}`
      : null;
  }, [salonSlug]);
  const [state, setState] = useState<BookingState>(defaultState);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);
  const isHydrated = storageKey === null || hydratedStorageKey === storageKey;

  useEffect(() => {
    if (typeof window === 'undefined' || !storageKey) {
      setState(defaultState);
      setHydratedStorageKey(storageKey);
      return;
    }

    let nextState = defaultState;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<BookingState>;
        nextState = {
          ...defaultState,
          ...parsed,
          technicianSelectionSource: parsed.technicianSelectionSource ?? (parsed.technicianId ? 'explicit' : null),
        };
      }
    } catch {
      // Invalid stored state, use default
    }

    setState(nextState);
    setHydratedStorageKey(storageKey);
  }, [storageKey]);

  // Persist to localStorage whenever state changes
  useEffect(() => {
    if (
      typeof window === 'undefined'
      || !storageKey
      || hydratedStorageKey !== storageKey
    ) {
      return;
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // localStorage might be disabled or full, ignore
    }
  }, [hydratedStorageKey, state, storageKey]);

  const setTechnicianId = useCallback((
    techId: string | null,
    technicianSelectionSource: BookingTechnicianSelectionSource = techId ? 'explicit' : null,
  ) => {
    setState(prev => ({
      ...prev,
      technicianId: techId,
      technicianSelectionSource: techId ? technicianSelectionSource : null,
    }));
  }, []);

  const setServiceIds = useCallback((serviceIds: string[]) => {
    setState(prev => ({ ...prev, serviceIds }));
  }, []);

  const setBaseServiceId = useCallback((baseServiceId: string | null) => {
    setState(prev => ({ ...prev, baseServiceId }));
  }, []);

  const setSelectedAddOns = useCallback((selectedAddOns: SelectedAddOnParam[]) => {
    setState(prev => ({ ...prev, selectedAddOns }));
  }, []);

  const setLocationId = useCallback((locationId: string | null) => {
    setState(prev => ({ ...prev, locationId }));
  }, []);

  const clearBookingState = useCallback(() => {
    setState(defaultState);
    if (typeof window !== 'undefined' && storageKey) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // Ignore
      }
    }
  }, [storageKey]);

  // Sync from URL params on mount (for deep links and reschedule flows)
  const syncFromUrl = useCallback((params: {
    techId?: string | null;
    technicianSelectionSource?: BookingTechnicianSelectionSource;
    serviceIds?: string[];
    baseServiceId?: string | null;
    selectedAddOns?: SelectedAddOnParam[];
    locationId?: string | null;
  }) => {
    const normalizedTechId = params.techId && params.techId !== 'any'
      ? params.techId
      : null;

    setState(prev => ({
      ...prev,
      ...(params.techId !== undefined && {
        technicianId: normalizedTechId,
        technicianSelectionSource: normalizedTechId
          ? (params.technicianSelectionSource ?? 'explicit')
          : null,
      }),
      ...(params.serviceIds !== undefined && { serviceIds: params.serviceIds }),
      ...(params.baseServiceId !== undefined && { baseServiceId: params.baseServiceId || null }),
      ...(params.selectedAddOns !== undefined && { selectedAddOns: params.selectedAddOns }),
      ...(params.locationId !== undefined && { locationId: params.locationId || null }),
    }));
  }, []);

  return {
    state,
    isHydrated,
    technicianId: state.technicianId,
    technicianSelectionSource: state.technicianSelectionSource,
    serviceIds: state.serviceIds,
    baseServiceId: state.baseServiceId,
    selectedAddOns: state.selectedAddOns,
    locationId: state.locationId,
    setTechnicianId,
    setServiceIds,
    setBaseServiceId,
    setSelectedAddOns,
    setLocationId,
    clearBookingState,
    syncFromUrl,
  };
}
