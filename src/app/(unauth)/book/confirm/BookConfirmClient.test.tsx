import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BookConfirmClient } from './BookConfirmClient';

const { routerBack, routerPush, routerReplace, syncFromUrl, fetchMock, windowOpen, navigationMock, sessionMock } = vi.hoisted(() => ({
  sessionMock: {
    isLoggedIn: true,
    clientName: 'Ava' as string | null,
    clientEmail: 'ava@example.com' as string | null,
    phone: '4165550101',
  },
  routerBack: vi.fn(),
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  syncFromUrl: vi.fn(),
  fetchMock: vi.fn(),
  windowOpen: vi.fn(),
  navigationMock: {
    searchParams: new URLSearchParams('techId=tech_1'),
  },
}));

vi.mock('canvas-confetti', () => ({
  default: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: routerBack,
    push: routerPush,
    replace: routerReplace,
  }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => navigationMock.searchParams,
}));

vi.mock('@/hooks/useBookingState', () => ({
  useBookingState: () => ({
    syncFromUrl,
  }),
}));

vi.mock('@/hooks/useClientSession', () => ({
  useClientSession: () => ({
    isCheckingSession: false,
    handleLoginSuccess: vi.fn(),
    validateSession: vi.fn(),
    isLoggedIn: sessionMock.isLoggedIn,
    clientName: sessionMock.clientName,
    clientEmail: sessionMock.clientEmail,
    phone: sessionMock.phone,
  }),
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({
    salonName: 'Salon A',
    salonSlug: 'salon-a',
  }),
}));

vi.mock('framer-motion', () => {
  const makeMotionTag = (tag: string) =>
    React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ children, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children),
    );

  // Cache per tag so the component type is referentially stable across
  // renders — like the real motion.div — otherwise every re-render remounts
  // the whole subtree and DOM state (focus) is artificially lost.
  const motionTagCache = new Map<string, ReturnType<typeof makeMotionTag>>();
  const getMotionTag = (tag: string) => {
    let cached = motionTagCache.get(tag);
    if (!cached) {
      cached = makeMotionTag(tag);
      motionTagCache.set(tag, cached);
    }
    return cached;
  };

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy({}, {
      get: (_, tag: string) => getMotionTag(tag),
    }),
    useMotionValue: () => ({ set: vi.fn() }),
    useReducedMotion: () => true,
    useTransform: () => 0,
  };
});

