import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { CLOSED_HOURS } from '@/features/business-setup/contracts';
import { recoverNativePhotoConversation, runSetupConversation } from '@/features/business-setup/conversation.server';
import * as setupDrafts from '@/features/business-setup/drafts.server';
import { approveSetup, editSetup, openSetup, reviewSetup } from '@/features/business-setup/drafts.server';
import { publishSetup } from '@/features/business-setup/publish.server';
import { compileOnboardingToSiteDocument } from '@/features/onboarding-v1-integration/compiler';
import { readOnboardingMediaFile, saveOnboardingMediaFile } from '@/features/onboarding-v1-integration/media-storage.server';
import * as onboardingStorage from '@/features/onboarding-v1-integration/media-storage.server';
import { claimOnboardingDraft } from '@/features/onboarding-v1-integration/persistence.server';
import { createPersistableOnboardingDraft } from '@/features/onboarding-v1-integration/snapshot';
import type { ModelProviderRequest } from '@/libs/ai/provider';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig.shared';
import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import type { DatabaseSessionHandle } from '@/libs/DB';
import sharp from '@/libs/safeSharp.server';
import * as schema from '@/models/Schema';

import { createDefaultCustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/settings';
import { addSection } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/operations';
import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { reviewCanvaArtwork, saveCustomSource } from './artifacts.server';
import { assetDataUrl, uploadCustomAsset, uploadOnboardingArtwork } from './assets.server';
import * as customAssetStorage from './assets.server';
import { compileCanvaDesign } from './canva';
import { canvaDataFingerprint, canvaPriceLabelsFingerprint } from './canva-data.server';
import { generateCanvaSource } from './canva-generate.server';
import { canvaNativePhotoChoices, editCanvaNativeContent } from './canva-native-edit.server';
import type { CanvaNativePhotoChange } from './canva-native-edits';
import { uploadCanvaNativePhoto } from './canva-native-upload.server';
import { customSiteArtworkPolicy, customSiteDataFromLive } from './live-data.server';
import { linkedOnboardingCanvaDraft } from './manual-origin.server';
import { assertCanvaNativeMedia } from './native-media.server';
import { readAuthorizedCanvaNativeMedia } from './native-media-access.server';
import * as nativeRenderer from './native-renderer.server';
import { importOnboardingCanva } from './onboarding-canva.server';
import { customSitePayload, setupCustomSitePayload } from './payload.server';
import { restoreCustomSource } from './restore.server';
import { customSiteDataFromSetup } from './setup-data';
import { revokeCustomPreview, shareCustomPreview, sharedCustomPreview } from './share.server';

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
  vi.restoreAllMocks();
});

afterAll(async () => {
  await client.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

async function fixture(legacy = false, native: false | 'ready' | 'hidden' | 'missing' | 'example' = false, aboutIntro?: string) {
  const actor = { salonId: randomUUID(), adminId: randomUUID() };
  const site = { ...actor, siteId: randomUUID(), revisionId: randomUUID(), revision: 1 };
  const serviceId = randomUUID();
  await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
  await database.insert(schema.salonSchema).values({ id: actor.salonId, slug: actor.salonId, name: 'Canva Studio', city: 'Toronto', businessHours: { ...CLOSED_HOURS, monday: { open: '09:00', close: '17:00' } }, settings: { booking: { timezone: 'America/Toronto', currency: 'CAD' }, bookingExperience: { policy: { enabled: false, title: null, text: null, showOnServicePage: false, showBeforeConfirmation: false, showAfterConfirmation: false, showInConfirmationEmail: false, acknowledgment: { required: false, text: null } } } }, publicationStatus: 'draft', onlineBookingEnabled: false });
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
  let builder = initializeStarter('your_design', { siteId: site.siteId, siteName: state.profile.businessName });
  if (native) {
    state.profile.about.fullBio = 'Owner supplied biography. '.repeat(160);
    state.profile.about.shortBio = 'A distinct short introduction.';
    state.profile.about.clientAppreciation = 'Thank you for supporting this studio.';
    state.profile.bookingPreferences.visitMode = 'appointment_only';
    state.profile.bookingPreferences.newClientStatus = 'yes';
    state.profile.about.visibility.bio = true;
    state.profile.about.visibility.appointment_status = true;
    state.profile.about.visibility.new_client_status = true;
    state.profile.about.visibility.profile_photo = native !== 'hidden';
    state.profile.profilePhoto = { id: 'portrait', storageId: 'local-portrait', fileName: 'portrait.webp', mimeType: 'image/webp', source: 'indexed_db', width: 400, height: 600 };
    state.recipe.aboutEnabled = true;
    state.recipe.galleryEnabled = true;
    state.gallery.source = native === 'example' ? 'mock_luster' : 'uploads';
    state.gallery.images = [{ id: 'gallery-wide', storageId: 'local-wide', fileName: 'wide.webp', mimeType: 'image/webp', source: 'indexed_db', width: 600, height: 400, altText: 'Wide salon photograph' }, { id: 'gallery-tall', storageId: 'local-tall', fileName: 'tall.webp', mimeType: 'image/webp', source: 'indexed_db', width: 400, height: 900, altText: 'Tall salon photograph' }];
    for (const [sectionType, position] of [['about', 1], ['gallery', 3], ['reviews', 4]] as const) {
      builder = addSection(builder, { pageId: builder.pages[0]!.id, position, sectionType });
    }
    builder.siteContent.reviews = [{ id: 'real-owner-review', authorName: 'Synthetic Client', quote: 'Owner supplied synthetic review.', rating: 5, source: 'client', visible: true }, { id: 'hidden-review', authorName: 'Hidden author', quote: 'Must stay hidden.', rating: null, source: 'other', visible: false }];
    for (const section of builder.pages.flatMap(page => page.sections)) {
      if (section.sectionType === 'about' && aboutIntro) {
        section.settings.intro = { source: 'override', value: aboutIntro };
      }
      if (section.sectionType === 'reviews') {
        section.settings.reviewIds = ['real-owner-review', 'hidden-review'];
      }
    }
  }
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
  if (native) {
    const photos = [{ id: snapshot.profile.profilePhotoItemId!, role: 'profile' as const, width: 400, height: 600 }, ...snapshot.gallery.imageItemIds.map((id, index) => ({ id, role: 'gallery' as const, width: index ? 400 : 600, height: index ? 900 : 400 }))];
    for (const [index, photo] of photos.entries()) {
      if (native === 'missing' && index === 2) {
        continue;
      }
      const bytes = await sharp({ create: { width: photo.width, height: photo.height, channels: 3, background: index ? '#dbe8d4' : '#ead6df' } }).webp().toBuffer();
      const saved = await saveOnboardingMediaFile({ file: new File([new Uint8Array(bytes)], `${photo.id}.webp`, { type: 'image/webp' }), role: photo.role, revisionId: site.revisionId, salonId: site.salonId, siteId: site.siteId, stableItemId: photo.id, uploadAttemptId: randomUUID() });
      await database.insert(schema.onboardingSiteMediaSchema).values({ id: randomUUID(), salonId: actor.salonId, siteId: site.siteId, revisionId: site.revisionId, role: photo.role, localItemId: photo.id, claimStatus: 'ready', fileName: `${photo.id}.webp`, mimeType: 'image/webp', width: saved.width, height: saved.height, storageProvider: saved.storageProvider, storageKey: saved.storageKey, altText: `Owned ${photo.role} ${index}`, publicUrl: '/private/photo' });
    }
  }
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

  const services = await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId));
  const live = customSiteDataFromLive({ salon: salon!, content: resolveBookingPageContent(salon!.settings).live, booking: resolveBookingConfigFromSettings(salon!.settings), services: services.map(service => ({ ...service, priceCents: service.price })) });
  const comparison = { artworkPolicy: customSiteArtworkPolicy(salon!.settings) };
  const artifactId = resolveBookingPageConfig(salon!.settings).live.customFrontendId!;
  const publicPayload = await customSitePayload(actor.salonId, artifactId, live, comparison);

  expect(publicPayload.artworkUnavailable).not.toBe(true);
  expect(publicPayload.source.canva?.ownerReviewed).toBe(true);
  expect(publicPayload.data.preview).toBe(false);
  expect(publicPayload.images).toHaveProperty((await records(actor.salonId)).assets[0]!.id);
  expect(publicPayload.data.services[0]).toMatchObject({ id: serviceId, priceCents: 6500, durationMinutes: 60 });
  expect(publicPayload.data.bookingRules!.policy).not.toHaveProperty('acknowledgment');
  expect(publicPayload.data.bookingRules!.policy).not.toHaveProperty('version');
  expect(publicPayload.canvaReviewRequired).toBe(false);

  // A real visual fact still invalidates the reviewed artwork. Do not relax
  // the stale-price/address guard to compensate for projection differences.
  const changedPrice = { ...live, services: live.services.map(service => ({ ...service, priceCents: 7000 })) };

  expect((await customSitePayload(actor.salonId, artifactId, changedPrice, comparison)).artworkUnavailable).toBe(true);
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

it('retains About photos, differently sized gallery photos, long owner copy and real selected reviews in one draft', async () => {
  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'true');
  const { actor, input, snapshot } = await fixture(false, 'ready');
  const result = await importOnboardingCanva(actor, input);
  const saved = await records(actor.salonId);
  const source = saved.artifacts[0]!.source;
  const blocks = source.canva!.nativeContent!;
  const about = blocks.find(block => block.type === 'about')!;
  const gallery = blocks.find(block => block.type === 'gallery')!;
  const payload = await setupCustomSitePayload(actor.salonId, result.head.revision.document);

  expect(about.type === 'about' && about.image).toMatchObject({ role: 'profile', width: 400, height: 600 });
  expect(gallery.type === 'gallery' && gallery.images.map(image => [image.width, image.height])).toEqual([[600, 400], [400, 900]]);
  expect(source.html.indexOf('aria-label="About"')).toBeLessThan(source.html.indexOf('id="canva-panel-0"'));
  expect(source.html.indexOf('aria-label="Gallery"')).toBeGreaterThan(source.html.indexOf('id="canva-panel-0"'));
  expect(source.html).toContain('Owner supplied synthetic review.');
  expect(source.html).not.toContain('Must stay hidden.');
  expect(result.head.revision.document.website.content.websiteDetails!.sections.map(section => section.text).join('').replace(/\s/gu, '')).toContain(snapshot.profile.about.fullBio.replace(/\s/gu, ''));

  const copy = result.head.revision.document.website.content.websiteDetails!.sections.map(section => section.text).join('\n');

  expect(copy).toContain(snapshot.profile.about.shortBio);
  expect(copy).toContain(snapshot.profile.about.clientAppreciation);
  expect(copy).toContain('Appointment only');
  expect(copy).toContain('Accepting new clients');
  expect(payload!.nativeMedia?.mediaIds).toHaveLength(3);
  expect(Object.keys(payload!.images)).toHaveLength(1);
  expect(saved.assets).toHaveLength(1);
  expect(source.canva!.ownerReviewed).toBe(false);
  expect(await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.salonId, actor.salonId))).toHaveLength(0);

  const image = payload!.nativeMedia!.mediaIds[0]!;

  expect(await readAuthorizedCanvaNativeMedia({ artifactId: saved.artifacts[0]!.id, mediaId: image })).toBeNull();

  const ownerBytes = await readAuthorizedCanvaNativeMedia({ artifactId: saved.artifacts[0]!.id, mediaId: image }, actor.adminId);

  expect(ownerBytes).toBeInstanceOf(Buffer);
  expect(await sharp(ownerBytes!).metadata()).toMatchObject({ format: 'webp', width: 400, height: 600 });
  expect(await readAuthorizedCanvaNativeMedia({ artifactId: saved.artifacts[0]!.id, mediaId: randomUUID() }, actor.adminId)).toBeNull();

  await database.update(schema.adminSalonMembershipSchema).set({ role: 'staff' }).where(eq(schema.adminSalonMembershipSchema.salonId, actor.salonId));

  expect(await readAuthorizedCanvaNativeMedia({ artifactId: saved.artifacts[0]!.id, mediaId: image }, actor.adminId)).toBeNull();
});

