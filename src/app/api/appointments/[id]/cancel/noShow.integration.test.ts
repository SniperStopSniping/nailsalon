import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as requestReview } from '@/app/api/public/appointments/manage/[token]/no-show-review/route';
import { createOpaqueToken } from '@/libs/lusterSecurity';
import { readNetworkNoShowRisk, reconcileNetworkNoShows, recordNetworkNoShowInTx, registerNetworkBookingInTx, suppressNetworkNoShowEventInTx } from '@/libs/networkNoShow.server';
import { resolveNoShowReviewInTx } from '@/libs/networkNoShowReview.server';
import * as schema from '@/models/Schema';

import { PATCH } from './route';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
const access = vi.hoisted(() => vi.fn());
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/routeAccessGuards', () => ({ requireAppointmentManagerAccess: access }));
vi.mock('@/libs/rateLimit', () => ({ checkEndpointRateLimit: () => ({ allowed: true }), getClientIp: () => '127.0.0.1', rateLimitResponse: () => new Response(null, { status: 429 }) }));
vi.mock('@/libs/deposits/depositForfeiture', () => ({ forfeitAppointmentDepositInTx: vi.fn(async () => {}), DepositForfeitureBlockedError: class extends Error {} }));
vi.mock('@/libs/clientLifecycleStabilization', () => ({ lockOperationalSalonClientContactWithHandle: vi.fn(async () => null), resolveOperationalSalonClientByPhoneWithHandle: vi.fn(async () => null), withClientLifecycleTransactionRetry: (run: () => Promise<unknown>) => run() }));
vi.mock('@/libs/integrationOutbox', () => ({ enqueueGoogleCalendarDeleteInTx: vi.fn(async () => {}) }));
vi.mock('@/libs/communicationMaterialization', () => ({ materializeAppointmentLifecycle: vi.fn(async () => []) }));
vi.mock('@/libs/bookingNotifications', () => ({ sendBookingNotificationsForAppointmentCancelled: vi.fn(async () => []) }));
vi.mock('@/libs/salonNotificationEmail', () => ({ sendSalonNotificationEmail: vi.fn(async () => ({ status: 'disabled' })) }));
vi.mock('@/libs/queries', () => ({ updateSalonClientStats: vi.fn(async () => {}), getSalonById: vi.fn(async () => null), getTechnicianById: vi.fn(async () => null), getAppointmentServiceNames: vi.fn(async () => []) }));

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const now = new Date('2030-06-15T18:30:00Z'); // 2:30pm Toronto; start 3pm.
const start = new Date('2030-06-15T19:00:00Z');
const phone = '4165550100';
const email = 'isolated-customer@example.test';

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  holder.db = db;
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 30_000);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  vi.stubEnv('NETWORK_NO_SHOW_ENABLED', 'true');
  vi.stubEnv('NETWORK_NO_SHOW_HMAC_KEY', 'isolated-test-hmac-key-with-at-least-32-characters');
  await db.execute(sql`truncate network_no_show_platform_control, network_no_show_subject, salon cascade`);
  await db.insert(schema.salonSchema).values([{ id: 'a', slug: 'a', name: 'Source', settings: { booking: { timezone: 'America/Toronto' } } }, { id: 'b', slug: 'b', name: 'Receiver' }]);
  await db.insert(schema.networkNoShowPlatformControlSchema).values({ id: 1, enabledAt: new Date('2030-01-01Z'), prospectiveAfter: new Date('2030-01-01Z') });
  access.mockImplementation(async (id: string) => {
    const [appointment] = await db.select().from(schema.appointmentSchema).where(and(eq(schema.appointmentSchema.id, id), eq(schema.appointmentSchema.salonId, 'a'))).limit(1);
    return appointment ? { ok: true, appointment, actorRole: 'admin', admin: { id: 'owner-a' } } : { ok: false, response: new Response(null, { status: 403 }) };
  });
});

afterAll(async () => {
  vi.useRealTimers();
  await client.close();
});

