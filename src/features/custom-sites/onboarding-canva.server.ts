import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { SetupError } from '@/features/business-setup/contracts';
import type { SetupActor, SetupTransaction } from '@/features/business-setup/drafts.server';
import { editSetup, loadSetupHead, lockSetupSalon, openSetup, setupHash } from '@/features/business-setup/drafts.server';
import { onboardingArtworkAssetId } from '@/features/onboarding-v1-integration/artwork-storage-key';
import { onboardingCompiledSiteDocumentSchema, onboardingPersistedSnapshotSchema } from '@/features/onboarding-v1-integration/contracts';
import { readOnboardingMediaFile } from '@/features/onboarding-v1-integration/media-storage.server';
import { db } from '@/libs/DB';
import { customSiteArtifactSchema as artifacts, customSiteAssetSchema as assets, onboardingSiteMediaSchema as media, onboardingSiteRevisionSchema as revisions, onboardingSiteSchema as sites } from '@/models/Schema';

import { SITE_PALETTE_BY_ID } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/palettes';
import { storeCustomArtifact } from './artifacts.server';
import { assetDataUrl, assetIsIntact, ownedAssets } from './assets.server';
import { canvaNativeImages } from './canva-native-content';
import { manualCanvaSource } from './manual-canva.server';
import { onboardingCanvaOperationId as handoffOperationId } from './manual-origin.server';
import { canvaNativePhotosEnabled } from './native-renderer.server';
import { onboardingCanvaContent } from './onboarding-canva-content';
import { customSiteDataFromSetup } from './setup-data';
import { EMPTY_WEBSITE_DETAILS, websiteDetailsSchema } from './website-details';

/** Reuse ready legacy bytes as well; do not make an owner upload them again. */
async function artworkAsset(tx: SetupTransaction, actor: SetupActor, row: typeof media.$inferSelect) {
  if (row.salonId !== actor.salonId || row.role !== 'custom_design' || row.claimStatus !== 'ready' || !row.storageKey || row.mimeType !== 'image/webp' || !row.width || !row.height) {
    throw new SetupError('NOT_READY', 'Your design images have not finished saving. Retry them before continuing.');
  }
  const alias = onboardingArtworkAssetId(row.storageKey, { salonId: actor.salonId, siteId: row.siteId });
  if (alias) {
    const [asset] = await ownedAssets(tx, actor.salonId, [alias]);
    if (asset!.role !== 'photo' || asset!.mimeType !== 'image/webp') {
      throw new SetupError('INVALID', 'Your saved design image needs checking.');
    }
    await assetDataUrl(asset!);
    return asset!;
  }
  const bytes = await readOnboardingMediaFile(row.storageKey, { salonId: actor.salonId, siteId: row.siteId });
  const hash = createHash('sha256').update(bytes).digest('hex');
  const previous = await tx.select().from(assets).where(and(eq(assets.salonId, actor.salonId), eq(assets.role, 'photo'), eq(assets.hash, hash)));
  for (const asset of previous) {
    if (await assetIsIntact(asset)) {
      return asset;
    }
  }
  const library = await tx.select({ byteSize: assets.byteSize }).from(assets).where(eq(assets.salonId, actor.salonId));
  if (library.length >= 24 || library.reduce((sum, item) => sum + item.byteSize, 0) + bytes.byteLength > 15000000) {
    throw new SetupError('NOT_READY', 'Your image library is full. Remove unused uploads before continuing.');
  }
  // This immutable ready row already owns the private object. A new library
  // reference adopts its existing bytes without copying or overwriting them.
  const [asset] = await tx.insert(assets).values({ id: randomUUID(), salonId: actor.salonId, actorId: actor.adminId, role: 'photo', name: row.fileName.slice(0, 120), mimeType: 'image/webp', storageKey: row.storageKey, byteSize: bytes.byteLength, hash }).returning();
  return asset!;
}

