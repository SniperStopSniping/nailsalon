import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { assertCustomArtifact } from '@/features/custom-sites/artifacts.server';
import { assetDataUrl } from '@/features/custom-sites/assets.server';
import { customSiteRendererOrigin } from '@/features/custom-sites/payload.server';
import { db } from '@/libs/DB';
import { auditLogSchema, businessSetupApprovalSchema as approvals, businessSetupPublicationSchema as publications, businessSetupWorkspaceSchema as workspaces, salonLocationSchema, salonSchema, serviceSchema, technicianSchema, technicianServicesSchema } from '@/models/Schema';

import { SetupError, WEEKDAYS } from './contracts';
import type { SetupActor } from './drafts.server';
import { loadSetupHead, lockSetupSalon, makeSetupReview, readSetupSnapshot, stableJson } from './drafts.server';

const requestSchema = z.object({ approvalId: z.string().uuid(), operationId: z.string().uuid(), revision: z.number().int().positive() }).strict();
/** Only called by the trusted approval UI; deliberately absent from model tools. */
export async function publishSetup(actor: SetupActor, raw: unknown) {
  const input = requestSchema.parse(raw);
  // Authorize and replay BEFORE external work. A lost response never republishes
  // whatever draft happens to exist when the owner retries.
  let customArtifactId: string | undefined;
  const replay = await db.transaction(async (tx) => {
    const salon = await lockSetupSalon(tx, actor);
    const [receipt] = await tx.select().from(publications).where(and(eq(publications.salonId, actor.salonId), eq(publications.operationId, input.operationId)));
    if (receipt && (receipt.approvalId !== input.approvalId || receipt.revision !== input.revision)) {
      throw new SetupError('INVALID', 'This publication request was already used.');
    }
    if (!receipt) {
      const head = await loadSetupHead(tx, salon.id);
      customArtifactId = head.revision.document.website.config.customFrontendId;
      const review = makeSetupReview(head);
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
    return receipt ?? null;
  });
  if (replay) {
    return { receipt: replay, mediaFinalized: replay.mediaFinalized };
  }
  if (customArtifactId) {
    const { media } = await assertCustomArtifact(db, actor.salonId, customArtifactId);
    for (const asset of media.filter(a => a.role !== 'reference')) {
      await assetDataUrl(asset);
    }
  }
  // This slice publishes only reviewed canonical configuration. Pending
  // onboarding media is deliberately not promoted as an unrelated side effect.
  // Asset promotion requires its own reviewed asset identities in the draft.
  const receipt = await db.transaction(async (tx) => {
    const salon = await lockSetupSalon(tx, actor);
    const [already] = await tx.select().from(publications).where(and(eq(publications.salonId, salon.id), eq(publications.operationId, input.operationId)));
    if (already) {
      if (already.approvalId !== input.approvalId || already.revision !== input.revision) {
        throw new SetupError('INVALID', 'This publication request was already used.');
      }
      return already;
    }
    const head = await loadSetupHead(tx, salon.id);
    const review = makeSetupReview(head);
    const [approval] = await tx.select().from(approvals).where(and(eq(approvals.id, input.approvalId), eq(approvals.salonId, salon.id), eq(approvals.workspaceId, head.workspace.id)));
    if (!approval || approval.actorId !== actor.adminId || approval.expiresAt.getTime() <= Date.now() || approval.revision !== input.revision || approval.manifestHash !== review.hash || head.workspace.status !== 'editing' || review.revision !== input.revision) {
      throw new SetupError('APPROVAL_REQUIRED', 'Review and approve the latest changes before publishing.');
    }
    if (review.blockers.length) {
      throw new SetupError('NOT_READY', review.blockers.join(' '));
    }
    const current = await readSetupSnapshot(tx, salon);
    if (current.hash !== head.workspace.baselineHash) {
      throw new SetupError('STALE', 'Your business changed elsewhere. Review those changes before publishing.');
    }
    const draft = head.revision.document;
    if (draft.website.config.customFrontendId) {
      if (!customSiteRendererOrigin()) {
        throw new SetupError('NOT_READY', 'Your website preview is not available yet. Please try again before publishing.');
      }
      const { artifact } = await assertCustomArtifact(tx, salon.id, draft.website.config.customFrontendId);
      if (draft.business.exactAddress && draft.business.locationDisplayMode !== 'full_address' && JSON.stringify(artifact.source).toLowerCase().includes(draft.business.exactAddress.toLowerCase())) {
        throw new SetupError('INVALID', 'Remove your private address from the design before publishing.');
      }
    }
    if (salon.publicationStatus === 'published' && (draft.booking.currency !== current.document.booking.currency || draft.booking.timezone !== current.document.booking.timezone)) {
      throw new SetupError('INVALID', 'Currency and time zone changes need a separate review for an existing business.');
    }
    // Until appointment-impact review is available, do not widen this initial
    // solo checkpoint into existing-salon schedule changes.
    if (salon.publicationStatus === 'published' && stableJson(draft.hours) !== stableJson(current.document.hours)) {
      throw new SetupError('NOT_READY', 'Changes to existing business hours need an appointment-impact review.');
    }
    const serviceIds: Record<string, string> = {};
    for (const service of draft.services) {
      if (service.priceCents === null || service.durationMinutes === null || !service.confirmed) {
        throw new SetupError('NOT_READY', 'Review all service prices and times first.');
      }
      const baselineService = current.document.services.find(s => s.id === service.id);
      if (baselineService && stableJson(baselineService) === stableJson(service)) {
        serviceIds[service.id] = service.id;
        continue;
      }
      const values = {
        name: service.name,
        description: service.description,
        price: service.priceCents,
        durationMinutes: service.durationMinutes,
        preparationBufferMinutes: service.preparationBufferMinutes,
        cleanupBufferMinutes: service.cleanupBufferMinutes,
        category: service.category,
        bookingCategory: service.bookingCategory,
      };
      if (!baselineService && service.id.startsWith('draft_')) {
        const id = randomUUID();
        await tx.insert(serviceSchema).values({ id, salonId: salon.id, ...values });
        serviceIds[service.id] = id;
      } else {
        if (!baselineService) {
          throw new SetupError('INVALID', 'A service does not belong to this business draft.');
        }
        const [updated] = await tx.update(serviceSchema).set(values).where(and(eq(serviceSchema.id, service.id), eq(serviceSchema.salonId, salon.id))).returning();
        if (!updated) {
          throw new SetupError('STALE', 'A service changed elsewhere. Reload your setup.');
        }
        serviceIds[service.id] = updated.id;
      }
    }
    let location = current.locations.find(l => l.isPrimary);
    if (!location) {
      [location] = await tx.insert(salonLocationSchema).values({ id: randomUUID(), salonId: salon.id, name: 'Primary location', isPrimary: true, address: draft.business.exactAddress || null, city: draft.business.city, businessHours: draft.hours }).returning();
    } else if (stableJson(draft.business) !== stableJson(current.document.business) || stableJson(draft.hours) !== stableJson(current.document.hours)) {
      await tx.update(salonLocationSchema).set({ address: draft.business.exactAddress || null, city: draft.business.city, businessHours: draft.hours }).where(and(eq(salonLocationSchema.id, location.id), eq(salonLocationSchema.salonId, salon.id)));
    }
    if (!current.staff.length && draft.business.workMode !== 'solo') {
      throw new SetupError('NOT_READY', 'Add your team and service assignments before publishing this setup.');
    }
    if (!current.staff.length) {
      const technicianId = randomUUID();
      const weeklySchedule = Object.fromEntries(WEEKDAYS.map(day => [day, draft.hours[day] ? { start: draft.hours[day]!.open, end: draft.hours[day]!.close } : null]));
      await tx.insert(technicianSchema).values({ id: technicianId, salonId: salon.id, name: salon.ownerName || draft.business.name, weeklySchedule, primaryLocationId: location!.id, onboardingStatus: 'completed' });
      for (const serviceId of Object.values(serviceIds)) {
        await tx.insert(technicianServicesSchema).values({ technicianId, serviceId, enabled: true });
      }
    }
    const settings = {
      ...(salon.settings ?? {}),
      sharedProfile: { ...(salon.settings?.sharedProfile ?? {}), ...(draft.business.homeBased ? { businessType: 'home_based' as const } : current.document.business.homeBased ? { businessType: 'independent_salon' as const } : {}) },
      booking: draft.booking,
      bookingPage: { ...current.page, draft: draft.website.config, live: draft.website.config, livePresetBase: current.page.draftPresetBase },
      bookingPageContent: { ...current.content, draft: draft.website.content, live: draft.website.content },
    };
    const publishedAt = new Date();
    await tx.update(salonSchema).set({
      name: draft.business.name,
      city: draft.business.city,
      address: draft.business.locationDisplayMode === 'full_address' ? draft.business.exactAddress || null : null,
      businessHours: draft.hours,
      settings,
      publicationStatus: 'published',
      onlineBookingEnabled: true,
      publishedAt: salon.publishedAt ?? publishedAt,
      slugLockedAt: salon.slugLockedAt ?? publishedAt,
    }).where(eq(salonSchema.id, salon.id));
    const [created] = await tx.insert(publications).values({ id: randomUUID(), salonId: salon.id, workspaceId: head.workspace.id, revision: review.revision, operationId: input.operationId, approvalId: approval.id, actorId: actor.adminId, serviceIds, publishedAt, mediaFinalized: true }).returning();
    await tx.insert(auditLogSchema).values({ id: randomUUID(), salonId: salon.id, actorType: 'admin', actorId: actor.adminId, action: 'settings_updated', entityType: 'business_setup_publication', entityId: created!.id, metadata: { revision: review.revision, changedFields: review.changes.map(c => c.path) } });
    await tx.update(workspaces).set({ status: 'published', updatedAt: publishedAt }).where(eq(workspaces.id, head.workspace.id));
    return created!;
  });
  return { receipt, mediaFinalized: true };
}
