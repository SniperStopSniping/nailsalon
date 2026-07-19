import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildSmartFitSuggestionContextKey,
  dismissSmartFitSuggestion,
  markSmartFitAvailabilityRefresh,
  markSmartFitOutrankedForSession,
} from '@/libs/smartFitCustomer';

import { BookTimeClient } from './BookTimeClient';

const {
  fetchMock,
  routerBack,
  routerPush,
  searchParamsState,
  syncFromUrl,
} = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  routerBack: vi.fn(),
  routerPush: vi.fn(),
  searchParamsState: { value: 'serviceIds=srv_1&techId=tech_1' },
  syncFromUrl: vi.fn(),
}));

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement('img', {
    alt: props.alt,
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: routerBack,
    push: routerPush,
  }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(searchParamsState.value),
}));

vi.mock('@/components/booking/BookingStepHeader', () => ({
  BookingStepHeader: () => <div data-testid="booking-step-header" />,
}));

vi.mock('@/components/booking/BookingSummaryCard', () => ({
  BookingSummaryCard: () => <div data-testid="booking-summary-card" />,
}));

vi.mock('@/components/booking/BookingFloatingDock', () => ({
  BookingFloatingDock: () => null,
}));

vi.mock('@/components/booking/BookingPhoneLogin', () => ({
  BookingPhoneLogin: () => null,
}));

vi.mock('@/hooks/useClientSession', () => ({
  useClientSession: () => ({
    isLoggedIn: true,
    isCheckingSession: false,
    handleLoginSuccess: vi.fn(),
  }),
}));

vi.mock('@/hooks/useBookingState', () => ({
  useBookingState: () => ({
    technicianId: 'stale_tech',
    isHydrated: true,
    syncFromUrl,
  }),
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({
    salonName: 'Salon A',
    salonSlug: 'salon-a',
  }),
}));

