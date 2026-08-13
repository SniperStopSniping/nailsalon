import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  db,
  enqueueGoogleCalendarAppointmentMutation,
  guardModuleOr403,
  requireClientApiSession,
  requireClientSalonFromBody,
} = vi.hoisted(() => ({
  enqueueGoogleCalendarAppointmentMutation: vi.fn(async () => ({ inserted: true })),
  guardModuleOr403: vi.fn(async () => null),
  requireClientApiSession: vi.fn(async () => ({
    ok: true,
    normalizedPhone: '4165551234',
    session: { phone: '+14165551234' },
  })),
  requireClientSalonFromBody: vi.fn(async () => ({
    ok: true,
    salon: { id: 'salon_1', slug: 'salon-a', rewardsEnabled: true },
  })),
  db: {
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('@/libs/clientApiGuards', () => ({
  requireClientApiSession,
  requireClientSalonFromBody,
}));
vi.mock('@/libs/featureGating', () => ({ guardModuleOr403 }));
vi.mock('@/libs/integrationOutbox', () => ({ enqueueGoogleCalendarAppointmentMutation }));
vi.mock('@/libs/DB', () => ({ db }));

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const reward = {
  id: 'reward_1',
  salonId: 'salon_1',
  clientPhone: '4165551234',
  status: 'active',
  type: 'referral_referee',
  discountAmountCents: 500,
  expiresAt: null,
  usedInAppointmentId: null,
};
const appointment = {
  id: 'appt_1',
  salonId: 'salon_1',
  clientPhone: '4165551234',
  status: 'confirmed',
  totalPrice: 5000,
  discountType: null,
  notes: null,
  updatedAt: new Date('2099-01-01T00:00:00.000Z'),
};
const pricedAppointment = {
  ...appointment,
  totalPrice: 4500,
  updatedAt: new Date('2099-01-01T00:00:00.001Z'),
};
let lockedReward = reward;
let transactionUpdate = vi.fn();

function limitSelection(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit: vi.fn(async () => rows) })),
    })),
  };
}

function rowsSelection(rows: unknown[]) {
  return {
    from: vi.fn(() => ({ where: vi.fn(async () => rows) })),
  };
}

function request() {
  return new Request('http://localhost/api/rewards/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rewardId: reward.id, appointmentId: appointment.id, salonSlug: 'salon-a' }),
  });
}

describe('reward redemption Calendar mutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockedReward = reward;
    const selections = [
      limitSelection([reward]),
      limitSelection([appointment]),
      limitSelection([]),
      rowsSelection([{ serviceId: 'service_1', priceAtBooking: 5000 }]),
      rowsSelection([{ id: 'service_1', name: 'Manicure', price: 5000 }]),
    ];
    db.select.mockImplementation(() => selections.shift());
    db.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => {
      const lockedSelections = [[appointment], [], [lockedReward]];
      transactionUpdate = vi.fn()
        .mockReturnValueOnce({
          set: vi.fn(() => ({
            where: vi.fn(() => ({ returning: vi.fn(async () => [pricedAppointment]) })),
          })),
        })
        .mockReturnValueOnce({
          set: vi.fn(() => ({
            where: vi.fn(() => ({ returning: vi.fn(async () => [lockedReward]) })),
          })),
        });
      const tx = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => {
              const rows = lockedSelections.shift() ?? [];
              return {
                for: vi.fn(() => ({ limit: vi.fn(async () => rows) })),
                limit: vi.fn(async () => rows),
              };
            }),
          })),
        })),
        update: transactionUpdate,
      };
      return work(tx);
    });
  });

  it('atomically enqueues the winning appointment revision with the price mutation', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(enqueueGoogleCalendarAppointmentMutation).toHaveBeenCalledWith(
      expect.anything(),
      {
        appointmentId: pricedAppointment.id,
        salonId: pricedAppointment.salonId,
        mutationVersion: pricedAppointment.updatedAt,
      },
    );
  });

  it('rejects a reward that becomes unavailable after the advisory read', async () => {
    lockedReward = { ...reward, status: 'used' };

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(transactionUpdate).not.toHaveBeenCalled();
    expect(enqueueGoogleCalendarAppointmentMutation).not.toHaveBeenCalled();
  });
});
