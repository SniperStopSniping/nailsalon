import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { and, asc, eq, sql } from 'drizzle-orm';

import { assertCustomArtifact } from '@/features/custom-sites/artifacts.server';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig.shared';
import { resolveBookingExperience } from '@/libs/bookingExperience';
import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { db } from '@/libs/DB';
import { addOnSchema, adminSalonMembershipSchema, businessSetupApprovalSchema as approvals, businessSetupRevisionSchema as revisions, businessSetupWorkspaceSchema as workspaces, salonLocationSchema, salonSchema, serviceAddOnSchema, serviceSchema, technicianSchema, technicianServicesSchema } from '@/models/Schema';

import type { SetupChange, SetupDocument, SetupReview } from './contracts';
import { applySetupOperations, CLOSED_HOURS, setupEditSchema, SetupError, setupReadiness } from './contracts';

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
export async function readSetupSnapshot(tx: SetupTransaction, salon: typeof salonSchema.$inferSelect) {
  const services = await tx.select().from(serviceSchema).where(eq(serviceSchema.salonId, salon.id)).orderBy(asc(serviceSchema.id));
  const locations = await tx.select().from(salonLocationSchema).where(eq(salonLocationSchema.salonId, salon.id)).orderBy(asc(salonLocationSchema.id));
  const staff = await tx.select().from(technicianSchema).where(eq(technicianSchema.salonId, salon.id)).orderBy(asc(technicianSchema.id));
  const addOns = await tx.select().from(addOnSchema).where(eq(addOnSchema.salonId, salon.id)).orderBy(asc(addOnSchema.id));
  const addOnLinks = await tx.select().from(serviceAddOnSchema).where(eq(serviceAddOnSchema.salonId, salon.id)).orderBy(asc(serviceAddOnSchema.id));
  const assignments = await tx.select({ serviceId: technicianServicesSchema.serviceId, technicianId: technicianServicesSchema.technicianId, enabled: technicianServicesSchema.enabled, priority: technicianServicesSchema.priority }).from(technicianServicesSchema).innerJoin(serviceSchema, eq(serviceSchema.id, technicianServicesSchema.serviceId)).where(eq(serviceSchema.salonId, salon.id)).orderBy(asc(technicianServicesSchema.serviceId), asc(technicianServicesSchema.technicianId));
  const location = locations.find(l => l.isPrimary);
  const page = resolveBookingPageConfig(salon.settings);
  const content = resolveBookingPageContent(salon.settings);
  const document: SetupDocument = {
    schemaVersion: 1,
    business: {
      name: salon.name,
      city: location?.city ?? salon.city ?? '',
      exactAddress: location?.address ?? salon.address ?? '',
      homeBased: salon.settings?.sharedProfile?.businessType === 'home_based',
      workMode: staff.length > 1 ? 'team' : staff.length === 1 ? 'solo' : 'unknown',
      locationDisplayMode: content.live.locationDisplayMode,
    },
    hours: salon.businessHours ?? structuredClone(CLOSED_HOURS),
    booking: resolveBookingConfigFromSettings(salon.settings),
    bookingPolicy: resolveBookingExperience(salon.settings).policy,
    services: services.filter(s => s.isActive).map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      priceCents: s.price,
      durationMinutes: s.durationMinutes,
      preparationBufferMinutes: s.preparationBufferMinutes,
      cleanupBufferMinutes: s.cleanupBufferMinutes,
      category: s.category,
      bookingCategory: s.bookingCategory,
      origin: 'existing',
      confirmed: true,
    })),
    website: { config: page.live, content: content.live },
  };
    // The hash includes untouched fields too: a stale setup must not erase newer
    // changes made through older administration routes.
  const hash = setupHash({ salon, services, locations, staff, addOns, addOnLinks, assignments });
  return { document, hash, page, content, services, locations, staff, assignments };
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
  return { workspace, revision };
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
    draft.website = { config: snapshot.page.draft, content: snapshot.content.draft };
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
    document.website = { config: snapshot.page.draft, content: snapshot.content.draft };
    document.business.locationDisplayMode = document.website.content.locationDisplayMode;
    const revision = head.revision.revision + 1;
    await tx.insert(revisions).values({ salonId: salon.id, workspaceId: head.workspace.id, revision, operationId: randomUUID(), operationHash: setupHash(document), document, actorId: actor.adminId, origin: 'existing' });
    await tx.update(workspaces).set({ status: 'editing', headRevision: revision, baselineHash: snapshot.hash, baseline: snapshot.document, updatedAt: new Date() }).where(eq(workspaces.id, head.workspace.id));
    return loadSetupHead(tx, salon.id);
  });
}
/** Compatibility projection only; setup revisions remain the draft authority. */
export async function projectSetupWebsite(tx: SetupTransaction, salonId: string, document: SetupDocument) {
  const [salon] = await tx.select().from(salonSchema).where(eq(salonSchema.id, salonId));
  if (!salon) {
    throw new SetupError('NOT_FOUND', 'This business is unavailable.');
  }
  const page = { ...resolveBookingPageConfig(salon.settings), draft: document.website.config };
  const content = { ...resolveBookingPageContent(salon.settings), draft: document.website.content };
  await tx.update(salonSchema).set({ settings: sql`jsonb_set(jsonb_set(COALESCE(${salonSchema.settings}, '{}'::jsonb), '{bookingPage}', ${JSON.stringify(page)}::jsonb), '{bookingPageContent}', ${JSON.stringify(content)}::jsonb)` }).where(eq(salonSchema.id, salonId));
  const [updated] = await tx.select().from(salonSchema).where(eq(salonSchema.id, salonId));
  return (await readSetupSnapshot(tx, updated!)).hash;
}

