import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const media = vi.hoisted(() => ({
  deleted: vi.fn(async () => undefined),
  read: vi.fn(async (storageKey: string) => Buffer.from(`bytes:${storageKey}`)),
  save: vi.fn(async ({ mediaId, role }: { mediaId: string; role: string }) => ({
    publicUrl: `https://images.example/${role}/${mediaId}.webp`,
    storageKey: `canonical/${role}/${mediaId}`,
    storageProvider: 'cloudinary' as const,
  })),
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));
vi.mock('@/features/onboarding-v1-integration/media-storage.server', () => ({
  readOnboardingMediaFile: media.read,
}));
vi.mock('@/features/onboarding-v1-integration/canonical-profile-media.server', () => ({
  CanonicalOnboardingProfileMediaError: class CanonicalOnboardingProfileMediaError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  deleteCanonicalOnboardingProfileMedia: media.deleted,
  saveCanonicalOnboardingProfileMedia: media.save,
}));

/* eslint-disable import/first */
import { synchronizeBookingPageLifecycle } from '../../libs/bookingPageLifecycle';
import {
  applyPreparedCanonicalProfileMediaPromotion,
  completeCanonicalProfileMediaPromotion,
  discardPreparedCanonicalProfileMediaPromotion,
  prepareCanonicalProfileMediaForPublish,
} from './canonical-profile-media-lifecycle.server';
/* eslint-enable import/first */

const ADMIN_ID = 'admin_canonical_media_lifecycle';

let client: PGlite;
let database: PgliteDatabase<typeof schema>;

const snapshot = (logoItemId: string | null, profilePhotoItemId: string | null) => ({
  profile: { logoItemId, profilePhotoItemId },
});

async function seedSalon(input: {
  logoItemId: string | null;
  profilePhotoItemId: string | null;
  revision?: number;
  salonId: string;
}) {
  const revision = input.revision ?? 1;
  const siteId = `site_${input.salonId}`;
  const revisionId = `revision_${input.salonId}_${revision}`;
  await database.insert(schema.salonSchema).values({
    id: input.salonId,
    name: `Salon ${input.salonId}`,
    publicationStatus: 'published',
    slug: input.salonId,
  });
  await database.insert(schema.technicianSchema).values({
    id: `technician_${input.salonId}`,
    isActive: true,
    name: 'Daniela',
    salonId: input.salonId,
  });
  await database.insert(schema.onboardingSiteSchema).values({
    createdByAdminId: ADMIN_ID,
    currentRevision: revision,
    id: siteId,
    palettePresetId: 'luster_berry',
    salonId: input.salonId,
    stylePresetId: 'modern',
  });
  await database.insert(schema.onboardingSiteRevisionSchema).values({
    createdByAdminId: ADMIN_ID,
    document: {} as never,
    documentFingerprint: `document-${revisionId}`,
    documentVersion: 1,
    id: revisionId,
    revision,
    salonId: input.salonId,
    siteId,
    snapshot: snapshot(input.logoItemId, input.profilePhotoItemId) as never,
    snapshotFingerprint: `snapshot-${revisionId}`,
    snapshotVersion: 1,
  });
  return { revisionId, siteId };
}

async function insertReadyMedia(input: {
  id: string;
  localItemId: string;
  metadata?: Record<string, string>;
  revisionId: string;
  role: 'logo' | 'profile';
  salonId: string;
  siteId: string;
}) {
  await database.insert(schema.onboardingSiteMediaSchema).values({
    claimStatus: 'ready',
    fileName: `${input.role}.webp`,
    height: 100,
    id: input.id,
    localItemId: input.localItemId,
    metadata: input.metadata ?? {},
    mimeType: 'image/webp',
    publicUrl: `/api/onboarding/v1/media/${input.id}`,
    revisionId: input.revisionId,
    role: input.role,
    salonId: input.salonId,
    siteId: input.siteId,
    sortOrder: 0,
    storageKey: `private/${input.id}.webp`,
    storageProvider: 'development_local',
    width: 100,
  });
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = database;
  await database.insert(schema.adminUserSchema).values({
    email: 'canonical-media@example.test',
    id: ADMIN_ID,
    name: 'Canonical Media Owner',
  });
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  await client.close();
});

