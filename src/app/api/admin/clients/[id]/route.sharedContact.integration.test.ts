import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveOperationalSalonClientContact } from '@/libs/clientLifecycleStabilization';
import * as schema from '@/models/Schema';

import { GET, PATCH } from './route';

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

let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
const salon = { id: 'salon_a', slug: 'salon-a', name: 'Salon A', settings: null };
const VERSION = '2026-01-01T00:00:00.000Z';
const SHARED_EMAIL = 'household@example.invalid';

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
  await client.exec('truncate audit_log, salon_client_contact_alias, salon_client, client cascade');
  requireAdminSalon.mockResolvedValue({ error: null, salon });
  await database.insert(schema.salonClientSchema).values([
    { id: 'person_a', salonId: salon.id, phone: '4165550101', fullName: 'Person A', email: SHARED_EMAIL, updatedAt: new Date(VERSION) },
    { id: 'person_b', salonId: salon.id, phone: '4165550102', fullName: 'Person B', email: SHARED_EMAIL, updatedAt: new Date(VERSION) },
    { id: 'person_other_salon', salonId: 'salon_b', phone: '4165550101', fullName: 'Other salon', email: SHARED_EMAIL, updatedAt: new Date(VERSION) },
  ]);
  await database.insert(schema.appointmentSchema).values(['a', 'b'].map((person, index) => ({
    id: `appointment_${person}`,
    salonId: salon.id,
    salonClientId: `person_${person}`,
    clientPhone: `416555010${index + 1}`,
    clientEmail: SHARED_EMAIL,
    clientName: `Person ${person.toUpperCase()}`,
    startTime: new Date('2030-08-20T14:00:00.000Z'),
    endTime: new Date('2030-08-20T15:00:00.000Z'),
    totalDurationMinutes: 60,
    totalPrice: 5000,
    status: 'confirmed',
  })));
  await database.insert(schema.clientCommunicationSchema).values(['a', 'b'].map((person, index) => ({
    id: `communication_${person}`,
    salonId: salon.id,
    salonClientId: `person_${person}`,
    appointmentId: `appointment_${person}`,
    kind: 'appointment_details',
    status: 'marked_sent',
    messageSnapshot: 'Historical message',
    destinationSnapshot: `416555010${index + 1}`,
  })));
});

afterAll(async () => {
  holder.db = null;
  await client.close();
});