async function seed(args: { id?: string; startTime?: Date; channel?: 'guest' | 'admin'; salonId?: string } = {}) {
  const id = args.id ?? 'appointment';
  const salonId = args.salonId ?? 'a';
  const scheduled = args.startTime ?? start;
  await db.insert(schema.appointmentSchema).values({ id, salonId, clientPhone: phone, clientEmail: email, status: 'confirmed', startTime: scheduled, endTime: new Date(scheduled.getTime() + 3600000), createdAt: new Date('2030-01-02Z'), totalPrice: 5000, totalDurationMinutes: 60 });
  await db.transaction(tx => registerNetworkBookingInTx(tx, { salonId, appointmentId: id, phone, email, actorRole: args.channel ?? 'guest', now: new Date('2030-01-02Z') }));
  return id;
}
function mark(id = 'appointment', reason = 'confirmed_nonattendance', extra = {}) {
  return PATCH(new Request('http://localhost/api/appointments/x/cancel', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cancelReason: 'no_show', noShowReport: { reason, ...extra } }) }), { params: Promise.resolve({ id }) });
}
function risk(contact = { phone, email }) {
  return readNetworkNoShowRisk({ salonId: 'b', ...contact, handle: db, now });
}
async function reviewToken(id = 'appointment') {
  const credential = createOpaqueToken();
  await db.insert(schema.appointmentAccessTokenSchema).values({ id: `token-${id}`, salonId: 'a', appointmentId: id, tokenHash: credential.tokenHash, expiresAt: new Date('2031-01-01Z') });
  return credential.token;
}
function dispute(token: string, extra = {}) {
  return requestReview(new Request('http://localhost/api/public/appointments/manage/private/no-show-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'I attended this appointment. Please review the incorrect record.', ...extra }) }), { params: Promise.resolve({ token }) });
}

describe('owner no-show and private customer review', () => {
  it.each([
    [24 * 60 + 1, 400],
    [24 * 60, 200],
    [30, 200],
    [0, 200],
    [-60, 200],
    [-10 * 24 * 60, 200],
  ])('enforces canonical boundary at %i minutes from start', async (minutes, expected) => {
    await seed({ startTime: new Date(now.getTime() + minutes * 60000) });
    const response = await mark();

    expect(response.status).toBe(expected);
    expect((await db.select().from(schema.appointmentSchema))[0]?.status).toBe(expected === 200 ? 'no_show' : 'confirmed');
    expect((await db.select().from(schema.networkNoShowEventSchema)).length).toBe(expected === 200 ? 1 : 0);
  });

  it('shares the 3pm appointment at 2:30pm, with a private atomic audit and an aggregate-only receiving view', async () => {
    await seed();
    const response = await mark('appointment', 'confirmed_nonattendance', { privateNote: 'Client explicitly declined when contacted.' });

    expect(await response.json()).toMatchObject({ data: { noShowSharing: 'shared', appointment: { status: 'no_show' } } });
    expect(await risk()).toEqual({ state: 'available', activeNoShowCount: 1, windowMonths: 12 });

    const [audit] = await db.select().from(schema.appointmentAuditLogSchema);

    expect(audit).toMatchObject({ performedBy: 'owner-a', reason: 'confirmed_nonattendance', createdAt: now, newValue: { noShowReport: { reason: 'confirmed_nonattendance', privateNote: 'Client explicitly declined when contacted.' } } });
    expect(JSON.stringify(await risk())).not.toMatch(/Source|privateNote|appointment|owner-a/);
  });

  it.each(['did_not_attend', 'other'])('refuses a future assertion: %s', async (reason) => {
    await seed();

    expect((await mark('appointment', reason, { explanation: 'Something else happened.' })).status).toBe(400);
    expect(await db.select().from(schema.appointmentAuditLogSchema)).toHaveLength(0);
  });

  it.each(['cancelled', 'completed', 'awaiting_payment'])('preserves existing terminal/hold state rules: %s', async (status) => {
    await seed();
    await db.update(schema.appointmentSchema).set({ status }).where(eq(schema.appointmentSchema.id, 'appointment'));

    expect((await mark()).status).toBe(400);
    expect(await db.select().from(schema.networkNoShowEventSchema)).toHaveLength(0);
  });

  it('refuses deleted source appointments', async () => {
    await seed();
    await db.update(schema.appointmentSchema).set({ deletedAt: now }).where(eq(schema.appointmentSchema.id, 'appointment'));

    expect((await mark()).status).toBe(400);
    expect(await db.select().from(schema.networkNoShowEventSchema)).toHaveLength(0);
  });

  it('accepts explicit late cancellation as no-show; ordinary cancellation stays separate', async () => {
    await seed();

    expect((await mark('appointment', 'late_cancellation')).status).toBe(200);

    await seed({ id: 'normal' });
    const normal = await PATCH(new Request('http://localhost/api/appointments/normal/cancel', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cancelReason: 'client_request' }) }), { params: Promise.resolve({ id: 'normal' }) });

    expect(normal.status).toBe(200);
    expect((await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, 'normal')))[0]?.status).toBe('cancelled');
    expect(await db.select().from(schema.networkNoShowEventSchema)).toHaveLength(1);
  });

  it('saves manual/walk-in locally and acknowledges that it was not shared', async () => {
    await seed({ channel: 'admin' });

    expect(await (await mark()).json()).toMatchObject({ data: { noShowSharing: 'not_shared' } });
    expect(await db.select().from(schema.networkNoShowEventSchema)).toHaveLength(0);
  });

  it('serializes duplicate requests and preserves the first reason and private note', async () => {
    await seed();

    expect((await Promise.all([mark(), mark('appointment', 'late_cancellation')])).map(response => response.status)).toEqual([200, 200]);
    expect(await db.select().from(schema.networkNoShowEventSchema)).toHaveLength(1);
    expect(await db.select().from(schema.appointmentAuditLogSchema)).toHaveLength(1);
  });

  it('does not allow another tenant or a contact-only collision to alter history', async () => {
    await seed({ id: 'foreign', salonId: 'b' });

    expect((await mark('foreign')).status).toBe(403);

    await seed();
    await mark();

    expect(await risk({ phone, email: 'different@example.test' })).toEqual({ state: 'unavailable' });
    expect(await risk({ phone: '4165559999', email })).toEqual({ state: 'unavailable' });
  });

  it('suspends disputes immediately, deduplicates them, and prevents reconciliation from reviving them', async () => {
    await seed();
    await mark();
    const token = await reviewToken();
    const responses = await Promise.all([dispute(token), dispute(token)]);

    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await responses[0]!.json()).toEqual({ requested: true, message: expect.any(String) });
    expect(await risk()).toMatchObject({ activeNoShowCount: 0 });
    expect(await reconcileNetworkNoShows({ handle: db, now })).toEqual({ scanned: 0, recorded: 0 });
    expect(await db.select().from(schema.appointmentAuditLogSchema).where(sql`new_value->>'noShowReview' = 'requested'`)).toHaveLength(1);
    expect((await db.select().from(schema.networkNoShowEventSchema))[0]).toMatchObject({ state: 'suppressed', suppressionReason: 'customer_review' });
  });

  it('rejects invalid, expired and revoked credentials and extra target IDs without disclosing history', async () => {
    await seed();
    await mark();

    expect((await dispute('invalid')).status).toBe(404);

    const token = await reviewToken();

    expect((await dispute(token, { appointmentId: 'another' })).status).toBe(400);

    await db.update(schema.appointmentAccessTokenSchema).set({ expiresAt: new Date('2029-01-01Z') });

    expect((await dispute(token)).status).toBe(404);

    await db.update(schema.appointmentAccessTokenSchema).set({ expiresAt: new Date('2031-01-01Z'), revokedAt: now });

    expect((await dispute(token)).status).toBe(404);
    expect(await risk()).toMatchObject({ activeNoShowCount: 1 });
  });

  it('can uphold a verified report once, while later correction remains terminal', async () => {
    await seed();
    await mark();
    const token = await reviewToken();
    await dispute(token);
    const [appointment] = await db.select().from(schema.appointmentSchema);
    const args = { salonId: 'a', appointmentId: 'appointment', operatorId: 'platform-reviewer', decision: 'upheld' as const, reason: 'Contact and nonattendance evidence verified.', expectedUpdatedAt: appointment!.updatedAt.toISOString(), now };

    expect(await db.transaction(tx => resolveNoShowReviewInTx(tx, args))).toBe(true);
    expect(await db.transaction(tx => resolveNoShowReviewInTx(tx, args))).toBe(false);
    expect(await risk()).toMatchObject({ activeNoShowCount: 1 });
    expect((await dispute(token)).status).toBe(409);
    expect((await dispute(token)).status).toBe(409);

    await db.update(schema.appointmentSchema).set({ status: 'cancelled', cancelReason: 'admin_correction' }).where(eq(schema.appointmentSchema.id, 'appointment'));

    expect(await risk()).toMatchObject({ activeNoShowCount: 0 });
    expect(await db.transaction(tx => recordNetworkNoShowInTx(tx, { salonId: 'a', appointmentId: 'appointment', actorId: 'owner-a', actorRole: 'admin', now }))).toBe(false);
    expect(await db.transaction(tx => resolveNoShowReviewInTx(tx, args))).toBe(false);
  });

  it('never restores another moderation suppression', async () => {
    await seed();
    await mark();
    await dispute(await reviewToken());
    const [event] = await db.select().from(schema.networkNoShowEventSchema);
    await db.transaction(tx => suppressNetworkNoShowEventInTx(tx, { eventId: event!.id, operatorId: 'operator', now, reason: 'identity_dispute' }));
    const [appointment] = await db.select().from(schema.appointmentSchema);

    expect(await db.transaction(tx => resolveNoShowReviewInTx(tx, { salonId: 'a', appointmentId: 'appointment', operatorId: 'operator', decision: 'upheld', reason: 'Attempt to override another suppression.', expectedUpdatedAt: appointment!.updatedAt.toISOString(), now }))).toBe(false);
    expect(await risk()).toMatchObject({ activeNoShowCount: 0 });
  });

  it('retains a dispute tombstone even when no event existed; blocks later publication', async () => {
    await seed();
    vi.stubEnv('NETWORK_NO_SHOW_ENABLED', 'false');
    await mark();
    await dispute(await reviewToken());
    vi.stubEnv('NETWORK_NO_SHOW_ENABLED', 'true');

    expect(await reconcileNetworkNoShows({ handle: db, now })).toEqual({ scanned: 0, recorded: 0 });
    expect(await db.select().from(schema.networkNoShowEventSchema)).toHaveLength(0);
  });
});
