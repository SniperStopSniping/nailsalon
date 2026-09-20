import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeCheckoutTotals } from '@/libs/checkoutTotals';
import { buildFinalTaxSnapshot, resolveTaxConfig } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const {
  issueNextVisitOfferOnCompletion,
  getNextVisitOfferAssistantFacts,
  lockNextVisitOfferForBooking,
  mintNextVisitOfferLink,
  reserveNextVisitOffer,
  resolveNextVisitOfferPreview,
} = await import('./nextVisitOffer.server');

const OFFER_SETTINGS = {
  enabled: true,
  windowDays: 30,
  discountType: 'percent' as const,
  value: 5,
  eligibleServiceIds: ['svc'],
  messageTemplate: 'Book your next eligible visit within 30 days and save 5%.',
};

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let sequence = 0;

type Fixture = {
  salonId: string;
  clientId: string;
  sourceId: string;
  completedAt: Date;
};

async function seed(args: { enabled?: boolean; finalPriceCents?: number; completedAt?: Date } = {}): Promise<Fixture> {
  sequence += 1;
  const suffix = String(sequence);
  const salonId = `next-visit-salon-${suffix}`;
  const clientId = `next-visit-client-${suffix}`;
  const sourceId = `next-visit-source-${suffix}`;
  const completedAt = args.completedAt ?? new Date('2031-03-01T18:00:00.000Z');
  const finalPriceCents = args.finalPriceCents ?? 5000;
  const taxConfig = resolveTaxConfig(null, completedAt);
  const finalTaxSnapshot = buildFinalTaxSnapshot({
    taxConfig,
    totals: computeCheckoutTotals({
      items: [{ lineTotalCents: finalPriceCents, taxable: taxConfig.taxServicesByDefault }],
      taxConfig,
    }),
    capturedAt: completedAt,
    currency: 'CAD',
  });
  await db.insert(schema.salonSchema).values({
    id: salonId,
    slug: salonId,
    name: `Next Visit ${suffix}`,
    settings: { booking: { timezone: 'America/Toronto', currency: 'CAD' } },
  });
  await db.insert(schema.salonClientSchema).values({
    id: clientId,
    salonId,
    fullName: 'Synthetic Client',
    phone: `416555${String(1000 + sequence).padStart(4, '0')}`,
  });
  await db.insert(schema.salonRetentionSettingsSchema).values({
    salonId,
    nextVisitOffer: { ...OFFER_SETTINGS, enabled: args.enabled ?? true },
    nextVisitOfferEnabledAt: new Date(completedAt.getTime() - 1),
  });
  await db.insert(schema.appointmentSchema).values({
    id: sourceId,
    salonId,
    salonClientId: clientId,
    clientName: 'Synthetic Client',
    clientPhone: `416555${String(1000 + sequence).padStart(4, '0')}`,
    startTime: new Date(completedAt.getTime() - 3_600_000),
    endTime: completedAt,
    status: 'completed',
    completedAt,
    totalPrice: finalPriceCents,
    totalDurationMinutes: 60,
    finalPriceCents,
    finalTaxSnapshot,
    invoiceCurrency: 'CAD',
    paymentStatus: 'paid',
  });
  return { salonId, clientId, sourceId, completedAt };
}

async function issue(fixture: Fixture) {
  const [appointment] = await db.select().from(schema.appointmentSchema).where(and(
    eq(schema.appointmentSchema.salonId, fixture.salonId),
    eq(schema.appointmentSchema.id, fixture.sourceId),
  ));
  await issueNextVisitOfferOnCompletion(db as never, appointment!);
  const [offer] = await db.select().from(schema.nextVisitOfferSchema).where(and(
    eq(schema.nextVisitOfferSchema.salonId, fixture.salonId),
    eq(schema.nextVisitOfferSchema.sourceAppointmentId, fixture.sourceId),
  ));
  return offer ?? null;
}

async function insertReservedAppointment(fixture: Fixture, suffix: string) {
  const id = `${fixture.sourceId}-next-${suffix}`;
  await db.insert(schema.appointmentSchema).values({
    id,
    salonId: fixture.salonId,
    salonClientId: fixture.clientId,
    clientName: 'Synthetic Client',
    clientPhone: `416555${String(1000 + sequence).padStart(4, '0')}`,
    startTime: new Date('2031-03-20T18:00:00.000Z'),
    endTime: new Date('2031-03-20T19:00:00.000Z'),
    status: 'confirmed',
    totalPrice: 5000,
    totalDurationMinutes: 60,
  });
  return id;
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  holder.db = db;
  // This applies the real 0086 DDL, including its lifecycle function/trigger.
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 240_000);

beforeEach(async () => {
  // The event FK intentionally retains appointment history in production, so
  // clear this isolated fixture's dependent rows before cascading its salon.
  await db.execute(sql`delete from next_visit_offer_event`);
  await db.execute(sql`delete from retention_campaign`);
  await db.execute(sql`delete from next_visit_offer`);
  await db.execute(sql`delete from salon where id like 'next-visit-salon-%'`);
  sequence = 0;
});

