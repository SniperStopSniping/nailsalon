import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { POST as CORRECT } from '../correct/route';
import { POST } from '../route';
import { GET } from './route';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const requireSuperAdmin = vi.hoisted(() => vi.fn());
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/adminAuth', () => ({ requireSuperAdmin }));
vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit: () => ({ allowed: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
  vi.stubEnv('NETWORK_NO_SHOW_ENABLED', 'true');
  requireSuperAdmin.mockResolvedValue({ ok: true, admin: { id: 'super-admin-1' } });
  await db.insert(schema.networkNoShowPlatformControlSchema).values({
    id: 1,
    enabledAt: new Date(),
    prospectiveAfter: new Date('2026-09-01T00:00:00.000Z'),
  });

  for (const salon of [{ id: 'ledger-salon-a', name: 'Salon A' }, { id: 'ledger-salon-b', name: 'Salon B' }]) {
    await db.insert(schema.salonSchema).values({ ...salon, slug: salon.id });
  }
  const startTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const endTime = new Date(Date.now() - 60 * 60 * 1000);
  for (const [id, salonId, status] of [
    ['ledger-a-no-show', 'ledger-salon-a', 'no_show'],
    ['ledger-b-no-show', 'ledger-salon-b', 'no_show'],
    ['ledger-a-completed', 'ledger-salon-a', 'completed'],
  ]) {
    await db.insert(schema.appointmentSchema).values({
      id: id!,
      salonId: salonId!,
      clientName: id === 'ledger-a-no-show' ? 'Ada Customer' : 'Other Customer',
      clientPhone: '+14165551234',
      clientEmail: 'ada@example.com',
      startTime,
      endTime,
      status,
      totalPrice: 5000,
      totalDurationMinutes: 60,
    });
  }
  await db.insert(schema.networkNoShowSubjectSchema).values({
    id: 'ledger-subject',
    pairHmac: 'test-hmac',
  });
  await db.insert(schema.networkNoShowEventSchema).values({
    id: 'ledger-event',
    salonId: 'ledger-salon-a',
    appointmentId: 'ledger-a-no-show',
    subjectId: 'ledger-subject',
    occurredAt: endTime,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    markedBy: 'owner-1',
    markedByRole: 'owner',
    markedAt: endTime,
  });
}, 30_000);

afterAll(async () => client.close());

function request(query = '') {
  return new Request(`http://localhost/api/super-admin/network-no-show/records${query}`);
}

