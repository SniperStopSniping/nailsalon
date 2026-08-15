import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  sendBookingNotificationsForAppointmentCancelled,
  sendBookingNotificationsForNewBooking,
} from '@/libs/bookingNotifications';

vi.mock('server-only', () => ({}));

const { sendInternalBookingNotificationSms, sendInternalCancellationNotificationSms, sendTransactionalEmail } = vi.hoisted(() => ({
  sendInternalBookingNotificationSms: vi.fn(),
  sendInternalCancellationNotificationSms: vi.fn(),
  sendTransactionalEmail: vi.fn(),
}));

vi.mock('@/libs/Env', () => ({
  Env: {
    TWILIO_ACCOUNT_SID: 'twilio_sid',
    TWILIO_AUTH_TOKEN: 'twilio_token',
    TWILIO_PHONE_NUMBER: '+15551234567',
    RESEND_API_KEY: 'resend_key',
    RESEND_FROM_EMAIL: 'bookings@example.com',
  },
}));

vi.mock('@/libs/featureGating', () => ({
  getEffectiveModuleEnabled: vi.fn(() => true),
}));

vi.mock('@/libs/SMS', () => ({
  sendInternalBookingNotificationSms,
  sendInternalCancellationNotificationSms,
}));

vi.mock('@/libs/email', () => ({
  sendTransactionalEmail,
}));

const baseSalon = {
  id: 'salon_1',
  name: 'Isla Nail Studio',
  ownerName: 'Daniela',
  ownerPhone: '4169021427',
  ownerEmail: 'milianbeltrandaniela@gmail.com',
  features: {
    marketing: {
      smsReminders: true,
    },
  },
  settings: {
    modules: {
      smsReminders: true,
    },
    notifications: {
      newBooking: {
        technicianEnabled: true,
        ownerEnabled: true,
        technicianChannel: 'both',
        ownerChannel: 'both',
      },
      appointmentCancelled: {
        technicianEnabled: true,
        ownerEnabled: true,
        technicianChannel: 'both',
        ownerChannel: 'both',
      },
    },
  },
} as const;

const canonicalFinancialSummary = {
  currency: 'CAD',
  serviceInvoiceTotalCents: 9605,
  totalDueCents: 9605,
  taxAmountCents: 1105,
  taxLabel: 'HST',
  taxMode: 'added',
  taxClassification: 'estimate',
  taxApplied: true,
  collectedDepositCents: 2000,
  refundedDepositCents: 0,
  forfeitedDepositCents: 0,
  depositCreditAppliedCents: 2000,
  appointmentPaymentsCents: 0,
  amountAlreadyPaidCents: 2000,
  balanceCents: 7605,
  depositBlockedCode: null,
  depositPresentationState: 'creditable',
} as const;

