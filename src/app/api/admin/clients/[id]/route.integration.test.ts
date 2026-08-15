import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildBookingTaxSnapshot, resolveTaxConfig } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { GET, PATCH } from './route';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const requireAdminSalon = vi.hoisted(() => vi.fn());

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
}));

const NOW = new Date('2026-07-23T16:00:00.000Z');
const SALON_ID = 'salon_client_profile_financial';
const CLIENT_ID = 'client_profile_financial';
const SOURCE_CLIENT_ID = 'client_profile_merged_source';
const PHONE = '4165550188';
const EMAIL = 'partial.snapshot@example.invalid';
const CLIENT_UPDATED_AT = new Date('2026-07-22T10:00:00.000Z');

function exactClientVersion(date: Date): string {
  return date.toISOString().replace(/Z$/, '000Z');
}

let client: PGlite;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  testDb = drizzle(client, { schema });
  await migrate(testDb, {
    migrationsFolder: path.join(process.cwd(), 'migrations'),
  });
  holder.db = testDb;

  await testDb.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Client Profile Financial Salon',
    slug: 'client-profile-financial',
    settings: {
      booking: {
        timezone: 'America/Toronto',
        currency: 'CAD',
      },
    },
  });
  await testDb.insert(schema.salonClientSchema).values({
    id: CLIENT_ID,
    salonId: SALON_ID,
    phone: PHONE,
    fullName: 'Partial  Payment Client',
    email: EMAIL,
    birthday: '1990-05-04',
    notes: 'Original profile note',
    totalSpent: 4000,
    updatedAt: CLIENT_UPDATED_AT,
  });
  await testDb.insert(schema.salonClientSchema).values({
    id: SOURCE_CLIENT_ID,
    salonId: SALON_ID,
    phone: '4165550199',
    fullName: 'Preserved Source',
  });
  await testDb.execute(sql.raw(
    'ALTER TABLE salon_client DISABLE TRIGGER salon_client_enforce_merge_transition',
  ));
  try {
    await testDb
      .update(schema.salonClientSchema)
      .set({
        archivedAt: new Date('2026-07-22T12:00:00.000Z'),
        archivedBy: 'integration-test',
        mergedIntoClientId: CLIENT_ID,
        mergedAt: new Date('2026-07-22T12:00:00.000Z'),
        mergedBy: 'integration-test',
      })
      .where(eq(schema.salonClientSchema.id, SOURCE_CLIENT_ID));
  } finally {
    await testDb.execute(sql.raw(
      'ALTER TABLE salon_client ENABLE TRIGGER salon_client_enforce_merge_transition',
    ));
  }

  await testDb.insert(schema.appointmentSchema).values([
    {
      id: 'client_profile_partial',
      salonId: SALON_ID,
      salonClientId: CLIENT_ID,
      clientPhone: PHONE,
      clientName: 'Partial  Payment Client',
      clientEmail: EMAIL,
      startTime: new Date('2026-07-20T14:00:00.000Z'),
      endTime: new Date('2026-07-20T15:00:00.000Z'),
      totalDurationMinutes: 60,
      totalPrice: 12000,
      finalPriceCents: 10000,
      finalDiscountCents: 2000,
      taxAmountCents: 0,
      tipCents: 0,
      amountPaidCents: 4000,
      paymentStatus: 'partially_paid',
      invoiceCurrency: 'CAD',
      status: 'completed',
      completedAt: new Date('2026-07-20T15:00:00.000Z'),
    },
    {
      id: 'client_profile_future',
      salonId: SALON_ID,
      salonClientId: CLIENT_ID,
      clientPhone: PHONE,
      clientName: 'Partial  Payment Client',
      clientEmail: EMAIL,
      startTime: new Date('2026-08-20T14:00:00.000Z'),
      endTime: new Date('2026-08-20T15:00:00.000Z'),
      totalDurationMinutes: 60,
      totalPrice: 50000,
      amountPaidCents: 0,
      paymentStatus: 'pending',
      invoiceCurrency: 'CAD',
      bookingTaxSnapshot: buildBookingTaxSnapshot({
        taxConfig: resolveTaxConfig({
          payments: {
            tax: {
              enabled: true,
              name: 'HST',
              rateBps: 1300,
              pricesIncludeTax: false,
              jurisdiction: 'Ontario',
              country: 'Canada',
              region: 'ON',
            },
          },
        }, new Date('2026-07-22T12:00:00.000Z')),
        totals: {
          taxApplied: true,
          taxableSubtotalCents: 50000,
          taxAmountCents: 6500,
          finalPriceCents: 50000,
        },
        capturedAt: new Date('2026-07-22T12:00:00.000Z'),
        currency: 'CAD',
      }),
      status: 'confirmed',
    },
  ]);
  await testDb.insert(schema.appointmentDepositSchema).values({
    id: 'client_profile_deposit',
    appointmentId: 'client_profile_partial',
    salonId: SALON_ID,
    amountCents: 2500,
    currency: 'cad',
    status: 'paid',
    stripeAccountId: 'acct_client_profile',
    stripePaymentIntentId: 'pi_client_profile',
    collectedAt: new Date('2026-07-19T15:00:00.000Z'),
  });
  await testDb.insert(schema.appointmentPaymentSchema).values({
    id: 'client_profile_payment',
    appointmentId: 'client_profile_partial',
    salonId: SALON_ID,
    amountCents: 4000,
    method: 'cash',
    recordedByType: 'admin',
    recordedAt: new Date('2026-07-20T15:00:00.000Z'),
  });
  await testDb.insert(schema.clientCommunicationSchema).values({
    id: 'client_profile_communication',
    salonId: SALON_ID,
    salonClientId: CLIENT_ID,
    appointmentId: 'client_profile_partial',
    kind: 'appointment_details',
    status: 'marked_sent',
    messageSnapshot: 'Historical receipt message',
    destinationSnapshot: PHONE,
    markedSentAt: new Date('2026-07-20T15:01:00.000Z'),
  });
}, 60_000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  requireAdminSalon.mockResolvedValue({
    error: null,
    salon: {
      id: SALON_ID,
      slug: 'client-profile-financial',
      settings: {
        booking: {
          timezone: 'America/Toronto',
          currency: 'CAD',
        },
      },
    },
  });
});

