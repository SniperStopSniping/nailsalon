/**
 * §14 test 15 — THE REAPER MATRIX, on real rows.
 *
 * The two properties this file exists to pin:
 *   1. `expire` succeeding does NOT prove non-payment — a form submitted moments
 *      before `expires_at` can still be settling — so the re-`GET` is mandatory
 *      and a `complete` session is left strictly alone for D5.
 *   2. The HARD LOCAL BACKSTOP resolves every provider failure mode without the
 *      provider's cooperation. Without it the only remedy for a saved 5xx replay,
 *      a deauthorized account or total unreachability is manual SQL in production.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import Stripe from 'stripe';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/core/redis/redisClient', () => ({
  isRedisAvailable: vi.fn(async () => false),
  redis: null,
}));

/* eslint-disable import/first */
import {
  DEPOSIT_LOCAL_FORCE_RELEASE_MINUTES,
  DEPOSIT_SETTLE_GRACE_SECONDS,
  reapExpiredDepositHolds,
} from './depositHoldReaper';
/* eslint-enable import/first */

const SALON_ID = 'salon_reap';
const TECH_ID = 'tech_reap';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let counter = 0;

const NOW = new Date('2099-06-01T12:00:00.000Z');

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

type StubOptions = {
  expire?: () => Promise<unknown>;
  retrieve?: () => Promise<unknown>;
  create?: () => Promise<unknown>;
};

function stubClient(options: StubOptions) {
  const expire = vi.fn(options.expire ?? (async () => ({ id: 'cs', status: 'expired' })));
  const retrieve = vi.fn(options.retrieve ?? (async () => ({ id: 'cs', status: 'expired' })));
  const create = vi.fn(options.create ?? (async () => {
    throw new Stripe.errors.StripeInvalidRequestError({
      type: 'invalid_request_error',
      message: 'expires_at must be in the future',
    });
  }));
  return {
    client: { checkout: { sessions: { expire, retrieve, create } } } as never,
    expire,
    retrieve,
    create,
  };
}

/** Seed a hold: the appointment row IS the hold, plus its deposit row. */
async function seedHold(args: {
  holdExpiresAt: Date;
  appointmentStatus?: string;
  depositStatus?: string;
  sessionId?: string | null;
}) {
  counter += 1;
  const appointmentId = `appt_reap_${counter}`;
  const depositId = `dep_reap_${counter}`;

  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId: SALON_ID,
    technicianId: TECH_ID,
    clientPhone: `41600000${String(counter).padStart(2, '0')}`,
    clientName: 'Hold Client',
    // Staggered per seed: two live holds on the same technician and start time
    // would trip 0066's appointment_tech_active_slot_unique — which is the
    // backstop doing its job, not something to work around.
    startTime: new Date(NOW.getTime() + 3 * 86_400_000 + counter * 7_200_000),
    endTime: new Date(NOW.getTime() + 3 * 86_400_000 + counter * 7_200_000 + 3_600_000),
    status: args.appointmentStatus ?? 'awaiting_payment',
    totalPrice: 4500,
    totalDurationMinutes: 60,
    depositHoldExpiresAt: args.holdExpiresAt,
  });
  await db.insert(schema.appointmentDepositSchema).values({
    id: depositId,
    salonId: SALON_ID,
    appointmentId,
    status: args.depositStatus ?? 'checkout_created',
    amountCents: 2500,
    currency: 'cad',
    stripeAccountId: 'acct_live',
    // Unique per seed: appointment_deposit_session_uniq is a real constraint.
    stripeCheckoutSessionId: args.sessionId === undefined ? `cs_seeded_${counter}` : args.sessionId,
    checkoutSuccessUrl: 'https://salon.example.com/deposit/return',
    checkoutCancelUrl: 'https://salon.example.com/deposit/cancel',
  });
  return { appointmentId, depositId };
}

async function readBack(ids: { appointmentId: string; depositId: string }) {
  const [appointment] = await db.select().from(schema.appointmentSchema)
    .where(eq(schema.appointmentSchema.id, ids.appointmentId));
  const [deposit] = await db.select().from(schema.appointmentDepositSchema)
    .where(eq(schema.appointmentDepositSchema.id, ids.depositId));
  return { appointment, deposit };
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Reaper Salon',
    slug: 'reaper-salon',
    ownerEmail: 'owner@example.com',
  });
  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'Daniela',
  });
}, 60_000);

let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.clearAllMocks();
  // The reaper logs once when the Redis lease is unavailable — which is the
  // designed degraded path, exercised by every test here. failOnConsole would
  // otherwise turn that intended diagnostic into a blanket failure.
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.rewardSchema);
  await db.delete(schema.appointmentSchema);
});

