import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { CLOSED_HOURS } from '@/features/business-setup/contracts';
import { approveSetup, editSetup, openSetup, reviewSetup } from '@/features/business-setup/drafts.server';
import { publishSetup } from '@/features/business-setup/publish.server';
import { compileOnboardingToSiteDocument } from '@/features/onboarding-v1-integration/compiler';
import { readOnboardingMediaFile, saveOnboardingMediaFile } from '@/features/onboarding-v1-integration/media-storage.server';
import { claimOnboardingDraft } from '@/features/onboarding-v1-integration/persistence.server';
import { createPersistableOnboardingDraft } from '@/features/onboarding-v1-integration/snapshot';
import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import type { DatabaseSessionHandle } from '@/libs/DB';
import sharp from '@/libs/safeSharp.server';
import * as schema from '@/models/Schema';

import { createDefaultCustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/settings';
import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { reviewCanvaArtwork } from './artifacts.server';
import { uploadOnboardingArtwork } from './assets.server';
import { linkedOnboardingCanvaDraft } from './manual-origin.server';
import { importOnboardingCanva } from './onboarding-canva.server';
import { setupCustomSitePayload } from './payload.server';

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
  mediaRoot = await mkdtemp(path.join(tmpdir(), 'luster-manual-handoff-'));
}, 60000);

beforeEach(() => {
  vi.stubEnv('LUSTER_ONBOARDING_MEDIA_DIR', mediaRoot);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'preview');
  vi.stubEnv('CUSTOM_SITE_PREVIEW_PRIVATE_IMAGES', 'true');
  vi.stubEnv('CUSTOM_SITE_RENDER_ORIGIN', 'http://127.0.0.1:3198');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3197');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await client.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

async function fixture(legacy = false) {
  const actor = { salonId: randomUUID(), adminId: randomUUID() };
  const site = { ...actor, siteId: randomUUID(), revisionId: randomUUID(), revision: 1 };
  const serviceId = randomUUID();
  await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
  await database.insert(schema.salonSchema).values({ id: actor.salonId, slug: actor.salonId, name: 'Canva Studio', city: 'Toronto', businessHours: { ...CLOSED_HOURS, monday: { open: '09:00', close: '17:00' } }, settings: { booking: { timezone: 'America/Toronto', currency: 'CAD' } }, publicationStatus: 'draft', onlineBookingEnabled: false });
  await database.insert(schema.adminSalonMembershipSchema).values({ ...actor, role: 'owner' });
  await database.insert(schema.technicianSchema).values({ id: randomUUID(), salonId: actor.salonId, name: 'Owner', isActive: true });
  await database.insert(schema.serviceSchema).values({ id: serviceId, salonId: actor.salonId, name: 'Gel', price: 6500, durationMinutes: 60, category: 'manicure', isActive: true });
  const state = createDefaultOnboardingState();
  state.profile.businessName = 'Canva Studio';
  state.profile.ownerName = 'Owner';
  state.profile.businessStructure = 'solo';
  state.recipe.starter = 'your_design';
  state.recipe.canvaEnabled = true;
  state.canva.status = 'ready';
  state.canva.images = [{ id: 'artwork-one', storageId: 'local-artwork', fileName: 'design.webp', mimeType: 'image/webp', source: 'indexed_db', width: 600, height: 1400 }];
  const builder = initializeStarter('your_design', { siteId: site.siteId, siteName: state.profile.businessName });
  const design = createDefaultCustomDesignSettings();
  design.images = [{ id: 'artwork-one', assetId: 'local-artwork', fileName: 'design.webp', mimeType: 'image/webp', fileSize: 1000, width: 600, height: 1400, aspectRatio: 600 / 1400, altText: 'My original Canva artwork', decorative: false, interactiveAreas: [{ id: 'my-instagram', accessibleLabel: 'My Instagram', geometry: { x: 10, y: 50, width: 80, height: 5 }, semanticOrder: 0, labelConfirmed: true, validationStatus: 'valid', reviewStatus: 'approved', action: { type: 'instagram', destination: { username: 'my_studio' } } }] }];
  for (const page of builder.pages) {
    for (const section of page.sections) {
      if (section.sectionType === 'custom_design') {
        section.settings = design;
      }
    }
  }
  const { snapshot } = createPersistableOnboardingDraft(state, 'luster_berry', design, builder);
  const document = compileOnboardingToSiteDocument({ siteId: site.siteId, revision: 1, snapshot });
  await database.insert(schema.onboardingSiteSchema).values({ id: site.siteId, salonId: actor.salonId, createdByAdminId: actor.adminId, currentRevision: 1, stylePresetId: 'modern', palettePresetId: 'luster_berry' });
  await database.insert(schema.onboardingSiteRevisionSchema).values({ id: site.revisionId, siteId: site.siteId, salonId: actor.salonId, createdByAdminId: actor.adminId, revision: 1, snapshotVersion: 1, snapshot, snapshotFingerprint: 'test', documentVersion: 1, document, documentFingerprint: 'test' });
  const bytes = await sharp({ create: { width: 600, height: 1400, channels: 3, background: '#f6d7e4' } }).png().toBuffer();
  const file = new File([new Uint8Array(bytes)], 'design.png', { type: 'image/png' });
  const stored = legacy ? await saveOnboardingMediaFile({ file, role: 'custom_design', revisionId: site.revisionId, salonId: site.salonId, siteId: site.siteId, stableItemId: 'artwork-one', uploadAttemptId: randomUUID(), imagePreparation: { artwork: true, maxOutputBytes: 3750000, preserveDimensions: true } }) : await uploadOnboardingArtwork(site, file);
  await database.insert(schema.onboardingSiteMediaSchema).values({ id: randomUUID(), salonId: actor.salonId, siteId: site.siteId, revisionId: site.revisionId, role: 'custom_design', localItemId: 'artwork-one', claimStatus: 'ready', fileName: 'design.webp', mimeType: 'image/webp', width: stored.width, height: stored.height, storageProvider: stored.storageProvider, storageKey: stored.storageKey, publicUrl: '/private/design' });
  return { document, snapshot, actor, site, stored, serviceId, input: { siteId: site.siteId, expectedRevision: 1 } };
}
const records = async (salonId: string) => ({
  artifacts: await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.salonId, salonId)),
  assets: await database.select().from(schema.customSiteAssetSchema).where(eq(schema.customSiteAssetSchema.salonId, salonId)),
  revisions: await database.select().from(schema.businessSetupRevisionSchema).where(eq(schema.businessSetupRevisionSchema.salonId, salonId)),
});