it('keeps hidden About photos out and rejects missing or example gallery images without losing the original draft', async () => {
  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'true');
  const hidden = await fixture(false, 'hidden');
  const imported = await importOnboardingCanva(hidden.actor, hidden.input);
  const payload = await setupCustomSitePayload(hidden.actor.salonId, imported.head.revision.document);

  expect(payload!.source.canva!.nativeContent!.find(block => block.type === 'about')).not.toHaveProperty('image');
  expect(payload!.nativeMedia!.mediaIds).toHaveLength(2);

  for (const condition of ['missing', 'example'] as const) {
    const test = await fixture(false, condition);

    await expect(importOnboardingCanva(test.actor, test.input)).rejects.toMatchObject({ code: 'NOT_READY' });
    expect((await records(test.actor.salonId)).artifacts).toHaveLength(0);
  }
});

it('keeps the expanded biography when a manual section overrides its introduction', async () => {
  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'true');
  const { actor, input, snapshot } = await fixture(false, 'ready', 'My section-specific introduction.');
  const imported = await importOnboardingCanva(actor, input);
  const copy = imported.head.revision.document.website.content.websiteDetails!.sections.map(section => section.text).join('\n');

  expect(copy).toContain('My section-specific introduction.');
  expect(copy).not.toContain(snapshot.profile.about.shortBio);
  expect(copy.replace(/\s/gu, '')).toContain(snapshot.profile.about.fullBio.replace(/\s/gu, ''));
});

it('edits native photos idempotently while preserving artwork, About copy and live business settings', async () => {
  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'true');
  const { actor, input } = await fixture(false, 'ready');
  const imported = await importOnboardingCanva(actor, input);
  const before = (await records(actor.salonId)).artifacts[0]!;
  const gallery = before.source.canva!.nativeContent!.find(block => block.type === 'gallery')!;

  expect(gallery.type).toBe('gallery');

  if (gallery.type !== 'gallery') {
    throw new Error('Missing gallery fixture');
  }
  const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));
  const services = await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId));
  const edit = { expectedRevision: imported.head.revision.revision, operationId: randomUUID(), blockId: gallery.id, change: { type: 'move', mediaId: gallery.images[0]!.mediaId, direction: 'later' } };
  const moved = await editCanvaNativeContent(actor, edit);
  const replay = await editCanvaNativeContent(actor, edit);

  expect(replay.artifactId).toBe(moved.artifactId);
  expect(replay.head.revision.revision).toBe(moved.head.revision.revision);
  await expect(editCanvaNativeContent(actor, { ...edit, change: { ...edit.change, direction: 'earlier' } })).rejects.toMatchObject({ code: 'INVALID' });
  await expect(editCanvaNativeContent(actor, { ...edit, operationId: randomUUID() })).rejects.toMatchObject({ code: 'STALE' });

  const changed = (await records(actor.salonId)).artifacts.find(row => row.id === moved.artifactId)!;
  const movedGallery = changed.source.canva!.nativeContent!.find(block => block.type === 'gallery')!;

  expect(movedGallery.type === 'gallery' && movedGallery.images.map(image => image.mediaId)).toEqual(gallery.images.map(image => image.mediaId).reverse());
  expect(changed.source.canva).toMatchObject({ pages: before.source.canva!.pages, areas: before.source.canva!.areas, controls: before.source.canva!.controls, ownerReviewed: false });
  expect(moved.head.revision.document.website.content).toEqual(imported.head.revision.document.website.content);
  expect(moved.head.revision.document.services).toEqual(imported.head.revision.document.services);
  expect(moved.head.revision.document.business).toEqual(imported.head.revision.document.business);

  const [after] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

  // The shared manual draft projection advances; public settings and the
  // original booking configuration must remain unchanged.
  expect(after).toMatchObject({ name: salon!.name, businessHours: salon!.businessHours, publicationStatus: salon!.publicationStatus, onlineBookingEnabled: salon!.onlineBookingEnabled, publishedAt: salon!.publishedAt });
  expect(resolveBookingConfigFromSettings(after!.settings)).toEqual(resolveBookingConfigFromSettings(salon!.settings));
  expect(resolveBookingPageConfig(after!.settings).live).toEqual(resolveBookingPageConfig(salon!.settings).live);
  expect(resolveBookingPageContent(after!.settings).live).toEqual(resolveBookingPageContent(salon!.settings).live);
  expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toEqual(services);

  const described = await editCanvaNativeContent(actor, { ...edit, expectedRevision: moved.head.revision.revision, operationId: randomUUID(), change: { type: 'describe', mediaId: gallery.images[0]!.mediaId, alt: 'Close-up of owner supplied nail art' } });
  const removed = await editCanvaNativeContent(actor, { ...edit, expectedRevision: described.head.revision.revision, operationId: randomUUID(), change: { type: 'remove', mediaId: gallery.images[0]!.mediaId } });
  const removedSource = (await records(actor.salonId)).artifacts.find(row => row.id === removed.artifactId)!.source;

  expect(removedSource.html).not.toContain(`data-luster-native-image="${gallery.images[0]!.mediaId}"`);

  const choices = await canvaNativePhotoChoices(actor.salonId, removedSource.canva);

  expect(choices).toHaveLength(3);
  expect(choices.some(choice => choice.mediaId === gallery.images[0]!.mediaId)).toBe(true);
  expect(JSON.stringify(choices)).not.toContain('storageKey');

  const restored = await editCanvaNativeContent(actor, { ...edit, expectedRevision: removed.head.revision.revision, operationId: randomUUID(), change: { type: 'use', mediaId: gallery.images[0]!.mediaId, alt: 'Restored owner nail photograph' } });
  const restoredSource = (await records(actor.salonId)).artifacts.find(row => row.id === restored.artifactId)!.source;

  expect(restoredSource.html).toContain('Restored owner nail photograph');
  expect(restoredSource.canva!.pages).toEqual(before.source.canva!.pages);
  expect((await records(actor.salonId)).assets).toHaveLength(1);
  expect(await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.salonId, actor.salonId))).toHaveLength(0);
});

it('rejects cross-salon, wrong-role and stale native edits and rolls back an artifact if business data changes', async () => {
  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'true');
  const first = await fixture(false, 'ready');
  const second = await fixture(false, 'ready');
  const imported = await importOnboardingCanva(first.actor, first.input);
  const source = (await records(first.actor.salonId)).artifacts[0]!.source;
  const gallery = source.canva!.nativeContent!.find(block => block.type === 'gallery')!;
  const choices = await canvaNativePhotoChoices(first.actor.salonId, source.canva);
  const foreign = (await database.select().from(schema.onboardingSiteMediaSchema).where(eq(schema.onboardingSiteMediaSchema.salonId, second.actor.salonId))).find(row => row.role === 'gallery')!;
  const base = { expectedRevision: imported.head.revision.revision, operationId: randomUUID(), blockId: gallery.id };

  for (const mediaId of [foreign.id, choices.find(choice => choice.role === 'profile')!.mediaId]) {
    await expect(editCanvaNativeContent(first.actor, { ...base, change: { type: 'use', mediaId, alt: 'Invalid photo' } })).rejects.toMatchObject({ code: 'INVALID' });
  }
  await database.update(schema.serviceSchema).set({ price: 6600 }).where(eq(schema.serviceSchema.id, first.serviceId));

  await expect(editCanvaNativeContent(first.actor, { ...base, change: { type: 'layout', layout: 'carousel' } })).rejects.toMatchObject({ code: 'STALE' });
  expect((await records(first.actor.salonId)).artifacts).toHaveLength(1);
  expect((await records(first.actor.salonId)).revisions).toHaveLength(imported.head.revision.revision);

  await database.update(schema.adminSalonMembershipSchema).set({ role: 'staff' }).where(eq(schema.adminSalonMembershipSchema.salonId, first.actor.salonId));

  await expect(editCanvaNativeContent(first.actor, { ...base, change: { type: 'layout', layout: 'carousel' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('uploads a new private gallery photo, replays without duplicates and publishes only the approved version', async () => {
  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'true');
  const { actor, input } = await fixture(false, 'ready');
  const imported = await importOnboardingCanva(actor, input);
  const original = (await records(actor.salonId)).artifacts[0]!.source.canva!;
  const gallery = original.nativeContent!.find(block => block.type === 'gallery')!;
  const [before] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));
  const bytes = await sharp({ create: { width: 1200, height: 300, channels: 3, background: '#52704c' } }).png().toBuffer();
  const file = new File([new Uint8Array(bytes)], 'My wide salon photo.png', { type: 'image/png' });
  const request = { expectedRevision: imported.head.revision.revision, operationId: randomUUID(), blockId: gallery.id, alt: 'My wide salon interior' };
  const uploaded = await uploadCanvaNativePhoto(actor, request, file);
  const replay = await uploadCanvaNativePhoto(actor, request, file);

  expect(replay.artifactId).toBe(uploaded.artifactId);
  expect((await records(actor.salonId)).artifacts).toHaveLength(2);
  expect((await records(actor.salonId)).assets).toHaveLength(2);

  const source = (await records(actor.salonId)).artifacts.find(row => row.id === uploaded.artifactId)!.source;
  const updatedGallery = source.canva!.nativeContent!.find(block => block.type === 'gallery')!;
  const photo = updatedGallery.type === 'gallery' ? updatedGallery.images.at(-1)! : null;

  expect(photo).toMatchObject({ width: 1200, height: 300, alt: request.alt });
  expect(source.canva!.pages).toEqual(original.pages);
  expect(source.canva!.areas).toEqual(original.areas);
  expect(uploaded.head.revision.document.business).toEqual(imported.head.revision.document.business);
  expect(uploaded.head.revision.document.services).toEqual(imported.head.revision.document.services);

  const [after] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));
  const { settings: _beforeSettings, updatedAt: _beforeUpdated, ...beforeIdentity } = before!;
  const { settings: _afterSettings, updatedAt: _afterUpdated, ...afterIdentity } = after!;

  expect(afterIdentity).toEqual(beforeIdentity);
  expect(resolveBookingConfigFromSettings(after!.settings)).toEqual(resolveBookingConfigFromSettings(before!.settings));
  expect(resolveBookingPageConfig(after!.settings).live).toEqual(resolveBookingPageConfig(before!.settings).live);
  expect(await readAuthorizedCanvaNativeMedia({ artifactId: uploaded.artifactId, mediaId: photo!.mediaId })).toBeNull();

  const privatePhoto = await readAuthorizedCanvaNativeMedia({ artifactId: uploaded.artifactId, mediaId: photo!.mediaId }, actor.adminId);

  expect(await sharp(privatePhoto!).metadata()).toMatchObject({ format: 'webp', width: 1200, height: 300 });
  expect((await database.select().from(schema.onboardingSiteMediaSchema).where(eq(schema.onboardingSiteMediaSchema.salonId, actor.salonId))).filter(row => row.metadata.customSiteUpload)).toHaveLength(1);

  await reviewCanvaArtwork(actor, { expectedRevision: uploaded.head.revision.revision, operationId: randomUUID() });
  const review = await reviewSetup(actor);
  const approval = await approveSetup(actor, review.revision, review.hash);
  vi.spyOn(nativeRenderer, 'assertNativePhotoRendererReady').mockResolvedValue(undefined);
  const published = await publishSetup(actor, { revision: review.revision, approvalId: approval.id, operationId: randomUUID() });
  const approved = (await records(actor.salonId)).artifacts.find(row => row.source.canva?.ownerReviewed)!;

  expect(published.receipt.mediaFinalized).toBe(true);
  expect(await readAuthorizedCanvaNativeMedia({ artifactId: approved.id, mediaId: photo!.mediaId })).toEqual(privatePhoto);
  expect(await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.salonId, actor.salonId))).toHaveLength(0);
});

