/**
 * Projection extraction, the provenance admission gate, and the per-account
 * admission cap.
 *
 * These three are the layer that decides whether an event is even OURS. Every
 * money decision downstream assumes they answered correctly, so each leg here
 * is written to fail against a specific wrong answer rather than to describe
 * the right one.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

/* eslint-disable import/first */
import {
  ADMISSION_CAP_ABSOLUTE,
  ADMISSION_CAP_BASE,
  claimOrRearmPollEvidenceWorkRow,
  countLiveNoDepositRows,
  depositIdsWithExcludingEventRows,
  evaluateProvenance,
  extractCheckoutSessionProjection,
  isOverAdmissionCap,
  isPastOrphanHorizon,
  PAYLOAD_PURGE_AFTER_MS,
  resolveAdmissionCap,
  resolveProvenanceSalonForAdmission,
  resolveVerifiedOrphanCandidate,
  shouldStripProjection,
} from './depositWebhookEvents';
/* eslint-enable import/first */

const RECEIVED_AT = new Date('2026-08-11T12:00:00.000Z');

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let seq = 0;

/** A minimally realistic paid Luster deposit session. */
function lusterSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_test_luster',
    object: 'checkout.session',
    payment_intent: 'pi_test_1',
    payment_status: 'paid',
    amount_total: 2500,
    currency: 'cad',
    client_reference_id: 'appt_1',
    metadata: { appointment_id: 'appt_1', salon_id: 'salon_a', deposit_id: 'dep_1' },
    ...overrides,
  };
}

async function seedSalon(id: string) {
  await db.insert(schema.salonSchema).values({
    id,
    name: id,
    slug: id.replaceAll('_', '-'),
    ownerEmail: `${id}@example.com`,
  }).onConflictDoNothing();
}

async function seedBinding(input: {
  salonId: string;
  account: string;
  revocationCause?: 'revoked_local' | 'deauthorized' | null;
}) {
  seq += 1;
  await db.insert(schema.salonStripeAccountSchema).values({
    id: `ssa_${seq}`,
    salonId: input.salonId,
    stripeAccountId: input.account,
    livemode: false,
    ...(input.revocationCause
      ? { revokedAt: new Date(), revocationCause: input.revocationCause }
      : {}),
  });
}

async function seedAppointment(input: { id: string; salonId: string }) {
  const startTime = new Date(Date.now() + 86_400_000);
  await db.insert(schema.appointmentSchema).values({
    id: input.id,
    salonId: input.salonId,
    clientPhone: '4165550000',
    clientName: 'Provenance Client',
    startTime,
    endTime: new Date(startTime.getTime() + 3_600_000),
    status: 'awaiting_payment',
    totalPrice: 5000,
    totalDurationMinutes: 60,
    depositHoldExpiresAt: new Date(Date.now() + 1_800_000),
  });
}

async function seedDeposit(input: {
  id: string;
  salonId: string;
  appointmentId: string;
  account: string;
  status: string;
  sessionId?: string | null;
  updatedAt?: Date;
}) {
  await db.insert(schema.appointmentDepositSchema).values({
    id: input.id,
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    amountCents: 2500,
    status: input.status,
    stripeAccountId: input.account,
    stripeCheckoutSessionId: input.sessionId ?? null,
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
  });
}

async function seedEventRow(input: {
  eventId: string;
  account: string | null;
  status: string;
  outcome?: string | null;
  sessionId?: string | null;
  depositId?: string | null;
}) {
  seq += 1;
  await db.insert(schema.stripeWebhookEventSchema).values({
    id: `swe_t_${seq}`,
    eventId: input.eventId,
    type: 'checkout.session.completed',
    account: input.account,
    livemode: false,
    status: input.status,
    outcome: input.outcome ?? null,
    sessionId: input.sessionId ?? null,
    metadataDepositId: input.depositId ?? null,
  });
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 60_000);

beforeEach(async () => {
  await db.delete(schema.stripeWebhookEventSchema);
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.salonStripeAccountSchema);
  await db.delete(schema.salonSchema);
});

afterAll(async () => {
  await client.close();
});

// ===========================================================================
// PROJECTION
// ===========================================================================

