/**
 * Unknown-outcome resolver proofs — §7.5. Adoption happens ONLY on positive
 * callback evidence (a SID on the delivery row), settles the reservation
 * exactly once under replay, never resends, and never releases without
 * proof; unresolved rows past the §19 budget alert.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const sentryCapture = vi.hoisted(() => vi.fn());
vi.mock('@sentry/nextjs', () => ({ captureMessage: sentryCapture, captureException: vi.fn() }));

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

const NOW = new Date('2026-09-01T16:00:00.000Z');

async function seedUnknownIntent(input: {
  salonId: string;
  intentId: string;
  withSid: string | null;
  credits?: number;
}) {
  await db.insert(schema.salonSchema).values({
    id: input.salonId,
    name: input.salonId,
    slug: input.salonId,
  });
  // A purchased lot + a held reservation, exactly as the dispatcher leaves
  // them when it dies mid-send.
  await db.insert(schema.smsCreditLedgerSchema).values({
    id: `lot_${input.intentId}`,
    salonId: input.salonId,
    entryType: 'grant',
    bucket: 'purchased',
    amount: input.credits ?? 10,
    idempotencyKey: `seed:${input.intentId}`,
    reason: 'seed',
  });
  await db.insert(schema.smsCreditReservationSchema).values({
    id: `res_${input.intentId}`,
    salonId: input.salonId,
    dedupeKey: `res:${input.intentId}`,
    segments: 1,
    status: 'held',
    expiresAt: new Date(NOW.getTime() - 60_000), // already past reaper TTL
  });
  await db.insert(schema.smsCreditReservationLotSchema).values({
    reservationId: `res_${input.intentId}`,
    lotLedgerId: `lot_${input.intentId}`,
    salonId: input.salonId,
    segments: 1,
  });
  await db.insert(schema.notificationDeliverySchema).values({
    id: `nd_${input.intentId}`,
    salonId: input.salonId,
    channel: 'sms',
    purpose: 'intent:booking_confirmation',
    dedupeKey: `nd:${input.intentId}`,
    status: 'queued',
    providerMessageId: input.withSid,
    intentId: input.intentId,
    // The dispatcher's TX1 state, set BEFORE the provider call: this linkage
    // plus 'settling' is exactly what the §7.6 reaper skip predicate keys on.
    creditReservationId: `res_${input.intentId}`,
    settlementState: 'settling',
  });
  await db.insert(schema.communicationIntentSchema).values({
    id: input.intentId,
    salonId: input.salonId,
    channel: 'sms',
    eventType: 'booking_confirmation',
    audience: 'client',
    dedupeKey: `intent:${input.intentId}`,
    recipient: '4165550100',
    templateKey: 'client_booking_confirmation_shortlink',
    templateVersion: 'v1',
    variables: {},
    schedulingRevision: 'rev',
    status: 'send_outcome_unknown',
    scheduledFor: new Date(NOW.getTime() - 3600_000),
    notAfter: new Date(NOW.getTime() + 3600_000),
    deliveryId: `nd_${input.intentId}`,
    creditReservationId: `res_${input.intentId}`,
    lastError: 'WORKER_DIED_MID_SEND',
    // Explicit: PGlite's now() is the real wall clock, far from test-NOW.
    updatedAt: NOW,
  });
}

const intentRow = (id: string) =>
  db.select().from(schema.communicationIntentSchema)
    .where(eq(schema.communicationIntentSchema.id, id)).then(rows => rows[0]!);

describe('unknown-outcome resolver', () => {
  it('adopts a SID from callback evidence: intent sent, reservation settled exactly once', async () => {
    const { resolveUnknownOutcomes } = await import('./unknownOutcomeResolver');
    await seedUnknownIntent({ salonId: 's_uo1', intentId: 'ci_uo1', withSid: 'SM_evidence_1' });

    const first = await resolveUnknownOutcomes(NOW);

    expect(first.adopted).toBe(1);
    expect((await intentRow('ci_uo1')).status).toBe('sent');

    const [reservation] = await db.select().from(schema.smsCreditReservationSchema)
      .where(eq(schema.smsCreditReservationSchema.id, 'res_ci_uo1'));

    expect(reservation!.status).toBe('settled');
    expect(reservation!.providerSid).toBe('SM_evidence_1');

    // Replay: no double debit, no state churn.
    const replay = await resolveUnknownOutcomes(NOW);

    expect(replay.adopted).toBe(0);

    const debits = await db.execute(
      // one settle debit for the reservation, ever
      (await import('drizzle-orm')).sql`
        SELECT COUNT(*)::int AS n FROM sms_credit_ledger
        WHERE reservation_id = 'res_ci_uo1' AND entry_type = 'debit'
      `,
    );

    expect(Number((debits.rows[0] as Record<string, unknown>).n)).toBe(1);
  });

  it('without evidence it neither resends nor releases — it alerts past the age budget', async () => {
    const { resolveUnknownOutcomes, UNKNOWN_OUTCOME_ALERT_AGE_MS } = await import('./unknownOutcomeResolver');
    await seedUnknownIntent({ salonId: 's_uo2', intentId: 'ci_uo2', withSid: null });
    sentryCapture.mockClear();

    const young = await resolveUnknownOutcomes(NOW);

    expect(young.adopted).toBe(0);
    expect(young.overdue).toBe(0); // updated_at is ~now
    expect((await intentRow('ci_uo2')).status).toBe('send_outcome_unknown');

    const later = new Date(NOW.getTime() + UNKNOWN_OUTCOME_ALERT_AGE_MS + 60_000);
    const overdue = await resolveUnknownOutcomes(later);

    expect(overdue.overdue).toBeGreaterThanOrEqual(1);
    expect(sentryCapture).toHaveBeenCalledWith(
      'communications.unknown_outcome_overdue',
      expect.objectContaining({ level: 'warning' }),
    );

    // The reservation is still HELD — evidence preserved, never auto-released.
    const [reservation] = await db.select().from(schema.smsCreditReservationSchema)
      .where(eq(schema.smsCreditReservationSchema.id, 'res_ci_uo2'));

    expect(reservation!.status).toBe('held');
  });

  it('the ordinary reservation reaper never releases an unknown-outcome hold', async () => {
    // Both seeds above created reservations already past the reaper TTL. The
    // reaper's skip predicate (delivery row present / unknown status) must
    // hide them; this asserts the invariant end-to-end via the dispatcher's
    // own reaper.
    const { reapExpiredReservations } = await import('@/libs/billing/creditReservation');
    await reapExpiredReservations(new Date(NOW.getTime() + 3600_000));
    const [survivor] = await db.select().from(schema.smsCreditReservationSchema)
      .where(eq(schema.smsCreditReservationSchema.id, 'res_ci_uo2'));

    expect(survivor!.status).toBe('held');
  });
});
