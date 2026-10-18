import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { and, asc, eq, sql } from 'drizzle-orm';

import { assertAiCreditExecution } from '@/features/ai-credits/context.server';
import { assertCustomArtifact } from '@/features/custom-sites/artifacts.server';
import { ownedAssets } from '@/features/custom-sites/assets.server';
import { canvaDraftBlockers } from '@/features/custom-sites/canva-data.server';
import { customSourceImageIds } from '@/features/custom-sites/validate.server';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig.shared';
import { resolveBookingExperience } from '@/libs/bookingExperience';
import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { db } from '@/libs/DB';
import { addOnSchema, adminSalonMembershipSchema, auditLogSchema, businessSetupApprovalSchema as approvals, businessSetupRevisionSchema as revisions, businessSetupTurnSchema as turns, businessSetupWorkspaceSchema as workspaces, customSiteGenerationSchema as designs, salonLocationSchema, salonSchema, serviceAddOnSchema, serviceSchema, technicianSchema, technicianServicesSchema } from '@/models/Schema';

import { setupAppointmentImpact } from './appointment-impact.server';
import { setupBookingExtraBlockers, setupBookingExtraEffects, setupBookingExtrasFromSettings, setupDepositActivationNeeded, setupDepositApprovalAccount, setupReminderNotices } from './booking-extras.server';
import { canChooseSetupBookingLink, setupBookingLinkBlockers } from './booking-link.server';
import { hydrateSetupPolicy, setupPolicyInput } from './booking-policy';
import type { SetupChange, SetupDocument, SetupReview } from './contracts';
import { applySetupOperations, CLOSED_HOURS, setupEditSchema, SetupError, setupReadiness, setupResetSchema } from './contracts';
import { publishedSetupIdentities } from './publication-identities.server';
import { setupServiceDisplayOrder } from './service-order';
import { hydrateSetupServicePricing } from './service-pricing';
import { setupStaffFromSnapshot } from './staff';
import type { SetupValueContext } from './value-sources';

