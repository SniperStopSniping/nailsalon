/**
 * D4 §5.2 — THE STAFF-TRANSITION HOLD FENCE, on real rows.
 *
 * This is the Critical payment-bypass fence. Without it the route gates only on
 * `canvas_state` and CASes against the row's own status, so the assigned
 * technician could drive a hold waiting -> working (status becomes
 * 'in_progress') in a single API call and then complete it: an unpaid deposit
 * booking served, the deposit row stranded at 'checkout_created' forever
 * because the reaper keys on status='awaiting_payment', and D5's confirm CAS
 * mis-routed to its late-payment branch.
 *
 * [P] tier deliberately: the route's own transaction and CAS run against real
 * SQL, so "the hold was not mutated" is an assertion about committed state
 * rather than about a mock's call log.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  /** What the PRE-READ reports. Deliberately separable from the DB row. */
  access: null as unknown,
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/staffApiGuards', () => ({
  requireStaffAppointmentAccess: vi.fn(async () => holder.access),
}));

vi.mock('@/libs/appointmentAudit', () => ({
  logAppointmentChange: vi.fn(async () => {}),
  logAppointmentLocked: vi.fn(async () => {}),
}));

vi.mock('@/libs/integrationOutbox', () => ({
  enqueueGoogleCalendarDelete: vi.fn(async () => {}),
  enqueueGoogleCalendarDeleteInTx: vi.fn(async () => ({ inserted: true })),
}));

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_fence';
const TECH_ID = 'tech_fence';
const APPT_ID = 'appt_fence';
const DEPOSIT_ID = 'dep_fence';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

const START = new Date('2099-08-01T14:00:00.000Z');
const END = new Date('2099-08-01T15:00:00.000Z');

/** The shape the route reads off the pre-read; status is a parameter on purpose. */
function accessFor(status: string, canvasState: string | null = 'waiting') {
  return {
    ok: true,
    session: { salonId: SALON_ID, technicianId: TECH_ID, technicianName: 'Daniela' },
    appointment: {
      id: APPT_ID,
      salonId: SALON_ID,
      salonClientId: null,
      technicianId: TECH_ID,
      clientPhone: '4165550000',
      clientEmail: null,
      startTime: START,
      endTime: END,
      blockedDurationMinutes: 60,
      totalDurationMinutes: 60,
      bufferMinutes: 0,
      status,
      canvasState,
      startedAt: null,
      completedAt: null,
      lockedAt: null,
      googleCalendarEventId: null,
    },
  };
}