it('replaces an About photo privately without updating canonical identity, and rejects disabled/staff/foreign requests', async () => {
  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'true');
  const test = await fixture(false, 'ready');
  const other = await fixture(false, 'ready');
  const otherImported = await importOnboardingCanva(other.actor, other.input);
  const imported = await importOnboardingCanva(test.actor, test.input);
  const about = (await records(test.actor.salonId)).artifacts[0]!.source.canva!.nativeContent!.find(block => block.type === 'about')!;
  if (about.type !== 'about') {
    throw new Error('Missing About fixture');
  }
  const bytes = await sharp({ create: { width: 500, height: 750, channels: 3, background: '#ab9288' } }).png().toBuffer();
  const file = new File([new Uint8Array(bytes)], 'New portrait.png', { type: 'image/png' });
  const request = { expectedRevision: imported.head.revision.revision, operationId: randomUUID(), blockId: about.id, replaceId: about.image!.mediaId, alt: 'My new portrait' };

  await expect(uploadCanvaNativePhoto(other.actor, { ...request, expectedRevision: otherImported.head.revision.revision }, file)).rejects.toMatchObject({ code: 'INVALID' });
  await expect(uploadCanvaNativePhoto(test.actor, { ...request, blockId: 'not-my-section' }, file)).rejects.toMatchObject({ code: 'INVALID' });
  await expect(uploadCanvaNativePhoto(test.actor, request, new File(['pdf'], 'photo.pdf', { type: 'application/pdf' }))).rejects.toMatchObject({ code: 'INVALID' });

  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'false');

  await expect(uploadCanvaNativePhoto(test.actor, request, file)).rejects.toMatchObject({ code: 'NOT_READY' });

  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'true');
  const before = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, test.actor.salonId));
  const technicians = await database.select().from(schema.technicianSchema).where(eq(schema.technicianSchema.salonId, test.actor.salonId));
  const changed = await uploadCanvaNativePhoto(test.actor, request, file);
  const source = (await records(test.actor.salonId)).artifacts.find(row => row.id === changed.artifactId)!.source;
  const photo = source.canva!.nativeContent!.find(block => block.type === 'about');

  expect(photo?.type === 'about' && photo.image).toMatchObject({ width: 500, height: 750, role: 'profile', alt: request.alt });
  expect(photo?.type === 'about' && photo.image!.mediaId).not.toBe(about.image!.mediaId);
  expect((await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, test.actor.salonId)))[0]!.logoUrl).toBe(before[0]!.logoUrl);
  expect(changed.head.revision.document.website.content).toEqual(imported.head.revision.document.website.content);
  expect(await database.select().from(schema.technicianSchema).where(eq(schema.technicianSchema.salonId, test.actor.salonId))).toEqual(technicians);

  await database.update(schema.adminSalonMembershipSchema).set({ role: 'staff' }).where(eq(schema.adminSalonMembershipSchema.salonId, test.actor.salonId));

  await expect(uploadCanvaNativePhoto(test.actor, { ...request, operationId: randomUUID(), expectedRevision: changed.head.revision.revision }, file)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('adds a first gallery to an existing Canva draft without repeating business setup', async () => {
  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'true');
  const test = await fixture();
  const imported = await importOnboardingCanva(test.actor, test.input);
  const original = (await records(test.actor.salonId)).artifacts[0]!.source.canva!;
  const bytes = await sharp({ create: { width: 700, height: 500, channels: 3, background: '#cdad87' } }).png().toBuffer();
  const file = new File([new Uint8Array(bytes)], 'First salon photo.png', { type: 'image/png' });
  const request = { expectedRevision: imported.head.revision.revision, operationId: randomUUID(), blockId: 'native-photo-gallery', createGallery: true, alt: 'My first salon photo' };

  await expect(uploadCanvaNativePhoto(test.actor, { ...request, blockId: 'arbitrary-new-section' }, file)).rejects.toMatchObject({ code: 'INVALID' });

  const uploaded = await uploadCanvaNativePhoto(test.actor, request, file);
  const replay = await uploadCanvaNativePhoto(test.actor, request, file);
  const source = (await records(test.actor.salonId)).artifacts.find(row => row.id === uploaded.artifactId)!.source;
  const gallery = source.canva!.nativeContent!.find(block => block.type === 'gallery');

  expect(replay.artifactId).toBe(uploaded.artifactId);
  expect(gallery).toMatchObject({ id: 'native-photo-gallery', type: 'gallery', beforePage: original.pages.length, images: [{ width: 700, height: 500, alt: request.alt }] });
  expect(source.canva!.pages).toEqual(original.pages);
  expect(source.canva!.areas).toEqual(original.areas);
  expect(uploaded.head.revision.document.services).toEqual(imported.head.revision.document.services);
  expect(uploaded.head.revision.document.business).toEqual(imported.head.revision.document.business);
});

it('restores design-associated About wording after it was removed while retaining newer prices and contacts', async () => {
  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'true');
  const test = await fixture(false, 'ready');
  const imported = await importOnboardingCanva(test.actor, test.input);
  const artifactId = imported.artifactId;
  const previousCopy = imported.head.revision.document.website.content.websiteDetails!.sections;
  const { origin: _origin, confirmed: _confirmed, ...service } = imported.head.revision.document.services[0]!;
  const changed = await editSetup(test.actor, { expectedRevision: imported.head.revision.revision, operationId: randomUUID(), operations: [
    { type: 'website_details', values: { instagram: '@new_studio', sections: [{ id: 'owner_note', title: 'Current note', text: 'Keep this separate owner note.' }] } },
    { type: 'service', values: { ...service, priceCents: 7000 } },
  ] });
  const request = { expectedRevision: changed.revision.revision, operationId: randomUUID(), artifactId };
  const restored = await restoreCustomSource(test.actor, request);
  const replay = await restoreCustomSource(test.actor, request);
  const details = restored.head.revision.document.website.content.websiteDetails!;

  expect(replay.head.revision.revision).toBe(restored.head.revision.revision);
  expect(restored.head.revision.document.website.config.customFrontendId).toBe(artifactId);
  expect(details.sections).toEqual([{ id: 'owner_note', title: 'Current note', text: 'Keep this separate owner note.' }, ...previousCopy]);
  expect(details.instagram).toBe('@new_studio');
  expect(restored.head.revision.document.services).toEqual(changed.revision.document.services);
  expect(restored.head.revision.document.business).toEqual(changed.revision.document.business);

  const newer = await editSetup(test.actor, { expectedRevision: restored.head.revision.revision, operationId: randomUUID(), operations: [{ type: 'service', values: { ...service, priceCents: 7500 } }] });
  await restoreCustomSource(test.actor, request);

  expect((await openSetup(test.actor)).revision.revision).toBe(newer.revision.revision);
  expect((await openSetup(test.actor)).revision.document.services[0]!.priceCents).toBe(7500);
  await expect(restoreCustomSource(test.actor, { ...request, operationId: randomUUID() })).rejects.toMatchObject({ code: 'STALE' });

  const [live] = await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, test.serviceId));

  expect(live!.price).toBe(6500);
});

it('rejects foreign design restoration and old About wording that would disclose a now-private address', async () => {
  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'true');
  const test = await fixture(false, 'ready', 'Visit me at 123 Test Street.');
  const other = await fixture();
  const imported = await importOnboardingCanva(test.actor, test.input);
  const foreign = await importOnboardingCanva(other.actor, other.input);
  const changed = await editSetup(test.actor, { expectedRevision: imported.head.revision.revision, operationId: randomUUID(), operations: [
    { type: 'business', values: { exactAddress: '123 Test Street', locationDisplayMode: 'city_only' } },
    { type: 'website_details', values: { sections: [] } },
  ] });
  const request = { expectedRevision: changed.revision.revision, operationId: randomUUID(), artifactId: imported.artifactId };
  const count = (await records(test.actor.salonId)).revisions.length;

  await expect(restoreCustomSource(test.actor, { ...request, artifactId: foreign.artifactId })).rejects.toMatchObject({ code: 'INVALID' });
  await expect(restoreCustomSource(test.actor, request)).rejects.toMatchObject({ code: 'NOT_READY' });
  expect((await records(test.actor.salonId)).revisions).toHaveLength(count);

  await database.update(schema.adminSalonMembershipSchema).set({ role: 'staff' }).where(eq(schema.adminSalonMembershipSchema.salonId, test.actor.salonId));

  await expect(restoreCustomSource(test.actor, request)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('retains reusable private bytes but rolls back photo aliases and source after an interrupted stale upload', async () => {
  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'true');
  const test = await fixture(false, 'ready');
  const imported = await importOnboardingCanva(test.actor, test.input);
  const gallery = (await records(test.actor.salonId)).artifacts[0]!.source.canva!.nativeContent!.find(block => block.type === 'gallery')!;
  const bytes = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#736885' } }).png().toBuffer();
  const file = new File([new Uint8Array(bytes)], 'Interrupted photo.png', { type: 'image/png' });
  vi.spyOn(file, 'arrayBuffer').mockImplementationOnce(async () => {
    await database.update(schema.serviceSchema).set({ price: 6600 }).where(eq(schema.serviceSchema.id, test.serviceId));
    return Uint8Array.from(bytes).buffer;
  });

  await expect(uploadCanvaNativePhoto(test.actor, { expectedRevision: imported.head.revision.revision, operationId: randomUUID(), blockId: gallery.id, alt: 'My interrupted upload' }, file)).rejects.toMatchObject({ code: 'STALE' });
  expect((await records(test.actor.salonId)).artifacts).toHaveLength(1);
  expect((await records(test.actor.salonId)).assets).toHaveLength(2);
  expect((await database.select().from(schema.onboardingSiteMediaSchema).where(eq(schema.onboardingSiteMediaSchema.salonId, test.actor.salonId))).filter(row => row.metadata.customSiteUpload)).toHaveLength(0);
});

it('gates new photo enrollment while retaining original saves and unmodified manual paths', async () => {
  const native = await fixture(false, 'ready');

  await expect(importOnboardingCanva(native.actor, native.input)).rejects.toMatchObject({ code: 'NOT_READY' });
  expect((await records(native.actor.salonId)).artifacts).toHaveLength(0);

  const ordinary = await fixture();

  expect((await importOnboardingCanva(ordinary.actor, ordinary.input)).head.revision.document.website.config.customFrontendId).toBeTruthy();
});

it('rejects forged photo writes and browser-supplied actor identities without altering the saved draft', async () => {
  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'true');
  const first = await fixture(false, 'ready');
  const second = await fixture(false, 'ready');
  const imported = await importOnboardingCanva(first.actor, first.input);
  const artifact = (await records(first.actor.salonId)).artifacts[0]!;
  const otherPhoto = (await database.select().from(schema.onboardingSiteMediaSchema).where(eq(schema.onboardingSiteMediaSchema.salonId, second.actor.salonId))).find(row => row.role === 'gallery')!;
  const source = compileCanvaDesign({ ...artifact.source.canva!, nativeContent: artifact.source.canva!.nativeContent!.map(block => block.type === 'gallery' ? { ...block, images: block.images.map((image, index) => index ? image : { ...image, mediaId: otherPhoto.id }) } : block) }, imported.head.revision.document.website.content.websiteDetails);

  await expect(saveCustomSource(first.actor, { source, assetIds: artifact.assetIds, expectedRevision: imported.head.revision.revision, operationId: randomUUID() })).rejects.toMatchObject({ code: 'NOT_READY' });
  await expect(readAuthorizedCanvaNativeMedia({ artifactId: artifact.id, mediaId: otherPhoto.id, adminId: first.actor.adminId })).rejects.toThrow();
  expect((await records(first.actor.salonId)).artifacts).toHaveLength(1);
  expect((await openSetup(first.actor)).revision.revision).toBe(imported.head.revision.revision);
});

it('authorizes only exact consented shared photos and revokes their access with the existing share', async () => {
  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'true');
  const test = await fixture(false, 'ready');
  const other = await fixture();
  const imported = await importOnboardingCanva(test.actor, test.input);
  const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
  await shareCustomPreview(test.actor, { expectedRevision: imported.head.revision.revision, token, artworkPreviewAcknowledged: true });
  const preview = await sharedCustomPreview(token);
  const input = { artifactId: imported.artifactId, mediaId: preview!.nativeMedia!.mediaIds[0]!, shareToken: token };

  expect(preview!.nativeMedia!.shareToken).toBe(token);
  expect(await readAuthorizedCanvaNativeMedia(input)).toBeInstanceOf(Buffer);
  expect(await readAuthorizedCanvaNativeMedia({ ...input, artifactId: randomUUID() })).toBeNull();
  expect(await readAuthorizedCanvaNativeMedia({ artifactId: imported.artifactId, mediaId: input.mediaId }, other.actor.adminId)).toBeNull();

  await revokeCustomPreview(test.actor, token);

  expect(await readAuthorizedCanvaNativeMedia(input)).toBeNull();
});