describe('super-admin no-show records', () => {
  it('denies an unauthorised caller before reading the database', async () => {
    const denied = new Response(null, { status: 403 });
    requireSuperAdmin.mockResolvedValueOnce({ ok: false, response: denied });

    expect(await GET(request())).toBe(denied);

    requireSuperAdmin.mockResolvedValueOnce({ ok: false, response: denied });

    expect(await CORRECT(new Request('http://localhost/api/super-admin/network-no-show/correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }))).toBe(denied);
  });

  it('lists no-shows from each salon and distinguishes network eligibility', async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');

    const data = await response.json();

    expect(data.total).toBe(2);
    expect(data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ appointmentId: 'ledger-a-no-show', salonName: 'Salon A', countsForNetwork: true, clientPhone: '••• 1234', clientEmail: 'a•••@example.com' }),
      expect.objectContaining({ appointmentId: 'ledger-b-no-show', salonName: 'Salon B', countsForNetwork: false, eventId: null }),
    ]));
    expect(data.items.map((item: { appointmentId: string }) => item.appointmentId)).not.toContain('ledger-a-completed');
  });

  it('filters by source salon and network state without crossing records', async () => {
    const response = await GET(request('?salon=Salon%20B&state=not_shared'));
    const data = await response.json();

    expect(data.total).toBe(1);
    expect(data.items[0].appointmentId).toBe('ledger-b-no-show');
    expect((await (await GET(request('?salon=Salon%20B&state=counted'))).json()).total).toBe(0);
  });

  it('does not claim an active event is served while either platform gate is off', async () => {
    vi.stubEnv('NETWORK_NO_SHOW_ENABLED', 'false');
    const environmentPaused = await (await GET(request())).json();

    expect(environmentPaused.platformActive).toBe(false);
    expect(environmentPaused.items.find((item: { eventId: string | null }) => item.eventId === 'ledger-event').countsForNetwork).toBe(false);
    expect((await (await GET(request('?state=counted'))).json()).total).toBe(0);

    vi.stubEnv('NETWORK_NO_SHOW_ENABLED', 'true');

    await db.update(schema.networkNoShowPlatformControlSchema).set({ enabledAt: null })
      .where(eq(schema.networkNoShowPlatformControlSchema.id, 1));

    expect((await (await GET(request())).json()).platformActive).toBe(false);

    await db.update(schema.networkNoShowPlatformControlSchema).set({ enabledAt: new Date() })
      .where(eq(schema.networkNoShowPlatformControlSchema.id, 1));

    expect((await (await GET(request('?state=counted'))).json()).total).toBe(1);
  });

  it('removes one network event without changing the source no-show or the other salon', async () => {
    const response = await POST(new Request('http://localhost/api/super-admin/network-no-show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'suppress_event',
        mode: 'apply',
        salonId: 'ledger-salon-a',
        appointmentId: 'ledger-a-no-show',
      }),
    }));

    expect(response.status).toBe(200);

    const counted = await (await GET(request('?state=counted'))).json();

    expect(counted.total).toBe(0);

    const all = await (await GET(request())).json();

    expect(all.total).toBe(2);
    expect(all.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ appointmentId: 'ledger-a-no-show', appointmentStatus: 'no_show', eventState: 'suppressed', countsForNetwork: false }),
      expect.objectContaining({ appointmentId: 'ledger-b-no-show', eventId: null }),
    ]));
  });

  it('requires a fresh, tenant-qualified no-show before correcting its source status', async () => {
    const source = (await (await GET(request('?salon=Salon%20B'))).json()).items[0];
    const body = {
      salonId: 'ledger-salon-b',
      appointmentId: 'ledger-b-no-show',
      expectedUpdatedAt: source.updatedAt,
      reason: 'Owner verified that this was marked incorrectly',
    };
    const wrongSalon = await CORRECT(new Request('http://localhost/api/super-admin/network-no-show/correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, salonId: 'ledger-salon-a' }),
    }));

    expect(wrongSalon.status).toBe(404);

    const stale = await CORRECT(new Request('http://localhost/api/super-admin/network-no-show/correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }),
    }));

    expect(stale.status).toBe(409);

    const corrected = await CORRECT(new Request('http://localhost/api/super-admin/network-no-show/correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));

    expect(corrected.status).toBe(200);

    const all = await (await GET(request())).json();

    expect(all.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ appointmentId: 'ledger-b-no-show', appointmentStatus: 'cancelled' }),
    ]));

    const repeated = await CORRECT(new Request('http://localhost/api/super-admin/network-no-show/correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));

    expect(repeated.status).toBe(409);
  });

  it('revokes a counted event when the source no-show is corrected', async () => {
    vi.stubEnv('NETWORK_NO_SHOW_ENABLED', 'true');
    const startTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const endTime = new Date(Date.now() - 60 * 60 * 1000);
    await db.insert(schema.appointmentSchema).values({
      id: 'ledger-revocation-source',
      salonId: 'ledger-salon-b',
      clientPhone: '+14165559999',
      startTime,
      endTime,
      status: 'no_show',
      totalPrice: 6000,
      totalDurationMinutes: 60,
    });
    await db.insert(schema.networkNoShowSubjectSchema).values({ id: 'ledger-revocation-subject', pairHmac: 'test-revocation-hmac' });
    await db.insert(schema.networkNoShowEventSchema).values({
      id: 'ledger-revocation-event',
      salonId: 'ledger-salon-b',
      appointmentId: 'ledger-revocation-source',
      subjectId: 'ledger-revocation-subject',
      occurredAt: endTime,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      markedBy: 'owner-2',
      markedByRole: 'owner',
      markedAt: endTime,
    });
    const source = (await (await GET(request('?salon=Salon%20B&state=counted'))).json()).items[0];

    expect(source.appointmentId).toBe('ledger-revocation-source');

    const corrected = await CORRECT(new Request('http://localhost/api/super-admin/network-no-show/correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonId: 'ledger-salon-b',
        appointmentId: source.appointmentId,
        expectedUpdatedAt: source.updatedAt,
        reason: 'The client attended and the original no-show was mistaken',
      }),
    }));

    expect(corrected.status).toBe(200);

    const counted = await (await GET(request('?state=counted'))).json();

    expect(counted.total).toBe(0);

    const history = await (await GET(request('?state=revoked'))).json();

    expect(history.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ appointmentId: 'ledger-revocation-source', appointmentStatus: 'cancelled', eventState: 'revoked' }),
    ]));
  });
});
