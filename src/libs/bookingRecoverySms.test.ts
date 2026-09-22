/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveContact, resolvePhoneRecipient, enqueue, select } = vi.hoisted(() => ({
  resolveContact: vi.fn(),
  resolvePhoneRecipient: vi.fn(),
  enqueue: vi.fn(),
  select: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/clientLifecycleStabilization', () => ({
  resolveOperationalSalonClientContact: resolveContact,
  resolveAppointmentOperationalPhoneRecipient: resolvePhoneRecipient,
}));
vi.mock('@/libs/communicationIntent', () => ({ enqueueCommunicationIntent: enqueue }));
vi.mock('@/libs/DB', () => ({ db: { select } }));

import { queueBookingRecoverySms } from './bookingRecoverySms';

const NOW = new Date('2026-09-22T12:03:00.000Z');

function selectRows(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

function salonSelect(settings: Record<string, unknown> | null = null, appointments: unknown[] = [{ salonClientId: 'terminal_1', clientPhone: '4165550101', clientEmail: null }]) {
  select.mockReturnValueOnce(selectRows([{ settings, smsRemindersEnabled: true }]));
  for (const appointment of appointments) {
    select.mockReturnValueOnce(selectRows([appointment]));
  }
}

describe('queueBookingRecoverySms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enqueue.mockResolvedValue({ intentId: 'ci_1', created: true });
    resolvePhoneRecipient.mockResolvedValue({ status: 'terminal_current', terminalClientId: 'terminal_1', phone: '4165550101' });
  });

  it('queues canonical phone recovery without an email destination', async () => {
    salonSelect();
    resolveContact.mockResolvedValue({ id: 'terminal_1', phone: '4165550101', email: null });

    await expect(queueBookingRecoverySms({
      salonId: 'salon_a',
      terminalClientId: 'terminal_1',
      appointments: [{ id: 'appointment_a' }],
      now: NOW,
    })).resolves.toEqual({ queued: true });

    expect(resolveContact).toHaveBeenCalledWith({ salonId: 'salon_a', clientId: 'terminal_1', allowArchived: true });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_a',
      appointmentId: 'appointment_a',
      recipient: '4165550101',
      eventType: 'booking_recovery',
      variables: { clientId: 'terminal_1', manageUrl: 'pending' },
    }));
  });

  it('queues an orphan only to the recovery selector-provided snapshot phone', async () => {
    salonSelect();
    resolvePhoneRecipient.mockResolvedValue({ status: 'appointment_snapshot', terminalClientId: null, phone: '6475550102', identityResolution: 'zero_identity_candidates' });
    await queueBookingRecoverySms({
      salonId: 'salon_a',
      recipientPhone: '6475550102',
      appointments: [{ id: 'orphan_a' }],
      now: NOW,
    });

    expect(resolveContact).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_a',
      appointmentId: 'orphan_a',
      recipient: '6475550102',
      variables: { manageUrl: 'pending' },
    }));
  });

  it('scopes every queued appointment and dedupe key to its supplied salon', async () => {
    salonSelect(null, [{}, {}]);
    resolveContact.mockResolvedValue({ id: 'terminal_1', phone: '4165550101', email: null });

    await queueBookingRecoverySms({
      salonId: 'salon_b',
      terminalClientId: 'terminal_1',
      appointments: [{ id: 'appointment_b1' }, { id: 'appointment_b2' }],
      now: NOW,
    });

    expect(enqueue.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({ salonId: 'salon_b', appointmentId: 'appointment_b1', dedupeKey: 'sms:booking-recovery:salon_b:appointment_b1:1790078400000' }),
      expect.objectContaining({ salonId: 'salon_b', appointmentId: 'appointment_b2', dedupeKey: 'sms:booking-recovery:salon_b:appointment_b2:1790078400000' }),
    ]);
  });
});
