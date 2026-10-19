import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { assertCustomArtifact } from '@/features/custom-sites/artifacts.server';
import { assetDataUrl } from '@/features/custom-sites/assets.server';
import { publicCustomSiteBookingPolicy } from '@/features/custom-sites/booking-policy';
import { assertCanvaNativeMedia, readCanvaNativeMedia } from '@/features/custom-sites/native-media.server';
import { assertNativePhotoRendererReady } from '@/features/custom-sites/native-renderer.server';
import { customSiteRendererOrigin } from '@/features/custom-sites/payload.server';
import { assertBookingPolicyCoverage, assertWebsiteDetailsCoverage } from '@/features/custom-sites/website-coverage.server';
import { db } from '@/libs/DB';
import { prepareDepositActivation } from '@/libs/depositActivation.server';
import { checkEndpointRateLimit } from '@/libs/rateLimit';
import { auditLogSchema, businessSetupApprovalSchema as approvals, businessSetupPublicationSchema as publications, businessSetupWorkspaceSchema as workspaces, salonAuditLogSchema, salonLocationSchema, salonSchema, serviceSchema, technicianSchema, technicianServicesSchema } from '@/models/Schema';

import { publishSetupAddOns } from './add-on-publication.server';
import { setupDepositActivationNeeded, setupPublishedBookingExtras } from './booking-extras.server';
import { rethrowBookingLinkCollision } from './booking-link.server';
import { setupPolicyInput } from './booking-policy';
import { assertSetupAddressPrivacy, SetupError, WEEKDAYS } from './contracts';
import type { SetupActor } from './drafts.server';
import { loadSetupHead, lockSetupSalon, readSetupSnapshot, reviewSetupHead, stableJson } from './drafts.server';
import { publishedSetupIdentities } from './publication-identities.server';
import { publishSetupStaff } from './staff-publication.server';

