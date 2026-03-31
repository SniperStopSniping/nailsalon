import React from 'react';

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBookingState } from './useBookingState';

describe('useBookingState', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('uses default state during server render and hydrates persisted state after mount', async () => {
    window.localStorage.setItem('booking_state', JSON.stringify({
      technicianId: 'tech-1',
      technicianSelectionSource: 'explicit',
      serviceIds: ['svc-1'],
      baseServiceId: 'svc-1',
      selectedAddOns: [{ addOnId: 'addon-1' }],
      locationId: 'loc-1',
    }));

    const ServerRenderProbe = () => {
      const bookingState = useBookingState();
      return (
        <div
          data-base-service-id={bookingState.baseServiceId ?? 'none'}
          data-location-id={bookingState.locationId ?? 'none'}
          data-selected-add-on-count={bookingState.selectedAddOns.length}
        />
      );
    };

    const { renderToString } = require('react-dom/server') as {
      renderToString: (element: React.ReactElement) => string;
    };
    const serverMarkup = renderToString(<ServerRenderProbe />);
    expect(serverMarkup).toContain('data-base-service-id="none"');
    expect(serverMarkup).toContain('data-location-id="none"');
    expect(serverMarkup).toContain('data-selected-add-on-count="0"');

    const { result } = renderHook(() => useBookingState());

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
    });

    expect(result.current.technicianId).toBe('tech-1');
    expect(result.current.technicianSelectionSource).toBe('explicit');
    expect(result.current.serviceIds).toEqual(['svc-1']);
    expect(result.current.baseServiceId).toBe('svc-1');
    expect(result.current.selectedAddOns).toEqual([{ addOnId: 'addon-1' }]);
    expect(result.current.locationId).toBe('loc-1');
  });

  it('does not overwrite persisted booking state with defaults before hydration completes', async () => {
    const storedState = {
      technicianId: 'tech-2',
      technicianSelectionSource: 'auto',
      serviceIds: ['svc-2'],
      baseServiceId: 'svc-2',
      selectedAddOns: [{ addOnId: 'addon-2', quantity: 2 }],
      locationId: 'loc-2',
    };
    window.localStorage.setItem('booking_state', JSON.stringify(storedState));

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useBookingState());

    expect(setItemSpy).not.toHaveBeenCalledWith('booking_state', JSON.stringify({
      technicianId: null,
      technicianSelectionSource: null,
      serviceIds: [],
      baseServiceId: null,
      selectedAddOns: [],
      locationId: null,
    }));

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
    });

    expect(window.localStorage.getItem('booking_state')).toBe(JSON.stringify(storedState));

    act(() => {
      result.current.setBaseServiceId('svc-3');
    });

    await waitFor(() => {
      expect(window.localStorage.getItem('booking_state')).toContain('"baseServiceId":"svc-3"');
    });
  });
});
