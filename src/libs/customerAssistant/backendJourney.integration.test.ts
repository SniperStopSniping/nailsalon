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
import { getURLFromRedirectError } from 'next/dist/client/components/redirect';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
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
  // This fixture exercises a review *reservation* only. It never dispatches
  // through an SMS provider.
  communications: { sms: { enabled: true }, quietHours: { enabled: false, start: '21:00', end: '09:00' } },
};

vi.mock('server-only', () => ({}));
// Server-page tests inspect the real resolver's serialized client props. Client
// components themselves are exercised by the browser, not imported into Node.
vi.mock('@/app/(unauth)/book/time/BookTimeClient', () => ({ BookTimeClient: function BookTimeClient() {
  return null;
} }));
vi.mock('@/app/(unauth)/book/confirm/BookConfirmClient', () => ({ BookConfirmClient: function BookConfirmClient() {
  return null;
} }));
vi.mock('@/components/PublicSalonPageShell', () => ({ PublicSalonPageShell: function PublicSalonPageShell() {
  return null;
} }));
vi.mock('@/components/customerAssistant/CustomerAssistantLauncher', () => ({ CustomerAssistantLauncher: function CustomerAssistantLauncher() {
  return null;
} }));
const holder = vi.hoisted(() => ({ db: null as unknown, withSession: null as unknown as <T>(work: (database: unknown) => Promise<T>) => Promise<T> }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
  usesRuntimePostgres: true,
  DatabaseSessionReleaseError: class DatabaseSessionReleaseError extends Error {},
  withDedicatedDatabaseSession: <T>(work: (database: unknown) => Promise<T>) => holder.withSession(work),
}));
vi.mock('@/libs/tenant', () => ({
  getPublicPageContext: vi.fn(async () => ({
    salon: (await (holder.db as ReturnType<typeof drizzle<typeof schema>>).select().from(schema.salonSchema).where(eq(schema.salonSchema.id, SALON)))[0],
    appearance: { mode: 'theme', themeKey: 'espresso' },
  })),
}));
vi.mock('@/libs/clientAuth', () => ({ getClientSession: vi.fn(async () => null) }));
vi.mock('@/libs/ownerPreview', () => ({ resolveDraftSalonAccess: vi.fn(async () => ({ allowed: true, isPreviewingDraftSalon: false, isPreviewingDraftConfig: false, actorType: null })) }));
// The real quota adapter fails closed without Redis. This focused UI-to-handler
// journey substitutes only that infrastructure boundary; SQL conversation,
// quote, operation, and appointment authority remain real.
vi.mock('@/libs/customerAssistant/budget.server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/customerAssistant/budget.server')>()),
  reserveCustomerAssistantTurn: vi.fn(async () => ({ ok: true as const })),
}));
const revisions = vi.hoisted(() => new Map<string, string>());
// Redis fencing has separate real-loopback race tests. This browser fixture
// retains the exact latest signed revision while substituting that boundary.
vi.mock('@/libs/customerAssistant/revision.server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/customerAssistant/revision.server')>()),
  completeCustomerRevision: vi.fn(async (state: { salonId: string; sessionId: string }, conversation: string) => {
    revisions.set(JSON.stringify([state.salonId, state.sessionId]), conversation);
    return true;
  }),
  isCurrentCustomerRevision: vi.fn(async (state: { salonId: string; sessionId: string }, conversation: string) => revisions.get(JSON.stringify([state.salonId, state.sessionId])) === conversation),
}));
vi.mock('@/libs/publicBookingRateLimit.server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/publicBookingRateLimit.server')>()),
  checkPublicBookingRateLimit: vi.fn(async () => ({ allowed: true as const, reason: 'allowed' as const })),
}));
const model = vi.hoisted(() => ({ createResponse: vi.fn() }));

function setProposalModelResponses(serviceId: string, addOns: Array<{ addOnId: string; quantity: number }> = []) {
  const usage = { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0 };
  model.createResponse.mockReset()
    .mockResolvedValueOnce({
      status: 'completed',
      usage,
      items: [{
        type: 'message',
        text: JSON.stringify({
          factUpdates: { schemaVersion: 1, treatment: null, desiredApplication: null, maintenance: null, length: null, french: addOns.some(item => item.addOnId === L1_OPTIONAL) ? 'yes' : 'no', existingProduct: 'none', currentProductUncertain: false, origin: null, removal: 'no', repairCount: null, designPreference: addOns.some(item => item.addOnId === L1_OPTIONAL) ? 'selected' : 'plain' },
          action: 'propose',
          serviceId,
          addOns,
          question: 'details',
          optionIds: [],
          datePreference: null,
        }),
      }],
    })
    .mockResolvedValue({
      status: 'completed',
      usage,
      items: [{
        type: 'message',
        text: JSON.stringify({
          segments: [
            { kind: 'text', text: 'I found a suitable choice.' },
            { kind: 'fact', key: 'selection' },
          ],
          serviceOptions: [],
        }),
      }],
    });
}