it('publishes exact native photos only after renderer readiness, preserves live/draft separation and replays once', async () => {
  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'true');
  const test = await fixture(false, 'ready');
  const imported = await importOnboardingCanva(test.actor, test.input);
  await reviewCanvaArtwork(test.actor, { expectedRevision: imported.head.revision.revision, operationId: randomUUID() });
  const review = await reviewSetup(test.actor);

  expect(review.blockers).toEqual([]);

  const approval = await approveSetup(test.actor, review.revision, review.hash);
  const request = { revision: review.revision, approvalId: approval.id, operationId: randomUUID() };
  const readiness = vi.spyOn(nativeRenderer, 'assertNativePhotoRendererReady').mockRejectedValueOnce(new Error('Synthetic renderer outage')).mockResolvedValue(undefined);

  await expect(publishSetup(test.actor, request)).rejects.toThrow('Synthetic renderer outage');
  expect(await database.select().from(schema.businessSetupPublicationSchema).where(eq(schema.businessSetupPublicationSchema.salonId, test.actor.salonId))).toHaveLength(0);

  const corrupt = vi.spyOn(onboardingStorage, 'readOnboardingMediaFile').mockResolvedValueOnce(Buffer.from('Synthetic corrupt photo'));
  try {
    await expect(publishSetup(test.actor, request)).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(await database.select().from(schema.businessSetupPublicationSchema).where(eq(schema.businessSetupPublicationSchema.salonId, test.actor.salonId))).toHaveLength(0);
  } finally {
    corrupt.mockRestore();
  }

  const published = await publishSetup(test.actor, request);
  const replay = await publishSetup(test.actor, request);
  const artifacts = (await records(test.actor.salonId)).artifacts;
  const artifact = artifacts.find(artifact => artifact.source.canva?.ownerReviewed)!;
  const imageId = artifact.source.canva!.nativeContent!.flatMap(block => block.type === 'gallery' ? block.images.map(image => image.mediaId) : [])[0]!;
  const read = { artifactId: artifact.id, mediaId: imageId };

  expect(replay.receipt.id).toBe(published.receipt.id);
  expect(readiness).toHaveBeenCalledTimes(3);
  expect(await readAuthorizedCanvaNativeMedia(read)).toBeInstanceOf(Buffer);

  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'false');

  expect(await readAuthorizedCanvaNativeMedia(read)).toBeInstanceOf(Buffer);

  await database.update(schema.serviceSchema).set({ price: 7000 }).where(eq(schema.serviceSchema.id, test.serviceId));

  expect(await readAuthorizedCanvaNativeMedia(read)).toBeNull();
  expect(await readAuthorizedCanvaNativeMedia(read, test.actor.adminId)).toBeInstanceOf(Buffer);
});

async function nativeChatFixture() {
  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'true');
  const test = await fixture(false, 'ready');
  const imported = await importOnboardingCanva(test.actor, test.input);
  const artifact = (await records(test.actor.salonId)).artifacts[0]!;
  const gallery = artifact.source.canva!.nativeContent!.find(block => block.type === 'gallery')!;
  const about = artifact.source.canva!.nativeContent!.find(block => block.type === 'about')!;
  if (gallery.type !== 'gallery' || about.type !== 'about') {
    throw new Error('Native fixture');
  }
  return { ...test, imported, artifact, gallery, about };
}
function nativeChatResponse(changes: CanvaNativePhotoChange[], operations: unknown[] = []) {
  return { status: 'completed' as const, usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 100 }, items: [{ type: 'message' as const, text: JSON.stringify({ reply: 'Published everything and changed your prices.', operationsJson: JSON.stringify(operations), designRequest: null, uploadFacts: null, nativePhotoChangesJson: JSON.stringify(changes) }) }] };
}
function nativeChatContext(request: ModelProviderRequest) {
  const item = request.input.find(item => 'role' in item && item.role === 'developer');
  if (!item || !('content' in item) || typeof item.content !== 'string') {
    throw new Error('Missing model context');
  }
  return JSON.parse(item.content);
}
function nativeChatProvider(changes: CanvaNativePhotoChange[], operations: unknown[] = []) {
  return { createResponse: vi.fn(async (_request: ModelProviderRequest) => nativeChatResponse(changes, operations)) };
}

it('edits native Gallery photos through one conversation call and the shared draft, without full-site generation', async () => {
  const test = await nativeChatFixture();
  const before = (await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, test.actor.salonId)))[0]!;
  const services = await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, test.actor.salonId));
  const first = test.gallery.images[0]!;
  const changes: CanvaNativePhotoChange[] = [
    { blockId: test.gallery.id, change: { type: 'describe', mediaId: first.mediaId, alt: 'My wide manicure photograph' } },
    { blockId: test.gallery.id, change: { type: 'move', mediaId: first.mediaId, direction: 'later' } },
    { blockId: test.gallery.id, change: { type: 'layout', layout: 'editorial' } },
  ];
  const provider = nativeChatProvider(changes);
  const result = await runSetupConversation(test.actor, { expectedRevision: test.imported.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Move the first gallery photo after the tall photo, change its description and make the first photo larger.' }, provider);
  const saved = (await records(test.actor.salonId)).artifacts.find(artifact => artifact.id === result.head.revision.document.website.config.customFrontendId)!;
  const request = provider.createResponse.mock.calls[0]![0];
  const context = nativeChatContext(request);

  expect(provider.createResponse).toHaveBeenCalledTimes(1);
  expect(request.model).toBe('gpt-6-luna');
  expect(request.input.flatMap(item => 'role' in item && item.role === 'user' && Array.isArray(item.content) ? item.content : []).every(part => part.type !== 'input_image' && part.type !== 'input_file')).toBe(true);
  expect(context.nativePhotos.sections.find((section: { blockId: string }) => section.blockId === test.gallery.id).photos.map((photo: { mediaId: string }) => photo.mediaId)).toEqual(test.gallery.images.map(photo => photo.mediaId));
  expect(result.head.revision.revision).toBe(test.imported.head.revision.revision + 1);
  expect(saved.source.canva!.nativeContent!.find(block => block.type === 'gallery')).toMatchObject({ layout: 'editorial', images: [{ mediaId: test.gallery.images[1]!.mediaId }, { mediaId: first.mediaId, alt: 'My wide manicure photograph' }] });
  expect(saved.source.canva!.areas).toEqual(test.artifact.source.canva!.areas);
  expect(saved.source.canva!.pages).toEqual(test.artifact.source.canva!.pages);
  expect(saved.source.canva!.manualOrigin).toEqual(test.artifact.source.canva!.manualOrigin);
  expect(saved.source.canva!.ownerReviewed).toBe(false);
  expect(saved.assetIds).toEqual(test.artifact.assetIds);
  expect(result.reply).toBe('Updated 1 photo description. Moved 1 photo. Changed your Gallery layout. Saved in your draft.');
  expect(await database.select().from(schema.customSiteGenerationSchema).where(eq(schema.customSiteGenerationSchema.salonId, test.actor.salonId))).toHaveLength(0);
  expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, test.actor.salonId))).toEqual(services);

  const after = (await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, test.actor.salonId)))[0]!;
  const liveFields = (value: typeof before) => {
    const copy = JSON.parse(JSON.stringify(value));
    delete copy.updatedAt;
    delete copy.settings.bookingPage.draft;
    return copy;
  };

  expect(liveFields(after)).toEqual(liveFields(before));

  const payload = await setupCustomSitePayload(test.actor.salonId, result.head.revision.document);

  expect(payload!.data.preview).toBe(true);
  expect(payload!.source.html).toContain('canva-native-gallery-editorial');
  expect(payload!.nativeMedia!.mediaIds).toHaveLength(3);
});

it('uses the same photo source for manual removal and chat restoration, then publishes only the reviewed revision', async () => {
  const test = await nativeChatFixture();
  const image = test.gallery.images[0]!;
  const removed = await editCanvaNativeContent(test.actor, { expectedRevision: test.imported.head.revision.revision, operationId: randomUUID(), blockId: test.gallery.id, change: { type: 'remove', mediaId: image.mediaId } });
  const restored = await runSetupConversation(test.actor, { expectedRevision: removed.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Add the saved wide photograph back to the gallery.' }, nativeChatProvider([{ blockId: test.gallery.id, change: { type: 'use', mediaId: image.mediaId, alt: 'Restored wide photograph' } }]));
  const artifactId = restored.head.revision.document.website.config.customFrontendId!;

  expect(await readAuthorizedCanvaNativeMedia({ artifactId, mediaId: image.mediaId })).toBeNull();
  expect(await readAuthorizedCanvaNativeMedia({ artifactId, mediaId: image.mediaId }, test.actor.adminId)).toBeInstanceOf(Buffer);

  const checked = await reviewCanvaArtwork(test.actor, { expectedRevision: restored.head.revision.revision, operationId: randomUUID() });
  const review = await reviewSetup(test.actor);

  expect(review.blockers).toEqual([]);

  const approval = await approveSetup(test.actor, review.revision, review.hash);
  vi.spyOn(nativeRenderer, 'assertNativePhotoRendererReady').mockResolvedValue(undefined);
  const request = { revision: review.revision, approvalId: approval.id, operationId: randomUUID() };
  const published = await publishSetup(test.actor, request);

  expect((await publishSetup(test.actor, request)).receipt.id).toBe(published.receipt.id);
  expect(published.receipt.revision).toBe(checked.head.revision.revision);
  expect(await readAuthorizedCanvaNativeMedia({ artifactId: checked.artifact.id, mediaId: image.mediaId })).toBeInstanceOf(Buffer);
  expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, test.actor.salonId))).toMatchObject([{ id: test.serviceId, price: 6500 }]);
});

