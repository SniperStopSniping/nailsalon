import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { POST } from './route';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
const requireAdminSalonFromRequest = vi.hoisted(() => vi.fn());
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalonFromRequest }));
vi.mock('@/libs/rateLimit', () => ({ checkEndpointRateLimit: () => ({ allowed: true }), rateLimitResponse: () => new Response(null, { status: 429 }) }));

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const salon = { id: 'owner-correct-salon', slug: 'owner-correct-salon', name: 'Owner Salon' };

function request(body: object) {
  return new Request(`http://localhost/api/admin/network-no-show/correct?salonSlug=${salon.slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
  vi.stubEnv('NETWORK_NO_SHOW_ENABLED', 'true');
  requireAdminSalonFromRequest.mockResolvedValue({ error: null, salon, admin: { id: 'owner-1', name: 'Owner' } });
  await db.insert(schema.salonSchema).values([salon, { id: 'other-salon', slug: 'other-salon', name: 'Other' }]);
  await db.insert(schema.networkNoShowPlatformControlSchema).values({ id: 1, enabledAt: new Date(), prospectiveAfter: new Date('2020-01-01T00:00:00.000Z') });
}, 30_000);

afterAll(async () => client.close());

async function seed(id: string, salonId = salon.id) {
  const start = new Date('2030-01-01T10:00:00.000Z');
  const end = new Date('2030-01-01T11:00:00.000Z');
  await db.insert(schema.appointmentSchema).values({ id, salonId, clientPhone: '+14165551234', clientEmail: `${id}@example.test`, startTime: start, endTime: end, status: 'no_show', totalPrice: 5000, totalDurationMinutes: 60 });
  await db.insert(schema.networkNoShowSubjectSchema).values({ id: `${id}-subject`, pairHmac: `${id}-hmac` });
  await db.insert(schema.networkNoShowEventSchema).values({ id: `${id}-event`, salonId, appointmentId: id, subjectId: `${id}-subject`, occurredAt: end, expiresAt: new Date('2031-01-01T11:00:00.000Z'), markedBy: 'owner-1', markedByRole: 'owner', markedAt: end });
  await db.insert(schema.appointmentDepositSchema).values({ id: `${id}-deposit`, salonId, appointmentId: id, amountCents: 2500, status: 'paid', stripeAccountId: 'acct_owner_test', forfeitedAt: new Date('2030-01-01T12:00:00.000Z'), refundAmountCents: 0, priorRefundIds: [] });
  return (await db.select({ updatedAt: schema.appointmentSchema.updatedAt }).from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, id)))[0]!.updatedAt.toISOString();
}

describe('owner no-show correction', () => {
  it('corrects only the authorized salon, revokes shared risk while feature serving is off, and leaves forfeiture evidence intact', async () => {
    const version = await seed('owner-correct-feature-off');
    vi.stubEnv('NETWORK_NO_SHOW_ENABLED', 'false');
    const response = await POST(request({ appointmentId: 'owner-correct-feature-off', expectedUpdatedAt: version, reason: 'Client attended and the no-show was marked by mistake.' }));

    expect(response.status).toBe(200);

    const [appointment] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, 'owner-correct-feature-off'));
    const [event] = await db.select().from(schema.networkNoShowEventSchema).where(eq(schema.networkNoShowEventSchema.appointmentId, 'owner-correct-feature-off'));
    const [deposit] = await db.select().from(schema.appointmentDepositSchema).where(eq(schema.appointmentDepositSchema.appointmentId, 'owner-correct-feature-off'));

    expect(appointment).toMatchObject({ status: 'cancelled', cancelReason: 'admin_correction' });
    expect(deposit).toMatchObject({ amountCents: 2500, status: 'paid', forfeitedAt: new Date('2030-01-01T12:00:00.000Z'), refundAmountCents: 0, priorRefundIds: [] });
    expect(event?.state).toBe('revoked');
  });

  it('returns not found for an appointment outside the authorized salon and conflicts on a stale record', async () => {
    const otherVersion = await seed('owner-correct-other', 'other-salon');

    expect((await POST(request({ appointmentId: 'owner-correct-other', expectedUpdatedAt: otherVersion, reason: 'Client attended and the no-show was marked by mistake.' }))).status).toBe(404);

    await seed('owner-correct-stale');

    expect((await POST(request({ appointmentId: 'owner-correct-stale', expectedUpdatedAt: '2020-01-01T00:00:00.000Z', reason: 'Client attended and the no-show was marked by mistake.' }))).status).toBe(409);
    expect(await db.select().from(schema.appointmentSchema).where(and(
      eq(schema.appointmentSchema.id, 'owner-correct-stale'),
      eq(schema.appointmentSchema.status, 'no_show'),
    ))).toHaveLength(1);
  });
});
