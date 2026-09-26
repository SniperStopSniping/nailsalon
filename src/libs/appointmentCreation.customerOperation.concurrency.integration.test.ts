/** Actual public booking authority against an attested disposable PostgreSQL pool. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { fingerprintBookingBasketReview, validatePublicBookingBasket, validatePublicBookingSelection } from '@/libs/bookingQuote';
import { buildDepositDisclosure } from '@/libs/depositPolicy';
import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import { resolvePublicBookingSelection } from '@/libs/publicBookingSelection';
import { buildTaxConfigurationSnapshot, resolveTaxConfig } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import type { CustomerBookingMaterial } from './customerAssistant/bookingOperationContracts';

const rawUrl = process.env.CONCURRENCY_TEST_DATABASE_URL;
if (!rawUrl && process.env.CUSTOMER_BOOKING_PG_REQUIRED === 'true') {
  throw new Error('Customer creator PostgreSQL gate requires an attested disposable target.');
}
const target = rawUrl ? requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: rawUrl }) : null;
vi.mock('server-only', () => ({}));
vi.mock('@/core/redis/redisClient', () => ({
  redis: null,
  isRedisAvailable: vi.fn(async () => false),
}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  withSession: null as unknown as (
    work: (database: unknown) => Promise<unknown>,
  ) => Promise<unknown>,
}));
const {
  sendTransactionalEmail,
  sendTransactionalEmailDetailed,
  sendAppointmentReminder,
  requireStaffSession,
  requireAdmin,
  requireAdminSalon,
  requireClientApiSession,
  requireAppointmentAccess,
  requireAppointmentManagerAccess,
  requireStaffAppointmentAccess,
  recordGoogleEventReviewDecision,
} = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(),
  sendTransactionalEmailDetailed: vi.fn(),
  sendAppointmentReminder: vi.fn(),
  requireStaffSession: vi.fn(),
  requireAdmin: vi.fn(),
  requireAdminSalon: vi.fn(),
  requireClientApiSession: vi.fn(),
  requireAppointmentAccess: vi.fn(),
  requireAppointmentManagerAccess: vi.fn(),
  requireStaffAppointmentAccess: vi.fn(),
  recordGoogleEventReviewDecision: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
  usesRuntimePostgres: true,
  DatabaseSessionReleaseError: class DatabaseSessionReleaseError extends Error {},
  withDedicatedDatabaseSession: <T>(
    work: (database: unknown) => Promise<T>,
  ) => holder.withSession(work) as Promise<T>,
}));

vi.mock('@/libs/email', () => ({ sendTransactionalEmail, sendTransactionalEmailDetailed }));
vi.mock('@/libs/staffAuth', () => ({ requireStaffSession }));
vi.mock('@/libs/adminAuth', () => ({
  // The client PATCH records the acting admin on its audit row (CP1 repair).
  getAdminSession: vi.fn(async () => ({ id: 'admin_concurrency', phoneE164: null })),
  requireAdmin,
  requireAdminSalon,
}));
vi.mock('@/libs/clientApiGuards', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/clientApiGuards')>()),
  requireClientApiSession,
}));
vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentAccess,
  requireAppointmentManagerAccess,
}));
vi.mock('@/libs/staffApiGuards', () => ({
  requireStaffAppointmentAccess,
}));
vi.mock('@/libs/SMS', () => ({
  sendBookingConfirmationToClient: vi.fn(),
  sendCancellationNotificationToTech: vi.fn(),
  sendRescheduleConfirmation: vi.fn(),
  sendAppointmentReminder,
}));
vi.mock('@/libs/googleCalendar', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/googleCalendar')>()),
  getGoogleCalendarBusyWindows: vi.fn(async () => []),
  hasGoogleCalendarConflict: vi.fn(async () => false),
}));
vi.mock('@/libs/googleEventReview', () => ({
  recordGoogleEventReviewDecision,
}));

const provider = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn(), expire: vi.fn(), readiness: vi.fn() }));
vi.mock('@/libs/stripeConnect/readiness', async importOriginal => ({ ...(await importOriginal<typeof import('@/libs/stripeConnect/readiness')>()), refreshAccountReadiness: provider.readiness }));
const SALON = 'synthetic-customer-creator-salon';
const TECH = 'synthetic-customer-creator-tech';
const OTHER_SALON = 'synthetic-customer-creator-other-salon';
const OTHER_TECH = 'synthetic-customer-creator-other-tech';
const SERVICE = 'synthetic-customer-creator-service';
const SERVICE_TWO = 'synthetic-customer-creator-service-two';
const ADDON = 'synthetic-customer-creator-addon';
const L1_CAPABILITY = 'synthetic-customer-creator-l1-capability';
const L1_SORTED_ADDON = 'aaa-synthetic-customer-creator-addon';
const SECRET = 'synthetic-customer-creator-signing-key-no-provider';
const L1_FEATURES = { catalog: { variantsV1: true, addOnGroupsV1: false, bookingModesV1: false } };
const SETTINGS = { bookingExperience: { policy: { enabled: false } }, booking: { timezone: 'America/Toronto', slotIntervalMinutes: 15, bufferMinutes: 0 } };
const START = '2099-09-01T15:00:00.000Z';
const contact = (lastDigit = '1') => ({ name: 'Synthetic Customer', email: `synthetic${lastDigit}@example.invalid`, phone: `416555010${lastDigit}` });
let pool: pg.Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;
let executed = 0;
const { prepareCustomerBookingOperation, customerBookingOperationReference, readCustomerBookingOperation } = await import('./customerAssistant/operationStore.server');
const { __setDepositStripeClientForTests } = await import('./depositCheckout');
const { resumeCustomerDepositCheckout } = await import('./deposits/resumeCustomerCheckout');
const { readCustomerBookingStatus } = await import('./customerAssistant/bookingStatus.server');
const { runCustomerBookingRecoveryAction } = await import('./customerAssistant/recoveryAction.server');
const { createAppointmentFromRequest } = await import('./appointmentCreation.server');

function material(): CustomerBookingMaterial {
  return {
    selection: { baseServiceId: SERVICE, selectedAddOns: [] },
    preference: { date: '2099-09-01', earliest: '10:00', latest: '17:00' },
    startTime: START,
    technicianSelection: 'any',
    smsConsent: { granted: true, selection: 'default_on', wordingVersion: 'booking-sms-reminders-v1' },
    expectedTotalCents: 6500,
    expectedDiscountType: null,
    expectedBookingFinancialQuote: { currency: 'CAD', totalDueCents: 6500, taxConfigurationIdentity: buildTaxConfigurationSnapshot(resolveTaxConfig(SETTINGS, new Date())).configurationIdentity },
    expectedDepositFingerprint: 'deposit-v1:none',
    review: {
      status: 'READY',
      fingerprint: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      salon: { id: SALON, slug: SALON, name: 'Synthetic Creator Test Salon' },
      location: null,
      services: [{ id: SERVICE, name: 'Synthetic Creator Service', priceCents: 6500 }],
      addOns: [],
      technician: { kind: 'any_artist' },
      date: '2099-09-01',
      time: '11:00',
      timeZone: 'America/Toronto',
      durationMinutes: 60,
      financial: { subtotalCents: 6500, discountAmountCents: 0, discountLabel: null, taxAmountCents: 0, totalDueCents: 6500, currency: 'CAD' },
      deposit: { status: 'not_required', reason: 'policy_inactive' },
      confirmationMode: 'instant',
      bookingPolicy: { required: false },
      reminders: { mode: 'default_on', selection: 'default_on', requestedEnabled: true },
    },
  };
}
async function prepare(person = contact(), value = material()) {
  const operation = await prepareCustomerBookingOperation({ salonId: SALON, sessionId: randomUUID(), secret: SECRET, contact: person, material: value, expectedRevision: 0 });
  return { operation, reference: customerBookingOperationReference(operation, SECRET), person };
}
async function create(prepared: Awaited<ReturnType<typeof prepare>>, executionGuard?: (tx: import('./customerAssistant/operationStore.server').CustomerBookingTransaction) => Promise<void>) {
  const value = prepared.operation.material;
  const request = new Request('https://app.luster.test/api/appointments', { method: 'POST', headers: { 'content-type': 'application/json', 'origin': 'https://app.luster.test' }, body: JSON.stringify({
    salonSlug: SALON,
    baseServiceId: value.selection.baseServiceId,
    selectedAddOns: value.selection.selectedAddOns,
    technicianId: value.technicianId ?? null,
    startTime: value.startTime,
    clientName: prepared.person.name,
    clientEmail: prepared.person.email,
    clientPhone: prepared.person.phone,
    smsConsent: value.smsConsent,
    expectedTotalCents: value.expectedTotalCents,
    expectedDiscountType: value.expectedDiscountType,
    expectedBookingFinancialQuote: value.expectedBookingFinancialQuote,
    expectedDepositFingerprint: value.expectedDepositFingerprint,
    catalogAcknowledgment: value.catalogAcknowledgment,
  }) });
  return createAppointmentFromRequest(request, { kind: 'anonymous_customer', salon: { id: SALON, slug: SALON }, contact: prepared.person, operation: { ...prepared.reference, secret: SECRET }, ...(executionGuard ? { executionGuard } : {}), ...(value.nextVisitOffer ? { nextVisitOffer: value.nextVisitOffer } : {}) });
}

function specificTechnicianMaterial(technicianId = TECH, technicianName = 'Synthetic Technician') {
  const value = material();
  value.technicianSelection = 'specific';
  value.technicianId = technicianId;
  value.review.technician = { kind: 'specific', id: technicianId, name: technicianName };
  return value;
}

async function prepareL1Material({ requiresCapability = false, depositsEnabled = false }: { requiresCapability?: boolean; depositsEnabled?: boolean } = {}): Promise<CustomerBookingMaterial> {
  if (!requiresCapability) {
    await database.delete(schema.technicianCapabilitySchema).where(eq(schema.technicianCapabilitySchema.id, 'synthetic-creator-l1-capability-assignment'));
    await database.delete(schema.catalogRuleSchema).where(eq(schema.catalogRuleSchema.id, 'synthetic-creator-l1-capability-rule'));
  }
  await database.update(schema.catalogRuleSchema).set({ isActive: true }).where(eq(schema.catalogRuleSchema.id, 'synthetic-creator-l1-auto'));
  await database.update(schema.salonSchema).set({ features: depositsEnabled ? { ...L1_FEATURES, money: { deposits: true } } : L1_FEATURES }).where(eq(schema.salonSchema.id, SALON));
  await database.update(schema.serviceSchema).set({ price: 6500, durationMinutes: 45 }).where(eq(schema.serviceSchema.id, SERVICE));
  await database.update(schema.addOnSchema).set({ priceCents: 500, durationMinutes: 5 }).where(eq(schema.addOnSchema.id, ADDON));
  await database.insert(schema.catalogRuleSchema).values({
    id: 'synthetic-creator-l1-auto',
    salonId: SALON,
    serviceId: SERVICE,
    ruleType: 'include',
    subjectServiceId: SERVICE,
    subjectAddOnId: null,
    objectAddOnId: ADDON,
    capabilityId: null,
    params: { autoAdd: true },
    priority: 0,
    isActive: true,
    note: null,
  }).onConflictDoNothing();
  if (requiresCapability) {
    await database.insert(schema.capabilitySchema).values({ id: L1_CAPABILITY, salonId: SALON, slug: L1_CAPABILITY, name: 'Synthetic L1 capability' }).onConflictDoNothing();
    await database.insert(schema.technicianCapabilitySchema).values({ id: 'synthetic-creator-l1-capability-assignment', salonId: SALON, technicianId: TECH, capabilityId: L1_CAPABILITY }).onConflictDoNothing();
    await database.insert(schema.catalogRuleSchema).values({ id: 'synthetic-creator-l1-capability-rule', salonId: SALON, serviceId: SERVICE, ruleType: 'requires_capability', subjectServiceId: SERVICE, subjectAddOnId: null, objectAddOnId: null, capabilityId: L1_CAPABILITY, params: {}, priority: 1, isActive: true, note: null }).onConflictDoNothing();
  }
  const current = await validatePublicBookingSelection({
    salonId: SALON,
    selection: { baseServiceId: SERVICE, selectedAddOns: [] },
  });
  if (!current.l1?.fingerprint) {
    throw new Error('Synthetic L1 catalog acknowledgment was unavailable');
  }
  const value = material();
  value.catalogAcknowledgment = { serviceId: SERVICE, resolutionFingerprint: current.l1.fingerprint };
  value.expectedTotalCents = current.quote.subtotalCents;
  value.expectedBookingFinancialQuote.totalDueCents = current.quote.subtotalCents;
  value.review.services = [{ id: SERVICE, name: 'Synthetic Creator Service', priceCents: 6500 }];
  value.review.addOns = current.quote.addOns.map(addOn => ({ id: addOn.addOnId, name: addOn.name, quantity: addOn.quantity, priceCents: addOn.lineTotalCents }));
  value.review.durationMinutes = current.quote.visibleDurationMinutes;
  value.review.financial.subtotalCents = current.quote.subtotalCents;
  value.review.financial.totalDueCents = current.quote.subtotalCents;
  return value;
}

(target ? describe : describe.skip)('customer operation uses actual public booking authority — PostgreSQL', () => {
  beforeAll(async () => {
    if (!target) {
      throw new Error('Missing attested target');
    }
    pool = new pg.Pool({ connectionString: target.connectionString, max: 10 });
    const connection = await pool.connect();
    try {
      await attestDisposableDatabaseSession(connection, target, resolveDisposableDatabaseServerExpectation(target));
    } finally {
      connection.release();
    }
    database = drizzle(pool, { schema });
    holder.db = database;
    holder.withSession = async (work) => {
      const connection = await pool.connect();
      try {
        return await work(drizzle(connection, { schema }));
      } finally {
        connection.release();
      }
    };
    await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    await database.insert(schema.salonSchema).values({ id: SALON, slug: SALON, name: 'Synthetic Creator Test Salon', ownerEmail: 'synthetic-owner@example.invalid', isActive: true, status: 'active', publicationStatus: 'published', settings: SETTINGS }).onConflictDoNothing();
    await database.insert(schema.salonSchema).values({ id: OTHER_SALON, slug: OTHER_SALON, name: 'Synthetic Other Creator Test Salon', ownerEmail: 'synthetic-other-owner@example.invalid', isActive: true, status: 'active', publicationStatus: 'published', settings: SETTINGS }).onConflictDoNothing();
    await database.insert(schema.technicianSchema).values({ id: TECH, salonId: SALON, name: 'Synthetic Technician', isActive: true, weeklySchedule: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, { start: '00:00', end: '23:45' }])) }).onConflictDoNothing();
    await database.insert(schema.technicianSchema).values({ id: OTHER_TECH, salonId: OTHER_SALON, name: 'Synthetic Other Technician', isActive: true, weeklySchedule: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, { start: '00:00', end: '23:45' }])) }).onConflictDoNothing();
    await database.insert(schema.serviceSchema).values({ id: SERVICE, salonId: SALON, name: 'Synthetic Creator Service', category: 'manicure', price: 6500, durationMinutes: 60, isActive: true }).onConflictDoNothing();
    await database.insert(schema.serviceSchema).values({ id: SERVICE_TWO, salonId: SALON, name: 'Synthetic Creator Service Two', category: 'pedicure', price: 6500, durationMinutes: 60, isActive: true }).onConflictDoNothing();
    await database.insert(schema.addOnSchema).values({ id: ADDON, salonId: SALON, name: 'Synthetic Art', slug: 'synthetic-art', category: 'nail_art', priceCents: 500, durationMinutes: 10, pricingType: 'per_unit', maxQuantity: 5 }).onConflictDoNothing();
    await database.insert(schema.serviceAddOnSchema).values({ id: 'synthetic-creator-addon-binding', salonId: SALON, serviceId: SERVICE, addOnId: ADDON, selectionMode: 'optional' }).onConflictDoNothing();
    await database.insert(schema.serviceAddOnSchema).values({ id: 'synthetic-creator-addon-binding-two', salonId: SALON, serviceId: SERVICE_TWO, addOnId: ADDON, selectionMode: 'optional' }).onConflictDoNothing();
    await database.insert(schema.technicianServicesSchema).values({ technicianId: TECH, serviceId: SERVICE, enabled: true }).onConflictDoNothing();
    await database.insert(schema.technicianServicesSchema).values({ technicianId: TECH, serviceId: SERVICE_TWO, enabled: true }).onConflictDoNothing();
  }, 120_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    requireStaffSession.mockResolvedValue({ ok: false });
    requireAdmin.mockResolvedValue({ ok: false });
    requireClientApiSession.mockResolvedValue({ ok: false });
    __setDepositStripeClientForTests({ checkout: { sessions: provider } });
    provider.create.mockRejectedValue(new Error('Unexpected provider request'));
    await database.update(schema.salonSchema).set({ settings: SETTINGS, features: null, businessHours: null }).where(eq(schema.salonSchema.id, SALON));
    await database.update(schema.serviceSchema).set({ price: 6500, durationMinutes: 60, confirmationMode: null, selectionMode: null }).where(eq(schema.serviceSchema.id, SERVICE));
    await database.update(schema.serviceSchema).set({ price: 6500, durationMinutes: 60, confirmationMode: null, selectionMode: null }).where(eq(schema.serviceSchema.id, SERVICE_TWO));
    await database.update(schema.addOnSchema).set({ priceCents: 500, durationMinutes: 10 }).where(eq(schema.addOnSchema.id, ADDON));
    await database.update(schema.serviceAddOnSchema).set({ priceMode: 'catalog_priced' }).where(eq(schema.serviceAddOnSchema.id, 'synthetic-creator-addon-binding'));
    await database.delete(schema.salonStripeAccountSchema).where(eq(schema.salonStripeAccountSchema.salonId, SALON));
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('External requests forbidden in synthetic booking verification'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sendTransactionalEmail.mockResolvedValue(true);
    sendTransactionalEmailDetailed.mockResolvedValue({ ok: true, errorCode: null, providerMessageId: 'synthetic' });
    sendAppointmentReminder.mockResolvedValue(true);
    await database.delete(schema.rewardSchema).where(eq(schema.rewardSchema.salonId, SALON));
    await database.delete(schema.communicationConsentSchema).where(eq(schema.communicationConsentSchema.salonId, SALON));
    await database.delete(schema.customerBookingOperationSchema).where(eq(schema.customerBookingOperationSchema.salonId, SALON));
    await database.delete(schema.appointmentDepositSchema).where(eq(schema.appointmentDepositSchema.salonId, SALON));
    await database.delete(schema.nextVisitOfferEventSchema).where(eq(schema.nextVisitOfferEventSchema.salonId, SALON));
    await database.delete(schema.retentionCampaignSchema).where(eq(schema.retentionCampaignSchema.salonId, SALON));
    await database.delete(schema.nextVisitOfferSchema).where(eq(schema.nextVisitOfferSchema.salonId, SALON));
    await database.delete(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON));
    await database.delete(schema.salonClientSchema).where(eq(schema.salonClientSchema.salonId, SALON));
    executed += 1;
  });

  afterAll(async () => {
    await pool?.end();

    expect(executed).toBe(41);

    process.stdout.write(`CUSTOMER_CREATOR_POSTGRES_TESTS_EXECUTED=${executed} CUSTOMER_CREATOR_POSTGRES_TESTS_SKIPPED=0\n`);
  });

  async function nextVisitMaterial() {
    await database.insert(schema.salonClientSchema).values({ id: 'next-visit-creator-client', salonId: SALON, phone: contact().phone, fullName: contact().name });
    await database.insert(schema.appointmentSchema).values({ id: 'next-visit-creator-source', salonId: SALON, salonClientId: 'next-visit-creator-client', clientPhone: contact().phone, clientName: contact().name, status: 'completed', completedAt: new Date('2099-08-15T18:00:00Z'), startTime: new Date('2099-08-15T17:00:00Z'), endTime: new Date('2099-08-15T18:00:00Z'), totalPrice: 6500, totalDurationMinutes: 60 });
    const settings = { enabled: true, windowDays: 30, discountType: 'percent' as const, value: 5, eligibleServiceIds: [SERVICE], messageTemplate: '' };
    await database.insert(schema.nextVisitOfferSchema).values({ id: 'next-visit-creator-offer', salonId: SALON, salonClientId: 'next-visit-creator-client', sourceAppointmentId: 'next-visit-creator-source', qualifiedAt: new Date('2099-08-15T18:00:00Z'), timeZone: 'America/Toronto', deadlineDate: '2099-09-14', expiresAt: new Date('2099-09-15T04:00:00Z'), currency: 'CAD', settingsSnapshot: settings });
    await database.insert(schema.retentionCampaignSchema).values({ id: 'next-visit-creator-campaign', salonId: SALON, salonClientId: 'next-visit-creator-client', stage: 'next_visit', nextVisitOfferId: 'next-visit-creator-offer', tokenHash: 'synthetic-next-visit-hash', promotionSnapshot: { ...settings, name: 'Next Visit Offer', expiryDays: 30, singleUse: true, code: null }, expiresAt: new Date('2099-09-15T04:00:00Z') });
    const value = material();
    value.nextVisitOffer = { campaignId: 'next-visit-creator-campaign', entitlementId: 'next-visit-creator-offer' };
    value.expectedTotalCents = 6175;
    value.expectedDiscountType = 'next_visit';
    value.expectedBookingFinancialQuote.totalDueCents = 6175;
    value.review.financial.discountAmountCents = 325;
    value.review.financial.discountLabel = 'Next Visit Offer';
    value.review.financial.totalDueCents = 6175;
    return value;
  }

  it('reserves Next Visit through actual durable booking and replay returns the same booking', async () => {
    const prepared = await prepare(contact(), await nextVisitMaterial());
    const first = await create(prepared);

    expect(first.status).toBe(201);
    expect((await create(prepared)).status).toBe(200);

    const [offer] = await database.select().from(schema.nextVisitOfferSchema).where(eq(schema.nextVisitOfferSchema.salonId, SALON));

    expect(offer?.state).toBe('reserved');

    const [appointment] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, offer!.reservedAppointmentId!));

    expect(appointment).toMatchObject({ totalPrice: 6175, discountAmountCents: 325, discountType: 'next_visit' });
    expect(provider.create).not.toHaveBeenCalled();
  });

  it('rejects another client presenting the same Next Visit reference without creating a visit', async () => {
    const prepared = await prepare(contact('2'), await nextVisitMaterial());

    expect((await create(prepared)).status).toBe(409);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(1);
    expect((await database.select().from(schema.nextVisitOfferSchema))[0]?.state).toBe('available');
  });

  it('rejects an owner offer when currency changes before the locked financial configuration', async () => {
    await nextVisitMaterial();
    const { mintNextVisitOfferLink } = await import('./nextVisitOffer.server');
    const link = await mintNextVisitOfferLink(database as never, { salonId: SALON, sourceAppointmentId: 'next-visit-creator-source' });
    requireStaffSession.mockResolvedValue({ ok: false });
    requireAdmin.mockResolvedValue({ ok: true });
    const originalTransaction = database.transaction.bind(database);
    const interception = vi.spyOn(database, 'transaction').mockImplementationOnce(async (callback, config) => {
      await database.update(schema.salonSchema).set({ settings: { ...SETTINGS, booking: { ...SETTINGS.booking, currency: 'USD' } } }).where(eq(schema.salonSchema.id, SALON));
      return originalTransaction(callback, config);
    });
    try {
      const response = await createAppointmentFromRequest(new Request('https://app.luster.test/api/appointments', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ salonSlug: SALON, serviceIds: [SERVICE], technicianId: TECH, startTime: START, clientName: contact().name, clientPhone: contact().phone, clientEmail: contact().email, campaignToken: link!.token }) }));

      expect(interception).toHaveBeenCalled();
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('NEXT_VISIT_OFFER_CHANGED');
      expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(1);
      expect((await database.select().from(schema.nextVisitOfferSchema).where(eq(schema.nextVisitOfferSchema.salonId, SALON)))[0]?.state).toBe('available');
    } finally {
      interception.mockRestore();
    }
  });

  it('two concurrent durable operations cannot consume the same qualifying visit', async () => {
    const firstValue = await nextVisitMaterial();
    const secondValue = structuredClone(firstValue);
    secondValue.startTime = '2099-09-02T15:00:00.000Z';
    secondValue.preference.date = '2099-09-02';
    secondValue.review.date = '2099-09-02';
    const first = await prepare(contact(), firstValue);
    const second = await prepare(contact(), secondValue);
    const responses = await Promise.all([create(first), create(second)]);

    expect(responses.filter(response => response.status === 201)).toHaveLength(1);

    const [offer] = await database.select().from(schema.nextVisitOfferSchema).where(eq(schema.nextVisitOfferSchema.salonId, SALON));

    expect(offer?.state).toBe('reserved');
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(2);
    expect(provider.create).not.toHaveBeenCalled();
  });

  it('accepts an L1 review whose canonical add-on order differs from raw database insertion order', async () => {
    await database.insert(schema.addOnSchema).values({ id: L1_SORTED_ADDON, salonId: SALON, name: 'AAA Synthetic Art', slug: L1_SORTED_ADDON, category: 'nail_art', priceCents: 200, durationMinutes: 2, pricingType: 'fixed', maxQuantity: 1, isActive: true }).onConflictDoNothing();
    await database.insert(schema.serviceAddOnSchema).values({ id: 'synthetic-creator-l1-sorted-binding', salonId: SALON, serviceId: SERVICE, addOnId: L1_SORTED_ADDON, selectionMode: 'optional' }).onConflictDoNothing();
    const value = await prepareL1Material();
    value.selection.selectedAddOns = [{ addOnId: ADDON, quantity: 1 }, { addOnId: L1_SORTED_ADDON, quantity: 1 }];
    const current = await validatePublicBookingSelection({ salonId: SALON, selection: value.selection });
    const publicSelection = await resolvePublicBookingSelection({ salonId: SALON, baseServiceId: SERVICE, selectedAddOns: value.selection.selectedAddOns });

    expect(publicSelection.addOns.map(addOn => addOn.id)).toEqual(current.quote.addOns.map(addOn => addOn.addOnId));

    value.catalogAcknowledgment = { serviceId: SERVICE, resolutionFingerprint: current.l1!.fingerprint! };
    value.expectedTotalCents = publicSelection.totalPriceCents;
    value.expectedBookingFinancialQuote.totalDueCents = publicSelection.totalPriceCents;
    value.review.addOns = publicSelection.addOns.map(addOn => ({ id: addOn.id, name: addOn.name, quantity: addOn.quantity, priceCents: addOn.lineTotalCents }));
    value.review.durationMinutes = publicSelection.visibleDurationMinutes;
    value.review.financial.subtotalCents = publicSelection.totalPriceCents;
    value.review.financial.totalDueCents = publicSelection.totalPriceCents;
    const response = await create(await prepare(contact(), value));

    expect(response.status, JSON.stringify(await response.json())).toBe(201);

    const [appointment] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON));

    expect(appointment).toMatchObject({ totalPrice: 7200, totalDurationMinutes: 52 });
    expect(await database.select().from(schema.appointmentAddOnSchema).where(eq(schema.appointmentAddOnSchema.appointmentId, appointment!.id))).toHaveLength(2);
  });

  it('uses the L1 acknowledgment to persist the authoritative five-minute automatic add-on', async () => {
    const value = await prepareL1Material();
    const response = await create(await prepare(contact(), value));

    expect(response.status, JSON.stringify(await response.json())).toBe(201);

    const [appointment] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON));

    expect(appointment).toMatchObject({ totalPrice: 7000, totalDurationMinutes: 50 });
    expect(await database.select().from(schema.appointmentAddOnSchema).where(eq(schema.appointmentAddOnSchema.appointmentId, appointment!.id))).toEqual([
      expect.objectContaining({ addOnId: ADDON, quantitySnapshot: 1, lineTotalCentsSnapshot: 500, lineDurationMinutesSnapshot: 5 }),
    ]);
  });

  it.each([
    ['price', async () => database.update(schema.serviceSchema).set({ price: 7100 }).where(eq(schema.serviceSchema.id, SERVICE))],
    ['duration', async () => database.update(schema.serviceSchema).set({ durationMinutes: 46 }).where(eq(schema.serviceSchema.id, SERVICE))],
  ] as const)('rejects stale L1 %s before client or appointment writes', async (_name, change) => {
    const value = await prepareL1Material();
    await change();
    const response = await create(await prepare(contact(), value));

    expect(response.status, JSON.stringify(await response.json())).toBe(409);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(0);
    expect(await database.select().from(schema.salonClientSchema).where(eq(schema.salonClientSchema.salonId, SALON))).toHaveLength(0);
  });

  it('rejects a catalog mutation after preflight and before the booking transaction', async () => {
    const value = await prepareL1Material();
    const prepared = await prepare(contact(), value);
    const originalTransaction = database.transaction.bind(database);
    const changedBeforeTransaction: typeof database.transaction = async (callback, config) => {
      await database.update(schema.addOnSchema).set({ durationMinutes: 10 }).where(eq(schema.addOnSchema.id, ADDON));
      return originalTransaction(callback, config);
    };
    const interception = vi.spyOn(database, 'transaction').mockImplementationOnce(changedBeforeTransaction);
    try {
      const response = await create(prepared);

      expect(interception).toHaveBeenCalled();
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('CATALOG_SELECTION_CHANGED');
      expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(0);
      expect(await database.select().from(schema.salonClientSchema).where(eq(schema.salonClientSchema.salonId, SALON))).toHaveLength(0);
      expect((await readCustomerBookingOperation({ salonId: SALON, capability: prepared.reference.capability, secret: SECRET })).appointmentId).toBeNull();
    } finally {
      interception.mockRestore();
    }
  });

  it('rejects an L1 capability removal before client or appointment writes', async () => {
    const value = await prepareL1Material({ requiresCapability: true });
    await database.delete(schema.technicianCapabilitySchema).where(eq(schema.technicianCapabilitySchema.id, 'synthetic-creator-l1-capability-assignment'));
    const response = await create(await prepare(contact(), value));

    expect(response.status, JSON.stringify(await response.json())).toBe(409);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(0);
    expect(await database.select().from(schema.salonClientSchema).where(eq(schema.salonClientSchema.salonId, SALON))).toHaveLength(0);
  });

  it('rejects an L1 automatic-rule mutation before client or appointment writes', async () => {
    const value = await prepareL1Material();
    await database.update(schema.catalogRuleSchema).set({ isActive: false }).where(eq(schema.catalogRuleSchema.id, 'synthetic-creator-l1-auto'));
    const response = await create(await prepare(contact(), value));

    expect(response.status, JSON.stringify(await response.json())).toBe(409);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(0);
    expect(await database.select().from(schema.salonClientSchema).where(eq(schema.salonClientSchema.salonId, SALON))).toHaveLength(0);
  });

  it('uses the L1 automatic-add-on total for a required deposit and replays without a duplicate checkout', async () => {
    await database.update(schema.salonSchema).set({
      settings: { ...SETTINGS, payments: { deposit: { enabled: true, amountCents: 10000 } } },
    }).where(eq(schema.salonSchema.id, SALON));
    const [binding] = await database.insert(schema.salonStripeAccountSchema).values({
      id: 'synthetic-creator-l1-deposit-account',
      salonId: SALON,
      stripeAccountId: 'acct_synthetic_creator_l1_deposit',
      livemode: false,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      lastSyncedAt: new Date(),
    }).returning();
    provider.readiness.mockResolvedValue({ chargeReady: true, status: 'charge_ready', payoutsPending: false, binding });
    provider.create.mockResolvedValue({
      id: 'cs_synthetic_l1_deposit',
      url: 'https://checkout.stripe.com/c/pay/cs_synthetic_l1_deposit',
      status: 'open',
      payment_status: 'unpaid',
      payment_intent: null,
      currency: 'cad',
      amount_total: 7000,
    });
    const value = await prepareL1Material({ depositsEnabled: true });
    value.expectedDepositFingerprint = 'deposit-v1:cad:7000';
    value.review.deposit = {
      status: 'required',
      amountCents: 7000,
      currency: 'CAD',
      label: buildDepositDisclosure({ required: true, amountCents: 7000, currency: 'cad' })!.label,
    };
    const prepared = await prepare(contact(), value);
    const first = await create(prepared);

    expect(first.status, JSON.stringify(await first.json())).toBe(201);
    expect(await database.select().from(schema.appointmentDepositSchema).where(eq(schema.appointmentDepositSchema.salonId, SALON))).toEqual([
      expect.objectContaining({ amountCents: 7000, currency: 'cad' }),
    ]);
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect((await create(prepared)).status).toBe(200);
    expect(provider.create).toHaveBeenCalledTimes(1);
  });

  it('keeps L1 durable replay and same-slot contention atomic', async () => {
    const value = await prepareL1Material();
    const first = await prepare(contact('1'), value);
    const same = await Promise.all([create(first), create(first)]);

    expect((await Promise.all(same.map(response => response.json().then((_body: unknown) => response.status)))).sort()).toEqual([200, 201]);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(1);

    const secondCustomer = await prepare(contact('2'), value);

    expect((await create(secondCustomer)).status).toBe(409);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(1);
  });

  it('creates one appointment with the reviewed specific technician', async () => {
    const response = await create(await prepare(contact(), specificTechnicianMaterial()));

    expect(response.status, JSON.stringify(await response.json())).toBe(201);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toEqual([
      expect.objectContaining({ technicianId: TECH }),
    ]);
  });

  it.each([
    ['another tenant', async () => specificTechnicianMaterial(OTHER_TECH, 'Synthetic Other Technician')],
    ['inactive assignment', async () => {
      const value = specificTechnicianMaterial();
      await database.update(schema.technicianSchema).set({ isActive: false }).where(eq(schema.technicianSchema.id, TECH));
      return value;
    }],
    ['renamed technician', async () => {
      const value = specificTechnicianMaterial();
      await database.update(schema.technicianSchema).set({ name: 'Renamed Synthetic Technician' }).where(eq(schema.technicianSchema.id, TECH));
      return value;
    }],
  ] as const)('rejects a specific technician from %s without creating an appointment', async (_reason, change) => {
    try {
      const response = await create(await prepare(contact(), await change()));

      expect(response.status, JSON.stringify(await response.json())).toBeGreaterThanOrEqual(400);
      expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(0);
      expect(await database.select().from(schema.salonClientSchema).where(eq(schema.salonClientSchema.salonId, SALON))).toHaveLength(0);
    } finally {
      await database.update(schema.technicianSchema).set({ isActive: true, name: 'Synthetic Technician' }).where(eq(schema.technicianSchema.id, TECH));
    }
  });

  it('creates once through the public authority and recovers the original after a lost response', async () => {
    const prepared = await prepare();
    const response = await create(prepared);
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(201);

    const recovered = await readCustomerBookingOperation({ salonId: SALON, capability: prepared.reference.capability, secret: SECRET });

    expect(recovered.appointmentId).toBeTruthy();
    expect((await create(prepared)).status).toBe(200);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(1);
    expect(requireStaffSession).not.toHaveBeenCalled();
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(requireClientApiSession).not.toHaveBeenCalled();
  });

  it('serializes double confirm for one durable operation', async () => {
    const prepared = await prepare();
    const responses = await Promise.all([create(prepared), create(prepared)]);
    const results = await Promise.all(responses.map(async response => ({ status: response.status, body: await response.json() })));

    expect(results.map(result => result.status).sort()).toEqual([200, 201]);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(1);
  });

  it('permits only one of two different customers to claim the same slot', async () => {
    const prepared = await Promise.all([prepare(contact('1')), prepare(contact('2'))]);
    const responses = await Promise.all(prepared.map(item => create(item)));
    const results = await Promise.all(responses.map(async response => ({ status: response.status, body: await response.json() })));

    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(1);
  });

  it.each(['default_on', 'explicit_off', 'explicit_on'] as const)('preserves canonical #245 preference %s through the actual authority', async (selection) => {
    const value = material();
    const granted = selection !== 'explicit_off';
    value.smsConsent = { granted, selection, wordingVersion: 'booking-sms-reminders-v1' };
    value.review.reminders = { mode: 'default_on', selection, requestedEnabled: granted };
    const prepared = await prepare(contact(), value);
    const response = await create(prepared);

    expect(response.status, JSON.stringify(await response.json())).toBe(201);

    const rows = await database.select().from(schema.communicationConsentSchema).where(eq(schema.communicationConsentSchema.salonId, SALON));

    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: 'appointment_reminders', status: granted ? 'granted' : 'revoked', metadata: expect.objectContaining({ selection, selectionWasExplicit: selection !== 'default_on' }) })]));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(['default_on', 'explicit_off'] as const)('records the expanded booking text choice %s for all purposes', async (selection) => {
    const value = material();
    const granted = selection === 'default_on';
    value.smsConsent = { granted, selection, wordingVersion: 'booking-sms-all-v2' };
    value.review.reminders = { mode: 'default_on', selection, requestedEnabled: granted };
    const response = await create(await prepare(contact(), value));

    expect(response.status, JSON.stringify(await response.json())).toBe(201);

    const rows = await database.select().from(schema.communicationConsentSchema).where(eq(schema.communicationConsentSchema.salonId, SALON));

    expect(rows).toEqual(expect.arrayContaining(['appointment_reminders', 'appointment_transactional', 'salon_promotions'].map(purpose => expect.objectContaining({
      purpose,
      status: granted ? 'granted' : 'revoked',
      wordingVersion: 'booking-sms-all-v2',
      metadata: expect.objectContaining({ selection, selectionWasExplicit: !granted }),
    }))));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps prior STOP suppressed despite a default-on booking', async () => {
    await database.insert(schema.communicationConsentSchema).values({ id: randomUUID(), salonId: SALON, recipient: contact().phone, channel: 'sms', purpose: 'appointment_transactional', status: 'revoked', source: 'twilio_inbound', wordingVersion: 'STOP', revokedAt: new Date() });
    const value = material();
    value.smsConsent = { granted: true, selection: 'default_on', wordingVersion: 'booking-sms-all-v2' };
    const prepared = await prepare(contact(), value);
    const response = await create(prepared);

    expect(response.status, JSON.stringify(await response.json())).toBe(201);

    const rows = await database.select().from(schema.communicationConsentSchema).where(eq(schema.communicationConsentSchema.salonId, SALON));

    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'twilio_inbound', status: 'revoked' }), ...['appointment_reminders', 'appointment_transactional', 'salon_promotions'].map(purpose => expect.objectContaining({ purpose, status: 'revoked', metadata: expect.objectContaining({ selection: 'default_on', suppression: 'provider_opt_out' }) }))]));
    expect(rows.filter(item => item.status === 'granted')).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rolls back creation and newly resolved client when reviewed service duration changes', async () => {
    const prepared = await prepare();
    await database.update(schema.serviceSchema).set({ durationMinutes: 75 }).where(eq(schema.serviceSchema.id, SERVICE));
    try {
      const response = await create(prepared);

      expect(response.status, JSON.stringify(await response.json())).toBe(409);
      expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(0);
      expect(await database.select().from(schema.salonClientSchema).where(eq(schema.salonClientSchema.salonId, SALON))).toHaveLength(0);
    } finally {
      await database.update(schema.serviceSchema).set({ durationMinutes: 60 }).where(eq(schema.serviceSchema.id, SERVICE));
    }
  });

  it('commits exact per-unit add-on prices and duration snapshots', async () => {
    const value = material();
    value.selection.selectedAddOns = [{ addOnId: ADDON, quantity: 2 }];
    value.expectedTotalCents = 7500;
    value.expectedBookingFinancialQuote.totalDueCents = 7500;
    value.review.addOns = [{ id: ADDON, name: 'Synthetic Art', quantity: 2, priceCents: 1000 }];
    value.review.durationMinutes = 80;
    value.review.financial.subtotalCents = 7500;
    value.review.financial.totalDueCents = 7500;
    const prepared = await prepare(contact(), value);
    const response = await create(prepared);

    expect(response.status, JSON.stringify(await response.json())).toBe(201);

    const [appointment] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON));

    expect(appointment).toMatchObject({ totalPrice: 7500, totalDurationMinutes: 80 });

    const [appointmentService] = await database
      .select()
      .from(schema.appointmentServicesSchema)
      .where(eq(schema.appointmentServicesSchema.appointmentId, appointment!.id));

    expect(await database.select().from(schema.appointmentAddOnSchema).where(eq(schema.appointmentAddOnSchema.appointmentId, appointment!.id))).toEqual([
      expect.objectContaining({
        appointmentServiceId: appointmentService!.id,
        quantitySnapshot: 2,
        lineTotalCentsSnapshot: 1000,
        lineDurationMinutesSnapshot: 20,
        priceDisplayTextSnapshot: null,
      }),
    ]);
  });

  it('keeps identical add-ons scoped to their selected services in one basket', async () => {
    const person = contact('8');
    const bookingBasket = {
      version: 2 as const,
      items: [
        { serviceId: SERVICE, selectedAddOns: [{ addOnId: ADDON, quantity: 1 }] },
        { serviceId: SERVICE_TWO, selectedAddOns: [{ addOnId: ADDON, quantity: 1 }] },
      ],
    };
    const expectedBasketReviewFingerprint = fingerprintBookingBasketReview(
      await validatePublicBookingBasket({ salonId: SALON, basket: bookingBasket, technicianId: TECH }),
    );
    const response = await createAppointmentFromRequest(new Request('https://app.luster.test/api/appointments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        salonSlug: SALON,
        bookingBasket,
        expectedBasketReviewFingerprint,
        technicianId: TECH,
        startTime: START,
        clientName: person.name,
        clientPhone: person.phone,
        clientEmail: person.email,
      }),
    }));

    expect(response.status, JSON.stringify(await response.json())).toBe(201);

    const [appointment] = await database.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.salonId, SALON));

    expect(appointment).toMatchObject({ totalPrice: 14000, totalDurationMinutes: 140, subtotalBeforeDiscountCents: 14000 });

    const services = await database.select().from(schema.appointmentServicesSchema)
      .where(eq(schema.appointmentServicesSchema.appointmentId, appointment!.id));
    const serviceIdByRowId = new Map(services.map(service => [service.id, service.serviceId]));
    const addOns = await database.select().from(schema.appointmentAddOnSchema)
      .where(eq(schema.appointmentAddOnSchema.appointmentId, appointment!.id));

    expect(addOns).toHaveLength(2);
    expect(addOns.map(addOn => ({
      serviceId: serviceIdByRowId.get(addOn.appointmentServiceId!),
      addOnId: addOn.addOnId,
      lineTotalCents: addOn.lineTotalCentsSnapshot,
      lineDurationMinutes: addOn.lineDurationMinutesSnapshot,
    })).sort((left, right) => (left.serviceId ?? '').localeCompare(right.serviceId ?? ''))).toEqual([
      { serviceId: SERVICE, addOnId: ADDON, lineTotalCents: 500, lineDurationMinutes: 10 },
      { serviceId: SERVICE_TWO, addOnId: ADDON, lineTotalCents: 500, lineDurationMinutes: 10 },
    ]);
  });

  it('rejects a duration-only basket change after review without writing an appointment', async () => {
    const person = contact('9');
    const bookingBasket = {
      version: 2 as const,
      items: [
        { serviceId: SERVICE, selectedAddOns: [{ addOnId: ADDON, quantity: 1 }] },
        { serviceId: SERVICE_TWO, selectedAddOns: [] },
      ],
    };
    const expectedBasketReviewFingerprint = fingerprintBookingBasketReview(
      await validatePublicBookingBasket({ salonId: SALON, basket: bookingBasket, technicianId: TECH }),
    );
    await database.update(schema.addOnSchema).set({ durationMinutes: 11 }).where(eq(schema.addOnSchema.id, ADDON));

    const response = await createAppointmentFromRequest(new Request('https://app.luster.test/api/appointments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        salonSlug: SALON,
        bookingBasket,
        expectedBasketReviewFingerprint,
        technicianId: TECH,
        startTime: START,
        clientName: person.name,
        clientPhone: person.phone,
        clientEmail: person.email,
      }),
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('BASKET_REVIEW_CHANGED');
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(0);
  });

  it('creates one approval request when any basket service requires approval', async () => {
    const person = contact('7');
    const reviewableStart = `${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}T15:00:00.000Z`;
    await database.update(schema.salonSchema).set({
      features: L1_FEATURES,
      businessHours: {
        monday: { open: '09:00', close: '17:00' },
        tuesday: { open: '09:00', close: '17:00' },
        wednesday: { open: '09:00', close: '17:00' },
        thursday: { open: '09:00', close: '17:00' },
        friday: { open: '09:00', close: '17:00' },
        saturday: { open: '09:00', close: '17:00' },
        sunday: { open: '09:00', close: '17:00' },
      },
    }).where(eq(schema.salonSchema.id, SALON));
    await database.update(schema.serviceSchema).set({ confirmationMode: 'request_approval', selectionMode: 'direct' }).where(eq(schema.serviceSchema.id, SERVICE_TWO));
    const bookingBasket = {
      version: 2 as const,
      items: [
        { serviceId: SERVICE, selectedAddOns: [] },
        { serviceId: SERVICE_TWO, selectedAddOns: [] },
      ],
    };
    const expectedBasketReviewFingerprint = fingerprintBookingBasketReview(
      await validatePublicBookingBasket({ salonId: SALON, basket: bookingBasket, technicianId: TECH }),
    );
    const response = await createAppointmentFromRequest(new Request('https://app.luster.test/api/appointments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        salonSlug: SALON,
        bookingBasket,
        expectedBasketReviewFingerprint,
        technicianId: TECH,
        startTime: reviewableStart,
        clientName: person.name,
        clientPhone: person.phone,
        clientEmail: person.email,
      }),
    }));

    expect(response.status, JSON.stringify(await response.json())).toBe(201);

    const [appointment] = await database.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.salonId, SALON));

    expect(appointment).toMatchObject({ status: 'pending', confirmationModeSnapshot: 'request_approval', selectionModeSnapshot: null });
  });

  it('commits a salon-authorized manual-price add-on with duration but without inventing a charge', async () => {
    await database.update(schema.serviceAddOnSchema).set({ priceMode: 'manual_confirmation' }).where(eq(schema.serviceAddOnSchema.id, 'synthetic-creator-addon-binding'));
    const value = material();
    value.selection.selectedAddOns = [{ addOnId: ADDON, quantity: 1 }];
    value.review.manualConfirmationItems = [{ id: ADDON, name: 'Synthetic Art', quantity: 1, durationMinutes: 10, priceStatus: 'to_be_confirmed' }];
    value.review.durationMinutes = 70;

    const response = await create(await prepare(contact(), value));

    expect(response.status, JSON.stringify(await response.json())).toBe(201);

    const [appointment] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON));
    const [addOn] = await database.select().from(schema.appointmentAddOnSchema).where(eq(schema.appointmentAddOnSchema.appointmentId, appointment!.id));

    expect(appointment).toMatchObject({ totalPrice: 6500, totalDurationMinutes: 70 });
    expect(addOn).toMatchObject({ addOnId: ADDON, priceModeSnapshot: 'manual_confirmation', lineTotalCentsSnapshot: 0, lineDurationMinutesSnapshot: 10 });
  });

  it('uses the existing same-salon client without creating a duplicate identity', async () => {
    await database.insert(schema.salonClientSchema).values({ id: 'synthetic-creator-returning', salonId: SALON, phone: contact().phone, fullName: 'Synthetic Existing Customer', email: contact().email });
    const response = await create(await prepare());

    expect(response.status, JSON.stringify(await response.json())).toBe(201);
    expect(await database.select().from(schema.salonClientSchema).where(eq(schema.salonClientSchema.salonId, SALON))).toHaveLength(1);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toEqual([expect.objectContaining({ salonClientId: 'synthetic-creator-returning' })]);
  });

  it('rolls back the canonical booking when the trusted execution guard rejects its tenant lease', async () => {
    const prepared = await prepare();
    let calls = 0;
    const response = await create(prepared, async (tx) => {
      calls += 1;
      // A real guard uses this same transaction to fence the route-resolved
      // tenant/call epoch. Throwing here must leave no appointment or link.
      await tx.select({ id: schema.salonSchema.id }).from(schema.salonSchema).where(eq(schema.salonSchema.id, OTHER_SALON));
      throw new Error('VOICE_TENANT_LEASE_REJECTED');
    });

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(calls).toBe(1);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(0);
    expect((await readCustomerBookingOperation({ salonId: SALON, capability: prepared.reference.capability, secret: SECRET })).appointmentId).toBeNull();
  });

  it('runs the trusted execution guard inside the successful canonical booking transaction', async () => {
    const prepared = await prepare();
    const transactionHandles = new Set<unknown>();
    let calls = 0;
    const response = await create(prepared, async (tx) => {
      calls += 1;
      transactionHandles.add(tx);
      await tx.select({ id: schema.salonSchema.id }).from(schema.salonSchema).where(eq(schema.salonSchema.id, SALON));
    });

    expect(response.status, JSON.stringify(await response.json())).toBe(201);
    // The guard fences both the pre-write revalidation and post-write link in
    // one transaction handle; it never runs as a detached preflight.
    expect(transactionHandles.size).toBe(1);
    expect(calls).toBe(2);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(1);
  });

  it('rolls back the appointment and operation link when the final execution fence rejects', async () => {
    const prepared = await prepare();
    let calls = 0;
    const response = await create(prepared, async () => {
      calls += 1;
      if (calls === 2) {
        throw new Error('VOICE_LEASE_EXPIRED_BEFORE_COMMIT');
      }
    });

    expect(calls).toBe(2);
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(0);
    expect((await readCustomerBookingOperation({ salonId: SALON, capability: prepared.reference.capability, secret: SECRET })).appointmentId).toBeNull();
    expect(await database.select().from(schema.appointmentDepositSchema).where(eq(schema.appointmentDepositSchema.salonId, SALON))).toHaveLength(0);
  });

  it('creates nothing when another booking takes the reviewed slot before Confirm', async () => {
    const waiting = await prepare(contact('1'));

    expect((await create(await prepare(contact('2')))).status).toBe(201);

    const response = await create(waiting);

    expect(response.status).toBe(409);
    expect((await readCustomerBookingOperation({ salonId: SALON, capability: waiting.reference.capability, secret: SECRET })).appointmentId).toBeNull();
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(1);
  });

  it('rejects a capability bound to another salon before any booking write', async () => {
    const prepared = await prepare();
    const request = new Request('https://app.luster.test/api/appointments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ salonSlug: 'other-synthetic-salon', baseServiceId: SERVICE, selectedAddOns: [], startTime: START, clientPhone: contact().phone, clientName: contact().name, clientEmail: contact().email }) });
    const response = await createAppointmentFromRequest(request, { kind: 'anonymous_customer', salon: { id: 'other-synthetic-salon', slug: 'other-synthetic-salon' }, contact: prepared.person, operation: { ...prepared.reference, secret: SECRET } });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(0);
  });

  it.each([
    ['price', async () => database.update(schema.serviceSchema).set({ price: 7000 }).where(eq(schema.serviceSchema.id, SERVICE)), async () => database.update(schema.serviceSchema).set({ price: 6500 }).where(eq(schema.serviceSchema.id, SERVICE))],
    ['reminder mode', async () => database.update(schema.salonSchema).set({ settings: { ...SETTINGS, communications: { sms: { bookingDefault: 'disabled' } } } }).where(eq(schema.salonSchema.id, SALON)), async () => database.update(schema.salonSchema).set({ settings: SETTINGS }).where(eq(schema.salonSchema.id, SALON))],
  ] as const)('refuses a changed %s instead of silently accepting stale review', async (_name, change, restore) => {
    const prepared = await prepare();
    await change();
    try {
      const response = await create(prepared);

      expect(response.status, JSON.stringify(await response.json())).toBe(409);
      expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(0);
    } finally {
      await restore();
    }
  });

  it('links a returning-client reward in the same durable appointment commit', async () => {
    await database.insert(schema.rewardSchema).values({ id: 'synthetic-creator-reward', salonId: SALON, clientPhone: contact().phone, type: 'referral_referrer', discountType: 'fixed_amount', discountAmountCents: 500 });
    const value = material();
    value.expectedTotalCents = 6000;
    value.expectedDiscountType = 'reward';
    value.expectedBookingFinancialQuote.totalDueCents = 6000;
    value.review.financial.discountAmountCents = 500;
    value.review.financial.totalDueCents = 6000;
    const prepared = await prepare(contact(), value);
    const response = await create(prepared);

    expect(response.status, JSON.stringify(await response.json())).toBe(201);

    const operation = await readCustomerBookingOperation({ salonId: SALON, capability: prepared.reference.capability, secret: SECRET });

    expect(await database.select().from(schema.rewardSchema).where(eq(schema.rewardSchema.salonId, SALON))).toEqual([expect.objectContaining({ status: 'active', usedInAppointmentId: operation.appointmentId })]);
  });

  it('recovers one guest management capability while AI is disabled, without reviving revoked links', async () => {
    const prepared = await prepare();

    expect((await create(prepared)).status).toBe(201);

    vi.stubEnv('CUSTOMER_ASSISTANT_SIGNING_SECRET', SECRET);
    vi.stubEnv('CUSTOMER_ASSISTANT_ENABLED', 'false');
    const action = (salonId = SALON) => runCustomerBookingRecoveryAction(new Request('https://app.luster.test/api/public/customer-booking/recover/manage', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'origin': 'https://app.luster.test' },
      body: JSON.stringify({ capability: prepared.reference.capability }),
    }), salonId, 'manage');
    try {
      const first = await action();
      const second = await action();

      expect(first.status).toBe(200);
      expect(await first.json()).toEqual(await second.json());
      expect((await action('another-salon')).status).toBe(404);

      const operation = await readCustomerBookingOperation({ salonId: SALON, capability: prepared.reference.capability, secret: SECRET });

      expect(await database.select().from(schema.appointmentAccessTokenSchema).where(eq(schema.appointmentAccessTokenSchema.appointmentId, operation.appointmentId!))).toHaveLength(2);

      await database.update(schema.appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(eq(schema.appointmentAccessTokenSchema.appointmentId, operation.appointmentId!));

      expect((await action()).status).toBe(404);
      expect(await database.select().from(schema.appointmentAccessTokenSchema).where(eq(schema.appointmentAccessTokenSchema.appointmentId, operation.appointmentId!))).toHaveLength(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('recovers the original deposit checkout after a lost response without a duplicate hold or payment attempt', async () => {
    await database.update(schema.salonSchema).set({ settings: { ...SETTINGS, payments: { deposit: { enabled: true, amountCents: 2500 } } }, features: { money: { deposits: true } } }).where(eq(schema.salonSchema.id, SALON));
    const [binding] = await database.insert(schema.salonStripeAccountSchema).values({ id: 'synthetic-creator-account', salonId: SALON, stripeAccountId: 'acct_synthetic_creator', livemode: false, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, lastSyncedAt: new Date() }).returning();
    provider.readiness.mockResolvedValue({ chargeReady: true, status: 'charge_ready', payoutsPending: false, binding });
    let originalSession: unknown;
    provider.create.mockImplementation(async (params, options) => {
      const session = { id: 'cs_synthetic_original', url: 'https://checkout.stripe.com/c/pay/cs_synthetic_original', status: 'open', payment_status: 'unpaid', payment_intent: null, expires_at: params.expires_at, metadata: params.metadata, currency: 'cad', amount_total: 2500 };
      if (!originalSession) {
        originalSession = session;
        throw new Error('Synthetic network timeout after checkout creation');
      }

      expect(options.idempotencyKey).toBe(provider.create.mock.calls[0]![1].idempotencyKey);
      expect(params).toEqual(provider.create.mock.calls[0]![0]);

      return session;
    });
    const value = material();
    value.expectedDepositFingerprint = 'deposit-v1:cad:2500';
    value.review.deposit = { status: 'required', amountCents: 2500, currency: 'CAD', label: buildDepositDisclosure({ required: true, amountCents: 2500, currency: 'cad' })!.label };
    const prepared = await prepare(contact(), value);
    const response = await create(prepared);

    expect(response.status, JSON.stringify(await response.json())).toBe(503);

    const operation = await readCustomerBookingOperation({ salonId: SALON, capability: prepared.reference.capability, secret: SECRET });

    expect(operation.appointmentId).toBeTruthy();
    expect((await readCustomerBookingStatus(operation, SECRET)).status).toBe('payment_required');
    expect((await create(prepared)).status).toBe(200);
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(await resumeCustomerDepositCheckout({ salonId: SALON, appointmentId: operation.appointmentId! })).toBe('https://checkout.stripe.com/c/pay/cs_synthetic_original');
    expect(provider.create).toHaveBeenCalledTimes(2);

    // A stale unpaid provider response must not erase a payment intent already
    // recorded by the webhook. Then reconcile the same session's paid result.
    await database.update(schema.appointmentDepositSchema).set({ stripeCheckoutUrl: null, stripePaymentIntentId: 'pi_synthetic_original' }).where(eq(schema.appointmentDepositSchema.salonId, SALON));
    provider.retrieve.mockResolvedValue(originalSession);
    await resumeCustomerDepositCheckout({ salonId: SALON, appointmentId: operation.appointmentId! });
    const [preserved] = await database.select().from(schema.appointmentDepositSchema).where(eq(schema.appointmentDepositSchema.salonId, SALON));

    expect(preserved?.stripePaymentIntentId).toBe('pi_synthetic_original');

    await database.update(schema.appointmentDepositSchema).set({ stripeCheckoutUrl: null }).where(eq(schema.appointmentDepositSchema.salonId, SALON));
    provider.retrieve.mockResolvedValue({ ...(originalSession as Record<string, unknown>), status: 'complete', payment_status: 'paid', payment_intent: 'pi_synthetic_original', url: null });

    expect(await resumeCustomerDepositCheckout({ salonId: SALON, appointmentId: operation.appointmentId! })).toBeNull();
    expect((await readCustomerBookingStatus(operation, SECRET)).status).toBe('confirmed');
    expect(provider.create).toHaveBeenCalledTimes(2);
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(1);
    expect(await database.select().from(schema.appointmentDepositSchema).where(eq(schema.appointmentDepositSchema.salonId, SALON))).toHaveLength(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