describe('extractCheckoutSessionProjection', () => {
  it('extracts every column from a complete Luster session', () => {
    const projection = extractCheckoutSessionProjection({
      type: 'checkout.session.completed',
      payload: lusterSession(),
      receivedAt: RECEIVED_AT,
    });

    expect(projection).toMatchObject({
      sessionId: 'cs_test_luster',
      paymentIntentId: 'pi_test_1',
      paymentStatus: 'paid',
      amountTotal: 2500,
      currency: 'cad',
      metadataAppointmentId: 'appt_1',
      metadataSalonId: 'salon_a',
      metadataDepositId: 'dep_1',
      clientReferenceId: 'appt_1',
      projectionStatus: 'ok',
    });
    // A payload we read successfully needs no raw copy — the extract carries
    // everything any consumer reads, and it carries no PII.
    expect(projection?.rawPayload).toBeNull();
    expect(projection?.payloadPurgeAfter).toBeNull();
  });

  it('accepts an EXPANDED payment_intent object as well as an id', () => {
    const projection = extractCheckoutSessionProjection({
      type: 'checkout.session.completed',
      payload: lusterSession({ payment_intent: { id: 'pi_expanded', object: 'payment_intent' } }),
      receivedAt: RECEIVED_AT,
    });

    expect(projection?.paymentIntentId).toBe('pi_expanded');
    expect(projection?.projectionStatus).toBe('ok');
  });

  it('treats an ABSENT optional field as ok-with-null, not as a failure', () => {
    // THE mode=setup CASE. A card-saving session legitimately carries no
    // amount, no currency and no payment intent. The "any expected field
    // missing means failed" reading would poison — with a retained payload —
    // every such session a full-Dashboard salon generates.
    const projection = extractCheckoutSessionProjection({
      type: 'checkout.session.completed',
      payload: {
        id: 'cs_setup',
        object: 'checkout.session',
        mode: 'setup',
        payment_status: 'no_payment_required',
        amount_total: null,
        currency: null,
        payment_intent: null,
        customer_details: { email: 'client@example.com', phone: '+14165550000' },
      },
      receivedAt: RECEIVED_AT,
    });

    expect(projection?.projectionStatus).toBe('ok');
    expect(projection?.amountTotal).toBeNull();
    expect(projection?.currency).toBeNull();
    expect(projection?.paymentIntentId).toBeNull();
    expect(projection?.rawPayload).toBeNull();
  });

  it('fails when a PRESENT field cannot be coerced to its column type', () => {
    const projection = extractCheckoutSessionProjection({
      type: 'checkout.session.completed',
      payload: lusterSession({ amount_total: 'twenty-five dollars' }),
      receivedAt: RECEIVED_AT,
    });

    expect(projection?.projectionStatus).toBe('failed');
    expect(projection?.rawPayload).not.toBeNull();
  });

  it('fails when the payload is not an object at all', () => {
    const projection = extractCheckoutSessionProjection({
      type: 'checkout.session.completed',
      payload: 'not a session',
      receivedAt: RECEIVED_AT,
    });

    expect(projection?.projectionStatus).toBe('failed');
  });

  it('STRIPS PII and sets the purge horizon on every retained payload', () => {
    const projection = extractCheckoutSessionProjection({
      type: 'checkout.session.completed',
      payload: lusterSession({
        amount_total: {},
        customer_details: { email: 'client@example.com', name: 'Real Person' },
        customer_email: 'client@example.com',
        customer: 'cus_123',
        collected_information: { shipping_details: { name: 'Real Person' } },
      }),
      receivedAt: RECEIVED_AT,
    });

    const raw = projection?.rawPayload as Record<string, unknown>;

    expect(projection?.projectionStatus).toBe('failed');
    // Stripped at the door rather than purged later: "later" is a promise,
    // this is a deletion.
    expect(raw).not.toHaveProperty('customer_details');
    expect(raw).not.toHaveProperty('customer_email');
    expect(raw).not.toHaveProperty('customer');
    expect(raw).not.toHaveProperty('collected_information');
    expect(raw).toHaveProperty('id', 'cs_test_luster');
    expect(projection?.payloadPurgeAfter?.getTime())
      .toBe(RECEIVED_AT.getTime() + PAYLOAD_PURGE_AFTER_MS);
  });

  it('is TYPE-SCOPED: a non-session type stores a null projection and no payload', () => {
    const projection = extractCheckoutSessionProjection({
      type: 'account.updated',
      payload: { id: 'acct_1', object: 'account', email: 'owner@example.com' },
      receivedAt: RECEIVED_AT,
    });

    expect(projection?.projectionStatus).toBe('ok');
    expect(projection?.sessionId).toBeNull();
    expect(projection?.rawPayload).toBeNull();
    expect(projection?.payloadPurgeAfter).toBeNull();
  });

  it('never throws, whatever it is handed', () => {
    for (const payload of [null, undefined, 0, [], { metadata: 'not-an-object' }]) {
      expect(() => extractCheckoutSessionProjection({
        type: 'checkout.session.completed',
        payload,
        receivedAt: RECEIVED_AT,
      })).not.toThrow();
    }
  });
});

