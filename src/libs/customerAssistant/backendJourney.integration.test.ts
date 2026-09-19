/**
 * A browser-driven, server-native customer journey. The browser uses the Vite
 * component fixture, while every assistant request is fulfilled by the real
 * route handler against an attested disposable PostgreSQL database. The only
 * substitutes are the bounded model transport and Redis quota authority: this
 * test has no provider credentials and deliberately never reaches a provider.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { expect as browserExpect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { type Browser, chromium, webkit } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

const rawUrl = process.env.CUSTOMER_BOOKING_BROWSER_DATABASE_URL;
if (!rawUrl && process.env.CUSTOMER_BOOKING_BROWSER_REQUIRED === 'true') {
  throw new Error('Customer browser journey requires an attested disposable PostgreSQL target.');
}
const target = rawUrl ? requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: rawUrl }) : null;
const SALON = 'synthetic-browser-isla-salon';
const TECHNICIAN = 'synthetic-browser-isla-tech';
const SERVICE = 'synthetic-browser-isla-service';
const L1_SERVICE = 'synthetic-browser-isla-l1-service';
const L1_AUTO = 'synthetic-browser-isla-l1-auto';
const L1_OPTIONAL = 'synthetic-browser-isla-l1-french';
const SECRET = 'synthetic-browser-customer-assistant-signing-secret';
const L1_FEATURES = { catalog: { variantsV1: true, addOnGroupsV1: false, bookingModesV1: false } };
const SETTINGS = {
  booking: { timezone: 'America/Toronto', currency: 'CAD', slotIntervalMinutes: 15, bufferMinutes: 0 },
  bookingExperience: { policy: { enabled: false } },
};

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown, withSession: null as unknown as <T>(work: (database: unknown) => Promise<T>) => Promise<T> }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
  usesRuntimePostgres: true,
  DatabaseSessionReleaseError: class DatabaseSessionReleaseError extends Error {},
  withDedicatedDatabaseSession: <T>(work: (database: unknown) => Promise<T>) => holder.withSession(work),
}));
// The real quota adapter fails closed without Redis. This focused UI-to-handler
// journey substitutes only that infrastructure boundary; SQL conversation,
// quote, operation, and appointment authority remain real.
vi.mock('@/libs/customerAssistant/budget.server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/customerAssistant/budget.server')>()),
  reserveCustomerAssistantTurn: vi.fn(async () => ({ ok: true as const })),
}));
const model = vi.hoisted(() => ({ createResponse: vi.fn() }));
vi.mock('@/libs/ai/openaiResponses.server', () => ({
  createOpenAiResponsesProvider: vi.fn(() => ({ createResponse: model.createResponse })),
}));
vi.mock('@/core/redis/redisClient', () => ({ redis: null, isRedisAvailable: vi.fn(async () => false) }));
vi.mock('@/libs/email', () => ({ sendTransactionalEmail: vi.fn(async () => true), sendTransactionalEmailDetailed: vi.fn(async () => ({ ok: true, errorCode: null, providerMessageId: 'synthetic' })) }));
vi.mock('@/libs/SMS', () => ({ sendBookingConfirmationToClient: vi.fn(), sendCancellationNotificationToTech: vi.fn(), sendRescheduleConfirmation: vi.fn(), sendAppointmentReminder: vi.fn(async () => true) }));
vi.mock('@/libs/googleCalendar', async importOriginal => ({ ...(await importOriginal<typeof import('@/libs/googleCalendar')>()), getGoogleCalendarBusyWindows: vi.fn(async () => []), hasGoogleCalendarConflict: vi.fn(async () => false) }));

const sessionRoute = await import('../../../src/app/api/public/customer-assistant/[salonSlug]/session/route');
const chatRoute = await import('../../../src/app/api/public/customer-assistant/[salonSlug]/chat/route');
const actionRoute = await import('../../../src/app/api/public/customer-assistant/[salonSlug]/action/route');
const reviewRoute = await import('../../../src/app/api/public/customer-assistant/[salonSlug]/review/route');
const confirmRoute = await import('../../../src/app/api/public/customer-assistant/[salonSlug]/booking/confirm/route');
const statusRoute = await import('../../../src/app/api/public/customer-booking/[salonId]/status/route');

let pool: pg.Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;
let browser: Browser;
let vite: ChildProcess | undefined;
let executed = 0;

function requestFor(url: string, method: string, body: string | null): Request {
  return new Request(url, {
    method,
    headers: { 'origin': 'http://127.0.0.1:3130', 'sec-fetch-site': 'same-origin', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ?? undefined,
  });
}

async function waitForVite(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch('http://127.0.0.1:3130/')).ok) {
        return;
      }
    } catch { /* server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Customer browser fixture did not start.');
}

async function bridge(url: URL, method: string, body: string | null): Promise<Response | null> {
  const request = requestFor(url.toString(), method, body);
  const context = { params: Promise.resolve({ salonSlug: 'isla-nail-studio' }) };
  if (url.pathname.endsWith('/session')) {
    return sessionRoute.POST(request, context);
  }
  if (url.pathname.endsWith('/chat')) {
    return chatRoute.POST(request, context);
  }
  if (url.pathname.endsWith('/action')) {
    return actionRoute.POST(request, context);
  }
  if (url.pathname.endsWith('/review')) {
    return reviewRoute.POST(request, context);
  }
  if (url.pathname.endsWith('/booking/confirm')) {
    return confirmRoute.POST(request, context);
  }
  if (url.pathname.includes('/api/public/customer-booking/') && url.pathname.endsWith('/status')) {
    return statusRoute.POST(request, { params: Promise.resolve({ salonId: url.pathname.split('/')[4]! }) });
  }
  return null;
}

(target ? describe : describe.skip)('customer assistant browser journey through real handlers — PostgreSQL', () => {
  beforeAll(async () => {
    process.env.CUSTOMER_ASSISTANT_ENABLED = 'true';
    process.env.OPENAI_API_KEY_CUSTOMER = 'synthetic-browser-key';
    process.env.CUSTOMER_ASSISTANT_SIGNING_SECRET = SECRET;
    pool = new pg.Pool({ connectionString: target!.connectionString, max: 5 });
    const connection = await pool.connect();
    try {
      await attestDisposableDatabaseSession(connection, target!, resolveDisposableDatabaseServerExpectation(target!));
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
    await database.insert(schema.salonSchema).values({ id: SALON, slug: 'isla-nail-studio', name: 'Synthetic Isla Browser Salon', ownerEmail: 'synthetic-browser@example.invalid', isActive: true, status: 'active', publicationStatus: 'published', address: '1 Synthetic Way', city: 'Toronto', state: 'ON', zipCode: 'M5V 1A1', settings: SETTINGS }).onConflictDoNothing();
    await database.insert(schema.technicianSchema).values({ id: TECHNICIAN, salonId: SALON, name: 'Synthetic Browser Technician', isActive: true, weeklySchedule: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, { start: '00:00', end: '23:45' }])) }).onConflictDoNothing();
    await database.insert(schema.serviceSchema).values({ id: SERVICE, salonId: SALON, name: 'Synthetic Browser Gel Service', category: 'manicure', price: 6500, durationMinutes: 60, isActive: true }).onConflictDoNothing();
    await database.insert(schema.serviceSchema).values({ id: L1_SERVICE, salonId: SALON, name: 'Synthetic L1 Forty Five', category: 'manicure', price: 5000, durationMinutes: 45, isActive: true }).onConflictDoNothing();
    await database.insert(schema.addOnSchema).values([
      { id: L1_AUTO, salonId: SALON, name: 'Synthetic L1 Automatic Prep', slug: 'synthetic-l1-auto', category: 'removal', priceCents: 0, durationMinutes: 5, isActive: true },
      { id: L1_OPTIONAL, salonId: SALON, name: 'Synthetic L1 French', slug: 'synthetic-l1-french', category: 'nail_art', priceCents: 1000, durationMinutes: 10, isActive: true },
    ]).onConflictDoNothing();
    await database.insert(schema.serviceAddOnSchema).values([
      { id: 'synthetic-browser-l1-auto-binding', salonId: SALON, serviceId: L1_SERVICE, addOnId: L1_AUTO, selectionMode: 'optional' },
      { id: 'synthetic-browser-l1-optional-binding', salonId: SALON, serviceId: L1_SERVICE, addOnId: L1_OPTIONAL, selectionMode: 'optional' },
    ]).onConflictDoNothing();
    await database.insert(schema.catalogRuleSchema).values({ id: 'synthetic-browser-l1-auto-rule', salonId: SALON, serviceId: L1_SERVICE, ruleType: 'include', subjectServiceId: L1_SERVICE, subjectAddOnId: null, objectAddOnId: L1_AUTO, capabilityId: null, params: { autoAdd: true }, priority: 0, isActive: true, note: null }).onConflictDoNothing();
    await database.insert(schema.technicianServicesSchema).values([
      { technicianId: TECHNICIAN, serviceId: SERVICE, enabled: true },
      { technicianId: TECHNICIAN, serviceId: L1_SERVICE, enabled: true },
    ]).onConflictDoNothing();
    vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'tests/browser/customerAssistant/vite.config.ts'], { cwd: process.cwd(), stdio: 'ignore' });
    await waitForVite();
  }, 120_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    model.createResponse.mockResolvedValue({ status: 'completed', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0 }, items: [{ type: 'message', text: JSON.stringify({ factUpdates: { schemaVersion: 1, treatment: null, desiredApplication: null, maintenance: null, length: null, french: null, existingProduct: null, origin: null, removal: null, repairCount: null }, action: 'propose', serviceId: SERVICE, addOns: [], question: 'details', optionIds: [], datePreference: null }) }] });
    await database.delete(schema.communicationConsentSchema).where(eq(schema.communicationConsentSchema.salonId, SALON));
    await database.delete(schema.customerBookingOperationSchema).where(eq(schema.customerBookingOperationSchema.salonId, SALON));
    await database.delete(schema.appointmentDepositSchema).where(eq(schema.appointmentDepositSchema.salonId, SALON));
    await database.delete(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON));
    await database.delete(schema.salonClientSchema).where(eq(schema.salonClientSchema.salonId, SALON));
  });

  afterAll(async () => {
    await browser?.close();
    vite?.kill();
    await pool?.end();

    expect(executed).toBe(4);

    process.stdout.write(`CUSTOMER_BACKEND_BROWSER_TESTS_EXECUTED=${executed} CUSTOMER_BACKEND_BROWSER_TESTS_SKIPPED=0\n`);
  });

  it.each([
    { engine: 'chromium' as const, l1: false },
    { engine: 'webkit' as const, l1: false },
    { engine: 'chromium' as const, l1: true },
    { engine: 'webkit' as const, l1: true },
  ])('$engine $l1 journey creates one no-deposit appointment after proposal, slot, contact, review, and confirmation', async ({ engine, l1 }) => {
    await database.update(schema.salonSchema).set({ features: l1 ? L1_FEATURES : {} }).where(eq(schema.salonSchema.id, SALON));
    const serviceId = l1 ? L1_SERVICE : SERVICE;
    const requestedAddOns = l1 ? [{ addOnId: L1_OPTIONAL, quantity: 1 }] : [];
    const expected = l1
      ? { subtotalCents: 6000, durationMinutes: 60, addOnIds: [L1_AUTO, L1_OPTIONAL] }
      : { subtotalCents: 6500, durationMinutes: 60, addOnIds: [] as string[] };
    model.createResponse.mockResolvedValue({ status: 'completed', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0 }, items: [{ type: 'message', text: JSON.stringify({ factUpdates: { schemaVersion: 1, treatment: null, desiredApplication: null, maintenance: null, length: null, french: null, existingProduct: null, origin: null, removal: null, repairCount: null }, action: 'propose', serviceId, addOns: requestedAddOns, question: 'details', optionIds: [], datePreference: null }) }] });
    browser = await (engine === 'chromium' ? chromium : webkit).launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const unexpected: string[] = [];
    const serverResults: Array<{ path: string; status: number; kind?: string; reason?: string; bookingState?: string; proposal?: unknown; review?: unknown }> = [];
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== 'http://127.0.0.1:3130') {
        unexpected.push(url.toString());
        await route.abort();
        return;
      }
      if (!url.pathname.startsWith('/api/')) {
        await route.continue();
        return;
      }
      const response = await bridge(url, request.method(), request.postData());
      if (!response) {
        unexpected.push(`${request.method()} ${url.pathname}`);
        await route.abort();
        return;
      }
      const responseText = await response.text();
      const data = JSON.parse(responseText || '{}');
      serverResults.push({ path: url.pathname, status: response.status, kind: data.result?.kind ?? data.kind, reason: data.result?.reason, bookingState: data.status, proposal: data.result?.proposal, review: data.result?.review });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: responseText });
    });
    await page.goto('http://127.0.0.1:3130/?backend=1', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByRole('button', { name: 'Help me choose & book' }).click();
    await page.getByLabel('Describe the nails you want').fill('Synthetic gel manicure');
    await page.getByRole('button', { name: 'Send' }).click();
    await browserExpect.poll(() => serverResults.find(row => row.path.endsWith('/chat'))?.kind).toBe('proposal');

    expect(serverResults.find(row => row.path.endsWith('/chat'))?.proposal).toMatchObject({
      subtotalCents: expected.subtotalCents,
      durationMinutes: expected.durationMinutes,
      addOns: expect.arrayContaining(expected.addOnIds.map(id => expect.objectContaining({ id }))),
    });

    await page.getByRole('button', { name: 'Choose these services' }).click();
    const date = new Date(Date.now() + 14 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    await page.getByLabel('Preferred date').fill(date);
    await page.getByRole('button', { name: 'Show available times' }).click();
    await page.getByRole('button', { name: /\d.*[ap]\.?m\.?/i }).first().click();
    await page.getByLabel('Full name').fill('Synthetic Browser Customer');
    await page.getByLabel('Email address').fill(`browser-${randomUUID()}@example.invalid`);
    await page.getByLabel('Phone number').fill('4165550199');
    await page.getByRole('button', { name: 'Review booking details' }).click();
    await page.getByRole('button', { name: 'Confirm booking' }).click();

    expect(serverResults.find(row => row.path.endsWith('/review'))?.review).toMatchObject({
      durationMinutes: expected.durationMinutes,
      financial: { subtotalCents: expected.subtotalCents },
      addOns: expect.arrayContaining(expected.addOnIds.map(id => expect.objectContaining({ id }))),
      reminders: { selection: 'default_on', requestedEnabled: true },
    });

    await browserExpect.poll(() => serverResults.find(row => row.path.endsWith('/booking/confirm')), { timeout: 60_000 }).toMatchObject({ status: 200, kind: 'booking_status', bookingState: 'confirmed' });
    await browserExpect(page.getByText('Your appointment is confirmed.')).toBeVisible();

    await page.screenshot({ path: path.resolve(process.cwd(), `artifacts/customer-assistant/actual-backend-${l1 ? 'l1-' : 'legacy-'}${engine}-confirmed.png`), fullPage: true });

    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON))).toHaveLength(1);
    expect(await database.select().from(schema.communicationConsentSchema).where(eq(schema.communicationConsentSchema.salonId, SALON))).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: 'appointment_reminders', status: 'granted' })]));
    expect(model.createResponse).toHaveBeenCalledTimes(1);
    expect(unexpected).toEqual([]);

    await page.close();
    await browser.close();
    executed += 1;
  }, 120_000);
});
