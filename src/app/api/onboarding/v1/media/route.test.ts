import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  authenticated: true,
  authorized: null as null | {
    adminId: string;
    revision: number;
    revisionId: string;
    salonId: string;
    siteId: string;
  },
  db: null as unknown,
}));
const storage = vi.hoisted(() => ({
  deleteFile: vi.fn(async () => undefined),
  readFile: vi.fn(async () => Buffer.from('saved-image')),
  saveFile: vi.fn(async ({ uploadAttemptId }: { uploadAttemptId: string }) => ({
    byteSize: 321,
    height: 40,
    mimeType: 'image/webp' as const,
    storageKey: `salon/site/logo/${uploadAttemptId}.webp`,
    width: 80,
  })),
}));
const authorization = vi.hoisted(() => ({
  authorize: vi.fn(async () => holder.authorized),
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));
vi.mock('@/libs/adminAuth', () => ({
  getAdminSession: vi.fn(async () => holder.authenticated ? { id: 'admin_media_route' } : null),
}));
vi.mock('@/features/onboarding-v1-integration/media-authorization.server', () => ({
  authorizeOnboardingSite: authorization.authorize,
}));
vi.mock('@/features/onboarding-v1-integration/config.server', () => ({
  isOnboardingV1IntegrationEnabled: () => true,
}));
vi.mock('@/features/onboarding-v1-integration/media-storage.server', () => ({
  deleteOnboardingMediaFile: storage.deleteFile,
  OnboardingMediaStorageError: class OnboardingMediaStorageError extends Error {},
  readOnboardingMediaFile: storage.readFile,
  saveOnboardingMediaFile: storage.saveFile,
}));

/* eslint-disable import/first */
import { GET } from './[mediaId]/route';
import { POST } from './route';
import { POST as VERIFY } from './verify/route';
/* eslint-enable import/first */

const ADMIN_ID = 'admin_media_route';
const MEDIA_ID = '44444444-4444-4444-8444-444444444444';
const REVISION_ID = '33333333-3333-4333-8333-333333333333';
const SALON_ID = 'salon_media_route';
const SITE_ID = '22222222-2222-4222-8222-222222222222';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const uploadRequest = ({ localItemId = 'logo-item' } = {}) => {
  const form = new FormData();
  form.set('altText', 'Isla Nail Studio logo');
  form.set('draftId', 'draft_123456789012345678901234567890');
  form.set('file', new File(['image'], 'logo.png', { type: 'image/png' }));
  form.set('fileName', 'logo.png');
  form.set('idempotencyKey', 'claim_123456789012345678901234567890:logo-item:logo:0');
  form.set('localItemId', localItemId);
  form.set('mimeType', 'image/png');
  form.set('order', '0');
  form.set('role', 'logo');
  form.set('siteId', SITE_ID);
  form.set('siteRevision', '1');
  return new Request('http://localhost/api/onboarding/v1/media', {
    body: form,
    method: 'POST',
  });
};

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await client.query(
    `INSERT INTO admin_user (id, name, email) VALUES ('${ADMIN_ID}', 'Daniela', 'daniela-media@example.test')`,
  );
  await client.query(
    `INSERT INTO salon (id, name, slug) VALUES ('${SALON_ID}', 'Isla Nail Studio', 'isla-media-route')`,
  );
  await client.query(`
    INSERT INTO onboarding_site
      (id, salon_id, created_by_admin_id, current_revision, style_preset_id, palette_preset_id)
    VALUES
      ('${SITE_ID}', '${SALON_ID}', '${ADMIN_ID}', 1, 'modern', 'luster_berry')
  `);
  await client.query(`
    INSERT INTO onboarding_site_revision
      (id, salon_id, site_id, revision, created_by_admin_id, snapshot_version, snapshot,
       snapshot_fingerprint, document_version, document, document_fingerprint)
    VALUES
      ('${REVISION_ID}', '${SALON_ID}', '${SITE_ID}', 1, '${ADMIN_ID}', 1, '{}',
       'snapshot-fingerprint', 1, '{}', 'document-fingerprint')
  `);
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  holder.authenticated = true;
  holder.authorized = {
    adminId: ADMIN_ID,
    revision: 1,
    revisionId: REVISION_ID,
    salonId: SALON_ID,
    siteId: SITE_ID,
  };
  await db.delete(schema.onboardingSiteMediaSchema);
  await db.insert(schema.onboardingSiteMediaSchema).values({
    fileName: 'logo.png',
    id: MEDIA_ID,
    localItemId: 'logo-item',
    mimeType: 'image/png',
    revisionId: REVISION_ID,
    role: 'logo',
    salonId: SALON_ID,
    siteId: SITE_ID,
    sortOrder: 0,
  });
});

afterAll(async () => {
  await client.close();
});

