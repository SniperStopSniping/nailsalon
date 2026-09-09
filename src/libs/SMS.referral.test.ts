/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookingEmailFinancialSummary } from './bookingEmailFinancialSummary.server';

const { create, isSmsEnabled, twilio, db, queueSelectResults, enqueue } = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(async () => selectResults.shift() ?? []),
  };

  return {
    enqueue: vi.fn(async () => ({ intentId: 'ci_test', created: true })),
    create: vi.fn(async (_input: { body: string }) => ({ sid: 'SM_referral' })),
    isSmsEnabled: vi.fn(),
    twilio: vi.fn(() => ({
      messages: {
        create: vi.fn(async () => ({ sid: 'SM_referral' })),
      },
    })),
    db: {
      select: vi.fn(() => query),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ catch: vi.fn(async () => undefined) })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ catch: vi.fn(async () => undefined) })) })) })),
    },
    queueSelectResults: (...rows: unknown[][]) => {
      selectResults.splice(0, selectResults.length, ...rows);
    },
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/libs/communicationIntent', () => ({ enqueueCommunicationIntent: enqueue }));
vi.mock('@/libs/communicationMaterialization', () => ({
  formatIntentStartTime: () => 'Wed Jun 10, 1:45 PM',
  resolveSalonCommunicationContext: async () => ({ smsEligible: true, timeZone: 'America/Toronto', settings: { sms: { enabled: true }, email: { enabled: true }, events: {}, killSwitch: false } }),
}));
vi.mock('@/libs/DB', () => ({ db }));

vi.mock('twilio', () => ({
  default: twilio,
}));

vi.mock('@/libs/Env', () => ({
  Env: {
    NEXT_PUBLIC_APP_URL: 'https://app.test',
    TWILIO_ACCOUNT_SID: 'twilio_sid',
    TWILIO_AUTH_TOKEN: 'twilio_token',
    TWILIO_PHONE_NUMBER: '+15551234567',
  },
}));

vi.mock('@/libs/salonStatus', () => ({
  isSmsEnabled,
}));

import {
  buildAppointmentReminderMessage,
  buildBookingFinancialSmsLines,
  sendBookingConfirmationToClient,
  sendInternalBookingNotificationSms,
  sendReferralInvite,
} from './SMS';

function financialSummary(
  overrides: Partial<BookingEmailFinancialSummary> = {},
): BookingEmailFinancialSummary {
  return {
    currency: 'CAD',
    serviceInvoiceTotalCents: 4000,
    totalDueCents: 4000,
    taxAmountCents: null,
    taxLabel: null,
    taxMode: null,
    taxClassification: 'estimate',
    taxApplied: false,
    collectedDepositCents: 0,
    refundedDepositCents: 0,
    forfeitedDepositCents: 0,
    depositCreditAppliedCents: 0,
    appointmentPaymentsCents: 0,
    amountAlreadyPaidCents: 0,
    balanceCents: 4000,
    depositBlockedCode: null,
    depositPresentationState: 'none',
    ...overrides,
  };
}

