import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const boundaries = vi.hoisted(() => ({
  db: {
    execute: vi.fn(async () => []),
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(async () => []) })),
    })),
    transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({})),
    update: vi.fn(),
  },
  enqueueGoogleCalendarAppointmentMutation: vi.fn(async () => ({ inserted: true })),
  enqueueGoogleCalendarUpsert: vi.fn(async () => ({ inserted: true })),
  sendBookingConfirmationToClient: vi.fn(async () => ({ success: true })),
  sendBookingNotificationsForNewBooking: vi.fn(async () => {}),
  sendCustomerBookingConfirmationEmail: vi.fn(async () => ({ delivered: true })),
  sendSalonNotificationEmail: vi.fn(async () => ({ status: 'sent', deliveryId: 'delivery_1' })),
}));

vi.mock('@/libs/DB', () => ({ db: boundaries.db }));
vi.mock('@/libs/integrationOutbox', () => ({
  enqueueGoogleCalendarAppointmentMutation: boundaries.enqueueGoogleCalendarAppointmentMutation,
  enqueueGoogleCalendarUpsert: boundaries.enqueueGoogleCalendarUpsert,
}));
vi.mock('@/libs/customerBookingEmail', () => ({
  sendCustomerBookingConfirmationEmail: boundaries.sendCustomerBookingConfirmationEmail,
}));
vi.mock('@/libs/SMS', () => ({
  sendBookingConfirmationToClient: boundaries.sendBookingConfirmationToClient,
}));
vi.mock('@/libs/bookingNotifications', () => ({
  sendBookingNotificationsForNewBooking: boundaries.sendBookingNotificationsForNewBooking,
}));
vi.mock('@/libs/salonNotificationEmail', () => ({
  sendSalonNotificationEmail: boundaries.sendSalonNotificationEmail,
}));
vi.mock('@/libs/queries', () => ({
  getAppointmentServiceNames: vi.fn(async () => []),
  getTechnicianById: vi.fn(async () => null),
}));

/* eslint-disable import/first */
import {
  type BookingCommitEffectsContext,
  runBookingCommitSideEffects,
} from './bookingCommitEffects';
/* eslint-enable import/first */

const context = {
  salon: {
    id: 'salon_1',
    name: 'Scope Clean Salon',
    ownerName: null,
    ownerPhone: null,
    ownerEmail: null,
    features: null,
    settings: { booking: { timezone: 'America/Toronto' } },
  },
  salonClientId: 'client_1',
  clientPhone: '4165550100',
  clientName: 'Calendar Client',
  appointment: {
    id: 'appointment_1',
    notes: null,
    googleCalendarEventId: null,
    updatedAt: new Date('2099-02-01T15:00:00.000Z'),
    status: 'confirmed',
  },
  serviceNames: ['Manicure'],
  technician: null,
  startTime: new Date('2099-02-02T15:00:00.000Z'),
  endTime: new Date('2099-02-02T16:00:00.000Z'),
  totalPrice: 5000,
  totalDurationMinutes: 60,
  timeZone: 'America/Toronto',
  manageUrl: 'https://example.test/manage/token',
  smsConsentGranted: true,
  actorRole: 'client',
  originalAppointment: null,
  googleCalendarSyncEligible: true,
  locationName: null,
  locationAddress: null,
} as BookingCommitEffectsContext;

describe('scope-clean booking-effect compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('preserves calendarAlreadyEnqueued behavior', async () => {
    await runBookingCommitSideEffects(context, { calendarAlreadyEnqueued: true });

    expect(boundaries.enqueueGoogleCalendarAppointmentMutation).not.toHaveBeenCalled();
    expect(boundaries.enqueueGoogleCalendarUpsert).not.toHaveBeenCalled();
    expect(boundaries.sendCustomerBookingConfirmationEmail.mock.invocationCallOrder[0])
      .toBeLessThan(boundaries.sendBookingConfirmationToClient.mock.invocationCallOrder[0]!);
    expect(boundaries.sendBookingConfirmationToClient.mock.invocationCallOrder[0])
      .toBeLessThan(boundaries.sendSalonNotificationEmail.mock.invocationCallOrder[0]!);
  });

  it('preserves calendarCause identity behavior', async () => {
    await runBookingCommitSideEffects(context, {
      calendarCause: { kind: 'deposit_confirmation', parentJobId: 'confirmation_job_1' },
    });

    expect(boundaries.enqueueGoogleCalendarUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: context.appointment.id }),
      {
        cause: { kind: 'deposit_confirmation', parentJobId: 'confirmation_job_1' },
        mutationVersion: context.appointment.updatedAt,
      },
    );
  });

  it('preserves abort-timing behavior', async () => {
    const controller = new AbortController();
    controller.abort(new Error('parent worker stopped'));

    await expect(runBookingCommitSideEffects(context, { signal: controller.signal }))
      .rejects.toThrow('parent worker stopped');
    expect(boundaries.db.execute).not.toHaveBeenCalled();
    expect(boundaries.enqueueGoogleCalendarUpsert).not.toHaveBeenCalled();
  });
});