export type SetupTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type SetupActor = {
  salonId: string;
  adminId: string;
};
export function stableJson(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
}
export function setupHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}
/** Repeat membership authorization within the transaction, including after a job wait. */
export async function lockSetupSalon(tx: SetupTransaction, actor: SetupActor) {
  const [membership] = await tx.select().from(adminSalonMembershipSchema)
    .where(and(eq(adminSalonMembershipSchema.adminId, actor.adminId), eq(adminSalonMembershipSchema.salonId, actor.salonId), eq(adminSalonMembershipSchema.role, 'owner'))).for('share');
  if (!membership) {
    throw new SetupError('FORBIDDEN', 'Only an owner of this business can make these changes.');
  }
  const [salon] = await tx.select().from(salonSchema).where(eq(salonSchema.id, actor.salonId)).for('update');
  if (!salon) {
    throw new SetupError('NOT_FOUND', 'This business is unavailable.');
  }
  return salon;
}
export async function readSetupSnapshot(tx: SetupTransaction, salon: typeof salonSchema.$inferSelect, lockRows = false) {
  const servicesQuery = tx.select().from(serviceSchema).where(eq(serviceSchema.salonId, salon.id)).orderBy(asc(serviceSchema.id));
  const services = await (lockRows ? servicesQuery.for('update') : servicesQuery);
  const locationsQuery = tx.select().from(salonLocationSchema).where(eq(salonLocationSchema.salonId, salon.id)).orderBy(asc(salonLocationSchema.id));
  const locations = await (lockRows ? locationsQuery.for('update') : locationsQuery);
  const staffQuery = tx.select().from(technicianSchema).where(eq(technicianSchema.salonId, salon.id)).orderBy(asc(technicianSchema.id));
  const staff = await (lockRows ? staffQuery.for('update') : staffQuery);
  const addOnsQuery = tx.select().from(addOnSchema).where(eq(addOnSchema.salonId, salon.id)).orderBy(asc(addOnSchema.id));
  const addOns = await (lockRows ? addOnsQuery.for('update') : addOnsQuery);
  const addOnLinksQuery = tx.select().from(serviceAddOnSchema).where(eq(serviceAddOnSchema.salonId, salon.id)).orderBy(asc(serviceAddOnSchema.id));
  const addOnLinks = await (lockRows ? addOnLinksQuery.for('update') : addOnLinksQuery);
  const assignmentsQuery = tx.select({ serviceId: technicianServicesSchema.serviceId, technicianId: technicianServicesSchema.technicianId, enabled: technicianServicesSchema.enabled, priority: technicianServicesSchema.priority }).from(technicianServicesSchema).innerJoin(serviceSchema, eq(serviceSchema.id, technicianServicesSchema.serviceId)).where(eq(serviceSchema.salonId, salon.id)).orderBy(asc(technicianServicesSchema.serviceId), asc(technicianServicesSchema.technicianId));
  const assignments = await (lockRows ? assignmentsQuery.for('update', { of: technicianServicesSchema }) : assignmentsQuery);
  const location = locations.find(l => l.isPrimary);
  const page = resolveBookingPageConfig(salon.settings);
  const content = resolveBookingPageContent(salon.settings);
  const document: SetupDocument = {
    schemaVersion: 1,
    siteSlug: salon.slug,
    ...setupBookingExtrasFromSettings(salon),
    business: {
      name: salon.name,
      city: location?.city ?? salon.city ?? '',
      exactAddress: location?.address ?? salon.address ?? '',
      homeBased: salon.settings?.sharedProfile?.businessType === 'home_based',
      workMode: staff.length > 1 ? 'team' : staff.length === 1 ? 'solo' : 'unknown',
      locationDisplayMode: content.live.locationDisplayMode,
    },
    hours: salon.businessHours ?? structuredClone(CLOSED_HOURS),
    ...(salon.businessHours ? { hoursOrigin: 'existing' as const } : {}),
    booking: resolveBookingConfigFromSettings(salon.settings),
    bookingPolicy: resolveBookingExperience(salon.settings, { includeAcknowledgmentConfiguration: true }).policy,
    staff: setupStaffFromSnapshot(staff, assignments).map(person => ({ ...person, serviceIds: person.serviceIds.filter(id => services.some(service => service.id === id && service.isActive)) })),
    staffUsesExplicitAssignments: staff.some(person => person.isActive && assignments.some(assignment => assignment.technicianId === person.id)),
    services: setupServiceDisplayOrder(services.filter(s => s.isActive)).map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      priceCents: s.price,
      priceDisplayText: s.priceDisplayText,
      durationMinutes: s.durationMinutes,
      preparationBufferMinutes: s.preparationBufferMinutes,
      cleanupBufferMinutes: s.cleanupBufferMinutes,
      category: s.category,
      bookingCategory: s.bookingCategory,
      origin: 'existing',
      confirmed: true,
    })),
    servicePricingVersion: 1,
    addOns: addOns.map(addOn => ({
      id: addOn.id,
      name: addOn.name,
      category: addOn.category,
      descriptionItems: addOn.descriptionItems,
      priceCents: addOn.priceCents,
      priceDisplayText: addOn.priceDisplayText,
      durationMinutes: addOn.durationMinutes,
      pricingType: addOn.pricingType,
      unitLabel: addOn.unitLabel,
      maxQuantity: addOn.maxQuantity,
      isActive: addOn.isActive === true,
      serviceIds: addOnLinks.filter(link => link.addOnId === addOn.id && services.some(service => service.id === link.serviceId && service.isActive)).map(link => link.serviceId).sort(),
      groupId: addOn.groupId,
      advancedRules: addOnLinks.some(link => link.addOnId === addOn.id && (link.selectionMode !== 'optional' || link.priceMode !== 'catalog_priced' || link.conditions !== null || link.defaultQuantity !== null || link.maxQuantityOverride !== null)),
      origin: 'existing',
      confirmed: true,
    })),
    website: { config: page.live, content: content.live },
  };
    // The hash includes untouched fields too: a stale setup must not erase newer
    // changes made through older administration routes.
  const hash = setupHash({ salon, services, locations, staff, addOns, addOnLinks, assignments });
  return { document, hash, page, content, services, locations, staff, assignments, addOns, addOnLinks };
}
export async function loadSetupHead(tx: SetupTransaction, salonId: string) {
  const [workspace] = await tx.select().from(workspaces).where(eq(workspaces.salonId, salonId));
  if (!workspace) {
    throw new SetupError('NOT_FOUND', 'Start your business setup first.');
  }
  const [revision] = await tx.select().from(revisions).where(and(eq(revisions.salonId, salonId), eq(revisions.workspaceId, workspace.id), eq(revisions.revision, workspace.headRevision)));
  if (!revision) {
    throw new SetupError('NOT_FOUND', 'The saved draft is unavailable.');
  }
  const [identity] = await tx.select({ slug: salonSchema.slug, publicationStatus: salonSchema.publicationStatus, slugLockedAt: salonSchema.slugLockedAt }).from(salonSchema).where(eq(salonSchema.id, salonId));
  if (!identity) {
    throw new SetupError('NOT_FOUND', 'This business is unavailable.');
  }
  // Read adapter only; immutable old JSON remains unchanged. New review hashes
  // require fresh approval when a legacy draft first gains its booking address.
  const site = { salonSlug: identity.slug, canChooseBookingLink: canChooseSetupBookingLink(identity) };
  workspace.baseline = { ...workspace.baseline, siteSlug: workspace.baseline.siteSlug ?? identity.slug };
  revision.document = { ...revision.document, siteSlug: revision.document.siteSlug ?? identity.slug };
  if (revision.document.deposit === undefined || workspace.baseline.deposit === undefined || revision.document.reminders === undefined || workspace.baseline.reminders === undefined || revision.document.addOns === undefined || workspace.baseline.addOns === undefined || revision.document.staff === undefined || workspace.baseline.staff === undefined || revision.document.bookingPolicy?.acknowledgment === undefined || workspace.baseline.bookingPolicy?.acknowledgment === undefined || revision.document.servicePricingVersion !== 1 || workspace.baseline.servicePricingVersion !== 1) {
    const [salon] = await tx.select().from(salonSchema).where(eq(salonSchema.id, salonId));
    if (!salon) {
      throw new SetupError('NOT_FOUND', 'This business is unavailable.');
    }
    const current = await readSetupSnapshot(tx, salon);
    // Read adapter for pre-team JSON revisions. Immutable historical rows and
    // approvals are untouched; every write still checks the original baseline.
    const policy = (saved: SetupDocument['bookingPolicy']) => hydrateSetupPolicy(saved, current.document.bookingPolicy);
    const baseline = hydrateSetupServicePricing({ ...workspace.baseline, addOns: workspace.baseline.addOns ?? current.document.addOns, bookingPolicy: policy(workspace.baseline.bookingPolicy), staff: workspace.baseline.staff ?? current.document.staff, staffUsesExplicitAssignments: workspace.baseline.staffUsesExplicitAssignments ?? current.document.staffUsesExplicitAssignments }, current.document);
    baseline.deposit ??= current.document.deposit;
    baseline.reminders ??= current.document.reminders;
    return { ...site, workspace: { ...workspace, baseline }, revision: { ...revision, document: hydrateSetupServicePricing({ ...revision.document, deposit: revision.document.deposit ?? baseline.deposit, reminders: revision.document.reminders ?? baseline.reminders, addOns: revision.document.addOns ?? baseline.addOns, bookingPolicy: policy(revision.document.bookingPolicy), staff: revision.document.staff ?? current.document.staff, staffUsesExplicitAssignments: revision.document.staffUsesExplicitAssignments ?? current.document.staffUsesExplicitAssignments }, baseline) } };
  }
  return { ...site, workspace, revision };
}
export async function openSetup(actor: SetupActor) {
  return db.transaction(async (tx) => {
    const salon = await lockSetupSalon(tx, actor);
    const [existing] = await tx.select().from(workspaces).where(eq(workspaces.salonId, salon.id));
    if (existing) {
      return loadSetupHead(tx, salon.id);
    }
    const snapshot = await readSetupSnapshot(tx, salon);
    const id = randomUUID();
    const draft = structuredClone(snapshot.document);
    draft.identityNamespace = randomUUID();
    draft.website = { config: snapshot.page.draft, content: snapshot.content.draft };
    // Legacy public-page defaults are not an owner's choice to expose a new
    // address. Preserve explicit choices and existing published presentations.
    const savedContent = (salon.settings as { bookingPageContent?: { draft?: { locationDisplayMode?: unknown }; live?: { locationDisplayMode?: unknown } } } | null)?.bookingPageContent;
    if (salon.publicationStatus !== 'published' && savedContent?.draft?.locationDisplayMode === undefined && savedContent?.live?.locationDisplayMode === undefined) {
      draft.website.content.locationDisplayMode = 'city_only';
    }
    draft.business.locationDisplayMode = draft.website.content.locationDisplayMode;
    await tx.insert(workspaces).values({ id, salonId: salon.id, headRevision: 1, baselineHash: snapshot.hash, baseline: snapshot.document });
    await tx.insert(revisions).values({ salonId: salon.id, workspaceId: id, revision: 1, operationId: randomUUID(), operationHash: setupHash(draft), document: draft, actorId: actor.adminId, origin: 'existing' });
    return loadSetupHead(tx, salon.id);
  });
}
/** A return visit starts from today's canonical settings, never old answers. */
export async function restartSetup(actor: SetupActor, expectedRevision: number) {
  return db.transaction(async (tx) => {
    const salon = await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, salon.id);
    if (head.revision.revision !== expectedRevision || head.workspace.status !== 'published') {
      throw new SetupError('STALE', 'Your setup changed. Reload the saved changes first.');
    }
    const snapshot = await readSetupSnapshot(tx, salon);
    const document = structuredClone(snapshot.document);
    document.identityNamespace = randomUUID();
    document.sessionStartRevision = head.revision.document.sessionStartRevision;
    document.previousDraftRevision = head.revision.document.previousDraftRevision;
    document.website = { config: snapshot.page.draft, content: snapshot.content.draft };
    document.business.locationDisplayMode = document.website.content.locationDisplayMode;
    if (document.website.config.customFrontendId === head.revision.document.website.config.customFrontendId) {
      document.designBrief = head.revision.document.designBrief;
    }
    const revision = head.revision.revision + 1;
    await tx.insert(revisions).values({ salonId: salon.id, workspaceId: head.workspace.id, revision, operationId: randomUUID(), operationHash: setupHash(document), document, actorId: actor.adminId, origin: 'existing' });
    await tx.update(workspaces).set({ status: 'editing', headRevision: revision, baselineHash: snapshot.hash, baseline: snapshot.document, updatedAt: new Date() }).where(eq(workspaces.id, head.workspace.id));
    return loadSetupHead(tx, salon.id);
  });
}
/** Full draft reset: no model call, deletion, live write or budget reset. */
export async function resetSetupDraft(actor: SetupActor, raw: unknown, restore = false) {
  const input = setupResetSchema.parse(raw);
  return db.transaction(async (tx) => {
    const salon = await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, salon.id);
    const operationHash = setupHash({ action: restore ? 'restore_previous' : 'reset', input });
    const [replay] = await tx.select().from(revisions).where(and(eq(revisions.workspaceId, head.workspace.id), eq(revisions.operationId, input.operationId)));
    if (replay) {
      if (replay.operationHash !== operationHash) {
        throw new SetupError('INVALID', 'This request was already used for different changes.');
      }
      return head;
    }
    if (head.revision.revision !== input.expectedRevision) {
      throw new SetupError('STALE', 'Your saved work changed. Load the latest changes before starting over.');
    }
    const snapshot = await readSetupSnapshot(tx, salon);
    if (head.workspace.status === 'editing' && snapshot.hash !== head.workspace.baselineHash) {
      throw new SetupError('STALE', 'Your business settings changed elsewhere. Load the latest changes before starting over.');
    }
    const jobs = await tx.select().from(designs).where(eq(designs.salonId, salon.id));
    const terminal = new Set(jobs.filter(job => ['completed', 'failed'].includes(job.status)).map(job => job.id));
    const messages = await tx.select().from(turns).where(eq(turns.workspaceId, head.workspace.id));
    if (jobs.some(job => job.status === 'pending' && job.createdAt.getTime() > Date.now() - 300000) || messages.some(turn => ['pending', 'generated'].includes(turn.status) && turn.leaseExpiresAt.getTime() > Date.now() && !(turn.designOperationId && terminal.has(turn.designOperationId)))) {
      throw new SetupError('NOT_READY', 'Luster is still finishing your last request. Wait for it to finish before starting over.');
    }
    let document = structuredClone(snapshot.document);
    if (restore) {
      const previousRevision = head.revision.document.previousDraftRevision;
      const [previous] = previousRevision ? await tx.select().from(revisions).where(and(eq(revisions.workspaceId, head.workspace.id), eq(revisions.salonId, salon.id), eq(revisions.revision, previousRevision))) : [];
      if (!previous) {
        throw new SetupError('NOT_FOUND', 'There is no earlier draft to restore.');
      }
      document = structuredClone(previous.document);
      // An old draft cannot rename an already published salon when restored.
      if (!canChooseSetupBookingLink(salon)) {
        document.siteSlug = salon.slug;
      }
      const resolveIdentity = await publishedSetupIdentities(tx, salon.id, [...document.services.map(service => service.id), ...(document.addOns?.flatMap(addOn => [addOn.id, ...addOn.serviceIds]) ?? []), ...(document.staff?.flatMap(person => [person.id, ...person.serviceIds]) ?? [])], { workspaceId: head.workspace.id, namespace: document.identityNamespace, legacyRevision: previous.revision, restoring: true });
      document.services = document.services.map(service => ({ ...service, id: resolveIdentity('services', service.id) ?? service.id }));
      if (document.serviceSources) {
        document.serviceSources = Object.fromEntries(Object.entries(document.serviceSources).map(([id, sources]) => [resolveIdentity('services', id) ?? id, sources]));
      }
      document = hydrateSetupServicePricing(document, snapshot.document);
      // A restoration must not hide services created since the archived draft,
      // or recreate temporary IDs that publication already mapped to live rows.
      document.services = [...snapshot.document.services.filter(service => !document.services.some(saved => saved.id === service.id)), ...document.services];
      document.addOns = document.addOns?.map(addOn => ({ ...addOn, id: resolveIdentity('addOns', addOn.id) ?? addOn.id, serviceIds: addOn.serviceIds.map(id => resolveIdentity('services', id) ?? id) })) ?? snapshot.document.addOns;
      if (document.addOnSources) {
        document.addOnSources = Object.fromEntries(Object.entries(document.addOnSources).map(([id, sources]) => [resolveIdentity('addOns', id) ?? id, sources]));
      }
      document.addOns = [...(snapshot.document.addOns ?? []).filter(addOn => !document.addOns?.some(saved => saved.id === addOn.id)), ...(document.addOns ?? [])];
      document.staff = document.staff?.map(person => ({ ...person, id: resolveIdentity('staff', person.id) ?? person.id, serviceIds: person.serviceIds.map(id => resolveIdentity('services', id) ?? id) })) ?? snapshot.document.staff;
      document.staff = [...(snapshot.document.staff ?? []).filter(person => !document.staff?.some(saved => saved.id === person.id)), ...(document.staff ?? [])];
      document.staffUsesExplicitAssignments = snapshot.document.staffUsesExplicitAssignments;
      document.staffEdited = stableJson(document.staff) !== stableJson(snapshot.document.staff);
      document.bookingPolicy = hydrateSetupPolicy(document.bookingPolicy, snapshot.document.bookingPolicy);
      document.bookingPolicyEdited = Boolean(document.bookingPolicy && stableJson(setupPolicyInput(document.bookingPolicy)) !== stableJson(setupPolicyInput(snapshot.document.bookingPolicy)));
      document.deposit ??= snapshot.document.deposit;
      document.reminders ??= snapshot.document.reminders;
      document.depositEditedFields = (['enabled', 'amountCents'] as const).filter(key => document.deposit?.[key] !== snapshot.document.deposit?.[key]);
      document.remindersEditedFields = (['rules', 'quietHours'] as const).filter(key => stableJson(document.reminders?.[key]) !== stableJson(snapshot.document.reminders?.[key]));
      if (document.website.config.customFrontendId) {
        await assertCustomArtifact(tx, salon.id, document.website.config.customFrontendId);
      }
      if (document.designBrief) {
        await ownedAssets(tx, salon.id, [...document.designBrief.referenceIds, ...document.designBrief.websiteAssetIds]);
      }
    } else {
      document.identityNamespace = randomUUID();
      // Read confirmed business values from live records, never the projected
      // draft or an earlier uploaded business. Unpublished answers disappear.
      document.website = { config: resolveBookingPageConfig(null).draft, content: resolveBookingPageContent(null).draft };
      if (salon.publicationStatus !== 'published') {
        document.business.locationDisplayMode = 'city_only';
      }
      document.website.content.locationDisplayMode = document.business.locationDisplayMode;
      document.designBrief = { fidelity: 'inspiration', referenceIds: [], ownedReferenceIds: [], websiteAssetIds: [] };
    }
    const revision = head.revision.revision + 1;
    document.sessionStartRevision = revision;
    document.previousDraftRevision = head.revision.revision;
    await tx.insert(revisions).values({ salonId: salon.id, workspaceId: head.workspace.id, revision, operationId: input.operationId, operationHash, document, actorId: actor.adminId, origin: restore ? 'owner_restore' : 'owner_reset' });
    const baselineHash = await projectSetupWebsite(tx, salon.id, document);
    await tx.update(workspaces).set({ status: 'editing', headRevision: revision, baseline: snapshot.document, baselineHash, updatedAt: new Date() }).where(eq(workspaces.id, head.workspace.id));
    return loadSetupHead(tx, salon.id);
  });
}
/** Compatibility projection only; setup revisions remain the draft authority. */
export async function projectSetupWebsite(tx: SetupTransaction, salonId: string, document: SetupDocument) {
  const [salon] = await tx.select().from(salonSchema).where(eq(salonSchema.id, salonId));
  if (!salon) {
    throw new SetupError('NOT_FOUND', 'This business is unavailable.');
  }
  const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const savedSettings = record(salon.settings);
  // Write only the draft side. Expanding resolver defaults here would also
  // materialize previously absent live values during a harmless draft edit.
  const page = { ...record(savedSettings.bookingPage), version: 1, draft: document.website.config, draftPresetBase: resolveBookingPageConfig(salon.settings).draftPresetBase };
  const content = { ...record(savedSettings.bookingPageContent), version: 1, draft: document.website.content };
  await tx.update(salonSchema).set({ settings: sql`jsonb_set(jsonb_set(COALESCE(${salonSchema.settings}, '{}'::jsonb), '{bookingPage}', ${JSON.stringify(page)}::jsonb), '{bookingPageContent}', ${JSON.stringify(content)}::jsonb)` }).where(eq(salonSchema.id, salonId));
  const [updated] = await tx.select().from(salonSchema).where(eq(salonSchema.id, salonId));
  return (await readSetupSnapshot(tx, updated!)).hash;
}