describe('BookConfirmClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    navigationMock.searchParams = new URLSearchParams('techId=tech_1');
    vi.stubGlobal('fetch', fetchMock);
    window.open = windowOpen;
    sessionStorage.clear();
    sessionMock.isLoggedIn = true;
    sessionMock.clientName = 'Ava';
    sessionMock.clientEmail = 'ava@example.com';
    sessionMock.phone = '4165550101';
  });

  it('does not create a booking on initial page load', () => {
    render(
      <BookConfirmClient
        services={[{ id: 'srv_1', name: 'Gel Manicure', price: 65, duration: 75 }]}
        subtotalBeforeDiscount={65}
        discountAmount={0}
        totalPrice={65}
        totalDuration={75}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        salonSlug="salon-a"
        dateStr="2026-03-20"
        timeStr="10:00"
        bookingFlow={[]}
        location={null}
      />,
    );

    expect(screen.getByText('Review your appointment')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm appointment/i })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(syncFromUrl).toHaveBeenCalledWith(expect.objectContaining({ techId: 'tech_1' }));
  });

  it('routes the confirmed booking to payment methods instead of a missing payment page', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        appointment: {
          id: 'appt_123',
        },
      },
    }), { status: 200 }));

    render(
      <BookConfirmClient
        services={[{ id: 'srv_1', name: 'Gel Manicure', price: 65, duration: 75 }]}
        subtotalBeforeDiscount={65}
        discountAmount={0}
        totalPrice={65}
        totalDuration={75}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        salonSlug="salon-a"
        dateStr="2026-03-20"
        timeStr="10:00"
        bookingFlow={[]}
        location={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /how to pay/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /how to pay/i }));

    expect(routerPush).toHaveBeenCalledWith('/en/salon-a/payment-methods');
  });

  it('does not imply visit points are already in the rewards balance after booking', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        appointment: {
          id: 'appt_123',
        },
      },
    }), { status: 200 }));

    render(
      <BookConfirmClient
        services={[{ id: 'srv_1', name: 'Gel Manicure', price: 65, duration: 75 }]}
        subtotalBeforeDiscount={65}
        discountAmount={0}
        totalPrice={65}
        totalDuration={75}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        salonSlug="salon-a"
        dateStr="2026-03-20"
        timeStr="10:00"
        bookingFlow={[]}
        location={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^view rewards & pending points$/i })).toBeInTheDocument();
    });

    expect(screen.queryByText(/view rewards balance \(\+/i)).not.toBeInTheDocument();
    expect(screen.getByText(/estimated reward after completion:/i)).toBeInTheDocument();
  });

  it('opens Google Maps directions from the confirmed screen when location details exist', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        appointment: {
          id: 'appt_123',
        },
      },
    }), { status: 200 }));

    render(
      <BookConfirmClient
        services={[{ id: 'srv_1', name: 'Gel Manicure', price: 65, duration: 75 }]}
        subtotalBeforeDiscount={65}
        discountAmount={0}
        totalPrice={65}
        totalDuration={75}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        salonSlug="salon-a"
        dateStr="2026-03-20"
        timeStr="10:00"
        bookingFlow={[]}
        location={{
          id: 'loc_1',
          name: 'Queen West',
          address: '123 Queen St W',
          city: 'Toronto',
          state: 'ON',
          zipCode: 'M5H 2M9',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^directions$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^directions$/i }));

    expect(windowOpen).toHaveBeenCalledWith(
      'https://www.google.com/maps/dir/?api=1&destination=123%20Queen%20St%20W%2C%20Toronto%2C%20ON%2C%20M5H%202M9',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('shows a retention offer and submits its opaque token for server-side redemption', async () => {
    const token = 'campaign_token_123456789012345678901234';
    navigationMock.searchParams = new URLSearchParams(`techId=tech_1&campaign=${token}`);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        appointmentId: 'appt_campaign',
        manageUrl: 'https://salon-a.test/manage/safe',
        appointment: { id: 'appt_campaign' },
      },
    }), { status: 201 }));

    render(
      <BookConfirmClient
        services={[{ id: 'srv_1', name: 'Gel Manicure', price: 65, duration: 75 }]}
        subtotalBeforeDiscount={65}
        discountAmount={13}
        campaignPromotionPreview={{
          name: 'Welcome back',
          displayOffer: '20% off',
          code: 'BACK20',
          expiresAt: '2099-04-01T00:00:00.000Z',
          discountAmountCents: 1300,
        }}
        totalPrice={52}
        totalDuration={75}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        salonSlug="salon-a"
        dateStr="2026-03-20"
        timeStr="10:00"
        bookingFlow={[]}
        location={null}
      />,
    );

    expect(screen.getByText(/Welcome back · 20% off/i)).toBeInTheDocument();
    expect(screen.getByText(/Savings \$13\.00 · Code BACK20/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirm appointment · \$52/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(requestBody.campaignToken).toBe(token);
  });

  it('does not submit an invalid campaign token when regular pricing is shown', async () => {
    navigationMock.searchParams = new URLSearchParams('techId=tech_1&campaign=expired_campaign_token_123456789012345');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: { appointmentId: 'appt_regular', appointment: { id: 'appt_regular' } },
    }), { status: 201 }));

    render(
      <BookConfirmClient
        services={[{ id: 'srv_1', name: 'Gel Manicure', price: 65, duration: 75 }]}
        subtotalBeforeDiscount={65}
        discountAmount={0}
        campaignMessage="This promotion has expired."
        totalPrice={65}
        totalDuration={75}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        salonSlug="salon-a"
        dateStr="2026-03-20"
        timeStr="10:00"
        bookingFlow={[]}
        location={null}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('This promotion has expired. Regular booking prices apply.');

    fireEvent.click(screen.getByRole('button', { name: /confirm appointment · \$65/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(requestBody).not.toHaveProperty('campaignToken');
  });

  describe('Smart Fit review and submission (P7.3)', () => {
    const renderConfirm = (overrides: Partial<React.ComponentProps<typeof BookConfirmClient>> = {}) => render(
      <BookConfirmClient
        services={[{ id: 'srv_1', name: 'Gel Manicure', price: 65, duration: 75 }]}
        subtotalBeforeDiscount={65}
        discountAmount={0}
        totalPrice={65}
        totalDuration={75}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        salonSlug="salon-a"
        dateStr="2026-03-20"
        timeStr="11:00"
        bookingFlow={[]}
        location={null}
        {...overrides}
      />,
    );

    const successResponse = () => new Response(JSON.stringify({
      data: { appointmentId: 'appt_sf', appointment: { id: 'appt_sf' } },
    }), { status: 201 });

    it('shows the Smart Fit pricing in review and submits only the approved expectation fields', async () => {
      navigationMock.searchParams = new URLSearchParams(
        'techId=tech_1&serviceIds=srv_1&smartFitDiscountCents=650&smartFitTotalCents=5850',
      );
      fetchMock.mockResolvedValueOnce(successResponse());

      renderConfirm();

      // Review presentation: labeled discount line, subtotal, and total.
      const review = screen.getByTestId('smart-fit-review');

      expect(review).toHaveTextContent('Smart Fit Discount applied');
      expect(review).toHaveTextContent('Subtotal $65.00 · Smart Fit Discount −$6.50 · Total $58.50');
      // The discounted total is the clearest price everywhere.
      expect(screen.getByText('$58.50')).toBeInTheDocument();
      // The discount is display-only — nothing editable inside the review.
      expect(within(review).queryByRole('textbox')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /confirm appointment · \$58\.50/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

      expect(requestBody.expectedDiscountType).toBe('smart_fit');
      expect(requestBody.expectedTotalCents).toBe(5850);
      // Nothing beyond the two approved expectation fields is submitted.
      expect(requestBody).not.toHaveProperty('discountAmountCents');
      expect(requestBody).not.toHaveProperty('discountLabel');

      // Success screen keeps the honest discounted total.
      expect(await screen.findByText('Appointment confirmed')).toBeInTheDocument();
      expect(screen.getByText('$58.50')).toBeInTheDocument();
    });

    it('submits no Smart Fit expectations for a regular slot', async () => {
      fetchMock.mockResolvedValueOnce(successResponse());

      renderConfirm();

      fireEvent.click(screen.getByRole('button', { name: /confirm appointment · \$65/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

      expect(requestBody).not.toHaveProperty('expectedDiscountType');
      expect(requestBody).not.toHaveProperty('expectedTotalCents');
      expect(screen.queryByTestId('smart-fit-review')).not.toBeInTheDocument();
    });

    it('keeps a higher-priority discount presentation and drops Smart Fit entirely', async () => {
      navigationMock.searchParams = new URLSearchParams(
        'techId=tech_1&smartFitDiscountCents=650&smartFitTotalCents=5850',
      );
      fetchMock.mockResolvedValueOnce(successResponse());

      renderConfirm({
        discountAmount: 16.25,
        totalPrice: 48.75,
        firstVisitDiscountPreview: { label: 'First visit discount', percent: 25, amountCents: 1625 },
      });

      expect(screen.getByText(/first visit discount applied/i)).toBeInTheDocument();
      expect(screen.queryByTestId('smart-fit-review')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /confirm appointment · \$48\.75/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

      expect(requestBody).not.toHaveProperty('expectedDiscountType');
      expect(requestBody).not.toHaveProperty('expectedTotalCents');
    });

    it('ignores expectation params that do not reconcile with the server subtotal', () => {
      navigationMock.searchParams = new URLSearchParams(
        'techId=tech_1&smartFitDiscountCents=650&smartFitTotalCents=100',
      );

      renderConfirm();

      expect(screen.queryByTestId('smart-fit-review')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /confirm appointment · \$65/i })).toBeInTheDocument();
    });

    it('offers exactly one nearby suggestion and switches the slot on acceptance', () => {
      navigationMock.searchParams = new URLSearchParams(
        'techId=tech_1&serviceIds=srv_1&smartFitSuggestTime=10:30&smartFitSuggestStartTime=2026-03-20T14:30:00.000Z&smartFitSuggestDiscountCents=650&smartFitSuggestTotalCents=5850',
      );

      renderConfirm();

      const suggestion = screen.getByTestId('smart-fit-suggestion');

      expect(suggestion).toHaveTextContent('Save $6.50 by booking 30 minutes earlier');
      expect(suggestion).toHaveTextContent('10:30 AM · $58.50 instead of $65.00');
      expect(screen.getAllByTestId('smart-fit-suggestion')).toHaveLength(1);

      fireEvent.click(screen.getByRole('button', { name: 'Choose this time' }));

      expect(routerReplace).toHaveBeenCalledTimes(1);

      const url = String(routerReplace.mock.calls[0]?.[0]);

      expect(url).toContain('/en/salon-a/book/confirm');
      expect(url).toContain('time=10%3A30');
      expect(url).toContain('smartFitDiscountCents=650');
      expect(url).toContain('smartFitTotalCents=5850');
      expect(url).toContain('serviceIds=srv_1');
      expect(url).not.toContain('smartFitSuggest');
    });

    it('keeps the selected time on dismissal and does not re-offer within the same context', () => {
      navigationMock.searchParams = new URLSearchParams(
        'techId=tech_1&serviceIds=srv_1&smartFitSuggestTime=10:30&smartFitSuggestDiscountCents=650&smartFitSuggestTotalCents=5850',
      );

      const first = renderConfirm();

      fireEvent.click(screen.getByRole('button', { name: 'Keep my time' }));

      expect(screen.queryByTestId('smart-fit-suggestion')).not.toBeInTheDocument();
      expect(routerReplace).not.toHaveBeenCalled();
      expect(routerPush).not.toHaveBeenCalled();
      // The client's chosen time is unchanged in the review.
      expect(screen.getByText(/11:00 AM/)).toBeInTheDocument();

      // A fresh mount with the same booking context stays dismissed.
      first.unmount();
      renderConfirm();

      expect(screen.queryByTestId('smart-fit-suggestion')).not.toBeInTheDocument();
    });

    it('does not surface a suggestion when a higher-priority discount applies', () => {
      navigationMock.searchParams = new URLSearchParams(
        'techId=tech_1&smartFitSuggestTime=10:30&smartFitSuggestDiscountCents=650&smartFitSuggestTotalCents=5850',
      );

      renderConfirm({
        discountAmount: 16.25,
        totalPrice: 48.75,
        firstVisitDiscountPreview: { label: 'First visit discount', percent: 25, amountCents: 1625 },
      });

      expect(screen.queryByTestId('smart-fit-suggestion')).not.toBeInTheDocument();
    });

    it('handles SMART_FIT_CHANGED with the exact message, a refresh path, and no silent booking', async () => {
      // The client logs non-OK booking responses for debugging.
      vi.spyOn(console, 'error').mockImplementation(() => {});
      navigationMock.searchParams = new URLSearchParams(
        'techId=tech_1&serviceIds=srv_1&smartFitDiscountCents=650&smartFitTotalCents=5850',
      );
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: 'SMART_FIT_CHANGED',
          message: 'This discounted time is no longer available. Please choose from the latest times.',
          details: { refreshAvailability: true },
        },
      }), { status: 409 }));

      renderConfirm();

      fireEvent.click(screen.getByRole('button', { name: /confirm appointment · \$58\.50/i }));

      // The exact approved message renders in the accessible alert pattern.
      const alert = await screen.findByRole('alert');

      expect(alert).toHaveTextContent('This discounted time is no longer available. Please choose from the latest times.');
      // No booking was created or presented as successful.
      expect(screen.queryByText('Appointment confirmed')).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // Contact details survive for the retry.
      expect(sessionStorage.getItem('luster_booking_contact')).not.toBeNull();

      // Focus lands on the one action so keyboard users are not stranded.
      expect(screen.getByRole('button', { name: 'Choose another time' })).toHaveFocus();

      // Returning to the time step flags the availability refresh for THIS
      // salon; the URL still carries every selection, so nothing else is lost.
      fireEvent.click(screen.getByRole('button', { name: 'Choose another time' }));

      expect(routerBack).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem('luster_smart_fit_refresh')).toBe('salon-a');
    });

    it('stops promising Smart Fit after the server reports a higher-priority discount', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      navigationMock.searchParams = new URLSearchParams(
        'techId=tech_1&serviceIds=srv_1&smartFitDiscountCents=650&smartFitTotalCents=5850',
      );
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: 'SMART_FIT_CHANGED',
          message: 'This discounted time is no longer available. Please choose from the latest times.',
          details: {
            refreshAvailability: true,
            breakdown: {
              subtotalBeforeDiscountCents: 6500,
              discountAmountCents: 1625,
              discountType: 'first_visit_25',
              discountLabel: 'First visit discount',
              finalTotalCents: 4875,
            },
          },
        },
      }), { status: 409 }));

      const first = renderConfirm();

      fireEvent.click(screen.getByRole('button', { name: /confirm appointment · \$58\.50/i }));

      // The returned final pricing is displayed honestly alongside the
      // approved message.
      const alert = await screen.findByRole('alert');

      expect(alert).toHaveTextContent('This discounted time is no longer available. Please choose from the latest times.');
      expect(alert).toHaveTextContent('Current price for this time: $48.75 (First visit discount)');
      // The session now suppresses Smart Fit promises for this salon, so the
      // same 409 cannot loop.
      expect(sessionStorage.getItem('luster_smart_fit_outranked')).toBe('salon-a');

      // A later confirm render with lingering Smart Fit params shows regular
      // pricing and submits no expectation fields.
      first.unmount();
      fetchMock.mockResolvedValueOnce(successResponse());
      renderConfirm();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm appointment · \$65/i })).toBeInTheDocument();
      });

      expect(screen.queryByTestId('smart-fit-review')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /confirm appointment · \$65/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const retryBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));

      expect(retryBody).not.toHaveProperty('expectedDiscountType');
      expect(retryBody).not.toHaveProperty('expectedTotalCents');
    });

    it('leaves another flow\'s dismissal untouched on a legacy confirm mount', () => {
      sessionStorage.setItem('luster_smart_fit_dismissal', 'salon-z|2026-04-01|tech_9||srv_9||');

      renderConfirm();

      expect(sessionStorage.getItem('luster_smart_fit_dismissal'))
        .toBe('salon-z|2026-04-01|tech_9||srv_9||');
    });

    it('moves focus to the confirm button when the suggestion is kept', () => {
      navigationMock.searchParams = new URLSearchParams(
        'techId=tech_1&serviceIds=srv_1&smartFitSuggestTime=10:30&smartFitSuggestDiscountCents=650&smartFitSuggestTotalCents=5850',
      );

      renderConfirm();

      fireEvent.click(screen.getByRole('button', { name: 'Keep my time' }));

      expect(screen.getByRole('button', { name: /confirm appointment/i })).toHaveFocus();
      // The outcome is announced through the polite live region.
      expect(screen.getByText('Keeping your selected time.')).toBeInTheDocument();
    });

    it('books normally after re-selecting a new Smart Fit slot following a stale response', async () => {
      navigationMock.searchParams = new URLSearchParams(
        'techId=tech_1&serviceIds=srv_1&smartFitDiscountCents=650&smartFitTotalCents=5850',
      );
      fetchMock.mockResolvedValueOnce(successResponse());

      renderConfirm();

      fireEvent.click(screen.getByRole('button', { name: /confirm appointment · \$58\.50/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

      expect(requestBody.expectedDiscountType).toBe('smart_fit');
      expect(await screen.findByText('Appointment confirmed')).toBeInTheDocument();
    });
  });

  describe('contact details', () => {
    const renderReview = () => render(
      <BookConfirmClient
        services={[{ id: 'srv_1', name: 'Gel Manicure', price: 65, duration: 75 }]}
        subtotalBeforeDiscount={65}
        discountAmount={0}
        totalPrice={65}
        totalDuration={75}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        salonSlug="salon-a"
        dateStr="2026-03-20"
        timeStr="11:00"
        bookingFlow={[]}
        location={null}
      />,
    );

    /**
     * The confirm button is disabled until all three contact fields are valid.
     * Before this, nothing said the fields were required and nothing said which
     * one was missing, so a customer who skipped one just saw a dead button.
     */
    it('marks every contact field as required, visibly and for assistive tech', () => {
      sessionMock.isLoggedIn = false;
      renderReview();

      expect(screen.getAllByText('Required')).toHaveLength(3);

      for (const label of ['Customer name', 'Customer email', 'Customer phone']) {
        expect(screen.getByLabelText(label)).toBeRequired();
      }
    });

    it('names the one thing still missing while the button stays disabled', () => {
      sessionMock.isLoggedIn = false;
      renderReview();

      const confirm = screen.getByRole('button', { name: /confirm appointment/i });

      expect(confirm).toBeDisabled();
      expect(screen.getByTestId('contact-blocker-hint')).toHaveTextContent('Add your name to continue.');

      fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: 'Ava Chen' } });

      expect(screen.getByTestId('contact-blocker-hint')).toHaveTextContent('Enter a valid email address to continue.');

      fireEvent.change(screen.getByLabelText('Customer email'), { target: { value: 'ava@example.com' } });

      expect(screen.getByTestId('contact-blocker-hint')).toHaveTextContent('Enter a 10-digit mobile number to continue.');
    });

    it('clears the hint and enables the button once the details are complete', () => {
      sessionMock.isLoggedIn = false;
      renderReview();

      fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: 'Ava Chen' } });
      fireEvent.change(screen.getByLabelText('Customer email'), { target: { value: 'ava@example.com' } });
      fireEvent.change(screen.getByLabelText('Customer phone'), { target: { value: '416-555-0101' } });

      expect(screen.queryByTestId('contact-blocker-hint')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /confirm appointment/i })).toBeEnabled();
    });

    it('tells a signed-in customer they are signed in', () => {
      renderReview();

      expect(screen.getByTestId('signed-in-notice')).toHaveTextContent('You\'re signed in as Ava');
    });

    it('falls back to a masked phone when the account has no name, never the full number', () => {
      sessionMock.clientName = null;
      renderReview();

      const notice = screen.getByTestId('signed-in-notice');

      expect(notice).toHaveTextContent('(•••) •••-0101');
      expect(notice).not.toHaveTextContent(/4165550101/);
    });

    it('shows no signed-in notice for a guest', () => {
      sessionMock.isLoggedIn = false;
      renderReview();

      expect(screen.queryByTestId('signed-in-notice')).not.toBeInTheDocument();
    });
  });
});