describe('shouldStripProjection', () => {
  it('strips non-resolving terminals and keeps the ones an operator works from', () => {
    for (const outcome of ['ignored_foreign_session', 'ignored_unhandled', 'ignored_over_cap', 'session_expired']) {
      expect(shouldStripProjection(outcome)).toBe(true);
    }
    // These DID resolve a deposit — the projection is the money record the
    // manual terminal is worked from, so stripping it would delete the evidence.
    for (const outcome of ['confirmed', 'held_mismatch', 'held_duplicate_session', 'orphan_unresolved', 'poisoned']) {
      expect(shouldStripProjection(outcome)).toBe(false);
    }
  });
});

// ===========================================================================
// PROVENANCE
// ===========================================================================

describe('evaluateProvenance', () => {
  it('admits on metadata alone', async () => {
    await seedSalon('salon_a');
    await seedBinding({ salonId: 'salon_a', account: 'acct_A' });

    await expect(evaluateProvenance({
      account: 'acct_A',
      metadataSalonId: 'salon_a',
      clientReferenceId: null,
    })).resolves.toEqual({ admitted: true, salonId: 'salon_a' });
  });

  it('admits on client_reference_id alone (metadata empty)', async () => {
    // The immutable leg. Session metadata is connected-account-WRITABLE after
    // creation; `client_reference_id` is not, which is why admission may rest
    // on it by itself.
    await seedSalon('salon_a');
    await seedBinding({ salonId: 'salon_a', account: 'acct_A' });
    await seedAppointment({ id: 'appt_1', salonId: 'salon_a' });

    await expect(evaluateProvenance({
      account: 'acct_A',
      metadataSalonId: null,
      clientReferenceId: 'appt_1',
    })).resolves.toEqual({ admitted: true, salonId: 'salon_a' });
  });

  it('evaluates PER LEG: garbage metadata plus a correct reference still admits', async () => {
    // Metadata-first evaluation would let a tenant suppress a correct confirm
    // by rewriting one field on a session they own.
    await seedSalon('salon_a');
    await seedBinding({ salonId: 'salon_a', account: 'acct_A' });
    await seedAppointment({ id: 'appt_1', salonId: 'salon_a' });

    await expect(evaluateProvenance({
      account: 'acct_A',
      metadataSalonId: 'salon_does_not_exist',
      clientReferenceId: 'appt_1',
    })).resolves.toEqual({ admitted: true, salonId: 'salon_a' });
  });

  it('is ROW-MATCHED: a REVOKED binding still admits', async () => {
    // A salon's one-click disconnect must not strand its clients' captured
    // deposits. Live-only resolution turns every one of them foreign.
    await seedSalon('salon_a');
    await seedBinding({ salonId: 'salon_a', account: 'acct_X', revocationCause: 'revoked_local' });

    await expect(evaluateProvenance({
      account: 'acct_X',
      metadataSalonId: 'salon_a',
      clientReferenceId: null,
    })).resolves.toEqual({ admitted: true, salonId: 'salon_a' });
  });

  it('admits the MOVED-ACCOUNT shape: revoked row for A, live row for B', async () => {
    await seedSalon('salon_a');
    await seedSalon('salon_b');
    await seedBinding({ salonId: 'salon_a', account: 'acct_X', revocationCause: 'revoked_local' });
    await seedBinding({ salonId: 'salon_b', account: 'acct_X' });

    await expect(evaluateProvenance({
      account: 'acct_X',
      metadataSalonId: 'salon_a',
      clientReferenceId: null,
    })).resolves.toEqual({ admitted: true, salonId: 'salon_a' });
  });

  it('REFUSES a session with no Luster assertion at all — case (a)', async () => {
    await seedSalon('salon_a');
    await seedBinding({ salonId: 'salon_a', account: 'acct_A' });

    await expect(evaluateProvenance({
      account: 'acct_A',
      metadataSalonId: null,
      clientReferenceId: null,
    })).resolves.toEqual({ admitted: false });
  });

  it('REFUSES an assertion naming a salon this account is not bound to — case (b)', async () => {
    await seedSalon('salon_a');
    await seedSalon('salon_b');
    await seedBinding({ salonId: 'salon_b', account: 'acct_B' });

    await expect(evaluateProvenance({
      account: 'acct_B',
      metadataSalonId: 'salon_a',
      clientReferenceId: null,
    })).resolves.toEqual({ admitted: false });
  });

  it('ADMITS when the account has no binding rows at all — case (c)', async () => {
    // The window between `accounts.create` returning and the binding INSERT
    // landing. Terminal-ignoring this loses a real deposit permanently,
    // because Stripe never redelivers a 2xx-acked event.
    await expect(evaluateProvenance({
      account: 'acct_UNBOUND',
      metadataSalonId: 'salon_a',
      clientReferenceId: null,
    })).resolves.toEqual({ admitted: true, salonId: 'salon_a' });
  });
});

