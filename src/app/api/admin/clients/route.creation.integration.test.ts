import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { POST } from './route';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
const requireAdminSalon = vi.hoisted(() => vi.fn());
vi.mock('@/libs/DB', () => ({
  get db() {
    if (!holder.db) {
      throw new Error('Only the isolated test database may be used.');
    }
    return holder.db;
  },
}));
vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
  getAdminSession: vi.fn(async () => ({ id: 'owner_test', phoneE164: '+14165550999' })),
}));
// GET-only reporting dependencies must never make external requests here.
vi.mock('@/libs/clientInsights.server', () => ({ getClientInsightsDirectoryPage: vi.fn() }));
vi.mock('@/libs/financialReportingServer', () => ({ getCompletedFinancialResolution: vi.fn() }));
vi.mock('@/libs/queries', () => ({ getSalonClients: vi.fn() }));

let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
const salon = { id: 'salon_a', slug: 'salon-a', name: 'Salon A', settings: null };

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = database;
  await database.insert(schema.salonSchema).values([
    { id: salon.id, slug: salon.slug, name: salon.name },
    { id: 'salon_b', slug: 'salon-b', name: 'Salon B' },
  ]);
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  await client.exec('truncate audit_log, salon_client_contact_alias, salon_client cascade');
  requireAdminSalon.mockResolvedValue({ error: null, salon });
  await addClient('person_a', '4165550101', 'household@example.com');
});

afterAll(async () => {
  holder.db = null;
  await client.close();
});

function addClient(id: string, phone: string, email: string, salonId = salon.id) {
  return database.insert(schema.salonClientSchema).values({
    id,
    salonId,
    phone,
    email,
    fullName: `Saved ${id}`,
  });
}

function create(phone: string, email: string, extra: Record<string, unknown> = {}) {
  return POST(new Request('http://localhost/api/admin/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ salonSlug: salon.slug, firstName: 'New client', phone, email, ...extra }),
  }));
}

describe('owner client creation with the real identity resolver and database', () => {
  it('creates a separate customer for a new phone sharing an existing email', async () => {
    const response = await create('4165550102', 'household@example.com');
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.data.created).toBe(true);
    expect(result.data.client.id).not.toBe('person_a');
    expect(result.data.client.phone).toBe('4165550102');

    const saved = await database.select().from(schema.salonClientSchema);

    expect(saved).toHaveLength(2);
    expect(saved.find(row => row.id === 'person_a')).toMatchObject({
      phone: '4165550101',
      email: 'household@example.com',
      fullName: 'Saved person_a',
    });

    const audit = await database.select().from(schema.auditLogSchema);

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ salonId: salon.id, entityId: result.data.client.id, actorId: 'owner_test' });
  });

  it('returns the correct existing household member without rewriting their details', async () => {
    await addClient('person_b', '4165550102', 'household@example.com');
    for (const [id, phone] of [['person_a', '4165550101'], ['person_b', '4165550102']]) {
      const response = await create(phone!, 'HOUSEHOLD@example.com');
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.data).toMatchObject({ created: false, client: { id, fullName: `Saved ${id}`, phone } });
    }

    expect(await database.select().from(schema.salonClientSchema)).toHaveLength(2);
    expect(await database.select().from(schema.auditLogSchema)).toHaveLength(0);
  });

  it('repeated submissions do not duplicate a newly added household member', async () => {
    const first = await create('4165550102', 'household@example.com');
    const firstBody = await first.json();
    const second = await create('+1 (416) 555-0102', 'household@example.com');
    const secondBody = await second.json();

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(secondBody.data.client.id).toBe(firstBody.data.client.id);
    expect(await database.select().from(schema.salonClientSchema)).toHaveLength(2);
    expect(await database.select().from(schema.auditLogSchema)).toHaveLength(1);
  });

  it('still rejects a known phone paired with another customer\'s unrelated email', async () => {
    await addClient('person_b', '4165550102', 'other@example.com');
    const response = await create('4165550101', 'other@example.com');

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('UNSUPPORTED_CLIENT_IDENTITY');
    expect(await database.select().from(schema.salonClientSchema)).toHaveLength(2);
    expect(await database.select().from(schema.auditLogSchema)).toHaveLength(0);
  });

  it('preserves existing phone aliases and archived-client behavior', async () => {
    await database.insert(schema.salonClientContactAliasSchema).values({
      salonId: salon.id,
      salonClientId: 'person_a',
      kind: 'phone',
      normalizedValue: '4165550199',
    });
    await database.update(schema.salonClientSchema).set({ archivedAt: new Date() }).where(eq(schema.salonClientSchema.id, 'person_a'));
    const response = await create('4165550199', 'household@example.com');
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.data.client).toMatchObject({ id: 'person_a', phone: '4165550101', archived: true });
    expect(result.data.message).toContain('archived');
    expect(await database.select().from(schema.salonClientSchema)).toHaveLength(1);
  });

  it('creates only within the authorized salon, ignoring submitted salon IDs and matching modes', async () => {
    await addClient('foreign_person', '4165550201', 'foreign@example.com', 'salon_b');
    const response = await create('4165550201', 'foreign@example.com', { salonId: 'salon_b', matchMode: 'strict' });
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.data.client.id).not.toBe('foreign_person');
    expect(requireAdminSalon).toHaveBeenCalledWith(salon.slug);

    const added = await database.select().from(schema.salonClientSchema).where(eq(schema.salonClientSchema.id, result.data.client.id));

    expect(added[0]?.salonId).toBe(salon.id);
  });

  it.each([401, 403])('refuses unauthorized creation with status %i before writing', async (status) => {
    requireAdminSalon.mockResolvedValue({ error: Response.json({ error: 'Unauthorized' }, { status }), salon: null });
    const response = await create('4165550102', 'household@example.com');

    expect(response.status).toBe(status);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await database.select().from(schema.salonClientSchema)).toHaveLength(1);
    expect(await database.select().from(schema.auditLogSchema)).toHaveLength(0);
  });
});