export async function editSetup(actor: SetupActor, input: unknown, origin: 'owner' | 'assistant' | 'upload' = 'owner', transaction?: SetupTransaction, valueContext?: SetupValueContext) {
  const edit = setupEditSchema.parse(input);
  const apply = async (tx: SetupTransaction) => {
    const salon = await lockSetupSalon(tx, actor);
    if (origin === 'assistant') {
      await assertAiCreditExecution(tx, actor);
    }
    const head = await loadSetupHead(tx, salon.id);
    if (edit.expectedRevision < (head.revision.document.sessionStartRevision ?? 1)) {
      throw new SetupError('STALE', 'You started over since this change. Your new draft is safe.');
    }
    const operationHash = setupHash({ edit, origin });
    const [previous] = await tx.select().from(revisions).where(and(eq(revisions.workspaceId, head.workspace.id), eq(revisions.operationId, edit.operationId)));
    if (previous) {
      if (previous.operationHash !== operationHash) {
        throw new SetupError('INVALID', 'This request was already used for different changes.');
      }
      return { ...head, revision: previous };
    }
    if (head.workspace.status !== 'editing' || head.workspace.headRevision !== edit.expectedRevision) {
      throw new SetupError('STALE', 'Your setup has changed. Reload the latest saved version before editing.');
    }
    const snapshot = await readSetupSnapshot(tx, salon);
    if (snapshot.hash !== head.workspace.baselineHash) {
      throw new SetupError('STALE', 'Your business settings changed elsewhere. Review the newer changes before continuing.');
    }
    for (const op of edit.operations) {
      if (op.type === 'site_url' && !canChooseSetupBookingLink(salon)) {
        throw new SetupError('INVALID', 'Your published booking link stays the same. Contact Luster if your business needs a new address.');
      }
      if (op.type === 'import_upload') {
        const owned = head.revision.document.designBrief?.ownedReferenceIds ?? [];
        const references = await ownedAssets(tx, salon.id, op.referenceIds);
        if (references.some(asset => asset.role !== 'reference' || !owned.includes(asset.id))) {
          throw new SetupError('FORBIDDEN', 'Only your own attached design or menu can supply business details.');
        }
      }
      if (op.type === 'design_brief') {
        const media = await ownedAssets(tx, salon.id, [...op.values.referenceIds, ...op.values.websiteAssetIds]);
        if (media.some(asset => (op.values.referenceIds.includes(asset.id) && asset.role !== 'reference') || (op.values.websiteAssetIds.includes(asset.id) && asset.role === 'reference'))) {
          throw new SetupError('INVALID', 'Keep design references separate from the photos and logo used on your website.');
        }
      }
      if (op.type === 'custom_frontend') {
        await assertCustomArtifact(tx, salon.id, op.artifactId);
      }
    }
    const editing = { ...head.revision.document, staff: head.revision.document.staff ?? snapshot.document.staff, staffUsesExplicitAssignments: head.revision.document.staffUsesExplicitAssignments ?? snapshot.document.staffUsesExplicitAssignments };
    const operations = edit.operations.map((operation) => {
      if (operation.type !== 'staff') {
        return operation;
      }
      const current = snapshot.document.staff?.find(person => person.id === operation.values.id);
      const proposed = editing.staff?.find(person => person.id === operation.values.id);
      return { ...operation, values: { ...operation.values, hours: operation.values.hours ?? proposed?.hours ?? null, serviceIds: current && operation.values.assignmentMode === 'preserve' ? current.serviceIds : operation.values.serviceIds } };
    });
    const document = applySetupOperations(editing, operations, origin, valueContext);
    // Restoring an earlier source also restores its photo selection. Otherwise a
    // later AI edit could resurrect the selection from a different design.
    if (origin === 'owner' && document.designBrief && !edit.operations.some(op => op.type === 'design_brief') && edit.operations.some(op => op.type === 'custom_frontend')) {
      const { artifact, media } = await assertCustomArtifact(tx, salon.id, document.website.config.customFrontendId!);
      const used = customSourceImageIds(artifact.source.html);
      const referenceIds = media.filter(asset => asset.role === 'reference').map(asset => asset.id).slice(0, 6);
      document.designBrief = { ...document.designBrief, mode: artifact.source.canva ? 'keep_design' : 'rebuild', referenceIds, ownedReferenceIds: artifact.source.canva ? referenceIds : document.designBrief.ownedReferenceIds.filter(id => referenceIds.includes(id)), websiteAssetIds: artifact.source.canva ? [] : media.filter(asset => asset.role !== 'reference' && used.has(asset.id)).map(asset => asset.id).slice(0, 6) };
    }
    const revision = head.workspace.headRevision + 1;
    await tx.insert(revisions).values({ salonId: salon.id, workspaceId: head.workspace.id, revision, operationId: edit.operationId, operationHash, document, actorId: actor.adminId, origin });
    const baselineHash = await projectSetupWebsite(tx, salon.id, document);
    await tx.update(workspaces).set({ headRevision: revision, baselineHash, updatedAt: new Date() }).where(eq(workspaces.id, head.workspace.id));
    return loadSetupHead(tx, salon.id);
  };
  return transaction ? apply(transaction) : db.transaction(apply);
}
export function setupChanges(before: unknown, after: unknown, path = ''): SetupChange[] {
  if (stableJson(before) === stableJson(after)) {
    return [];
  }
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    const left = before as Record<string, unknown>;
    const right = after as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap(key => setupChanges(left[key], right[key], path ? `${path}.${key}` : key));
  }
  return [{ path, before: before ?? null, after: after ?? null }];
}
export function makeSetupReview(head: Awaited<ReturnType<typeof loadSetupHead>>): SetupReview {
  const changes = setupChanges(head.workspace.baseline, head.revision.document).filter(change => !['depositEditedFields', 'remindersEditedFields', 'bookingPolicyEdited', 'identityNamespace', 'sessionStartRevision', 'previousDraftRevision', 'hoursOrigin', 'staffUsesExplicitAssignments', 'staffEdited', 'bookingPolicy.version', 'servicePricingVersion'].includes(change.path)
    && !['serviceSources', 'addOnSources'].some(path => change.path === path || change.path.startsWith(`${path}.`)));
  return {
    revision: head.revision.revision,
    hash: setupHash({ workspaceId: head.workspace.id, revision: head.revision.revision, baseline: head.workspace.baselineHash, document: head.revision.document }),
    changes,
    blockers: setupReadiness(head.revision.document),
  };
}
export async function reviewSetup(actor: SetupActor) {
  const result = await db.transaction(async (tx) => {
    const salon = await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, salon.id);
    if ((await readSetupSnapshot(tx, salon)).hash !== head.workspace.baselineHash) {
      throw new SetupError('STALE', 'Your business settings changed elsewhere. Review the newer changes first.');
    }
    return { review: await reviewSetupHead(tx, head), document: head.revision.document };
  });
  return { ...result.review, notices: [...result.review.notices ?? [], ...await setupReminderNotices(actor.salonId, result.document)] };
}
export async function reviewSetupHead(tx: SetupTransaction, head: Awaited<ReturnType<typeof loadSetupHead>>) {
  const review = makeSetupReview(head);
  const [configurationSalon] = await tx.select().from(salonSchema).where(eq(salonSchema.id, head.workspace.salonId));
  if (!configurationSalon) {
    throw new SetupError('NOT_FOUND', 'This business is unavailable.');
  }
  review.blockers.push(...await setupBookingLinkBlockers(tx, configurationSalon, head.revision.document));
  review.blockers.push(...await setupBookingExtraBlockers(tx, configurationSalon, head.revision.document));
  const effects = setupBookingExtraEffects(configurationSalon, head.revision.document);
  review.changes.push(...effects.changes);
  review.notices = effects.notices;
  if (setupDepositActivationNeeded(configurationSalon, head.revision.document)) {
    review.hash = setupHash({ draftHash: review.hash, depositAccount: await setupDepositApprovalAccount(tx, configurationSalon.id) });
  }
  if (head.workspace.baseline.business && head.workspace.status === 'editing') {
    if (configurationSalon.publicationStatus === 'published') {
      if (head.revision.document.booking.currency !== head.workspace.baseline.booking.currency || head.revision.document.booking.timezone !== head.workspace.baseline.booking.timezone) {
        review.blockers.push('Currency and time zone changes need a separate review for an existing business.');
      }
      review.appointmentImpact = await setupAppointmentImpact(tx, head.workspace.salonId, head.workspace.baseline, head.revision.document);
      if (review.appointmentImpact) {
        review.hash = setupHash({ draftHash: review.hash, appointmentFingerprint: review.appointmentImpact.fingerprint });
      }
    }
  }
  const id = head.revision.document.website.config.customFrontendId;
  if (id) {
    const { artifact } = await assertCustomArtifact(tx, head.workspace.salonId, id);
    review.blockers.push(...canvaDraftBlockers(head.revision.document, artifact.source));
  }
  return review;
}
export async function approveSetup(actor: SetupActor, revision: number, manifestHash: string, acknowledgeAppointments = false) {
  return db.transaction(async (tx) => {
    const salon = await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, salon.id);
    const review = await reviewSetupHead(tx, head);
    if (head.workspace.status !== 'editing' || revision !== review.revision || manifestHash !== review.hash || (await readSetupSnapshot(tx, salon)).hash !== head.workspace.baselineHash) {
      throw new SetupError('STALE', 'Your setup changed. Review the latest version before approving.');
    }
    if (review.blockers.length) {
      throw new SetupError('NOT_READY', review.blockers.join(' '));
    }
    if (review.appointmentImpact && (review.appointmentImpact.outsideHoursCount > 0 || review.appointmentImpact.staffAffectedCount > 0) && acknowledgeAppointments !== true) {
      throw new SetupError('APPROVAL_REQUIRED', 'Confirm that your existing appointments will stay as booked before approving these changes.');
    }
    const [approval] = await tx.insert(approvals).values({ id: randomUUID(), salonId: salon.id, workspaceId: head.workspace.id, revision, manifestHash, actorId: actor.adminId, expiresAt: new Date(Date.now() + 30 * 60000) }).returning();
    if (review.appointmentImpact) {
      await tx.insert(auditLogSchema).values({ id: randomUUID(), salonId: salon.id, actorType: 'admin', actorId: actor.adminId, action: 'settings_updated', entityType: 'business_setup_approval', entityId: approval!.id, metadata: { revision, appointmentImpact: review.appointmentImpact, acknowledgedExistingAppointments: acknowledgeAppointments } });
    }
    return approval!;
  });
}