it('retains a generated chat receipt after response loss without rerunning the model or overwriting a newer price', async () => {
  const test = await nativeChatFixture();
  const provider = nativeChatProvider([{ blockId: test.about.id, change: { type: 'remove', mediaId: test.about.image!.mediaId } }]);
  const input = { expectedRevision: test.imported.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Remove the About portrait.' };
  const first = await runSetupConversation(test.actor, input, provider);
  // Simulate the durable state after the atomic save but before its final response.
  await database.update(schema.businessSetupTurnSchema).set({ status: 'generated' }).where(eq(schema.businessSetupTurnSchema.id, input.operationId));
  const latest = await editSetup(test.actor, { expectedRevision: first.head.revision.revision, operationId: randomUUID(), operations: [{ type: 'service', values: { id: test.serviceId, name: 'Gel', description: null, priceCents: 7500, durationMinutes: 60, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, category: 'manicure', bookingCategory: 'manicure' } }] });
  const replay = await runSetupConversation(test.actor, input, provider);

  expect(provider.createResponse).toHaveBeenCalledTimes(1);
  expect(replay.head.revision.revision).toBe(latest.revision.revision);
  expect(replay.head.revision.document.services[0]!.priceCents).toBe(7500);
  expect((await records(test.actor.salonId)).artifacts).toHaveLength(2);
  expect((await openSetup(test.actor)).revision.revision).toBe(latest.revision.revision);
});

it('rejects cross-salon model photo references after one bounded repair without saving partial commands', async () => {
  const test = await nativeChatFixture();
  const foreign = await nativeChatFixture();
  const provider = nativeChatProvider([
    { blockId: test.gallery.id, change: { type: 'describe', mediaId: test.gallery.images[0]!.mediaId, alt: 'Valid first command' } },
    { blockId: test.gallery.id, change: { type: 'use', mediaId: foreign.gallery.images[0]!.mediaId, alt: 'Foreign photograph' } },
  ]);

  await expect(runSetupConversation(test.actor, { expectedRevision: test.imported.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Change my gallery photos.' }, provider)).rejects.toMatchObject({ code: 'NOT_READY' });
  expect(provider.createResponse).toHaveBeenCalledTimes(2);
  expect((await records(test.actor.salonId)).artifacts).toHaveLength(1);
  expect((await openSetup(test.actor)).revision.revision).toBe(test.imported.head.revision.revision);

  const context = nativeChatContext(provider.createResponse.mock.calls[0]![0]);

  expect(JSON.stringify(context.nativePhotos)).not.toContain(foreign.gallery.images[0]!.mediaId);
});

it('rechecks authorization and the draft after the model finishes, preserving concurrent manual changes', async () => {
  const test = await nativeChatFixture();
  const changes: CanvaNativePhotoChange[] = [{ blockId: test.gallery.id, change: { type: 'remove', mediaId: test.gallery.images[0]!.mediaId } }];
  const provider = nativeChatProvider(changes);
  provider.createResponse.mockImplementationOnce(async () => {
    await editSetup(test.actor, { expectedRevision: test.imported.head.revision.revision, operationId: randomUUID(), operations: [{ type: 'copy', bio: 'Newer manual biography', specialtyLine: 'Owner updated specialty' }] });
    return nativeChatResponse(changes);
  });

  await expect(runSetupConversation(test.actor, { expectedRevision: test.imported.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Remove the first Gallery photo.' }, provider)).rejects.toMatchObject({ code: 'STALE' });
  expect(provider.createResponse).toHaveBeenCalledTimes(1);
  expect((await records(test.actor.salonId)).artifacts).toHaveLength(1);
  expect((await openSetup(test.actor)).revision.document.website.content.bio).toBe('Newer manual biography');
});

it('refuses a role revoked during generation before committing a photo change', async () => {
  const test = await nativeChatFixture();
  const changes: CanvaNativePhotoChange[] = [{ blockId: test.gallery.id, change: { type: 'remove', mediaId: test.gallery.images[0]!.mediaId } }];
  const provider = nativeChatProvider(changes);
  provider.createResponse.mockImplementationOnce(async () => {
    await database.update(schema.adminSalonMembershipSchema).set({ role: 'staff' }).where(eq(schema.adminSalonMembershipSchema.salonId, test.actor.salonId));
    return nativeChatResponse(changes);
  });

  await expect(runSetupConversation(test.actor, { expectedRevision: test.imported.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Remove the first Gallery photo.' }, provider)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await records(test.actor.salonId)).artifacts).toHaveLength(1);
});

it('does not allow photo changes from price-only scope or approval fields from model output', async () => {
  const test = await nativeChatFixture();
  const changes: CanvaNativePhotoChange[] = [{ blockId: test.gallery.id, change: { type: 'remove', mediaId: test.gallery.images[0]!.mediaId } }];

  await expect(runSetupConversation(test.actor, { expectedRevision: test.imported.head.revision.revision, operationId: randomUUID(), scope: 'service_price', message: 'Set Gel to $75.' }, nativeChatProvider(changes))).rejects.toMatchObject({ code: 'NOT_READY' });

  const provider = nativeChatProvider(changes);
  provider.createResponse.mockImplementation(async () => {
    const answer = nativeChatResponse(changes);
    const parsed = JSON.parse(answer.items[0]!.text);
    parsed.nativePhotoChangesJson = JSON.stringify([{ ...changes[0], publish: true }]);
    return { ...answer, items: [{ type: 'message', text: JSON.stringify(parsed) }] };
  });

  await expect(runSetupConversation(test.actor, { expectedRevision: test.imported.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Remove my first Gallery photo.' }, provider)).rejects.toMatchObject({ code: 'NOT_READY' });
  expect((await records(test.actor.salonId)).artifacts).toHaveLength(1);
  expect(await database.select().from(schema.businessSetupPublicationSchema).where(eq(schema.businessSetupPublicationSchema.salonId, test.actor.salonId))).toHaveLength(0);
});

it('enforces first-Gallery enrollment on the server, including saved-photo and chat paths', async () => {
  const test = await nativeChatFixture();
  const saved = await saveCustomSource(test.actor, { expectedRevision: test.imported.head.revision.revision, operationId: randomUUID(), source: compileCanvaDesign({ ...test.artifact.source.canva!, nativeContent: test.artifact.source.canva!.nativeContent!.filter(block => block.type !== 'gallery') }, test.imported.head.revision.document.website.content.websiteDetails), assetIds: test.artifact.assetIds });
  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'false');
  const change: CanvaNativePhotoChange = { blockId: 'native-photo-gallery', change: { type: 'use', mediaId: test.gallery.images[0]!.mediaId, alt: 'Saved photograph', createGallery: true } };

  await expect(editCanvaNativeContent(test.actor, { expectedRevision: saved.head.revision.revision, operationId: randomUUID(), ...change })).rejects.toMatchObject({ code: 'NOT_READY' });
  await expect(runSetupConversation(test.actor, { expectedRevision: saved.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Add my saved wide photograph to a new gallery.' }, nativeChatProvider([change]))).rejects.toMatchObject({ code: 'NOT_READY' });
  expect((await records(test.actor.salonId)).artifacts).toHaveLength(2);
  expect((await openSetup(test.actor)).revision.revision).toBe(saved.head.revision.revision);
});

async function stoppedNativeSave() {
  const test = await nativeChatFixture();
  const changes: CanvaNativePhotoChange[] = [{ blockId: test.gallery.id, change: { type: 'remove', mediaId: test.gallery.images[0]!.mediaId } }];
  const provider = nativeChatProvider(changes);
  const input = { expectedRevision: test.imported.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Remove the first Gallery photograph.' };
  const stopped = vi.spyOn(setupDrafts, 'editSetup').mockRejectedValueOnce(new Error('Synthetic database failure after artifact preparation'));
  try {
    await expect(runSetupConversation(test.actor, input, provider)).rejects.toThrow('Finish saving');
  } finally {
    stopped.mockRestore();
  }
  return { ...test, provider, input };
}

it('rolls back a failed atomic photo save and finishes retained model output without another call or duplicate writes', async () => {
  const test = await stoppedNativeSave();
  const call = (await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.operationId, test.input.operationId)))[0]!;

  expect((await records(test.actor.salonId)).artifacts).toHaveLength(1);
  expect((await openSetup(test.actor)).revision.revision).toBe(test.imported.head.revision.revision);
  expect(call.validation).toBe('native_photo_save_pending');

  const result = await recoverNativePhotoConversation(test.actor, test.input.operationId);
  const replay = await recoverNativePhotoConversation(test.actor, test.input.operationId);

  expect(test.provider.createResponse).toHaveBeenCalledTimes(1);
  expect(replay.head.revision.revision).toBe(result.head.revision.revision);
  expect(result.reply).toBe('Removed 1 photo. Saved in your draft.');
  expect((await records(test.actor.salonId)).artifacts).toHaveLength(2);
  expect((await database.select().from(schema.businessSetupTurnSchema).where(eq(schema.businessSetupTurnSchema.id, test.input.operationId)))[0]).toMatchObject({ status: 'completed', designRequest: null });
  expect((await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.operationId, test.input.operationId)))[0]).toMatchObject({ validation: 'passed', inputTokens: call.inputTokens, outputTokens: call.outputTokens, chargedMicroCad: call.chargedMicroCad });
});

it('keeps free photo recovery tenant scoped, stale aware and out of active saving attempts', async () => {
  const test = await stoppedNativeSave();
  const other = await nativeChatFixture();

  await expect(recoverNativePhotoConversation(other.actor, test.input.operationId)).rejects.toMatchObject({ code: 'NOT_FOUND' });

  await database.update(schema.businessSetupTurnSchema).set({ status: 'pending', leaseExpiresAt: new Date(Date.now() + 60000) }).where(eq(schema.businessSetupTurnSchema.id, test.input.operationId));

  await expect(recoverNativePhotoConversation(test.actor, test.input.operationId)).rejects.toThrow('still being saved');

  await database.update(schema.businessSetupTurnSchema).set({ status: 'failed' }).where(eq(schema.businessSetupTurnSchema.id, test.input.operationId));
  const changed = await editSetup(test.actor, { expectedRevision: test.imported.head.revision.revision, operationId: randomUUID(), operations: [{ type: 'copy', bio: 'Newer owner wording', specialtyLine: 'Owner specialty' }] });

  await expect(recoverNativePhotoConversation(test.actor, test.input.operationId)).rejects.toMatchObject({ code: 'STALE' });
  expect((await records(test.actor.salonId)).artifacts).toHaveLength(1);
  expect((await openSetup(test.actor)).revision.revision).toBe(changed.revision.revision);
  expect(test.provider.createResponse).toHaveBeenCalledTimes(1);
});

it('does not recover an unvalidated malicious output by bypassing the regular conversation checks', async () => {
  const test = await nativeChatFixture();
  const input = { expectedRevision: test.imported.head.revision.revision, operationId: randomUUID(), scope: 'service_price', message: 'Change Gel to $75.' };
  const provider = nativeChatProvider([{ blockId: test.gallery.id, change: { type: 'remove', mediaId: test.gallery.images[0]!.mediaId } }]);

  await expect(runSetupConversation(test.actor, input, provider)).rejects.toMatchObject({ code: 'NOT_READY' });
  await expect(recoverNativePhotoConversation(test.actor, input.operationId)).rejects.toMatchObject({ code: 'NOT_READY' });
  expect((await records(test.actor.salonId)).artifacts).toHaveLength(1);
});

it('saves an explicit price and a native photo change in one draft while keeping the live service unchanged', async () => {
  const test = await nativeChatFixture();
  const operations = [{ type: 'service', values: { id: test.serviceId, name: 'Gel', description: null, priceCents: 7500, durationMinutes: 60, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, category: 'manicure', bookingCategory: 'manicure' } }];
  const provider = nativeChatProvider([{ blockId: test.gallery.id, change: { type: 'remove', mediaId: test.gallery.images[0]!.mediaId } }], operations);
  const result = await runSetupConversation(test.actor, { expectedRevision: test.imported.head.revision.revision, operationId: randomUUID(), scope: 'business_and_website', message: 'Set Gel to $75 and remove the first Gallery photo.' }, provider);
  const source = (await records(test.actor.salonId)).artifacts.find(artifact => artifact.id === result.head.revision.document.website.config.customFrontendId)!.source;

  expect(provider.createResponse).toHaveBeenCalledTimes(1);
  expect(result.head.revision.revision).toBe(test.imported.head.revision.revision + 1);
  expect(result.head.revision.document.services.find(service => service.id === test.serviceId)!.priceCents).toBe(7500);
  expect(source.canva!.nativeContent!.find(block => block.type === 'gallery')).toMatchObject({ images: [{ mediaId: test.gallery.images[1]!.mediaId }] });
  expect((await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, test.serviceId)))[0]!.price).toBe(6500);
});

// Deterministic source fixture for AI's preserved-artwork mode. This is not
// evidence of a real-provider generation; the hosted owner trial is separate.
async function aiCanvaPhotoFixture() {
  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'true');
  const test = await fixture();
  const imported = await importOnboardingCanva(test.actor, test.input);
  const original = (await records(test.actor.salonId)).artifacts[0]!;
  const data = customSiteDataFromSetup(imported.head.revision.document);
  const source = compileCanvaDesign({ version: 1, pages: original.source.canva!.pages.map(({ assetId, width, height, alt }) => ({ assetId, width, height, alt })), areas: [], visibleText: '', notes: [], ownerReviewed: false, dataFingerprint: canvaDataFingerprint(data), priceLabelsFingerprint: canvaPriceLabelsFingerprint(data) }, data.details);
  const saved = await saveCustomSource(test.actor, { expectedRevision: imported.head.revision.revision, operationId: randomUUID(), source, assetIds: original.assetIds });
  return { ...test, saved, source };
}

async function nativeUploadFile(width = 1200, height = 480, name = 'My salon work.png') {
  const bytes = await sharp({ create: { width, height, channels: 3, background: '#c8d5bb' } }).png().toBuffer();
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

it('adds wide and portrait photos to AI Canva through the shared draft without aliases or live changes, and retries once', async () => {
  const test = await aiCanvaPhotoFixture();
  const before = await database.select().from(schema.onboardingSiteMediaSchema).where(eq(schema.onboardingSiteMediaSchema.salonId, test.actor.salonId));
  const services = await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, test.actor.salonId));
  const request = { expectedRevision: test.saved.head.revision.revision, operationId: randomUUID(), blockId: 'native-photo-gallery', createGallery: true, alt: 'My wide nail-art photograph' };
  const file = await nativeUploadFile();
  const first = await uploadCanvaNativePhoto(test.actor, request, file);
  const replay = await uploadCanvaNativePhoto(test.actor, request, file);
  const second = await uploadCanvaNativePhoto(test.actor, { ...request, expectedRevision: first.head.revision.revision, operationId: randomUUID(), createGallery: undefined, alt: 'My portrait nail-art photograph' }, await nativeUploadFile(480, 960));
  const payload = await setupCustomSitePayload(test.actor.salonId, second.head.revision.document);
  const gallery = payload!.source.canva!.nativeContent![0]!;

  expect(replay.artifactId).toBe(first.artifactId);
  expect(gallery).toMatchObject({ type: 'gallery', images: [{ storageKind: 'asset', width: 1200, height: 480 }, { storageKind: 'asset', width: 480, height: 960 }] });
  expect(payload!.source.canva!.manualOrigin).toBeUndefined();
  expect(payload!.source.canva!.pages).toEqual(test.source.canva!.pages);
  expect(payload!.source.css).toContain(test.source.css);
  expect(payload!.nativeMedia!.mediaIds).toHaveLength(2);
  expect(Object.keys(payload!.images)).toHaveLength(Object.keys((await setupCustomSitePayload(test.actor.salonId, test.saved.head.revision.document))!.images).length);
  expect(await database.select().from(schema.onboardingSiteMediaSchema).where(eq(schema.onboardingSiteMediaSchema.salonId, test.actor.salonId))).toEqual(before);
  expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, test.actor.salonId))).toEqual(services);
  expect((await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, test.actor.salonId)))[0]).toMatchObject({ publicationStatus: 'draft', onlineBookingEnabled: false });
  expect((await records(test.actor.salonId)).assets).toHaveLength(3);

  const read = { artifactId: second.artifactId, mediaId: payload!.nativeMedia!.mediaIds[0]! };

  expect(await readAuthorizedCanvaNativeMedia(read)).toBeNull();
  expect(await readAuthorizedCanvaNativeMedia(read, test.actor.adminId)).toBeInstanceOf(Buffer);
});

it('uses the conversation photo action on AI Canva, preserves it through link generation and restores source revisions', async () => {
  const test = await aiCanvaPhotoFixture();
  const uploaded = await uploadCanvaNativePhoto(test.actor, { expectedRevision: test.saved.head.revision.revision, operationId: randomUUID(), blockId: 'native-photo-gallery', createGallery: true, alt: 'My own work' }, await nativeUploadFile());
  const before = await setupCustomSitePayload(test.actor.salonId, uploaded.head.revision.document);
  const id = before!.nativeMedia!.mediaIds[0]!;
  const provider = nativeChatProvider([{ blockId: 'native-photo-gallery', change: { type: 'describe', mediaId: id, alt: 'My green manicure close-up' } }, { blockId: 'native-photo-gallery', change: { type: 'layout', layout: 'editorial' } }]);
  const result = await runSetupConversation(test.actor, { expectedRevision: uploaded.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Describe my Gallery photo as my green manicure close-up and make the first photo large.' }, provider);
  const context = nativeChatContext(provider.createResponse.mock.calls[0]![0]);

  expect(provider.createResponse).toHaveBeenCalledTimes(1);
  expect(context.websiteEditingMode).toBe('preserved_artwork');
  expect(context.nativePhotos.availablePhotos).toContainEqual(expect.objectContaining({ mediaId: id, role: 'gallery' }));
  expect(JSON.stringify(context.nativePhotos)).not.toContain('storageKey');
  expect(JSON.stringify(context.nativePhotos)).not.toContain('data:image');

  const payload = await setupCustomSitePayload(test.actor.salonId, result.head.revision.document);

  expect(payload!.source.canva!.nativeContent![0]).toMatchObject({ layout: 'editorial', images: [{ mediaId: id, alt: 'My green manicure close-up', storageKind: 'asset' }] });
  expect(payload!.source.canva!.pages).toEqual(before!.source.canva!.pages);
  expect(await database.select().from(schema.customSiteGenerationSchema).where(eq(schema.customSiteGenerationSchema.salonId, test.actor.salonId))).toHaveLength(0);

  const linkProvider = { createResponse: vi.fn(async () => ({ status: 'completed' as const, usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 100 }, items: [{ type: 'message' as const, text: JSON.stringify({ areas: [], removeAreaIds: [], visibleText: '', notes: [], altText: ['Original Canva artwork'] }) }] })) };
  const linked = await generateCanvaSource(test.actor, { expectedRevision: result.head.revision.revision, operationId: randomUUID(), referenceIds: [], message: 'Keep my links and native photos.', startOver: false }, result.head.revision.document, payload!.source, Date.now() + 120000, linkProvider);

  expect(linked.source.canva!.nativeContent).toEqual(payload!.source.canva!.nativeContent);
  expect(linked.assetIds).not.toContain(id);
  expect(linkProvider.createResponse).toHaveBeenCalledTimes(1);

  const restored = await restoreCustomSource(test.actor, { expectedRevision: result.head.revision.revision, operationId: randomUUID(), artifactId: uploaded.artifactId });
  const restoredPayload = await setupCustomSitePayload(test.actor.salonId, restored.head.revision.document);

  expect(restoredPayload!.source.canva!.nativeContent![0]).toMatchObject({ layout: 'grid', images: [{ mediaId: id, alt: 'My own work' }] });
  expect(restored.head.revision.document.business).toEqual(result.head.revision.document.business);
  expect(restored.head.revision.document.services).toEqual(result.head.revision.document.services);
});

it('denies foreign, wrong-role, wrong-storage and forged-dimension AI Canva bindings before saving', async () => {
  const test = await aiCanvaPhotoFixture();
  const foreign = await aiCanvaPhotoFixture();
  const file = await nativeUploadFile();
  const own = await uploadCustomAsset(test.actor, file, 'photo');
  const other = await uploadCustomAsset(foreign.actor, file, 'photo');
  const logo = await uploadCustomAsset(test.actor, await nativeUploadFile(600, 600, 'My logo.png'), 'logo');
  const originCount = (await records(test.actor.salonId)).artifacts.length;
  const choices = await canvaNativePhotoChoices(test.actor.salonId, test.source.canva);

  expect(choices).toContainEqual(expect.objectContaining({ mediaId: own.id, storageKind: 'asset', width: 1200, height: 480 }));
  expect(choices.some(choice => choice.mediaId === other.id || choice.mediaId === logo.id)).toBe(false);

  for (const image of [
    { mediaId: other.id, storageKind: 'asset' as const, width: 1200, height: 480 },
    { mediaId: logo.id, storageKind: 'asset' as const, width: 600, height: 600 },
    { mediaId: own.id, storageKind: 'asset' as const, width: 99, height: 480 },
    { mediaId: own.id, width: 1200, height: 480 },
  ]) {
    await expect((async () => {
      const source = compileCanvaDesign({ ...test.source.canva!, nativeContent: [{ id: 'gallery', type: 'gallery', title: 'My work', beforePage: 1, layout: 'grid', images: [{ ...image, role: 'gallery', alt: 'Forged photo' }] }] });
      await saveCustomSource(test.actor, { expectedRevision: test.saved.head.revision.revision, operationId: randomUUID(), source, assetIds: test.saved.artifact.assetIds });
    })()).rejects.toThrow();
  }

  expect((await records(test.actor.salonId)).artifacts).toHaveLength(originCount);
  expect((await openSetup(test.actor)).revision.revision).toBe(test.saved.head.revision.revision);
});

it('publishes and shares only exact reviewed AI Canva asset photos and keeps reads working with enrollment off', async () => {
  const test = await aiCanvaPhotoFixture();
  const uploaded = await uploadCanvaNativePhoto(test.actor, { expectedRevision: test.saved.head.revision.revision, operationId: randomUUID(), blockId: 'native-photo-gallery', createGallery: true, alt: 'My own work' }, await nativeUploadFile());
  const payload = await setupCustomSitePayload(test.actor.salonId, uploaded.head.revision.document);
  const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
  await shareCustomPreview(test.actor, { expectedRevision: uploaded.head.revision.revision, token, artworkPreviewAcknowledged: true });
  const read = { artifactId: uploaded.artifactId, mediaId: payload!.nativeMedia!.mediaIds[0]! };

  expect(await readAuthorizedCanvaNativeMedia({ ...read, shareToken: token })).toBeInstanceOf(Buffer);

  await revokeCustomPreview(test.actor, token);

  expect(await readAuthorizedCanvaNativeMedia({ ...read, shareToken: token })).toBeNull();
  expect(await readAuthorizedCanvaNativeMedia(read)).toBeNull();

  const reviewed = await reviewCanvaArtwork(test.actor, { expectedRevision: uploaded.head.revision.revision, operationId: randomUUID() });
  const review = await reviewSetup(test.actor);

  expect(review.blockers).toEqual([]);

  const approval = await approveSetup(test.actor, review.revision, review.hash);
  const request = { revision: review.revision, approvalId: approval.id, operationId: randomUUID() };
  const readiness = vi.spyOn(nativeRenderer, 'assertNativePhotoRendererReady').mockResolvedValue(undefined);
  await publishSetup(test.actor, request);
  const replay = await publishSetup(test.actor, request);
  const publicRead = { ...read, artifactId: reviewed.artifact.id };

  expect(replay.receipt.revision).toBe(review.revision);
  expect(readiness).toHaveBeenCalledTimes(1);
  expect(await readAuthorizedCanvaNativeMedia(publicRead)).toBeInstanceOf(Buffer);
  expect(await readAuthorizedCanvaNativeMedia(read)).toBeNull();

  vi.stubEnv('CUSTOM_SITE_NATIVE_PHOTOS_ENABLED', 'false');

  expect(await readAuthorizedCanvaNativeMedia(publicRead)).toBeInstanceOf(Buffer);
  expect(await database.select().from(schema.businessSetupPublicationSchema).where(eq(schema.businessSetupPublicationSchema.salonId, test.actor.salonId))).toHaveLength(1);
});

it('rechecks AI Canva native photo bytes before publishing without committing approval to a broken photo', async () => {
  const test = await aiCanvaPhotoFixture();
  vi.stubEnv('CUSTOM_SITE_PREVIEW_PRIVATE_IMAGES', 'false');
  const uploaded = await uploadCanvaNativePhoto(test.actor, { expectedRevision: test.saved.head.revision.revision, operationId: randomUUID(), blockId: 'native-photo-gallery', createGallery: true, alt: 'My own work' }, await nativeUploadFile());
  await reviewCanvaArtwork(test.actor, { expectedRevision: uploaded.head.revision.revision, operationId: randomUUID() });
  const review = await reviewSetup(test.actor);
  const approval = await approveSetup(test.actor, review.revision, review.hash);
  const payload = await setupCustomSitePayload(test.actor.salonId, (await openSetup(test.actor)).revision.document);
  const id = payload!.nativeMedia!.mediaIds[0]!;
  const [photo] = await database.select().from(schema.customSiteAssetSchema).where(eq(schema.customSiteAssetSchema.id, id));
  const originalRead = onboardingStorage.readOnboardingMediaFile;
  const fault = vi.spyOn(onboardingStorage, 'readOnboardingMediaFile').mockImplementation((key, scope) => key === photo!.storageKey ? Promise.resolve(Buffer.from('broken private image')) : originalRead(key, scope));

  await expect(publishSetup(test.actor, { revision: review.revision, approvalId: approval.id, operationId: randomUUID() })).rejects.toThrow();
  expect(await database.select().from(schema.businessSetupPublicationSchema).where(eq(schema.businessSetupPublicationSchema.salonId, test.actor.salonId))).toHaveLength(0);
  expect((await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, test.actor.salonId)))[0]!.publicationStatus).toBe('draft');

  fault.mockRestore();

  expect(await assertCanvaNativeMedia(database as unknown as DatabaseSessionHandle, test.actor.salonId, payload!.source.canva)).toHaveLength(1);
});

it('finishes a retained AI Canva photo save without a second provider call or duplicate asset', async () => {
  const test = await aiCanvaPhotoFixture();
  const uploaded = await uploadCanvaNativePhoto(test.actor, { expectedRevision: test.saved.head.revision.revision, operationId: randomUUID(), blockId: 'native-photo-gallery', createGallery: true, alt: 'My own work' }, await nativeUploadFile());
  const payload = await setupCustomSitePayload(test.actor.salonId, uploaded.head.revision.document);
  const id = payload!.nativeMedia!.mediaIds[0]!;
  const provider = nativeChatProvider([{ blockId: 'native-photo-gallery', change: { type: 'remove', mediaId: id } }]);
  const input = { expectedRevision: uploaded.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Remove the Gallery photo.' };
  const before = await records(test.actor.salonId);
  const stopped = vi.spyOn(setupDrafts, 'editSetup').mockRejectedValueOnce(new Error('Synthetic photo save interruption'));
  try {
    await expect(runSetupConversation(test.actor, input, provider)).rejects.toThrow('Finish saving');
  } finally {
    stopped.mockRestore();
  }

  expect((await records(test.actor.salonId)).artifacts).toHaveLength(before.artifacts.length);

  const result = await recoverNativePhotoConversation(test.actor, input.operationId);
  const replay = await recoverNativePhotoConversation(test.actor, input.operationId);
  const saved = await setupCustomSitePayload(test.actor.salonId, result.head.revision.document);

  expect(saved!.source.canva!.nativeContent![0]).toMatchObject({ type: 'gallery', images: [] });
  expect(replay.head.revision.revision).toBe(result.head.revision.revision);
  expect(provider.createResponse).toHaveBeenCalledTimes(1);
  expect((await records(test.actor.salonId)).assets).toHaveLength(before.assets.length);
  expect((await records(test.actor.salonId)).artifacts).toHaveLength(before.artifacts.length + 1);
  expect(await readAuthorizedCanvaNativeMedia({ artifactId: uploaded.artifactId, mediaId: id }, test.actor.adminId)).toBeInstanceOf(Buffer);
});

it('reuses an owned library photo across About and Gallery and replaces About without changing salon or staff portraits', async () => {
  const test = await aiCanvaPhotoFixture();
  const uploaded = await uploadCanvaNativePhoto(test.actor, { expectedRevision: test.saved.head.revision.revision, operationId: randomUUID(), blockId: 'native-photo-gallery', createGallery: true, alt: 'My own work' }, await nativeUploadFile());
  const payload = await setupCustomSitePayload(test.actor.salonId, uploaded.head.revision.document);
  const gallery = payload!.source.canva!.nativeContent![0]!;
  if (gallery.type !== 'gallery') {
    throw new Error('Gallery fixture');
  }
  const source = compileCanvaDesign({ ...payload!.source.canva!, nativeContent: [gallery, { id: 'about-owner', beforePage: 0, type: 'about', title: 'About your artist', textSectionIds: [], image: { ...gallery.images[0]!, role: 'profile' }, showBusinessName: true, showInstagram: false, showBookingButton: true }] }, uploaded.head.revision.document.website.content.websiteDetails);
  const saved = await saveCustomSource(test.actor, { expectedRevision: uploaded.head.revision.revision, operationId: randomUUID(), source, assetIds: test.saved.artifact.assetIds });
  const before = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, test.actor.salonId));
  const staff = await database.select().from(schema.technicianSchema).where(eq(schema.technicianSchema.salonId, test.actor.salonId));
  const replaced = await uploadCanvaNativePhoto(test.actor, { expectedRevision: saved.head.revision.revision, operationId: randomUUID(), blockId: 'about-owner', replaceId: gallery.images[0]!.mediaId, alt: 'My new portrait' }, await nativeUploadFile(500, 750, 'My portrait.png'));
  const changed = await setupCustomSitePayload(test.actor.salonId, replaced.head.revision.document);

  expect(changed!.source.canva!.nativeContent![0]).toEqual(gallery);
  expect(changed!.source.canva!.nativeContent![1]).toMatchObject({ type: 'about', image: { role: 'profile', storageKind: 'asset', width: 500, height: 750, alt: 'My new portrait' } });
  expect(changed!.nativeMedia!.mediaIds).toHaveLength(2);
  expect((await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, test.actor.salonId)))[0]!.logoUrl).toBe(before[0]!.logoUrl);
  expect(await database.select().from(schema.technicianSchema).where(eq(schema.technicianSchema.salonId, test.actor.salonId))).toEqual(staff);
});