describe('resolveProvenanceSalonForAdmission', () => {
  it('is TENANT-SCOPED: an appointment outside the binding salons never resolves', async () => {
    // `client_reference_id` is a documented Payment-Link URL parameter and
    // Luster appointment ids come back from the PUBLIC booking API, so an
    // unscoped lookup here is a global read primitive driven by a value anyone
    // can set.
    await seedSalon('salon_a');
    await seedSalon('salon_b');
    await seedAppointment({ id: 'appt_a', salonId: 'salon_a' });

    await expect(resolveProvenanceSalonForAdmission({
      bindingSalonIds: ['salon_b'],
      clientReferenceId: 'appt_a',
    })).resolves.toBeNull();

    await expect(resolveProvenanceSalonForAdmission({
      bindingSalonIds: ['salon_a', 'salon_b'],
      clientReferenceId: 'appt_a',
    })).resolves.toBe('salon_a');
  });

  it('returns null with no bindings and no reference, without querying', async () => {
    await expect(resolveProvenanceSalonForAdmission({
      bindingSalonIds: [],
      clientReferenceId: 'appt_a',
    })).resolves.toBeNull();
    await expect(resolveProvenanceSalonForAdmission({
      bindingSalonIds: ['salon_a'],
      clientReferenceId: null,
    })).resolves.toBeNull();
  });
});

// ===========================================================================
// ADMISSION CAP
// ===========================================================================

describe('resolveAdmissionCap', () => {
  it('is the BASE when the account has no unsettled deposits', async () => {
    await expect(resolveAdmissionCap('acct_EMPTY')).resolves.toBe(ADMISSION_CAP_BASE);
  });

  it('does NOT count long-settled paid deposits', async () => {
    // The old "paid with no refund" term counted a salon's entire successful
    // history. Terminal rows are retained forever, so K grew monotonically and
    // the cap decayed toward vacuous on exactly the busiest salons.
    await seedSalon('salon_a');
    for (let index = 0; index < 30; index += 1) {
      await seedAppointment({ id: `appt_old_${index}`, salonId: 'salon_a' });
      await seedDeposit({
        id: `dep_old_${index}`,
        salonId: 'salon_a',
        appointmentId: `appt_old_${index}`,
        account: 'acct_BUSY',
        status: 'refunded',
        updatedAt: new Date(Date.now() - 730 * 86_400_000),
      });
    }

    await expect(resolveAdmissionCap('acct_BUSY')).resolves.toBe(ADMISSION_CAP_BASE);
  });

  it('counts genuinely-unsettled deposits, and stops at the ABSOLUTE bound', async () => {
    await seedSalon('salon_a');
    for (let index = 0; index < 100; index += 1) {
      await seedAppointment({ id: `appt_open_${index}`, salonId: 'salon_a' });
      await seedDeposit({
        id: `dep_open_${index}`,
        salonId: 'salon_a',
        appointmentId: `appt_open_${index}`,
        account: 'acct_OPEN',
        status: 'checkout_created',
      });
    }

    // 10 + 100 = 110 without the absolute bound. The bound exists so the cap
    // survives a future edit to the "genuinely unsettled" definition.
    await expect(resolveAdmissionCap('acct_OPEN')).resolves.toBe(ADMISSION_CAP_ABSOLUTE);
  });
});