afterEach(() => {
  consoleWarn.mockRestore();
});

afterAll(async () => {
  await client.close();
});

describe('15 — the reaper matrix', () => {
  it('(a) expired hold, expire OK + retrieve expired -> cancelled, deposit expired', async () => {
    const ids = await seedHold({ holdExpiresAt: minutesAgo(10) });
    const { client: stub } = stubClient({});

    const summary = await reapExpiredDepositHolds({ client: stub, now: NOW });
    const after = await readBack(ids);

    expect(summary.finalized).toBe(1);
    expect(after.appointment!.status).toBe('cancelled');
    expect(after.appointment!.cancelReason).toBe('deposit_not_paid');
    expect(after.appointment!.canvasState).toBe('cancelled');
    expect(after.deposit!.status).toBe('expired');
  });

  it('an abandoned attributed hold releases the reservation without marking the reward', async () => {
    const ids = await seedHold({ holdExpiresAt: minutesAgo(10) });
    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, ids.appointmentId));
    await db.insert(schema.rewardSchema).values({
      id: 'reward_abandoned_hold',
      salonId: SALON_ID,
      clientPhone: appointment!.clientPhone,
      type: 'referral_referee',
    });
    await db.update(schema.appointmentDepositSchema)
      .set({
        appliedRewardId: 'reward_abandoned_hold',
        appliedRewardClientId: 'client_abandoned_hold',
        appliedRewardClientPhone: appointment!.clientPhone,
      })
      .where(eq(schema.appointmentDepositSchema.id, ids.depositId));

    await reapExpiredDepositHolds({ client: stubClient({}).client, now: NOW });

    const after = await readBack(ids);
    const [reward] = await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_abandoned_hold'));

    expect(after.deposit?.status).toBe('expired');
    expect(after.deposit?.appliedRewardId).toBe('reward_abandoned_hold');
    expect(reward?.usedInAppointmentId).toBeNull();
  });

  it('(b) expire OK but retrieve says COMPLETE -> untouched (payment landed)', async () => {
    const ids = await seedHold({ holdExpiresAt: minutesAgo(10) });
    const { client: stub } = stubClient({
      retrieve: async () => ({ id: 'cs', status: 'complete' }),
    });

    const summary = await reapExpiredDepositHolds({ client: stub, now: NOW });
    const after = await readBack(ids);

    // `expire` succeeding does not prove non-payment. This is why the re-GET is
    // mandatory rather than an optimisation.
    expect(summary.finalized).toBe(0);
    expect(after.appointment!.status).toBe('awaiting_payment');
    expect(after.deposit!.status).toBe('checkout_created');
  });

  it('(c) expire says NOT OPEN + retrieve COMPLETE -> untouched', async () => {
    const ids = await seedHold({ holdExpiresAt: minutesAgo(10) });
    const { client: stub, retrieve } = stubClient({
      expire: async () => {
        throw new Stripe.errors.StripeInvalidRequestError({
          type: 'invalid_request_error',
          message: 'You cannot expire a Checkout Session that is not open',
        });
      },
      retrieve: async () => ({ id: 'cs', status: 'complete' }),
    });

    await reapExpiredDepositHolds({ client: stub, now: NOW });
    const after = await readBack(ids);

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(after.appointment!.status).toBe('awaiting_payment');
  });

  it('(d) NULL-session hold whose probe throws idempotency_error -> still a hold', async () => {
    const ids = await seedHold({ holdExpiresAt: minutesAgo(10), sessionId: null });
    const { client: stub } = stubClient({
      create: async () => {
        throw new Stripe.errors.StripeIdempotencyError({
          type: 'idempotency_error',
          message: 'Keys for idempotent requests can only be used with the same parameters',
        });
      },
    });

    await reapExpiredDepositHolds({ client: stub, now: NOW });
    const after = await readBack(ids);

    // NEVER infer "no session exists" from an error: an idempotency_error proves
    // the OPPOSITE — a request under this key already reached Stripe.
    expect(after.appointment!.status).toBe('awaiting_payment');
    expect(after.deposit!.status).toBe('checkout_created');
  });

  it('(e) a permanent auth error finalizes on the first run past the deadline', async () => {
    const ids = await seedHold({ holdExpiresAt: minutesAgo(10) });
    const { client: stub } = stubClient({
      expire: async () => {
        throw new Stripe.errors.StripeAuthenticationError({
          type: 'authentication_error',
          message: 'Invalid API key',
        });
      },
    });

    await reapExpiredDepositHolds({ client: stub, now: NOW });
    const after = await readBack(ids);

    // Past expires_at Stripe has already auto-expired the session, so this is
    // safe — and it is the only way such a hold ever resolves.
    expect(after.appointment!.status).toBe('cancelled');
    expect(after.deposit!.status).toBe('expired');
    expect(after.deposit!.resolutionNote).toContain('permanent provider error');
  });

  it('(f) a 500 on every call finalizes only past the HARD BACKSTOP', async () => {
    const boom = async () => {
      throw new Stripe.errors.StripeAPIError({ type: 'api_error', message: 'server error' });
    };

    // Just past the grace but well inside the backstop: hold survives.
    const early = await seedHold({ holdExpiresAt: minutesAgo(10) });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await reapExpiredDepositHolds({
      client: stubClient({ expire: boom, retrieve: boom }).client,
      now: NOW,
    });

    expect((await readBack(early)).appointment!.status).toBe('awaiting_payment');

    // Past the backstop: finalized regardless of what Stripe says.
    const late = await seedHold({
      holdExpiresAt: minutesAgo(DEPOSIT_LOCAL_FORCE_RELEASE_MINUTES + 30),
    });
    await reapExpiredDepositHolds({
      client: stubClient({ expire: boom, retrieve: boom }).client,
      now: NOW,
    });
    consoleError.mockRestore();

    const afterLate = await readBack(late);

    expect(afterLate.appointment!.status).toBe('cancelled');
    expect(afterLate.deposit!.status).toBe('expired');
    expect(afterLate.deposit!.resolutionNote).toContain('forced release');
  });

  it('(g) a PAID deposit is untouched even when every Stripe call throws', async () => {
    const boom = async () => {
      throw new Error('provider exploded');
    };
    const ids = await seedHold({ holdExpiresAt: minutesAgo(10), depositStatus: 'paid' });

    const summary = await reapExpiredDepositHolds({
      client: stubClient({ expire: boom, retrieve: boom, create: boom }).client,
      now: NOW,
    });
    const after = await readBack(ids);

    // The guarantee is LOCAL: eligibility joins on a 'checkout_created' deposit,
    // so a paid one is never even scanned. No network call can change that.
    expect(summary.scanned).toBe(0);
    expect(after.appointment!.status).toBe('awaiting_payment');
    expect(after.deposit!.status).toBe('paid');
  });

  it('(h) a not-yet-due hold and one inside SETTLE_GRACE are both untouched', async () => {
    const notDue = await seedHold({ holdExpiresAt: new Date(NOW.getTime() + 10 * 60_000) });
    const inGrace = await seedHold({
      holdExpiresAt: new Date(NOW.getTime() - (DEPOSIT_SETTLE_GRACE_SECONDS - 30) * 1000),
    });

    const summary = await reapExpiredDepositHolds({ client: stubClient({}).client, now: NOW });

    expect(summary.scanned).toBe(0);
    expect((await readBack(notDue)).appointment!.status).toBe('awaiting_payment');
    expect((await readBack(inGrace)).appointment!.status).toBe('awaiting_payment');
  });

  it('(j) a stranded deposit behind a cancelled appointment is HEALED', async () => {
    const ids = await seedHold({
      holdExpiresAt: minutesAgo(30),
      appointmentStatus: 'cancelled',
      depositStatus: 'checkout_created',
    });

    const summary = await reapExpiredDepositHolds({ client: stubClient({}).client, now: NOW });
    const after = await readBack(ids);

    // Nothing else can find these: every eligibility scan keys on the
    // APPOINTMENT status, so a row stranded by a crash would live forever.
    expect(summary.healed).toBe(1);
    expect(after.deposit!.status).toBe('expired');
    expect(after.deposit!.resolutionNote).toContain('healed');
  });

  it('(k) CAS race: the hold flips to confirmed between scan and write -> untouched', async () => {
    const ids = await seedHold({ holdExpiresAt: minutesAgo(10) });
    const { client: stub } = stubClient({
      // Simulate D5's confirm landing after the scan but before the CAS.
      expire: async () => {
        await db.update(schema.appointmentSchema)
          .set({ status: 'confirmed' })
          .where(eq(schema.appointmentSchema.id, ids.appointmentId));
        return { id: 'cs', status: 'expired' };
      },
    });

    await reapExpiredDepositHolds({ client: stub, now: NOW });
    const after = await readBack(ids);

    // The appointment CAS matches zero rows, so the whole transaction rolls
    // back and the deposit is NOT terminalised behind a now-live booking.
    expect(after.appointment!.status).toBe('confirmed');
    expect(after.deposit!.status).toBe('checkout_created');
  });

  it('runs without a Redis lease rather than silently stopping', async () => {
    // isRedisAvailable is hard-mocked false here, exactly as in the real-Postgres
    // suite. A lease-REQUIRED reaper would stop reaping in precisely the
    // degraded conditions where holds pile up.
    const ids = await seedHold({ holdExpiresAt: minutesAgo(10) });

    const summary = await reapExpiredDepositHolds({ client: stubClient({}).client, now: NOW });

    expect(consoleWarn).toHaveBeenCalled();
    expect(summary.leaseAcquired).toBe(false);
    expect(summary.finalized).toBe(1);
    expect((await readBack(ids)).appointment!.status).toBe('cancelled');
  });
});