function transitionRequest(to: string) {
  return new Request(`http://localhost/api/appointments/${APPT_ID}/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to }),
  });
}

/** Seed the appointment row itself at an arbitrary status. */
async function seedAppointment(status: string, canvasState: string | null = 'waiting') {
  await db.insert(schema.appointmentSchema).values({
    id: APPT_ID,
    salonId: SALON_ID,
    technicianId: TECH_ID,
    clientPhone: '4165550000',
    clientName: 'Hold Client',
    startTime: START,
    endTime: END,
    status,
    canvasState: canvasState as never,
    totalPrice: 4500,
    totalDurationMinutes: 60,
    ...(status === 'awaiting_payment'
      ? { depositHoldExpiresAt: new Date(Date.now() + 30 * 60_000) }
      : {}),
  });
  await db.insert(schema.appointmentDepositSchema).values({
    id: DEPOSIT_ID,
    salonId: SALON_ID,
    appointmentId: APPT_ID,
    status: 'checkout_created',
    amountCents: 2500,
    currency: 'cad',
    stripeAccountId: 'acct_live',
  });
}

async function readBack() {
  const [appointment] = await db.select().from(schema.appointmentSchema)
    .where(eq(schema.appointmentSchema.id, APPT_ID));
  const [deposit] = await db.select().from(schema.appointmentDepositSchema)
    .where(eq(schema.appointmentDepositSchema.id, DEPOSIT_ID));
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
    name: 'Fence Salon',
    slug: 'fence-salon',
    ownerEmail: 'owner@example.com',
  });
  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'Daniela',
  });
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.rewardSchema);
  await db.delete(schema.appointmentSchema);
});

afterAll(async () => {
  await client.close();
});

/**
 * The three legs the charter names. `working` is the payment-bypass one — it
 * sets status='in_progress' and would let the appointment be completed — but
 * `cancelled` and `no_show` are equally forbidden: they would strand the
 * deposit outside the reaper's `status='awaiting_payment'` eligibility scan.
 */
describe('§5.2 — the staff transition route refuses a hold', () => {
  it.each([['working'], ['cancelled'], ['no_show']])(
    'to:%s against a hold -> 409 HOLD_LOCKED, nothing mutated',
    async (to) => {
      await seedAppointment('awaiting_payment');
      holder.access = accessFor('awaiting_payment');

      const response = await POST(transitionRequest(to), { params: Promise.resolve({ id: APPT_ID }) });
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error.code).toBe('HOLD_LOCKED');

      const after = await readBack();

      // Status AND canvas_state both untouched — the route keeps the two
      // columns in lockstep, so a half-applied transition is as bad as a full one.
      expect(after.appointment!.status).toBe('awaiting_payment');
      expect(after.appointment!.canvasState).toBe('waiting');
      expect(after.appointment!.startedAt).toBeNull();
      expect(after.appointment!.completedAt).toBeNull();
      expect(after.appointment!.lockedAt).toBeNull();
      // The deposit is left for D5/the reaper, not stranded by this route.
      expect(after.deposit!.status).toBe('checkout_created');
    },
  );

  it('the refusal precedes the policy check, so it cannot be masked', async () => {
    // A hold whose canvas_state would ALSO be refused by the state machine must
    // still answer HOLD_LOCKED, not TRANSITION_BLOCKED — otherwise the fence's
    // own test could pass for the wrong reason at a salon with photo policies.
    await seedAppointment('awaiting_payment');
    holder.access = accessFor('awaiting_payment');

    const response = await POST(transitionRequest('working'), { params: Promise.resolve({ id: APPT_ID }) });
    const body = await response.json();

    expect(body.error.code).toBe('HOLD_LOCKED');
    expect(body.error.reason).toBe('hold_locked');
  });

  it('CONTROL: a non-hold appointment still transitions normally', async () => {
    // Without this the suite would pass just as well against a route that
    // refused everything.
    await seedAppointment('confirmed');
    holder.access = accessFor('confirmed');

    const response = await POST(transitionRequest('cancelled'), { params: Promise.resolve({ id: APPT_ID }) });

    expect(response.status).toBe(200);

    const after = await readBack();

    expect(after.appointment!.status).toBe('cancelled');
    expect(after.appointment!.canvasState).toBe('cancelled');
  });

  it.each([['cancelled'], ['no_show']])(
    'to:%s releases only the exact ordinary reward link in the transition transaction',
    async (to) => {
      await seedAppointment('confirmed');
      holder.access = accessFor('confirmed');
      await db.insert(schema.rewardSchema).values([
        {
          id: `reward_staff_decoy_${to}`,
          salonId: SALON_ID,
          clientPhone: '4165550000',
          type: 'referral_referee',
          discountType: 'fixed_amount',
          discountAmountCents: 1000,
        },
        {
          id: `reward_staff_exact_${to}`,
          salonId: SALON_ID,
          clientPhone: '4165550000',
          type: 'referral_referee',
          discountType: 'fixed_amount',
          discountAmountCents: 1000,
          usedInAppointmentId: APPT_ID,
        },
      ]);

      const response = await POST(transitionRequest(to), { params: Promise.resolve({ id: APPT_ID }) });

      expect(response.status).toBe(200);
      expect((await db.select().from(schema.rewardSchema)
        .where(eq(schema.rewardSchema.id, `reward_staff_exact_${to}`)))[0]?.usedInAppointmentId)
        .toBeNull();
      expect((await db.select().from(schema.rewardSchema)
        .where(eq(schema.rewardSchema.id, `reward_staff_decoy_${to}`)))[0]?.usedInAppointmentId)
        .toBeNull();
    },
  );
});

/**
 * THE CAS RACE — the second layer.
 *
 * The pre-read is stale: it reports a non-hold while the committed row has
 * since become a hold. The in-transaction CAS is what must refuse, and the row
 * must come out untouched.
 *
 * A note on falsifiability, stated plainly rather than papered over: with the
 * pre-read guard in place, `ne(status,'awaiting_payment')` is DEFENCE IN DEPTH
 * and cannot be made independently red by any request this route accepts. The
 * only scenario in which it is the sole discriminator is one where the pre-read
 * itself reported 'awaiting_payment' — and that is exactly what the pre-read
 * guard already refuses. Its value is precisely that it survives deletion of
 * the first layer, so it is pinned two ways: this behavioural leg (which reddens
 * if the CAS stops guarding status at all) and an explicit source assertion
 * below (which reddens the moment the conjunct is deleted).
 */
describe('§5.2 — the CAS refuses a row that became a hold after the pre-read', () => {
  it('a stale non-hold pre-read cannot move a committed hold', async () => {
    await seedAppointment('awaiting_payment');
    // The pre-read says 'confirmed'; the row is really a hold. Refused by the
    // in-transaction staleness check before the CAS is even reached.
    holder.access = accessFor('confirmed');

    const response = await POST(transitionRequest('cancelled'), { params: Promise.resolve({ id: APPT_ID }) });

    expect(response.status).toBe(409);

    const after = await readBack();

    expect(after.appointment!.status).toBe('awaiting_payment');
    expect(after.appointment!.canvasState).toBe('waiting');
    expect(after.deposit!.status).toBe('checkout_created');
  });

  /**
   * The genuine race, injected: the row becomes a hold AFTER the locked
   * SELECT ... FOR UPDATE has already returned 'confirmed'. The staleness check
   * therefore PASSES — it compared two equal values — and the status conjuncts
   * on the CAS are the only thing left between a technician and a served,
   * unpaid booking.
   */
  it('a row that becomes a hold between the locked read and the CAS is not moved', async () => {
    await seedAppointment('confirmed');
    holder.access = accessFor('confirmed');

    const realTransaction = db.transaction.bind(db);
    let flipped = false;

    /** Pass the drizzle chain through, flipping the row once `.limit()` resolves. */
    function raceOnLimit(chain: Record<string, unknown>, flip: () => Promise<void>): unknown {
      return new Proxy(chain, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (typeof value !== 'function') {
            return value;
          }
          return (...args: unknown[]) => {
            const next = (value as (...a: unknown[]) => unknown).apply(target, args);
            if (prop === 'limit') {
              return Promise.resolve(next).then(async (rows) => {
                await flip();
                return rows;
              });
            }
            return next && typeof next === 'object'
              ? raceOnLimit(next as Record<string, unknown>, flip)
              : next;
          };
        },
      });
    }

    const spy = vi.spyOn(db, 'transaction').mockImplementation((async (
      callback: (tx: Record<string, unknown>) => Promise<unknown>,
      ...rest: unknown[]
    ) => realTransaction((async (tx: Record<string, unknown>) => {
      const flip = async () => {
        if (flipped) {
          return;
        }
        flipped = true;
        await (tx.update as (t: unknown) => {
          set: (v: unknown) => { where: (w: unknown) => Promise<unknown> };
        })(schema.appointmentSchema)
          .set({ status: 'awaiting_payment' })
          .where(eq(schema.appointmentSchema.id, APPT_ID));
      };
      const patched = new Proxy(tx, {
        get(target, prop, receiver) {
          if (prop === 'select') {
            return (...args: unknown[]) =>
              raceOnLimit(
                (target.select as (...a: unknown[]) => Record<string, unknown>)(...args),
                flip,
              );
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      return callback(patched);
    }) as never, ...(rest as []))) as unknown as typeof db.transaction);

    const response = await POST(transitionRequest('cancelled'), { params: Promise.resolve({ id: APPT_ID }) });
    spy.mockRestore();

    // The flip must actually have happened, or this leg proves nothing.
    expect(flipped).toBe(true);
    expect(response.status).toBe(409);

    const after = await readBack();

    // The hold survived: no status change, no canvas_state change.
    expect(after.appointment!.status).toBe('awaiting_payment');
    expect(after.appointment!.canvasState).toBe('waiting');
    expect(after.deposit!.status).toBe('checkout_created');
  });

  it('the final CAS carries the ne(status, awaiting_payment) conjunct', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      path.join(process.cwd(), 'src/app/api/appointments/[id]/transition/route.ts'),
      'utf8',
    );

    expect(source).toContain('ne(appointmentSchema.status, \'awaiting_payment\')');
  });
});