/** Atomically connect an exact saved manual revision to the ordinary shared draft. */
export async function importOnboardingCanva(actor: SetupActor, input: { siteId: string; expectedRevision: number }) {
  return db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    const [site] = await tx.select().from(sites).where(and(eq(sites.id, input.siteId), eq(sites.salonId, actor.salonId), eq(sites.isCurrent, true))).for('update');
    if (!site || site.status === 'archived') {
      throw new SetupError('NOT_FOUND', 'This saved design is unavailable.');
    }
    if (site.currentRevision !== input.expectedRevision) {
      throw new SetupError('STALE', 'Your saved website changed. Reload its latest version before continuing.');
    }
    const [revision] = await tx.select().from(revisions).where(and(eq(revisions.siteId, site.id), eq(revisions.salonId, actor.salonId), eq(revisions.revision, input.expectedRevision)));
    const parsed = onboardingCompiledSiteDocumentSchema.safeParse(revision?.document);
    if (!revision || !parsed.success) {
      throw new SetupError('INVALID', 'Your saved design needs checking. Return to your setup and save it again.');
    }
    const operationId = handoffOperationId(site.id, revision.id);
    const [previous] = await tx.select().from(artifacts).where(and(eq(artifacts.salonId, actor.salonId), eq(artifacts.operationId, operationId)));
    if (previous) {
      // An interrupted response resumes the latest shared draft. It never
      // reimports the old source over subsequent manual or AI edits.
      return { head: await loadSetupHead(tx, actor.salonId), artifactId: previous.id, alreadyImported: true };
    }
    const document = parsed.data;
    const snapshot = onboardingPersistedSnapshotSchema.safeParse(revision.snapshot);
    if (!snapshot.success) {
      throw new SetupError('INVALID', 'Your saved business details need checking. Return to your setup and save it again.');
    }
    const pages = [...document.pages].filter(page => page.visible).sort((a, b) => a.order - b.order);
    const supported = new Set(['custom_design', 'booking', 'services', 'featured_services', 'visit', 'visit_us', 'contact', 'hours', 'footer', 'final_cta', 'section_navigation', 'about', 'gallery', 'reviews']);
    if (pages.some(page => page.sections.some(section => section.visible && !supported.has(section.type)))) {
      throw new SetupError('NOT_READY', 'Some parts of this manual layout still need connecting. Your complete original draft is saved. Return to your setup before continuing.');
    }
    const sections = pages.flatMap(page => [...page.sections].filter(section => section.visible).sort((a, b) => a.order - b.order).filter(section => section.type === 'custom_design').map(section => ({ id: section.id, pageId: page.id, settings: section.customDesignSettings! })));
    if (!sections.length || sections.some(section => !section.settings)) {
      throw new SetupError('INVALID', 'Add your Canva design before continuing.');
    }
    const logicalIds = [...new Set(sections.flatMap(section => section.settings.images.map(image => image.id)))];
    const rows = await tx.select().from(media).where(and(eq(media.salonId, actor.salonId), eq(media.siteId, site.id), eq(media.revisionId, revision.id)));
    const images = new Map<string, { assetId: string; width: number; height: number }>();
    for (const id of logicalIds) {
      const row = rows.find(row => row.localItemId === id && row.role === 'custom_design');
      if (!row) {
        throw new SetupError('NOT_READY', 'Your design images have not finished saving. Retry them before continuing.');
      }
      const asset = await artworkAsset(tx, actor, row);
      images.set(id, { assetId: asset.id, width: row.width!, height: row.height! });
    }
    let head = await openSetup(actor, tx);
    if (head.workspace.status !== 'editing') {
      throw new SetupError('STALE', 'Open your current website to start a new edit before importing this design.');
    }
    const internalAnchors = new Map<string, string>();
    for (const section of sections) {
      internalAnchors.set(section.id, `#manual-section-${createHash('sha256').update(section.id).digest('hex').slice(0, 24)}`);
      if (!internalAnchors.has(section.pageId)) {
        internalAnchors.set(section.pageId, `#manual-page-${createHash('sha256').update(section.pageId).digest('hex').slice(0, 24)}`);
      }
    }
    for (const page of pages) {
      for (const section of page.sections.filter(section => section.visible && ['booking', 'services', 'featured_services'].includes(section.type))) {
        internalAnchors.set(section.id, '#luster-canva-booking');
      }
    }
    for (const page of pages) {
      for (const section of page.sections.filter(section => section.visible && ['about', 'gallery', 'reviews'].includes(section.type))) {
        internalAnchors.set(section.id, `#manual-section-${createHash('sha256').update(section.id).digest('hex').slice(0, 24)}`);
      }
    }
    const native = onboardingCanvaContent(document, snapshot.data, rows, internalAnchors);
    if (canvaNativeImages(native.blocks).length && !canvaNativePhotosEnabled()) {
      throw new SetupError('NOT_READY', 'Connecting your About and Gallery photos is not available yet. Your complete original design is saved.');
    }
    const details = structuredClone(head.revision.document.website.content.websiteDetails ?? EMPTY_WEBSITE_DETAILS);
    const profile = snapshot.data.profile;
    if (!profile.bookingOnlyContact) {
      details.instagram ||= profile.instagram.trim() || null;
      details.email ||= profile.email.trim() || null;
      if (profile.clientContact.callEnabled || profile.clientContact.textEnabled) {
        details.phone ||= profile.clientContact.primaryNumber.trim() || null;
      }
    }
    if (!websiteDetailsSchema.safeParse(details).success) {
      throw new SetupError('NOT_READY', 'Check your saved Instagram, email and phone details before continuing. Your original design is saved.');
    }
    native.blocks = native.blocks.map(block => block.type === 'about' ? { ...block, showInstagram: block.showInstagram && Boolean(details.instagram) } : block);
    if (native.textSections.length) {
      details.sections = [...details.sections.filter(section => section.id !== 'manual_about' && !section.id.startsWith('manual_about_')), ...native.textSections];
      if (details.sections.length > 20) {
        throw new SetupError('NOT_READY', 'This design has too much About text to connect at once. Shorten it in your saved design before continuing.');
      }
    }
    if (setupHash(details) !== setupHash(head.revision.document.website.content.websiteDetails ?? EMPTY_WEBSITE_DETAILS)) {
      head = await editSetup(actor, { expectedRevision: head.revision.revision, operationId: handoffOperationId(site.id, `${revision.id}:about`), operations: [{ type: 'website_details', values: details }] }, 'owner', tx);
    }
    const source = manualCanvaSource({ sections, images, nativeContent: native.blocks, data: customSiteDataFromSetup(head.revision.document), origin: { siteId: site.id, revisionId: revision.id, revision: revision.revision }, siteBackground: SITE_PALETTE_BY_ID[document.palettePresetId].roles.ground, visibility: { hours: snapshot.data.profile.hours.showOnSite, location: true }, privateAddress: head.revision.document.business.locationDisplayMode !== 'full_address' ? head.revision.document.business.exactAddress : undefined, internalAnchors });
    const artifact = await storeCustomArtifact(actor, { source, assetIds: [...new Set([...images.values()].map(image => image.assetId))], expectedRevision: head.revision.revision, operationId }, tx);
    const next = await editSetup(actor, { expectedRevision: head.revision.revision, operationId, operations: [{ type: 'custom_frontend', artifactId: artifact.id }] }, 'owner', tx);
    return { head: next, artifactId: artifact.id, alreadyImported: false };
  });
}
