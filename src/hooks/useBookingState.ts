'use client';

import { useCallback, useEffect, useState } from 'react';

const BOOKING_STATE_KEY = 'booking_state';

type BookingState = {
  technicianId: string | null; // null means "any artist", empty string means not selected
  serviceIds: string[];
  locationId: string | null;
  clientPhone: string | null;
};

const defaultState: BookingState = {
  technicianId: null,
  serviceIds: [],
  locationId: null,
  clientPhone: null,
};

/**
 * Global booking state hook that persists across page reloads and navigation.
 * This is the single source of truth for booking selections.
 */
export function useBookingState() {
  const [state, setState] = useState<BookingState>(() => {
    // Initialize from localStorage on mount
    if (typeof window === 'undefined') {
      return defaultState;
    }

    try {
      const stored = localStorage.getItem(BOOKING_STATE_KEY);
      if (stored) {
        return JSON.parse(stored) as BookingState;
      }
    } catch {
      // Invalid stored state, use default
    }

    return defaultState;
  });

  // Persist to localStorage whenever state changes
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      localStorage.setItem(BOOKING_STATE_KEY, JSON.stringify(state));
    } catch {
      // localStorage might be disabled or full, ignore
    }
  }, [state]);

  const setTechnicianId = useCallback((techId: string | null) => {
    setState(prev => ({ ...prev, technicianId: techId }));
  }, []);

  const setServiceIds = useCallback((serviceIds: string[]) => {
    setState(prev => ({ ...prev, serviceIds }));
  }, []);

  const setLocationId = useCallback((locationId: string | null) => {
    setState(prev => ({ ...prev, locationId }));
  }, []);

  const setClientPhone = useCallback((phone: string | null) => {
    setState(prev => ({ ...prev, clientPhone: phone }));
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
    locationId?: string | null;
    clientPhone?: string | null;
  }) => {
    setState(prev => ({
      ...prev,
      ...(params.techId !== undefined && { technicianId: params.techId || null }),
      ...(params.serviceIds !== undefined && { serviceIds: params.serviceIds }),
      ...(params.locationId !== undefined && { locationId: params.locationId || null }),
      ...(params.clientPhone !== undefined && { clientPhone: params.clientPhone || null }),
    }));
  }, []);

  return {
    state,
    technicianId: state.technicianId,
    serviceIds: state.serviceIds,
    locationId: state.locationId,
    clientPhone: state.clientPhone,
    setTechnicianId,
    setServiceIds,
    setLocationId,
    setClientPhone,
    clearBookingState,
    syncFromUrl,
  };
}