describe('canonical profile media draft-to-live lifecycle', () => {
  it('promotes the latest saved logo and profile only when Booking Page Publish runs', async () => {
    const salonId = 'canonical_media_publish';
    const { revisionId, siteId } = await seedSalon({
      logoItemId: 'logo-current',
      profilePhotoItemId: 'profile-current',
      salonId,
    });
    await insertReadyMedia({
      id: 'media-logo-current',
      localItemId: 'logo-current',
      revisionId,
      role: 'logo',
      salonId,
      siteId,
    });
    await insertReadyMedia({
      id: 'media-profile-current',
      localItemId: 'profile-current',
      revisionId,
      role: 'profile',
      salonId,
      siteId,
    });

    await synchronizeBookingPageLifecycle(salonId, 'publish');

    const [salon] = await database.select({ logoUrl: schema.salonSchema.logoUrl })
      .from(schema.salonSchema).where(eq(schema.salonSchema.id, salonId));
    const [technician] = await database.select({ avatarUrl: schema.technicianSchema.avatarUrl })
      .from(schema.technicianSchema)
      .where(eq(schema.technicianSchema.id, `technician_${salonId}`));

    expect(salon?.logoUrl).toBe('https://images.example/logo/media-logo-current.webp');
    expect(technician?.avatarUrl)
      .toBe('https://images.example/profile/media-profile-current.webp');
    expect(media.save).toHaveBeenCalledTimes(2);
  });

  it('clears only prior onboarding-managed identity roles when the latest draft removes them', async () => {
    const salonId = 'canonical_media_remove';
    const oldLogo = {
      publicUrl: 'https://images.example/logo/old-logo.webp',
      storageKey: 'canonical/logo/old-logo',
      storageProvider: 'cloudinary',
    } as const;
    const oldProfile = {
      publicUrl: 'https://images.example/profile/old-profile.webp',
      storageKey: 'canonical/profile/old-profile',
      storageProvider: 'cloudinary',
    } as const;
    const { revisionId, siteId } = await seedSalon({
      logoItemId: null,
      profilePhotoItemId: null,
      revision: 2,
      salonId,
    });
    await database.update(schema.salonSchema).set({ logoUrl: oldLogo.publicUrl })
      .where(eq(schema.salonSchema.id, salonId));
    await database.update(schema.technicianSchema).set({ avatarUrl: oldProfile.publicUrl })
      .where(eq(schema.technicianSchema.id, `technician_${salonId}`));
    const oldRevisionId = `revision_${salonId}_1`;
    await database.insert(schema.onboardingSiteRevisionSchema).values({
      createdByAdminId: ADMIN_ID,
      document: {} as never,
      documentFingerprint: `document-${oldRevisionId}`,
      documentVersion: 1,
      id: oldRevisionId,
      revision: 1,
      salonId,
      siteId,
      snapshot: snapshot('old-logo', 'old-profile') as never,
      snapshotFingerprint: `snapshot-${oldRevisionId}`,
      snapshotVersion: 1,
    });
    await insertReadyMedia({
      id: 'media-old-logo',
      localItemId: 'old-logo',
      metadata: {
        canonicalPublicUrl: oldLogo.publicUrl,
        canonicalStorageKey: oldLogo.storageKey,
        canonicalStorageProvider: oldLogo.storageProvider,
      },
      revisionId: oldRevisionId,
      role: 'logo',
      salonId,
      siteId,
    });
    await insertReadyMedia({
      id: 'media-old-profile',
      localItemId: 'old-profile',
      metadata: {
        canonicalPublicUrl: oldProfile.publicUrl,
        canonicalStorageKey: oldProfile.storageKey,
        canonicalStorageProvider: oldProfile.storageProvider,
      },
      revisionId: oldRevisionId,
      role: 'profile',
      salonId,
      siteId,
    });

    expect(revisionId).toBe(`revision_${salonId}_2`);

    await synchronizeBookingPageLifecycle(salonId, 'publish');

    const [salon] = await database.select({ logoUrl: schema.salonSchema.logoUrl })
      .from(schema.salonSchema).where(eq(schema.salonSchema.id, salonId));
    const [technician] = await database.select({ avatarUrl: schema.technicianSchema.avatarUrl })
      .from(schema.technicianSchema)
      .where(eq(schema.technicianSchema.id, `technician_${salonId}`));

    expect(salon?.logoUrl).toBeNull();
    expect(technician?.avatarUrl).toBeNull();
    expect(media.deleted).toHaveBeenCalledWith(oldLogo);
    expect(media.deleted).toHaveBeenCalledWith(oldProfile);
  });

  it('preserves unmanaged canonical roles when a new onboarding draft merely omits them', async () => {
    const salonId = 'canonical_media_remove_unmanaged';
    await seedSalon({
      logoItemId: null,
      profilePhotoItemId: null,
      salonId,
    });
    await database.update(schema.salonSchema).set({
      logoUrl: 'https://legacy.example/logo.webp',
    }).where(eq(schema.salonSchema.id, salonId));
    await database.update(schema.technicianSchema).set({
      avatarUrl: 'https://legacy.example/profile.webp',
    }).where(eq(schema.technicianSchema.id, `technician_${salonId}`));

    await synchronizeBookingPageLifecycle(salonId, 'publish');

    const [salon] = await database.select({ logoUrl: schema.salonSchema.logoUrl })
      .from(schema.salonSchema).where(eq(schema.salonSchema.id, salonId));
    const [technician] = await database.select({ avatarUrl: schema.technicianSchema.avatarUrl })
      .from(schema.technicianSchema)
      .where(eq(schema.technicianSchema.id, `technician_${salonId}`));

    expect(salon?.logoUrl).toBe('https://legacy.example/logo.webp');
    expect(technician?.avatarUrl).toBe('https://legacy.example/profile.webp');
    expect(media.deleted).not.toHaveBeenCalled();
  });

  it('does not clear a manual identity replacement that wins after publish preparation', async () => {
    const salonId = 'canonical_media_publish_manual_race';
    const oldLogo = {
      publicUrl: 'https://images.example/logo/publish-race.webp',
      storageKey: 'canonical/logo/publish-race',
      storageProvider: 'cloudinary',
    } as const;
    const oldProfile = {
      publicUrl: 'https://images.example/profile/publish-race.webp',
      storageKey: 'canonical/profile/publish-race',
      storageProvider: 'cloudinary',
    } as const;
    const manualLogoUrl = 'https://manual.example/logo.webp';
    const manualProfileUrl = 'https://manual.example/profile.webp';
    const { siteId } = await seedSalon({
      logoItemId: null,
      profilePhotoItemId: null,
      revision: 2,
      salonId,
    });
    const oldRevisionId = `revision_${salonId}_1`;
    await database.insert(schema.onboardingSiteRevisionSchema).values({
      createdByAdminId: ADMIN_ID,
      document: {} as never,
      documentFingerprint: `document-${oldRevisionId}`,
      documentVersion: 1,
      id: oldRevisionId,
      revision: 1,
      salonId,
      siteId,
      snapshot: snapshot('old-logo', 'old-profile') as never,
      snapshotFingerprint: `snapshot-${oldRevisionId}`,
      snapshotVersion: 1,
    });
    await insertReadyMedia({
      id: 'media-publish-race-logo',
      localItemId: 'old-logo',
      metadata: {
        canonicalPublicUrl: oldLogo.publicUrl,
        canonicalStorageKey: oldLogo.storageKey,
        canonicalStorageProvider: oldLogo.storageProvider,
      },
      revisionId: oldRevisionId,
      role: 'logo',
      salonId,
      siteId,
    });
    await insertReadyMedia({
      id: 'media-publish-race-profile',
      localItemId: 'old-profile',
      metadata: {
        canonicalPublicUrl: oldProfile.publicUrl,
        canonicalStorageKey: oldProfile.storageKey,
        canonicalStorageProvider: oldProfile.storageProvider,
      },
      revisionId: oldRevisionId,
      role: 'profile',
      salonId,
      siteId,
    });
    await database.update(schema.salonSchema).set({ logoUrl: oldLogo.publicUrl })
      .where(eq(schema.salonSchema.id, salonId));
    await database.update(schema.technicianSchema).set({ avatarUrl: oldProfile.publicUrl })
      .where(eq(schema.technicianSchema.id, `technician_${salonId}`));

    const prepared = await prepareCanonicalProfileMediaForPublish(salonId);

    expect(prepared).not.toBeNull();

    // Simulate a manual Product edit after the publish projection was prepared.
    await database.update(schema.salonSchema).set({ logoUrl: manualLogoUrl })
      .where(eq(schema.salonSchema.id, salonId));
    await database.update(schema.technicianSchema).set({ avatarUrl: manualProfileUrl })
      .where(eq(schema.technicianSchema.id, `technician_${salonId}`));

    await database.transaction(tx =>
      applyPreparedCanonicalProfileMediaPromotion(tx, prepared!));
    await completeCanonicalProfileMediaPromotion(prepared!);

    const [salon] = await database.select({ logoUrl: schema.salonSchema.logoUrl })
      .from(schema.salonSchema).where(eq(schema.salonSchema.id, salonId));
    const [technician] = await database.select({ avatarUrl: schema.technicianSchema.avatarUrl })
      .from(schema.technicianSchema)
      .where(eq(schema.technicianSchema.id, `technician_${salonId}`));

    expect(salon?.logoUrl).toBe(manualLogoUrl);
    expect(technician?.avatarUrl).toBe(manualProfileUrl);
  });

  it('does not treat pending or failed historical rows as published ownership', async () => {
    const salonId = 'canonical_media_publish_unready_history';
    const pendingUrl = 'https://images.example/logo/pending.webp';
    const failedUrl = 'https://images.example/profile/failed.webp';
    const { siteId } = await seedSalon({
      logoItemId: null,
      profilePhotoItemId: null,
      revision: 2,
      salonId,
    });
    const oldRevisionId = `revision_${salonId}_1`;
    await database.insert(schema.onboardingSiteRevisionSchema).values({
      createdByAdminId: ADMIN_ID,
      document: {} as never,
      documentFingerprint: `document-${oldRevisionId}`,
      documentVersion: 1,
      id: oldRevisionId,
      revision: 1,
      salonId,
      siteId,
      snapshot: snapshot('pending-logo', 'failed-profile') as never,
      snapshotFingerprint: `snapshot-${oldRevisionId}`,
      snapshotVersion: 1,
    });
    await insertReadyMedia({
      id: 'media-pending-history-logo',
      localItemId: 'pending-logo',
      metadata: {
        canonicalPublicUrl: pendingUrl,
        canonicalStorageKey: 'canonical/logo/pending',
        canonicalStorageProvider: 'cloudinary',
      },
      revisionId: oldRevisionId,
      role: 'logo',
      salonId,
      siteId,
    });
    await insertReadyMedia({
      id: 'media-failed-history-profile',
      localItemId: 'failed-profile',
      metadata: {
        canonicalPublicUrl: failedUrl,
        canonicalStorageKey: 'canonical/profile/failed',
        canonicalStorageProvider: 'cloudinary',
      },
      revisionId: oldRevisionId,
      role: 'profile',
      salonId,
      siteId,
    });
    await database.update(schema.onboardingSiteMediaSchema).set({ claimStatus: 'pending' })
      .where(eq(schema.onboardingSiteMediaSchema.id, 'media-pending-history-logo'));
    await database.update(schema.onboardingSiteMediaSchema).set({ claimStatus: 'failed' })
      .where(eq(schema.onboardingSiteMediaSchema.id, 'media-failed-history-profile'));
    await database.update(schema.salonSchema).set({ logoUrl: pendingUrl })
      .where(eq(schema.salonSchema.id, salonId));
    await database.update(schema.technicianSchema).set({ avatarUrl: failedUrl })
      .where(eq(schema.technicianSchema.id, `technician_${salonId}`));

    await synchronizeBookingPageLifecycle(salonId, 'publish');

    const [salon] = await database.select({ logoUrl: schema.salonSchema.logoUrl })
      .from(schema.salonSchema).where(eq(schema.salonSchema.id, salonId));
    const [technician] = await database.select({ avatarUrl: schema.technicianSchema.avatarUrl })
      .from(schema.technicianSchema)
      .where(eq(schema.technicianSchema.id, `technician_${salonId}`));

    expect(salon?.logoUrl).toBe(pendingUrl);
    expect(technician?.avatarUrl).toBe(failedUrl);
    expect(media.deleted).not.toHaveBeenCalled();
  });

  it('rejects a prepared old revision after a newer replacement wins and deletes only the stale projection', async () => {
    const salonId = 'canonical_media_stale_revision';
    const { revisionId, siteId } = await seedSalon({
      logoItemId: 'logo-old',
      profilePhotoItemId: null,
      salonId,
    });
    await insertReadyMedia({
      id: 'media-logo-old',
      localItemId: 'logo-old',
      revisionId,
      role: 'logo',
      salonId,
      siteId,
    });
    const prepared = await prepareCanonicalProfileMediaForPublish(salonId);

    expect(prepared).not.toBeNull();

    const nextRevisionId = `revision_${salonId}_2`;
    await database.insert(schema.onboardingSiteRevisionSchema).values({
      createdByAdminId: ADMIN_ID,
      document: {} as never,
      documentFingerprint: `document-${nextRevisionId}`,
      documentVersion: 1,
      id: nextRevisionId,
      revision: 2,
      salonId,
      siteId,
      snapshot: snapshot('logo-new', null) as never,
      snapshotFingerprint: `snapshot-${nextRevisionId}`,
      snapshotVersion: 1,
    });
    await database.update(schema.onboardingSiteSchema).set({ currentRevision: 2 })
      .where(eq(schema.onboardingSiteSchema.id, siteId));

    await expect(database.transaction(tx =>
      applyPreparedCanonicalProfileMediaPromotion(tx, prepared!)))
      .rejects.toMatchObject({ code: 'CANONICAL_MEDIA_REVISION_STALE' });

    await discardPreparedCanonicalProfileMediaPromotion(prepared!);

    const [salon] = await database.select({ logoUrl: schema.salonSchema.logoUrl })
      .from(schema.salonSchema).where(eq(schema.salonSchema.id, salonId));

    expect(salon?.logoUrl).toBeNull();
    expect(media.deleted).toHaveBeenCalledWith({
      publicUrl: 'https://images.example/logo/media-logo-old.webp',
      storageKey: 'canonical/logo/media-logo-old',
      storageProvider: 'cloudinary',
    });
  });
});
