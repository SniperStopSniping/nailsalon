import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SalonDeletionAsset } from '@/models/salonDeletion';
import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
const provider = vi.hoisted(() => ({ destroy: vi.fn(), resources: vi.fn(), privateDelete: vi.fn() }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/Cloudinary', () => ({
  cloudinary: { uploader: { destroy: provider.destroy }, api: { resources_by_ids: provider.resources } },
  isCloudinaryConfigured: () => true,
}));
vi.mock('@/features/onboarding-v1-integration/media-storage.server', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/onboarding-v1-integration/media-storage.server')>(),
  deleteOnboardingMediaFile: provider.privateDelete,
}));
vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: vi.fn(async (salonId: string) => ({
    ok: salonId === 'fake_other_salon',
    response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    admin: { id: 'fake_owner_b', isSuperAdmin: false, salons: [{ salonId, role: 'owner' }] },
  })),
  formatPhoneE164: (value: string) => value,
}));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/libs/queries', () => ({
  getSalonBySlug: async (slug: string) => {
    const database = holder.db as ReturnType<typeof drizzle<typeof schema>>;
    const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.slug, slug));
    return salon ?? null;
  },
  getActiveLocationsBySalonId: async () => [],
  getTechniciansBySalonId: async () => [],
}));
vi.mock('@/features/onboarding-v1-integration/canonical-profile-media.server', () => ({
  saveCanonicalOnboardingProfileMedia: vi.fn(),
  deleteCanonicalOnboardingProfileMedia: vi.fn(),
}));

const { PATCH } = await import('@/app/api/admin/salon/information/route');
const { runSalonDeletionCleanup, cleanupPendingSalonDeletions } = await import('./salonDeletionCleanup.server');

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(async () => {
  vi.clearAllMocks();
  provider.destroy.mockReset();
  provider.resources.mockReset();
  provider.privateDelete.mockReset();
  provider.privateDelete.mockResolvedValue(undefined);
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
  await db.insert(schema.salonSchema).values({ id: 'fake_other_salon', slug: 'fake-other-salon', name: 'Fake other salon' });
});

afterEach(async () => {
  await client.close();
});

describe('public media reference race — safe provider stub', () => {
  const publicId = 'salons/fake_removed_salon/appointments/fake_appt/fake_photo';
  const imageUrl = `https://res.cloudinary.com/fake-race-cloud/image/upload/v1/${publicId}.webp`;

  async function seedLegacyJob(assets: SalonDeletionAsset[]) {
    const jobId = randomUUID();
    await db.insert(schema.salonDeletionCleanupSchema).values({
      id: jobId,
      sourceSalonId: 'fake_removed_salon',
      confirmationDigest: 'fake',
      mediaTotal: assets.length,
      pendingAssets: assets,
    });
    return jobId;
  }

  it('keeps an already-captured public job under review while a supported owner PATCH adds a reference', async () => {
    const asset = { kind: 'cloudinary', publicId, source: 'appointment' } as const;
    const jobId = await seedLegacyJob([asset]);
    let fakeAssetAvailable = true;
    provider.destroy.mockImplementation(async () => {
      fakeAssetAvailable = false;
      return { result: 'ok' };
    });
    // Raw logoUrl writes remain supported. They are deliberately not asserted
    // to be fenced; this conservative deletion fix does not change that route.
    const patch = await PATCH(new Request('http://localhost/api/admin/salon/information?salonSlug=fake-other-salon', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logoUrl: imageUrl }),
    }));

    expect(patch.status).toBe(200);
    expect(await cleanupPendingSalonDeletions()).toEqual({ checked: 0, completed: 0, pending: 0 });

    const status = await runSalonDeletionCleanup(jobId);

    expect(status).toMatchObject({ status: 'review_required', reviewRequired: 1, mediaRemaining: 1, mediaRemoved: 0 });

    const [other] = await db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, 'fake_other_salon'));

    expect(other?.logoUrl).toBe(imageUrl);
    expect(fakeAssetAvailable).toBe(true);
    expect(provider.destroy).not.toHaveBeenCalled();
    expect(provider.resources).not.toHaveBeenCalled();

    const [job] = await db.select().from(schema.salonDeletionCleanupSchema);

    expect(job?.pendingAssets).toEqual([asset]);
    expect(job?.completedAt).toBeNull();
  });

  it.each([
    { kind: 'cloudinary', publicId: 'salons/fake_removed_salon/portfolio/portfolio_abcdefghijklmnop_webp', source: 'portfolio' },
    { kind: 'cloudinary', publicId: 'salons/fake_removed_salon/services/service_svc_abcdefghijklmnop_webp', source: 'service' },
    { kind: 'local_service', imageUrl: '/uploads/services/fake_removed_salon/service_svc_abcdefghijklmnop.webp', serviceId: 'svc' },
  ] satisfies SalonDeletionAsset[])('holds legacy public payload $kind / $source for manual review', async (asset) => {
    const jobId = await seedLegacyJob([asset]);

    expect(await runSalonDeletionCleanup(jobId)).toMatchObject({ status: 'review_required', reviewRequired: 1, mediaRemaining: 1, mediaRemoved: 0 });
    expect(provider.destroy).not.toHaveBeenCalled();
    expect(provider.resources).not.toHaveBeenCalled();
    expect(provider.privateDelete).not.toHaveBeenCalled();
  });

  it('continues private-media retries while retaining public media for review in a mixed job', async () => {
    const key = `cloudinary_authenticated:salons/fake_removed_salon/onboarding-sites/site/revisions/rev/gallery/${'a'.repeat(32)}`;
    const publicAsset = { kind: 'cloudinary', publicId, source: 'appointment' } as const;
    const jobId = await seedLegacyJob([{ kind: 'onboarding', key }, publicAsset]);

    expect(await cleanupPendingSalonDeletions()).toEqual({ checked: 1, completed: 0, pending: 1 });

    const [job] = await db.select().from(schema.salonDeletionCleanupSchema);

    expect(job?.id).toBe(jobId);
    expect(job?.pendingAssets).toEqual([publicAsset]);
    expect(job?.mediaRemoved).toBe(1);
    expect(provider.privateDelete).toHaveBeenCalledWith(key, { salonId: 'fake_removed_salon' });
    expect(provider.destroy).not.toHaveBeenCalled();
    expect(provider.resources).not.toHaveBeenCalled();
    expect(await cleanupPendingSalonDeletions()).toEqual({ checked: 0, completed: 0, pending: 0 });
  });
});
