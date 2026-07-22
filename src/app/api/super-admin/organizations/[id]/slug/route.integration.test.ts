import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const superAdmin = vi.hoisted(() => ({ guard: null as Response | null }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/superAdmin', () => ({
  requireSuperAdmin: vi.fn(async () => superAdmin.guard),
  getSuperAdminInfo: vi.fn(async () => ({
    userId: 'super_admin_1',
    name: 'Super Admin',
    email: 'admin@example.test',
  })),
}));

const { PATCH } = await import('./route');
const { getSalonByFormerSlug } = await import('@/libs/queries');

const SALON_ID = 'salon_slug_change';
const ORIGINAL_SLUG = 'original-salon';
const LOCKED_AT = new Date('2026-07-01T12:00:00.000Z');
const originalEnv = { ...process.env };

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

function request(body: unknown): Request {
  return new Request(`http://localhost/api/super-admin/organizations/${SALON_ID}/slug`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function invoke(body: unknown): Promise<Response> {
  return PATCH(request(body), { params: Promise.resolve({ id: SALON_ID }) });
}

async function getSalon() {
  const [salon] = await db
    .select()
    .from(schema.salonSchema)
    .where(eq(schema.salonSchema.id, SALON_ID));
  return salon;
}

async function getSlugAudits() {
  const audits = await db
    .select()
    .from(schema.salonAuditLogSchema)
    .where(eq(schema.salonAuditLogSchema.salonId, SALON_ID));

  return audits.filter(audit => audit.metadata?.field === 'slug');
}

beforeEach(async () => {
  superAdmin.guard = null;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
  delete process.env.PUBLIC_APP_URL;
  delete process.env.NEXT_PUBLIC_BASE_URL;
  delete process.env.LUSTER_ROOT_DOMAIN;
  delete process.env.TENANT_SUBDOMAINS_ENABLED;

  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Original Salon',
    slug: ORIGINAL_SLUG,
    publicationStatus: 'published',
    publishedAt: LOCKED_AT,
    slugLockedAt: LOCKED_AT,
  });
});

afterEach(async () => {
  await client.close();
  process.env = { ...originalEnv };
});

describe('PATCH /api/super-admin/organizations/[id]/slug', () => {
  it('normalizes and changes a published locked salon slug without clearing the lock', async () => {
    const response = await invoke({
      slug: '  RENAMED-SALON  ',
      expectedCurrentSlug: `  ${ORIGINAL_SLUG.toUpperCase()}  `,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toMatchObject({
      changed: true,
      previousSlug: ORIGINAL_SLUG,
      salon: {
        id: SALON_ID,
        slug: 'renamed-salon',
        slugLockedAt: LOCKED_AT.toISOString(),
      },
      canonicalUrls: {
        publicUrl: 'https://app.example.test/en/renamed-salon',
        bookingUrl: 'https://app.example.test/en/renamed-salon/book',
        findBookingUrl: 'https://app.example.test/en/renamed-salon/find-booking',
      },
    });

    const salon = await getSalon();

    expect(salon?.slug).toBe('renamed-salon');
    expect(salon?.slugLockedAt?.toISOString()).toBe(LOCKED_AT.toISOString());
    await expect(getSalonByFormerSlug(ORIGINAL_SLUG)).resolves.toMatchObject({
      id: SALON_ID,
      slug: 'renamed-salon',
    });

    const audits = await getSlugAudits();

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'updated',
      performedBy: 'super_admin_1',
      performedByEmail: 'admin@example.test',
      metadata: {
        field: 'slug',
        previousValue: ORIGINAL_SLUG,
        newValue: 'renamed-salon',
      },
    });
  });

  it('is idempotent when a retry requests the slug already committed', async () => {
    const first = await invoke({ slug: 'renamed-salon', expectedCurrentSlug: ORIGINAL_SLUG });

    expect(first.status).toBe(200);

    const retry = await invoke({ slug: 'renamed-salon', expectedCurrentSlug: ORIGINAL_SLUG });
    const body = await retry.json();

    expect(retry.status).toBe(200);
    expect(body).toMatchObject({ changed: false, salon: { slug: 'renamed-salon' } });
    expect(await getSlugAudits()).toHaveLength(1);
  });

  it('rejects a stale expected slug without changing or auditing the salon', async () => {
    const response = await invoke({ slug: 'renamed-salon', expectedCurrentSlug: 'stale-salon' });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: expect.stringContaining('changed since'),
      currentSlug: ORIGINAL_SLUG,
      salon: { slug: ORIGINAL_SLUG },
      canonicalUrls: {
        publicUrl: `https://app.example.test/en/${ORIGINAL_SLUG}`,
      },
    });
    expect((await getSalon())?.slug).toBe(ORIGINAL_SLUG);
    expect(await getSlugAudits()).toHaveLength(0);
  });

  it('returns 409 for a duplicate slug and rolls back the audit', async () => {
    await db.insert(schema.salonSchema).values({
      id: 'salon_duplicate',
      name: 'Duplicate Salon',
      slug: 'already-taken',
    });

    const response = await invoke({ slug: 'already-taken', expectedCurrentSlug: ORIGINAL_SLUG });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'A salon with this slug already exists',
    });
    expect((await getSalon())?.slug).toBe(ORIGINAL_SLUG);
    expect(await getSlugAudits()).toHaveLength(0);
  });

  it('rejects invalid and reserved slugs before starting a database change', async () => {
    for (const slug of ['super-admin', '-invalid', 'contains spaces']) {
      const response = await invoke({ slug, expectedCurrentSlug: ORIGINAL_SLUG });

      expect(response.status).toBe(400);
    }

    expect((await getSalon())?.slug).toBe(ORIGINAL_SLUG);
    expect(await getSlugAudits()).toHaveLength(0);
  });

  it('returns the authorization guard response without touching the salon', async () => {
    superAdmin.guard = Response.json({ error: 'Forbidden' }, { status: 403 });

    const response = await invoke({ slug: 'renamed-salon', expectedCurrentSlug: ORIGINAL_SLUG });

    expect(response.status).toBe(403);
    expect((await getSalon())?.slug).toBe(ORIGINAL_SLUG);
    expect(await getSlugAudits()).toHaveLength(0);
  });
});