vi.mock('@/libs/ai/openaiResponses.server', () => ({
  createOpenAiResponsesProvider: vi.fn(() => ({ createResponse: model.createResponse })),
}));
vi.mock('@/core/redis/redisClient', () => ({ redis: null, isRedisAvailable: vi.fn(async () => false) }));
vi.mock('@/libs/email', () => ({ sendTransactionalEmail: vi.fn(async () => true), sendTransactionalEmailDetailed: vi.fn(async () => ({ ok: true, errorCode: null, providerMessageId: 'synthetic' })) }));
vi.mock('@/libs/SMS', () => ({ sendBookingConfirmationToClient: vi.fn(), sendCancellationNotificationToTech: vi.fn(), sendRescheduleConfirmation: vi.fn(), sendAppointmentReminder: vi.fn(async () => true) }));
vi.mock('@/libs/googleCalendar', async importOriginal => ({ ...(await importOriginal<typeof import('@/libs/googleCalendar')>()), getGoogleCalendarBusyWindows: vi.fn(async () => []), hasGoogleCalendarConflict: vi.fn(async () => false) }));

const sessionRoute = await import('../../../src/app/api/public/customer-assistant/[salonSlug]/session/route');
const chatRoute = await import('../../../src/app/api/public/customer-assistant/[salonSlug]/chat/route');
const handoffRoute = await import('../../../src/app/api/public/customer-assistant/[salonSlug]/handoff/route');
const availabilityRoute = await import('../../../src/app/api/appointments/availability/route');
const normalPrepareRoute = await import('../../../src/app/api/public/customer-booking/[salonId]/prepare/route');
const normalConfirmRoute = await import('../../../src/app/api/public/customer-booking/[salonId]/confirm/route');
const statusRoute = await import('../../../src/app/api/public/customer-booking/[salonId]/status/route');
const timePage = await import('../../../src/app/(unauth)/book/time/page');
const confirmPage = await import('../../../src/app/(unauth)/book/confirm/page');

function findClientProps(node: unknown, componentName: string): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') {
    return null;
  }
  const element = node as { type?: { name?: string }; props?: Record<string, unknown> };
  if (element.type?.name === componentName && element.props) {
    return element.props;
  }
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findClientProps(child, componentName);
    if (found) {
      return found;
    }
  }
  return null;
}