it('creates the shared editable draft without touching live services, hours, publication or making AI calls', async () => {
  const { actor, input, serviceId } = await fixture();
  const [before] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));
  const services = await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId));
  const result = await importOnboardingCanva(actor, input);
  const [after] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

  expect(result.head.revision.document.website.config.customFrontendId).toBe(result.artifactId);
  expect(result.head.revision.document.services[0]!.id).toBe(serviceId);
  expect(after).toMatchObject({ name: before!.name, publicationStatus: 'draft', publishedAt: null, businessHours: before!.businessHours, onlineBookingEnabled: false });
  expect(resolveBookingPageConfig(after!.settings).live).toEqual(resolveBookingPageConfig(before!.settings).live);
  expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toEqual(services);

  const saved = await records(actor.salonId);

  expect(saved.assets).toHaveLength(1);
  expect(saved.artifacts).toHaveLength(1);
  expect(saved.artifacts[0]!.source.canva!.areas[0]!.action).toEqual({ type: 'manual_link', href: 'https://www.instagram.com/my_studio/' });
  expect(saved.artifacts[0]!.source.canva!.ownerReviewed).toBe(false);
  expect((await setupCustomSitePayload(actor.salonId, result.head.revision.document))!.data.services[0]!.priceCents).toBe(6500);
  expect(await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.salonId, actor.salonId))).toHaveLength(0);
});

it('replays a lost response and returns later manual changes without reimporting old source or duplicating records', async () => {
  const { actor, input, site } = await fixture();
  const first = await importOnboardingCanva(actor, input);
  const later = await editSetup(actor, { expectedRevision: first.head.revision.revision, operationId: randomUUID(), operations: [{ type: 'business', values: { name: 'Later draft name' } }] });
  const retry = await importOnboardingCanva(actor, input);

  expect(retry.head.revision.revision).toBe(later.revision.revision);
  expect(retry.head.revision.document.business.name).toBe('Later draft name');
  expect(retry.artifactId).toBe(first.artifactId);
  expect((await records(actor.salonId)).artifacts).toHaveLength(1);
  expect(await linkedOnboardingCanvaDraft(database, { salonId: actor.salonId, siteId: input.siteId, revisionId: site.revisionId })).toMatchObject({ revision: later.revision.revision, document: { business: { name: 'Later draft name' } } });
});

