import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { onboardingArtworkAssetId, onboardingArtworkStorageKey } from '@/features/onboarding-v1-integration/artwork-storage-key';
import type { AuthorizedOnboardingSite } from '@/features/onboarding-v1-integration/media-authorization.server';
import { deleteOnboardingMediaFile, readOnboardingMediaFile } from '@/features/onboarding-v1-integration/media-storage.server';
import sharp from '@/libs/safeSharp.server';
import * as schema from '@/models/Schema';

import { openSetup } from '../business-setup/drafts.server';
import { assetDataUrl, ownedAssets, uploadOnboardingArtwork } from './assets.server';
import { compileCanvaDesign } from './canva';
import { canvaWebsiteImage } from './canva-assets.server';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/Cloudinary', () => ({ cloudinary: {}, isCloudinaryConfigured: () => false }));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
const client = new PGlite();
const database = drizzle(client, { schema });
let mediaRoot: string;

beforeAll(async () => {
  await client.waitReady;
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = database;
  mediaRoot = await mkdtemp(path.join(tmpdir(), 'luster-manual-shared-assets-'));
}, 60000);

beforeEach(() => {
  vi.stubEnv('LUSTER_ONBOARDING_MEDIA_DIR', mediaRoot);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'preview');
  vi.stubEnv('CUSTOM_SITE_PREVIEW_PRIVATE_IMAGES', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await client.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

async function fixture(): Promise<AuthorizedOnboardingSite> {
  const actor = { salonId: randomUUID(), adminId: randomUUID() };
  const site = { ...actor, siteId: randomUUID(), revisionId: randomUUID(), revision: 1 };
  await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
  await database.insert(schema.salonSchema).values({ id: actor.salonId, slug: actor.salonId, name: 'Canva Studio', publicationStatus: 'draft', onlineBookingEnabled: false });
  await database.insert(schema.adminSalonMembershipSchema).values({ ...actor, role: 'owner' });
  await database.insert(schema.onboardingSiteSchema).values({ id: site.siteId, salonId: site.salonId, createdByAdminId: site.adminId, currentRevision: 1, stylePresetId: 'modern', palettePresetId: 'luster_berry' });
  await database.insert(schema.onboardingSiteRevisionSchema).values({ id: site.revisionId, siteId: site.siteId, salonId: site.salonId, createdByAdminId: site.adminId, revision: 1, snapshotVersion: 1, snapshot: {} as any, snapshotFingerprint: 'test', documentVersion: 1, document: {} as any, documentFingerprint: 'test' });
  return site;
}
async function artwork(background = '#f6d7e4') {
  const bytes = await sharp({ create: { width: 600, height: 1400, channels: 4, background } }).png().toBuffer();
  return new File([new Uint8Array(bytes)], 'my-canva.png', { type: 'image/png' });
}
const assetsFor = (salonId: string) => database.select().from(schema.customSiteAssetSchema).where(eq(schema.customSiteAssetSchema.salonId, salonId));

it('saves exact manual artwork into the existing private library without creating a setup draft or activating anything', async () => {
  const site = await fixture();
  const before = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, site.salonId));
  const original = await artwork();
  const stored = await uploadOnboardingArtwork(site, original);

  expect(stored).toMatchObject({ storageProvider: 'custom_site_asset', width: 600, height: 1400 });

  const [asset] = await assetsFor(site.salonId);

  expect(asset).toMatchObject({ role: 'photo', actorId: site.adminId, storageKey: null, pdfBase64: null });
  expect(asset!.imageBase64).toBeTruthy();

  const bytes = await readOnboardingMediaFile(stored.storageKey, site);

  expect((await sharp(bytes).ensureAlpha().raw().toBuffer()).equals(await sharp(Buffer.from(await original.arrayBuffer())).ensureAlpha().raw().toBuffer())).toBe(true);
  expect(await database.select().from(schema.businessSetupWorkspaceSchema).where(eq(schema.businessSetupWorkspaceSchema.salonId, site.salonId))).toEqual([]);
  expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, site.salonId))).toEqual([]);
  expect(await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, site.salonId))).toEqual(before);
});

it('reuses immutable bytes after a lost response and protects them from stale-lease cleanup', async () => {
  const site = await fixture();
  const first = await uploadOnboardingArtwork(site, await artwork());
  const retry = await uploadOnboardingArtwork(site, await artwork());

  expect(retry).toEqual(first);
  expect(await assetsFor(site.salonId)).toHaveLength(1);

  await deleteOnboardingMediaFile(first.storageKey, site);

  expect(await readOnboardingMediaFile(retry.storageKey, site)).toHaveLength(first.byteSize);

  const other = await uploadOnboardingArtwork(site, await artwork('#876543'));

  expect(other.storageKey).not.toBe(first.storageKey);
  expect(await readOnboardingMediaFile(first.storageKey, site)).toHaveLength(first.byteSize);
});

it('shares manually saved artwork with later AI/manual editing without a second catalog or copy', async () => {
  const site = await fixture();
  const saved = await uploadOnboardingArtwork(site, await artwork());
  const id = onboardingArtworkAssetId(saved.storageKey, site)!;
  await openSetup(site);
  const [asset] = await ownedAssets(database as any, site.salonId, [id]);

  expect(await assetDataUrl(asset!)).toMatch(/^data:image\/webp;base64,/u);

  const reused = await canvaWebsiteImage(site, asset!);

  expect(reused.id).toBe(id);

  const source = compileCanvaDesign({ version: 1, pages: [{ assetId: reused.id, width: saved.width, height: saved.height, alt: 'My original Canva design' }], areas: [], visibleText: '', notes: [], dataFingerprint: '0'.repeat(64), ownerReviewed: false });

  expect(source.html).toContain(`asset:${id}`);
  expect(await assetsFor(site.salonId)).toHaveLength(1);
});