describe('POST /api/onboarding/v1/media', () => {
  it('claims only a declared role-owned item and records a server reference', async () => {
    const response = await POST(uploadRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.media).toMatchObject({
      height: 40,
      id: MEDIA_ID,
      role: 'logo',
      url: `/api/onboarding/v1/media/${MEDIA_ID}`,
      width: 80,
    });

    const [row] = await db
      .select()
      .from(schema.onboardingSiteMediaSchema)
      .where(eq(schema.onboardingSiteMediaSchema.id, MEDIA_ID));

    expect(row).toMatchObject({
      claimStatus: 'ready',
      storageProvider: 'development_local',
      uploadLeaseId: null,
    });
    expect(row?.storageKey).toMatch(/^salon\/site\/logo\/[a-f0-9-]+\.webp$/);
    expect(authorization.authorize).toHaveBeenCalledWith(SITE_ID, { ownerOnly: true });
  });

  it('is idempotent after the declared media row is ready', async () => {
    expect((await POST(uploadRequest())).status).toBe(200);
    expect((await POST(uploadRequest())).status).toBe(200);
    expect(storage.saveFile).toHaveBeenCalledOnce();
  });

  it('recovers an abandoned upload lease without racing a current upload', async () => {
    await db.delete(schema.onboardingSiteMediaSchema);
    await db.insert(schema.onboardingSiteMediaSchema).values({
      claimStatus: 'uploading',
      fileName: 'logo.png',
      id: MEDIA_ID,
      localItemId: 'logo-item',
      mimeType: 'image/png',
      revisionId: REVISION_ID,
      role: 'logo',
      salonId: SALON_ID,
      siteId: SITE_ID,
      sortOrder: 0,
      uploadLeaseId: 'abandoned-upload-lease',
      updatedAt: new Date(Date.now() - (3 * 60 * 1_000)),
    });

    const response = await POST(uploadRequest());

    expect(response.status).toBe(200);
    expect(storage.saveFile).toHaveBeenCalledOnce();
  });

  it('lets a reclaimed lease win without the stale request deleting the winner bytes', async () => {
    let releaseFirst!: () => void;
    let reportFirstStarted!: () => void;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      reportFirstStarted = resolve;
    });
    const attemptedLeaseIds: string[] = [];

    storage.saveFile
      .mockImplementationOnce(async ({ uploadAttemptId }: { uploadAttemptId: string }) => {
        attemptedLeaseIds.push(uploadAttemptId);
        reportFirstStarted();
        await firstReleased;
        return {
          byteSize: 321,
          height: 40,
          mimeType: 'image/webp' as const,
          storageKey: `salon/site/logo/${uploadAttemptId}.webp`,
          width: 80,
        };
      })
      .mockImplementationOnce(async ({ uploadAttemptId }: { uploadAttemptId: string }) => {
        attemptedLeaseIds.push(uploadAttemptId);
        return {
          byteSize: 654,
          height: 50,
          mimeType: 'image/webp' as const,
          storageKey: `salon/site/logo/${uploadAttemptId}.webp`,
          width: 100,
        };
      });

    const firstResponsePromise = POST(uploadRequest());
    await firstStarted;

    const realNow = Date.now();
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(realNow + (3 * 60 * 1_000));
    const winningResponse = await POST(uploadRequest());
    dateNow.mockRestore();

    expect(winningResponse.status).toBe(200);

    releaseFirst();
    const staleResponse = await firstResponsePromise;

    expect(staleResponse.status).toBe(409);
    expect(attemptedLeaseIds).toHaveLength(2);
    expect(attemptedLeaseIds[0]).not.toBe(attemptedLeaseIds[1]);

    const losingKey = `salon/site/logo/${attemptedLeaseIds[0]}.webp`;
    const winningKey = `salon/site/logo/${attemptedLeaseIds[1]}.webp`;

    expect(storage.deleteFile).toHaveBeenCalledOnce();
    expect(storage.deleteFile).toHaveBeenCalledWith(losingKey);
    expect(storage.deleteFile).not.toHaveBeenCalledWith(winningKey);

    const [row] = await db
      .select()
      .from(schema.onboardingSiteMediaSchema)
      .where(eq(schema.onboardingSiteMediaSchema.id, MEDIA_ID));

    expect(row).toMatchObject({
      claimStatus: 'ready',
      height: 50,
      storageKey: winningKey,
      uploadLeaseId: null,
      width: 100,
    });
  });

  it('rejects an undeclared local item without storing bytes', async () => {
    const response = await POST(uploadRequest({ localItemId: 'not-declared' }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'MEDIA_NOT_DECLARED' },
    });
    expect(storage.saveFile).not.toHaveBeenCalled();
  });

  it('fails closed when site ownership cannot be resolved', async () => {
    holder.authorized = null;
    const response = await POST(uploadRequest());

    expect(response.status).toBe(404);
    expect(storage.saveFile).not.toHaveBeenCalled();
  });

  it('authenticates and rejects an oversized body before parsing multipart data', async () => {
    holder.authenticated = false;
    const anonymous = new Request('http://localhost/api/onboarding/v1/media', {
      body: 'not-multipart',
      headers: { 'Content-Length': String(20 * 1024 * 1024) },
      method: 'POST',
    });

    expect((await POST(anonymous)).status).toBe(401);

    holder.authenticated = true;
    const oversized = new Request('http://localhost/api/onboarding/v1/media', {
      body: 'not-multipart',
      headers: { 'Content-Length': String(20 * 1024 * 1024) },
      method: 'POST',
    });

    expect((await POST(oversized)).status).toBe(413);
  });

  it('serves private draft media without reusable browser caching', async () => {
    expect((await POST(uploadRequest())).status).toBe(200);

    authorization.authorize.mockClear();

    const response = await GET(
      new Request(`http://localhost/api/onboarding/v1/media/${MEDIA_ID}`),
      { params: Promise.resolve({ mediaId: MEDIA_ID }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(authorization.authorize).toHaveBeenCalledWith(SITE_ID);
  });

  it('requires owner authorization when finalizing media verification', async () => {
    expect((await POST(uploadRequest())).status).toBe(200);

    authorization.authorize.mockClear();

    const response = await VERIFY(new Request(
      'http://localhost/api/onboarding/v1/media/verify',
      {
        body: JSON.stringify({
          expected: [{
            localItemId: 'logo-item',
            order: 0,
            role: 'logo',
            serverMediaId: MEDIA_ID,
          }],
          siteId: SITE_ID,
          siteRevision: 1,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    ));

    expect(response.status).toBe(200);
    expect(authorization.authorize).toHaveBeenCalledWith(SITE_ID, { ownerOnly: true });
  });
});