export async function editSetup(actor: SetupActor, input: unknown, origin: 'owner' | 'assistant' | 'upload' = 'owner', transaction?: SetupTransaction) {
  const edit = setupEditSchema.parse(input);
  const apply = async (tx: SetupTransaction) => {
    const salon = await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, salon.id);
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
      if (op.type === 'custom_frontend') {
        await assertCustomArtifact(tx, salon.id, op.artifactId);
      }
    }
    const document = applySetupOperations(head.revision.document, edit.operations, origin);
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
  const changes = setupChanges(head.workspace.baseline, head.revision.document);
  return {
    revision: head.revision.revision,
    hash: setupHash({ workspaceId: head.workspace.id, revision: head.revision.revision, baseline: head.workspace.baselineHash, document: head.revision.document }),
    changes,
    blockers: setupReadiness(head.revision.document),
  };
}
export async function reviewSetup(actor: SetupActor) {
  return db.transaction(async (tx) => {
    const salon = await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, salon.id);
    if ((await readSetupSnapshot(tx, salon)).hash !== head.workspace.baselineHash) {
      throw new SetupError('STALE', 'Your business settings changed elsewhere. Review the newer changes first.');
    }
    return makeSetupReview(head);
  });
}
export async function approveSetup(actor: SetupActor, revision: number, manifestHash: string) {
  return db.transaction(async (tx) => {
    const salon = await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, salon.id);
    const review = makeSetupReview(head);
    if (head.workspace.status !== 'editing' || revision !== review.revision || manifestHash !== review.hash || (await readSetupSnapshot(tx, salon)).hash !== head.workspace.baselineHash) {
      throw new SetupError('STALE', 'Your setup changed. Review the latest version before approving.');
    }
    if (review.blockers.length) {
      throw new SetupError('NOT_READY', review.blockers.join(' '));
    }
    const [approval] = await tx.insert(approvals).values({ id: randomUUID(), salonId: salon.id, workspaceId: head.workspace.id, revision, manifestHash, actorId: actor.adminId, expiresAt: new Date(Date.now() + 30 * 60000) }).returning();
    return approval!;
  });
}