it('rejects an old onboarding editor write after handoff instead of overwriting the shared draft', async () => {
  const { actor, input, site, snapshot } = await fixture();
  const identity = { clerkUserId: `user_${actor.adminId}`, email: `${actor.adminId}@example.test`, name: 'Owner', phoneE164: null };
  await database.update(schema.adminUserSchema).set({ clerkUserId: identity.clerkUserId, email: identity.email }).where(eq(schema.adminUserSchema.id, actor.adminId));
  const imported = await importOnboardingCanva(actor, input);
  const saved = await records(actor.salonId);

  await expect(claimOnboardingDraft(identity, { anonymousDraftToken: randomUUID(), idempotencyKey: randomUUID(), media: [], snapshot, target: { mode: 'existing_business', salonId: actor.salonId, existingSiteStrategy: 'new_draft' } }, database as unknown as DatabaseSessionHandle)).rejects.toMatchObject({ code: 'WEBSITE_EDITOR_MOVED', status: 409 });
  expect(await records(actor.salonId)).toEqual(saved);
  expect(await linkedOnboardingCanvaDraft(database, { salonId: actor.salonId, siteId: site.siteId, revisionId: site.revisionId })).toMatchObject({ revision: imported.head.revision.revision });
  expect(await linkedOnboardingCanvaDraft(database, { salonId: randomUUID(), siteId: site.siteId, revisionId: site.revisionId })).toBeNull();
});

it('requires owner artwork review and exact setup approval before original publication', async () => {
  const { actor, input, serviceId } = await fixture();
  const imported = await importOnboardingCanva(actor, input);
  const unchecked = await reviewSetup(actor);

  expect(unchecked.blockers.join(' ')).toContain('Review your Canva artwork');
  await expect(approveSetup(actor, unchecked.revision, unchecked.hash)).rejects.toMatchObject({ code: 'NOT_READY' });

  await reviewCanvaArtwork(actor, { expectedRevision: imported.head.revision.revision, operationId: randomUUID() });
  const reviewed = await reviewSetup(actor);

  expect(reviewed.blockers).toEqual([]);

  const approval = await approveSetup(actor, reviewed.revision, reviewed.hash);
  const publish = { revision: reviewed.revision, approvalId: approval.id, operationId: randomUUID() };
  const first = await publishSetup(actor, publish);
  const replay = await publishSetup(actor, publish);

  expect(replay.receipt.id).toBe(first.receipt.id);

  const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

  expect(salon!.publicationStatus).toBe('published');
  expect(resolveBookingPageConfig(salon!.settings).live.customFrontendId).toBeTruthy();
  expect((await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).map(service => service.id)).toEqual([serviceId]);
});

it('rejects another salon, a revoked owner and an outdated onboarding revision', async () => {
  const first = await fixture();
  const other = await fixture();

  await expect(importOnboardingCanva(other.actor, first.input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(importOnboardingCanva(first.actor, { ...first.input, expectedRevision: 2 })).rejects.toMatchObject({ code: 'STALE' });

  await database.update(schema.adminSalonMembershipSchema).set({ role: 'staff' }).where(eq(schema.adminSalonMembershipSchema.salonId, first.actor.salonId));

  await expect(importOnboardingCanva(first.actor, first.input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await records(first.actor.salonId)).artifacts).toHaveLength(0);
});

it('rolls back the whole handoff on a concurrent canonical change and preserves the image', async () => {
  const { actor, input, stored, serviceId } = await fixture();
  await openSetup(actor);
  await database.update(schema.serviceSchema).set({ price: 7000 }).where(eq(schema.serviceSchema.id, serviceId));

  await expect(importOnboardingCanva(actor, input)).rejects.toMatchObject({ code: 'STALE' });

  const saved = await records(actor.salonId);

  expect(saved.artifacts).toHaveLength(0);
  expect(saved.revisions).toHaveLength(1);
  expect(await readOnboardingMediaFile(stored.storageKey, actor)).toHaveLength(stored.byteSize);
});

it('adopts a ready legacy private upload without reuploading or duplicating its bytes', async () => {
  const { actor, input, stored } = await fixture(true);

  expect((await records(actor.salonId)).assets).toHaveLength(0);

  await importOnboardingCanva(actor, input);
  await importOnboardingCanva(actor, input);
  const saved = await records(actor.salonId);

  expect(saved.assets).toHaveLength(1);
  expect(saved.assets[0]!.storageKey).toBe(stored.storageKey);
  expect(saved.assets[0]!.imageBase64).toBeNull();
  expect(await readOnboardingMediaFile(stored.storageKey, actor)).toHaveLength(stored.byteSize);
});
