import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  acquireGoogleCalendarMutationBarrierInTx,
  db,
  recordGoogleEventReviewDecision,
  requireAdminSalon,
} = vi.hoisted(() => ({
  acquireGoogleCalendarMutationBarrierInTx: vi.fn(async () => false),
  recordGoogleEventReviewDecision: vi.fn(),
  requireAdminSalon: vi.fn(async () => ({
    error: null,
    salon: { id: 'salon_google_revert' },
  })),
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon }));
vi.mock('@/libs/googleEventReview', () => ({ recordGoogleEventReviewDecision }));
vi.mock('@/libs/integrationOutbox', () => ({ acquireGoogleCalendarMutationBarrierInTx }));

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const appointment = {
  id: 'appt_google_revert',
  salonId: 'salon_google_revert',
  status: 'confirmed',
  updatedAt: new Date('2099-11-01T13:00:00.000Z'),
};
const event = {
  id: 'gce_google_revert',
  salonId: 'salon_google_revert',
  appointmentId: appointment.id,
  reviewStatus: 'appointment',
  sourceAccessRole: 'owner',
  title: 'Converted appointment',
  transparency: 'busy',
};

function selection(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => rows),
      })),
    })),
  };
}

describe('Google event revert D5 ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.select.mockReturnValue(selection([event]));
    db.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work({}));
    acquireGoogleCalendarMutationBarrierInTx.mockResolvedValue(false);
  });

  it('fails closed without mutating while a Calendar provider attempt is in flight', async () => {
    const response = await POST(new Request(
      `http://localhost/api/admin/google-events/${event.id}/revert`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonSlug: 'google-revert-salon' }),
      },
    ), { params: Promise.resolve({ id: event.id }) });

    expect(response.status).toBe(409);
    expect(acquireGoogleCalendarMutationBarrierInTx).toHaveBeenCalledWith(
      expect.anything(),
      { appointmentId: appointment.id, salonId: appointment.salonId },
    );
    expect(recordGoogleEventReviewDecision).not.toHaveBeenCalled();
  });
});