/**
 * §14 test 15(i) — the finalize is ONE transaction.
 *
 * Two loose statements would let a crash between them leave a permanently
 * non-terminal deposit row attached to a cancelled appointment that no sweep
 * could ever find, because every eligibility scan keys on the APPOINTMENT
 * status. So a failing deposit UPDATE must roll the appointment back too.
 */
describe('15(i) — finalize atomicity', () => {
  it('a failing deposit write leaves the appointment UNCANCELLED, and a retry converges', async () => {
    const ids = await seedHold({ holdExpiresAt: minutesAgo(10) });

    // Force the SECOND statement of the finalize transaction to throw. It runs
    // on the TRANSACTION handle, not on `db`, so the handle is what gets
    // patched — spying on `db.update` would miss it entirely and hit the
    // healing sweep instead.
    const realTransaction = db.transaction.bind(db);
    let failNext = true;
    const transactionSpy = vi.spyOn(db, 'transaction').mockImplementation((async (
      callback: (tx: unknown) => Promise<unknown>,
      ...rest: unknown[]
    ) => realTransaction((async (tx: Record<string, unknown>) => {
      const patched = new Proxy(tx, {
        get(target, prop, receiver) {
          if (prop === 'update') {
            return (table: unknown) => {
              if (failNext && table === schema.appointmentDepositSchema) {
                failNext = false;
                throw new Error('deposit update exploded');
              }
              return (target.update as (t: unknown) => unknown)(table);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      return callback(patched);
    }) as never, ...(rest as []))) as typeof db.transaction);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await reapExpiredDepositHolds({ client: stubClient({}).client, now: NOW });
    consoleError.mockRestore();
    transactionSpy.mockRestore();

    const afterFailure = await readBack(ids);

    // Rolled back as a unit — no half-finalized state.
    expect(afterFailure.appointment!.status).toBe('awaiting_payment');
    expect(afterFailure.deposit!.status).toBe('checkout_created');

    // The next run converges to BOTH writes.
    await reapExpiredDepositHolds({ client: stubClient({}).client, now: NOW });
    const afterRetry = await readBack(ids);

    expect(afterRetry.appointment!.status).toBe('cancelled');
    expect(afterRetry.deposit!.status).toBe('expired');
  });

  it('rolls the appointment back when the paired deposit CAS returns zero rows', async () => {
    const ids = await seedHold({ holdExpiresAt: minutesAgo(10) });
    const realTransaction = db.transaction.bind(db);
    let emptyNextDepositReturning = true;
    const transactionSpy = vi.spyOn(db, 'transaction').mockImplementation((async (
      callback: (tx: unknown) => Promise<unknown>,
      ...rest: unknown[]
    ) => realTransaction((async (tx: Record<string, unknown>) => {
      const patched = new Proxy(tx, {
        get(target, prop, receiver) {
          if (prop !== 'update') {
            return Reflect.get(target, prop, receiver);
          }
          return (table: unknown) => {
            const builder = (target.update as (t: unknown) => {
              set: (values: unknown) => { where: (condition: unknown) => { returning: () => unknown } };
            })(table);
            if (!emptyNextDepositReturning || table !== schema.appointmentDepositSchema) {
              return builder;
            }
            emptyNextDepositReturning = false;
            return {
              set: (values: unknown) => {
                const setBuilder = builder.set(values);
                return {
                  where: (condition: unknown) => {
                    // Build the real predicate so this proxy still exercises
                    // the production query shape; only its returned rows are
                    // replaced to simulate a lost CAS.
                    setBuilder.where(condition);
                    return { returning: vi.fn(async () => []) };
                  },
                };
              },
            };
          };
        },
      });
      return callback(patched);
    }) as never, ...(rest as []))) as typeof db.transaction);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await reapExpiredDepositHolds({ client: stubClient({}).client, now: NOW });
    consoleError.mockRestore();
    transactionSpy.mockRestore();

    const after = await readBack(ids);

    expect(after.appointment!.status).toBe('awaiting_payment');
    expect(after.deposit!.status).toBe('checkout_created');
  });
});
