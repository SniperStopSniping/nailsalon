'use client';

import { useCallback, useEffect, useState } from 'react';

import type { SelectedAddOnParam } from '@/libs/bookingParams';

const BOOKING_STATE_KEY = 'booking_state';

type BookingState = {
  technicianId: string | null; // null means "any artist", empty string means not selected
  serviceIds: string[];
  baseServiceId: string | null;
  selectedAddOns: SelectedAddOnParam[];
  locationId: string | null;
};

const defaultState: BookingState = {
  technicianId: null,
  serviceIds: [],
  baseServiceId: null,
  selectedAddOns: [],
  locationId: null,
};

/**
 * Global booking state hook that persists across page reloads and navigation.
 * This is the single source of truth for booking selections.
 */
export function useBookingState() {
  const [state, setState] = useState<BookingState>(defaultState);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setIsHydrated(true);
      return;
    }

    try {
      const stored = localStorage.getItem(BOOKING_STATE_KEY);
      if (stored) {
        setState({
          ...defaultState,
          ...(JSON.parse(stored) as Partial<BookingState>),
        });
      }
    } catch {
      // Invalid stored state, use default
    } finally {
      setIsHydrated(true);
    }
  }, []);

  // Persist to localStorage whenever state changes
  useEffect(() => {
    if (typeof window === 'undefined' || !isHydrated) {
      return;
    }

    try {
      localStorage.setItem(BOOKING_STATE_KEY, JSON.stringify(state));
    } catch {
      // localStorage might be disabled or full, ignore
    }
  }, [isHydrated, state]);

  const setTechnicianId = useCallback((techId: string | null) => {
    setState(prev => ({ ...prev, technicianId: techId }));
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
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(BOOKING_STATE_KEY);
      } catch {
        // Ignore
      }
    }
  }, []);

  // Sync from URL params on mount (for deep links and reschedule flows)
  const syncFromUrl = useCallback((params: {
    techId?: string | null;
    serviceIds?: string[];
    baseServiceId?: string | null;
    selectedAddOns?: SelectedAddOnParam[];
    locationId?: string | null;
  }) => {
    setState(prev => ({
      ...prev,
      ...(params.techId !== undefined && { technicianId: params.techId || null }),
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
