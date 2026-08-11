import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BookConfirmClient } from './BookConfirmClient';

const { routerBack, routerPush, routerReplace, syncFromUrl, fetchMock, windowOpen, navigationMock, bookingExperienceMock } = vi.hoisted(() => ({
  bookingExperienceMock: {
    confirmationMessage: null as string | null,
    policy: {
      enabled: false,
      title: null as string | null,
      text: null as string | null,
      showOnServicePage: true,
      showBeforeConfirmation: true,
      showAfterConfirmation: true,
      showInConfirmationEmail: true,
      acknowledgment: {
        required: false,
        text: null as string | null,
      },
      version: null as string | null,
    },
    quickFacts: {
      appointmentOnly: {
        enabled: false,
        label: null as string | null,
      },
      depositNotice: {
        enabled: false,
        label: null as string | null,
      },
      cancellationNotice: {
        enabled: false,
        label: null as string | null,
      },
    },
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

const { confettiMock } = vi.hoisted(() => ({ confettiMock: vi.fn() }));

vi.mock('canvas-confetti', () => ({
  default: confettiMock,
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

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({
    salonName: 'Salon A',
    salonSlug: 'salon-a',
    bookingExperience: bookingExperienceMock,
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
    sessionStorage.setItem('luster_booking_contact', JSON.stringify({
      name: 'Ava',
      email: 'ava@example.com',
      phone: '4165550101',
    }));
    bookingExperienceMock.confirmationMessage = null;
    Object.assign(bookingExperienceMock.policy, {
      enabled: false,
      title: null,
      text: null,
      showOnServicePage: true,
      showBeforeConfirmation: true,
      showAfterConfirmation: true,
      showInConfirmationEmail: true,
      acknowledgment: {
        required: false,
        text: null,
      },
      version: null,
    });
    Object.assign(bookingExperienceMock.quickFacts.appointmentOnly, {
      enabled: false,
      label: null,
    });
    Object.assign(bookingExperienceMock.quickFacts.depositNotice, {
      enabled: false,
      label: null,
    });
    Object.assign(bookingExperienceMock.quickFacts.cancellationNotice, {
      enabled: false,
      label: null,
    });
  });

  it('shows the shared salon message only after unchanged confirmed appointment details', async () => {
    bookingExperienceMock.confirmationMessage = 'Please arrive 10 minutes early.\nWe look forward to seeing you.';
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        appointment: {
          id: 'appt_123',
        },
        manageUrl: 'https://salon-a.test/en/salon-a/manage/private-token',
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

    expect(screen.queryByTestId('booking-confirmation-message')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));

    const details = await screen.findByText('Appointment summary');
    const message = screen.getByTestId('booking-confirmation-message');

    expect(message).toHaveTextContent('Please arrive 10 minutes early. We look forward to seeing you.');
    expect(message).toHaveClass('break-words', 'whitespace-pre-line');
    expect(details.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('link', { name: /manage this appointment/i })).toHaveAttribute(
      'href',
      'https://salon-a.test/en/salon-a/manage/private-token',
    );
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

  it('keeps guest details available after a generic booking failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        code: 'BOOKING_FAILED',
        message: 'We could not confirm this appointment yet.',
      },
    }), { status: 500 }));

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

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not confirm this appointment yet.',
    );
    expect(screen.getByLabelText('Customer name')).toHaveValue('Ava');
    expect(screen.getByLabelText('Customer email')).toHaveValue('ava@example.com');
    expect(screen.getByLabelText('Customer phone')).toHaveValue('4165550101');
    expect(screen.getByRole('button', { name: /confirm appointment/i })).toBeEnabled();
    expect(screen.queryByText('Appointment confirmed')).not.toBeInTheDocument();
  });

  it('transitions an existing-appointment response to safe management options', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        code: 'EXISTING_APPOINTMENT',
        message: 'You already have an upcoming appointment.',
      },
    }), { status: 409 }));

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

    expect(await screen.findByText('You already have a booking')).toBeInTheDocument();
    expect(screen.getByTestId('existing-appointment-send-link')).toBeInTheDocument();
    expect(screen.getByTestId('existing-appointment-manage')).toBeInTheDocument();
    expect(screen.getByTestId('existing-appointment-edit-contact')).toBeInTheDocument();
    expect(screen.getByTestId('existing-appointment-retry')).toBeInTheDocument();
    expect(screen.queryByText('Appointment confirmed')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('existing-appointment-manage'));

    expect(routerPush).toHaveBeenCalledWith('/en/salon-a/find-booking');
  });

  describe('booking policy presentation', () => {
    const initialPolicyVersion = `policy-v1:${'a'.repeat(64)}`;
    const updatedPolicyVersion = `policy-v1:${'b'.repeat(64)}`;
    const acknowledgmentText
      = 'I understand this appointment reserves the technician’s time. If I cannot attend, I will contact the salon as soon as possible.';
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
        timeStr="10:00"
        bookingFlow={[]}
        location={null}
      />,
    );

    const enablePolicy = (overrides: Partial<typeof bookingExperienceMock.policy> = {}) => {
      Object.assign(bookingExperienceMock.policy, {
        enabled: true,
        title: 'Deposit and cancellation policy',
        text: 'Please provide at least 24 hours’ notice for cancellations.',
        showBeforeConfirmation: true,
        showAfterConfirmation: true,
        ...overrides,
      });
    };

    it('orders explicit quick facts and the policy immediately before the final action', () => {
      enablePolicy();
      Object.assign(bookingExperienceMock.quickFacts.appointmentOnly, {
        enabled: true,
        label: 'Appointment only',
      });
      Object.assign(bookingExperienceMock.quickFacts.cancellationNotice, {
        enabled: true,
        label: '24-hour cancellation policy',
      });

      renderReview();

      const summary = screen.getByText('Appointment summary');
      const contact = screen.getByText('Your contact details');
      const bookingDetails = screen.getByText('Before you confirm');
      const quickFacts = screen.getByTestId('booking-quick-facts');
      const policy = screen.getByTestId('booking-policy-before-confirmation');
      const confirm = screen.getByRole('button', { name: /confirm appointment/i });
      const changeSelection = screen.getByRole('button', { name: /change time or services/i });

      expect(summary.compareDocumentPosition(contact) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(contact.compareDocumentPosition(bookingDetails) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(bookingDetails.compareDocumentPosition(quickFacts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(quickFacts.nextElementSibling).toBe(policy);
      expect(policy.nextElementSibling).toBe(confirm);
      expect(confirm.compareDocumentPosition(changeSelection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      expect(within(quickFacts).getByText('Appointment only')).toBeInTheDocument();
      expect(within(quickFacts).getByText('24-hour cancellation policy')).toBeInTheDocument();
      expect(within(quickFacts).queryByText(/deposit required/i)).not.toBeInTheDocument();
      expect(within(quickFacts).getAllByRole('listitem')).toHaveLength(2);
      expect(policy).toHaveTextContent('Deposit and cancellation policy');
    });

    it('wraps uninterrupted badge labels and policy titles without changing the card hierarchy', () => {
      const longBadgeLabel = 'A'.repeat(40);
      const longPolicyTitle = 'P'.repeat(60);
      enablePolicy({ title: longPolicyTitle });
      Object.assign(bookingExperienceMock.quickFacts.appointmentOnly, {
        enabled: true,
        label: longBadgeLabel,
      });

      renderReview();

      const quickFacts = screen.getByTestId('booking-quick-facts');
      const badgeLabel = within(quickFacts).getByText(longBadgeLabel);
      const badge = badgeLabel.closest('li');
      const policy = screen.getByTestId('booking-policy-before-confirmation');
      const title = within(policy).getByRole('heading', {
        level: 3,
        name: longPolicyTitle,
      });

      expect(badge).toHaveClass('max-w-full', 'min-w-0');
      expect(badge).not.toHaveClass('whitespace-nowrap');
      expect(badgeLabel).toHaveClass('min-w-0', 'break-words');
      expect(badgeLabel).not.toHaveClass('whitespace-nowrap');
      expect(title).toHaveClass('min-w-0', 'break-words');
      expect(title).not.toHaveClass('whitespace-nowrap');
    });

    it('honors the before-confirmation placement flag', () => {
      enablePolicy({ showBeforeConfirmation: false });

      renderReview();

      expect(screen.queryByTestId('booking-policy-before-confirmation')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /confirm appointment/i })).toBeInTheDocument();
    });

    it('requires an unchecked acknowledgment immediately below the forced policy card for a new public booking', async () => {
      enablePolicy({
        showBeforeConfirmation: false,
        acknowledgment: {
          required: true,
          text: acknowledgmentText,
        },
        version: initialPolicyVersion,
      });
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          appointment: {
            id: 'appt_acknowledged',
          },
        },
      }), { status: 201 }));

      renderReview();

      const policy = screen.getByTestId('booking-policy-before-confirmation');
      const acknowledgment = screen.getByTestId('booking-policy-acknowledgment');
      const checkbox = within(acknowledgment).getByRole('checkbox', {
        name: acknowledgmentText,
      });
      const confirm = screen.getByRole('button', {
        name: /confirm appointment/i,
      });

      expect(policy.nextElementSibling).toBe(acknowledgment);
      expect(acknowledgment.nextElementSibling).toBe(confirm);
      expect(checkbox).not.toBeChecked();
      expect(checkbox).toBeRequired();
      expect(confirm).toBeDisabled();
      expect(acknowledgment).toHaveTextContent(acknowledgmentText);
      expect(
        within(acknowledgment).getByText(acknowledgmentText),
      ).toHaveClass('whitespace-pre-line');
      expect(acknowledgment).toHaveTextContent(
        'Check the box to confirm your appointment.',
      );
      expect(acknowledgment).not.toHaveTextContent(/payment authorization|store a card|charge a fee/i);

      fireEvent.click(checkbox);

      await waitFor(() => expect(confirm).toBeEnabled());
      fireEvent.click(confirm);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

      expect(requestBody.bookingPolicyAcknowledgment).toEqual({
        accepted: true,
        version: initialPolicyVersion,
        attemptId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
        ),
      });
    });

    it('does not render or submit acknowledgment for an optional policy', async () => {
      enablePolicy();
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          appointment: {
            id: 'appt_optional_policy',
          },
        },
      }), { status: 201 }));

      renderReview();

      expect(
        screen.queryByTestId('booking-policy-acknowledgment'),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', {
        name: /confirm appointment/i,
      }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

      expect(requestBody).not.toHaveProperty('bookingPolicyAcknowledgment');
    });

    it('adopts a newly required policy without losing the stale page booking state or auto-submitting', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      navigationMock.searchParams = new URLSearchParams(
        'techId=tech_1&serviceIds=srv_1&smartFitDiscountCents=650&smartFitTotalCents=5850',
      );
      enablePolicy({
        acknowledgment: {
          required: false,
          text: null,
        },
        version: null,
      });
      const newlyRequiredAcknowledgment
        = 'I understand this appointment reserves the technician’s time.\nI will contact the salon if I cannot attend.';
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({
          error: 'BOOKING_POLICY_ACKNOWLEDGMENT_REQUIRED',
          message: 'Review and acknowledge the booking policy before confirming.',
          bookingPolicy: {
            enabled: true,
            title: 'Current booking policy',
            text: 'The salon now requires acknowledgment before booking.',
            showOnServicePage: true,
            showBeforeConfirmation: true,
            showAfterConfirmation: true,
            showInConfirmationEmail: true,
            acknowledgment: {
              required: true,
              text: newlyRequiredAcknowledgment,
            },
            version: updatedPolicyVersion,
          },
        }), { status: 400 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          data: {
            appointment: {
              id: 'appt_after_acknowledgment_required',
            },
          },
        }), { status: 201 }));

      renderReview();

      await waitFor(() => {
        expect(screen.getByLabelText('Customer name')).toHaveValue('Ava');
      });

      expect(
        screen.queryByTestId('booking-policy-acknowledgment'),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('smart-fit-review')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Customer name'), {
        target: { value: 'Ava Chen' },
      });
      const initialConfirm = screen.getByRole('button', {
        name: /confirm appointment/i,
      });

      expect(initialConfirm).toBeEnabled();

      fireEvent.click(initialConfirm);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Review and acknowledge the booking policy before confirming.',
      );
      expect(screen.getByText('Current booking policy')).toBeInTheDocument();
      expect(screen.getByText(
        'The salon now requires acknowledgment before booking.',
      )).toBeInTheDocument();
      expect(screen.getByLabelText('Customer name')).toHaveValue('Ava Chen');
      expect(screen.getByLabelText('Customer email')).toHaveValue(
        'ava@example.com',
      );
      expect(screen.getByLabelText('Customer phone')).toHaveValue(
        '4165550101',
      );
      expect(screen.getByTestId('smart-fit-review')).toHaveTextContent(
        'Total $58.50',
      );

      const acknowledgment = screen.getByTestId(
        'booking-policy-acknowledgment',
      );
      const checkbox = within(acknowledgment).getByRole('checkbox', {
        name: /I understand this appointment reserves the technician’s time\.\s+I will contact the salon if I cannot attend\./i,
      });
      const acknowledgmentLabel = checkbox.closest('label')?.querySelector(
        'span',
      );
      const requiredConfirm = screen.getByRole('button', {
        name: /confirm appointment/i,
      });

      expect(checkbox).not.toBeChecked();
      expect(requiredConfirm).toBeDisabled();
      expect(acknowledgmentLabel).toHaveClass('whitespace-pre-line');
      expect(acknowledgmentLabel?.textContent).toBe(
        newlyRequiredAcknowledgment,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const firstRequest = JSON.parse(
        String(fetchMock.mock.calls[0]?.[1]?.body),
      );
      const firstIdempotencyKey = (
        fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
      )['Idempotency-Key'];

      expect(firstRequest).not.toHaveProperty(
        'bookingPolicyAcknowledgment',
      );
      expect(firstRequest.expectedDiscountType).toBe('smart_fit');
      expect(firstRequest.expectedTotalCents).toBe(5850);

      fireEvent.click(checkbox);
      await waitFor(() => expect(requiredConfirm).toBeEnabled());
      fireEvent.click(requiredConfirm);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const secondRequest = JSON.parse(
        String(fetchMock.mock.calls[1]?.[1]?.body),
      );
      const secondIdempotencyKey = (
        fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>
      )['Idempotency-Key'];

      expect(secondRequest.bookingPolicyAcknowledgment).toEqual({
        accepted: true,
        version: updatedPolicyVersion,
        attemptId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
        ),
      });
      expect(secondIdempotencyKey).not.toBe(firstIdempotencyKey);
      expect(secondRequest.clientName).toBe(firstRequest.clientName);
      expect(secondRequest.clientEmail).toBe(firstRequest.clientEmail);
      expect(secondRequest.clientPhone).toBe(firstRequest.clientPhone);
      expect(secondRequest.startTime).toBe(firstRequest.startTime);
      expect(secondRequest.appointmentDate).toBe(
        firstRequest.appointmentDate,
      );
      expect(secondRequest.appointmentTime).toBe(
        firstRequest.appointmentTime,
      );
      expect(secondRequest.technicianId).toBe(firstRequest.technicianId);
      expect(secondRequest.serviceIds).toEqual(firstRequest.serviceIds);
      expect(secondRequest.expectedDiscountType).toBe(
        firstRequest.expectedDiscountType,
      );
      expect(secondRequest.expectedTotalCents).toBe(
        firstRequest.expectedTotalCents,
      );
    });

    it('keeps public rescheduling outside acknowledgment scope', async () => {
      navigationMock.searchParams = new URLSearchParams(
        'techId=tech_1&originalAppointmentId=appt_original&manageToken=manage_safe',
      );
      enablePolicy({
        acknowledgment: {
          required: true,
          text: acknowledgmentText,
        },
        version: initialPolicyVersion,
      });
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          appointment: {
            id: 'appt_rescheduled',
          },
        },
      }), { status: 201 }));

      renderReview();

      expect(
        screen.queryByTestId('booking-policy-acknowledgment'),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', {
        name: /confirm appointment/i,
      }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

      expect(requestBody.originalAppointmentId).toBe('appt_original');
      expect(requestBody).not.toHaveProperty('bookingPolicyAcknowledgment');
    });

    it('refreshes a stale policy without losing booking details or automatically resubmitting', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      enablePolicy({
        text: 'The original policy wording.',
        acknowledgment: {
          required: true,
          text: acknowledgmentText,
        },
        version: initialPolicyVersion,
      });
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({
          error: 'BOOKING_POLICY_CHANGED',
          message:
            'The salon updated its booking policy. Please review it and confirm again.',
          bookingPolicy: {
            enabled: true,
            title: 'Updated booking policy',
            text: 'The latest policy wording.',
            showBeforeConfirmation: true,
            showAfterConfirmation: true,
            acknowledgment: {
              required: true,
              text: 'I reviewed the latest booking policy.',
            },
            version: updatedPolicyVersion,
          },
        }), { status: 409 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          data: {
            appointment: {
              id: 'appt_after_policy_refresh',
            },
          },
        }), { status: 201 }));

      renderReview();

      await waitFor(() => {
        expect(screen.getByLabelText('Customer name')).toHaveValue('Ava');
      });
      fireEvent.change(screen.getByLabelText('Customer name'), {
        target: { value: 'Ava Chen' },
      });
      fireEvent.click(screen.getByRole('checkbox', {
        name: acknowledgmentText,
      }));
      fireEvent.click(screen.getByRole('button', {
        name: /confirm appointment/i,
      }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The salon updated its booking policy. Please review it and confirm again.',
      );
      expect(screen.getByText('Updated booking policy')).toBeInTheDocument();
      expect(screen.getByText('The latest policy wording.')).toBeInTheDocument();
      expect(screen.getByLabelText('Customer name')).toHaveValue('Ava Chen');
      expect(screen.getByLabelText('Customer email')).toHaveValue('ava@example.com');
      expect(screen.getByLabelText('Customer phone')).toHaveValue('4165550101');
      expect(screen.getByRole('checkbox', {
        name: 'I reviewed the latest booking policy.',
      })).not.toBeChecked();
      expect(screen.getByRole('button', {
        name: /confirm appointment/i,
      })).toBeDisabled();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const firstRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      fireEvent.click(screen.getByRole('checkbox', {
        name: 'I reviewed the latest booking policy.',
      }));
      await waitFor(() => expect(screen.getByRole('button', {
        name: /confirm appointment/i,
      })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', {
        name: /confirm appointment/i,
      }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));

      expect(secondRequest.bookingPolicyAcknowledgment.version)
        .toBe(updatedPolicyVersion);
      expect(secondRequest.bookingPolicyAcknowledgment.attemptId)
        .not.toBe(firstRequest.bookingPolicyAcknowledgment.attemptId);
      expect(secondRequest.clientName).toBe(firstRequest.clientName);
      expect(secondRequest.clientEmail).toBe(firstRequest.clientEmail);
      expect(secondRequest.clientPhone).toBe(firstRequest.clientPhone);
      expect(secondRequest.startTime).toBe(firstRequest.startTime);
      expect(secondRequest.serviceIds).toEqual(firstRequest.serviceIds);
    });

    it('keeps the acknowledgment attempt stable for an exact network retry and rotates it after a material edit', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      enablePolicy({
        acknowledgment: {
          required: true,
          text: acknowledgmentText,
        },
        version: initialPolicyVersion,
      });
      fetchMock
        .mockRejectedValueOnce(new TypeError('network unavailable'))
        .mockRejectedValueOnce(new TypeError('network unavailable'))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          data: {
            appointment: {
              id: 'appt_retry',
            },
          },
        }), { status: 201 }));

      renderReview();
      fireEvent.click(screen.getByRole('checkbox', {
        name: acknowledgmentText,
      }));
      await waitFor(() => expect(screen.getByRole('button', {
        name: /confirm appointment/i,
      })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', {
        name: /confirm appointment/i,
      }));

      await screen.findByText(/network unavailable/i);
      fireEvent.click(screen.getByRole('button', {
        name: /confirm appointment/i,
      }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      const firstRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      const exactRetry = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));

      expect(exactRetry.bookingPolicyAcknowledgment.attemptId)
        .toBe(firstRequest.bookingPolicyAcknowledgment.attemptId);

      await screen.findByText(/network unavailable/i);
      fireEvent.change(screen.getByLabelText('Customer name'), {
        target: { value: 'Ava Changed' },
      });
      fireEvent.click(screen.getByRole('button', {
        name: /confirm appointment/i,
      }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

      const editedRetry = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));

      expect(editedRetry.bookingPolicyAcknowledgment.attemptId)
        .not.toBe(firstRequest.bookingPolicyAcknowledgment.attemptId);
    });

    it('does not infer or render badges when every explicit quick fact is disabled', () => {
      enablePolicy();

      renderReview();

      expect(screen.queryByTestId('booking-quick-facts')).not.toBeInTheDocument();
      expect(screen.queryByText('Appointment only')).not.toBeInTheDocument();
    });

    it('expands long pre-confirmation policy text accessibly', () => {
      const longPolicy = `${'Please contact the salon before cancelling your reserved appointment. '.repeat(5)}No-shows may lose their deposit.`;
      enablePolicy({ text: longPolicy });

      renderReview();

      const policy = screen.getByTestId('booking-policy-before-confirmation');
      const expand = within(policy).getByRole('button', { name: 'View full policy' });
      const controlledContentId = expand.getAttribute('aria-controls');

      expect(expand).toHaveAttribute('aria-expanded', 'false');
      expect(expand).toHaveAttribute('aria-controls');
      expect(expand).toHaveClass(
        'text-[var(--n5-ink-main)]',
        'underline',
        'decoration-current',
        'focus-visible:outline',
        'focus-visible:outline-[var(--n5-ink-main)]',
      );
      expect(expand).not.toHaveClass(
        'text-[var(--n5-accent)]',
        'decoration-transparent',
      );
      expect(document.getElementById(controlledContentId!)).toBeInTheDocument();
      expect(within(policy).queryByText(longPolicy)).not.toBeInTheDocument();

      fireEvent.click(expand);

      const collapse = within(policy).getByRole('button', { name: 'Show less' });

      expect(collapse).toHaveAttribute('aria-expanded', 'true');
      expect(collapse).toHaveAttribute('aria-controls', controlledContentId);
      expect(collapse).toHaveClass(
        'text-[var(--n5-ink-main)]',
        'underline',
        'decoration-current',
      );
      expect(within(policy).getByText(longPolicy)).toBeInTheDocument();
    });

    it('shows a more compact collapsible reminder after the summary and before management', async () => {
      const mediumPolicy = `${'Please contact the salon as soon as possible if you cannot attend. '.repeat(3)}Thank you.`;
      enablePolicy({ text: mediumPolicy });
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          appointment: {
            id: 'appt_policy',
          },
          manageUrl: 'https://salon-a.test/en/salon-a/manage/policy-token',
        },
      }), { status: 200 }));

      renderReview();

      const beforePolicy = screen.getByTestId('booking-policy-before-confirmation');

      expect(within(beforePolicy).queryByRole('button', { name: 'View full policy' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));

      const reminder = await screen.findByTestId('booking-policy-after-confirmation');
      const summary = screen.getByText('Appointment summary');
      const manage = screen.getByRole('link', { name: /manage this appointment/i });
      const expand = within(reminder).getByRole('button', { name: 'View full policy' });

      expect(summary.compareDocumentPosition(reminder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(reminder.compareDocumentPosition(manage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(reminder).toHaveTextContent('Please remember');
      expect(expand).toHaveAttribute('aria-expanded', 'false');
      expect(expand).toHaveClass(
        'text-[var(--n5-ink-main)]',
        'underline',
        'decoration-current',
      );
      expect(expand).not.toHaveClass('decoration-transparent');

      fireEvent.click(expand);

      expect(within(reminder).getByText(mediumPolicy)).toBeInTheDocument();
      expect(within(reminder).getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
    });

    it('honors the after-confirmation placement flag', async () => {
      enablePolicy({ showAfterConfirmation: false });
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          appointment: {
            id: 'appt_no_reminder',
          },
        },
      }), { status: 200 }));

      renderReview();
      fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));

      expect(await screen.findByText('Appointment confirmed')).toBeInTheDocument();
      expect(screen.queryByTestId('booking-policy-after-confirmation')).not.toBeInTheDocument();
    });
  });

  it('renders the canonical manage URL exactly and removes account actions', async () => {
    const manageUrl = 'https://salon-a.test/en/salon-a/manage/private-token?source=confirmation';
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        appointment: {
          id: 'appt_123',
        },
        manageUrl,
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

    const manageAction = await screen.findByRole('link', { name: /manage this appointment/i });

    expect(manageAction).toHaveAttribute('href', manageUrl);
    expect(screen.queryByRole('button', { name: /how to pay/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /view rewards/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^profile$/i })).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('/change-appointment');
  });

  it('keeps confirmation visible and offers tenant-scoped secure recovery when manageUrl is absent', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        appointmentId: 'appt_private_123',
        appointment: {
          id: 'appt_private_123',
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

    expect(await screen.findByText('Appointment confirmed')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      /private management link is not available on this screen/i,
    );
    expect(screen.getByRole('link', { name: /find my booking to receive a secure management link/i }))
      .toHaveAttribute('href', '/en/salon-a/find-booking');
    expect(screen.queryByRole('link', { name: /manage this appointment/i })).not.toBeInTheDocument();
    expect(screen.queryByText('appt_private_123')).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('/change-appointment');
  });

  it('preserves Google and Apple calendar actions on successful confirmation', async () => {
    const manageUrl = 'https://salon-a.test/en/salon-a/manage/calendar-token';
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        appointment: {
          id: 'appt_calendar',
        },
        manageUrl,
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
        canonicalStartTime="2026-03-20T14:00:00.000Z"
        bookingFlow={[]}
        location={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));

    const googleCalendar = await screen.findByRole('link', { name: /google calendar/i });
    const appleCalendar = screen.getByRole('link', { name: /apple calendar/i });

    expect(googleCalendar).toHaveAttribute(
      'href',
      expect.stringContaining('https://calendar.google.com/calendar/render?'),
    );
    expect(googleCalendar).toHaveAttribute('target', '_blank');
    expect(appleCalendar).toHaveAttribute('href', `${manageUrl}/calendar.ics`);
  });

  it('keeps passive earned-points context without exposing a rewards account action', async () => {
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

    expect(await screen.findByText('Appointment confirmed')).toBeInTheDocument();
    expect(screen.getByText(/estimated reward after completion:/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /view rewards/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view rewards/i })).not.toBeInTheDocument();
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
      sessionStorage.clear();
      renderReview();

      expect(screen.getAllByText('Required')).toHaveLength(3);

      for (const label of ['Customer name', 'Customer email', 'Customer phone']) {
        expect(screen.getByLabelText(label)).toBeRequired();
      }
    });

    it('names the one thing still missing while the button stays disabled', () => {
      sessionStorage.clear();
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
      sessionStorage.clear();
      renderReview();

      fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: 'Ava Chen' } });
      fireEvent.change(screen.getByLabelText('Customer email'), { target: { value: 'ava@example.com' } });
      fireEvent.change(screen.getByLabelText('Customer phone'), { target: { value: '416-555-0101' } });

      expect(screen.queryByTestId('contact-blocker-hint')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /confirm appointment/i })).toBeEnabled();
    });

    it('keeps all guest contact fields editable', async () => {
      renderReview();

      await waitFor(() => expect(screen.getByLabelText('Customer name')).toHaveValue('Ava'));
      for (const label of ['Customer name', 'Customer email', 'Customer phone']) {
        expect(screen.getByLabelText(label)).not.toHaveAttribute('readonly');
      }
    });
  });

  describe('guest-only identity', () => {
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

    it('does not render retired account, login, or identity-switching controls', () => {
      renderReview();

      expect(screen.queryByTestId('signed-in-notice')).not.toBeInTheDocument();
      expect(screen.queryByTestId('guest-mode-notice')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /book for someone else/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /book for myself/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/same account/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/change it in your profile/i)).not.toBeInTheDocument();
      expect(screen.getByText(/same contact details/i)).toBeInTheDocument();
    });

    it('submits explicit guest identity using editable contact details despite an inert legacy cookie', async () => {
      document.cookie = 'client_session=inert-legacy-value; path=/';
      fetchMock.mockResolvedValue(new Response(JSON.stringify({
        data: {
          appointmentId: 'appt_1',
          manageUrl: 'https://salon-a.test/en/salon-a/manage/private-token',
          appointment: { id: 'appt_1' },
        },
      }), { status: 201 }));

      renderReview();
      await waitFor(() => expect(screen.getByLabelText('Customer name')).toHaveValue('Ava'));
      fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: 'Sam Guest' } });
      fireEvent.change(screen.getByLabelText('Customer email'), { target: { value: 'SAM@example.com' } });
      fireEvent.change(screen.getByLabelText('Customer phone'), { target: { value: '416-555-9999' } });
      fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

      expect(body.bookingSubject).toBe('guest');
      expect(body.clientName).toBe('Sam Guest');
      expect(body.clientPhone).toBe('4165559999');
      expect(body.clientEmail).toBe('sam@example.com');
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/api/appointments']);

      document.cookie = 'client_session=; Max-Age=0; path=/';
    });

    it('makes no legacy auth or customer-profile request during ordinary interaction', async () => {
      renderReview();
      await waitFor(() => expect(screen.getByLabelText('Customer name')).toHaveValue('Ava'));
      fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: 'Ava Chen' } });
      fireEvent.change(screen.getByLabelText('Customer email'), { target: { value: 'ava.chen@example.com' } });
      fireEvent.change(screen.getByLabelText('Customer phone'), { target: { value: '647-555-0102' } });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(document.body.innerHTML).not.toMatch(/\/api\/(?:auth|client)\//);
    });
  });
});