describe('bookingNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sendInternalBookingNotificationSms.mockResolvedValue(true);
    sendInternalCancellationNotificationSms.mockResolvedValue(true);
    sendTransactionalEmail.mockResolvedValue(true);
  });

  it('deduplicates identical owner and technician destinations per channel for new bookings', async () => {
    await sendBookingNotificationsForNewBooking({
      salon: baseSalon,
      technician: {
        id: 'tech_1',
        name: 'Daniela',
        phone: '4169021427',
        email: 'milianbeltrandaniela@gmail.com',
      },
      appointmentId: 'appt_1',
      clientName: 'Ava',
      clientPhone: '1111111111',
      services: ['BIAB Fill'],
      startTime: '2099-03-13T15:00:00.000Z',
      totalDurationMinutes: 90,
      financialSummary: canonicalFinancialSummary,
    });

    expect(sendInternalBookingNotificationSms).toHaveBeenCalledTimes(1);
    expect(sendInternalBookingNotificationSms).toHaveBeenCalledWith(
      'salon_1',
      expect.objectContaining({ financialSummary: canonicalFinancialSummary }),
    );
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining([
        'Estimated HST (added): $11.05',
        'Estimated appointment total: $96.05',
        'Deposit collected: $20.00',
        'Deposit credit applied: -$20.00',
        'Amount already paid: $20.00',
        'Estimated remaining balance: $76.05',
      ].join('\n')),
    }));
  });

  it('does not dispatch a later internal recipient after the worker aborts during an earlier leg', async () => {
    const controller = new AbortController();
    sendInternalBookingNotificationSms.mockImplementationOnce(async () => {
      controller.abort(new Error('WORKER_BUDGET_EXPIRED'));
      return true;
    });

    await expect(sendBookingNotificationsForNewBooking({
      salon: baseSalon,
      technician: {
        id: 'tech_1',
        name: 'Daniela',
        phone: '4169021427',
        email: 'artist@example.com',
      },
      appointmentId: 'appt_1',
      clientName: 'Ava',
      clientPhone: '1111111111',
      services: ['BIAB Fill'],
      startTime: '2099-03-13T15:00:00.000Z',
      totalDurationMinutes: 90,
      financialSummary: canonicalFinancialSummary,
    }, { signal: controller.signal })).rejects.toThrow('WORKER_BUDGET_EXPIRED');

    expect(sendInternalBookingNotificationSms).toHaveBeenCalledWith(
      'salon_1',
      expect.objectContaining({ phone: '4169021427' }),
      { signal: controller.signal },
    );
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('deduplicates identical owner and technician destinations per channel for cancellations', async () => {
    await sendBookingNotificationsForAppointmentCancelled({
      salon: baseSalon,
      technician: {
        id: 'tech_1',
        name: 'Daniela',
        phone: '4169021427',
        email: 'milianbeltrandaniela@gmail.com',
      },
      appointmentId: 'appt_1',
      clientName: 'Ava',
      clientPhone: '1111111111',
      services: ['BIAB Fill'],
      startTime: '2099-03-13T15:00:00.000Z',
      cancelReason: 'client_request',
    });

    expect(sendInternalCancellationNotificationSms).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
  });

  it('logs explicit delivery failures when email send returns false', async () => {
    sendTransactionalEmail.mockResolvedValue(false);

    await sendBookingNotificationsForNewBooking({
      salon: baseSalon,
      technician: {
        id: 'tech_1',
        name: 'Daniela',
        phone: '4169021427',
        email: 'artist@example.com',
      },
      appointmentId: 'appt_1',
      clientName: 'Ava',
      clientPhone: '1111111111',
      services: ['BIAB Fill'],
      startTime: '2099-03-13T15:00:00.000Z',
      totalDurationMinutes: 90,
      financialSummary: canonicalFinancialSummary,
    });

    expect(console.error).toHaveBeenCalledWith(
      '[BOOKING NOTIFICATIONS] Internal notification failed:',
      expect.objectContaining({
        eventType: 'new_booking',
        channel: 'email',
        destination: 'artist@example.com',
        reason: 'send_returned_false',
      }),
    );
  });

  // Salon-facing emails moved to @/libs/salonNotificationEmail. This path must
  // stay SMS-only for the owner so one booking can never send two emails.
  it('never emails the owner, even when the owner channel says email', async () => {
    await sendBookingNotificationsForNewBooking({
      salon: {
        ...baseSalon,
        ownerEmail: 'owner@example.com',
        settings: {
          ...baseSalon.settings,
          notifications: {
            ...baseSalon.settings.notifications,
            newBooking: {
              technicianEnabled: false,
              ownerEnabled: true,
              technicianChannel: 'sms',
              ownerChannel: 'email',
            },
          },
        },
      },
      technician: null,
      appointmentId: 'appt_1',
      clientName: 'Ava',
      clientPhone: '1111111111',
      services: ['BIAB Fill'],
      startTime: '2099-03-13T15:00:00.000Z',
      totalDurationMinutes: 90,
      financialSummary: canonicalFinancialSummary,
    });

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(sendInternalBookingNotificationSms).not.toHaveBeenCalled();
  });

  it('still texts the owner when the owner channel says both', async () => {
    await sendBookingNotificationsForNewBooking({
      salon: {
        ...baseSalon,
        settings: {
          ...baseSalon.settings,
          notifications: {
            ...baseSalon.settings.notifications,
            newBooking: {
              technicianEnabled: false,
              ownerEnabled: true,
              technicianChannel: 'sms',
              ownerChannel: 'both',
            },
          },
        },
      },
      technician: null,
      appointmentId: 'appt_1',
      clientName: 'Ava',
      clientPhone: '1111111111',
      services: ['BIAB Fill'],
      startTime: '2099-03-13T15:00:00.000Z',
      totalDurationMinutes: 90,
      financialSummary: canonicalFinancialSummary,
    });

    expect(sendInternalBookingNotificationSms).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('keeps technician email money-free when canonical evidence is blocked', async () => {
    await sendBookingNotificationsForNewBooking({
      salon: baseSalon,
      technician: {
        id: 'tech_1',
        name: 'Daniela',
        phone: '4169021428',
        email: 'artist@example.com',
      },
      appointmentId: 'appt_1',
      clientName: 'Ava',
      clientPhone: '1111111111',
      services: ['BIAB Fill'],
      startTime: '2099-03-13T15:00:00.000Z',
      totalDurationMinutes: 90,
      financialSummary: null,
    });

    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining(
        'Payment details: Under review\nPayment update: The salon will confirm the final payment or refund status before any further action.',
      ),
    }));

    const email = sendTransactionalEmail.mock.calls[0]![0];

    expect(email.text).not.toMatch(/\$|Total:|Balance due:/u);
  });

  it('skips cancellation notifications for reschedules', async () => {
    await sendBookingNotificationsForAppointmentCancelled({
      salon: baseSalon,
      technician: {
        id: 'tech_1',
        name: 'Daniela',
        phone: '4169021427',
        email: null,
      },
      appointmentId: 'appt_1',
      clientName: 'Ava',
      clientPhone: '1111111111',
      services: ['BIAB Fill'],
      startTime: '2099-03-13T15:00:00.000Z',
      cancelReason: 'rescheduled',
    });

    expect(sendInternalCancellationNotificationSms).not.toHaveBeenCalled();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