describe('isOverAdmissionCap', () => {
  it('counts only LIVE deposit-less rows on that account', async () => {
    for (let index = 0; index < ADMISSION_CAP_BASE; index += 1) {
      await seedEventRow({
        eventId: `evt_live_${index}`,
        account: 'acct_FLOOD',
        status: 'failed_retryable',
        outcome: 'deferred_no_deposit',
      });
    }
    // A different account's flood must not close the gate on this one.
    await seedEventRow({
      eventId: 'evt_other',
      account: 'acct_QUIET',
      status: 'failed_retryable',
      outcome: 'deferred_no_deposit',
    });

    await expect(countLiveNoDepositRows('acct_FLOOD')).resolves.toBe(ADMISSION_CAP_BASE);
    await expect(isOverAdmissionCap('acct_FLOOD')).resolves.toBe(true);
    await expect(isOverAdmissionCap('acct_QUIET')).resolves.toBe(false);
  });

  it('does not count rows that already reached a terminal', async () => {
    for (let index = 0; index < 40; index += 1) {
      await seedEventRow({
        eventId: `evt_done_${index}`,
        account: 'acct_SETTLED',
        status: 'ignored_over_cap',
        outcome: 'ignored_over_cap',
      });
    }

    await expect(isOverAdmissionCap('acct_SETTLED')).resolves.toBe(false);
  });
});

// ===========================================================================
// SCAN EXCLUSION
// ===========================================================================

describe('depositIdsWithExcludingEventRows', () => {
  it('excludes deposits owned by a LIVE row or a MANUAL terminal, and no others', async () => {
    await seedEventRow({ eventId: 'evt_live', account: 'a', status: 'processing', depositId: 'dep_live' });
    await seedEventRow({ eventId: 'evt_manual', account: 'a', status: 'held_mismatch', outcome: 'held_mismatch', depositId: 'dep_manual' });
    // `processed` and `ignored_*` deliberately do NOT exclude — rescuing those
    // is the entire purpose of the deposit-side scan.
    await seedEventRow({ eventId: 'evt_done', account: 'a', status: 'processed', outcome: 'confirmed', depositId: 'dep_done' });
    await seedEventRow({ eventId: 'evt_ignored', account: 'a', status: 'ignored_foreign_session', outcome: 'ignored_foreign_session', depositId: 'dep_ignored' });

    const excluded = await depositIdsWithExcludingEventRows([
      { depositId: 'dep_live', sessionId: null },
      { depositId: 'dep_manual', sessionId: null },
      { depositId: 'dep_done', sessionId: null },
      { depositId: 'dep_ignored', sessionId: null },
    ]);

    expect([...excluded].sort()).toEqual(['dep_live', 'dep_manual']);
  });

  it('matches on the candidate OWN session id, never positionally', async () => {
    await seedEventRow({ eventId: 'evt_s', account: 'a', status: 'processing', sessionId: 'cs_second' });

    const excluded = await depositIdsWithExcludingEventRows([
      { depositId: 'dep_first', sessionId: 'cs_first' },
      { depositId: 'dep_second', sessionId: 'cs_second' },
    ]);

    // A positional zip would suppress the wrong deposit and leave real money
    // unreconciled while rescanning one that was already owned.
    expect([...excluded]).toEqual(['dep_second']);
  });

  it('returns empty for no candidates', async () => {
    await expect(depositIdsWithExcludingEventRows([])).resolves.toEqual(new Set());
  });
});