function edit(updates: Record<string, unknown>, id = 'person_a') {
  return PATCH(new Request(`http://localhost/api/admin/clients/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ salonSlug: salon.slug, expectedUpdatedAt: VERSION, ...updates }),
  }), { params: Promise.resolve({ id }) });
}

async function snapshot() {
  return {
    clients: await database.select().from(schema.salonClientSchema).orderBy(schema.salonClientSchema.id),
    appointments: await database.select().from(schema.appointmentSchema).orderBy(schema.appointmentSchema.id),
    communications: await database.select().from(schema.clientCommunicationSchema).orderBy(schema.clientCommunicationSchema.id),
    aliases: await database.select().from(schema.salonClientContactAliasSchema),
    audits: await database.select().from(schema.auditLogSchema),
  };
}

describe('owner edits of existing shared-email clients with real SQL', () => {
  it.each([
    { label: 'phone', updates: { phone: '6475550101' }, expected: { phone: '6475550101', email: SHARED_EMAIL } },
    { label: 'email', updates: { email: 'person-a@example.invalid' }, expected: { phone: '4165550101', email: 'person-a@example.invalid' } },
    { label: 'cleared email', updates: { email: null }, expected: { phone: '4165550101', email: null } },
    { label: 'both contacts', updates: { phone: '6475550101', email: 'person-a@example.invalid' }, expected: { phone: '6475550101', email: 'person-a@example.invalid' } },
  ])('allows a $label correction while preserving the selected identity and historical recipients', async ({ updates, expected }) => {
    const before = await snapshot();
    const response = await edit(updates);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.client).toMatchObject({ id: 'person_a', ...expected });
    expect(response.headers.get('cache-control')).toContain('no-store');

    const after = await snapshot();

    expect(after.clients.filter(row => row.id !== 'person_a')).toEqual(before.clients.filter(row => row.id !== 'person_a'));
    expect(after.appointments).toEqual(before.appointments);
    expect(after.communications).toEqual(before.communications);
    // This is the contact resolver used by dispatch/recovery. Stored message
    // history stays immutable while future sends retain the right client ID.
    expect(await resolveOperationalSalonClientContact({ salonId: salon.id, clientId: 'person_a' })).toMatchObject({ id: 'person_a', ...expected });
    expect(await resolveOperationalSalonClientContact({ salonId: salon.id, clientId: 'person_b' })).toMatchObject({ id: 'person_b', phone: '4165550102', email: SHARED_EMAIL });
    expect(after.audits).toHaveLength(1);
    expect(after.audits[0]).toMatchObject({ salonId: salon.id, entityId: 'person_a', actorId: 'owner_test' });
    expect(JSON.stringify(after.audits[0]?.metadata)).not.toContain(SHARED_EMAIL);
    expect(after.aliases).toEqual(expect.arrayContaining(Object.keys(updates).map(kind => expect.objectContaining({
      salonClientId: 'person_a',
      kind,
      normalizedValue: kind === 'phone' ? '4165550101' : SHARED_EMAIL,
    }))));

    for (const id of ['person_a', 'person_b']) {
      const history = await GET(new Request(`http://localhost/api/admin/clients/${id}?salonSlug=${salon.slug}`), { params: Promise.resolve({ id }) });
      const result = await history.json();

      expect(history.status).toBe(200);
      expect(result.data.upcomingAppointments.map((row: { id: string }) => row.id)).toEqual([`appointment_${id.at(-1)}`]);
    }

    const repeated = await edit(updates);

    expect(repeated.status).toBe(200);
    expect((await repeated.json()).meta.idempotent).toBe(true);
    expect(await snapshot()).toEqual(after);
  });

  it('does not take an existing shared-email alias from another household member', async () => {
    await database.insert(schema.salonClientContactAliasSchema).values({ salonId: salon.id, salonClientId: 'person_b', kind: 'email', normalizedValue: SHARED_EMAIL });
    const before = await snapshot();
    const response = await edit({ email: 'corrected@example.invalid' });

    expect(response.status).toBe(200);

    const after = await snapshot();

    expect(after.aliases).toEqual(before.aliases);
    expect(after.appointments).toEqual(before.appointments);
    expect(after.communications).toEqual(before.communications);
    expect(after.clients.find(row => row.id === 'person_b')).toEqual(before.clients.find(row => row.id === 'person_b'));
  });

  it.each(['phone', 'email'] as const)('rejects a newly claimed %s belonging to another client and rolls back every field', async (kind) => {
    await database.insert(schema.salonClientSchema).values({ id: 'person_c', salonId: salon.id, phone: '4165550103', email: 'person-c@example.invalid' });
    const before = await snapshot();
    const response = await edit({ [kind]: kind === 'phone' ? '4165550103' : 'person-c@example.invalid', notes: 'Must not save' });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('CONTACT_IDENTITY_CONFLICT');
    expect(await snapshot()).toEqual(before);
  });

  it.each(['phone', 'email'] as const)('rejects a newly claimed historical %s alias belonging to the other household member', async (kind) => {
    const value = kind === 'phone' ? '6475550102' : 'old-person-b@example.invalid';
    await database.insert(schema.salonClientContactAliasSchema).values({ salonId: salon.id, salonClientId: 'person_b', kind, normalizedValue: value });
    const before = await snapshot();
    const response = await edit({ [kind]: value });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('CONTACT_IDENTITY_CONFLICT');
    expect(await snapshot()).toEqual(before);
  });

  it.each([false, true])('preserves the external customer-account guard (explicit link: %s)', async (linked) => {
    await database.insert(schema.clientSchema).values({ id: 'login_a', phone: '+14165550101', email: SHARED_EMAIL });
    if (linked) {
      await database.update(schema.salonClientSchema).set({ clientId: 'login_a', updatedAt: new Date(VERSION) }).where(eq(schema.salonClientSchema.id, 'person_a'));
    }
    const before = await snapshot();
    const response = await edit({ email: 'corrected@example.invalid' });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe(linked ? 'CLIENT_ACCOUNT_LINK_CONTACT_LOCKED' : 'UNSUPPORTED_CLIENT_IDENTITY');
    expect(await snapshot()).toEqual(before);
  });

  it('rejects a stale edit without changing contacts, history or audit records', async () => {
    const before = await snapshot();
    const response = await edit({ phone: '6475550101', expectedUpdatedAt: '2025-12-31T00:00:00.000Z' });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('CLIENT_EDIT_CONFLICT');
    expect(await snapshot()).toEqual(before);
  });

  it('does not let the authorized salon edit a matching contact in another salon', async () => {
    const before = await snapshot();
    const response = await edit({ email: 'corrected@example.invalid' }, 'person_other_salon');

    expect(response.status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it('preserves the authorization rejection before any identity mutation', async () => {
    requireAdminSalon.mockResolvedValue({ error: new Response('Forbidden', { status: 403 }), salon: null });
    const before = await snapshot();
    const response = await edit({ phone: '6475550101' });

    expect(response.status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });
});