async function savedCanvaReferenceFixture() {
  const test = await aiCanvaPhotoFixture();
  const reference = await uploadCustomAsset(test.actor, await nativeUploadFile(400, 900, 'My original design.png'), 'reference');
  const brief = await editSetup(test.actor, { expectedRevision: test.saved.head.revision.revision, operationId: randomUUID(), operations: [{ type: 'design_brief', values: { fidelity: 'match', mode: 'keep_design', referenceIds: [reference.id], ownedReferenceIds: [reference.id], websiteAssetIds: [] } }] });
  // This existing immutable artifact records which reference created its
  // artwork. New files do not inherit that provenance from their filenames.
  const saved = await saveCustomSource(test.actor, { expectedRevision: brief.revision.revision, operationId: randomUUID(), source: test.source, assetIds: [...test.saved.artifact.assetIds, reference.id] });
  const uploaded = await uploadCanvaNativePhoto(test.actor, { expectedRevision: saved.head.revision.revision, operationId: randomUUID(), blockId: 'native-photo-gallery', createGallery: true, alt: 'My own wide photo' }, await nativeUploadFile());
  return { ...test, reference, uploaded };
}

function modelImageParts(request: ModelProviderRequest) {
  return request.input.flatMap(item => 'role' in item && item.role === 'user' && Array.isArray(item.content) ? item.content.filter(part => part.type === 'input_image' || part.type === 'input_file') : []);
}