afterAll(async () => {
  vi.useRealTimers();
  await client.close();
});

describe('GET /api/admin/clients/[id] financial projection', () => {
  it('excludes unsettled value from spend while separating received cash and outstanding', async () => {
    const response = await GET(
      new Request(`http://localhost/api/admin/clients/${CLIENT_ID}?salonSlug=client-profile-financial`),
      { params: Promise.resolve({ id: CLIENT_ID }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body.data.client.totalSpent).toBe(0);
    expect(body.data.client.birthday).toBe('1990-05-04');
    expect(body.data.client.updatedAt).toBe(
      exactClientVersion(CLIENT_UPDATED_AT),
    );
    expect(body.data.summary).toMatchObject({
      currency: 'CAD',
      timeZone: 'America/Toronto',
      lifetimeSpendCents: 0,
      spendThisMonthCents: 0,
      completedOutstandingCents: 3500,
      completedVisits: 1,
    });
    expect(body.data.pastAppointments[0].financial).toMatchObject({
      completedValueCents: 10000,
      source: 'finalized',
      paymentsReceivedCents: 4000,
      depositCollectedCents: 2500,
      depositRefundedCents: 0,
      depositCreditCents: 2500,
      amountAlreadyPaidCents: 6500,
      completedOutstandingCents: 3500,
      balanceCents: 3500,
      paymentStatus: 'partially_paid',
    });
    expect(body.data.pastAppointments[0].financial.payments).toEqual([
      expect.objectContaining({
        id: 'client_profile_payment',
        amountCents: 4000,
        method: 'cash',
      }),
    ]);
    expect(body.data.upcomingAppointments[0].financial).toMatchObject({
      depositCreditCents: 0,
      amountAlreadyPaidCents: 0,
      balanceCents: 56500,
      balanceState: 'upcoming_balance',
    });
  });

  it.each([
    [
      'pending refund',
      'DEPOSIT_REFUND_IN_FLIGHT',
      {
        refundStatus: 'pending',
        refundStatusChangedAt: NOW,
        refundRequestedAt: NOW,
      },
    ],
    [
      'failed refund',
      'DEPOSIT_REFUND_UNRESOLVED',
      {
        refundStatus: 'failed',
        refundStatusChangedAt: NOW,
        refundRequestedAt: NOW,
        refundLastErrorCode: 'UNKNOWN_PROVIDER_ERROR',
        refundFailureReason: 'unknown',
      },
    ],
    [
      'provider refund conflict',
      'DEPOSIT_REFUND_CONFLICT',
      { refundConflictFlag: true },
    ],
  ])('nulls every dependent amount for a %s', async (_case, blockCode, mutation) => {
    const cleanDepositState = {
      refundStatus: null,
      refundStatusChangedAt: null,
      refundRequestedAt: null,
      refundLastErrorCode: null,
      refundFailureReason: null,
      refundConflictFlag: false,
    };
    await testDb
      .update(schema.appointmentDepositSchema)
      .set({ ...cleanDepositState, ...mutation })
      .where(eq(schema.appointmentDepositSchema.id, 'client_profile_deposit'));

    try {
      const response = await GET(
        new Request(`http://localhost/api/admin/clients/${CLIENT_ID}?salonSlug=client-profile-financial`),
        { params: Promise.resolve({ id: CLIENT_ID }) },
      );
      const body = await response.json();
      const appointment = body.data.pastAppointments[0];

      expect(response.status).toBe(200);
      expect(appointment).toMatchObject({
        id: 'client_profile_partial',
        totalPrice: null,
      });
      expect(appointment.financial).toMatchObject({
        completedValueCents: null,
        source: 'unresolved',
        discountCents: null,
        taxCents: null,
        tipsCents: null,
        paymentsReceivedCents: null,
        depositCollectedCents: null,
        depositRefundedCents: null,
        depositForfeitedCents: null,
        depositCreditCents: null,
        depositState: 'blocked',
        depositBlockCode: blockCode,
        depositPresentationState: 'blocked',
        amountAlreadyPaidCents: null,
        payments: [],
        completedOutstandingCents: null,
        balanceCents: null,
        balanceState: 'unresolved',
      });
    } finally {
      await testDb
        .update(schema.appointmentDepositSchema)
        .set(cleanDepositState)
        .where(eq(schema.appointmentDepositSchema.id, 'client_profile_deposit'));
    }
  });

  it('resolves a stale same-salon source ID to the terminal primary without changing snapshots', async () => {
    const appointmentsBefore = await testDb
      .select({
        id: schema.appointmentSchema.id,
        salonClientId: schema.appointmentSchema.salonClientId,
        clientPhone: schema.appointmentSchema.clientPhone,
      })
      .from(schema.appointmentSchema);

    const response = await GET(
      new Request(`http://localhost/api/admin/clients/${SOURCE_CLIENT_ID}?salonSlug=client-profile-financial`),
      { params: Promise.resolve({ id: SOURCE_CLIENT_ID }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.client.id).toBe(CLIENT_ID);
    expect(body.data.client.phone).toBe(PHONE);

    const appointmentsAfter = await testDb
      .select({
        id: schema.appointmentSchema.id,
        salonClientId: schema.appointmentSchema.salonClientId,
        clientPhone: schema.appointmentSchema.clientPhone,
      })
      .from(schema.appointmentSchema);

    expect(appointmentsAfter).toEqual(appointmentsBefore);
  });

  it('loads a dirty cross-tenant payment child for reconciliation without disclosing it', async () => {
    const foreignSalonId = 'salon_client_profile_foreign';
    const dirtyPaymentId = 'client_profile_dirty_payment';
    await testDb.insert(schema.salonSchema).values({
      id: foreignSalonId,
      name: 'Foreign Client Profile Salon',
      slug: 'foreign-client-profile-salon',
    });
    await testDb.execute(sql.raw(
      'ALTER TABLE appointment_payment DISABLE TRIGGER ALL',
    ));
    try {
      await testDb.insert(schema.appointmentPaymentSchema).values({
        id: dirtyPaymentId,
        appointmentId: 'client_profile_partial',
        salonId: foreignSalonId,
        amountCents: 4000,
        method: 'cash',
        recordedByType: 'admin',
        recordedAt: new Date('2026-07-20T15:00:00.000Z'),
      });
    } finally {
      await testDb.execute(sql.raw(
        'ALTER TABLE appointment_payment ENABLE TRIGGER ALL',
      ));
    }

    try {
      const response = await GET(
        new Request(`http://localhost/api/admin/clients/${CLIENT_ID}?salonSlug=client-profile-financial`),
        { params: Promise.resolve({ id: CLIENT_ID }) },
      );
      const body = await response.json();
      const financial = body.data.pastAppointments[0].financial;

      expect(response.status).toBe(200);
      expect(financial).toMatchObject({
        paymentLedgerState: 'blocked',
        paymentLedgerBlockCode: 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED',
        balanceCents: null,
        balanceState: 'unresolved',
      });
      expect(financial.payments).toEqual([
        expect.objectContaining({ id: 'client_profile_payment' }),
      ]);
      expect(JSON.stringify(body)).not.toContain(dirtyPaymentId);
    } finally {
      await testDb.delete(schema.appointmentPaymentSchema).where(
        eq(schema.appointmentPaymentSchema.id, dirtyPaymentId),
      );
      await testDb.delete(schema.salonSchema).where(
        eq(schema.salonSchema.id, foreignSalonId),
      );
    }
  });
});

describe('PATCH /api/admin/clients/[id] snapshot-safe contact updates', () => {
  it('updates only the terminal, retains aliases and history, and writes one PII-free audit row', async () => {
    const [terminalBefore] = await testDb
      .select()
      .from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.id, CLIENT_ID))
      .limit(1);
    const sourceBefore = await testDb
      .select()
      .from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.id, SOURCE_CLIENT_ID))
      .limit(1);
    const appointmentsBefore = await testDb
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.salonId, SALON_ID));
    const paymentsBefore = await testDb
      .select()
      .from(schema.appointmentPaymentSchema)
      .where(eq(schema.appointmentPaymentSchema.salonId, SALON_ID));
    const communicationsBefore = await testDb
      .select()
      .from(schema.clientCommunicationSchema)
      .where(eq(schema.clientCommunicationSchema.salonId, SALON_ID));

    expect(terminalBefore).toBeDefined();

    const response = await PATCH(
      new Request(
        `http://localhost/api/admin/clients/${SOURCE_CLIENT_ID}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salonSlug: 'client-profile-financial',
            phone: '+1 (647) 555-0144',
            email: ' Updated.Client@Example.Invalid ',
            expectedUpdatedAt: terminalBefore!.updatedAt.toISOString(),
          }),
        },
      ),
      { params: Promise.resolve({ id: SOURCE_CLIENT_ID }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.client).toMatchObject({
      id: CLIENT_ID,
      phone: '6475550144',
      fullName: 'Partial  Payment Client',
      email: 'updated.client@example.invalid',
      birthday: '1990-05-04',
      notes: 'Original profile note',
      updatedAt: exactClientVersion(NOW),
    });

    const [terminalAfter] = await testDb
      .select()
      .from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.id, CLIENT_ID))
      .limit(1);
    const sourceAfter = await testDb
      .select()
      .from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.id, SOURCE_CLIENT_ID))
      .limit(1);
    const aliases = await testDb
      .select()
      .from(schema.salonClientContactAliasSchema)
      .where(eq(schema.salonClientContactAliasSchema.salonId, SALON_ID));
    const appointmentsAfter = await testDb
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.salonId, SALON_ID));
    const paymentsAfter = await testDb
      .select()
      .from(schema.appointmentPaymentSchema)
      .where(eq(schema.appointmentPaymentSchema.salonId, SALON_ID));
    const communicationsAfter = await testDb
      .select()
      .from(schema.clientCommunicationSchema)
      .where(eq(schema.clientCommunicationSchema.salonId, SALON_ID));
    const audits = await testDb
      .select()
      .from(schema.auditLogSchema)
      .where(eq(schema.auditLogSchema.salonId, SALON_ID));

    expect(terminalAfter).toMatchObject({
      id: CLIENT_ID,
      phone: '6475550144',
      fullName: terminalBefore!.fullName,
      email: 'updated.client@example.invalid',
      birthday: terminalBefore!.birthday,
      notes: terminalBefore!.notes,
      totalSpent: terminalBefore!.totalSpent,
      loyaltyPoints: terminalBefore!.loyaltyPoints,
    });
    expect(sourceAfter).toEqual(sourceBefore);
    expect(aliases.map(alias => ({
      salonClientId: alias.salonClientId,
      kind: alias.kind,
      normalizedValue: alias.normalizedValue,
    })).sort((left, right) => left.kind.localeCompare(right.kind))).toEqual([
      {
        salonClientId: CLIENT_ID,
        kind: 'email',
        normalizedValue: EMAIL,
      },
      {
        salonClientId: CLIENT_ID,
        kind: 'phone',
        normalizedValue: PHONE,
      },
    ]);
    expect(appointmentsAfter).toEqual(appointmentsBefore);
    expect(paymentsAfter).toEqual(paymentsBefore);
    expect(communicationsAfter).toEqual(communicationsBefore);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: 'admin',
      action: 'updated',
      entityType: 'salon_client',
      entityId: CLIENT_ID,
    });
    expect(audits[0]?.metadata).toEqual({
      terminalClientId: CLIENT_ID,
      changedFields: ['email', 'phone'],
      redirectedFromStaleSource: true,
    });

    const serializedAudit = JSON.stringify(audits[0]);

    for (const pii of [
      PHONE,
      EMAIL,
      '6475550144',
      'updated.client@example.invalid',
      'Partial  Payment Client',
      '1990-05-04',
      'Original profile note',
    ]) {
      expect(serializedAudit).not.toContain(pii);
    }

    for (const requestedId of [CLIENT_ID, SOURCE_CLIENT_ID]) {
      const historyResponse = await GET(
        new Request(
          `http://localhost/api/admin/clients/${requestedId}?salonSlug=client-profile-financial`,
        ),
        { params: Promise.resolve({ id: requestedId }) },
      );
      const historyBody = await historyResponse.json();

      expect(historyResponse.status).toBe(200);
      expect(historyBody.data.client.id).toBe(CLIENT_ID);
      expect(historyBody.data.client.phone).toBe('6475550144');
      expect(historyBody.data.pastAppointments).toEqual([
        expect.objectContaining({
          id: 'client_profile_partial',
          financial: expect.objectContaining({
            payments: [
              expect.objectContaining({
                id: 'client_profile_payment',
                amountCents: 4000,
              }),
            ],
          }),
        }),
      ]);
      expect(historyBody.data.upcomingAppointments).toEqual([
        expect.objectContaining({ id: 'client_profile_future' }),
      ]);
    }
  });
});