describe('BookTimeClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsState.value = 'serviceIds=srv_1&techId=tech_1';
    vi.useRealTimers();
    vi.setSystemTime(new Date('2026-03-14T11:00:00Z'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not loop availability fetches after the initial render settles', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      visibleSlots: ['09:00', '09:30'],
      bookedSlots: [],
    }), { status: 200 })));

    render(
      <BookTimeClient
        services={[{ id: 'srv_1', name: 'Gel', price: 65, duration: 60 }]}
        totalPrice={65}
        totalDuration={60}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    await screen.findByRole('button', { name: '9:00 AM' });

    const initialCallCount = fetchMock.mock.calls.length;

    expect(initialCallCount).toBeGreaterThan(0);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    expect(fetchMock).toHaveBeenCalledTimes(initialCallCount);
  });

  it('prefers the URL technician when fetching availability for a specific artist', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      visibleSlots: ['09:00'],
      bookedSlots: [],
    }), { status: 200 })));

    render(
      <BookTimeClient
        services={[{ id: 'srv_1', name: 'Gel', price: 65, duration: 60 }]}
        totalPrice={65}
        totalDuration={60}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    await screen.findByRole('button', { name: '9:00 AM' });

    expect(fetchMock).toHaveBeenCalled();

    const [url] = fetchMock.mock.calls[0] ?? [];

    expect(String(url)).toContain('technicianId=tech_1');
    expect(String(url)).not.toContain('technicianId=stale_tech');
  });

  it('uses the server-resolved technician when the URL has no artist', async () => {
    searchParamsState.value = 'serviceIds=srv_1';
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      visibleSlots: ['09:00'],
      bookedSlots: [],
    }), { status: 200 })));

    render(
      <BookTimeClient
        services={[{ id: 'srv_1', name: 'Russian Manicure', price: 45, duration: 60 }]}
        totalPrice={45}
        totalDuration={60}
        technician={{ id: 'tech_1', name: 'Daniela', imageUrl: null }}
        technicianSelectionSource="auto"
        bookingFlow={['service', 'time', 'confirm']}
      />,
    );

    const timeButton = await screen.findByRole('button', { name: '9:00 AM' });
    const [url] = fetchMock.mock.calls[0] ?? [];

    expect(String(url)).toContain('technicianId=tech_1');
    expect(String(url)).not.toContain('technicianId=stale_tech');

    fireEvent.click(timeButton);

    expect(routerPush).toHaveBeenCalledWith(expect.stringContaining('techId=tech_1'));
    expect(routerPush).not.toHaveBeenCalledWith(expect.stringContaining('techId=stale_tech'));
  });

  it('keeps an explicit any-artist URL authoritative', async () => {
    searchParamsState.value = 'serviceIds=srv_1&techId=any';
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      visibleSlots: ['09:00'],
      bookedSlots: [],
    }), { status: 200 })));

    render(
      <BookTimeClient
        services={[{ id: 'srv_1', name: 'Gel', price: 65, duration: 60 }]}
        totalPrice={65}
        totalDuration={60}
        technician={null}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    const timeButton = await screen.findByRole('button', { name: '9:00 AM' });
    const [url] = fetchMock.mock.calls[0] ?? [];

    expect(String(url)).not.toContain('technicianId=');

    fireEvent.click(timeButton);

    expect(routerPush).toHaveBeenCalledWith(expect.stringContaining('techId=any'));
  });

  it('shows the backend availability error instead of a fake no-slots state', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      error: {
        message: 'Technician schedule is unavailable for this day.',
      },
    }), { status: 400 })));

    render(
      <BookTimeClient
        services={[{ id: 'srv_1', name: 'Gel', price: 65, duration: 60 }]}
        totalPrice={65}
        totalDuration={60}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    expect(await screen.findByText('Availability could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('Technician schedule is unavailable for this day.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('preserves the service selection when an unsupported technician must be reselected', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: {
        kind: 'unsupported_technician',
        message: 'This service is not available with the selected technician. Please choose another technician.',
        canRetry: false,
        canReselectTechnician: true,
      },
    }), { status: 400 }));

    render(
      <BookTimeClient
        services={[{ id: 'srv_1', name: 'Builder Gel Overlay', price: 65, duration: 90 }]}
        totalPrice={65}
        totalDuration={90}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    const chooseButton = await screen.findByRole('button', { name: 'Choose another technician' });

    expect(screen.queryByText('TECHNICIAN_SERVICE_UNSUPPORTED')).not.toBeInTheDocument();

    fireEvent.click(chooseButton);

    expect(routerPush).toHaveBeenCalledWith(expect.stringContaining('/en/salon-a/book/tech'));
    expect(routerPush).toHaveBeenCalledWith(expect.stringContaining('serviceIds=srv_1'));
  });

  it('retries temporary availability failures', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: {
        kind: 'temporary_failure',
        message: 'Unable to evaluate availability for the selected day.',
        canRetry: true,
        canReselectTechnician: false,
      },
    }), { status: 500 }));

    render(
      <BookTimeClient
        services={[{ id: 'srv_1', name: 'Gel', price: 65, duration: 60 }]}
        totalPrice={65}
        totalDuration={60}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    const retryButton = await screen.findByRole('button', { name: 'Retry' });
    const callsBeforeRetry = fetchMock.mock.calls.length;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      visibleSlots: ['09:00'],
      bookedSlots: [],
    }), { status: 200 }));
    fireEvent.click(retryButton);

    expect(await screen.findByRole('button', { name: '9:00 AM' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeRetry + 1);
  });

  describe('Smart Fit presentation (P7.3)', () => {
    const SMART_FIT_ANNOTATION = {
      eligible: true,
      discountType: 'percent',
      discountValue: 10,
      discountAmountCents: 650,
      originalPriceCents: 6500,
      discountedPriceCents: 5850,
      qualifyingSides: ['before'],
      improvementMinutes: 30,
      consolidatedMinutes: 20,
    };

    const slotEntry = (time: string, smartFit: object | null = null) => ({
      time,
      startTime: `2026-03-14T${time.padStart(5, '0')}:00.000-04:00`,
      availability: 'available',
      ...(smartFit ? { smartFit } : {}),
    });

    const mockAvailability = (slots: object[], bookedSlots: string[] = []) => {
      fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
        slots,
        visibleSlots: (slots as Array<{ time: string }>).map(s => s.time),
        bookedSlots,
      }), { status: 200 })));
    };

    const renderTimeStep = () => render(
      <BookTimeClient
        services={[{ id: 'srv_1', name: 'Gel', price: 65, duration: 60 }]}
        totalPrice={65}
        totalDuration={60}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    beforeEach(() => {
      sessionStorage.clear();
    });

    it('groups qualifying slots first with badge, savings, and both prices', async () => {
      mockAvailability([
        slotEntry('9:00'),
        slotEntry('10:30', SMART_FIT_ANNOTATION),
        slotEntry('11:00'),
        slotEntry('13:30', SMART_FIT_ANNOTATION),
      ]);

      renderTimeStep();

      const section = await screen.findByRole('region', { name: 'Save with a Smart Fit' });

      expect(screen.getByText('Save with a Smart Fit')).toBeInTheDocument();
      expect(screen.getByText('Choose a time that fits neatly into the salon’s schedule and save on your appointment.')).toBeInTheDocument();
      expect(screen.getByText('Other available times')).toBeInTheDocument();

      // Both qualifying slots render inside the Smart Fit section, in order,
      // with an accessible name covering the badge, savings, and both prices.
      const smartFitButtons = within(section).getAllByRole('button');

      expect(smartFitButtons).toHaveLength(2);
      expect(smartFitButtons[0]).toHaveAccessibleName('10:30 AM — Smart Fit: save $6.50. $58.50 instead of $65.00.');
      expect(smartFitButtons[1]).toHaveAccessibleName('1:30 PM — Smart Fit: save $6.50. $58.50 instead of $65.00.');

      // Visible presentation: badge, savings line, discounted and struck price.
      expect(within(section).getAllByText('Smart Fit')).toHaveLength(2);
      expect(within(section).getAllByText('Save $6.50')).toHaveLength(2);
      expect(within(section).getAllByText('$58.50')).toHaveLength(2);
      expect(within(section).getAllByText('$65.00')).toHaveLength(2);

      // The qualifying times do not ALSO render in the regular grids.
      expect(screen.getByTestId('smart-fit-slot-10:30')).toBeInTheDocument();
      expect(screen.queryByTestId('time-slot-10:30')).not.toBeInTheDocument();
      expect(screen.queryByTestId('time-slot-13:30')).not.toBeInTheDocument();

      // Regular slots keep their normal presentation.
      expect(screen.getByTestId('time-slot-9:00')).toBeInTheDocument();
      expect(screen.getByTestId('time-slot-11:00')).toBeInTheDocument();
    });

    it('renders the legacy layout untouched when no slot qualifies', async () => {
      mockAvailability([slotEntry('9:00'), slotEntry('11:00')]);

      renderTimeStep();

      await screen.findByRole('button', { name: '9:00 AM' });

      expect(screen.queryByText('Save with a Smart Fit')).not.toBeInTheDocument();
      expect(screen.queryByText('Other available times')).not.toBeInTheDocument();
      expect(screen.queryByText(/Save \$/)).not.toBeInTheDocument();
    });

    it('navigates a Smart Fit selection with only the approved expectation params', async () => {
      mockAvailability([slotEntry('9:00'), slotEntry('10:30', SMART_FIT_ANNOTATION)]);

      renderTimeStep();

      fireEvent.click(await screen.findByTestId('smart-fit-slot-10:30'));

      expect(routerPush).toHaveBeenCalledTimes(1);

      const url = String(routerPush.mock.calls[0]?.[0]);

      expect(url).toContain('/en/salon-a/book/confirm');
      expect(url).toContain('time=10%3A30');
      expect(url).toContain('smartFitDiscountCents=650');
      expect(url).toContain('smartFitTotalCents=5850');
      // No suggestion for a slot that already qualifies, and no evaluator
      // internals ever leave the availability payload.
      expect(url).not.toContain('smartFitSuggest');
      expect(url).not.toContain('improvementMinutes');
      expect(url).not.toContain('qualifyingSides');
    });

    it('attaches the single nearest Smart Fit suggestion to a regular selection', async () => {
      mockAvailability([
        slotEntry('9:00'),
        slotEntry('10:30', SMART_FIT_ANNOTATION),
        slotEntry('11:00'),
        slotEntry('13:30', SMART_FIT_ANNOTATION),
      ]);

      renderTimeStep();

      fireEvent.click(await screen.findByTestId('time-slot-11:00'));

      const url = String(routerPush.mock.calls[0]?.[0]);

      expect(url).toContain('time=11%3A00');
      // 10:30 (30 min away) beats 13:30 (150 min away); only one suggestion.
      expect(url).toContain('smartFitSuggestTime=10%3A30');
      expect(url).toContain('smartFitSuggestDiscountCents=650');
      expect(url).toContain('smartFitSuggestTotalCents=5850');
      expect(url).not.toContain('smartFitSuggestTime=13%3A30');
      // The selected regular slot itself carries no expectation params.
      expect(url).not.toContain('smartFitDiscountCents');
      expect(url).not.toContain('smartFitTotalCents=');
    });

    it('honours a standing dismissal for the same booking context', async () => {
      // The component auto-advances an empty "today" to tomorrow before the
      // first availability response lands, so the effective date is the 15th.
      dismissSmartFitSuggestion(buildSmartFitSuggestionContextKey({
        salonSlug: 'salon-a',
        dateKey: '2026-03-15',
        techId: 'tech_1',
        locationId: null,
        baseServiceId: null,
        serviceIds: ['srv_1'],
        selectedAddOns: [],
      }));
      mockAvailability([slotEntry('10:30', SMART_FIT_ANNOTATION), slotEntry('11:00')]);

      renderTimeStep();

      fireEvent.click(await screen.findByTestId('time-slot-11:00'));

      const url = String(routerPush.mock.calls[0]?.[0]);

      expect(url).toContain('time=11%3A00');
      expect(url).not.toContain('smartFitSuggest');
      // The section itself never hides on dismissal.
      expect(screen.getByText('Save with a Smart Fit')).toBeInTheDocument();
    });

    it('regroups when the selected date changes', async () => {
      // The 16th has no qualifying slots; every other day does.
      fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        const slots = url.includes('date=2026-03-16')
          ? [slotEntry('9:00'), slotEntry('11:00')]
          : [slotEntry('9:00'), slotEntry('10:30', SMART_FIT_ANNOTATION)];
        return Promise.resolve(new Response(JSON.stringify({
          slots,
          visibleSlots: (slots as Array<{ time: string }>).map(s => s.time),
          bookedSlots: [],
        }), { status: 200 }));
      });

      renderTimeStep();

      expect(await screen.findByText('Save with a Smart Fit')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('calendar-day-2026-03-16'));

      await waitFor(() => {
        expect(screen.queryByText('Save with a Smart Fit')).not.toBeInTheDocument();
      });

      expect(await screen.findByRole('button', { name: '9:00 AM' })).toBeInTheDocument();
    });

    it('suppresses Smart Fit promises once the server proved a higher-priority discount', async () => {
      markSmartFitOutrankedForSession('salon-a');
      mockAvailability([slotEntry('9:00'), slotEntry('10:30', SMART_FIT_ANNOTATION)]);

      renderTimeStep();

      await screen.findByRole('button', { name: '9:00 AM' });

      // The annotated slot renders as a plain bookable time — no un-honorable
      // savings promise, so the 409 loop cannot recur.
      expect(screen.queryByText('Save with a Smart Fit')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '10:30 AM' })).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('time-slot-10:30'));

      expect(String(routerPush.mock.calls[0]?.[0])).not.toContain('smartFit');
    });

    it('suppresses Smart Fit presentation on campaign links', async () => {
      searchParamsState.value = 'serviceIds=srv_1&techId=tech_1&campaign=campaign_token_123456789012345678901234';
      mockAvailability([slotEntry('9:00'), slotEntry('10:30', SMART_FIT_ANNOTATION)]);

      renderTimeStep();

      await screen.findByRole('button', { name: '9:00 AM' });

      expect(screen.queryByText('Save with a Smart Fit')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '10:30 AM' })).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('time-slot-10:30'));

      const url = String(routerPush.mock.calls[0]?.[0]);

      expect(url).not.toContain('smartFit');
    });

    it('moves focus to the refreshed time list after a stale Smart Fit return', async () => {
      markSmartFitAvailabilityRefresh('salon-a');
      mockAvailability([slotEntry('9:00'), slotEntry('10:30', SMART_FIT_ANNOTATION)]);

      renderTimeStep();

      const section = await screen.findByRole('region', { name: 'Save with a Smart Fit' });

      await waitFor(() => {
        expect(section).toHaveFocus();
      });

      // The one-shot flag is consumed.
      expect(sessionStorage.getItem('luster_smart_fit_refresh')).toBeNull();
    });
  });

  describe('selected-date preservation (P7.5)', () => {
    const mockSlots = () => {
      fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
        slots: [{ time: '10:00', startTime: '2026-03-20T14:00:00.000Z' }],
        visibleSlots: ['10:00'],
        bookedSlots: [],
      }), { status: 200 })));
    };

    const renderStep = () => render(
      <BookTimeClient
        services={[{ id: 'srv_1', name: 'Gel', price: 65, duration: 60 }]}
        totalPrice={65}
        totalDuration={60}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    beforeEach(() => {
      sessionStorage.clear();
    });

    it('restores a valid future date from the URL instead of resetting to today', async () => {
      searchParamsState.value = 'serviceIds=srv_1&techId=tech_1&date=2026-03-20';
      mockSlots();

      renderStep();

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });

      expect(String(fetchMock.mock.calls[0]?.[0])).toContain('date=2026-03-20');
    });

    it('ignores a past date and falls back to salon-today', async () => {
      searchParamsState.value = 'serviceIds=srv_1&techId=tech_1&date=2026-03-01';
      mockSlots();

      renderStep();

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });

      expect(String(fetchMock.mock.calls[0]?.[0])).toContain('date=2026-03-14');
    });

    it('ignores an impossible calendar date and falls back to salon-today', async () => {
      searchParamsState.value = 'serviceIds=srv_1&techId=tech_1&date=2026-02-31';
      mockSlots();

      renderStep();

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });

      expect(String(fetchMock.mock.calls[0]?.[0])).toContain('date=2026-03-14');
    });

    it('mirrors a manual date selection into the URL without navigating', async () => {
      const replaceSpy = vi.spyOn(window.history, 'replaceState');
      mockSlots();

      renderStep();

      fireEvent.click(await screen.findByTestId('calendar-day-2026-03-20'));

      await waitFor(() => {
        expect(replaceSpy).toHaveBeenCalled();
      });

      const replacedUrl = String(replaceSpy.mock.calls.at(-1)?.[2]);

      expect(replacedUrl).toContain('date=2026-03-20');
      // Existing params survive so recovery flows keep the full context.
      expect(replacedUrl).toContain('serviceIds=srv_1');
      expect(replacedUrl).toContain('techId=tech_1');
      // No router navigation happened — this is a shallow URL update.
      expect(routerPush).not.toHaveBeenCalled();
    });

    it('never auto-advances away from a restored date equal to today, even with no slots left', async () => {
      // System time 2026-03-14T11:00Z = 07:00 EDT; a 06:00 slot is already past,
      // so an unrestored "today" would auto-advance to the 15th.
      searchParamsState.value = 'serviceIds=srv_1&techId=tech_1&date=2026-03-14';
      fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
        slots: [],
        visibleSlots: [],
        bookedSlots: [],
      }), { status: 200 })));

      renderStep();

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      const dates = fetchMock.mock.calls.map(call => String(call[0]));

      expect(dates.some(url => url.includes('date=2026-03-14'))).toBe(true);
      expect(dates.some(url => url.includes('date=2026-03-15'))).toBe(false);
    });

    it('mirrors the today-auto-advance date into the URL', async () => {
      // No restored date: an empty "today" auto-advances to tomorrow, and the
      // URL must follow so recovery flows restore the date actually shown.
      const replaceSpy = vi.spyOn(window.history, 'replaceState');
      fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
        slots: [],
        visibleSlots: [],
        bookedSlots: [],
      }), { status: 200 })));

      renderStep();

      await waitFor(() => {
        const urls = fetchMock.mock.calls.map(call => String(call[0]));

        expect(urls.some(url => url.includes('date=2026-03-15'))).toBe(true);
      });

      const replacedUrl = String(replaceSpy.mock.calls.at(-1)?.[2]);

      expect(replacedUrl).toContain('date=2026-03-15');
    });

    it('keeps the restored date through the stale-Smart-Fit recovery return', async () => {
      markSmartFitAvailabilityRefresh('salon-a');
      searchParamsState.value = 'serviceIds=srv_1&techId=tech_1&date=2026-03-20';
      mockSlots();

      renderStep();

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });

      expect(String(fetchMock.mock.calls[0]?.[0])).toContain('date=2026-03-20');

      // The one-shot refresh flag is still consumed on this path.
      await waitFor(() => {
        expect(sessionStorage.getItem('luster_smart_fit_refresh')).toBeNull();
      });
    });
  });
});