const requestSchema = z.object({ approvalId: z.string().uuid(), operationId: z.string().uuid(), revision: z.number().int().positive() }).strict();
/** Only called by the trusted approval UI; deliberately absent from model tools. */
export async function publishSetup(actor: SetupActor, raw: unknown) {
  const input = requestSchema.parse(raw);
  // Authorize and replay BEFORE external work. A lost response never republishes
  // whatever draft happens to exist when the owner retries.
  let customArtifactId: string | undefined;
  let needsDepositActivation = false;
  const replay = await db.transaction(async (tx) => {
    const salon = await lockSetupSalon(tx, actor);
    const [receipt] = await tx.select().from(publications).where(and(eq(publications.salonId, actor.salonId), eq(publications.operationId, input.operationId)));
    if (receipt && (receipt.approvalId !== input.approvalId || receipt.revision !== input.revision)) {
      throw new SetupError('INVALID', 'This publication request was already used.');
    }
    if (!receipt) {
      const head = await loadSetupHead(tx, salon.id);
      customArtifactId = head.revision.document.website.config.customFrontendId;
      needsDepositActivation = setupDepositActivationNeeded(salon, head.revision.document);
      const review = await reviewSetupHead(tx, head);
      const [approval] = await tx.select().from(approvals).where(and(eq(approvals.id, input.approvalId), eq(approvals.salonId, salon.id), eq(approvals.workspaceId, head.workspace.id)));
      if (!approval || approval.actorId !== actor.adminId || approval.expiresAt.getTime() <= Date.now() || approval.revision !== input.revision || approval.manifestHash !== review.hash || head.workspace.status !== 'editing' || review.revision !== input.revision) {
        throw new SetupError('APPROVAL_REQUIRED', 'Review and approve the latest changes before publishing.');
      }
      if (review.blockers.length) {
        throw new SetupError('NOT_READY', review.blockers.join(' '));
      }
      if ((await readSetupSnapshot(tx, salon)).hash !== head.workspace.baselineHash) {
        throw new SetupError('STALE', 'Your business changed elsewhere. Review those changes before publishing.');
      }
    }
    return receipt ? { receipt, salonSlug: salon.slug } : null;
  });
  if (replay) {
    return { ...replay, mediaFinalized: replay.receipt.mediaFinalized };
  }
  if (customArtifactId) {
    const { media, artifact } = await assertCustomArtifact(db, actor.salonId, customArtifactId);
    for (const asset of media.filter(a => a.role !== 'reference')) {
      await assetDataUrl(asset);
    }
    // Existing photo objects stay private. The exact committed publication
    // authorizes their read route, so there is no external promotion to undo.
    const nativeMedia = await assertCanvaNativeMedia(db, actor.salonId, artifact.source.canva);
    if (nativeMedia.length) {
      await assertNativePhotoRendererReady();
    }
    for (const image of nativeMedia) {
      await readCanvaNativeMedia(image, true);
    }
  }
  if (needsDepositActivation && !checkEndpointRateLimit('admin/salon/settings/deposit-enable', actor.salonId, 'BILLING').allowed) {
    throw new SetupError('NOT_READY', 'Payment checks are temporarily busy. Wait a moment, then retry your saved publication.');
  }
  const depositActivation = needsDepositActivation ? await prepareDepositActivation(actor.salonId) : null;
  if (depositActivation && !depositActivation.ok) {
    throw new SetupError('NOT_READY', depositActivation.body.message);
  }
  // This slice publishes only reviewed canonical configuration. Pending
  // onboarding media is deliberately not promoted as an unrelated side effect.
  // Asset promotion requires its own reviewed asset identities in the draft.
  const publication = await db.transaction(async (tx) => {
    const salon = await lockSetupSalon(tx, actor);
    const [already] = await tx.select().from(publications).where(and(eq(publications.salonId, salon.id), eq(publications.operationId, input.operationId)));
    if (already) {
      if (already.approvalId !== input.approvalId || already.revision !== input.revision) {
        throw new SetupError('INVALID', 'This publication request was already used.');
      }
      return { receipt: already, salonSlug: salon.slug };
    }
    const head = await loadSetupHead(tx, salon.id);
    const review = await reviewSetupHead(tx, head);
    const [approval] = await tx.select().from(approvals).where(and(eq(approvals.id, input.approvalId), eq(approvals.salonId, salon.id), eq(approvals.workspaceId, head.workspace.id)));
    if (!approval || approval.actorId !== actor.adminId || approval.expiresAt.getTime() <= Date.now() || approval.revision !== input.revision || approval.manifestHash !== review.hash || head.workspace.status !== 'editing' || review.revision !== input.revision) {
      throw new SetupError('APPROVAL_REQUIRED', 'Review and approve the latest changes before publishing.');
    }
    if (review.blockers.length) {
      throw new SetupError('NOT_READY', review.blockers.join(' '));
    }
    // Older manual staff/catalog routes may not lock the salon. Lock the rows
    // we can change before comparing the baseline, so we observe their commits
    // instead of overwriting a newer schedule or assignment after the check.
    const current = await readSetupSnapshot(tx, salon, true);
    if (current.hash !== head.workspace.baselineHash) {
      throw new SetupError('STALE', 'Your business changed elsewhere. Review those changes before publishing.');
    }
    const draft = head.revision.document;
    assertSetupAddressPrivacy(draft);
    if (draft.website.config.customFrontendId) {
      if (!customSiteRendererOrigin()) {
        throw new SetupError('NOT_READY', 'Your website preview is not available yet. Please try again before publishing.');
      }
      const { artifact } = await assertCustomArtifact(tx, salon.id, draft.website.config.customFrontendId);
      assertWebsiteDetailsCoverage(artifact.source.html, draft.website.content.websiteDetails);
      if (!artifact.source.canva) {
        assertBookingPolicyCoverage(artifact.source.html, publicCustomSiteBookingPolicy(draft.bookingPolicy));
      }
      if (draft.business.exactAddress && draft.business.locationDisplayMode !== 'full_address' && JSON.stringify(artifact.source).toLowerCase().includes(draft.business.exactAddress.toLowerCase())) {
        throw new SetupError('INVALID', 'Remove your private address from the design before publishing.');
      }
    }
    if (salon.publicationStatus === 'published' && (draft.booking.currency !== current.document.booking.currency || draft.booking.timezone !== current.document.booking.timezone)) {
      throw new SetupError('INVALID', 'Currency and time zone changes need a separate review for an existing business.');
    }
    const serviceIds: Record<string, string> = {};
    const resolveIdentity = await publishedSetupIdentities(tx, salon.id, [...draft.services.map(service => service.id), ...(draft.addOns?.map(addOn => addOn.id) ?? []), ...(draft.staff?.map(person => person.id) ?? [])], { workspaceId: head.workspace.id, namespace: draft.identityNamespace, legacyRevision: head.revision.revision });
    const usedServiceIds = new Set<string>();
    // New services follow the reviewed menu order. Preserve every existing
    // canonical position, including manual gaps; never order by random IDs.
    let nextNewServiceSortOrder = current.services.reduce((maximum, service) => Math.max(maximum, service.sortOrder ?? -1), -1) + 1;
    for (const service of draft.services) {
      if (service.priceCents === null || service.durationMinutes === null || !service.confirmed) {
        throw new SetupError('NOT_READY', 'Review all service prices and times first.');
      }
      const recordId = resolveIdentity('services', service.id);
      const baselineService = current.document.services.find(s => s.id === recordId);
      if (recordId && !baselineService) {
        throw new SetupError('INVALID', 'A previously saved service is no longer active. Review your current menu instead.');
      }
      if (recordId && usedServiceIds.has(recordId)) {
        throw new SetupError('INVALID', 'This draft contains the same saved service twice. Review the menu before publishing.');
      }
      if (recordId) {
        usedServiceIds.add(recordId);
      }
      if (baselineService && stableJson(baselineService) === stableJson(service)) {
        serviceIds[service.id] = baselineService.id;
        continue;
      }
      const values = {
        name: service.name,
        description: service.description,
        price: service.priceCents,
        ...(service.priceDisplayText !== undefined ? { priceDisplayText: service.priceDisplayText } : {}),
        durationMinutes: service.durationMinutes,
        preparationBufferMinutes: service.preparationBufferMinutes,
        cleanupBufferMinutes: service.cleanupBufferMinutes,
        category: service.category,
        bookingCategory: service.bookingCategory,
      };
      if (!baselineService && service.id.startsWith('draft_') && !recordId) {
        if (nextNewServiceSortOrder > 2_147_483_647) {
          throw new SetupError('INVALID', 'Your menu order needs review. Open Services to reorder it before publishing.');
        }
        const id = randomUUID();
        await tx.insert(serviceSchema).values({ id, salonId: salon.id, sortOrder: nextNewServiceSortOrder++, ...values });
        serviceIds[service.id] = id;
      } else {
        if (!baselineService) {
          throw new SetupError('INVALID', 'A service does not belong to this business draft.');
        }
        const [updated] = await tx.update(serviceSchema).set(values).where(and(eq(serviceSchema.id, baselineService.id), eq(serviceSchema.salonId, salon.id))).returning();
        if (!updated) {
          throw new SetupError('STALE', 'A service changed elsewhere. Reload your setup.');
        }
        serviceIds[service.id] = updated.id;
      }
    }
    const addOnIds = await publishSetupAddOns(tx, salon.id, current, draft, serviceIds, resolveIdentity);
    const bookingExtras = await setupPublishedBookingExtras(tx, salon, draft, depositActivation?.ok ? depositActivation : null);
    let location = current.locations.find(l => l.isPrimary);
    if (!location) {
      [location] = await tx.insert(salonLocationSchema).values({ id: randomUUID(), salonId: salon.id, name: 'Primary location', isPrimary: true, address: draft.business.exactAddress || null, city: draft.business.city, businessHours: draft.hours }).returning();
    } else if (stableJson(draft.business) !== stableJson(current.document.business) || stableJson(draft.hours) !== stableJson(current.document.hours)) {
      await tx.update(salonLocationSchema).set({ address: draft.business.exactAddress || null, city: draft.business.city, businessHours: draft.hours }).where(and(eq(salonLocationSchema.id, location.id), eq(salonLocationSchema.salonId, salon.id)));
    }
    const staffIds = await publishSetupStaff(tx, salon.id, current, draft, serviceIds, location!.id, resolveIdentity);
    if (!current.staff.length && !draft.staff?.length && draft.business.workMode !== 'solo') {
      throw new SetupError('NOT_READY', 'Add your team and service assignments before publishing this setup.');
    }
    if (!current.staff.length && !draft.staff?.length) {
      const technicianId = randomUUID();
      const weeklySchedule = Object.fromEntries(WEEKDAYS.map(day => [day, draft.hours[day] ? { start: draft.hours[day]!.open, end: draft.hours[day]!.close } : null]));
      await tx.insert(technicianSchema).values({ id: technicianId, salonId: salon.id, name: salon.ownerName || draft.business.name, weeklySchedule, primaryLocationId: location!.id, onboardingStatus: 'completed' });
      for (const serviceId of Object.values(serviceIds)) {
        await tx.insert(technicianServicesSchema).values({ technicianId, serviceId, enabled: true });
      }
    }
    const settings = {
      ...(salon.settings ?? {}),
      ...bookingExtras,
      sharedProfile: { ...(salon.settings?.sharedProfile ?? {}), ...(draft.business.homeBased ? { businessType: 'home_based' as const } : current.document.business.homeBased ? { businessType: 'independent_salon' as const } : {}) },
      booking: draft.booking,
      ...(draft.bookingPolicyEdited ? { bookingExperience: { ...(salon.settings?.bookingExperience ?? {}), policy: setupPolicyInput(draft.bookingPolicy) } } : {}),
      bookingPage: { ...current.page, draft: draft.website.config, live: draft.website.config, livePresetBase: current.page.draftPresetBase },
      bookingPageContent: { ...current.content, draft: draft.website.content, live: draft.website.content },
    };
    const publishedAt = new Date();
    const publishedSlug = draft.siteSlug ?? salon.slug;
    await tx.update(salonSchema).set({
      slug: publishedSlug,
      name: draft.business.name,
      city: draft.business.city,
      address: draft.business.locationDisplayMode === 'full_address' ? draft.business.exactAddress || null : null,
      businessHours: draft.hours,
      settings,
      publicationStatus: 'published',
      onlineBookingEnabled: salon.publicationStatus === 'published' ? salon.onlineBookingEnabled : true,
      publishedAt: salon.publishedAt ?? publishedAt,
      slugLockedAt: salon.slugLockedAt ?? publishedAt,
    }).where(eq(salonSchema.id, salon.id));
    if (publishedSlug !== salon.slug) {
      // Reuse the existing authenticated former-slug resolver, including after
      // a lost response. This is a lookup hint, never an authorization token.
      await tx.insert(salonAuditLogSchema).values({ id: randomUUID(), salonId: salon.id, action: 'updated', performedBy: actor.adminId, metadata: { field: 'slug', previousValue: salon.slug, newValue: publishedSlug, details: 'Owner-approved first booking link' } });
    }
    const [created] = await tx.insert(publications).values({ id: randomUUID(), salonId: salon.id, workspaceId: head.workspace.id, revision: review.revision, operationId: input.operationId, approvalId: approval.id, actorId: actor.adminId, serviceIds, staffIds, addOnIds, publishedAt, mediaFinalized: true }).returning();
    await tx.insert(auditLogSchema).values({ id: randomUUID(), salonId: salon.id, actorType: 'admin', actorId: actor.adminId, action: 'settings_updated', entityType: 'business_setup_publication', entityId: created!.id, metadata: { revision: review.revision, changedFields: review.changes.map(c => c.path) } });
    await tx.update(workspaces).set({ status: 'published', updatedAt: publishedAt }).where(eq(workspaces.id, head.workspace.id));
    return { receipt: created!, salonSlug: publishedSlug };
  }).catch(rethrowBookingLinkCollision);
  return { ...publication, mediaFinalized: true };
}