afterAll(async () => {
  await client?.close();
});

describe('next visit offer durable lifecycle', () => {
  it('projects active salon terms without looking up a customer, and projects a bound offer without raw references', async () => {
    const fixture = await seed();
    const active = await getNextVisitOfferAssistantFacts({ salonId: fixture.salonId, services: [] });

    expect(active).toMatchObject({ kind: 'program', status: 'active', currency: 'CAD', promotion: { discountType: 'percent', value: 5 } });

    await issue(fixture);
    const minted = await mintNextVisitOfferLink(db as never, { salonId: fixture.salonId, sourceAppointmentId: fixture.sourceId });
    const preview = await resolveNextVisitOfferPreview({ salonId: fixture.salonId, token: minted!.token, services: [] });
    const bound = await getNextVisitOfferAssistantFacts({
      salonId: fixture.salonId,
      reference: preview!.reference,
      services: [],
    });

    expect(bound).toMatchObject({ kind: 'bound', status: 'no_eligible_service', deadlineDate: '2031-03-31' });
  });

  it('issues once only for enabled, positive completed visits', async () => {
    const off = await seed({ enabled: false });

    expect(await issue(off)).toBeNull();

    const noValue = await seed({ finalPriceCents: 0 });

    expect(await issue(noValue)).toBeNull();

    const fixture = await seed();
    const first = await issue(fixture);

    expect(first).toMatchObject({ state: 'available', sourceAppointmentId: fixture.sourceId, salonClientId: fixture.clientId });

    await issue(fixture);

    expect(await db.select().from(schema.nextVisitOfferSchema).where(eq(schema.nextVisitOfferSchema.salonId, fixture.salonId))).toHaveLength(1);
  });

  it('mints multiple opaque links for the same immutable entitlement and resolves only within its tenant/client/window/service', async () => {
    const fixture = await seed();
    const offer = await issue(fixture);
    const first = await mintNextVisitOfferLink(db as never, { salonId: fixture.salonId, sourceAppointmentId: fixture.sourceId });
    const second = await mintNextVisitOfferLink(db as never, { salonId: fixture.salonId, sourceAppointmentId: fixture.sourceId });

    expect(first?.offer.id).toBe(offer?.id);
    expect(second?.offer.id).toBe(offer?.id);
    expect(first?.token).not.toBe(second?.token);

    const valid = await resolveNextVisitOfferPreview({
      salonId: fixture.salonId,
      token: first!.token,
      clientId: fixture.clientId,
      startTime: '2031-03-31T18:00:00.000Z',
      services: [{ id: 'svc', priceCents: 5000 }],
      now: new Date('2031-03-02T00:00:00.000Z'),
    });

    expect(valid).toMatchObject({ status: 'eligible', discountAmountCents: 250, reference: { entitlementId: offer?.id } });

    expect(await resolveNextVisitOfferPreview({
      salonId: 'wrong-tenant',
      token: first!.token,
      services: [],
      now: new Date('2031-03-02T00:00:00.000Z'),
    })).toBeNull();
    await expect(resolveNextVisitOfferPreview({
      salonId: fixture.salonId,
      token: first!.token,
      clientPhone: '4165559999',
      startTime: '2031-03-31T18:00:00.000Z',
      services: [{ id: 'svc', priceCents: 5000 }],
      now: new Date('2031-03-02T00:00:00.000Z'),
    })).resolves.toMatchObject({ status: 'ineligible', reason: 'CLIENT_MISMATCH' });
    await expect(resolveNextVisitOfferPreview({
      salonId: fixture.salonId,
      token: first!.token,
      clientId: fixture.clientId,
      startTime: '2031-04-01T18:00:00.000Z',
      services: [{ id: 'svc', priceCents: 5000 }],
      now: new Date('2031-03-02T00:00:00.000Z'),
    })).resolves.toMatchObject({ status: 'ineligible', reason: 'OUTSIDE_WINDOW' });
    await expect(resolveNextVisitOfferPreview({
      salonId: fixture.salonId,
      token: first!.token,
      clientId: fixture.clientId,
      startTime: '2031-03-31T18:00:00.000Z',
      services: [{ id: 'other', priceCents: 5000 }],
      now: new Date('2031-03-02T00:00:00.000Z'),
    })).resolves.toMatchObject({ status: 'ineligible', reason: 'NO_ELIGIBLE_SERVICE' });
    await expect(resolveNextVisitOfferPreview({
      salonId: fixture.salonId,
      token: first!.token,
      clientId: fixture.clientId,
      startTime: '2031-03-31T18:00:00.000Z',
      services: [{ id: 'svc', priceCents: 5000 }],
      now: new Date('2031-04-02T00:00:00.000Z'),
    })).resolves.toMatchObject({ status: 'ineligible', reason: 'EXPIRED' });
  });

  it('keeps an issued offer usable from its immutable snapshot after the salon turns the feature off', async () => {
    const fixture = await seed();
    const offer = await issue(fixture);
    const minted = await mintNextVisitOfferLink(db as never, { salonId: fixture.salonId, sourceAppointmentId: fixture.sourceId });
    await db.update(schema.salonRetentionSettingsSchema).set({ nextVisitOffer: { ...OFFER_SETTINGS, enabled: false } })
      .where(eq(schema.salonRetentionSettingsSchema.salonId, fixture.salonId));

    await expect(resolveNextVisitOfferPreview({
      salonId: fixture.salonId,
      token: minted!.token,
      clientId: fixture.clientId,
      startTime: '2031-03-30T18:00:00.000Z',
      services: [{ id: 'svc', priceCents: 5000 }],
      now: new Date('2031-03-02T00:00:00.000Z'),
    })).resolves.toMatchObject({ status: 'eligible', reference: { entitlementId: offer?.id } });
  });

  it('reserves exactly once and the real lifecycle trigger releases cancellation, consumes no-shows/completions, and rejects reactivation', async () => {
    for (const [suffix, terminal] of [['cancel', 'cancelled'], ['no-show', 'no_show'], ['complete', 'completed']] as const) {
      const fixture = await seed();
      const offer = await issue(fixture);
      const appointmentId = await insertReservedAppointment(fixture, suffix);
      const minted = await mintNextVisitOfferLink(db as never, { salonId: fixture.salonId, sourceAppointmentId: fixture.sourceId });
      const preview = await resolveNextVisitOfferPreview({
        salonId: fixture.salonId,
        token: minted!.token,
        clientId: fixture.clientId,
        startTime: new Date('2031-03-20T18:00:00.000Z'),
        services: [{ id: 'svc', priceCents: 5000 }],
      });
      const locked = await lockNextVisitOfferForBooking(db as never, {
        salonId: fixture.salonId,
        reference: preview!.reference,
        clientId: fixture.clientId,
        startTime: new Date('2031-03-20T18:00:00.000Z'),
        services: [{ id: 'svc', priceCents: 5000 }],
        currency: 'CAD',
      });
      await reserveNextVisitOffer(db as never, { salonId: fixture.salonId, reference: locked.reference, appointmentId, amountCents: 250 });

      await expect(reserveNextVisitOffer(db as never, { salonId: fixture.salonId, reference: locked.reference, appointmentId: `${appointmentId}-duplicate`, amountCents: 250 })).rejects.toThrow();

      await db.update(schema.appointmentSchema).set({ status: terminal }).where(eq(schema.appointmentSchema.id, appointmentId));
      const [after] = await db.select().from(schema.nextVisitOfferSchema).where(eq(schema.nextVisitOfferSchema.id, offer!.id));

      expect(after?.state).toBe(terminal === 'cancelled' ? 'available' : 'consumed');
      expect(after?.reservedAppointmentId).toBe(terminal === 'cancelled' ? null : appointmentId);

      if (terminal === 'cancelled') {
        await expect(db.update(schema.appointmentSchema).set({ status: 'confirmed' }).where(eq(schema.appointmentSchema.id, appointmentId))).rejects.toThrow(/NEXT_VISIT_OFFER_CHANGED/);
      }
    }
  });

  it('does not expose an archived or blocked client offer as available', async () => {
    const fixture = await seed();
    await issue(fixture);
    const link = await mintNextVisitOfferLink(db as never, { salonId: fixture.salonId, sourceAppointmentId: fixture.sourceId, now: fixture.completedAt });
    await db.update(schema.salonClientSchema).set({ isBlocked: true }).where(eq(schema.salonClientSchema.id, fixture.clientId));
    const args = { salonId: fixture.salonId, token: link!.token, now: fixture.completedAt, services: [{ id: 'svc', priceCents: 5000 }] };

    expect(await resolveNextVisitOfferPreview(args)).toMatchObject({ status: 'ineligible', reason: 'CLIENT_UNAVAILABLE', discountAmountCents: 0 });

    await db.update(schema.salonClientSchema).set({ isBlocked: false, archivedAt: new Date() }).where(eq(schema.salonClientSchema.id, fixture.clientId));

    expect(await resolveNextVisitOfferPreview(args)).toMatchObject({ status: 'ineligible', reason: 'CLIENT_UNAVAILABLE', discountAmountCents: 0 });
  });

  it('revokes an available offer when its qualifying appointment is invalidated and never restores it by reactivation', async () => {
    const fixture = await seed();
    const offer = await issue(fixture);
    await db.update(schema.appointmentSchema).set({ status: 'cancelled' }).where(eq(schema.appointmentSchema.id, fixture.sourceId));

    expect((await db.select().from(schema.nextVisitOfferSchema).where(eq(schema.nextVisitOfferSchema.id, offer!.id)))[0])
      .toMatchObject({ state: 'revoked', reservedAppointmentId: null });

    await db.update(schema.appointmentSchema).set({ status: 'completed', completedAt: fixture.completedAt }).where(eq(schema.appointmentSchema.id, fixture.sourceId));

    expect((await db.select().from(schema.nextVisitOfferSchema).where(eq(schema.nextVisitOfferSchema.id, offer!.id)))[0])
      .toMatchObject({ state: 'revoked' });
  });
});