async function bookingPageFixture(url: URL): Promise<Response> {
  const stage = url.searchParams.get('stage') === 'confirm' ? 'confirm' : 'time';
  let bookingUrl = new URL(`/en/isla-nail-studio/book/${stage}?${url.searchParams}`, url.origin);
  bookingUrl.searchParams.delete('stage');
  for (let redirects = 0; redirects < 5; redirects += 1) {
    const pageProps = { searchParams: Promise.resolve(Object.fromEntries(bookingUrl.searchParams)), params: Promise.resolve({ locale: 'en', slug: 'isla-nail-studio' }) };
    try {
      const page = stage === 'confirm' ? await confirmPage.default(pageProps) : await timePage.default(pageProps);
      const props = findClientProps(page, stage === 'confirm' ? 'BookConfirmClient' : 'BookTimeClient');
      if (!props) {
        throw new Error('Fixture component unavailable');
      }
      return Response.json({ stage, props, canonicalUrl: bookingUrl.pathname + bookingUrl.search });
    } catch (error) {
      const target = isRedirectError(error) ? getURLFromRedirectError(error) : null;
      if (!target) {
        throw error;
      }
      const next = new URL(target, url.origin);
      if (next.origin !== url.origin || !next.pathname.endsWith(`/book/${stage}`)) {
        throw error;
      }
      bookingUrl = next;
    }
  }
  throw new Error('Fixture booking redirect loop');
}

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
  if (url.pathname === '/api/__fixture/booking-page' && method === 'GET') {
    return bookingPageFixture(url);
  }
  if (url.pathname.endsWith('/session')) {
    return sessionRoute.POST(request, context);
  }
  if (url.pathname.endsWith('/chat')) {
    return chatRoute.POST(request, context);
  }
  if (url.pathname.endsWith('/handoff')) {
    return handoffRoute.POST(request, context);
  }
  if (url.pathname === '/api/appointments/availability') {
    return availabilityRoute.GET(request);
  }
  if (url.pathname.includes('/api/public/customer-booking/') && url.pathname.endsWith('/prepare')) {
    return normalPrepareRoute.POST(request, { params: Promise.resolve({ salonId: url.pathname.split('/')[4]! }) });
  }
  if (url.pathname.includes('/api/public/customer-booking/') && url.pathname.endsWith('/confirm')) {
    return normalConfirmRoute.POST(request, { params: Promise.resolve({ salonId: url.pathname.split('/')[4]! }) });
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
    revisions.clear();
    // This explicitly disposable fixture can already exist after a prior run.
    // Reset its test policy so no previous fixture changes alter this proof.
    await database.update(schema.salonSchema).set({ settings: SETTINGS }).where(eq(schema.salonSchema.id, SALON));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setProposalModelResponses(SERVICE);
    await database.delete(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, SALON));
    await database.delete(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, SALON));
    await database.delete(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.salonId, SALON));
    await database.delete(schema.salonRetentionSettingsSchema).where(eq(schema.salonRetentionSettingsSchema.salonId, SALON));
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
    // This is an explicit new-policy epoch before the AI handoff creates its
    // appointment. It is intentionally separate from the booking reminder
    // consent asserted below.
    await database.insert(schema.salonRetentionSettingsSchema).values({
      salonId: SALON,
      automaticReviewRequests: true,
      reviewRequestsEnabledAt: new Date(Date.now() - 60_000),
      reviewRequestAutomationMode: 'scheduled_end',
      reviewRequestDelayMinutes: 60,
      reviewRequestRepeatCooldownDays: 90,
      reviewRequestPolicyRevision: 1,
      googleReviewUrl: 'https://g.page/r/synthetic-browser-review',
    });
    await database.update(schema.salonSchema).set({ features: l1 ? L1_FEATURES : {} }).where(eq(schema.salonSchema.id, SALON));
    const serviceId = l1 ? L1_SERVICE : SERVICE;
    const requestedAddOns = l1 ? [{ addOnId: L1_OPTIONAL, quantity: 1 }] : [];
    const expected = l1
      ? { subtotalCents: 6000, durationMinutes: 60, addOnIds: [L1_AUTO, L1_OPTIONAL] }
      : { subtotalCents: 6500, durationMinutes: 60, addOnIds: [] as string[] };
    setProposalModelResponses(serviceId, requestedAddOns);
    browser = await (engine === 'chromium' ? chromium : webkit).launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const browserErrors: string[] = [];
    page.on('pageerror', error => browserErrors.push(error.message));
    let loseConfirmResponse = true;
    const unexpected: string[] = [];
    const serverResults: Array<{ path: string; status: number; kind?: string; reason?: string; message?: string; bookingState?: string; proposal?: unknown; review?: unknown }> = [];
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
      serverResults.push({ path: url.pathname, status: response.status, kind: data.result?.kind ?? data.kind, reason: data.result?.reason ?? data.reason, message: data.result?.message, bookingState: data.status, proposal: data.result?.proposal, review: data.result?.review });
      if (url.pathname.endsWith('/confirm') && loseConfirmResponse) {
        // Simulate a lost response AFTER the real creation transaction commits.
        loseConfirmResponse = false;
        await route.abort('failed');
        return;
      }
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: responseText });
    });
    await page.goto('http://127.0.0.1:3130/?backend=1', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByRole('button', { name: 'Help me choose & book' }).click();
    await page.getByLabel('Tell me what you would like').fill(l1 ? 'Synthetic L1 Forty Five with French on bare nails, no removal.' : 'Synthetic Browser Gel Service on bare nails, no removal, plain please.');
    await page.getByRole('button', { name: 'Send' }).click();
    await browserExpect.poll(() => serverResults.find(row => row.path.endsWith('/chat'))?.kind).toBe('proposal');

    const chatResult = serverResults.find(row => row.path.endsWith('/chat'));

    expect(chatResult?.proposal).toMatchObject({
      subtotalCents: expected.subtotalCents,
      durationMinutes: expected.durationMinutes,
      addOns: expect.arrayContaining(expected.addOnIds.map(id => expect.objectContaining({ id }))),
    });
    expect(chatResult?.message).toContain('I found a suitable choice.');
    expect(chatResult?.message).toContain(l1 ? 'Synthetic L1 Forty Five' : 'Synthetic Browser Gel Service');

    await page.getByRole('button', { name: 'Choose these services' }).click();
    await browserExpect(page.locator('[data-testid^="time-slot-"]').first()).toBeVisible({ timeout: 60_000 });
    await browserExpect.poll(() => page.locator('[data-testid^="time-slot-"]').first().evaluate((element) => {
      for (let current: Element | null = element; current; current = current.parentElement) {
        if (Number(getComputedStyle(current).opacity) < 1) {
          return false;
        }
      }
      return true;
    })).toBe(true);
    await page.screenshot({ path: path.resolve(process.cwd(), `artifacts/customer-assistant/receptionist-backend-${l1 ? 'l1' : 'legacy'}-${engine}-time.png`) });
    await page.locator('[data-testid^="time-slot-"]').first().click();
    await browserExpect(page.getByLabel('Customer name')).toBeVisible({ timeout: 60_000 });
    await page.getByLabel('Customer name').fill('Synthetic Browser Customer');
    await page.getByLabel('Customer email').fill(`browser-${randomUUID()}@example.invalid`);
    await page.getByLabel('Customer phone').fill('4165550199');
    await browserExpect(page.getByRole('checkbox', { name: 'Text reminders' })).toBeChecked();
    await browserExpect.poll(() => page.getByLabel('Customer phone').evaluate((element) => {
      for (let current: Element | null = element; current; current = current.parentElement) {
        if (Number(getComputedStyle(current).opacity) < 1) {
          return false;
        }
      }
      return true;
    })).toBe(true);
    await page.screenshot({ path: path.resolve(process.cwd(), `artifacts/customer-assistant/receptionist-backend-${l1 ? 'l1' : 'legacy'}-${engine}-details.png`), fullPage: true });
    await page.getByRole('button', { name: /Confirm appointment/i }).click();

    await browserExpect.poll(() => serverResults.find(row => row.path.endsWith('/confirm'))?.bookingState, { timeout: 60_000 }).toBe('confirmed');

    await browserExpect(page.getByRole('heading', { name: 'Appointment confirmed', exact: true })).toBeVisible();
    await page.reload();
    await browserExpect(page.getByRole('heading', { name: 'Appointment confirmed', exact: true })).toBeVisible();
    await page.screenshot({ path: path.resolve(process.cwd(), `artifacts/customer-assistant/receptionist-backend-${l1 ? 'l1' : 'legacy'}-${engine}-confirmed.png`), fullPage: true });

    expect(serverResults.filter(row => row.path.endsWith('/confirm'))).toHaveLength(1);
    expect(serverResults.some(row => row.path.endsWith('/status'))).toBe(true);

    const appointments = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON));

    expect(appointments).toHaveLength(1);

    const appointment = appointments[0];
    if (!appointment) {
      throw new Error('Customer Assistant handoff did not persist an appointment.');
    }

    expect(appointment).toMatchObject({ status: 'confirmed', completedAt: null });
    expect(await database.select().from(schema.communicationConsentSchema).where(eq(schema.communicationConsentSchema.salonId, SALON))).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: 'appointment_reminders', status: 'granted' })]));
    expect(await database.select().from(schema.customerBookingOperationSchema).where(eq(schema.customerBookingOperationSchema.salonId, SALON))).toHaveLength(1);

    // Reminder consent is not review-request consent. Add the latter
    // deliberately, then run the shared scheduled-end scanner/materializer
    // against the appointment produced by the ordinary Customer AI handoff.
    await database.insert(schema.communicationConsentSchema).values({
      id: `synthetic-browser-review-consent-${randomUUID()}`,
      salonId: SALON,
      recipient: appointment.clientPhone,
      channel: 'sms',
      purpose: 'appointment_transactional',
      status: 'granted',
      source: 'synthetic-browser-review-proof',
      wordingVersion: 'test',
    });
    const { materializeCompletedReviewTriggers, scanScheduledEndReviewTriggers } = await import('@/libs/reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database, now: appointment.endTime });
    await materializeCompletedReviewTriggers({ database, now: appointment.endTime });
    const triggers = await database.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, SALON));
    const requests = await database.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, SALON));
    const reviewIntents = (await database.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.salonId, SALON))).filter(intent => intent.eventType === 'review_request');

    expect(triggers).toEqual([expect.objectContaining({ appointmentId: appointment.id, kind: 'scheduled_end', state: 'materialized', scheduledFor: new Date(appointment.endTime.getTime() + 60 * 60_000) })]);
    expect(requests).toEqual([expect.objectContaining({ appointmentId: appointment.id, source: 'automatic', status: 'scheduled', completedAt: null, scheduledFor: new Date(appointment.endTime.getTime() + 60 * 60_000) })]);
    expect(reviewIntents).toEqual([expect.objectContaining({ appointmentId: appointment.id, eventType: 'review_request', scheduledFor: new Date(appointment.endTime.getTime() + 60 * 60_000) })]);
    expect(requests[0]?.intentId).toBe(reviewIntents.find(intent => intent.eventType === 'review_request')?.id);
    expect((await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, appointment.id)))[0]).toMatchObject({ status: 'confirmed', completedAt: null });
    expect(browserErrors).toEqual([]);
    expect(model.createResponse).toHaveBeenCalledTimes(2);
    expect(unexpected).toEqual([]);

    await page.close();
    await browser.close();
    executed += 1;
  }, 120_000);
});