it('uses Luna and saved metadata for photo-only edits with the original design still attached', async () => {
  const test = await savedCanvaReferenceFixture();
  const provider = nativeChatProvider([{ blockId: 'native-photo-gallery', change: { type: 'layout', layout: 'editorial' } }]);
  const result = await runSetupConversation(test.actor, { expectedRevision: test.uploaded.head.revision.revision, operationId: randomUUID(), scope: 'website', referenceIds: [test.reference.id], message: 'Make the first Gallery photo larger. Keep my artwork and settings unchanged.' }, provider);
  const request = provider.createResponse.mock.calls[0]![0];
  const context = nativeChatContext(request);

  expect(provider.createResponse).toHaveBeenCalledTimes(1);
  expect(request.model).toBe('gpt-6-luna');
  expect(modelImageParts(request)).toEqual([]);
  expect(context.selectedDesignAssets).toContainEqual(expect.objectContaining({ id: test.reference.id, ownBusiness: true, contentProvided: false }));
  expect(context.nativePhotos.galleryLayouts).toContainEqual({ id: 'editorial', label: 'Large first photo' });
  expect(result.head.revision.revision).toBe(test.uploaded.head.revision.revision + 1);
  expect((await setupCustomSitePayload(test.actor.salonId, result.head.revision.document))!.source.canva!.nativeContent![0]).toMatchObject({ layout: 'editorial' });
  expect(await database.select().from(schema.customSiteGenerationSchema).where(eq(schema.customSiteGenerationSchema.salonId, test.actor.salonId))).toHaveLength(0);
});

it('still supplies saved own-business artwork for an explicit reading request', async () => {
  const test = await savedCanvaReferenceFixture();
  const provider = nativeChatProvider([{ blockId: 'native-photo-gallery', change: { type: 'layout', layout: 'editorial' } }]);
  await runSetupConversation(test.actor, { expectedRevision: test.uploaded.head.revision.revision, operationId: randomUUID(), scope: 'website', referenceIds: [test.reference.id], message: 'Read my design again and make the first Gallery photo larger.' }, provider);
  const request = provider.createResponse.mock.calls[0]![0];

  expect(request.model).toBe('gpt-6.1-sol');
  expect(modelImageParts(request)).toHaveLength(1);
  expect(nativeChatContext(request).selectedDesignAssets).toContainEqual(expect.objectContaining({ id: test.reference.id, contentProvided: true }));
});

it('does not suppress a newly uploaded reference because its filename matches the original', async () => {
  const test = await savedCanvaReferenceFixture();
  const reference = await uploadCustomAsset(test.actor, await nativeUploadFile(450, 950, 'My original design.png'), 'reference');
  const head = await editSetup(test.actor, { expectedRevision: test.uploaded.head.revision.revision, operationId: randomUUID(), operations: [{ type: 'design_brief', values: { fidelity: 'match', mode: 'keep_design', referenceIds: [test.reference.id, reference.id], ownedReferenceIds: [test.reference.id, reference.id], websiteAssetIds: [] } }] });
  const provider = nativeChatProvider([{ blockId: 'native-photo-gallery', change: { type: 'layout', layout: 'editorial' } }]);
  await runSetupConversation(test.actor, { expectedRevision: head.revision.revision, operationId: randomUUID(), scope: 'website', referenceIds: [test.reference.id, reference.id], message: 'Make the first Gallery photo larger.' }, provider);
  const request = provider.createResponse.mock.calls[0]![0];
  const context = nativeChatContext(request);

  expect(request.model).toBe('gpt-6.1-sol');
  expect(modelImageParts(request)).toHaveLength(1);
  expect(context.selectedDesignAssets).toContainEqual(expect.objectContaining({ id: test.reference.id, contentProvided: false }));
  expect(context.selectedDesignAssets).toContainEqual(expect.objectContaining({ id: reference.id, contentProvided: true }));
});

it('excludes the current Canva page from Gallery choices and rejects a forged use action for it', async () => {
  const test = await aiCanvaPhotoFixture();
  const artworkId = test.source.canva!.pages[0]!.assetId;
  const photo = await uploadCustomAsset(test.actor, await nativeUploadFile(), 'photo');
  const choices = await canvaNativePhotoChoices(test.actor.salonId, test.source.canva);

  expect(choices.some(choice => choice.mediaId === artworkId)).toBe(false);
  expect(choices).toContainEqual(expect.objectContaining({ mediaId: photo.id, role: 'gallery' }));

  await expect(editCanvaNativeContent(test.actor, { expectedRevision: test.saved.head.revision.revision, operationId: randomUUID(), blockId: 'native-photo-gallery', change: { type: 'use', mediaId: artworkId, alt: 'Wrong photo target', createGallery: true } })).rejects.toMatchObject({ code: 'INVALID' });
  expect((await openSetup(test.actor)).revision.revision).toBe(test.saved.head.revision.revision);
});

it('creates About text and an owned photo through chat, then edits the same text manually with idempotent draft writes', async () => {
  const test = await aiCanvaPhotoFixture();
  const photo = await uploadCustomAsset(test.actor, await nativeUploadFile(480, 960, 'My portrait.png'), 'photo');
  const before = (await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, test.actor.salonId)))[0]!;
  const changes: CanvaNativePhotoChange[] = [
    { blockId: 'native-about', change: { type: 'create_about', title: 'Meet the owner', text: 'A calm space for thoughtful nails.' } },
    { blockId: 'native-about', change: { type: 'use', mediaId: photo.id, alt: 'My owner portrait' } },
  ];
  const provider = nativeChatProvider(changes, [{ type: 'website_details', values: { instagram: 'my_studio', sections: [{ id: 'policy', title: 'Booking policy', text: 'Please arrive on time.' }] } }]);
  const input = { expectedRevision: test.saved.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Add an About section with my portrait. Say A calm space for thoughtful nails. Keep my booking policy and Instagram.' };
  const result = await runSetupConversation(test.actor, input, provider);
  const source = (await setupCustomSitePayload(test.actor.salonId, result.head.revision.document))!.source;
  const about = source.canva!.nativeContent!.find(block => block.type === 'about')!;
  const details = result.head.revision.document.website.content.websiteDetails!;

  expect(provider.createResponse).toHaveBeenCalledTimes(1);
  expect(nativeChatContext(provider.createResponse.mock.calls[0]![0]).nativePhotos.canCreateAbout).toBe(true);
  expect(result.head.revision.revision).toBe(input.expectedRevision + 1);
  expect(about).toMatchObject({ type: 'about', textSectionIds: ['canva-about'], image: { mediaId: photo.id, storageKind: 'asset', role: 'profile', width: 480, height: 960 } });
  expect(source.canva!.pages).toEqual(test.source.canva!.pages);
  expect(source.canva!.ownerReviewed).toBe(false);
  expect(source.html).toContain('details.section_canva-about');
  expect(source.html).toContain('details.section_policy');
  expect(details.sections.map(section => section.id)).toEqual(['policy', 'canva-about']);
  expect(details.instagram).toBe('my_studio');
  expect(result.reply).toContain('Added your About section. Changed 1 saved photo. Saved in your draft.');
  expect((await runSetupConversation(test.actor, input, provider)).head.revision.revision).toBe(result.head.revision.revision);
  expect(provider.createResponse).toHaveBeenCalledTimes(1);

  const edit = { expectedRevision: result.head.revision.revision, operationId: randomUUID(), blockId: 'native-about', change: { type: 'about_text', sectionId: 'canva-about', title: 'About our studio', text: 'Welcome to our calm space.' } };
  const manual = await editCanvaNativeContent(test.actor, edit);

  expect((await editCanvaNativeContent(test.actor, edit)).head.revision.revision).toBe(manual.head.revision.revision);
  expect(manual.head.revision.document.website.content.websiteDetails!.sections).toEqual([details.sections[0], { id: 'canva-about', title: 'About our studio', text: 'Welcome to our calm space.' }]);
  await expect(editCanvaNativeContent(test.actor, { ...edit, operationId: randomUUID() })).rejects.toMatchObject({ code: 'STALE' });
  await expect(editCanvaNativeContent(test.actor, { ...edit, expectedRevision: manual.head.revision.revision, operationId: randomUUID(), change: { ...edit.change, sectionId: 'policy' } })).rejects.toMatchObject({ code: 'INVALID' });
  expect((await openSetup(test.actor)).revision.revision).toBe(manual.head.revision.revision);
  expect((await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, test.serviceId)))[0]!.price).toBe(6500);

  const after = (await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, test.actor.salonId)))[0]!;
  const liveFields = (salon: typeof before) => {
    const copy = JSON.parse(JSON.stringify(salon));
    delete copy.updatedAt;
    delete copy.settings.bookingPage.draft;
    delete copy.settings.bookingPageContent.draft;
    return copy;
  };

  expect(liveFields(after)).toEqual(liveFields(before));

  // Simulate an unavailable current native photo. An intact earlier design
  // remains restorable without loading the broken current image.
  const normalRead = assetDataUrl;
  const brokenPhoto = vi.spyOn(customAssetStorage, 'assetDataUrl').mockImplementation(async (asset) => {
    if (asset.id === photo.id) {
      throw new Error('Synthetic current photo storage outage');
    }
    return normalRead(asset);
  });

  const manualSource = (await records(test.actor.salonId)).artifacts.find(artifact => artifact.id === manual.artifactId)!.source;

  await expect(assertCanvaNativeMedia(database as unknown as Parameters<typeof assertCanvaNativeMedia>[0], test.actor.salonId, manualSource.canva, true)).rejects.toThrow('Synthetic current photo storage outage');

  const earlier = await restoreCustomSource(test.actor, { expectedRevision: manual.head.revision.revision, operationId: randomUUID(), artifactId: test.saved.artifact.id }).finally(() => brokenPhoto.mockRestore());

  expect(earlier.head.revision.document.website.content.websiteDetails!.sections).toEqual([details.sections[0]]);
  expect(earlier.head.revision.document.website.content.websiteDetails!.instagram).toBe('my_studio');

  const restored = await restoreCustomSource(test.actor, { expectedRevision: earlier.head.revision.revision, operationId: randomUUID(), artifactId: manual.artifactId });

  expect(restored.head.revision.document.website.content.websiteDetails!.sections).toContainEqual({ id: 'canva-about', title: 'About our studio', text: 'Welcome to our calm space.' });
  expect(restored.head.revision.document.services).toEqual(result.head.revision.document.services);
});