it('denies other salons, non-owners, forged revision IDs and stale/inactive sites before accepting bytes', async () => {
  const site = await fixture();
  const other = await fixture();

  await expect(uploadOnboardingArtwork({ ...site, adminId: other.adminId }, await artwork())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(uploadOnboardingArtwork({ ...site, revisionId: other.revisionId }, await artwork())).rejects.toMatchObject({ code: 'STALE' });
  await expect(uploadOnboardingArtwork({ ...site, revision: 2 }, await artwork())).rejects.toMatchObject({ code: 'STALE' });

  await database.update(schema.onboardingSiteSchema).set({ isCurrent: false }).where(eq(schema.onboardingSiteSchema.id, site.siteId));

  await expect(uploadOnboardingArtwork(site, await artwork())).rejects.toMatchObject({ code: 'STALE' });
  expect(await assetsFor(site.salonId)).toEqual([]);
});

it('rechecks owner permission after normalization and commits no unauthorized asset', async () => {
  const site = await fixture();
  const storage = await import('@/features/onboarding-v1-integration/media-storage.server');
  const original = storage.normalizeOnboardingImage;
  const spy = vi.spyOn(storage, 'normalizeOnboardingImage').mockImplementationOnce(async (...args) => {
    const result = await original(...args);
    await database.update(schema.adminSalonMembershipSchema).set({ role: 'staff' }).where(eq(schema.adminSalonMembershipSchema.salonId, site.salonId));
    return result;
  });
  try {
    await expect(uploadOnboardingArtwork(site, await artwork())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await assetsFor(site.salonId)).toEqual([]);
  } finally {
    spy.mockRestore();
  }
});

it('rejects cross-salon/site alias reads and never deduplicates across salons', async () => {
  const site = await fixture();
  const other = await fixture();
  const first = await uploadOnboardingArtwork(site, await artwork());
  const second = await uploadOnboardingArtwork(other, await artwork());

  expect(second.storageKey).not.toBe(first.storageKey);
  await expect(readOnboardingMediaFile(first.storageKey, other)).rejects.toMatchObject({ code: 'INVALID_MEDIA_OWNER' });
  await expect(readOnboardingMediaFile(first.storageKey, { ...site, siteId: other.siteId })).rejects.toMatchObject({ code: 'INVALID_MEDIA_OWNER' });

  const foreignId = onboardingArtworkAssetId(first.storageKey, site)!;

  await expect(readOnboardingMediaFile(onboardingArtworkStorageKey(other, foreignId), other)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(deleteOnboardingMediaFile(first.storageKey, other)).rejects.toMatchObject({ code: 'INVALID_MEDIA_OWNER' });
});

it('rejects corrupt saved bytes and allows a fresh intact retry without rewriting history', async () => {
  const site = await fixture();
  vi.stubEnv('CUSTOM_SITE_PREVIEW_PRIVATE_IMAGES', 'false');
  const first = await uploadOnboardingArtwork(site, await artwork());
  const [saved] = await assetsFor(site.salonId);

  expect(saved!.storageKey).toBeTruthy();

  const physical = path.resolve(mediaRoot, saved!.storageKey!);

  expect(physical.startsWith(`${mediaRoot}${path.sep}`)).toBe(true);

  await writeFile(physical, 'damaged');

  await expect(readOnboardingMediaFile(first.storageKey, site)).rejects.toMatchObject({ code: 'INVALID' });

  const retry = await uploadOnboardingArtwork(site, await artwork());

  expect(retry.storageKey).not.toBe(first.storageKey);
  expect(await readOnboardingMediaFile(retry.storageKey, site)).toHaveLength(retry.byteSize);
  expect(await assetsFor(site.salonId)).toHaveLength(2);
});

it.each(['production', 'development'])('does not enable private Preview storage just because the flag is set in %s', async (environment) => {
  const site = await fixture();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('APP_ENV', environment);

  await expect(uploadOnboardingArtwork(site, await artwork())).rejects.toMatchObject({ code: 'IMAGE_STORAGE_UNAVAILABLE' });
  expect(await assetsFor(site.salonId)).toEqual([]);
});

it('keeps malformed file and shared-library limits without model calls', async () => {
  const site = await fixture();

  await expect(uploadOnboardingArtwork(site, new File(['<svg/>'], 'bad.png', { type: 'image/png' }))).rejects.toMatchObject({ code: 'INVALID' });

  await database.insert(schema.customSiteAssetSchema).values(Array.from({ length: 24 }, () => ({ id: randomUUID(), salonId: site.salonId, actorId: site.adminId, role: 'photo' as const, name: 'existing', mimeType: 'image/webp', imageBase64: 'AA==', byteSize: 1, hash: '0'.repeat(64) })));

  await expect(uploadOnboardingArtwork(site, await artwork())).rejects.toMatchObject({ code: 'NOT_READY' });
  expect(await assetsFor(site.salonId)).toHaveLength(24);
});