describe('SMS templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSmsEnabled.mockResolvedValue(true);
    twilio.mockReturnValue({
      messages: {
        create,
      },
    });
    queueSelectResults([{ connectAccountSid: 'AC00000000000000000000000000000000', messagingServiceSid: null, phoneNumber: '+14165559999', status: 'active' }]);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('queues internal booking summaries through the canonical communications path', async () => {
    queueSelectResults([{ updatedAt: new Date('2026-06-10T15:00:00Z'), status: 'confirmed' }]);
    const sent = await sendInternalBookingNotificationSms('salon_1', {
      appointmentId: 'appt_1',
      phone: '4165550198',
      salonName: 'Isla Nail Studio',
      clientName: 'Bob',
      clientPhone: '4165550198',
      services: ['Gel Manicure'],
      startTime: '2026-06-10T17:45:00Z',
      totalDurationMinutes: 60,
      financialSummary: financialSummary(),
      technicianName: 'Daniela',
      timeZone: 'America/Toronto',
    });

    expect(sent).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      appointmentId: 'appt_1',
      audience: 'owner',
      eventType: 'owner_new_booking',
      variables: expect.objectContaining({ statusLabel: 'New booking', clientName: 'Bob', serviceName: 'Gel Manicure' }),
    }));
  });

  it('does not send legacy customer confirmations through a salon-owned account', async () => {
    queueSelectResults([{ status: 'granted' }], [{ connectAccountSid: 'AC00000000000000000000000000000000', messagingServiceSid: null, phoneNumber: '+14165559999', status: 'active' }]);
    await sendBookingConfirmationToClient('salon_1', {
      phone: '4165550198',
      clientName: 'Bob',
      appointmentId: 'appt_1',
      salonName: 'Isla Nail Studio',
      services: ['Gel Manicure'],
      technicianName: 'Daniela',
      startTime: '2026-06-10T17:45:00.000Z',
      financialSummary: financialSummary(),
      timeZone: 'America/Toronto',
    });

    expect(create).not.toHaveBeenCalled();
  });

  it('does not send customer appointment texts without salon-scoped consent', async () => {
    queueSelectResults([]);

    const sent = await sendBookingConfirmationToClient('salon_1', {
      phone: '4165550198',
      clientName: 'Bob',
      appointmentId: 'appt_1',
      salonName: 'Isla Nail Studio',
      services: ['Gel Manicure'],
      technicianName: 'Daniela',
      startTime: '2026-06-10T17:45:00.000Z',
      financialSummary: financialSummary(),
      timeZone: 'America/Toronto',
    });

    expect(sent).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  it('preserves tax and deposit presentation in SMS draft helpers', () => {
    const lines = buildBookingFinancialSmsLines(financialSummary({
      serviceInvoiceTotalCents: 11_300,
      totalDueCents: 11_300,
      taxAmountCents: 1300,
      taxLabel: 'HST',
      taxMode: 'added',
      taxApplied: true,
      collectedDepositCents: 2000,
      refundedDepositCents: 500,
      depositCreditAppliedCents: 1500,
      appointmentPaymentsCents: 1000,
      amountAlreadyPaidCents: 2500,
      balanceCents: 8800,
      depositPresentationState: 'creditable',
    }));

    expect(lines).toEqual(expect.arrayContaining(['Estimated HST (added): $13.00 CAD', 'Estimated appointment total: $113.00 CAD', 'Deposit applied: -$15.00 CAD', 'Other payments: $10.00 CAD', 'Estimated remaining balance: $88.00 CAD']));
  });

  it('uses the frozen USD identity instead of a hardcoded dollar assumption', () => {
    expect(buildBookingFinancialSmsLines(financialSummary({
      currency: 'USD',
      serviceInvoiceTotalCents: 5075,
      totalDueCents: 5075,
      balanceCents: 5075,
    }))).toEqual([
      'Estimated appointment total: $50.75 USD',
      'Already paid: $0.00 USD',
      'Estimated remaining balance: $50.75 USD',
    ]);
  });

  it('labels a forfeited deposit as retained instead of credited', () => {
    expect(buildBookingFinancialSmsLines(financialSummary({
      serviceInvoiceTotalCents: 0,
      totalDueCents: 0,
      collectedDepositCents: 2000,
      forfeitedDepositCents: 2000,
      balanceCents: 0,
      depositPresentationState: 'forfeited',
    }))).toContain('Deposit retained: $20.00 CAD');
  });

  it('suppresses definitive draft amounts when a deposit refund is unresolved', () => {
    const body = buildBookingFinancialSmsLines(financialSummary({
      collectedDepositCents: 4000,
      depositCreditAppliedCents: 4000,
      amountAlreadyPaidCents: 4000,
      balanceCents: 0,
      depositBlockedCode: 'DEPOSIT_REFUND_UNRESOLVED',
      depositPresentationState: 'blocked',
    })).join('\n');

    expect(body).toContain('Payment details: under review');
    expect(body).not.toMatch(/\$|Total:|Balance due:/u);
  });

  it('labels pending bookings as requests in queued internal alerts', async () => {
    queueSelectResults([{ updatedAt: new Date('2026-06-10T15:00:00Z'), status: 'pending' }]);
    await sendInternalBookingNotificationSms('salon_1', {
      appointmentId: 'appt_1',
      phone: '4165550198',
      salonName: 'Isla Nail Studio',
      clientName: 'Bob',
      clientPhone: '4165550198',
      services: ['Gel Manicure'],
      startTime: '2026-06-10T17:45:00Z',
      totalDurationMinutes: 60,
      financialSummary: null,
      technicianName: 'Daniela',
      timeZone: 'America/Toronto',
    });

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ variables: expect.objectContaining({ statusLabel: 'New booking request' }) }));
    expect(create).not.toHaveBeenCalled();
  });

  it('builds staff-triggered reminders with full appointment details and the secure link', () => {
    const message = buildAppointmentReminderMessage({
      phone: '4165550198',
      clientName: 'Bob',
      appointmentId: 'appt_1',
      salonName: 'Isla Nail Studio',
      startTime: '2026-07-22T21:00:00.000Z',
      hoursUntil: 3,
      kind: 'manual',
      services: ['BIAB Fill'],
      technicianName: 'Daniela',
      timeZone: 'America/Toronto',
      manageUrl: 'https://islanailsalon.com/en/isla/manage/token',
    });

    expect(message).toContain('Wed, Jul 22 at 5:00 PM');
    expect(message).toContain('Service: BIAB Fill');
    expect(message).toContain('Artist: Daniela');
    expect(message).toContain(
      'View, reschedule, or cancel: https://islanailsalon.com/en/isla/manage/token',
    );
  });

  it('rejects legacy referral sends instead of bypassing Luster credits', async () => {
    queueSelectResults([{ connectAccountSid: 'AC00000000000000000000000000000000', messagingServiceSid: null, phoneNumber: '+14165559999', status: 'active' }]);
    const sent = await sendReferralInvite('salon_1', {
      refereePhone: '2223334444',
      referrerName: 'Ava',
      salonName: 'Isla Nail Studio',
      salonCustomDomain: 'islanailsalon.com',
      referralId: 'ref_123',
    });

    expect(sent).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});