// =============================================================================
// D3 — deposit disclosure, chip suppression, and the money-path field
// =============================================================================

describe('BookConfirmClient deposit disclosure', () => {
  const DISCLOSURE = {
    label: '$25.00 deposit required to book — applied to your service total.',
    amountCents: 2500,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    navigationMock.searchParams = new URLSearchParams('techId=tech_1');
    vi.stubGlobal('fetch', fetchMock);
    window.open = windowOpen;
    sessionStorage.clear();
    sessionStorage.setItem('luster_booking_contact', JSON.stringify({
      name: 'Ava',
      email: 'ava@example.com',
      phone: '4165550101',
    }));
    bookingExperienceMock.confirmationMessage = null;
    Object.assign(bookingExperienceMock.policy, {
      enabled: false,
      title: null,
      text: null,
      showOnServicePage: true,
      showBeforeConfirmation: true,
      showAfterConfirmation: true,
      showInConfirmationEmail: true,
      acknowledgment: { required: false, text: null },
      version: null,
    });
    Object.assign(bookingExperienceMock.quickFacts.appointmentOnly, {
      enabled: false,
      label: null,
    });
    Object.assign(bookingExperienceMock.quickFacts.depositNotice, {
      enabled: false,
      label: null,
    });
    Object.assign(bookingExperienceMock.quickFacts.cancellationNotice, {
      enabled: false,
      label: null,
    });
  });

  function renderClient(props: Record<string, unknown> = {}) {
    return render(
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
        {...props}
      />,
    );
  }

  function lastRequestBody() {
    const call = fetchMock.mock.calls.at(-1)!;
    return JSON.parse((call[1] as RequestInit).body as string);
  }

  it('test 34 — a non-entitled salon renders no disclosure', () => {
    // The disclosure has its OWN element and does NOT flow through
    // `quickFacts` / `bookingExperience`, which is plan-entitlement-gated and
    // returns null for free-plan salons.
    renderClient({ depositDisclosure: null });

    expect(screen.queryByTestId('booking-deposit-disclosure')).not.toBeInTheDocument();
  });

  it('test 35 — the disclosed deposit can never exceed the displayed total', () => {
    navigationMock.searchParams = new URLSearchParams(
      'techId=tech_1&smartFitDiscountCents=6000&smartFitTotalCents=500',
    );

    renderClient({ depositDisclosure: { label: '$5.00 deposit required to book — applied to your service total.', amountCents: 500 } });

    const disclosure = screen.getByTestId('booking-deposit-disclosure');

    // The server clamps to the disclosure total; the client renders what it was
    // given and performs no cents arithmetic of its own.
    expect(disclosure).toHaveTextContent('$5.00');
  });

  it('test 36 — chip suppression, BOTH directions, keyed on the system predicate', () => {
    Object.assign(bookingExperienceMock.quickFacts.depositNotice, {
      enabled: true,
      label: 'A deposit may be required',
    });

    const notSuppressed = renderClient({ depositNoticeSuppressed: false });

    expect(screen.getByText('A deposit may be required')).toBeInTheDocument();

    notSuppressed.unmount();

    renderClient({ depositNoticeSuppressed: true, depositDisclosure: DISCLOSURE });

    expect(screen.queryByText('A deposit may be required')).not.toBeInTheDocument();
    expect(screen.getByTestId('booking-deposit-disclosure')).toBeInTheDocument();
  });

  function okResponse() {
    return new Response(JSON.stringify({
      data: { appointment: { id: 'appt_1' }, manageUrl: 'https://x.test/m' },
    }), { status: 200 });
  }

  // Tests 37 and 37b are the SAME requirement in its two states, split so each
  // gets a fresh component and a fresh Response body.
  //
  // The `null`-disclosure case is the one that fails against a conditional send,
  // and it is LOAD-BEARING ON MONEY: it is the only thing that pins the PRESENCE
  // of the field the booking PR's pre-transaction entry predicate reads. A
  // conditional send silently routes every account-side-inactive booking onto
  // the free-booking leg.
  it('test 37 — the POST body carries expectedDepositFingerprint when NOTHING was disclosed', async () => {
    fetchMock.mockResolvedValueOnce(okResponse());

    renderClient({ depositDisclosure: null, depositFingerprint: 'deposit-v1:none' });
    fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(lastRequestBody().expectedDepositFingerprint).toBe('deposit-v1:none');
  });

  it('test 37b — and it carries the real token when a disclosure WAS rendered', async () => {
    fetchMock.mockResolvedValueOnce(okResponse());

    renderClient({ depositDisclosure: DISCLOSURE, depositFingerprint: 'deposit-v1:cad:2500' });
    fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(lastRequestBody().expectedDepositFingerprint).toBe('deposit-v1:cad:2500');
  });

  it('test 37 (darkness companion) — the body gains that field and nothing else new', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: { appointment: { id: 'appt_1' }, manageUrl: 'https://x.test/m' },
    }), { status: 200 }));

    renderClient({ depositDisclosure: null, depositFingerprint: 'deposit-v1:none' });
    fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = lastRequestBody();
    const depositKeys = Object.keys(body).filter(key => /deposit/i.test(key));

    expect(depositKeys).toEqual(['expectedDepositFingerprint']);
    expect(body.expectedDepositFingerprint).toBe('deposit-v1:none');
  });

  it('test 38 — a 409 DEPOSIT_CHANGED returns control to the user, with NO auto-resubmit', async () => {
    // The component logs every non-ok booking response; that is pre-existing
    // behaviour and not what this test is about.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: 'DEPOSIT_CHANGED',
      details: {
        deposit: {
          required: true,
          amountCents: 4000,
          fingerprint: 'deposit-v1:cad:4000',
          label: '$40.00 deposit required to book — applied to your service total.',
        },
      },
    }), { status: 409 }));

    renderClient({ depositDisclosure: DISCLOSURE, depositFingerprint: 'deposit-v1:cad:2500' });
    fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));

    await screen.findByText(/the deposit required for this booking changed/i);

    // An automatic re-POST must fail this assertion.
    expect(fetchMock.mock.calls.length).toBe(1);
    expect(screen.getByTestId('booking-deposit-disclosure')).toHaveTextContent('$40.00');

    // The next attempt carries the ADOPTED fingerprint, and needs a further click.
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: { appointment: { id: 'appt_1' }, manageUrl: 'https://x.test/m' },
    }), { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2));

    expect(lastRequestBody().expectedDepositFingerprint).toBe('deposit-v1:cad:4000');

    consoleError.mockRestore();
  });

  // The magnitude rule is directional: only an UPWARD surprise blocks. Both the
  // drop-to-zero case and the reduced-but-non-zero case must complete in exactly
  // one POST, with the stale deposit line gone from the success screen.
  it('test 38b — the DOWNWARD direction does not block: drop to zero', async () => {
    fetchMock.mockResolvedValueOnce(okResponse());

    renderClient({ depositDisclosure: null, depositFingerprint: 'deposit-v1:none' });
    fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));
    await screen.findByText('Appointment summary');

    expect(fetchMock.mock.calls.length).toBe(1);
    expect(screen.queryByTestId('booking-deposit-disclosure')).not.toBeInTheDocument();
  });

  it('test 38b — the DOWNWARD direction does not block: reduced but non-zero (2500 to 1800)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse());

    renderClient({
      depositDisclosure: {
        label: '$18.00 deposit required to book — applied to your service total.',
        amountCents: 1800,
      },
      depositFingerprint: 'deposit-v1:cad:1800',
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));
    await screen.findByText('Appointment summary');

    expect(fetchMock.mock.calls.length).toBe(1);
    expect(screen.queryByTestId('booking-deposit-disclosure')).not.toBeInTheDocument();
  });

  /**
   * §14 test 26 — the client money path.
   *
   * The navigation seam is INJECTED. `window.location.href = url` would make
   * these unwritable: jsdom does not implement navigation, failOnConsole turns
   * that output into a failure, and nothing here stubs window.location.
   */
  describe('deposits — redirect, hold re-entry and DEPOSIT_CHANGED (§14 test 26)', () => {
    const navigateToCheckout = vi.fn();

    const renderDeposit = (
      overrides: Partial<React.ComponentProps<typeof BookConfirmClient>> = {},
    ) => render(
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
        navigateToCheckout={navigateToCheckout}
        {...overrides}
      />,
    );

    const confirm = () =>
      fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));

    let consoleError: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      navigateToCheckout.mockClear();
      // The component logs every non-ok booking response by design; two legs
      // here are 409s, so failOnConsole would fail them for the diagnostic.
      consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleError.mockRestore();
    });

    it('a 201 carrying a checkout URL redirects and NEVER shows the success view', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          appointmentId: 'appt_hold',
          manageUrl: 'https://example.test/manage/tok',
          deposit: {
            required: true,
            checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_1',
            amountCents: 2500,
            currency: 'cad',
            fingerprint: 'deposit-v1:cad:2500',
            holdExpiresAt: '2026-03-20T15:35:00.000Z',
          },
        },
      }), { status: 201 }));

      renderDeposit();
      confirm();

      await waitFor(() => expect(navigateToCheckout).toHaveBeenCalledWith(
        'https://checkout.stripe.com/c/pay/cs_1',
      ));

      // A hold is NOT a completed booking: showing the success screen would be a
      // lie, and clearing guest storage would cost the client their details if
      // they came back from Checkout unpaid.
      expect(screen.queryByText('Appointment confirmed')).not.toBeInTheDocument();

      // Confetti is asserted as STABILITY rather than a zero count. The success
      // path schedules it 300 ms after `setBookingComplete`, and a previous
      // test's 1 200 ms requestAnimationFrame burst can still be decaying here —
      // a raw "not called" would be measuring that leak, not this test. Letting
      // it settle and then proving the count does not move across a window
      // longer than the success delay is what actually shows this render
      // scheduled nothing.
      await new Promise((resolve) => {
        setTimeout(resolve, 1600);
      });
      const settled = confettiMock.mock.calls.length;
      await new Promise((resolve) => {
        setTimeout(resolve, 500);
      });

      expect(confettiMock.mock.calls.length).toBe(settled);
    });

    it('a 409 DEPOSIT_HOLD_ACTIVE renders the existing-appointment options, not the generic banner', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: 'DEPOSIT_HOLD_ACTIVE',
          message: 'You already have a booking waiting for its deposit.',
          details: { holdExpiresAt: '2026-03-20T15:35:00.000Z' },
        },
      }), { status: 409 }));

      renderDeposit();
      confirm();

      expect(await screen.findByTestId('existing-appointment-manage')).toBeInTheDocument();
      expect(navigateToCheckout).not.toHaveBeenCalled();
    });

    it('a 409 DEPOSIT_CHANGED adopts the new amount and issues NO further POST', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: 'DEPOSIT_CHANGED',
          message: 'The deposit changed.',
          details: {
            deposit: {
              required: true,
              amountCents: 5000,
              fingerprint: 'deposit-v1:cad:5000',
            },
          },
        },
      }), { status: 409 }));

      renderDeposit({
        depositDisclosure: { label: 'A $25.00 deposit is required', amountCents: 2500 },
        depositFingerprint: 'deposit-v1:cad:2500',
      });
      confirm();

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      // DO NOT AUTO-RESUBMIT. A second POST happens only after a further user
      // click, and it carries the adopted fingerprint — an auto-resubmit would
      // commit the client to a raised amount on ONE click, and the success path
      // redirects to Stripe before any success state exists to undo.
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(navigateToCheckout).not.toHaveBeenCalled();

      // The adopted amount is what the client now sees.
      // The adopted amount is what the client now sees. Asserting the RENDERED
      // text, not component state: state alone corrects nothing the client can
      // read, and the disclosure is the only place this figure ever appears.
      expect(await screen.findByTestId('booking-deposit-disclosure')).toHaveTextContent('$50.00');
    });
  });
});
