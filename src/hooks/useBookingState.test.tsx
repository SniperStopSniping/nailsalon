import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBookingState } from './useBookingState';

describe('useBookingState', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('uses default state during server render and hydrates persisted state after mount', async () => {
    window.localStorage.setItem('booking_state:v2:salon-a', JSON.stringify({
      technicianId: 'tech-1',
      technicianSelectionSource: 'explicit',
      serviceIds: ['svc-1'],
      baseServiceId: 'svc-1',
      selectedAddOns: [{ addOnId: 'addon-1' }],
      locationId: 'loc-1',
    }));

    const ServerRenderProbe = () => {
      const bookingState = useBookingState('salon-a');
      return (
        <div
          data-base-service-id={bookingState.baseServiceId ?? 'none'}
          data-location-id={bookingState.locationId ?? 'none'}
          data-selected-add-on-count={bookingState.selectedAddOns.length}
        />
      );
    };

    const { renderToString } = await vi.importActual<{
      renderToString: (element: ReactElement) => string;
    }>('react-dom/server');
    const serverMarkup = renderToString(<ServerRenderProbe />);

    expect(serverMarkup).toContain('data-base-service-id="none"');
    expect(serverMarkup).toContain('data-location-id="none"');
    expect(serverMarkup).toContain('data-selected-add-on-count="0"');

    const { result } = renderHook(() => useBookingState('salon-a'));

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
    window.localStorage.setItem('booking_state:v2:salon-a', JSON.stringify(storedState));

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useBookingState('salon-a'));

    expect(setItemSpy).not.toHaveBeenCalledWith('booking_state:v2:salon-a', JSON.stringify({
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

    expect(window.localStorage.getItem('booking_state:v2:salon-a')).toBe(JSON.stringify(storedState));

    act(() => {
      result.current.setBaseServiceId('svc-3');
    });

    await waitFor(() => {
      expect(window.localStorage.getItem('booking_state:v2:salon-a')).toContain('"baseServiceId":"svc-3"');
    });
  });

  it('does not hydrate another salon or the unsafe legacy booking key', async () => {
    window.localStorage.setItem('booking_state', JSON.stringify({
      technicianId: 'legacy-other-salon-tech',
      serviceIds: ['legacy-service'],
    }));
    window.localStorage.setItem('booking_state:v2:salon-a', JSON.stringify({
      technicianId: 'salon-a-tech',
      serviceIds: ['salon-a-service'],
    }));

    const { result } = renderHook(() => useBookingState('salon-b'));

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
    });

    expect(result.current.technicianId).toBeNull();
    expect(result.current.serviceIds).toEqual([]);
    expect(window.localStorage.getItem('booking_state:v2:salon-a')).toContain('salon-a-tech');
  });

  it('does not copy hydrated state when the active salon changes', async () => {
    window.localStorage.setItem('booking_state:v2:salon-b', JSON.stringify({
      technicianId: 'salon-b-tech',
      technicianSelectionSource: 'explicit',
      serviceIds: ['salon-b-service'],
    }));

    const { result, rerender } = renderHook(
      ({ salonSlug }) => useBookingState(salonSlug),
      { initialProps: { salonSlug: 'salon-a' } },
    );

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
    });

    act(() => {
      result.current.setTechnicianId('salon-a-tech');
      result.current.setServiceIds(['salon-a-service']);
    });

    await waitFor(() => {
      expect(window.localStorage.getItem('booking_state:v2:salon-a')).toContain('salon-a-tech');
    });

    rerender({ salonSlug: 'salon-b' });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
      expect(result.current.technicianId).toBe('salon-b-tech');
    });

    expect(result.current.serviceIds).toEqual(['salon-b-service']);
    expect(window.localStorage.getItem('booking_state:v2:salon-b')).not.toContain('salon-a-tech');
  });
});
