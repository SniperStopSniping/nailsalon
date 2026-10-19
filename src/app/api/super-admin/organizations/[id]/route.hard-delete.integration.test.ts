/**
 * Hard-delete endpoint contract (real PGlite, real migrations).
 *
 * Companion to src/libs/salonPurge.integration.test.ts, which proves the delete
 * ORDER is correct. This file proves the ENDPOINT is safe: it cannot be reached
 * without a server-verified confirmation, it refuses to destroy a salon that is
 * still live, and a failure leaves nothing behind.
 *
 * The seed reproduces the shape that caused the original data loss: appointments
 * with service line items plus a fraud_signal row whose ON DELETE RESTRICT
 * foreign key blocked the delete half-way through.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const mediaCleanup = vi.hoisted(() => vi.fn(async (_key: string, _owner: { salonId: string }) => {}));

vi.mock('@/features/onboarding-v1-integration/media-storage.server', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/onboarding-v1-integration/media-storage.server')>(),
  deleteOnboardingMediaFile: mediaCleanup,
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const superAdmin = vi.hoisted(() => ({
  guard: null as Response | null,
}));

vi.mock('@/libs/superAdmin', () => ({
  requireSuperAdmin: vi.fn(async () => superAdmin.guard),
  getSuperAdminInfo: vi.fn(async () => ({ userId: 'sa_1', name: 'Root', email: 'root@example.test' })),
  logAuditAction: vi.fn(async () => {}),
}));

const { DELETE } = await import('./route');
const { GET: cleanupGET, POST: cleanupPOST } = await import('../../deletion-cleanup/[id]/route');
const { GET: cleanupList } = await import('../../deletion-cleanup/route');
const { runSalonDeletionCleanup, cleanupPendingSalonDeletions } = await import('@/libs/salonDeletionCleanup.server');

const SALON = 'salon_endpoint';
const SLUG = 'endpoint-salon';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const params = Promise.resolve({ id: SALON });

function deleteRequest(options: { hard: boolean; body?: unknown }): Request {
  const url = `http://localhost/api/super-admin/organizations/${SALON}${options.hard ? '?hard=true' : ''}`;
  return new Request(url, {
    method: 'DELETE',
    ...(options.body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) }),
  });
}

async function softDelete(): Promise<void> {
  await db
    .update(schema.salonSchema)
    .set({ deletedAt: new Date(), deletedBy: 'sa_1', status: 'cancelled' })
    .where(eq(schema.salonSchema.id, SALON));
}

async function counts(): Promise<{ salons: number; appointments: number; lineItems: number; fraud: number }> {
  const [salons, appointments, lineItems, fraud] = await Promise.all([
    db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, SALON)),
    db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON)),
    db.select().from(schema.appointmentServicesSchema),
    db.select().from(schema.fraudSignalSchema).where(eq(schema.fraudSignalSchema.salonId, SALON)),
  ]);

  return {
    salons: salons.length,
    appointments: appointments.length,
    lineItems: lineItems.length,
    fraud: fraud.length,
  };
}

beforeEach(async () => {
  mediaCleanup.mockReset();
  mediaCleanup.mockResolvedValue(undefined);
  superAdmin.guard = null;

  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  const start = new Date(Date.UTC(2026, 6, 20, 15, 0, 0));

  await db.insert(schema.salonSchema).values({ id: SALON, name: 'Endpoint Salon', slug: SLUG });
  await db.insert(schema.serviceSchema).values({
    id: 'svc_1',
    salonId: SALON,
    name: 'Gel Manicure',
    price: 60,
    durationMinutes: 60,
    category: 'manicure',
  });
  await db.insert(schema.salonClientSchema).values({ id: 'sc_1', salonId: SALON, phone: '4165550100' });

  // Two appointments, each with a service line item — the rows the old handler
  // deleted before hitting the fraud_signal RESTRICT and failing.
  for (const n of [1, 2]) {
    await db.insert(schema.appointmentSchema).values({
      id: `appt_${n}`,
      salonId: SALON,
      clientPhone: '4165550100',
      salonClientId: 'sc_1',
      startTime: new Date(start.getTime() + n * 3_600_000),
      endTime: new Date(start.getTime() + (n + 1) * 3_600_000),
      totalPrice: 60,
      totalDurationMinutes: 60,
    });
    await db.insert(schema.appointmentServicesSchema).values({
      id: `as_${n}`,
      appointmentId: `appt_${n}`,
      serviceId: 'svc_1',
      priceAtBooking: 60,
      durationAtBooking: 60,
    });
  }

  await db.insert(schema.fraudSignalSchema).values({
    id: 'fs_1',
    salonId: SALON,
    salonClientId: 'sc_1',
    appointmentId: 'appt_1',
    type: 'HIGH_APPOINTMENT_FREQUENCY',
    reason: 'seeded',
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await client.close();
});

describe('DELETE ?hard=true', () => {
  it('refuses a salon that has not been archived, and touches nothing', async () => {
    const before = await counts();

    const response = await DELETE(deleteRequest({ hard: true, body: { confirmSlug: SLUG } }), { params });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('Soft delete the salon first'),
    });
    expect(await counts()).toEqual(before);
  });

  it('refuses a request with no confirmation body', async () => {
    await softDelete();
    const before = await counts();

    const response = await DELETE(deleteRequest({ hard: true }), { params });

    expect(response.status).toBe(400);
    expect(await counts()).toEqual(before);
  });

  it('refuses a confirmation that does not match the slug', async () => {
    await softDelete();
    const before = await counts();

    const response = await DELETE(deleteRequest({ hard: true, body: { confirmSlug: 'not-the-slug' } }), { params });

    expect(response.status).toBe(400);
    expect(await counts()).toEqual(before);
  });

  it('refuses a caller who is not a super admin', async () => {
    await softDelete();
    superAdmin.guard = Response.json({ error: 'Forbidden' }, { status: 403 });
    const before = await counts();

    const response = await DELETE(deleteRequest({ hard: true, body: { confirmSlug: SLUG } }), { params });

    expect(response.status).toBe(403);
    expect(await counts()).toEqual(before);
  });

  it('purges the salon completely once archived and confirmed', async () => {
    await softDelete();

    const response = await DELETE(deleteRequest({ hard: true, body: { confirmSlug: SLUG } }), { params });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, deletedId: SALON });

    // Including the fraud_signal row that made this impossible before.
    expect(await counts()).toEqual({ salons: 0, appointments: 0, lineItems: 0, fraud: 0 });
  });

  it('records the deletion in a platform audit row that outlives the salon', async () => {
    await softDelete();

    await DELETE(deleteRequest({ hard: true, body: { confirmSlug: SLUG } }), { params });

    const audits = await db
      .select()
      .from(schema.auditLogSchema)
      .where(eq(schema.auditLogSchema.action, 'salon_hard_deleted'));

    expect(audits).toHaveLength(1);
    // salonId must be null, otherwise the row would have been cascaded away with
    // the salon and the deletion would leave no trace anywhere.
    expect(audits[0]).toMatchObject({ salonId: null, entityType: 'salon', entityId: SALON });
    expect(audits[0]?.metadata).toMatchObject({ slug: SLUG, name: 'Endpoint Salon' });
  });

  it('cleans only managed private media from the deleted tenant after the transaction commits', async () => {
    await db.insert(schema.adminUserSchema).values({ id: 'media_owner', name: 'Owner', email: 'owner@example.test' });
    await db.insert(schema.salonSchema).values({ id: 'other_salon', name: 'Other', slug: 'other-media-salon' });
    const tenants = [SALON, 'other_salon'];
    for (const [index, salonId] of tenants.entries()) {
      const siteId = `22222222-2222-4222-8222-22222222222${index}`;
      const revisionId = `33333333-3333-4333-8333-33333333333${index}`;
      await client.query(`
        INSERT INTO onboarding_site (id, salon_id, created_by_admin_id, current_revision, style_preset_id, palette_preset_id)
        VALUES ($1, $2, 'media_owner', 1, 'modern', 'luster_berry')
      `, [siteId, salonId]);
      await client.query(`
        INSERT INTO onboarding_site_revision
          (id, salon_id, site_id, revision, created_by_admin_id, snapshot_version, snapshot,
           snapshot_fingerprint, document_version, document, document_fingerprint)
        VALUES ($1, $2, $3, 1, 'media_owner', 1, '{}', 'snapshot', 1, '{}', 'document')
      `, [revisionId, salonId, siteId]);
      for (const storageProvider of ['cloudinary_authenticated', 'development_local', 'cloudinary']) {
        await db.insert(schema.onboardingSiteMediaSchema).values({
          fileName: 'photo.webp',
          id: randomUUID(),
          localItemId: storageProvider,
          mimeType: 'image/webp',
          revisionId,
          role: 'gallery',
          salonId,
          siteId,
          storageKey: storageProvider === 'cloudinary_authenticated'
            ? `cloudinary_authenticated:salons/${salonId}/onboarding-sites/${siteId}/revisions/${revisionId}/gallery/${'a'.repeat(32)}`
            : storageProvider === 'development_local'
              ? `${salonId}/${siteId}/${revisionId}/gallery/${'b'.repeat(32)}.webp`
              : `${salonId}/${storageProvider}`,
          storageProvider,
        });
      }
    }
    await softDelete();
    mediaCleanup.mockImplementationOnce(async () => {
      expect((await counts()).salons).toBe(0);

      return undefined;
    });

    const response = await DELETE(deleteRequest({ hard: true, body: { confirmSlug: SLUG } }), { params });

    expect(response.status).toBe(202);
    expect(mediaCleanup).toHaveBeenCalledTimes(2);
    expect(mediaCleanup).toHaveBeenCalledWith(expect.stringContaining(`cloudinary_authenticated:salons/${SALON}/`), { salonId: SALON });
    expect(mediaCleanup).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${SALON}/.*\\.webp$`)), { salonId: SALON });
    await expect(response.json()).resolves.toMatchObject({ success: false, cleanup: { status: 'review_required', mediaRemoved: 2, mediaRemaining: 1, reviewRequired: 1 } });

    const otherMedia = await db.select().from(schema.onboardingSiteMediaSchema)
      .where(eq(schema.onboardingSiteMediaSchema.salonId, 'other_salon'));

    expect(otherMedia).toHaveLength(3);
  });
});

describe('DELETE (soft)', () => {
  it('archives the salon and preserves its data', async () => {
    const response = await DELETE(deleteRequest({ hard: false }), { params });

    expect(response.status).toBe(200);

    const [salon] = await db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, SALON));

    expect(salon?.deletedAt).toBeInstanceOf(Date);
    expect(salon?.status).toBe('cancelled');
    expect(await counts()).toMatchObject({ appointments: 2, lineItems: 2 });
  });

  it('will not overwrite the original deletedAt on a second archive', async () => {
    await DELETE(deleteRequest({ hard: false }), { params });
    const [first] = await db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, SALON));

    const response = await DELETE(deleteRequest({ hard: false }), { params });

    expect(response.status).toBe(409);

    const [second] = await db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, SALON));

    expect(second?.deletedAt).toEqual(first?.deletedAt);
  });
});

// Synthetic operational rehearsal. Mailbox delivery and the human identity
// challenge are separate live gates; these tests prove the app/DB cleanup path.
describe('durable salon deletion recovery', () => {
  const key = `cloudinary_authenticated:salons/already_removed_salon/onboarding-sites/site/revisions/rev/gallery/${'c'.repeat(32)}`;

  async function seedJob() {
    const id = randomUUID();
    await db.insert(schema.salonDeletionCleanupSchema).values({
      id,
      sourceSalonId: 'already_removed_salon',
      confirmationDigest: 'test',
      mediaTotal: 1,
      pendingAssets: [{ kind: 'onboarding', key }],
    });
    return id;
  }

  async function makeDue(id: string) {
    await db.update(schema.salonDeletionCleanupSchema).set({ nextAttemptAt: new Date(0), leaseToken: null, leaseExpiresAt: null })
      .where(eq(schema.salonDeletionCleanupSchema.id, id));
  }

  it('recovers actual post-purge image failure without deleting the owner account', async () => {
    await db.insert(schema.adminUserSchema).values({ id: 'support_test_owner', name: 'Fake Owner', email: 'fake-owner@example.test' });
    const siteId = randomUUID();
    const revisionId = randomUUID();
    const storageKey = `cloudinary_authenticated:salons/${SALON}/onboarding-sites/${siteId}/revisions/${revisionId}/gallery/${'d'.repeat(32)}`;
    await client.query(`INSERT INTO onboarding_site (id, salon_id, created_by_admin_id, current_revision, style_preset_id, palette_preset_id)
      VALUES ($1, $2, 'support_test_owner', 1, 'modern', 'luster_berry')`, [siteId, SALON]);
    await client.query(`INSERT INTO onboarding_site_revision
      (id, salon_id, site_id, revision, created_by_admin_id, snapshot_version, snapshot, snapshot_fingerprint, document_version, document, document_fingerprint)
      VALUES ($1, $2, $3, 1, 'support_test_owner', 1, '{}', 'test', 1, '{}', 'test')`, [revisionId, SALON, siteId]);
    await db.insert(schema.onboardingSiteMediaSchema).values({ id: randomUUID(), salonId: SALON, siteId, revisionId, role: 'gallery', fileName: 'fake-image.webp', localItemId: 'fake-image', mimeType: 'image/webp', storageKey, storageProvider: 'cloudinary_authenticated' });
    await softDelete();
    mediaCleanup.mockImplementationOnce(async () => {
      expect((await counts()).salons).toBe(0);

      throw new Error('simulated private provider failure');
    });
    const response = await DELETE(deleteRequest({ hard: true, body: { confirmSlug: SLUG } }), { params });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({ success: false, cleanup: { databaseDeleted: true, status: 'pending', mediaRemaining: 1 } });

    const [job] = await db.select().from(schema.salonDeletionCleanupSchema);

    expect(job?.pendingAssets).toEqual([{ kind: 'onboarding', key: storageKey }]);
    expect(await db.select().from(schema.adminUserSchema).where(eq(schema.adminUserSchema.id, 'support_test_owner'))).toHaveLength(1);

    await makeDue(body.cleanup.jobId);

    expect(await runSalonDeletionCleanup(body.cleanup.jobId)).toMatchObject({ status: 'completed', mediaRemoved: 1, mediaRemaining: 0 });

    const final = await cleanupGET(new Request(`http://localhost/api/super-admin/deletion-cleanup/${body.cleanup.jobId}`), { params: Promise.resolve({ id: body.cleanup.jobId }) });

    expect(final.status).toBe(200);
    expect(mediaCleanup.mock.calls.map(([storedKey]) => storedKey)).toEqual([storageKey, storageKey]);
  });

  it('preserves another tenant’s transformed reference to an owned service image for review', async () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'fake-review-cloud');
    vi.stubEnv('CLOUDINARY_API_KEY', '');
    vi.stubEnv('CLOUDINARY_API_SECRET', '');
    const publicId = `salons/${SALON}/services/service_svc_1_${'a'.repeat(16)}_webp`;
    await db.update(schema.serviceSchema).set({ imageUrl: `https://res.cloudinary.com/fake-review-cloud/image/upload/v123/${publicId}.webp` }).where(eq(schema.serviceSchema.id, 'svc_1'));
    await db.insert(schema.salonSchema).values({ id: 'other_image_salon', slug: 'other-image-salon', name: 'Other fake salon' });
    const sharedUrl = `https://res.cloudinary.com/fake-review-cloud/image/upload/c_fill,w_100/v123/${publicId}.webp`;
    await db.insert(schema.serviceSchema).values({ id: 'other_shared_svc', salonId: 'other_image_salon', name: 'Other service', price: 10, durationMinutes: 20, category: 'manicure', imageUrl: sharedUrl });
    await softDelete();
    const response = await DELETE(deleteRequest({ hard: true, body: { confirmSlug: SLUG } }), { params });

    expect(response.status).toBe(202);
    expect((await response.json()).cleanup).toMatchObject({ status: 'review_required', mediaRemoved: 0, reviewRequired: 1 });

    const [otherService] = await db.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, 'other_shared_svc'));

    expect(otherService?.imageUrl).toBe(sharedUrl);
  });

  it('keeps unknown image ownership under review after DB deletion and recovers a lost response', async () => {
    await db.update(schema.salonSchema).set({ logoUrl: 'https://external.example.test/image.jpg' }).where(eq(schema.salonSchema.id, SALON));
    await softDelete();
    const response = await DELETE(deleteRequest({ hard: true, body: { confirmSlug: SLUG } }), { params });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({ success: false, cleanup: { databaseDeleted: true, status: 'review_required', reviewRequired: 1 } });
    expect((await counts()).salons).toBe(0);
    expect(mediaCleanup).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain('external.example.test');

    const repeat = await DELETE(deleteRequest({ hard: true, body: { confirmSlug: SLUG } }), { params });

    expect(repeat.status).toBe(202);
    expect((await repeat.json()).cleanup.jobId).toBe(body.cleanup.jobId);

    const wrong = await DELETE(deleteRequest({ hard: true, body: { confirmSlug: 'other' } }), { params });

    expect(wrong.status).toBe(404);

    const list = await cleanupList();

    expect((await list.json()).jobs).toHaveLength(1);
  });

  it('preserves failed assets, redacts errors, respects backoff and completes on scheduled retry', async () => {
    const id = await seedJob();
    mediaCleanup.mockRejectedValueOnce(new Error('private provider token and key'));
    const first = await runSalonDeletionCleanup(id);

    expect(first).toMatchObject({ status: 'pending', mediaRemoved: 0, mediaRemaining: 1, attempts: 1 });
    expect(JSON.stringify(first)).not.toContain('private provider');
    expect(JSON.stringify(first)).not.toContain(key);

    const [pending] = await db.select().from(schema.salonDeletionCleanupSchema);

    expect(pending?.pendingAssets).toEqual([{ kind: 'onboarding', key }]);

    await runSalonDeletionCleanup(id);

    expect(mediaCleanup).toHaveBeenCalledTimes(1);

    await makeDue(id);

    expect(await cleanupPendingSalonDeletions()).toEqual({ checked: 1, completed: 1, pending: 0 });

    const [done] = await db.select().from(schema.salonDeletionCleanupSchema);

    expect(done).toMatchObject({ pendingAssets: [], mediaRemoved: 1, attempts: 2 });
    expect(done?.completedAt).toBeInstanceOf(Date);
  });

  it('rolls back recovery state and tenant deletion together if the purge fails', async () => {
    await client.exec('CREATE TABLE deletion_test_blocker (salon_id text REFERENCES salon(id) ON DELETE RESTRICT)');
    await client.query('INSERT INTO deletion_test_blocker VALUES ($1)', [SALON]);
    await softDelete();
    const response = await DELETE(deleteRequest({ hard: true, body: { confirmSlug: SLUG } }), { params });

    expect(response.status).toBe(409);
    expect((await counts()).salons).toBe(1);
    expect(await db.select().from(schema.salonDeletionCleanupSchema)).toHaveLength(0);
    expect(mediaCleanup).not.toHaveBeenCalled();
  });

  it('recovers if provider removal succeeds but the status checkpoint fails', async () => {
    const id = await seedJob();
    await client.exec(`CREATE FUNCTION reject_cleanup_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.media_removed > OLD.media_removed THEN RAISE EXCEPTION 'checkpoint unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_cleanup_checkpoint BEFORE UPDATE ON salon_deletion_cleanup FOR EACH ROW EXECUTE FUNCTION reject_cleanup_checkpoint();`);

    await expect(runSalonDeletionCleanup(id)).rejects.toThrow();

    const [pending] = await db.select().from(schema.salonDeletionCleanupSchema);

    expect(pending?.pendingAssets).toHaveLength(1);
    expect(mediaCleanup).toHaveBeenCalledTimes(1);

    await client.exec('DROP TRIGGER reject_cleanup_checkpoint ON salon_deletion_cleanup');
    await makeDue(id);

    expect(await runSalonDeletionCleanup(id)).toMatchObject({ status: 'completed', mediaRemoved: 1 });
    // The provider adapter treats "not found" as success on this second call.
    expect(mediaCleanup).toHaveBeenCalledTimes(2);
  });

  it('fences stale workers instead of overwriting a newer lease', async () => {
    const id = await seedJob();
    mediaCleanup.mockImplementationOnce(async () => {
      await db.update(schema.salonDeletionCleanupSchema).set({ leaseToken: 'newer-worker' }).where(eq(schema.salonDeletionCleanupSchema.id, id));
    });

    expect(await runSalonDeletionCleanup(id)).toMatchObject({ status: 'pending', mediaRemoved: 0 });

    const [row] = await db.select().from(schema.salonDeletionCleanupSchema);

    expect(row?.leaseToken).toBe('newer-worker');
    expect(row?.pendingAssets).toHaveLength(1);
  });

  it('leases a job only once when two workers race', async () => {
    const id = await seedJob();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    mediaCleanup.mockImplementationOnce(async () => wait);
    const first = runSalonDeletionCleanup(id);
    await vi.waitFor(() => expect(mediaCleanup).toHaveBeenCalledOnce());
    const second = await runSalonDeletionCleanup(id);

    expect(second).toMatchObject({ status: 'pending', attempts: 1 });
    expect(mediaCleanup).toHaveBeenCalledOnce();

    release();

    expect(await first).toMatchObject({ status: 'completed', attempts: 1 });
  });

  it('checkpoints partial success and retries only the unfinished key', async () => {
    const id = await seedJob();
    const secondKey = key.replace('/gallery/', '/logo/');
    await db.update(schema.salonDeletionCleanupSchema).set({ mediaTotal: 2, pendingAssets: [{ kind: 'onboarding', key }, { kind: 'onboarding', key: secondKey }] }).where(eq(schema.salonDeletionCleanupSchema.id, id));
    mediaCleanup.mockRejectedValueOnce(new Error('temporary failure'));

    expect(await runSalonDeletionCleanup(id)).toMatchObject({ status: 'pending', mediaRemoved: 1, mediaRemaining: 1 });

    const [row] = await db.select().from(schema.salonDeletionCleanupSchema);

    expect(row?.pendingAssets).toEqual([{ kind: 'onboarding', key }]);

    await makeDue(id);

    expect(await runSalonDeletionCleanup(id)).toMatchObject({ status: 'completed', mediaRemoved: 2 });
    expect(mediaCleanup.mock.calls.map(([storageKey]) => storageKey)).toEqual([key, secondKey, key]);
  });

  it('requires super-admin authorization for status, retries and pending-job listing', async () => {
    const id = await seedJob();
    superAdmin.guard = Response.json({ error: 'Forbidden' }, { status: 403 });
    for (const handler of [cleanupGET, cleanupPOST]) {
      const response = await handler(new Request(`http://localhost/api/super-admin/deletion-cleanup/${id}`), { params: Promise.resolve({ id }) });

      expect(response.status).toBe(403);
    }

    expect((await cleanupList()).status).toBe(403);
    expect(mediaCleanup).not.toHaveBeenCalled();

    superAdmin.guard = null;
    const url = `http://localhost/api/super-admin/deletion-cleanup/${id}`;
    const blocked = await cleanupPOST(new Request(url, { method: 'POST', headers: { origin: 'https://other.example.test' } }), { params: Promise.resolve({ id }) });

    expect(blocked.status).toBe(403);
    expect(mediaCleanup).not.toHaveBeenCalled();

    const allowed = await cleanupPOST(new Request(url, { method: 'POST', headers: { origin: 'http://localhost' } }), { params: Promise.resolve({ id }) });

    expect(allowed.status).toBe(200);
    expect(mediaCleanup).toHaveBeenCalledOnce();
  });
});
