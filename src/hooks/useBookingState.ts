'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SelectedAddOnParam } from '@/libs/bookingParams';

const BOOKING_STATE_KEY_PREFIX = 'booking_state:v2';

export type BookingTechnicianSelectionSource = 'explicit' | 'auto' | null;

export type AssistantBookingHandoff = {
  baseServiceId: string;
  selectedAddOns: SelectedAddOnParam[];
};

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
  const stateRef = useRef<BookingState>(defaultState);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);
  const isHydrated = storageKey === null || hydratedStorageKey === storageKey;

  useEffect(() => {
    if (typeof window === 'undefined' || !storageKey) {
      stateRef.current = defaultState;
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

    stateRef.current = nextState;
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

  const updateState = useCallback((update: (current: BookingState) => BookingState) => {
    const nextState = update(stateRef.current);
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const setTechnicianId = useCallback((
    techId: string | null,
    technicianSelectionSource: BookingTechnicianSelectionSource = techId ? 'explicit' : null,
  ) => {
    updateState(prev => ({
      ...prev,
      technicianId: techId,
      technicianSelectionSource: techId ? technicianSelectionSource : null,
    }));
  }, [updateState]);

  const setServiceIds = useCallback((serviceIds: string[]) => {
    updateState(prev => ({ ...prev, serviceIds }));
  }, [updateState]);

  const setBaseServiceId = useCallback((baseServiceId: string | null) => {
    updateState(prev => ({ ...prev, baseServiceId }));
  }, [updateState]);

  const setSelectedAddOns = useCallback((selectedAddOns: SelectedAddOnParam[]) => {
    updateState(prev => ({ ...prev, selectedAddOns }));
  }, [updateState]);

  const setLocationId = useCallback((locationId: string | null) => {
    updateState(prev => ({ ...prev, locationId }));
  }, [updateState]);

  /**
   * Accepting an assistant proposal is the only assistant action allowed to
   * change the normal booking flow. Clear a stale manual technician so the
   * normal technician/time pages revalidate it for the accepted selection.
   */
  const applyAssistantHandoff = useCallback((handoff: AssistantBookingHandoff): boolean => {
    if (typeof window === 'undefined' || !storageKey || hydratedStorageKey !== storageKey) {
      return false;
    }
    const nextState: BookingState = {
      ...stateRef.current,
      technicianId: null,
      technicianSelectionSource: null,
      serviceIds: [handoff.baseServiceId],
      baseServiceId: handoff.baseServiceId,
      selectedAddOns: handoff.selectedAddOns,
    };
    try {
      const serialized = JSON.stringify(nextState);
      localStorage.setItem(storageKey, serialized);
      if (localStorage.getItem(storageKey) !== serialized) {
        return false;
      }
    } catch {
      return false;
    }
    stateRef.current = nextState;
    setState(nextState);
    return true;
  }, [hydratedStorageKey, storageKey]);

  const clearBookingState = useCallback(() => {
    stateRef.current = defaultState;
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

    updateState(prev => ({
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
  }, [updateState]);

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
    applyAssistantHandoff,
    clearBookingState,
    syncFromUrl,
  };
}
