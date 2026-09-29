import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { GET } from './route';

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
const salon = { id: 'owner-records-salon', slug: 'owner-records-salon', name: 'Owner records' };

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
  vi.stubEnv('NETWORK_NO_SHOW_ENABLED', 'true');
  requireAdminSalonFromRequest.mockResolvedValue({ error: null, salon, admin: { id: 'owner-records' } });
  await db.insert(schema.salonSchema).values([salon, { id: 'owner-records-other', slug: 'owner-records-other', name: 'Other' }]);
  await db.insert(schema.networkNoShowPlatformControlSchema).values({ id: 1, enabledAt: new Date(), prospectiveAfter: new Date('2020-01-01T00:00:00.000Z') });
  const start = new Date('2030-01-01T10:00:00.000Z');
  const end = new Date('2030-01-01T11:00:00.000Z');
  await db.insert(schema.appointmentSchema).values(Array.from({ length: 26 }, (_, index) => ({ id: `owner-list-${index}`, salonId: salon.id, clientPhone: `+1416555${String(1000 + index).padStart(4, '0')}`, clientEmail: `owner-${index}@example.test`, startTime: start, endTime: new Date(end.getTime() + index), status: 'no_show' as const, totalPrice: 5000, totalDurationMinutes: 60 })));
  await db.insert(schema.appointmentSchema).values({ id: 'other-list-record', salonId: 'owner-records-other', clientPhone: '+14165559999', startTime: start, endTime: end, status: 'no_show', totalPrice: 5000, totalDurationMinutes: 60 });
}, 30_000);

afterAll(async () => client.close());

describe('owner no-show records', () => {
  it('lists only the authorized salon and paginates past 25 records', async () => {
    const first = await GET(new Request(`http://localhost/api/admin/network-no-show/records?salonSlug=${salon.slug}&page=1`));
    const firstBody = await first.json();

    expect(first.status).toBe(200);
    expect(first.headers.get('Cache-Control')).toBe('private, no-store');
    expect(firstBody.total).toBe(26);
    expect(firstBody.items).toHaveLength(25);
    expect(firstBody.items.map((item: { appointmentId: string }) => item.appointmentId)).not.toContain('other-list-record');

    const secondBody = await (await GET(new Request(`http://localhost/api/admin/network-no-show/records?salonSlug=${salon.slug}&page=2`))).json();

    expect(secondBody.items).toHaveLength(1);
  });
});