it('recovers About source and shared text atomically after a stopped save without another model call', async () => {
  const test = await aiCanvaPhotoFixture();
  const changes: CanvaNativePhotoChange[] = [{ blockId: 'native-about', change: { type: 'create_about', title: 'Meet me', text: 'My owner supplied introduction.' } }];
  const provider = nativeChatProvider(changes);
  const input = { expectedRevision: test.saved.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Add an About section. Say My owner supplied introduction.' };
  const stopped = vi.spyOn(setupDrafts, 'editSetup').mockRejectedValueOnce(new Error('Synthetic save failure'));
  try {
    await expect(runSetupConversation(test.actor, input, provider)).rejects.toThrow('Finish saving');
  } finally {
    stopped.mockRestore();
  }

  expect((await openSetup(test.actor)).revision.revision).toBe(input.expectedRevision);
  expect((await records(test.actor.salonId)).artifacts).toHaveLength(2);

  const recovered = await recoverNativePhotoConversation(test.actor, input.operationId);
  const replay = await recoverNativePhotoConversation(test.actor, input.operationId);

  expect(provider.createResponse).toHaveBeenCalledTimes(1);
  expect(recovered.head.revision.revision).toBe(input.expectedRevision + 1);
  expect(replay.head.revision.revision).toBe(recovered.head.revision.revision);
  expect(recovered.head.revision.document.website.content.websiteDetails!.sections).toContainEqual({ id: 'canva-about', title: 'Meet me', text: 'My owner supplied introduction.' });
  expect((await setupCustomSitePayload(test.actor.salonId, recovered.head.revision.document))!.source.canva!.nativeContent).toMatchObject([{ type: 'about', textSectionIds: ['canva-about'] }]);
});

it('enforces salon ownership and private-address protection for new About copy without saving a partial source', async () => {
  const test = await aiCanvaPhotoFixture();
  const head = await editSetup(test.actor, { expectedRevision: test.saved.head.revision.revision, operationId: randomUUID(), operations: [{ type: 'business', values: { homeBased: true, exactAddress: '178 Example Private Avenue', locationDisplayMode: 'city_only' } }] });
  const edit = { expectedRevision: head.revision.revision, operationId: randomUUID(), blockId: 'native-about', change: { type: 'create_about', title: 'Visit us', text: 'Find us at 178 Example Private Avenue.' } };

  await expect(editCanvaNativeContent({ ...test.actor, adminId: randomUUID() }, edit)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(editCanvaNativeContent(test.actor, edit)).rejects.toMatchObject({ code: 'INVALID' });
  expect((await openSetup(test.actor)).revision.revision).toBe(head.revision.revision);
  expect((await records(test.actor.salonId)).artifacts).toHaveLength(2);
  expect((await openSetup(test.actor)).revision.document.website.content.websiteDetails?.sections ?? []).not.toContainEqual(expect.objectContaining({ text: edit.change.text }));
});

it('refuses About creation in a price-only request and cannot recover its unvalidated output', async () => {
  const test = await aiCanvaPhotoFixture();
  const provider = nativeChatProvider([{ blockId: 'native-about', change: { type: 'create_about', title: 'Injected', text: 'Do not apply this.' } }]);
  const input = { expectedRevision: test.saved.head.revision.revision, operationId: randomUUID(), scope: 'service_price', message: 'Change Gel to $75.' };

  await expect(runSetupConversation(test.actor, input, provider)).rejects.toMatchObject({ code: 'NOT_READY' });
  await expect(recoverNativePhotoConversation(test.actor, input.operationId)).rejects.toMatchObject({ code: 'NOT_READY' });
  expect((await openSetup(test.actor)).revision.revision).toBe(input.expectedRevision);
  expect((await records(test.actor.salonId)).artifacts).toHaveLength(2);
});

it('repairs a false refusal to edit a separate About heading without regenerating the fixed artwork', async () => {
  const test = await nativeChatFixture();
  const details = test.imported.head.revision.document.website.content.websiteDetails!;
  const section = details.sections.find(section => section.id === test.about.textSectionIds[0])!;
  const refusal = nativeChatResponse([]);
  refusal.items[0]!.text = JSON.stringify({ reply: 'I can’t change the About heading in the current fixed-artwork design. Upload an updated Canva export.', operationsJson: '[]', designRequest: null, uploadFacts: null, nativePhotoChangesJson: null });
  const provider = { createResponse: vi.fn().mockResolvedValueOnce(refusal).mockResolvedValueOnce(nativeChatResponse([{ blockId: test.about.id, change: { type: 'about_text', sectionId: section.id, title: 'Meet the studio', text: section.text } }])) };
  const input = { expectedRevision: test.imported.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Change the About heading to Meet the studio. Keep the wording, photos, artwork and everything else the same.' };
  const result = await runSetupConversation(test.actor, input, provider);
  const payload = (await setupCustomSitePayload(test.actor.salonId, result.head.revision.document))!;
  const calls = await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.operationId, input.operationId));

  expect(provider.createResponse).toHaveBeenCalledTimes(2);
  expect(calls.find(call => call.ordinal === 0)!.validation).toBe('conversation_schema_repaired');
  expect(calls.find(call => call.ordinal === 1)!.validation).toBe('passed');
  expect(result.head.revision.revision).toBe(input.expectedRevision + 1);
  expect(result.head.revision.document.website.content.websiteDetails!.sections).toEqual(details.sections.map(item => item.id === section.id ? { ...item, title: 'Meet the studio' } : item));
  expect(payload.source.canva!.pages).toEqual(test.artifact.source.canva!.pages);
  expect(payload.source.canva!.nativeContent!.find(block => block.type === 'about')).toMatchObject({ title: 'Meet the studio', image: test.about.image });
  expect(await database.select().from(schema.customSiteGenerationSchema).where(eq(schema.customSiteGenerationSchema.salonId, test.actor.salonId))).toHaveLength(0);
});

it('keeps archived Canva pages out of photo choices and rejects invented reuse without relying on filenames', async () => {
  const test = await aiCanvaPhotoFixture();
  const oldPage = await uploadCustomAsset(test.actor, await nativeUploadFile(1200, 480, 'Old design export.png'), 'photo');
  const realPhoto = await uploadCustomAsset(test.actor, await nativeUploadFile(480, 960, 'Canva design - actual salon photo.png'), 'photo');
  const historicalSource = compileCanvaDesign({ ...test.source.canva!, pages: [{ assetId: oldPage.id, width: 1200, height: 480, alt: 'Archived Canva page' }] }, test.saved.head.revision.document.website.content.websiteDetails);
  const historical = await saveCustomSource(test.actor, { expectedRevision: test.saved.head.revision.revision, operationId: randomUUID(), source: historicalSource, assetIds: [...test.saved.artifact.assetIds, oldPage.id] });
  const restored = await restoreCustomSource(test.actor, { expectedRevision: historical.head.revision.revision, operationId: randomUUID(), artifactId: test.saved.artifact.id });
  const choices = await canvaNativePhotoChoices(test.actor.salonId, test.source.canva);
  const baseline = (await records(test.actor.salonId)).artifacts.length;
  const change: CanvaNativePhotoChange = { blockId: 'native-photo-gallery', change: { type: 'use', mediaId: oldPage.id, alt: 'Do not mistake a page for a photo', createGallery: true } };

  expect(choices.some(choice => choice.mediaId === oldPage.id)).toBe(false);
  expect(choices.some(choice => choice.mediaId === test.source.canva!.pages[0]!.assetId)).toBe(false);
  expect(choices).toContainEqual(expect.objectContaining({ mediaId: realPhoto.id, role: 'profile' }));
  expect(choices).toContainEqual(expect.objectContaining({ mediaId: realPhoto.id, role: 'gallery' }));
  await expect(editCanvaNativeContent(test.actor, { expectedRevision: restored.head.revision.revision, operationId: randomUUID(), ...change })).rejects.toMatchObject({ code: 'INVALID' });

  const provider = nativeChatProvider([change]);

  await expect(runSetupConversation(test.actor, { expectedRevision: restored.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Add my saved salon photo to the Gallery.' }, provider)).rejects.toMatchObject({ code: 'NOT_READY' });

  expect(provider.createResponse).toHaveBeenCalledTimes(2);
  expect(nativeChatContext(provider.createResponse.mock.calls[0]![0]).nativePhotos.availablePhotos.some((photo: { mediaId: string }) => photo.mediaId === oldPage.id)).toBe(false);
  expect((await records(test.actor.salonId)).artifacts).toHaveLength(baseline);
  expect((await openSetup(test.actor)).revision.revision).toBe(restored.head.revision.revision);
});

it('preserves explicit native photo placement when the same owned photo was used on a historical page', async () => {
  const test = await aiCanvaPhotoFixture();
  const uploaded = await uploadCanvaNativePhoto(test.actor, { expectedRevision: test.saved.head.revision.revision, operationId: randomUUID(), blockId: 'native-photo-gallery', createGallery: true, alt: 'My saved work photo' }, await nativeUploadFile());
  const source = (await setupCustomSitePayload(test.actor.salonId, uploaded.head.revision.document))!.source;
  const photo = source.canva!.nativeContent!.find(block => block.type === 'gallery')!;
  if (photo.type !== 'gallery') {
    throw new Error('Missing Gallery fixture');
  }
  const image = photo.images[0]!;
  const historicalSource = compileCanvaDesign({ ...source.canva!, pages: [{ assetId: image.mediaId, width: image.width, height: image.height, alt: 'The same photo on a saved page' }] }, uploaded.head.revision.document.website.content.websiteDetails);
  const historical = await saveCustomSource(test.actor, { expectedRevision: uploaded.head.revision.revision, operationId: randomUUID(), source: historicalSource, assetIds: [...test.saved.artifact.assetIds, image.mediaId] });
  const restored = await restoreCustomSource(test.actor, { expectedRevision: historical.head.revision.revision, operationId: randomUUID(), artifactId: uploaded.artifactId });
  const choices = await canvaNativePhotoChoices(test.actor.salonId, source.canva);

  expect(choices).toContainEqual(expect.objectContaining({ mediaId: image.mediaId, role: 'gallery' }));

  const changed = await editCanvaNativeContent(test.actor, { expectedRevision: restored.head.revision.revision, operationId: randomUUID(), blockId: photo.id, change: { type: 'use', mediaId: image.mediaId, replaceId: image.mediaId, alt: 'An updated description of my photo' } });
  const payload = (await setupCustomSitePayload(test.actor.salonId, changed.head.revision.document))!;

  expect(payload.source.canva!.pages).toEqual(test.source.canva!.pages);
  expect(payload.source.canva!.nativeContent).toMatchObject([{ type: 'gallery', images: [{ mediaId: image.mediaId, alt: 'An updated description of my photo' }] }]);
  expect(changed.head.revision.document.services).toEqual(test.saved.head.revision.document.services);
});