describe('isPastOrphanHorizon', () => {
  it('is false before 90 minutes and true after', () => {
    const now = new Date('2026-08-11T12:00:00.000Z');

    expect(isPastOrphanHorizon(new Date(now.getTime() - 89 * 60_000), now)).toBe(false);
    expect(isPastOrphanHorizon(new Date(now.getTime() - 91 * 60_000), now)).toBe(true);
  });
});

describe('poll-evidence lease rearm', () => {
  const input = {
    eventId: 'luster:poll_evidence:dep_poll_rearm',
    account: 'acct_poll_rearm',
    livemode: false,
    salonId: 'salon_poll_rearm',
    sessionId: 'cs_poll_rearm',
    depositId: 'dep_poll_rearm',
  };

  it('reuses a safely processed stable identity with a fresh fencing token', async () => {
    const first = await claimOrRearmPollEvidenceWorkRow(input);

    expect(first.claimed).toBe(true);

    if (!first.claimed) {
      throw new Error('initial poll claim failed');
    }
    await db.update(schema.stripeWebhookEventSchema)
      // Reproduce the reviewed build after its same-run retention pass: the
      // consumed poll identity remains, but its deposit/session projection was
      // stripped because the terminal outcome was `ignored_unpaid`.
      .set({
        status: 'processed',
        outcome: 'ignored_unpaid',
        processedAt: new Date(),
        sessionId: null,
        metadataDepositId: null,
      })
      .where(eq(schema.stripeWebhookEventSchema.id, first.id));

    const second = await claimOrRearmPollEvidenceWorkRow({
      ...input,
      projection: { paymentStatus: 'paid', paymentIntentId: 'pi_fresh' },
    });

    expect(second).toMatchObject({ claimed: true, id: first.id, attempts: 2 });

    const [row] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.id, first.id));

    expect(row?.status).toBe('processing');
    expect(row?.outcome).toBeNull();
    expect(row?.processedAt).toBeNull();
    expect(row?.paymentStatus).toBe('paid');
    expect(row?.paymentIntentId).toBe('pi_fresh');
  });

  it('never re-arms a manual money terminal', async () => {
    const first = await claimOrRearmPollEvidenceWorkRow(input);

    expect(first.claimed).toBe(true);

    if (!first.claimed) {
      throw new Error('initial poll claim failed');
    }
    await db.update(schema.stripeWebhookEventSchema)
      .set({ status: 'held_mismatch', outcome: 'held_mismatch', processedAt: new Date() })
      .where(eq(schema.stripeWebhookEventSchema.id, first.id));

    const second = await claimOrRearmPollEvidenceWorkRow(input);

    expect(second).toEqual({ claimed: false, id: first.id });

    const [row] = await db.select().from(schema.stripeWebhookEventSchema)
      .where(eq(schema.stripeWebhookEventSchema.id, first.id));

    expect(row?.status).toBe('held_mismatch');
    expect(row?.attempts).toBe(1);
  });
});

describe('orphan candidate verification', () => {
  it('requires both provenance-salon and stored-account legs and never cross-adopts', async () => {
    await seedSalon('salon_candidate');
    await seedAppointment({ id: 'appt_candidate', salonId: 'salon_candidate' });
    await seedDeposit({
      id: 'dep_candidate',
      salonId: 'salon_candidate',
      appointmentId: 'appt_candidate',
      account: 'acct_candidate',
      status: 'checkout_created',
      sessionId: 'cs_candidate',
    });

    await expect(resolveVerifiedOrphanCandidate({
      metadataDepositId: 'dep_candidate',
      provenanceSalonId: 'salon_candidate',
      account: 'acct_candidate',
    })).resolves.toEqual({ depositId: 'dep_candidate' });
    await expect(resolveVerifiedOrphanCandidate({
      metadataDepositId: 'dep_candidate',
      provenanceSalonId: 'salon_other',
      account: 'acct_candidate',
    })).resolves.toBeNull();
    await expect(resolveVerifiedOrphanCandidate({
      metadataDepositId: 'dep_candidate',
      provenanceSalonId: 'salon_candidate',
      account: 'acct_other',
    })).resolves.toBeNull();
  });
});
