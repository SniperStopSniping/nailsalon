import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { reviewCanvaArtwork, saveCustomSource } from '@/features/custom-sites/artifacts.server';
import * as customArtifacts from '@/features/custom-sites/artifacts.server';
import { assetDataUrl, MAX_WEBSITE_IMAGE_BYTES, ownedAssets, uploadCustomAsset } from '@/features/custom-sites/assets.server';
import type { CanvaArea } from '@/features/custom-sites/canva';
import { compileCanvaDesign } from '@/features/custom-sites/canva';
import { canvaWebsiteImage } from '@/features/custom-sites/canva-assets.server';
import { canvaDataFingerprint, canvaServiceKey } from '@/features/custom-sites/canva-data.server';
import { replaceCanvaPage } from '@/features/custom-sites/canva-replace.server';
import { generateCustomSite, resumeCustomSite } from '@/features/custom-sites/generate.server';
import { editCustomMedia } from '@/features/custom-sites/media-edit.server';
import { customSitePayload } from '@/features/custom-sites/payload.server';
import { customSiteDataFromSetup } from '@/features/custom-sites/setup-data';
import { revokeCustomPreview, shareCustomPreview, sharedCustomPreview } from '@/features/custom-sites/share.server';
import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { synchronizeBookingPageLifecycle } from '@/libs/bookingPageLifecycle';
import sharp from '@/libs/safeSharp.server';
import * as schema from '@/models/Schema';

import { darkSource, editorialSource } from '../../../tests/browser/businessSetup/custom-design-fixtures';
import { estimateSetupAiCost, runSetupModel } from './ai-trial.server';
import { applySetupOperations, CLOSED_HOURS, setupReadiness, setupServiceSchema } from './contracts';
import { runSetupConversation } from './conversation.server';
import { approveSetup, editSetup, openSetup, readSetupSnapshot, resetSetupDraft, restartSetup, reviewSetup, setupHash } from './drafts.server';
import { editSharedSetupWebsite } from './manual-website.server';
import { setupPreviewBooking } from './preview-data.server';
import { publishSetup } from './publish.server';
import { applyOwnUpload, conversationalUpload, conversationalUploadSummary, dismissOwnUpload, readOwnUpload, requestsUploadIdentityReplacement, uploadFactsToOperations } from './read-upload.server';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/features/onboarding-v1-integration/canonical-profile-media-lifecycle.server', () => ({
  prepareCanonicalProfileMediaForPublish: vi.fn(async () => null),
  applyPreparedCanonicalProfileMediaPromotion: vi.fn(),
  completeCanonicalProfileMediaPromotion: vi.fn(),
}));
let mediaRoot: string;
const client = new PGlite();
const database = drizzle(client, { schema });

beforeAll(async () => {
  mediaRoot = await mkdtemp(path.join(tmpdir(), 'luster-custom-assets-test-'));
  vi.stubEnv('LUSTER_ONBOARDING_MEDIA_DIR', mediaRoot);
  await client.waitReady;
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = database;
}, 60000);

afterAll(async () => {
  await client.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

async function fixture() {
  const actor = { salonId: randomUUID(), adminId: randomUUID() };
  await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
  await database.insert(schema.salonSchema).values({ id: actor.salonId, name: 'Untitled business', slug: actor.salonId, publicationStatus: 'draft', onlineBookingEnabled: false });
  await database.insert(schema.adminSalonMembershipSchema).values({ ...actor, role: 'owner' });
  const head = await openSetup(actor);
  const operations = [
    { type: 'business', values: { name: 'Test Studio', workMode: 'solo', city: 'Toronto', homeBased: true, exactAddress: '123 Private Street' } },
    { type: 'hours', values: { ...CLOSED_HOURS, monday: { open: '09:00', close: '17:00' } } },
    { type: 'service', values: { id: 'draft_gel', name: 'Gel manicure', description: null, priceCents: 6500, durationMinutes: 60, preparationBufferMinutes: 0, cleanupBufferMinutes: 10, category: 'manicure', bookingCategory: 'manicure' } },
  ];
  await editSetup(actor, { expectedRevision: head.revision.revision, operationId: randomUUID(), operations });
  return actor;
}

describe('isolated business setup persistence', () => {
  const biab = { id: 'draft_biab', name: 'BIAB', description: null, priceCents: 6500, durationMinutes: 75, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, category: 'builder_gel' as const, bookingCategory: 'manicure' as const };

  it('keeps a new reviewed service menu in the same order through publication, replay and Edit with AI', async () => {
    const actor = await fixture();
    const head = await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'service', values: biab }] });
    const review = await reviewSetup(actor);
    const approval = await approveSetup(actor, review.revision, review.hash);
    const input = { revision: review.revision, approvalId: approval.id, operationId: randomUUID() };
    const result = await publishSetup(actor, input);

    expect((await publishSetup(actor, input)).receipt.id).toBe(result.receipt.id);
    expect((await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId)).orderBy(asc(schema.serviceSchema.sortOrder))).map(service => [service.name, service.sortOrder])).toEqual([['Gel manicure', 0], ['BIAB', 1]]);
    expect((await restartSetup(actor, head.revision.revision)).revision.document.services.map(service => service.name)).toEqual(['Gel manicure', 'BIAB']);
  });

  it('appends new services after finite manual positions without rewriting existing menu settings', async () => {
    const actor = await fixture();
    const firstReview = await reviewSetup(actor);
    const firstApproval = await approveSetup(actor, firstReview.revision, firstReview.hash);
    await publishSetup(actor, { revision: firstReview.revision, approvalId: firstApproval.id, operationId: randomUUID() });
    await database.update(schema.serviceSchema).set({ sortOrder: 41 }).where(eq(schema.serviceSchema.salonId, actor.salonId));
    const reopened = await restartSetup(actor, firstReview.revision);
    const original = reopened.revision.document.services[0]!;
    const { origin, confirmed, ...originalValues } = original;

    expect(origin).toBe('existing');
    expect(confirmed).toBe(true);

    await editSetup(actor, { expectedRevision: reopened.revision.revision, operationId: randomUUID(), operations: [{ type: 'service', values: { ...originalValues, priceCents: 7000 } }, { type: 'service', values: biab }] });
    const review = await reviewSetup(actor);
    const approval = await approveSetup(actor, review.revision, review.hash);
    await publishSetup(actor, { revision: review.revision, approvalId: approval.id, operationId: randomUUID() });

    expect((await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId)).orderBy(asc(schema.serviceSchema.sortOrder))).map(service => [service.name, service.sortOrder, service.price])).toEqual([['Gel manicure', 41, 7000], ['BIAB', 42, 6500]]);
  });

  it('uses display ordering for the draft without changing the legacy raw-row baseline hash', async () => {
    const actor = await fixture();
    const ids = { a: `${actor.salonId}_a`, z: `${actor.salonId}_z` };
    await database.insert(schema.serviceSchema).values([{ id: ids.a, salonId: actor.salonId, name: 'Later', price: 6500, durationMinutes: 60, category: 'manicure', sortOrder: 9 }, { id: ids.z, salonId: actor.salonId, name: 'First', price: 5000, durationMinutes: 45, category: 'manicure', sortOrder: 2 }]);
    const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));
    const snapshot = await database.transaction(tx => readSetupSnapshot(tx as any, salon!));
    const raw = await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId)).orderBy(asc(schema.serviceSchema.id));

    expect(snapshot.document.services.map(service => service.id)).toEqual([ids.z, ids.a]);
    expect(snapshot.services).toEqual(raw);
    expect(snapshot.hash).toBe(setupHash({ salon, services: raw, locations: snapshot.locations, staff: snapshot.staff, addOns: snapshot.addOns, addOnLinks: snapshot.addOnLinks, assignments: snapshot.assignments }));
  });

  it('rejects a newer manual ordering change instead of publishing a previously approved menu', async () => {
    const actor = await fixture();
    const firstReview = await reviewSetup(actor);
    const firstApproval = await approveSetup(actor, firstReview.revision, firstReview.hash);
    await publishSetup(actor, { revision: firstReview.revision, approvalId: firstApproval.id, operationId: randomUUID() });
    const reopened = await restartSetup(actor, firstReview.revision);
    await editSetup(actor, { expectedRevision: reopened.revision.revision, operationId: randomUUID(), operations: [{ type: 'service', values: biab }] });
    const review = await reviewSetup(actor);
    const approval = await approveSetup(actor, review.revision, review.hash);
    await database.update(schema.serviceSchema).set({ sortOrder: 11 }).where(eq(schema.serviceSchema.salonId, actor.salonId));

    await expect(publishSetup(actor, { revision: review.revision, approvalId: approval.id, operationId: randomUUID() })).rejects.toMatchObject({ code: 'STALE' });
    expect((await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).map(service => [service.name, service.sortOrder])).toEqual([['Gel manicure', 11]]);
  });

  it('persists typed service evidence separately from assistant authority and replays without approving it', async () => {
    const actor = await fixture();
    const input = { expectedRevision: 2, operationId: randomUUID(), scope: 'business_and_website', message: 'Add BIAB at CAD65 for 75 minutes. Add Nail art at CAD10 and suggest its extra time.' };
    const operations = [
      { type: 'service', values: { id: 'draft_biab', name: 'BIAB', description: null, priceCents: 6500, durationMinutes: 75, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, category: 'builder_gel', bookingCategory: 'manicure' } },
      { type: 'add_on', values: { id: 'draft_art', name: 'Nail art', category: 'nail_art', descriptionItems: null, priceCents: 1000, durationMinutes: 15, pricingType: 'fixed', unitLabel: null, maxQuantity: null, isActive: true, serviceIds: ['draft_biab'] } },
    ];
    const createResponse = vi.fn().mockResolvedValue({ status: 'completed', usage: null, items: [{ type: 'message', text: JSON.stringify({ reply: 'Added to your draft for review.', operationsJson: JSON.stringify(operations), designRequest: null }) }] });
    const result = await runSetupConversation(actor, input, { createResponse });

    expect(result.head.revision.document.serviceSources?.draft_biab).toEqual({ name: 'owner', priceCents: 'owner', durationMinutes: 'owner' });
    expect(result.head.revision.document.addOnSources?.draft_art).toEqual({ name: 'owner', priceCents: 'owner', durationMinutes: 'suggested' });
    expect(result.head.revision.document.services.find(service => service.id === 'draft_biab')).toMatchObject({ origin: 'assistant', confirmed: false });
    expect(result.head.revision.document.addOns?.[0]).toMatchObject({ origin: 'assistant', confirmed: false });

    const review = await reviewSetup(actor);

    expect(review.changes.some(change => /serviceSources|addOnSources/u.test(change.path))).toBe(false);
    expect(review.blockers.some(blocker => /review|confirm|accept/iu.test(blocker))).toBe(true);
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);

    await runSetupConversation(actor, input, { createResponse });

    expect(createResponse).toHaveBeenCalledOnce();
    expect((await openSetup(actor)).revision.document.serviceSources?.draft_biab?.priceCents).toBe('owner');
    await expect(editSetup(actor, { expectedRevision: 3, operationId: randomUUID(), operations: [{ type: 'service', values: { ...operations[0]!.values, confirmed: true, source: 'owner' } }] }, 'assistant')).rejects.toThrow();
  });

  it('keeps uploaded prices distinct when a private first preview fills only missing times', async () => {
    const actor = await fixture();
    await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'service', values: { id: 'draft_lashes', name: 'Lashes', description: null, priceCents: 10000, durationMinutes: null, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, category: 'other', bookingCategory: 'other' } }] }, 'upload');
    const suggested = await editSetup(actor, { expectedRevision: 3, operationId: randomUUID(), operations: [{ type: 'preview_defaults', seed: randomUUID() }] }, 'assistant');

    expect(suggested.revision.document.serviceSources?.draft_lashes).toEqual({ name: 'upload', priceCents: 'upload', durationMinutes: 'suggested' });
    expect(suggested.revision.document.services.find(service => service.id === 'draft_lashes')).toMatchObject({ priceCents: 10000, durationMinutes: 60, confirmed: false });
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);
  });

  it('preserves stored price labels on old drafts without rewriting their immutable JSON', async () => {
    const actor = { salonId: randomUUID(), adminId: randomUUID() };
    await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
    await database.insert(schema.salonSchema).values({ id: actor.salonId, name: 'Legacy Studio', city: 'Toronto', slug: actor.salonId, publicationStatus: 'published' });
    await database.insert(schema.adminSalonMembershipSchema).values({ ...actor, role: 'owner' });
    const serviceId = randomUUID();
    await database.insert(schema.serviceSchema).values({ id: serviceId, salonId: actor.salonId, name: 'BIAB', price: 6500, priceDisplayText: 'From $65', durationMinutes: 60, category: 'builder_gel' });
    const head = await openSetup(actor);
    const legacy = structuredClone(head.revision.document);
    delete legacy.servicePricingVersion;
    legacy.services = legacy.services.map(({ priceDisplayText: _label, ...service }) => ({ ...service, priceCents: 7500 }));
    const savedRevision = and(eq(schema.businessSetupRevisionSchema.workspaceId, head.workspace.id), eq(schema.businessSetupRevisionSchema.revision, head.revision.revision));
    await database.update(schema.businessSetupRevisionSchema).set({ document: legacy }).where(savedRevision);
    const loaded = await openSetup(actor);

    expect(loaded.revision.document.services[0]).toMatchObject({ priceCents: 7500, priceDisplayText: 'From $75.00' });
    expect(customSiteDataFromSetup(loaded.revision.document).services[0]?.priceLabel).toBe('From $75.00');
    expect((await database.select().from(schema.businessSetupRevisionSchema).where(savedRevision))[0]!.document).toEqual(legacy);
    expect((await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, serviceId)))[0]).toMatchObject({ price: 6500, priceDisplayText: 'From $65' });
  });

  it('blocks an inherited range label after a price change until it is explicitly corrected', async () => {
    const actor = await fixture();
    const head = await openSetup(actor);
    const { origin: _origin, confirmed: _confirmed, ...fields } = head.revision.document.services[0]!;
    const range = await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'service', values: { ...fields, priceDisplayText: '$65–$85' } }] });
    const changed = await editSetup(actor, { expectedRevision: range.revision.revision, operationId: randomUUID(), operations: [{ type: 'service', values: { ...fields, priceCents: 7500, priceDisplayText: '$65–$85' } }] }, 'assistant');
    const confirmed = await editSetup(actor, { expectedRevision: changed.revision.revision, operationId: randomUUID(), operations: [{ type: 'confirm_services', ids: [fields.id] }] });
    const review = await reviewSetup(actor);

    expect(review.blockers).toContain('Update or clear the price wording for Gel manicure; its booking price changed.');
    expect(customSiteDataFromSetup(confirmed.revision.document).services[0]?.priceLabel).toBe('Price wording needs review');
    await expect(approveSetup(actor, review.revision, review.hash)).rejects.toMatchObject({ code: 'NOT_READY' });

    expect(setupServiceSchema.safeParse({ ...fields, priceLabelNeedsReview: false }).success).toBe(false);

    const corrected = await editSetup(actor, { expectedRevision: confirmed.revision.revision, operationId: randomUUID(), operations: [{ type: 'service', values: { ...fields, priceCents: 7500, priceDisplayText: 'From $75.00' } }] });

    expect(setupReadiness(corrected.revision.document)).toEqual([]);
    expect((await reviewSetup(actor)).changes.find(change => change.path === 'services')?.after).toEqual(corrected.revision.document.services);
    expect(() => applySetupOperations(corrected.revision.document, [{ type: 'service', values: { ...fields, priceDisplayText: 'Visit 123 Private Street' } }], 'assistant')).toThrow('Keep your private street address');
  });

  it('shares an immutable public projection, preserves it after reset, and revokes it', async () => {
    const actor = await fixture();
    const source = await saveCustomSource(actor, { expectedRevision: 2, operationId: randomUUID(), source: editorialSource, assetIds: [] });
    const revision = source.head.revision.revision;
    const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    const shared = await shareCustomPreview(actor, { expectedRevision: revision, token });

    expect(shared.path).toBe(`/website-preview/${token}`);
    expect(await shareCustomPreview(actor, { expectedRevision: revision, token })).toEqual(shared);

    const preview = await sharedCustomPreview(token);

    expect(preview?.data.preview).toBe(true);
    expect(preview?.data.business.address).toBeNull();
    expect(preview?.data.services[0]).toMatchObject({ id: 'setup_preview_draft_gel', priceCents: 6500, durationMinutes: 60 });

    const reset = await resetSetupDraft(actor, { expectedRevision: revision, operationId: randomUUID() });

    expect(reset.revision.document.website.config.customFrontendId).toBeUndefined();
    expect(await sharedCustomPreview(token)).toEqual(preview);

    const [row] = await database.select().from(schema.businessSetupPreviewShareSchema).where(eq(schema.businessSetupPreviewShareSchema.salonId, actor.salonId));

    expect(row?.tokenHash).not.toContain(token);
    expect(await sharedCustomPreview('forged')).toBeNull();

    await revokeCustomPreview(actor, token);

    expect(await sharedCustomPreview(token)).toBeNull();
  });

  it('enforces owner, tenant, current version, expiry, and address boundaries for sharing', async () => {
    const actor = await fixture();
    const other = await fixture();
    const saved = await saveCustomSource(actor, { expectedRevision: 2, operationId: randomUUID(), source: editorialSource, assetIds: [] });
    const revision = saved.head.revision.revision;
    const token = () => randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');

    await expect(shareCustomPreview({ ...actor, salonId: other.salonId }, { expectedRevision: revision, token: token() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(shareCustomPreview(actor, { expectedRevision: 2, token: token() })).rejects.toMatchObject({ code: 'STALE' });

    const secret = token();
    await shareCustomPreview(actor, { expectedRevision: revision, token: secret });
    await revokeCustomPreview(other, secret);

    expect(await sharedCustomPreview(secret)).not.toBeNull();

    await database.update(schema.businessSetupPreviewShareSchema).set({ expiresAt: new Date(0) }).where(eq(schema.businessSetupPreviewShareSchema.salonId, actor.salonId));

    expect(await sharedCustomPreview(secret)).toBeNull();

    const address = await editSetup(actor, { expectedRevision: revision, operationId: randomUUID(), operations: [{ type: 'business', values: { locationDisplayMode: 'full_address' } }] });

    await expect(shareCustomPreview(actor, { expectedRevision: address.revision.revision, token: token() })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('keeps draft services, hours, privacy and publication out of live records', async () => {
    const actor = await fixture();
    const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

    expect(salon).toMatchObject({ name: 'Untitled business', businessHours: null, address: null, publicationStatus: 'draft', onlineBookingEnabled: false });
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);

    const head = await openSetup(actor);

    expect(head.revision.document.business.locationDisplayMode).toBe('city_only');
    expect(head.revision.document.services[0]?.priceCents).toBe(6500);
  });

  it('requires actual membership and rejects cross-salon access', async () => {
    const a = await fixture();
    const b = await fixture();

    await expect(openSetup({ ...a, salonId: b.salonId })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await database.update(schema.adminSalonMembershipSchema).set({ role: 'admin' }).where(eq(schema.adminSalonMembershipSchema.adminId, a.adminId));

    await expect(reviewSetup(a)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('deduplicates edit requests and refuses changed payloads or stale edits', async () => {
    const actor = await fixture();
    const input = { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'business', values: { name: 'New name' } }] };

    expect((await editSetup(actor, input)).revision.revision).toBe(3);
    expect((await editSetup(actor, input)).revision.revision).toBe(3);
    await expect(editSetup(actor, { ...input, operations: [{ type: 'business', values: { name: 'Other' } }] })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(editSetup(actor, { ...input, operationId: randomUUID() })).rejects.toMatchObject({ code: 'STALE' });
  });

  it('never lets model-origin suggestions confirm themselves', async () => {
    const actor = await fixture();

    await expect(editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'confirm_services', ids: ['draft_gel'] }] }, 'assistant')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const head = await openSetup(actor);
    const { origin: _origin, confirmed: _confirmed, ...service } = head.revision.document.services[0]!;
    await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'service', values: { ...service, priceCents: 7000 } }] }, 'assistant');
    const review = await reviewSetup(actor);

    expect(review.blockers).toContain('Review the price and time for Gel manicure.');
    await expect(approveSetup(actor, review.revision, review.hash)).rejects.toMatchObject({ code: 'NOT_READY' });
  });

  it('invalidates approval after edits and detects external live changes', async () => {
    const actor = await fixture();
    const review = await reviewSetup(actor);
    const approval = await approveSetup(actor, review.revision, review.hash);
    await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'business', values: { name: 'Later name' } }] });

    await expect(publishSetup(actor, { approvalId: approval.id, revision: 2, operationId: randomUUID() })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });

    await database.update(schema.salonSchema).set({ city: 'Ottawa' }).where(eq(schema.salonSchema.id, actor.salonId));

    await expect(reviewSetup(actor)).rejects.toMatchObject({ code: 'STALE' });
  });

  it('publishes a neutral non-nail appointment through the same canonical catalogue and staff assignments', async () => {
    const actor = await fixture();
    const draft = await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'service', values: { id: 'draft_lashes', name: 'Lash Services', description: null, priceCents: 6500, durationMinutes: 75, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, category: 'other', bookingCategory: 'other' } }] });

    expect(draft.revision.document.services.find(service => service.id === 'draft_lashes')).toMatchObject({ category: 'other', bookingCategory: 'other', priceCents: 6500, durationMinutes: 75 });
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);

    const review = await reviewSetup(actor);
    const approval = await approveSetup(actor, review.revision, review.hash);
    const request = { approvalId: approval.id, revision: review.revision, operationId: randomUUID() };
    const result = await publishSetup(actor, request);
    const services = await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId));
    const lashes = services.find(service => service.name === 'Lash Services');

    expect(lashes).toMatchObject({ category: 'other', bookingCategory: 'other', price: 6500, durationMinutes: 75 });
    expect(services).toHaveLength(2);
    expect(await database.select().from(schema.technicianServicesSchema).where(eq(schema.technicianServicesSchema.serviceId, lashes!.id))).toHaveLength(1);
    expect((await publishSetup(actor, request)).receipt.id).toBe(result.receipt.id);
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(2);
  });

  it('publishes approved canonical data once and replays the receipt after a lost response', async () => {
    const actor = await fixture();
    const review = await reviewSetup(actor);
    const approval = await approveSetup(actor, review.revision, review.hash);
    const input = { approvalId: approval.id, revision: review.revision, operationId: randomUUID() };
    const result = await publishSetup(actor, input);

    expect((await publishSetup(actor, input)).receipt.id).toBe(result.receipt.id);

    const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

    expect(salon).toMatchObject({ name: 'Test Studio', publicationStatus: 'published', onlineBookingEnabled: true, address: null });

    const services = await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId));

    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({ price: 6500, durationMinutes: 60, cleanupBufferMinutes: 10 });

    const [location] = await database.select().from(schema.salonLocationSchema).where(eq(schema.salonLocationSchema.salonId, actor.salonId));

    expect(location?.address).toBe('123 Private Street');

    const [staff] = await database.select().from(schema.technicianSchema).where(eq(schema.technicianSchema.salonId, actor.salonId));

    expect(staff?.weeklySchedule?.monday).toEqual({ start: '09:00', end: '17:00' });
    expect(await database.select().from(schema.auditLogSchema).where(eq(schema.auditLogSchema.salonId, actor.salonId))).toHaveLength(1);
  });

  it('publishes public website details only with exact approval and preserves operational policies', async () => {
    const actor = await fixture();
    const initial = await openSetup(actor);
    const websiteDetails = { locationDirections: 'Dixie and Countryside', instagram: '@test_studio', email: 'studio@example.com', phone: null, sections: [{ id: 'guests', title: 'Guests', text: 'Please come alone.' }] };
    await editSetup(actor, { expectedRevision: initial.revision.revision, operationId: randomUUID(), operations: [{ type: 'website_details', values: websiteDetails }] });
    const review = await reviewSetup(actor);

    expect(review.changes.some(change => change.path.startsWith('website.content.websiteDetails'))).toBe(true);

    const approval = await approveSetup(actor, review.revision, review.hash);
    const request = { approvalId: approval.id, revision: review.revision, operationId: randomUUID() };
    const first = await publishSetup(actor, request);

    expect((await publishSetup(actor, request)).receipt.id).toBe(first.receipt.id);

    const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

    expect(resolveBookingPageContent(salon!.settings).live.websiteDetails).toEqual(websiteDetails);

    const reopened = await restartSetup(actor, review.revision);

    expect(reopened.revision.document.website.content.websiteDetails).toEqual(websiteDetails);
    expect(reopened.revision.document.bookingPolicy).toEqual(initial.revision.document.bookingPolicy);
  });

  it('blocks independent publication inside the locked canonical lifecycle', async () => {
    const actor = await fixture();

    await expect(synchronizeBookingPageLifecycle(actor.salonId, 'publish')).rejects.toThrow('Review and publish');
    await expect(synchronizeBookingPageLifecycle(actor.salonId, 'revert')).rejects.toThrow('Review and publish');
  });

  it('shares website changes with the manual editor and rejects stale manual saves', async () => {
    const actor = await fixture();
    await editSharedSetupWebsite({ ...actor, expectedRevision: 2, patch: { content: { bio: 'Our owner-written introduction.' } } });
    const head = await openSetup(actor);

    expect(head.revision.revision).toBe(3);
    expect(head.revision.document.website.content.bio).toBe('Our owner-written introduction.');
    await expect(editSharedSetupWebsite({ ...actor, expectedRevision: 2, patch: { content: { bio: 'Stale copy' } } })).rejects.toMatchObject({ code: 'STALE' });

    await editSetup(actor, { expectedRevision: 3, operationId: randomUUID(), operations: [{ type: 'copy', bio: 'New shared draft copy.', specialtyLine: 'Nail care' }] });
    const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

    expect(resolveBookingPageContent(salon?.settings).draft.bio).toBe('New shared draft copy.');
    expect(resolveBookingPageContent(salon?.settings).live.bio).not.toBe('New shared draft copy.');
    expect((await reviewSetup(actor)).blockers).toEqual([]);
  });

  it('starts a later edit from current saved services, without duplicating draft identities', async () => {
    const actor = await fixture();
    const review = await reviewSetup(actor);
    const approval = await approveSetup(actor, review.revision, review.hash);
    const result = await publishSetup(actor, { approvalId: approval.id, revision: review.revision, operationId: randomUUID() });
    const serviceId = result.receipt.serviceIds.draft_gel!;
    await database.update(schema.serviceSchema).set({ price: 7200 }).where(eq(schema.serviceSchema.id, serviceId));
    const next = await restartSetup(actor, review.revision);

    expect(next.revision.document.services[0]).toMatchObject({ id: serviceId, priceCents: 7200 });
    expect(next.workspace.status).toBe('editing');
    expect((await reviewSetup(actor)).changes).toEqual([]);
    await expect(restartSetup(actor, review.revision)).rejects.toMatchObject({ code: 'STALE' });
  });

  it('creates the requested first website even when the conversation model asks for an unnecessary review', async () => {
    const actor = await fixture();
    const provider = { createResponse: vi.fn().mockResolvedValueOnce({ status: 'completed', usage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100 }, items: [{ type: 'message', text: JSON.stringify({ reply: 'Review the details before I make the website.', operationsJson: '[]', designRequest: null }) }] }).mockResolvedValueOnce({ status: 'completed', usage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 1000 }, items: [{ type: 'message', text: JSON.stringify(editorialSource) }] }) };
    const result = await runSetupConversation(actor, { expectedRevision: 2, operationId: randomUUID(), scope: 'business_and_website', message: 'Make my booking website from this design.' }, provider);

    expect(result.head.revision.document.website.config.customFrontendId).toBeTruthy();
    expect(result.reply).not.toContain('Review the details before');
    expect(provider.createResponse).toHaveBeenCalledTimes(2);
  });

  it('applies multiple out-of-order conversation answers once and persists measured fake-provider usage', async () => {
    const actor = await fixture();
    const createResponse = vi.fn().mockResolvedValueOnce({ status: 'completed', usage: { inputTokens: 1000, cachedInputTokens: 100, outputTokens: 100 }, items: [{ type: 'message', text: JSON.stringify({ reply: 'I saved your city and will create your requested design.', operationsJson: JSON.stringify([{ type: 'business', values: { city: 'Ottawa' } }]), designRequest: 'Cream and black, with an original editorial composition.' }) }] }).mockResolvedValueOnce({ status: 'completed', usage: { inputTokens: 3000, cachedInputTokens: 0, outputTokens: 2000 }, items: [{ type: 'message', text: JSON.stringify(editorialSource) }] });
    const input = { expectedRevision: 2, operationId: randomUUID(), scope: 'business_and_website', message: 'I am based in Ottawa. Make it cream and black.' };
    const result = await runSetupConversation(actor, input, { createResponse });

    expect(result.head.revision.document.business.city).toBe('Ottawa');
    expect(result.head.revision.document.website.config.customFrontendId).toBeTruthy();
    expect((await runSetupConversation(actor, input, { createResponse })).head.revision.revision).toBe(4);
    expect(createResponse).toHaveBeenCalledTimes(2);

    const [turn] = await database.select().from(schema.businessSetupTurnSchema).where(eq(schema.businessSetupTurnSchema.id, input.operationId));

    expect(turn).toMatchObject({ status: 'completed', inputTokens: 1000, outputTokens: 100, costMicroUsd: 141 });
  });

  it.each([
    [{ type: 'confirm_services', ids: ['draft_gel'] }],
    [{ type: 'confirm_hours' }],
    [{ type: 'preview_defaults', seed: '33700000-0000-4000-8000-000000000001' }],
    [{ type: 'business', values: { name: 'Unexpected business edit' } }],
    [{ type: 'publish', salonId: 'another-salon' }],
  ])('rejects model actions outside website-only scope or approval authority', async (operation) => {
    const actor = await fixture();
    const provider = { createResponse: vi.fn(async () => ({ status: 'completed' as const, usage: null, items: [{ type: 'message' as const, text: JSON.stringify({ reply: 'Done', operationsJson: JSON.stringify([operation]) }) }] })) };

    await expect(runSetupConversation(actor, { expectedRevision: 2, operationId: randomUUID(), scope: 'website', message: 'Redesign the website.' }, provider)).rejects.toBeInstanceOf(Error);
    expect((await openSetup(actor)).revision.revision).toBe(2);
    expect(await database.select().from(schema.businessSetupPublicationSchema).where(eq(schema.businessSetupPublicationSchema.salonId, actor.salonId))).toHaveLength(0);
  });

  it('simulates proposed availability with the original engine and never reads customer appointments', async () => {
    const actor = await fixture();
    const head = await openSetup(actor);
    const preview = setupPreviewBooking(head.revision.document, { staff: [], assignments: [] }, new Date('2026-10-18T12:00:00Z'));

    expect(preview.examples[0]?.date).toBe('2026-10-19');
    expect(preview.examples[0]?.times).toContain('9:00');
    expect(preview.technicians[0]?.enabledServiceIds).toEqual(['draft_gel']);

    const closed = { ...head.revision.document, hours: CLOSED_HOURS };

    expect(setupPreviewBooking(closed, { staff: [], assignments: [] }).examples).toEqual([]);
  });

  it('uses the proposed Tokyo timezone in the private preview while live settings stay unchanged', async () => {
    const actor = await fixture();
    const liveBefore = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));
    await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [
      { type: 'booking', values: { timezone: 'Asia/Tokyo' } },
      { type: 'hours', values: { ...CLOSED_HOURS, wednesday: { open: '09:00', close: '17:00' } } },
    ] });
    const head = await openSetup(actor);
    const preview = setupPreviewBooking(head.revision.document, { staff: [], assignments: [] }, new Date('2026-10-19T12:00:00Z'));

    expect(preview.examples[0]).toMatchObject({ date: '2026-10-21', times: ['9:00', '9:15', '9:30', '9:45'] });
    // The setup's row lock/mirror advances updatedAt, not live configuration.
    expect(await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId))).toEqual(liveBefore.map(row => ({ ...row, updatedAt: expect.any(Date) })));
    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, actor.salonId))).toEqual([]);
  });

  it('includes the next local calendar day in preview across spring-forward at late evening', async () => {
    const actor = await fixture();
    const head = await openSetup(actor);
    const document = { ...head.revision.document, booking: { ...head.revision.document.booking, timezone: 'America/Vancouver' }, hours: { ...CLOSED_HOURS, sunday: { open: '09:00', close: '17:00' } } };
    const preview = setupPreviewBooking(document, { staff: [], assignments: [] }, new Date('2026-03-08T07:30:00Z'));

    // Saturday 23:30 PST + 24 elapsed hours is already Monday 00:30 PDT.
    expect(preview.examples[0]?.date).toBe('2026-03-08');
    expect(preview.examples[0]?.times).toContain('9:00');
  });
});

describe('custom frontend shared draft integration', () => {
  it('saves immutable source revisions, rejects cross-salon attachments and restores through exact review', async () => {
    const actor = await fixture();
    const other = await fixture();
    const first = await saveCustomSource(actor, { source: editorialSource, assetIds: [], operationId: randomUUID(), expectedRevision: 2 });

    expect(first.head.revision.document.website.config.customFrontendId).toBe(first.artifact.id);

    const [live] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

    expect((live!.settings as { bookingPage?: { live?: { customFrontendId?: string } } } | null)?.bookingPage?.live?.customFrontendId).toBeUndefined();
    await expect(editSetup(other, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'custom_frontend', artifactId: first.artifact.id }] })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(database.update(schema.customSiteArtifactSchema).set({ source: darkSource }).where(eq(schema.customSiteArtifactSchema.id, first.artifact.id))).rejects.toThrow();

    const review = await reviewSetup(actor);
    const approval = await approveSetup(actor, review.revision, review.hash);
    await saveCustomSource(actor, { source: darkSource, assetIds: [], operationId: randomUUID(), expectedRevision: 3 });

    await expect(publishSetup(actor, { approvalId: approval.id, revision: 3, operationId: randomUUID() })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });

    const restored = await editSetup(actor, { expectedRevision: 4, operationId: randomUUID(), operations: [{ type: 'custom_frontend', artifactId: first.artifact.id }] });

    expect(restored.revision.revision).toBe(5);
    expect(restored.revision.document.website.config.customFrontendId).toBe(first.artifact.id);
  });

  it('routes a clear photo-layout revision directly to editable source without a second intake model or business changes', async () => {
    const actor = await fixture();
    const saved = await saveCustomSource(actor, { expectedRevision: 2, operationId: randomUUID(), assetIds: [], source: editorialSource });
    const createResponse = vi.fn().mockResolvedValue({ status: 'completed', usage: { inputTokens: 3000, outputTokens: 2000, cachedInputTokens: 0 }, items: [{ type: 'message', text: JSON.stringify(darkSource) }] });
    const input = { expectedRevision: saved.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Keep the burgundy and ivory design. Make the two photos larger and overlap them in the studio section. Keep my logo, services and the rest of the design.' };
    const result = await runSetupConversation(actor, input, { createResponse });

    expect(result.head.revision.document.website.config.customFrontendId).not.toBe(saved.artifact.id);
    expect(result.head.revision.document.business).toEqual(saved.head.revision.document.business);
    expect(result.head.revision.document.services).toEqual(saved.head.revision.document.services);
    expect(result.head.revision.document.hours).toEqual(saved.head.revision.document.hours);
    expect(createResponse).toHaveBeenCalledTimes(1);
    expect(createResponse.mock.calls[0]![0].jsonSchema).toHaveProperty('properties.html');
    expect((await runSetupConversation(actor, input, { createResponse })).head.revision.revision).toBe(result.head.revision.revision);
    expect(createResponse).toHaveBeenCalledTimes(1);
  });

  it('writes and iterates actual source through the provider contract without modifying business settings', async () => {
    const actor = await fixture();
    const createResponse = vi.fn().mockResolvedValue({ status: 'completed', usage: { inputTokens: 3000, outputTokens: 2000, cachedInputTokens: 0 }, items: [{ type: 'message', text: JSON.stringify(editorialSource) }] });
    const input = { expectedRevision: 2, operationId: randomUUID(), message: 'Build an original editorial website', referenceIds: [], startOver: false };
    const first = await generateCustomSite(actor, input, { createResponse });
    await generateCustomSite(actor, input, { createResponse });

    expect(createResponse).toHaveBeenCalledTimes(1);
    expect(first.head.revision.document.services[0]?.priceCents).toBe(6500);

    createResponse.mockResolvedValue({ status: 'completed', usage: { inputTokens: 8000, outputTokens: 3000, cachedInputTokens: 0 }, items: [{ type: 'message', text: JSON.stringify(darkSource) }] });
    const second = await generateCustomSite(actor, { ...input, expectedRevision: 3, operationId: randomUUID(), message: 'Redesign completely as a dark immersive website' }, { createResponse });

    expect(second.artifactId).not.toBe(first.artifactId);

    const request = createResponse.mock.calls[1]![0];

    expect(request.tools).toEqual([]);
    expect(JSON.stringify(request.input)).toContain('previousSource');
    expect(JSON.stringify(request.input)).not.toContain('123 Private Street');
    expect(second.head.revision.document.business).toEqual(first.head.revision.document.business);

    const [usage] = await database.select().from(schema.customSiteGenerationSchema).where(eq(schema.customSiteGenerationSchema.id, input.operationId));

    expect(usage?.costMicroUsd).toBe(26000);
  });
});

describe('private multimodal design references', () => {
  it('passes an uploaded reference from owner conversation into actual design generation', async () => {
    const actor = await fixture();
    const png = await sharp({ create: { width: 120, height: 160, channels: 3, background: '#eecbdb' } }).png().toBuffer();
    const image = await uploadCustomAsset(actor, new File([new Uint8Array(png)], 'inspiration.png', { type: 'image/png' }), 'reference');
    const createResponse = vi.fn()
      .mockResolvedValueOnce({ status: 'completed', usage: null, items: [{ type: 'message', text: JSON.stringify({ reply: 'I will use your uploaded reference.', operationsJson: '[]', designRequest: 'Recreate the selected pink collage reference using my business.' }) }] })
      .mockResolvedValueOnce({ status: 'completed', usage: null, items: [{ type: 'message', text: JSON.stringify(editorialSource) }] });
    const input = { expectedRevision: 2, operationId: randomUUID(), scope: 'business_and_website', message: 'Create my website from the image I uploaded.', referenceIds: [image.id] };
    const result = await runSetupConversation(actor, input, { createResponse });

    expect(result.head.revision.revision).toBe(3);
    expect(createResponse).toHaveBeenCalledTimes(2);

    const request = createResponse.mock.calls[1]![0];

    expect(request.input.at(-1).content.some((part: any) => part.type === 'input_image' && part.image_url.startsWith('data:image/webp;base64,'))).toBe(true);

    const [artifact] = await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.id, result.head.revision.document.website.config.customFrontendId!));

    expect(artifact!.assetIds).toContain(image.id);

    await runSetupConversation(actor, input, { createResponse });

    expect(createResponse).toHaveBeenCalledTimes(2);
  });

  it('rejects another salon reference in conversation before any paid provider call', async () => {
    const actor = await fixture();
    const other = await fixture();
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#eecbdb' } }).png().toBuffer();
    const image = await uploadCustomAsset(other, new File([new Uint8Array(png)], 'private.png', { type: 'image/png' }), 'reference');
    const createResponse = vi.fn();

    await expect(runSetupConversation(actor, { expectedRevision: 2, operationId: randomUUID(), scope: 'business_and_website', message: 'Use this picture.', referenceIds: [image.id] }, { createResponse })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(createResponse).not.toHaveBeenCalled();
    expect((await openSetup(actor)).revision.revision).toBe(2);
  });

  it('keeps removed photographs out of public payloads while retaining private source history', async () => {
    const actor = await fixture();
    const bytes = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ac9481' } }).png().toBuffer();
    const photo = await uploadCustomAsset(actor, new File([new Uint8Array(bytes)], 'salon.png', { type: 'image/png' }), 'photo');
    const first = await saveCustomSource(actor, { expectedRevision: 2, operationId: randomUUID(), assetIds: [photo.id], source: { ...editorialSource, html: `${editorialSource.html}<img src="asset:${photo.id}" alt="Salon photograph">` } });
    const data = { business: { name: 'Test', city: 'Toronto', address: null, bio: '', hours: {} }, services: [], currency: 'CAD', preview: false };

    expect(Object.keys((await customSitePayload(actor.salonId, first.artifact.id, data)).images)).toEqual([photo.id]);

    const removed = await saveCustomSource(actor, { expectedRevision: 3, operationId: randomUUID(), assetIds: [photo.id], source: editorialSource });

    expect((await customSitePayload(actor.salonId, removed.artifact.id, data)).images).toEqual({});
    expect(Object.keys((await customSitePayload(actor.salonId, first.artifact.id, data)).images)).toEqual([photo.id]);
  });

  it('does not start paid generation when a manual edit arrives during token counting', async () => {
    const actor = await fixture();
    const createResponse = vi.fn();
    const countInputTokens = vi.fn(async () => {
      await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'business', values: { name: 'New owner choice' } }] });
      return 10000;
    });

    await expect(generateCustomSite(actor, { expectedRevision: 2, operationId: randomUUID(), message: 'Build it', referenceIds: [] }, { createResponse, countInputTokens })).rejects.toMatchObject({ code: 'STALE' });
    expect(createResponse).not.toHaveBeenCalled();
  });

  it('keeps normalized Preview images private, tenant-owned and independent of local disk', async () => {
    const actor = await fixture();
    const other = await fixture();
    vi.stubEnv('APP_ENV', 'preview');
    vi.stubEnv('CUSTOM_SITE_PREVIEW_PRIVATE_IMAGES', 'true');
    try {
      const png = await sharp({ create: { width: 120, height: 160, channels: 3, background: '#eecbdb' } }).png().toBuffer();
      const uploaded = await uploadCustomAsset(actor, new File([new Uint8Array(png)], 'salon.png', { type: 'image/png' }), 'photo');
      const [asset] = await ownedAssets(database as any, actor.salonId, [uploaded.id]);

      expect(asset!.storageKey).toBeNull();
      expect(asset!.pdfBase64).toBeNull();
      expect(asset!.imageBase64).toBeTruthy();
      expect(asset!.mimeType).toBe('image/webp');
      await expect(ownedAssets(database as any, other.salonId, [uploaded.id])).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const { assetDataUrl } = await import('@/features/custom-sites/assets.server');

      expect(await assetDataUrl(asset!)).toMatch(/^data:image\/webp;base64,/u);
      await expect(assetDataUrl({ ...asset!, hash: 'changed' })).rejects.toThrow('changed');
    } finally {
      vi.stubEnv('APP_ENV', 'development');
      vi.stubEnv('CUSTOM_SITE_PREVIEW_PRIVATE_IMAGES', 'false');
    }
  });

  it('stores validated images and PDFs privately and sends actual multimodal parts to the provider', async () => {
    const actor = await fixture();
    const other = await fixture();
    const png = await sharp({ create: { width: 120, height: 160, channels: 3, background: '#eecbdb' } }).png().toBuffer();
    const image = await uploadCustomAsset(actor, new File([new Uint8Array(png)], 'inspiration.png', { type: 'image/png' }), 'reference');
    const pdf = await PDFDocument.create();
    pdf.addPage([400, 600]);
    const document = await uploadCustomAsset(actor, new File([await pdf.save()], 'canva.pdf', { type: 'application/pdf' }), 'reference');

    await expect(ownedAssets(database as any, other.salonId, [image.id])).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const createResponse = vi.fn().mockResolvedValue({ status: 'completed', usage: null, items: [{ type: 'message', text: JSON.stringify(editorialSource) }] });
    const countInputTokens = vi.fn().mockResolvedValue(12000);
    await generateCustomSite(actor, { expectedRevision: 2, operationId: randomUUID(), message: 'Use these visual references, not their text', referenceIds: [image.id, document.id], startOver: false }, { createResponse, countInputTokens });
    const request = createResponse.mock.calls[0]![0];

    expect(request.model).toBe('gpt-6.1-sol');
    expect(countInputTokens).toHaveBeenCalledWith(request);

    const parts = request.input.at(-1).content;

    expect(parts.some((part: any) => part.type === 'input_image' && part.image_url.startsWith('data:image/webp;base64,'))).toBe(true);
    expect(parts.some((part: any) => part.type === 'input_file' && part.file_data.startsWith('data:application/pdf;base64,'))).toBe(true);

    const [job] = await database.select().from(schema.customSiteGenerationSchema).where(eq(schema.customSiteGenerationSchema.salonId, actor.salonId));

    expect(job?.costMicroUsd).toBeNull();
    expect(job!.reservedMicroUsd).toBeGreaterThan(0);
  });

  it('reuses an intact repeated upload only within its authorized salon and role', async () => {
    const actor = await fixture();
    const other = await fixture();
    const bytes = await sharp({ create: { width: 120, height: 160, channels: 3, background: '#aabbcc' } }).png().toBuffer();
    const file = () => new File([new Uint8Array(bytes)], 'retry.png', { type: 'image/png' });
    const first = await uploadCustomAsset(actor, file(), 'reference');
    const retry = await uploadCustomAsset(actor, file(), 'reference');

    expect(retry.id).toBe(first.id);
    expect((await database.select().from(schema.customSiteAssetSchema).where(eq(schema.customSiteAssetSchema.salonId, actor.salonId)))).toHaveLength(1);
    expect((await uploadCustomAsset(actor, file(), 'photo')).id).not.toBe(first.id);
    expect((await uploadCustomAsset(other, file(), 'reference')).id).not.toBe(first.id);

    await database.update(schema.adminSalonMembershipSchema).set({ role: 'technician' }).where(eq(schema.adminSalonMembershipSchema.adminId, actor.adminId));

    await expect(uploadCustomAsset(actor, file(), 'reference')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('retains a damaged historical asset and allows a fresh upload to repair it without changing source history', async () => {
    const actor = await fixture();
    const bytes = await sharp({ create: { width: 120, height: 160, channels: 3, background: '#aabbcc' } }).png().toBuffer();
    const file = () => new File([new Uint8Array(bytes)], 'retry.png', { type: 'image/png' });
    const first = await uploadCustomAsset(actor, file(), 'reference');
    const [old] = await ownedAssets(database as any, actor.salonId, [first.id]);
    const oldPhoto = await canvaWebsiteImage(actor, old!);
    await import('@/features/onboarding-v1-integration/media-storage.server').then(module => module.deleteOnboardingMediaFile(old!.storageKey!, { salonId: actor.salonId }));
    const retry = await uploadCustomAsset(actor, file(), 'reference');

    expect(retry.id).not.toBe(first.id);
    expect(await ownedAssets(database as any, actor.salonId, [first.id, retry.id])).toHaveLength(2);

    const freshReference = (await ownedAssets(database as any, actor.salonId, [retry.id]))[0]!;
    const freshPhoto = await canvaWebsiteImage(actor, freshReference);

    expect(freshPhoto.id).not.toBe(oldPhoto.id);

    const { assetDataUrl } = await import('@/features/custom-sites/assets.server');

    expect(await assetDataUrl(freshPhoto)).toMatch(/^data:image\/webp;base64,/u);

    expect(await assetDataUrl((await ownedAssets(database as any, actor.salonId, [retry.id]))[0]!)).toMatch(/^data:image\/webp;base64,/u);
  });

  it('rejects invalid files and oversized token inputs before paid generation', async () => {
    const actor = await fixture();

    await expect(uploadCustomAsset(actor, new File(['<svg onload="bad()"/>'], 'bad.png', { type: 'image/png' }), 'photo')).rejects.toMatchObject({ code: 'INVALID' });
    await expect(uploadCustomAsset(actor, new File(['not a PDF'], 'bad.pdf', { type: 'application/pdf' }), 'reference')).rejects.toThrow();

    const pdf = await PDFDocument.create();
    for (let i = 0; i < 7; i++) {
      pdf.addPage([10, 10]);
    }

    await expect(uploadCustomAsset(actor, new File([await pdf.save()], 'many.pdf', { type: 'application/pdf' }), 'reference')).rejects.toThrow();

    const createResponse = vi.fn();

    await expect(generateCustomSite(actor, { expectedRevision: 2, operationId: randomUUID(), message: 'Build it', referenceIds: [] }, { createResponse, countInputTokens: vi.fn().mockResolvedValue(150001) })).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(createResponse).not.toHaveBeenCalled();
  });
});

describe('no-model contact repairs', () => {
  it('repairs legacy contacts atomically, preserves design/services, replays and never calls AI', async () => {
    const actor = await fixture();
    const legacy = { ...editorialSource, html: `${editorialSource.html}<a class="contact" data-luster-link="instagram">@TestStudio</a><a data-luster-link="email"><span data-luster-field="details.email">hello@example.com</span></a><a data-luster-link="phone"><span>416-555-0100</span></a>` };
    const first = await saveCustomSource(actor, { source: legacy, assetIds: [], expectedRevision: 2, operationId: randomUUID() });
    const input = { expectedRevision: first.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Make the Instagram clickable' };
    const provider = { createResponse: vi.fn() };
    const changed = await runSetupConversation(actor, input, provider);

    expect(provider.createResponse).not.toHaveBeenCalled();
    expect(changed.head.revision.document.website.content.websiteDetails).toMatchObject({ instagram: '@TestStudio', email: 'hello@example.com', phone: '416-555-0100' });
    expect(changed.head.revision.document.services).toEqual(first.head.revision.document.services);

    const [artifact] = await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.id, changed.head.revision.document.website.config.customFrontendId!));

    expect(artifact?.source.css).toBe(legacy.css);
    expect(artifact?.source.javascript).toBe(legacy.javascript);
    expect(artifact?.source.html).toContain('data-luster-field="details.instagram"');
    expect((await runSetupConversation(actor, input, provider)).head.revision.revision).toBe(changed.head.revision.revision);

    const [live] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

    expect(resolveBookingPageContent(live?.settings).live.websiteDetails).toBeUndefined();
    expect(await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.operationId, input.operationId))).toHaveLength(0);
  });

  it('applies a typed contact correction without paying for a design regeneration', async () => {
    const actor = await fixture();
    const legacy = { ...editorialSource, html: `${editorialSource.html}<a data-luster-link="instagram">@old_studio</a>` };
    const saved = await saveCustomSource(actor, { source: legacy, assetIds: [], expectedRevision: 2, operationId: randomUUID() });
    const provider = { createResponse: vi.fn().mockResolvedValue({ status: 'completed', usage: { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0 }, items: [{ type: 'message', text: JSON.stringify({ reply: 'Updating it.', operationsJson: JSON.stringify([{ type: 'website_details', values: { instagram: '@new_studio' } }]), designRequest: 'Update the Instagram', uploadFactsJson: null }) }] }) };
    const result = await runSetupConversation(actor, { expectedRevision: saved.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'My Instagram is @new_studio' }, provider);

    expect(provider.createResponse).toHaveBeenCalledTimes(1);
    expect(result.head.revision.document.website.content.websiteDetails?.instagram).toBe('@new_studio');

    const [artifact] = await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.id, result.head.revision.document.website.config.customFrontendId!));

    expect(artifact?.source.css).toBe(legacy.css);
    expect(artifact?.source.html).not.toContain('@old_studio');
  });

  it('asks about missing/ambiguous handles without changing or regenerating the saved design', async () => {
    const actor = await fixture();
    const legacy = { ...editorialSource, html: `${editorialSource.html}<p>@first @second</p>` };
    const saved = await saveCustomSource(actor, { source: legacy, assetIds: [], expectedRevision: 2, operationId: randomUUID() });
    const provider = { createResponse: vi.fn() };

    await expect(runSetupConversation(actor, { expectedRevision: saved.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Make Instagram clickable' }, provider)).rejects.toThrow('Which one');
    expect((await openSetup(actor)).revision.revision).toBe(saved.head.revision.revision);
    expect(provider.createResponse).not.toHaveBeenCalled();
  });
});

describe('approved model costs', () => {
  it('accounts separately for each model including cached inputs', () => {
    const usage = { inputTokens: 8000, outputTokens: 6000, cachedInputTokens: 0 };

    expect(estimateSetupAiCost(usage, 'gpt-6-luna')).toBe(3800);
    expect(estimateSetupAiCost(usage, 'gpt-6.1-sol')).toBe(76000);
    expect(estimateSetupAiCost({ inputTokens: 1000, outputTokens: 0, cachedInputTokens: 800, cacheWriteInputTokens: 100 }, 'gpt-6-luna')).toBe(31);
    expect(estimateSetupAiCost(null)).toBeNull();
  });

  it('rejects Astra rather than silently substituting a paid model', async () => {
    const actor = await fixture();
    const provider = { createResponse: vi.fn() };

    await expect(runSetupModel(actor, { operationId: randomUUID(), ordinal: 0, expectedRevision: 2, request: { model: 'gpt-6-astra', input: [], tools: [], toolChoice: 'none', maxOutputTokens: 100, timeoutMs: 1000, jsonMode: 'prompt' } }, provider)).rejects.toThrow('not enabled');
    expect(provider.createResponse).not.toHaveBeenCalled();
  });
});

describe('metered owner generation and automatic repair', () => {
  const response = (source: unknown, usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number } | null = { inputTokens: 2000, outputTokens: 1000, cachedInputTokens: 0 }) => ({ status: 'completed' as const, usage, items: [{ type: 'message' as const, text: JSON.stringify(source) }] });

  it('repairs missing public policy bindings, then keeps later policy edits independent of generated source', async () => {
    const actor = await fixture();
    const policy = { enabled: true, title: 'Before your visit', text: 'Please arrive on time.\nContact us to cancel.', showOnServicePage: true, showBeforeConfirmation: true, showAfterConfirmation: false, showInConfirmationEmail: true, acknowledgment: { required: true, text: 'I agree to the policy.' } };
    const initial = await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'booking_policy', values: policy }] });
    const connected = { ...editorialSource, html: `${editorialSource.html}<section data-luster-booking-policy><h2 data-luster-field="booking.policyTitle"></h2><p data-luster-field="booking.policyText"></p></section>` };
    const createResponse = vi.fn().mockResolvedValueOnce(response(editorialSource)).mockResolvedValueOnce(response(connected));
    const generated = await generateCustomSite(actor, { expectedRevision: initial.revision.revision, operationId: randomUUID(), message: 'Create the website with my saved details.', referenceIds: [] }, { createResponse });
    const context = JSON.parse(createResponse.mock.calls[0]![0].input.find((item: any) => item.role === 'developer').content);

    expect(context.publicBookingPolicy).toEqual({ title: policy.title, text: policy.text });
    expect(JSON.stringify(context)).not.toContain('I agree to the policy.');
    expect(createResponse).toHaveBeenCalledTimes(2);
    expect(createResponse.mock.calls[1]![0].input.at(-1).content).toContain('saved booking policy');
    expect((await reviewSetup(actor)).blockers).toEqual([]);
    expect(customSiteDataFromSetup(generated.head.revision.document).bookingPolicy).toEqual({ title: policy.title, text: policy.text });

    const edited = await editSetup(actor, { expectedRevision: generated.head.revision.revision, operationId: randomUUID(), operations: [{ type: 'booking_policy', values: { ...policy, text: 'Contact us if you need to cancel.' } }] });

    expect(edited.revision.document.website.config.customFrontendId).toBe(generated.artifactId);
    expect(customSiteDataFromSetup(edited.revision.document).bookingPolicy?.text).toBe('Contact us if you need to cancel.');
    expect(createResponse).toHaveBeenCalledTimes(2);

    const [live] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

    expect(JSON.stringify(live?.settings)).not.toContain('Contact us if you need to cancel.');

    const hidden = await editSetup(actor, { expectedRevision: edited.revision.revision, operationId: randomUUID(), operations: [{ type: 'booking_policy', values: { ...policy, showOnServicePage: false } }] });

    expect(customSiteDataFromSetup(hidden.revision.document).bookingPolicy).toBeNull();
    expect(hidden.revision.document.website.config.customFrontendId).toBe(generated.artifactId);
  });

  it('keeps confirmation-only policy copy out of generation and blocks approval of a newly visible unbound policy', async () => {
    const actor = await fixture();
    const policy = { enabled: true, title: 'Booking agreement', text: 'Confirmation-only copy', showOnServicePage: false, showBeforeConfirmation: true, showAfterConfirmation: false, showInConfirmationEmail: true };
    const initial = await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'booking_policy', values: policy }] });
    const createResponse = vi.fn().mockResolvedValue(response(editorialSource));
    const generated = await generateCustomSite(actor, { expectedRevision: initial.revision.revision, operationId: randomUUID(), message: 'Create the website.', referenceIds: [] }, { createResponse });
    const context = JSON.parse(createResponse.mock.calls[0]![0].input.find((item: any) => item.role === 'developer').content);

    expect(context.publicBookingPolicy).toBeNull();
    expect(JSON.stringify(context)).not.toContain(policy.text);

    await editSetup(actor, { expectedRevision: generated.head.revision.revision, operationId: randomUUID(), operations: [{ type: 'booking_policy', values: { ...policy, showOnServicePage: true } }] });
    const review = await reviewSetup(actor);

    expect(review.blockers).toContain('Your website design needs to include your saved booking policy. Ask Luster to add it before publishing.');
    await expect(approveSetup(actor, review.revision, review.hash)).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);
  });

  it('publishes an exact policy revision idempotently and leaves later draft wording private', async () => {
    const actor = await fixture();
    const policy = { enabled: true, title: 'Before your visit', text: 'Please arrive on time.', showOnServicePage: true, showBeforeConfirmation: true, showAfterConfirmation: false, showInConfirmationEmail: true };
    const initial = await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'booking_policy', values: policy }] });
    const connected = { ...editorialSource, html: `${editorialSource.html}<section data-luster-booking-policy><h2 data-luster-field="booking.policyTitle"></h2><p data-luster-field="booking.policyText"></p></section>` };
    const generated = await generateCustomSite(actor, { expectedRevision: initial.revision.revision, operationId: randomUUID(), message: 'Create my site.', referenceIds: [] }, { createResponse: vi.fn().mockResolvedValue(response(connected)) });
    const previous = { render: process.env.CUSTOM_SITE_RENDER_ORIGIN, app: process.env.NEXT_PUBLIC_APP_URL, verified: process.env.CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED };
    vi.stubEnv('CUSTOM_SITE_RENDER_ORIGIN', 'https://renderer.example.net');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://luster.example.com');
    vi.stubEnv('CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED', 'true');
    try {
      const review = await reviewSetup(actor);
      const approval = await approveSetup(actor, review.revision, review.hash);
      const input = { revision: review.revision, approvalId: approval.id, operationId: randomUUID() };
      const published = await publishSetup(actor, input);

      expect((await publishSetup(actor, input)).receipt.id).toBe(published.receipt.id);

      const reopened = await restartSetup(actor, generated.head.revision.revision);
      const edited = await editSetup(actor, { expectedRevision: reopened.revision.revision, operationId: randomUUID(), operations: [{ type: 'booking_policy', values: { ...policy, text: 'Updated, unapproved draft policy.' } }] });
      const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));
      const snapshot = await database.transaction(tx => readSetupSnapshot(tx, salon!));
      const live = await customSitePayload(actor.salonId, generated.artifactId, { ...customSiteDataFromSetup(snapshot.document), preview: false });
      const preview = await customSitePayload(actor.salonId, generated.artifactId, customSiteDataFromSetup(edited.revision.document));
      const [artifact] = await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.id, generated.artifactId));

      expect(live.data.bookingPolicy).toEqual({ title: policy.title, text: policy.text });
      expect(preview.data.bookingPolicy?.text).toBe('Updated, unapproved draft policy.');
      expect(preview.source).toEqual(artifact!.source);
      expect(live.source.html).toBe(preview.source.html);
      expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(1);
    } finally {
      vi.stubEnv('CUSTOM_SITE_RENDER_ORIGIN', previous.render);
      vi.stubEnv('NEXT_PUBLIC_APP_URL', previous.app);
      vi.stubEnv('CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED', previous.verified);
    }
  });

  it('starts with no previous source, preserves business setup and keeps the earlier design restorable', async () => {
    const actor = await fixture();
    const original = await saveCustomSource(actor, { source: editorialSource, assetIds: [], expectedRevision: 2, operationId: randomUUID() });
    const createResponse = vi.fn().mockResolvedValue(response(darkSource));
    const input = { expectedRevision: original.head.revision.revision, operationId: randomUUID(), message: 'A completely new dark design', referenceIds: [], startOver: true };
    const generated = await generateCustomSite(actor, input, { createResponse });
    const context = JSON.parse(createResponse.mock.calls[0]![0].input.find((item: any) => item.role === 'developer').content);

    expect(context.previousSource).toBeNull();
    expect(context.startOver).toBe(true);

    for (const field of ['business', 'services', 'hours', 'booking'] as const) {
      expect(generated.head.revision.document[field]).toEqual(original.head.revision.document[field]);
    }
    const replay = await generateCustomSite(actor, input, { createResponse });

    expect(replay.artifactId).toBe(generated.artifactId);
    expect(createResponse).toHaveBeenCalledTimes(1);

    const restored = await editSetup(actor, { expectedRevision: generated.head.revision.revision, operationId: randomUUID(), operations: [{ type: 'custom_frontend', artifactId: original.artifact.id }] });

    expect(restored.revision.document.website.config.customFrontendId).toBe(original.artifact.id);
    expect(restored.revision.document.services).toEqual(original.head.revision.document.services);

    const [live] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

    expect(resolveBookingPageConfig(live?.settings).live.customFrontendId).toBeUndefined();
  });

  it('retains invalid first output and the automatic repair, then resumes without another call', async () => {
    const actor = await fixture();
    const invalid = { ...editorialSource, html: `${editorialSource.html}<script>fetch('/admin')</script>` };
    const createResponse = vi.fn().mockResolvedValueOnce(response(invalid)).mockResolvedValueOnce(response(editorialSource));
    const input = { expectedRevision: 2, operationId: randomUUID(), message: 'Create my custom website', referenceIds: [] };
    const generated = await generateCustomSite(actor, input, { createResponse });
    const rows = await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.operationId, input.operationId)).orderBy(schema.setupAiCallSchema.ordinal);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.rawOutput).toBe(JSON.stringify(invalid));
    expect(rows[0]?.validation).toContain('unsupported element');
    expect(rows[1]?.rawOutput).toBe(JSON.stringify(editorialSource));
    expect(rows[1]?.validation).toBe('passed');
    expect(rows.every(row => row.provider === 'test-double' && row.model === 'gpt-6.1-sol' && row.elapsedMs !== null)).toBe(true);
    expect(rows.reduce((sum, row) => sum + row.chargedMicroCad, 0)).toBe(56000);
    expect((await resumeCustomSite(actor, input.operationId)).artifactId).toBe(generated.artifactId);
    expect(createResponse).toHaveBeenCalledTimes(2);
    expect((await openSetup(actor)).revision.revision).toBe(3);
  });

  it('edits an existing matched website when legacy reference selection is empty', async () => {
    const actor = await fixture();
    const createResponse = vi.fn().mockResolvedValue(response(editorialSource));
    const first = await generateCustomSite(actor, { expectedRevision: 2, operationId: randomUUID(), message: 'Build it', referenceIds: [] }, { createResponse });
    const head = await editSetup(actor, { expectedRevision: first.head.revision.revision, operationId: randomUUID(), operations: [{ type: 'design_brief', values: { fidelity: 'match', referenceIds: [], ownedReferenceIds: [], websiteAssetIds: [] } }] });
    const edited = await generateCustomSite(actor, { expectedRevision: head.revision.revision, operationId: randomUUID(), message: 'Make the Instagram clickable', referenceIds: [] }, { createResponse });

    expect(edited.head.revision.revision).toBe(head.revision.revision + 1);
    expect(createResponse).toHaveBeenCalledTimes(2);

    const [saved] = await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.id, edited.artifactId));

    expect(saved?.parentId).toBe(first.artifactId);
  });

  it('releases a failed conversation design immediately and accepts a new message', async () => {
    const actor = await fixture();
    const operationId = randomUUID();
    const reply = { reply: 'Updating your design.', operationsJson: '[]', designRequest: 'Change the hero', uploadFactsJson: null };
    const createResponse = vi.fn().mockResolvedValueOnce(response(reply)).mockRejectedValueOnce(new Error('provider stopped'));

    await expect(runSetupConversation(actor, { expectedRevision: 2, operationId, message: 'Change the hero', scope: 'website' }, { createResponse })).rejects.toThrow();

    const [turn] = await database.select().from(schema.businessSetupTurnSchema).where(eq(schema.businessSetupTurnSchema.id, operationId));

    expect(turn?.status).toBe('failed');
    expect(turn?.reply).toContain('saved');

    // Also recover older deployments that left the parent turn generated.
    await database.update(schema.businessSetupTurnSchema).set({ status: 'generated' }).where(eq(schema.businessSetupTurnSchema.id, operationId));
    const nextProvider = { createResponse: vi.fn().mockResolvedValue(response({ ...reply, reply: 'Ready.', designRequest: null })) };
    const next = await runSetupConversation(actor, { expectedRevision: 2, operationId: randomUUID(), message: 'What can I change?', scope: 'website' }, nextProvider);

    expect(next.reply).toBe('Ready.');
    expect(nextProvider.createResponse).toHaveBeenCalledTimes(1);
  });

  it('gives detailed generation more time while bounding its repair to the remaining request time', async () => {
    const actor = await fixture();
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const timeouts: number[] = [];
    const createResponse = vi.fn(async (request) => {
      timeouts.push(request.timeoutMs);
      if (timeouts.length === 1) {
        now += 210000;
        return response({ ...editorialSource, html: '<iframe></iframe>' });
      }
      return response(editorialSource);
    });
    try {
      await generateCustomSite(actor, { expectedRevision: 2, operationId: randomUUID(), message: 'Detailed design', referenceIds: [] }, { createResponse });

      expect(timeouts).toEqual([180000, 55000]);
    } finally {
      clock.mockRestore();
    }
  });

  it('does not start another paid repair when the request deadline is exhausted', async () => {
    const actor = await fixture();
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const operationId = randomUUID();
    const createResponse = vi.fn(async () => {
      now += 250000;
      return response({ ...editorialSource, html: '<iframe></iframe>' });
    });
    try {
      await expect(generateCustomSite(actor, { expectedRevision: 2, operationId, message: 'Detailed design', referenceIds: [] }, { createResponse })).rejects.toMatchObject({ code: 'NOT_READY' });
      expect(createResponse).toHaveBeenCalledTimes(1);
      expect(await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.operationId, operationId))).toHaveLength(1);
      expect((await openSetup(actor)).revision.revision).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('stops after one failed repair and keeps all output out of the saved website', async () => {
    const actor = await fixture();
    const invalid = { ...editorialSource, html: '<iframe src="/admin"></iframe>' };
    const createResponse = vi.fn().mockResolvedValue(response(invalid));
    const operationId = randomUUID();

    await expect(generateCustomSite(actor, { expectedRevision: 2, operationId, message: 'Build', referenceIds: [] }, { createResponse })).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(createResponse).toHaveBeenCalledTimes(2);
    expect((await openSetup(actor)).revision.revision).toBe(2);
    expect(await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.salonId, actor.salonId))).toHaveLength(0);
    expect(await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.operationId, operationId))).toHaveLength(2);
    await expect(resumeCustomSite(actor, operationId)).rejects.toThrow();
    expect((await openSetup(actor)).revision.revision).toBe(2);
    expect(createResponse).toHaveBeenCalledTimes(2);
  });

  it('recovers validated provider output after a source-save failure without paying again', async () => {
    const actor = await fixture();
    const other = await fixture();
    const operationId = randomUUID();
    const createResponse = vi.fn().mockResolvedValue(response(editorialSource));
    const failure = vi.spyOn(customArtifacts, 'storeCustomArtifact').mockRejectedValueOnce(new Error('Synthetic source-save interruption'));
    try {
      await expect(generateCustomSite(actor, { expectedRevision: 2, operationId, message: 'Design', referenceIds: [] }, { createResponse })).rejects.toMatchObject({ code: 'NOT_READY' });
    } finally {
      failure.mockRestore();
    }

    // A prior validator may have rejected something now supported. Retain
    // that historical verdict while checking the unchanged output again.
    await database.update(schema.setupAiCallSchema).set({ validation: 'Earlier application validation rejected this result.' }).where(eq(schema.setupAiCallSchema.operationId, operationId));

    await expect(resumeCustomSite(other, operationId)).rejects.toMatchObject({ code: 'NOT_READY' });

    const recovered = await resumeCustomSite(actor, operationId);

    expect(recovered.head.revision.revision).toBe(3);
    expect(recovered.artifactId).toBeTruthy();
    expect(createResponse).toHaveBeenCalledTimes(1);
    expect((await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.operationId, operationId)))).toHaveLength(1);
    expect((await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.operationId, operationId)))[0]?.validation).toBe('Earlier application validation rejected this result.');
  });

  it('changes a canonical price through conversation without rewriting the custom source', async () => {
    const actor = await fixture();
    const design = await generateCustomSite(actor, { expectedRevision: 2, operationId: randomUUID(), message: 'Design', referenceIds: [] }, { createResponse: vi.fn().mockResolvedValue(response(editorialSource)) });
    const service = design.head.revision.document.services[0]!;
    const { confirmed: _confirmed, origin: _origin, ...fields } = service;
    const createResponse = vi.fn().mockResolvedValue(response({ reply: 'Gel manicure is now $72 in your draft, ready for review. Your design is unchanged.', operationsJson: JSON.stringify([{ type: 'service', values: { ...fields, priceCents: 7200 } }]), designRequest: null }));
    const changed = await runSetupConversation(actor, { expectedRevision: 3, operationId: randomUUID(), scope: 'service_price', message: 'Keep the design, but change Gel manicure to $72' }, { createResponse });

    expect(changed.head.revision.document.website).toEqual(design.head.revision.document.website);
    expect(changed.head.revision.document.services[0]).toMatchObject({ id: service.id, priceCents: 7200, durationMinutes: 60, confirmed: false });
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);
    expect(createResponse).toHaveBeenCalledTimes(1);
  });

  it('does not transmit references after owner membership is removed', async () => {
    const actor = await fixture();
    await database.delete(schema.adminSalonMembershipSchema).where(eq(schema.adminSalonMembershipSchema.adminId, actor.adminId));
    const countInputTokens = vi.fn();
    const createResponse = vi.fn();

    await expect(generateCustomSite(actor, { expectedRevision: 2, operationId: randomUUID(), message: 'Design', referenceIds: [] }, { countInputTokens, createResponse })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(countInputTokens).not.toHaveBeenCalled();
    expect(createResponse).not.toHaveBeenCalled();
  });

  it('rejects unrelated changes in a price-only conversation', async () => {
    const actor = await fixture();
    const createResponse = vi.fn().mockResolvedValue(response({ reply: 'Changed.', operationsJson: JSON.stringify([{ type: 'business', values: { locationDisplayMode: 'full_address' } }]), designRequest: null }));

    await expect(runSetupConversation(actor, { expectedRevision: 2, operationId: randomUUID(), scope: 'service_price', message: 'Change Gel to $72' }, { createResponse })).rejects.toMatchObject({ code: 'INVALID' });
    expect((await openSetup(actor)).revision.document.business.locationDisplayMode).toBe('city_only');
    expect((await openSetup(actor)).revision.revision).toBe(2);
  });

  it('preserves newer manual edits and paid evidence if the design finishes after a concurrent save', async () => {
    const actor = await fixture();
    const operationId = randomUUID();
    const createResponse = vi.fn(async () => {
      await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'business', values: { city: 'Ottawa' } }] });
      return response(editorialSource);
    });

    await expect(generateCustomSite(actor, { expectedRevision: 2, operationId, message: 'Design', referenceIds: [] }, { createResponse })).rejects.toMatchObject({ code: 'STALE' });

    const head = await openSetup(actor);

    expect(head.revision.document.business.city).toBe('Ottawa');
    expect(head.revision.document.website.config.customFrontendId).toBeUndefined();
    expect((await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.operationId, operationId)))[0]?.rawOutput).toBe(JSON.stringify(editorialSource));
    expect(createResponse).toHaveBeenCalledTimes(1);
  });

  it('keeps unknown usage reserved and enforces one shared cap across different salons', async () => {
    const actor = await fixture();
    const other = await fixture();
    const operationId = randomUUID();
    await generateCustomSite(actor, { expectedRevision: 2, operationId, message: 'Design', referenceIds: [] }, { createResponse: vi.fn().mockResolvedValue(response(editorialSource, null)) });
    const [call] = await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.operationId, operationId));

    expect(call?.costMicroUsd).toBeNull();
    expect(call?.chargedMicroCad).toBe(call!.reservedMicroUsd * 2);

    const all = await database.select().from(schema.setupAiCallSchema);
    const used = all.reduce((sum, row) => sum + row.chargedMicroCad, 0);
    await database.update(schema.setupAiBudgetSchema).set({ capMicroCad: used + 1 });
    const createResponse = vi.fn();
    try {
      await expect(generateCustomSite(other, { expectedRevision: 2, operationId: randomUUID(), message: 'Another salon', referenceIds: [] }, { createResponse })).rejects.toThrow('approved AI trial budget');
      expect(createResponse).not.toHaveBeenCalled();
    } finally {
      await database.update(schema.setupAiBudgetSchema).set({ capMicroCad: 40000000 });
    }
  });
});

describe('private defaults for new drafts', () => {
  it('keeps a new unconfigured address private but preserves a published salon choice', async () => {
    const actor = { salonId: randomUUID(), adminId: randomUUID() };
    await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
    await database.insert(schema.salonSchema).values({ id: actor.salonId, slug: actor.salonId, name: 'My test business', publicationStatus: 'draft', settings: {} });
    await database.insert(schema.adminSalonMembershipSchema).values({ ...actor, role: 'owner' });
    const draft = await openSetup(actor);

    expect(draft.revision.document.business.locationDisplayMode).toBe('city_only');
    expect(draft.revision.document.website.content.locationDisplayMode).toBe('city_only');

    const other = { salonId: randomUUID(), adminId: actor.adminId };
    await database.insert(schema.salonSchema).values({ id: other.salonId, slug: other.salonId, name: 'Existing public salon', publicationStatus: 'published', settings: {} });
    await database.insert(schema.adminSalonMembershipSchema).values({ ...other, role: 'owner' });

    expect((await openSetup(other)).revision.document.business.locationDisplayMode).toBe('full_address');

    const explicit = { salonId: randomUUID(), adminId: actor.adminId };
    await database.insert(schema.salonSchema).values({ id: explicit.salonId, slug: explicit.salonId, name: 'Commercial studio', publicationStatus: 'draft', settings: { bookingPageContent: { draft: { locationDisplayMode: 'full_address' } } } as any });
    await database.insert(schema.adminSalonMembershipSchema).values({ ...explicit, role: 'owner' });

    expect((await openSetup(explicit)).revision.document.business.locationDisplayMode).toBe('full_address');

    const legacy = structuredClone(draft.revision.document);
    legacy.business.locationDisplayMode = 'full_address';
    const proposal = uploadFactsToOperations({ businessName: null, city: null, address: '42 Test Lane', currency: null, homeBased: true, hoursJson: '[]', servicesJson: '[]', notes: [] }, legacy, randomUUID());

    expect(proposal.operations).toEqual([{ type: 'business', values: { exactAddress: '42 Test Lane', homeBased: true, locationDisplayMode: 'city_only' } }]);

    legacy.business.exactAddress = '42 Test Lane';
    legacy.business.homeBased = true;
    const preserved = uploadFactsToOperations({ businessName: null, city: null, address: '42 Test Lane', currency: null, homeBased: true, hoursJson: '[]', servicesJson: '[]', notes: [] }, legacy, randomUUID());

    expect(preserved.operations).toEqual([{ type: 'business', values: { exactAddress: '42 Test Lane', homeBased: true, locationDisplayMode: 'full_address' } }]);
  });
});

describe('own business upload review', () => {
  const facts = (values: Record<string, unknown> = {}) => ({ businessName: 'Read Studio', city: 'Toronto', address: '42 Synthetic Lane', currency: 'CAD', hoursJson: JSON.stringify([{ day: 'tuesday', status: 'open', open: '10:00', close: '18:00' }]), servicesJson: JSON.stringify([{ name: 'Gel manicure', description: null, priceKind: 'fixed', priceCents: 7000, durationMinutes: null, kind: 'base', category: 'manicure', bookingCategory: 'manicure' }, { name: 'BIAB', description: null, priceKind: 'from', priceCents: 6500, durationMinutes: null, kind: 'base', category: 'builder_gel', bookingCategory: 'manicure' }]), notes: [], ...values });

  it('uses prices read from an own menu in place of unconfirmed AI recommendations', async () => {
    const actor = await fixture();
    const head = await openSetup(actor);
    const { origin: _origin, confirmed: _confirmed, ...fields } = head.revision.document.services[0]!;
    const suggested = applySetupOperations(head.revision.document, [{ type: 'service', values: { ...fields, priceCents: 6000 } }], 'assistant');
    const read = conversationalUpload(facts(), suggested, randomUUID());
    const after = applySetupOperations(suggested, read.operations, 'upload');

    expect(after.services[0]).toMatchObject({ priceCents: 7000, confirmed: false, origin: 'upload' });
    expect(read.notes).not.toContainEqual(expect.stringMatching(/Gel manicure.*kept the saved value/iu));

    const protectedRead = conversationalUpload(facts(), head.revision.document, randomUUID());
    const protectedAfter = applySetupOperations(head.revision.document, protectedRead.operations, 'upload');

    expect(protectedAfter.services[0]?.priceCents).toBe(6500);
    expect(protectedRead.notes).toContainEqual(expect.stringMatching(/Gel manicure.*kept the saved value/iu));
  });

  async function upload(actor: { salonId: string; adminId: string }) {
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ffffff' } }).png().toBuffer();
    return uploadCustomAsset(actor, new File([new Uint8Array(png)], 'synthetic-menu.png', { type: 'image/png' }), 'reference');
  }
  const model = (value: unknown) => ({ createResponse: vi.fn().mockResolvedValue({ status: 'completed', usage: { inputTokens: 1200, outputTokens: 800, cachedInputTokens: 0 }, items: [{ type: 'message', text: JSON.stringify(value) }] }) });

  it('accepts validated nested arrays returned by real chat extraction without weakening fact validation', async () => {
    const actor = await fixture();
    const head = await openSetup(actor);
    const raw = facts();
    const nested = { ...raw, hoursJson: JSON.parse(raw.hoursJson), servicesJson: JSON.parse(raw.servicesJson) };

    expect(uploadFactsToOperations(nested, head.revision.document, 'same-operation')).toEqual(uploadFactsToOperations(raw, head.revision.document, 'same-operation'));
    expect(() => uploadFactsToOperations({ ...nested, hoursJson: [{ ...nested.hoursJson[0], publish: true }] }, head.revision.document, randomUUID())).toThrow();
    expect(() => uploadFactsToOperations({ ...nested, servicesJson: [{ ...nested.servicesJson[0], durationMinutes: 0 }] }, head.revision.document, randomUUID())).toThrow();
  });

  it.each(['', 'Appointment lengths are not visible.', '["Appointment lengths are not visible."]'])('normalizes supported notes representation %j without changing extracted facts', async (notes) => {
    const actor = await fixture();
    const document = (await openSetup(actor)).revision.document;
    const expectedNotes = notes ? ['Appointment lengths are not visible.'] : [];

    expect(uploadFactsToOperations(facts({ notes }), document, 'same-operation'))
      .toEqual(uploadFactsToOperations(facts({ notes: expectedNotes }), document, 'same-operation'));
  });

  it.each([null, {}, '[{"publish":true}]', '["broken"', 'x'.repeat(401), JSON.stringify(Array.from({ length: 16 }, () => 'note')), ' '.repeat(6501)].map((notes, index) => [index, notes]))('rejects invalid or oversized extraction notes (case %i)', async (_index, notes) => {
    const actor = await fixture();
    const document = (await openSetup(actor)).revision.document;

    expect(() => uploadFactsToOperations(facts({ notes }), document, randomUUID())).toThrow();
    expect((await openSetup(actor)).revision.document).toEqual(document);
  });

  it('reads privately, retains a review across reloads, then applies once without touching live data', async () => {
    const actor = await fixture();
    const asset = await upload(actor);
    const input = { expectedRevision: 2, operationId: randomUUID(), referenceIds: [asset.id], source: 'my_business' };
    const provider = model(facts());
    const review = await readOwnUpload(actor, input, provider);

    expect(review.status).toBe('upload_review');
    expect((await openSetup(actor)).revision.revision).toBe(2);
    expect((await readOwnUpload(actor, input, provider)).id).toBe(review.id);
    expect(provider.createResponse).toHaveBeenCalledTimes(1);
    expect(provider.createResponse.mock.calls[0]![0].input[1].content[1].type).toBe('input_image');

    const applied = await applyOwnUpload(actor, review.id);

    expect((await applyOwnUpload(actor, review.id)).revision.revision).toBe(applied.revision.revision);
    expect(applied.revision.document.services).toHaveLength(2);
    expect(applied.revision.document.services[0]).toMatchObject({ id: 'draft_gel', priceCents: 7000, durationMinutes: 60, cleanupBufferMinutes: 10, confirmed: false, origin: 'upload' });
    expect(applied.revision.document.services[1]).toMatchObject({ name: 'BIAB', priceCents: 6500, priceDisplayText: 'From $65.00', durationMinutes: null, confirmed: false });
    expect(applied.revision.document.business).toMatchObject({ name: 'Read Studio', exactAddress: '42 Synthetic Lane', locationDisplayMode: 'city_only' });
    expect(applied.revision.document.hours.monday).toEqual({ open: '09:00', close: '17:00' });
    expect(applied.revision.document.hours.tuesday).toEqual({ open: '10:00', close: '18:00' });
    expect((await reviewSetup(actor)).blockers.length).toBeGreaterThan(0);
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);
    expect((await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId)))[0]).toMatchObject({ name: 'Untitled business', publicationStatus: 'draft', address: null });
  });

  it('rejects cross-tenant files and reviews before model access or draft writes', async () => {
    const actor = await fixture();
    const other = await fixture();
    const asset = await upload(actor);
    const provider = model(facts());
    const operationId = randomUUID();

    await expect(readOwnUpload(other, { expectedRevision: 2, operationId, referenceIds: [asset.id], source: 'my_business' }, provider)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(provider.createResponse).not.toHaveBeenCalled();

    await readOwnUpload(actor, { expectedRevision: 2, operationId, referenceIds: [asset.id], source: 'my_business' }, provider);

    await expect(applyOwnUpload(other, operationId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(dismissOwnUpload(other, operationId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await openSetup(other)).revision.revision).toBe(2);
  });

  it('detects later manual edits and lets the owner dismiss an outdated review', async () => {
    const actor = await fixture();
    const asset = await upload(actor);
    const operationId = randomUUID();
    await readOwnUpload(actor, { expectedRevision: 2, operationId, referenceIds: [asset.id], source: 'my_business' }, model(facts()));
    await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'business', values: { name: 'My corrected name' } }] });

    await expect(applyOwnUpload(actor, operationId)).rejects.toMatchObject({ code: 'STALE' });

    await dismissOwnUpload(actor, operationId);
    await dismissOwnUpload(actor, operationId);

    await expect(applyOwnUpload(actor, operationId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await openSetup(actor)).revision.document.business.name).toBe('My corrected name');
  });

  it('rejects invented actions and unsafe fields in provider output without accepting any changes', async () => {
    const actor = await fixture();
    const asset = await upload(actor);
    const input = { expectedRevision: 2, operationId: randomUUID(), referenceIds: [asset.id], source: 'my_business' };

    await expect(readOwnUpload(actor, input, model(facts({ publish: true, salonId: 'another', locationDisplayMode: 'full_address' })))).rejects.toMatchObject({ code: 'NOT_READY' });
    expect((await openSetup(actor)).revision.revision).toBe(2);
    await expect(applyOwnUpload(actor, input.operationId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never converts add-ons, duplicate names or ambiguous amounts into guessed bookable services', async () => {
    const actor = await fixture();
    const head = await openSetup(actor);
    const base = { name: 'French tips', description: null, priceKind: 'fixed', priceCents: 1500, durationMinutes: 15, kind: 'addon', category: 'manicure', bookingCategory: 'manicure' };
    const proposal = uploadFactsToOperations(facts({ businessName: null, city: null, address: null, currency: null, hoursJson: '[]', servicesJson: JSON.stringify([base, { ...base, kind: 'unclear' }, { ...base, name: 'New service', kind: 'base', priceKind: 'range' }, { ...base, name: 'New service', kind: 'base' }]) }), head.revision.document, randomUUID());

    expect(proposal.operations).toHaveLength(1);
    expect(proposal.operations[0]).toMatchObject({ type: 'service', values: { name: 'New service', priceCents: null } });
    expect(proposal.notes.join(' ')).toContain('repeated');
    expect(proposal.notes.join(' ')).toContain('add-on');
  });

  it('leaves the draft unchanged when an upload cannot be read, and rejects conflicting hours', async () => {
    const actor = await fixture();
    const head = await openSetup(actor);
    const empty = uploadFactsToOperations(facts({ businessName: null, city: null, address: null, currency: null, hoursJson: '[]', servicesJson: '[]' }), head.revision.document, randomUUID());

    expect(empty.operations).toEqual([]);
    expect(() => uploadFactsToOperations(facts({ hoursJson: JSON.stringify([{ day: 'monday', status: 'open', open: '10:00', close: '18:00' }, { day: 'monday', status: 'closed', open: null, close: null }]) }), head.revision.document, randomUUID())).toThrow('conflicting');
    expect((await openSetup(actor)).revision.revision).toBe(2);
  });
});

describe('owned design matching and website photos', () => {
  it.each([false, true])('prepares a detailed website photo within the six-image budget (private preview: %s)', async (preview) => {
    const actor = await fixture();
    const pixels = Buffer.alloc(1400 * 700 * 3);
    let state = 31;
    for (let i = 0; i < pixels.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      pixels[i] = state >>> 24;
    }
    const bytes = await sharp(pixels, { raw: { width: 1400, height: 700, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
    const oldEnvironment = process.env.APP_ENV;
    const oldPrivate = process.env.CUSTOM_SITE_PREVIEW_PRIVATE_IMAGES;
    vi.stubEnv('APP_ENV', preview ? 'preview' : 'development');
    vi.stubEnv('CUSTOM_SITE_PREVIEW_PRIVATE_IMAGES', preview ? 'true' : 'false');
    try {
      const uploaded = await uploadCustomAsset(actor, new File([new Uint8Array(bytes)], 'detailed-photo.png', { type: 'image/png' }), 'photo');
      const [saved] = await ownedAssets(database as any, actor.salonId, [uploaded.id]);
      const normalized = Buffer.from((await assetDataUrl(saved!)).split(',')[1]!, 'base64');
      const metadata = await sharp(normalized).metadata();

      expect(saved!.byteSize).toBeLessThanOrEqual(MAX_WEBSITE_IMAGE_BYTES);
      expect(metadata.width! / metadata.height!).toBe(2);
      expect(metadata.width).toBeGreaterThanOrEqual(896);
      expect(metadata.width).toBeLessThanOrEqual(1400);
      expect(saved!.imageBase64 !== null).toBe(preview);
      expect((await openSetup(actor)).revision.revision).toBe(2);
      expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);
      expect(await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.salonId, actor.salonId))).toHaveLength(0);
    } finally {
      vi.stubEnv('APP_ENV', oldEnvironment);
      vi.stubEnv('CUSTOM_SITE_PREVIEW_PRIVATE_IMAGES', oldPrivate);
    }
  }, 20_000);

  it('rejects an oversized legacy image selection before any provider call or usage reservation', async () => {
    const actor = await fixture();
    const ids: string[] = [];
    for (const color of ['#123456', '#345678', '#56789a']) {
      const bytes = await sharp({ create: { width: 40, height: 60, channels: 3, background: color } }).png().toBuffer();
      const asset = await uploadCustomAsset(actor, new File([new Uint8Array(bytes)], 'legacy.png', { type: 'image/png' }), 'photo');
      // Emulate metadata from the earlier 750 KB per-image storage contract.
      // Insert a fixture version; the database correctly forbids mutating an
      // already saved asset, even inside this disposable integration database.
      const [original] = await ownedAssets(database as any, actor.salonId, [asset.id]);
      const id = randomUUID();
      await database.insert(schema.customSiteAssetSchema).values({ ...original!, id, byteSize: 750000 });
      ids.push(id);
    }
    await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'design_brief', values: { fidelity: 'inspiration', referenceIds: [], ownedReferenceIds: [], websiteAssetIds: ids } }] });
    const createResponse = vi.fn();
    const countInputTokens = vi.fn(async () => 10000);

    await expect(generateCustomSite(actor, { expectedRevision: 3, operationId: randomUUID(), message: 'Build my website', referenceIds: [] }, { createResponse, countInputTokens }))
      .rejects.toThrow('These photos are too large together');
    expect(createResponse).not.toHaveBeenCalled();
    expect(countInputTokens).not.toHaveBeenCalled();
    expect(await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.salonId, actor.salonId))).toHaveLength(0);
    expect((await openSetup(actor)).revision.revision).toBe(3);
  });

  async function photo(actor: { salonId: string; adminId: string }, role: 'photo' | 'reference' | 'logo' = 'photo') {
    const bytes = await sharp({ create: { width: 40, height: 60, channels: 3, background: '#eecbdb' } }).png().toBuffer();
    return uploadCustomAsset(actor, new File([new Uint8Array(bytes)], `${role}.png`, { type: 'image/png' }), role);
  }

  it('reviews price-only return visits without repeating saved references, including older drafts', async () => {
    const previous = { render: process.env.CUSTOM_SITE_RENDER_ORIGIN, app: process.env.NEXT_PUBLIC_APP_URL, verified: process.env.CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED };
    vi.stubEnv('CUSTOM_SITE_RENDER_ORIGIN', 'https://renderer.example.net');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://builder.example.com');
    vi.stubEnv('CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED', 'true');
    try {
      const actor = await fixture();
      const reference = await photo(actor, 'reference');
      const brief = { fidelity: 'inspiration', referenceIds: [reference.id], ownedReferenceIds: [], websiteAssetIds: [] };
      const selected = await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'design_brief', values: brief }] });
      const saved = await saveCustomSource(actor, { expectedRevision: selected.revision.revision, operationId: randomUUID(), source: editorialSource, assetIds: [reference.id] });
      const firstReview = await reviewSetup(actor);
      const firstApproval = await approveSetup(actor, firstReview.revision, firstReview.hash);
      await publishSetup(actor, { revision: firstReview.revision, approvalId: firstApproval.id, operationId: randomUUID() });
      const reopened = await restartSetup(actor, firstReview.revision);

      expect(reopened.workspace.baseline.designBrief).toEqual(saved.head.revision.document.designBrief);
      expect((await reviewSetup(actor)).changes).toEqual([]);

      // The old restart path omitted private reference metadata from the
      // comparison baseline. Its immutable revisions/approvals stay intact.
      const legacyBaseline = structuredClone(reopened.workspace.baseline);
      delete legacyBaseline.designBrief;
      await database.update(schema.businessSetupWorkspaceSchema).set({ baseline: legacyBaseline }).where(eq(schema.businessSetupWorkspaceSchema.id, reopened.workspace.id));
      const service = reopened.revision.document.services[0]!;
      const { origin: _origin, confirmed: _confirmed, ...serviceValues } = service;
      const changed = await editSetup(actor, { expectedRevision: reopened.revision.revision, operationId: randomUUID(), operations: [{ type: 'service', values: { ...serviceValues, priceCents: 7500 } }] });
      const review = await reviewSetup(actor);

      expect(review.changes.some(change => change.path.startsWith('designBrief'))).toBe(false);
      expect(review.changes.some(change => change.path === 'services')).toBe(true);
      expect((await database.select().from(schema.businessSetupWorkspaceSchema).where(eq(schema.businessSetupWorkspaceSchema.id, reopened.workspace.id)))[0]!.baseline.designBrief).toBeUndefined();
      expect((await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, service.id)))[0]!.price).toBe(6500);

      const approval = await approveSetup(actor, review.revision, review.hash);
      const request = { revision: review.revision, approvalId: approval.id, operationId: randomUUID() };
      const published = await publishSetup(actor, request);

      expect((await publishSetup(actor, request)).receipt.id).toBe(published.receipt.id);
      expect(changed.revision.document.website.config.customFrontendId).toBe(saved.artifact.id);
      expect((await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.id, service.id)))[0]!.price).toBe(7500);

      const next = await restartSetup(actor, review.revision);
      const replacementBytes = await sharp({ create: { width: 40, height: 60, channels: 3, background: '#123456' } }).png().toBuffer();
      const replacement = await uploadCustomAsset(actor, new File([new Uint8Array(replacementBytes)], 'different-reference.png', { type: 'image/png' }), 'reference');
      const different = await editSetup(actor, { expectedRevision: next.revision.revision, operationId: randomUUID(), operations: [{ type: 'design_brief', values: { ...next.revision.document.designBrief, referenceIds: [replacement.id] } }] });
      const differentReview = await reviewSetup(actor);

      expect(differentReview.changes).toContainEqual({ path: 'designBrief.referenceIds', before: [reference.id], after: [replacement.id] });
      await expect(publishSetup(actor, { revision: different.revision.revision, approvalId: approval.id, operationId: randomUUID() })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });

      // Private comparison metadata must never weaken the canonical SQL hash.
      await database.update(schema.serviceSchema).set({ price: 7600 }).where(eq(schema.serviceSchema.id, service.id));

      await expect(reviewSetup(actor)).rejects.toMatchObject({ code: 'STALE' });
    } finally {
      vi.stubEnv('CUSTOM_SITE_RENDER_ORIGIN', previous.render);
      vi.stubEnv('NEXT_PUBLIC_APP_URL', previous.app);
      vi.stubEnv('CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED', previous.verified);
    }
  });

  it('persists owned matching choices with the draft, rejects other salons, and sends actual reference ownership to the model', async () => {
    const actor = await fixture();
    const foreign = await photo(await fixture());
    const reference = await photo(actor, 'reference');
    const image = await photo(actor);
    const values = { fidelity: 'match', referenceIds: [reference.id], ownedReferenceIds: [reference.id], websiteAssetIds: [image.id] };
    const input = { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'design_brief', values }] };

    await expect(editSetup(actor, input, 'assistant')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(editSetup(actor, { ...input, operations: [{ type: 'design_brief', values: { ...values, websiteAssetIds: [foreign.id] } }] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(editSetup(actor, { ...input, operations: [{ type: 'design_brief', values: { ...values, websiteAssetIds: [reference.id] } }] })).rejects.toMatchObject({ code: 'INVALID' });

    await editSetup(actor, input);
    const head = await openSetup(actor);

    expect(head.revision.document.designBrief).toEqual(values);
    expect(head.revision.document.services[0]?.priceCents).toBe(6500);

    const createResponse = vi.fn().mockResolvedValue({ status: 'completed', usage: null, items: [{ type: 'message', text: JSON.stringify(editorialSource) }] });
    await generateCustomSite(actor, { expectedRevision: 3, operationId: randomUUID(), message: 'Make this my booking website', referenceIds: [], startOver: false }, { createResponse, countInputTokens: async () => 10000 });
    const request = createResponse.mock.calls[0]![0];
    const context = JSON.parse(request.input[1].content);

    expect(context.designBrief).toEqual(values);
    expect(JSON.stringify(request.input)).toContain('Owner-confirmed original business design');
    expect(request.input.at(-1).content.filter((part: any) => part.type === 'input_image')).toHaveLength(2);
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);
  });

  it('replaces and removes draft photos idempotently without changing prior versions, service data or live settings', async () => {
    const actor = await fixture();
    const a = await photo(actor);
    const b = await photo(actor);
    const other = await photo(await fixture());
    const originalSource = { ...editorialSource, html: editorialSource.html.replace('<main', `<img src="asset:${a.id}" alt="Owner photograph"><main`) };
    const original = await saveCustomSource(actor, { expectedRevision: 2, operationId: randomUUID(), source: originalSource, assetIds: [a.id] });
    await editSetup(actor, { expectedRevision: 3, operationId: randomUUID(), operations: [{ type: 'design_brief', values: { fidelity: 'inspiration', referenceIds: [], ownedReferenceIds: [], websiteAssetIds: [a.id] } }] });
    const before = (await openSetup(actor)).revision.document;

    await expect(editCustomMedia(actor, { expectedRevision: 4, operationId: randomUUID(), assetId: a.id, replacementId: other.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const input = { expectedRevision: 4, operationId: randomUUID(), assetId: a.id, replacementId: b.id };
    const changed = await editCustomMedia(actor, input);
    const replay = await editCustomMedia(actor, input);

    expect(replay.artifactId).toBe(changed.artifactId);
    expect(replay.head.revision.revision).toBe(5);
    expect(changed.head.revision.document.services).toEqual(before.services);
    expect(changed.head.revision.document.designBrief?.websiteAssetIds).toEqual([b.id]);

    const publicData = { business: { name: 'Test', city: 'Toronto', address: null, bio: '', hours: {} }, services: [], currency: 'CAD', preview: false };

    expect(Object.keys((await customSitePayload(actor.salonId, original.artifact.id, publicData)).images)).toEqual([a.id]);
    expect(Object.keys((await customSitePayload(actor.salonId, changed.artifactId, publicData)).images)).toEqual([b.id]);

    const removed = await editCustomMedia(actor, { expectedRevision: 5, operationId: randomUUID(), assetId: b.id, replacementId: null });

    expect((await customSitePayload(actor.salonId, removed.artifactId, publicData)).images).toEqual({});
    expect(removed.head.revision.document.designBrief?.websiteAssetIds).toEqual([]);
    await expect(editCustomMedia(actor, { ...input, operationId: randomUUID() })).rejects.toMatchObject({ code: 'STALE' });

    const restored = await editSetup(actor, { expectedRevision: 6, operationId: randomUUID(), operations: [{ type: 'custom_frontend', artifactId: original.artifact.id }] });

    expect(restored.revision.document.designBrief?.websiteAssetIds).toEqual([a.id]);

    const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

    expect(salon!.publicationStatus).toBe('draft');
    expect(salon!.onlineBookingEnabled).toBe(false);
  });

  it('does not inherit deselected photos into a new generated revision', async () => {
    const actor = await fixture();
    const a = await photo(actor);
    const source = { ...editorialSource, html: editorialSource.html.replace('<main', `<img src="asset:${a.id}" alt="Owner photograph"><main`) };
    await saveCustomSource(actor, { expectedRevision: 2, operationId: randomUUID(), source, assetIds: [a.id] });
    await editSetup(actor, { expectedRevision: 3, operationId: randomUUID(), operations: [{ type: 'design_brief', values: { fidelity: 'inspiration', referenceIds: [], ownedReferenceIds: [], websiteAssetIds: [] } }] });
    const createResponse = vi.fn().mockResolvedValue({ status: 'completed', usage: null, items: [{ type: 'message', text: JSON.stringify(editorialSource) }] });
    const result = await generateCustomSite(actor, { expectedRevision: 4, operationId: randomUUID(), message: 'Keep the layout without that photo', referenceIds: [] }, { createResponse, countInputTokens: async () => 10000 });

    expect(JSON.parse(createResponse.mock.calls[0]![0].input[1].content).assets).toEqual([]);

    const [saved] = await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.id, result.artifactId));

    expect(saved!.assetIds).toEqual([]);
  });
});

describe('reading own images directly in conversation', () => {
  const facts = { businessName: 'Petal Nails', city: 'Toronto', address: '42 Synthetic Lane', homeBased: true, currency: 'CAD', hoursJson: JSON.stringify([{ day: 'tuesday', status: 'open', open: '10:00', close: '18:00' }]), servicesJson: JSON.stringify([{ name: 'BIAB', description: null, priceKind: 'fixed', priceCents: 6500, durationMinutes: null, kind: 'base', category: 'builder_gel', bookingCategory: 'manicure' }]), notes: [] };
  const answer = (values: Record<string, unknown> = {}) => ({ reply: 'How long is a BIAB appointment, and do you work on your own?', operationsJson: '[]', designRequest: null, uploadFactsJson: JSON.stringify(facts), ...values });
  const model = (value: unknown, source = editorialSource) => ({ createResponse: vi.fn().mockResolvedValueOnce({ status: 'completed', usage: { inputTokens: 1200, outputTokens: 800, cachedInputTokens: 0 }, items: [{ type: 'message', text: JSON.stringify(value) }] }).mockResolvedValue({ status: 'completed', usage: { inputTokens: 1200, outputTokens: 800, cachedInputTokens: 0 }, items: [{ type: 'message', text: JSON.stringify(source) }] }) });
  async function attached(empty = true, own = true) {
    const actor = await fixture();
    if (empty) {
      // A different new salon, without erasing the original fixture or trial data.
      actor.salonId = randomUUID();
      await database.insert(schema.salonSchema).values({ id: actor.salonId, slug: actor.salonId, name: 'Untitled business', publicationStatus: 'draft', onlineBookingEnabled: false });
      await database.insert(schema.adminSalonMembershipSchema).values({ ...actor, role: 'owner' });
      await openSetup(actor);
    }
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } }).png().toBuffer();
    const asset = await uploadCustomAsset(actor, new File([new Uint8Array(png)], 'own-menu.png', { type: 'image/png' }), 'reference');
    const head = await openSetup(actor);
    const saved = await editSetup(actor, { expectedRevision: head.revision.revision, operationId: randomUUID(), operations: [{ type: 'design_brief', values: { fidelity: 'match', referenceIds: [asset.id], ownedReferenceIds: own ? [asset.id] : [], websiteAssetIds: [] } }] });
    return { actor, asset, revision: saved.revision.revision };
  }

  it('captures explicit business answers before generating when the same message requests sample details', async () => {
    const { actor, asset, revision } = await attached(true, false);
    const provider = model({ reply: 'I am creating your draft with suggested booking details.', uploadFacts: null, designRequest: 'Follow the attached floral reference.', operationsJson: JSON.stringify([{ type: 'business', values: { name: 'Pink Lily Studio', city: 'Toronto', workMode: 'solo' } }, { type: 'service', values: { id: 'draft_biab', name: 'BIAB', description: null, priceCents: null, durationMinutes: null, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, category: 'builder_gel', bookingCategory: 'manicure' } }]) });
    const result = await runSetupConversation(actor, { expectedRevision: revision, operationId: randomUUID(), scope: 'business_and_website', message: 'Create my website for Pink Lily Studio. I work solo in Toronto. My service menu should include BIAB. Use suggested services and hours for now.', referenceIds: [asset.id] }, provider);

    expect(result.head.revision.document.business).toMatchObject({ name: 'Pink Lily Studio', city: 'Toronto', workMode: 'solo' });
    expect(result.head.revision.document.website.config.customFrontendId).toBeTruthy();
    expect(result.head.revision.document.services.map(service => service.name)).toEqual(['BIAB']);
    expect(result.head.revision.document.services[0]!.confirmed).toBe(false);
    expect(JSON.parse(provider.createResponse.mock.calls[1]![0].input[1].content).business.name).toBe('Pink Lily Studio');
    expect(provider.createResponse).toHaveBeenCalledTimes(2);
  });

  it('does not call complete chat-supplied service details invented samples while still requiring their review', async () => {
    const { actor, asset } = await attached(false, false);
    const before = (await openSetup(actor)).revision;
    const { origin: _origin, confirmed: _confirmed, ...service } = before.document.services[0]!;
    const supplied = await editSetup(actor, { expectedRevision: before.revision, operationId: randomUUID(), operations: [{ type: 'service', values: service }] }, 'assistant');
    const provider = model(answer({ uploadFactsJson: null, designRequest: 'Make the website from the reference.' }));
    const result = await runSetupConversation(actor, { expectedRevision: supplied.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Make my website look like this.', referenceIds: [asset.id] }, provider);

    expect(result.reply).toContain('from your saved details');
    expect(result.reply).not.toContain('sample booking');
    expect(result.head.revision.document.services).toEqual(supplied.revision.document.services);
    expect(result.head.revision.document.services[0]!.confirmed).toBe(false);
    expect((await reviewSetup(actor)).blockers).toContain('Review the price and time for Gel manicure.');
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);
  });

  it('creates a real editable first preview from just make it up without intake or extraction calls, and gates publication on review', async () => {
    const { actor, asset, revision } = await attached();
    const createResponse = vi.fn().mockResolvedValue({ status: 'completed', usage: { inputTokens: 1200, outputTokens: 1800, cachedInputTokens: 0 }, items: [{ type: 'message', text: JSON.stringify(editorialSource) }] });
    const provider = { createResponse };
    const input = { expectedRevision: revision, operationId: randomUUID(), scope: 'website', message: 'Just make it up', referenceIds: [asset.id] };
    const result = await runSetupConversation(actor, input, provider);
    const draft = result.head.revision.document;

    expect(createResponse).toHaveBeenCalledTimes(1);
    expect(createResponse.mock.calls[0]![0].model).toBe('gpt-6.1-sol');
    expect(JSON.parse(createResponse.mock.calls[0]![0].input[1].content).business).toMatchObject({ name: 'Your salon', city: 'Your area', address: null });
    expect(draft.website.config.customFrontendId).toBeTruthy();
    expect(draft.business).toMatchObject({ name: 'Untitled business', city: '', workMode: 'unknown', exactAddress: '', locationDisplayMode: 'city_only' });
    expect(draft.hoursOrigin).toBe('suggested');
    expect(draft.services).toHaveLength(1);
    expect(draft.services[0]).toMatchObject({ name: 'Signature appointment', priceCents: 6500, durationMinutes: 60, confirmed: false, origin: 'assistant' });
    expect((await openSetup(actor)).revision.document).toEqual(draft);
    expect((await runSetupConversation(actor, input, provider)).head.revision.revision).toBe(result.head.revision.revision);
    expect(createResponse).toHaveBeenCalledTimes(1);

    const review = await reviewSetup(actor);

    expect(review.blockers).toContain('Review the suggested opening hours.');
    expect(review.blockers).toContain('Review the price and time for Signature appointment.');
    expect(review.blockers).toContain('Confirm your business name.');
    await expect(approveSetup(actor, review.revision, review.hash)).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);

    const approvedDetails = await editSetup(actor, { expectedRevision: result.head.revision.revision, operationId: randomUUID(), operations: [{ type: 'business', values: { name: 'New Studio', city: 'Toronto', workMode: 'solo' } }, { type: 'confirm_hours' }, { type: 'confirm_services', ids: [draft.services[0]!.id] }] });

    expect((await reviewSetup(actor)).blockers).toEqual([]);
    expect(approvedDetails.revision.document.website.config.customFrontendId).toBe(draft.website.config.customFrontendId);
    expect(approvedDetails.revision.document.hoursOrigin).toBe('owner');
    expect(approvedDetails.revision.document.services[0]!.confirmed).toBe(true);

    const previous = { render: process.env.CUSTOM_SITE_RENDER_ORIGIN, app: process.env.NEXT_PUBLIC_APP_URL, verified: process.env.CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED };
    vi.stubEnv('CUSTOM_SITE_RENDER_ORIGIN', 'https://renderer.example.net');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://luster.example.com');
    vi.stubEnv('CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED', 'true');
    try {
      const ready = await reviewSetup(actor);
      const approval = await approveSetup(actor, ready.revision, ready.hash);
      const request = { approvalId: approval.id, revision: ready.revision, operationId: randomUUID() };
      const published = await publishSetup(actor, request);

      expect((await publishSetup(actor, request)).receipt.id).toBe(published.receipt.id);

      const services = await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId));
      const [staff] = await database.select().from(schema.technicianSchema).where(eq(schema.technicianSchema.salonId, actor.salonId));
      const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

      expect(services).toHaveLength(1);
      expect(services[0]).toMatchObject({ price: 6500, durationMinutes: 60 });
      expect(published.receipt.serviceIds[draft.services[0]!.id]).toBe(services[0]!.id);
      expect(staff!.weeklySchedule?.tuesday).toEqual({ start: '10:00', end: '18:00' });
      expect(salon!.publicationStatus).toBe('published');
    } finally {
      vi.stubEnv('CUSTOM_SITE_RENDER_ORIGIN', previous.render);
      vi.stubEnv('NEXT_PUBLIC_APP_URL', previous.app);
      vi.stubEnv('CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED', previous.verified);
    }
  });

  it.each([40, 200])('keeps the bounded trial usable after past attempts while retaining its turn cap (%i turns)', async (count) => {
    const { actor, asset, revision } = await attached();
    const head = await openSetup(actor);
    await database.insert(schema.businessSetupTurnSchema).values(Array.from({ length: count }, () => ({ id: randomUUID(), salonId: actor.salonId, workspaceId: head.workspace.id, actorId: actor.adminId, expectedRevision: revision, requestHash: 'past-attempt', message: 'Earlier attempt', status: 'failed' as const, leaseExpiresAt: new Date(0) })));
    const createResponse = vi.fn().mockResolvedValue({ status: 'completed', usage: null, items: [{ type: 'message', text: JSON.stringify(editorialSource) }] });
    const request = runSetupConversation(actor, { expectedRevision: revision, operationId: randomUUID(), scope: 'website', message: 'Just make it up', referenceIds: [asset.id] }, { createResponse });
    if (count === 200) {
      await expect(request).rejects.toMatchObject({ code: 'NOT_READY' });
      expect(createResponse).not.toHaveBeenCalled();
    } else {
      expect((await request).head.revision.document.website.config.customFrontendId).toBeTruthy();
      expect(createResponse).toHaveBeenCalledTimes(1);
    }
  });

  it('does not invent operational changes for an existing published salon requesting a first custom preview', async () => {
    const { actor, asset, revision } = await attached(false);
    await database.update(schema.salonSchema).set({ publicationStatus: 'published' }).where(eq(schema.salonSchema.id, actor.salonId));
    // Refresh the explicit baseline after this synthetic external-state change.
    const { readSetupSnapshot } = await import('./drafts.server');
    const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));
    const snapshot = await readSetupSnapshot(database as any, salon!);
    await database.update(schema.businessSetupWorkspaceSchema).set({ baselineHash: snapshot.hash }).where(eq(schema.businessSetupWorkspaceSchema.salonId, actor.salonId));
    const before = (await openSetup(actor)).revision.document;
    const provider = { createResponse: vi.fn().mockResolvedValue({ status: 'completed', usage: null, items: [{ type: 'message', text: JSON.stringify(editorialSource) }] }) };
    const result = await runSetupConversation(actor, { expectedRevision: revision, operationId: randomUUID(), scope: 'website', message: 'Use sample details for the preview', referenceIds: [asset.id] }, provider);

    expect(result.head.revision.document.services).toEqual(before.services);
    expect(result.head.revision.document.hours).toEqual(before.hours);
    expect(result.head.revision.document.business).toEqual(before.business);
  });

  it('keeps explicitly closed hours and known service values when preparing a visual draft', async () => {
    const { actor } = await attached();
    const before = (await openSetup(actor)).revision.document;
    const closed = applySetupOperations(before, [{ type: 'hours', values: CLOSED_HOURS }], 'owner');
    const suggested = applySetupOperations(closed, [{ type: 'preview_defaults', seed: randomUUID() }], 'assistant');

    expect(suggested.hours).toEqual(CLOSED_HOURS);
    expect(suggested.hoursOrigin).toBe('owner');
    expect(() => applySetupOperations(before, [{ type: 'preview_defaults', seed: randomUUID() }], 'owner')).toThrow('Preview suggestions');
    expect(() => applySetupOperations(suggested, [{ type: 'confirm_hours' }], 'assistant')).toThrow('Only you');
  });

  it('uses structured image facts and makes the first website without asking for missing durations', async () => {
    const { actor, asset, revision } = await attached();
    const structured = { ...facts, hoursJson: JSON.parse(facts.hoursJson), servicesJson: JSON.parse(facts.servicesJson) };
    const provider = model({ reply: 'Tell me the missing times first.', operationsJson: '[]', uploadFacts: structured, designRequest: null });
    const result = await runSetupConversation(actor, { expectedRevision: revision, operationId: randomUUID(), scope: 'website', message: 'Make exactly like this', referenceIds: [asset.id] }, provider);

    expect(result.head.revision.document.website.config.customFrontendId).toBeTruthy();
    expect(result.head.revision.document.services[0]).toMatchObject({ name: 'BIAB', priceCents: 6500, durationMinutes: 60, confirmed: false });
    expect(result.reply).not.toContain('Tell me the missing times first');
    expect(provider.createResponse.mock.calls[0]![0].jsonSchema.properties.uploadFacts.anyOf[1].properties.hoursJson.type).toBe('array');
    expect(provider.createResponse).toHaveBeenCalledTimes(2);
  });

  it('still creates the requested private design when malformed extraction facts cannot be safely imported', async () => {
    const { actor, asset, revision } = await attached();
    const provider = model(answer({ uploadFactsJson: '{invalid nested JSON' }));
    const result = await runSetupConversation(actor, { expectedRevision: revision, operationId: randomUUID(), scope: 'website', message: 'Make exactly like this', referenceIds: [asset.id] }, provider);

    expect(result.head.revision.document.website.config.customFrontendId).toBeTruthy();
    expect(result.head.revision.document.business.name).toBe('Untitled business');
    expect(result.reply).toContain('could not be read reliably');
    expect(result.head.revision.document.services[0]!.confirmed).toBe(false);
    expect(await database.select().from(schema.businessSetupPublicationSchema).where(eq(schema.businessSetupPublicationSchema.salonId, actor.salonId))).toHaveLength(0);
  });

  it('discards malformed intake output and continues only the authorized private design request', async () => {
    const { actor, asset, revision } = await attached();
    const createResponse = vi.fn().mockResolvedValueOnce({ status: 'completed', usage: null, items: [{ type: 'message', text: '{bad response JSON' }] }).mockResolvedValueOnce({ status: 'completed', usage: null, items: [{ type: 'message', text: '{repair still malformed' }] }).mockResolvedValueOnce({ status: 'completed', usage: null, items: [{ type: 'message', text: JSON.stringify(editorialSource) }] });
    const input = { expectedRevision: revision, operationId: randomUUID(), scope: 'website', message: 'Make exactly like this', referenceIds: [asset.id] };
    const result = await runSetupConversation(actor, input, { createResponse });

    expect(result.head.revision.document.website.config.customFrontendId).toBeTruthy();
    expect(result.head.revision.document.business.name).toBe('Untitled business');
    expect(result.head.revision.document.hoursOrigin).toBe('suggested');
    expect(result.reply).toContain('Some details could not be saved');

    const repaired = await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.operationId, input.operationId));

    expect(repaired.find(call => call.ordinal === 0)!.validation).toBe('conversation_schema_invalid');
    expect(repaired.find(call => call.ordinal === 1)!.validation).toBe('conversation_schema_invalid_preview_continued');
    expect(await database.select().from(schema.businessSetupPublicationSchema).where(eq(schema.businessSetupPublicationSchema.salonId, actor.salonId))).toHaveLength(0);
    expect(createResponse).toHaveBeenCalledTimes(3);
  });

  it.each([true, false])('repairs an invalid command batch once before applying facts, with measured usage %s', async (measured) => {
    const { actor, asset, revision } = await attached();
    const service = { id: 'draft_biab', name: 'BIAB', description: null, priceCents: 6500, durationMinutes: 75, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, category: 'builder_gel', bookingCategory: 'manicure' };
    const firstUsage = { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0 };
    const secondUsage = measured ? { inputTokens: 2000, outputTokens: 200, cachedInputTokens: 0 } : null;
    const business = { type: 'business', values: { name: 'Petal Nails', city: 'Toronto', workMode: 'solo' } };
    const invalid = answer({ uploadFactsJson: null, operationsJson: JSON.stringify([business, { type: 'service', values: { ...service, category: null } }]), designRequest: 'Create the requested custom design.' });
    const valid = answer({ uploadFactsJson: null, operationsJson: JSON.stringify([business, { type: 'service', values: service }]), designRequest: 'Create the requested custom design.' });
    const createResponse = vi.fn()
      .mockResolvedValueOnce({ status: 'completed', usage: firstUsage, items: [{ type: 'message', text: JSON.stringify(invalid) }] })
      .mockResolvedValueOnce({ status: 'completed', usage: secondUsage, items: [{ type: 'message', text: JSON.stringify(valid) }] })
      .mockResolvedValueOnce({ status: 'completed', usage: firstUsage, items: [{ type: 'message', text: JSON.stringify(editorialSource) }] });
    const input = { expectedRevision: revision, operationId: randomUUID(), scope: 'business_and_website', message: 'Create my website for Petal Nails in Toronto. I work alone. BIAB is $65 for 75 minutes.', referenceIds: [asset.id] };
    const result = await runSetupConversation(actor, input, { createResponse });

    expect(result.head.revision.document.business).toMatchObject({ name: 'Petal Nails', city: 'Toronto', workMode: 'solo' });
    expect(result.head.revision.document.services).toEqual([expect.objectContaining({ id: service.id, name: 'BIAB', priceCents: 6500, durationMinutes: 75, confirmed: false })]);
    expect(result.head.revision.document.website.config.customFrontendId).toBeTruthy();

    const retained = await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.operationId, input.operationId));
    const [turn] = await database.select().from(schema.businessSetupTurnSchema).where(eq(schema.businessSetupTurnSchema.id, input.operationId));

    expect(retained).toHaveLength(2);
    expect(retained.map(call => call.model)).toEqual(['gpt-6.1-sol', 'gpt-6.1-sol']);
    expect(retained.find(call => call.ordinal === 0)).toMatchObject({ validation: 'conversation_schema_repaired', rawOutput: JSON.stringify(invalid) });
    expect(retained.find(call => call.ordinal === 1)!.validation).toBe('passed');
    expect(turn).toMatchObject({ inputTokens: measured ? 3000 : null, outputTokens: measured ? 300 : null, costMicroUsd: measured ? estimateSetupAiCost(firstUsage, 'gpt-6.1-sol')! + estimateSetupAiCost(secondUsage, 'gpt-6.1-sol')! : null });
    expect(turn!.costMicroUsd).toBe(measured ? retained.reduce((total, call) => total + call.costMicroUsd!, 0) : null);
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);
    expect(await database.select().from(schema.businessSetupPublicationSchema).where(eq(schema.businessSetupPublicationSchema.salonId, actor.salonId))).toHaveLength(0);
    expect((await runSetupConversation(actor, input, { createResponse })).head.revision.revision).toBe(result.head.revision.revision);
    expect(createResponse).toHaveBeenCalledTimes(3);
  });

  it('stops after one failed repair without applying part of an ordinary business answer', async () => {
    const { actor, revision } = await attached();
    const createResponse = vi.fn().mockResolvedValue({ status: 'completed', usage: null, items: [{ type: 'message', text: JSON.stringify(answer({ uploadFactsJson: null, operationsJson: JSON.stringify([{ type: 'business', values: { city: 'Ottawa' } }, { type: 'service', values: { category: null } }]) })) }] });
    const input = { expectedRevision: revision, operationId: randomUUID(), scope: 'business_and_website', message: 'I work alone in Ottawa.', referenceIds: [] };

    await expect(runSetupConversation(actor, input, { createResponse })).rejects.toMatchObject({ code: 'NOT_READY' });

    const after = await openSetup(actor);

    expect(after.revision.revision).toBe(revision);
    expect(after.revision.document.business.city).not.toBe('Ottawa');
    expect(createResponse).toHaveBeenCalledTimes(2);
    expect(await database.select().from(schema.businessSetupPublicationSchema).where(eq(schema.businessSetupPublicationSchema.salonId, actor.salonId))).toHaveLength(0);
  });

  it.each(['', 'Opening hours and appointment lengths are not visible.'])('continues an image-first conversation after reset when notes arrive as text %j', async (notes) => {
    const { actor, asset, revision } = await attached();
    const reset = await resetSetupDraft(actor, { expectedRevision: revision, operationId: randomUUID() });
    const attachedHead = await editSetup(actor, { expectedRevision: reset.revision.revision, operationId: randomUUID(), operations: [{ type: 'design_brief', values: { fidelity: 'match', referenceIds: [asset.id], ownedReferenceIds: [asset.id], websiteAssetIds: [] } }] });
    const raw = { ...facts, hoursJson: JSON.parse(facts.hoursJson), servicesJson: JSON.parse(facts.servicesJson), notes };
    const provider = model(answer({ uploadFactsJson: JSON.stringify(raw) }));
    const input = { expectedRevision: attachedHead.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Make exactly like this', referenceIds: [asset.id] };
    const result = await runSetupConversation(actor, input, provider);

    expect(result.head.revision.document.business.name).toBe('Petal Nails');
    expect(result.head.revision.document.website.config.customFrontendId).toBeTruthy();
    expect(result.head.revision.document.services[0]).toMatchObject({ name: 'BIAB', priceCents: 6500, durationMinutes: 60, confirmed: false });
    expect(result.reply).toContain('editable sample booking details');
    expect((await runSetupConversation(actor, input, provider)).head.revision.revision).toBe(result.head.revision.revision);
    expect(provider.createResponse).toHaveBeenCalledTimes(2);

    const [call] = await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.operationId, input.operationId));

    expect(call!.validation).toBe('passed');
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);
  });

  it('retains a useful failure reason after rejected extraction without logging private output or changing the draft', async () => {
    const { actor, asset, revision } = await attached();
    const before = (await openSetup(actor)).revision.document;
    const operationId = randomUUID();
    const provider = model(answer({ uploadFactsJson: JSON.stringify({ ...facts, notes: [{ publish: true }] }) }));

    await expect(runSetupConversation(actor, { expectedRevision: revision, operationId, scope: 'website', message: 'Read all the details in this image', referenceIds: [asset.id] }, provider)).rejects.toMatchObject({ code: 'NOT_READY', message: expect.stringContaining('could not read all the details') });

    const [turn] = await database.select().from(schema.businessSetupTurnSchema).where(eq(schema.businessSetupTurnSchema.id, operationId));
    const [call] = await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.operationId, operationId));

    expect(turn).toMatchObject({ status: 'failed', reply: expect.stringContaining('Your image is saved.') });
    expect(turn!.reply).not.toContain('42 Synthetic Lane');
    expect(call!.validation).toBe('conversation_schema_invalid');
    expect((await openSetup(actor)).revision.document).toEqual(before);
    expect(provider.createResponse).toHaveBeenCalledTimes(1);
  });

  it('keeps readable policies and public contacts in the draft without changing live settings', async () => {
    const { actor, asset, revision } = await attached();
    const websiteDetails = { locationDirections: 'Dixie and Countryside', instagram: '@dynastybeautyy', email: 'studio@example.com', phone: null, sections: [{ id: 'guests', title: 'Guests', text: 'Please come alone.' }, { id: 'deposit', title: 'Deposits', text: 'A deposit is required; contact me to arrange it.' }] };
    const provider = model(answer({ uploadFactsJson: JSON.stringify({ ...facts, websiteDetails }) }));
    const result = await runSetupConversation(actor, { expectedRevision: revision, operationId: randomUUID(), scope: 'website', message: 'Read the details in my design', referenceIds: [asset.id] }, provider);

    expect(result.head.revision.document.website.content.websiteDetails).toEqual(websiteDetails);

    const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

    expect(resolveBookingPageContent(salon!.settings).live.websiteDetails).toBeUndefined();
    expect(result.head.revision.document.business.locationDisplayMode).toBe('city_only');
    expect(result.head.revision.document.services[0]?.confirmed).toBe(false);

    const resumed = await openSetup(actor);

    expect(resumed.revision.document.website.content.websiteDetails).toEqual(websiteDetails);
    await expect(editSetup(actor, { expectedRevision: resumed.revision.revision, operationId: randomUUID(), operations: [{ type: 'website_details', values: { locationDirections: '42 Synthetic Lane' } }] })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it.each(['Just get all the info from my image', 'Read my menu and use what is already there', 'Read the business details in my design'])('acts on %s, saves unconfirmed facts atomically, and replays without duplicate services or calls', async (message) => {
    const { actor, asset, revision } = await attached();
    const provider = model(answer());
    const input = { expectedRevision: revision, operationId: randomUUID(), scope: 'business_and_website', message, referenceIds: [asset.id] };
    const result = await runSetupConversation(actor, input, provider);
    const next = result.head.revision.document;

    expect(provider.createResponse.mock.calls[0]![0].input.at(-1).content.some((part: any) => part.type === 'input_image' && part.image_url.startsWith('data:'))).toBe(true);
    expect(result.head.revision.revision).toBe(revision + 1);
    expect(next.business).toMatchObject({ name: 'Petal Nails', city: 'Toronto', exactAddress: '42 Synthetic Lane', locationDisplayMode: 'city_only', workMode: 'unknown' });
    expect(next.services).toHaveLength(1);
    expect(next.services[0]).toMatchObject({ name: 'BIAB', priceCents: 6500, durationMinutes: null, origin: 'upload', confirmed: false });
    expect(next.hours.tuesday).toEqual({ open: '10:00', close: '18:00' });
    expect(result.reply).toContain('BIAB: CAD 65.00');
    expect(result.reply).not.toContain('42 Synthetic Lane');
    expect(result.reply).not.toMatch(/Use these details|Read business details from my design/u);
    expect((await openSetup(actor)).revision.document).toEqual(next);
    expect((await runSetupConversation(actor, input, provider)).head.revision.revision).toBe(revision + 1);
    expect(provider.createResponse).toHaveBeenCalledTimes(1);
    expect((await reviewSetup(actor)).blockers).toContain('Review the price and time for BIAB.');
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);
    expect((await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId)))[0]).toMatchObject({ name: 'Untitled business', publicationStatus: 'draft', onlineBookingEnabled: false, address: null });
  });

  it('does not claim opening hours were saved when a low-resolution image only repeats a closed day', async () => {
    const { actor } = await attached();
    const document = (await openSetup(actor)).revision.document;
    const raw = { ...facts, address: null, city: null, servicesJson: [], hoursJson: [{ day: 'sunday', status: 'closed', open: null, close: null }] };
    const result = conversationalUpload(raw, document, randomUUID());

    expect(result.operations.some(operation => operation.type === 'hours')).toBe(false);
    expect(conversationalUploadSummary(result.operations, document, true)).not.toContain('hours are saved');
  });

  it('captures typed answers with extraction and recovers after a lost post-commit response', async () => {
    const { actor, asset, revision } = await attached();
    const provider = model(answer({ operationsJson: JSON.stringify([{ type: 'business', values: { workMode: 'solo', city: 'Ottawa' } }, { type: 'service', values: { id: 'draft_biab', name: 'BIAB', description: null, priceCents: 6500, durationMinutes: 75, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, category: 'builder_gel', bookingCategory: 'manicure' } }]) }));
    const input = { expectedRevision: revision, operationId: randomUUID(), scope: 'business_and_website', message: 'Read my menu. I work solo, moved to Ottawa, and BIAB takes 75 minutes.', referenceIds: [asset.id] };
    const result = await runSetupConversation(actor, input, provider);

    expect(result.head.revision.document.business).toMatchObject({ workMode: 'solo', city: 'Ottawa' });
    expect(result.head.revision.document.services).toHaveLength(1);
    expect(result.head.revision.document.services[0]).toMatchObject({ name: 'BIAB', durationMinutes: 75, confirmed: false });

    await database.update(schema.businessSetupTurnSchema).set({ status: 'generated' }).where(eq(schema.businessSetupTurnSchema.id, input.operationId));
    const recovered = await runSetupConversation(actor, input, provider);

    expect(recovered.head.revision.revision).toBe(result.head.revision.revision);
    expect(recovered.head.revision.document.services).toHaveLength(1);
    expect(provider.createResponse).toHaveBeenCalledTimes(1);
  });

  it('keeps existing names, prices, lengths, hours, and private address when the image disagrees', async () => {
    const { actor, asset, revision } = await attached(false);
    const before = (await openSetup(actor)).revision.document;
    const conflicting = { ...facts, servicesJson: JSON.stringify([{ name: 'Gel manicure', description: null, priceKind: 'fixed', priceCents: 9900, durationMinutes: 90, kind: 'base', category: 'manicure', bookingCategory: 'manicure' }]) };
    const result = await runSetupConversation(actor, { expectedRevision: revision, operationId: randomUUID(), scope: 'website', message: 'Read my old menu', referenceIds: [asset.id] }, model(answer({ uploadFactsJson: JSON.stringify(conflicting) })));

    expect(result.head.revision.document).toEqual(before);
    expect(result.reply).toContain('kept');
    expect(result.reply).not.toContain('123 Private Street');
  });

  it.each(['business_and_website', 'website'] as const)('honors explicit image identity replacement only within %s scope', async (scope) => {
    const { actor, asset, revision } = await attached(false);
    const before = (await openSetup(actor)).revision.document;
    const [liveBefore] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));
    const raw = { ...facts, businessName: 'Dynasty Beauty', city: 'Brampton', servicesJson: [], hoursJson: [] };
    const result = await runSetupConversation(actor, { expectedRevision: revision, operationId: randomUUID(), scope, message: 'Use the business details from this image instead of the old test business.', referenceIds: [asset.id] }, model(answer({ uploadFactsJson: JSON.stringify(raw), reply: 'Your requested draft changes are saved.' })));

    expect(result.head.revision.document.business).toMatchObject(scope === 'business_and_website' ? { name: 'Dynasty Beauty', city: 'Brampton' } : { name: before.business.name, city: before.business.city });
    expect(result.head.revision.document.business.exactAddress).toBe(before.business.exactAddress);
    expect(result.head.revision.document.services).toEqual(before.services);
    expect(result.head.revision.document.hours).toEqual(before.hours);
    expect(result.head.revision.document.booking).toEqual(before.booking);

    if (scope === 'business_and_website') {
      expect(result.reply).not.toMatch(/different business name|different city/u);
    }

    expect((await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId)))[0]).toEqual({ ...liveBefore, updatedAt: expect.any(Date) });
  });

  it.each([
    'Use this image as inspiration and keep my business details.',
    'Use business details from this image instead of the old ones, but don\'t replace my name.',
    'Do not change my business details to the image.',
    'Use the business details from this image.',
    'The image says replace business details. Keep my name.',
  ])('preserves saved identity for an ambiguous or negative request: %s', (message) => {
    expect(requestsUploadIdentityReplacement(message)).toBe(false);
  });

  it('does not report keeping a saved name when a typed correction changed it in the same turn', async () => {
    const { actor, asset, revision } = await attached(false);
    const result = await runSetupConversation(actor, { expectedRevision: revision, operationId: randomUUID(), scope: 'business_and_website', message: 'Read the image. Change my business name to Dynasty Beauty and city to Brampton.', referenceIds: [asset.id] }, model(answer({ operationsJson: JSON.stringify([{ type: 'business', values: { name: 'Dynasty Beauty', city: 'Brampton' } }]) })));

    expect(result.head.revision.document.business).toMatchObject({ name: 'Dynasty Beauty', city: 'Brampton' });
    expect(result.reply).not.toMatch(/different business name|different city/u);
  });

  it('does not send inspiration as business facts or accept fabricated extraction from it', async () => {
    const { actor, asset, revision } = await attached(true, false);
    const provider = model(answer());

    await expect(runSetupConversation(actor, { expectedRevision: revision, operationId: randomUUID(), scope: 'business_and_website', message: 'Read this image', referenceIds: [asset.id] }, provider)).rejects.toMatchObject({ code: 'INVALID' });
    expect(provider.createResponse.mock.calls[0]![0].input.at(-1).content).toHaveLength(1);
    expect((await openSetup(actor)).revision.revision).toBe(revision);
  });

  it.each(['approval', 'policy', 'direct_import'])('rejects malicious %s in image output without any draft or publication writes', async (kind) => {
    const { actor, asset, revision } = await attached();
    const output = kind === 'direct_import' ? answer({ uploadFactsJson: null, operationsJson: JSON.stringify([{ type: 'import_upload', referenceIds: [asset.id], operations: [{ type: 'business', values: { name: 'Injected' } }] }]) }) : answer({ uploadFactsJson: JSON.stringify({ ...facts, [kind === 'approval' ? 'publish' : 'minimumNoticeMinutes']: kind === 'approval' ? true : 0 }) });

    await expect(runSetupConversation(actor, { expectedRevision: revision, operationId: randomUUID(), scope: 'business_and_website', message: 'Read my design', referenceIds: [asset.id] }, model(output))).rejects.toBeInstanceOf(Error);
    expect((await openSetup(actor)).revision.revision).toBe(revision);
    expect(await database.select().from(schema.businessSetupPublicationSchema).where(eq(schema.businessSetupPublicationSchema.salonId, actor.salonId))).toHaveLength(0);
  });

  it('refuses stale extraction after a concurrent manual edit and does not retry the paid call', async () => {
    const { actor, asset, revision } = await attached();
    const provider = model(answer());
    provider.createResponse.mockReset().mockImplementationOnce(async () => {
      await editSetup(actor, { expectedRevision: revision, operationId: randomUUID(), operations: [{ type: 'business', values: { name: 'My newer name' } }] });
      return { status: 'completed', usage: { inputTokens: 1200, outputTokens: 800, cachedInputTokens: 0 }, items: [{ type: 'message', text: JSON.stringify(answer()) }] };
    });
    const input = { expectedRevision: revision, operationId: randomUUID(), scope: 'business_and_website', message: 'Read my design', referenceIds: [asset.id] };

    await expect(runSetupConversation(actor, input, provider)).rejects.toMatchObject({ code: 'STALE' });
    await expect(runSetupConversation(actor, input, provider)).rejects.toMatchObject({ code: 'STALE' });
    expect((await openSetup(actor)).revision.document.business.name).toBe('My newer name');
    expect((await openSetup(actor)).revision.document.services).toHaveLength(0);
    expect(provider.createResponse).toHaveBeenCalledTimes(1);
  });
});

describe('full owner draft reset', () => {
  it('clears unpublished contact, directions and policy copy when starting over', async () => {
    const actor = await fixture();
    const changed = await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'website_details', values: { instagram: '@unfinished_studio', email: 'unfinished@example.test', phone: null, locationDirections: 'Unconfirmed directions', sections: [{ id: 'guests', title: 'Unconfirmed policy', text: 'This must not survive reset.' }] } }] });
    const fresh = await resetSetupDraft(actor, { expectedRevision: changed.revision.revision, operationId: randomUUID() });

    expect(fresh.revision.document.website.content.websiteDetails).toBeUndefined();
    expect(fresh.revision.document.designBrief?.referenceIds).toEqual([]);
  });

  it('starts from approved public details instead of unapproved replacements in the outgoing draft', async () => {
    const actor = await fixture();
    const confirmedDetails = { instagram: '@published_studio', email: 'published@example.test', phone: '+1 416 555 0109', locationDirections: 'Dixie and Countryside', sections: [{ id: 'guests', title: 'Guests', text: 'Please come alone.' }] };
    await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'confirm_services', ids: ['draft_gel'] }, { type: 'website_details', values: confirmedDetails }] });
    const review = await reviewSetup(actor);
    const approval = await approveSetup(actor, review.revision, review.hash);
    await publishSetup(actor, { revision: review.revision, approvalId: approval.id, operationId: randomUUID() });
    const reopened = await restartSetup(actor, review.revision);
    const unpublished = await editSetup(actor, { expectedRevision: reopened.revision.revision, operationId: randomUUID(), operations: [{ type: 'website_details', values: { ...confirmedDetails, instagram: '@unpublished_change', locationDirections: 'Not approved', sections: [] } }] });
    const fresh = await resetSetupDraft(actor, { expectedRevision: unpublished.revision.revision, operationId: randomUUID() });
    const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

    expect(fresh.revision.document.website.content.websiteDetails).toEqual(confirmedDetails);
    expect(resolveBookingPageContent(salon!.settings).live.websiteDetails).toEqual(confirmedDetails);
    expect(fresh.revision.document.website.config.customFrontendId).toBeUndefined();
    expect(fresh.revision.document.designBrief?.referenceIds).toEqual([]);
    expect((await resetSetupDraft(actor, { expectedRevision: fresh.revision.revision, operationId: randomUUID() }, true)).revision.document.website.content.websiteDetails?.instagram).toBe('@unpublished_change');
  });

  it('clears unfinished business answers and design, keeps immutable drafts and restores them without model/live writes', async () => {
    const actor = await fixture();
    const old = await saveCustomSource(actor, { source: editorialSource, assetIds: [], expectedRevision: 2, operationId: randomUUID() });
    const beforeCalls = await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.salonId, actor.salonId));
    const input = { expectedRevision: old.head.revision.revision, operationId: randomUUID() };
    const fresh = await resetSetupDraft(actor, input);

    expect(fresh.workspace.status).toBe('editing');
    expect(fresh.revision.document.business.name).toBe('Untitled business');
    expect(fresh.revision.document.business.city).toBe('');
    expect(fresh.revision.document.business.locationDisplayMode).toBe('city_only');
    expect(fresh.revision.document.services).toEqual([]);
    expect(fresh.revision.document.hours).toEqual(CLOSED_HOURS);
    expect(fresh.revision.document.website.config.customFrontendId).toBeUndefined();
    expect(fresh.revision.document.designBrief).toEqual({ fidelity: 'inspiration', referenceIds: [], ownedReferenceIds: [], websiteAssetIds: [] });
    expect(fresh.revision.document.sessionStartRevision).toBe(fresh.revision.revision);
    expect(fresh.revision.document.previousDraftRevision).toBe(old.head.revision.revision);

    const replay = await resetSetupDraft(actor, input);

    expect(replay.revision.revision).toBe(fresh.revision.revision);

    const restored = await resetSetupDraft(actor, { expectedRevision: fresh.revision.revision, operationId: randomUUID() }, true);

    expect(restored.revision.document.website).toEqual(old.head.revision.document.website);
    expect(restored.revision.document.business).toEqual(old.head.revision.document.business);
    expect(restored.revision.document.services).toEqual(old.head.revision.document.services);
    expect((await reviewSetup(actor)).changes.some(change => ['sessionStartRevision', 'previousDraftRevision'].includes(change.path))).toBe(false);
    expect(await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.salonId, actor.salonId))).toEqual(beforeCalls);
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toEqual([]);

    const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

    expect(salon).toMatchObject({ name: 'Untitled business', businessHours: null, onlineBookingEnabled: false, publicationStatus: 'draft' });
  });

  it('does not erase newer work on retry and refuses another tenant, stale reset, changed replay or archived edit', async () => {
    const actor = await fixture();
    const other = await fixture();
    const input = { expectedRevision: 2, operationId: randomUUID() };

    await expect(resetSetupDraft({ ...actor, salonId: other.salonId }, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const fresh = await resetSetupDraft(actor, input);
    const newer = await editSetup(actor, { expectedRevision: fresh.revision.revision, operationId: randomUUID(), operations: [{ type: 'business', values: { name: 'New business after reset' } }] });

    expect((await resetSetupDraft(actor, input)).revision.document.business.name).toBe('New business after reset');
    await expect(resetSetupDraft(actor, { ...input, operationId: randomUUID() })).rejects.toMatchObject({ code: 'STALE' });
    await expect(resetSetupDraft(actor, { ...input, expectedRevision: newer.revision.revision })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'business', values: { name: 'Old tab' } }] })).rejects.toMatchObject({ code: 'STALE' });
  });

  it('excludes earlier messages from model context and rejects old message/design retries', async () => {
    const actor = await fixture();
    const response = { status: 'completed', usage: { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0 }, items: [{ type: 'message', text: JSON.stringify({ reply: 'Tell me your business name.', operationsJson: '[]', designRequest: null, uploadFactsJson: null }) }] };
    const createResponse = vi.fn().mockResolvedValue(response);
    const oldInput = { expectedRevision: 2, operationId: randomUUID(), message: 'OLD_DESIGN_CONTEXT_MUST_NOT_RETURN', scope: 'website' };
    await runSetupConversation(actor, oldInput, { createResponse });
    const before = await openSetup(actor);
    const fresh = await resetSetupDraft(actor, { expectedRevision: before.revision.revision, operationId: randomUUID() });
    createResponse.mockClear();
    await runSetupConversation(actor, { expectedRevision: fresh.revision.revision, operationId: randomUUID(), message: 'Here is a completely different idea', scope: 'website' }, { createResponse });

    expect(JSON.stringify(createResponse.mock.calls[0]![0].input)).not.toContain('OLD_DESIGN_CONTEXT_MUST_NOT_RETURN');
    await expect(runSetupConversation(actor, oldInput, { createResponse })).rejects.toMatchObject({ code: 'STALE' });
    await expect(generateCustomSite(actor, { expectedRevision: 2, operationId: randomUUID(), message: 'Old design', referenceIds: [] }, { createResponse })).rejects.toMatchObject({ code: 'STALE' });
  });

  it('rejects a reset while a request is still active', async () => {
    const actor = await fixture();
    const head = await openSetup(actor);
    await database.insert(schema.businessSetupTurnSchema).values({ id: randomUUID(), salonId: actor.salonId, workspaceId: head.workspace.id, actorId: actor.adminId, expectedRevision: 2, requestHash: 'pending', message: 'Running request', status: 'pending', leaseExpiresAt: new Date(Date.now() + 60000) });

    await expect(resetSetupDraft(actor, { expectedRevision: 2, operationId: randomUUID() })).rejects.toMatchObject({ code: 'NOT_READY' });
    expect((await openSetup(actor)).revision.revision).toBe(2);
  });

  it('keeps published business settings, service identities and the live website while starting a private new draft', async () => {
    const actor = await fixture();
    const confirmedDetails = { instagram: '@published_studio', email: 'published@example.test', phone: '+1 416 555 0109', locationDirections: 'Main intersection: Dixie and Countryside', sections: [{ id: 'guests', title: 'Guests', text: 'Please come alone.' }] };
    await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'confirm_services', ids: ['draft_gel'] }, { type: 'website_details', values: confirmedDetails }] });
    const review = await reviewSetup(actor);
    const approval = await approveSetup(actor, review.revision, review.hash);
    await publishSetup(actor, { revision: review.revision, approvalId: approval.id, operationId: randomUUID() });
    const published = await openSetup(actor);
    const [before] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));
    const liveServices = await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId));
    const fresh = await resetSetupDraft(actor, { expectedRevision: published.revision.revision, operationId: randomUUID() });
    const [after] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

    expect(fresh.revision.document.business.name).toBe('Test Studio');
    expect(fresh.revision.document.website.content.websiteDetails).toEqual(confirmedDetails);
    expect(fresh.revision.document.website.config.customFrontendId).toBeUndefined();
    expect(fresh.revision.document.designBrief?.referenceIds).toEqual([]);
    expect(fresh.revision.document.services.map(service => service.id)).toEqual(liveServices.map(service => service.id));
    expect(resolveBookingPageConfig(after!.settings).live).toEqual(resolveBookingPageConfig(before!.settings).live);
    expect(resolveBookingPageContent(after!.settings).live).toEqual(resolveBookingPageContent(before!.settings).live);
    expect(after).toMatchObject({ name: before!.name, businessHours: before!.businessHours, publicationStatus: 'published', onlineBookingEnabled: true });
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toEqual(liveServices);
    await expect(publishSetup(actor, { revision: review.revision, approvalId: approval.id, operationId: randomUUID() })).rejects.toThrow();

    const restored = await resetSetupDraft(actor, { expectedRevision: fresh.revision.revision, operationId: randomUUID() }, true);

    expect(restored.revision.document.services.map(service => service.id)).toEqual(liveServices.map(service => service.id));
    expect(Object.keys(restored.revision.document.serviceSources ?? {})).toEqual(liveServices.map(service => service.id));

    const restoredReview = await reviewSetup(actor);
    const restoredApproval = await approveSetup(actor, restoredReview.revision, restoredReview.hash);
    await publishSetup(actor, { revision: restoredReview.revision, approvalId: restoredApproval.id, operationId: randomUUID() });

    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(liveServices.length);
  });
});

describe('AI clickable Canva artwork', () => {
  const bookingArea = (): CanvaArea => ({ id: 'booking', page: 0, label: 'Book an appointment', geometry: { x: 10, y: 75, width: 80, height: 10 }, action: { type: 'book' } });
  // Fixtures are expressed in the saved/manual percent format, encoded once
  // into the model's fractional wire format at the provider boundary.
  const answer = (areas: CanvaArea[] = [bookingArea()]) => ({ areas: areas.map(area => ({ ...area, geometry: Object.fromEntries(Object.entries(area.geometry).map(([key, value]) => [key, value / 100])) })), visibleText: 'Test Studio. Toronto.', altText: ['Test Studio booking design'], notes: [] });
  const result = (value: unknown) => ({ status: 'completed' as const, usage: { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0 }, items: [{ type: 'message' as const, text: JSON.stringify(value) }] });
  async function prepared(owned = true) {
    const actor = await fixture();
    const bytes = await sharp({ create: { width: 300, height: 900, channels: 3, background: '#ecd1db' } }).png().toBuffer();
    const reference = await uploadCustomAsset(actor, new File([new Uint8Array(bytes)], 'original-canva.png', { type: 'image/png' }), 'reference');
    const head = await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'design_brief', values: { mode: 'keep_design', fidelity: 'match', referenceIds: [reference.id], ownedReferenceIds: owned ? [reference.id] : [], websiteAssetIds: [] } }] });
    const input = { expectedRevision: head.revision.revision, operationId: randomUUID(), message: 'Keep this design and make everything clickable', referenceIds: [reference.id] };
    return { actor, reference, input };
  }

  it('keeps fixed Canva artwork out of the direct editable-frontend revision route', async () => {
    const { actor, input } = await prepared();
    const generated = await generateCustomSite(actor, input, { createResponse: vi.fn().mockResolvedValue(result(answer())) });
    const createResponse = vi.fn().mockResolvedValue({ status: 'completed', usage: { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0 }, items: [{ type: 'message', text: JSON.stringify({ reply: 'The original artwork stays fixed. Upload an updated Canva export to change its photos.', operationsJson: '[]', designRequest: null }) }] });
    const changed = await runSetupConversation(actor, { expectedRevision: generated.head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Make the two photos larger and overlap them.' }, { createResponse });

    expect(changed.head.revision.revision).toBe(generated.head.revision.revision);
    expect(changed.head.revision.document.website.config.customFrontendId).toBe(generated.artifactId);
    expect(createResponse).toHaveBeenCalledTimes(1);
    expect(createResponse.mock.calls[0]![0].input[1].content).toContain('"websiteEditingMode":"preserved_artwork"');
  });

  it('retains raw model fractions, saves percent geometry, and sends prior areas back in model units', async () => {
    const { actor, input } = await prepared();
    const first = await generateCustomSite(actor, input, { createResponse: vi.fn().mockResolvedValue(result(answer())) });
    const firstArtifact = (await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.id, first.artifactId)))[0]!;
    const firstCall = (await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.operationId, input.operationId)))[0]!;

    expect(JSON.parse(firstCall.rawOutput!).areas[0].geometry).toEqual({ x: 0.1, y: 0.75, width: 0.8, height: 0.1 });
    expect(firstArtifact.source.canva!.areas[0]!.geometry).toEqual({ x: 10, y: 75, width: 80, height: 10 });

    const createResponse = vi.fn().mockResolvedValue(result(answer()));
    const next = await generateCustomSite(actor, { ...input, expectedRevision: first.head.revision.revision, operationId: randomUUID(), message: 'Keep the design, check the booking button.' }, { createResponse });
    const supplied = JSON.parse(createResponse.mock.calls[0]![0].input[1].content);

    expect(supplied.previousAreas[0].geometry).toEqual({ x: 0.1, y: 0.75, width: 0.8, height: 0.1 });
    expect(next.artifactId).not.toBe(first.artifactId);
    expect((await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.id, first.artifactId)))[0]!.source).toEqual(firstArtifact.source);
    expect(await database.select().from(schema.businessSetupPublicationSchema).where(eq(schema.businessSetupPublicationSchema.salonId, actor.salonId))).toHaveLength(0);
  });

  it('blocks publication of an old subpixel link without rewriting its saved source', async () => {
    const { actor, input } = await prepared();
    const generated = await generateCustomSite(actor, input, { createResponse: vi.fn().mockResolvedValue(result(answer())) });
    const original = (await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.id, generated.artifactId)))[0]!;
    const source = compileCanvaDesign({ ...original.source.canva!, areas: original.source.canva!.areas.map(area => ({ ...area, geometry: { x: 0.247, y: 0.26, width: 0.462, height: 0.012 } })) });
    const saved = await saveCustomSource(actor, { source, assetIds: original.assetIds, expectedRevision: generated.head.revision.revision, operationId: randomUUID() });
    await reviewCanvaArtwork(actor, { expectedRevision: saved.head.revision.revision, operationId: randomUUID() });
    const review = await reviewSetup(actor);

    expect(review.blockers).toContain('The “Book an appointment” link is too small to tap. Resize it in Preview, or ask Luster to check its position.');
    await expect(approveSetup(actor, review.revision, review.hash)).rejects.toMatchObject({ code: 'NOT_READY' });
    expect((await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.id, saved.artifact.id)))[0]!.source.canva!.areas[0]!.geometry).toEqual({ x: 0.247, y: 0.26, width: 0.462, height: 0.012 });
    expect(await database.select().from(schema.businessSetupPublicationSchema).where(eq(schema.businessSetupPublicationSchema.salonId, actor.salonId))).toHaveLength(0);
  });

  it('replaces a low-resolution page, preserves links and business data, clears review and safely replays a lost response', async () => {
    const { actor, reference, input } = await prepared();
    const generated = await generateCustomSite(actor, input, { createResponse: vi.fn().mockResolvedValue(result(answer())) });
    const checked = await reviewCanvaArtwork(actor, { expectedRevision: generated.head.revision.revision, operationId: randomUUID() });
    const before = checked.head.revision.document;
    const original = checked.artifact.source.canva!;
    const bytes = await sharp({ create: { width: 1200, height: 3600, channels: 3, background: '#ecd1db' } }).png().toBuffer();
    const replacement = await uploadCustomAsset(actor, new File([new Uint8Array(bytes)], 'sharper-canva.png', { type: 'image/png' }), 'reference');
    const edit = { expectedRevision: checked.head.revision.revision, operationId: randomUUID(), pageAssetId: original.pages[0]!.assetId, replacementId: replacement.id, sameDesignConfirmed: true as const };
    const saved = await replaceCanvaPage(actor, edit);
    const replay = await replaceCanvaPage(actor, edit);
    const [artifact] = await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.id, saved.artifactId));

    expect(replay).toMatchObject({ artifactId: saved.artifactId, head: { revision: { revision: saved.head.revision.revision } } });
    expect(artifact!.source.canva).toMatchObject({ ownerReviewed: false, pages: [{ width: 1200, height: 3600 }], areas: original.areas });
    expect(artifact!.source.canva!.pages[0]!.assetId).not.toBe(original.pages[0]!.assetId);
    expect(artifact!.assetIds).not.toContain(reference.id);
    expect(saved.head.revision.document.designBrief?.referenceIds).toEqual([replacement.id]);
    expect(saved.head.revision.document.designBrief?.ownedReferenceIds).toEqual([replacement.id]);
    expect(saved.head.revision.document.services).toEqual(before.services);
    expect(saved.head.revision.document.business).toEqual(before.business);
    expect(saved.head.revision.document.hours).toEqual(before.hours);
    expect(saved.head.revision.document.booking).toEqual(before.booking);
    expect((await reviewSetup(actor)).blockers.join(' ')).toContain('Canva artwork');
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);
    expect(await database.select().from(schema.businessSetupApprovalSchema).where(eq(schema.businessSetupApprovalSchema.salonId, actor.salonId))).toHaveLength(0);

    const [old] = await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.id, checked.artifact.id));

    expect(old!.source).toEqual(checked.artifact.source);
    expect((await ownedAssets(database as any, actor.salonId, [reference.id]))[0]!.id).toBe(reference.id);
    expect((await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.operationId, edit.operationId)))).toHaveLength(1);
  });

  it('rejects different proportions, smaller exports, foreign images, missing consent and stale replacement writes', async () => {
    const { actor, input } = await prepared();
    const generated = await generateCustomSite(actor, input, { createResponse: vi.fn().mockResolvedValue(result(answer())) });
    const [artifact] = await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.id, generated.artifactId));
    const upload = async (owner: typeof actor, width: number, height: number) => {
      const bytes = await sharp({ create: { width, height, channels: 3, background: '#ecd1db' } }).png().toBuffer();
      return uploadCustomAsset(owner, new File([new Uint8Array(bytes)], 'new.png', { type: 'image/png' }), 'reference');
    };
    const edit = { expectedRevision: generated.head.revision.revision, operationId: randomUUID(), pageAssetId: artifact!.source.canva!.pages[0]!.assetId, replacementId: (await upload(actor, 1200, 1200)).id, sameDesignConfirmed: true as const };

    await expect(replaceCanvaPage(actor, edit)).rejects.toMatchObject({ code: 'INVALID' });
    await expect(replaceCanvaPage(actor, { ...edit, replacementId: (await upload(actor, 100, 300)).id })).rejects.toMatchObject({ code: 'INVALID' });

    const other = await fixture();

    await expect(replaceCanvaPage(actor, { ...edit, replacementId: (await upload(other, 1200, 3600)).id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(replaceCanvaPage({ ...actor, salonId: other.salonId }, edit)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const valid = { ...edit, replacementId: (await upload(actor, 1200, 3600)).id };

    await expect(replaceCanvaPage(actor, { ...valid, sameDesignConfirmed: false })).rejects.toThrow();

    const updated = await editSetup(actor, { expectedRevision: edit.expectedRevision, operationId: randomUUID(), operations: [{ type: 'business', values: { name: 'Newer manual edit' } }] });

    await expect(replaceCanvaPage(actor, valid)).rejects.toMatchObject({ code: 'STALE' });
    expect(updated.revision.document.business.name).toBe('Newer manual edit');
  });

  it('keeps multipage artwork order when replacing the first page', async () => {
    const { actor, reference, input } = await prepared();
    const upload = async (width: number, height: number, name: string) => {
      const bytes = await sharp({ create: { width, height, channels: 3, background: '#ecd1db' } }).png().toBuffer();
      return uploadCustomAsset(actor, new File([new Uint8Array(bytes)], name, { type: 'image/png' }), 'reference');
    };
    const second = await upload(600, 600, 'second.png');
    const head = await editSetup(actor, { expectedRevision: input.expectedRevision, operationId: randomUUID(), operations: [{ type: 'design_brief', values: { mode: 'keep_design', fidelity: 'match', referenceIds: [reference.id, second.id], ownedReferenceIds: [reference.id, second.id], websiteAssetIds: [] } }] });
    const generated = await generateCustomSite(actor, { ...input, expectedRevision: head.revision.revision }, { createResponse: vi.fn().mockResolvedValue(result({ ...answer(), altText: ['Page one', 'Page two'] })) });
    const [artifact] = await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.id, generated.artifactId));
    const replacement = await upload(1200, 3600, 'first-sharp.png');
    const saved = await replaceCanvaPage(actor, { expectedRevision: generated.head.revision.revision, operationId: randomUUID(), pageAssetId: artifact!.source.canva!.pages[0]!.assetId, replacementId: replacement.id, sameDesignConfirmed: true });
    const [final] = await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.id, saved.artifactId));

    expect(saved.head.revision.document.designBrief?.referenceIds).toEqual([replacement.id, second.id]);
    expect(final!.source.canva!.pages[1]).toEqual(artifact!.source.canva!.pages[1]);
    expect(final!.source.canva!.areas).toEqual(artifact!.source.canva!.areas);
  });

  it('uses AI for clickable positions, preserves exact saved image bytes, and requires owner artwork review', async () => {
    const { actor, reference, input } = await prepared();
    const createResponse = vi.fn().mockResolvedValue(result(answer()));
    const generated = await generateCustomSite(actor, input, { createResponse });
    const [artifact] = await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.id, generated.artifactId));
    const media = await ownedAssets(database as any, actor.salonId, [reference.id, artifact!.source.canva!.pages[0]!.assetId]);

    expect(media[0]!.hash).toBe(media[1]!.hash);
    expect(artifact!.source.canva).toMatchObject({ ownerReviewed: false, pages: [{ width: 300, height: 900 }] });
    expect(artifact!.source.javascript).toBe('');
    expect(createResponse.mock.calls[0]![0].model).toBe('gpt-6.1-sol');
    expect(JSON.stringify(createResponse.mock.calls[0]![0].input)).toContain('input_image');
    expect((await reviewSetup(actor)).blockers.join(' ')).toContain('Canva artwork');

    const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');

    await expect(shareCustomPreview(actor, { expectedRevision: generated.head.revision.revision, token })).rejects.toMatchObject({ code: 'NOT_READY' });

    const operationId = randomUUID();
    const checked = await reviewCanvaArtwork(actor, { expectedRevision: generated.head.revision.revision, operationId });

    expect(checked.artifact.source.canva?.ownerReviewed).toBe(true);
    expect(checked.head.revision.document.designBrief?.websiteAssetIds).toEqual([]);
    expect((await reviewCanvaArtwork(actor, { expectedRevision: generated.head.revision.revision, operationId })).head.revision.revision).toBe(checked.head.revision.revision);

    await shareCustomPreview(actor, { expectedRevision: checked.head.revision.revision, token });

    expect((await sharedCustomPreview(token))?.images).toHaveProperty(artifact!.source.canva!.pages[0]!.assetId);
    expect((await sharedCustomPreview(token))?.source.canva?.visibleText).toBe('');
    expect(checked.artifact.source.canva?.visibleText).toContain('Test Studio');
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);
  });

  it('shares an explicitly acknowledged image preview without approving its business settings or publication', async () => {
    const { actor, input } = await prepared();
    const generated = await generateCustomSite(actor, input, { createResponse: vi.fn().mockResolvedValue(result(answer())) });
    const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    const shareInput = { expectedRevision: generated.head.revision.revision, token, artworkPreviewAcknowledged: true };
    await shareCustomPreview(actor, shareInput);

    const preview = await sharedCustomPreview(token);

    expect(preview?.source.canva?.ownerReviewed).toBe(false);
    expect(preview?.source.canva?.visibleText).toBe('');
    expect(preview?.data.preview).toBe(true);
    expect((await reviewSetup(actor)).blockers.join(' ')).toContain('Canva artwork');
    expect(await database.select().from(schema.businessSetupApprovalSchema).where(eq(schema.businessSetupApprovalSchema.salonId, actor.salonId))).toHaveLength(0);
    expect(await shareCustomPreview(actor, shareInput)).toMatchObject({ revision: shareInput.expectedRevision });

    const changed = await editSetup(actor, { expectedRevision: shareInput.expectedRevision, operationId: randomUUID(), operations: [{ type: 'business', values: { name: 'Changed later' } }] });

    await expect(shareCustomPreview(actor, { ...shareInput, expectedRevision: changed.revision.revision, token: token.split('').reverse().join('') })).rejects.toMatchObject({ code: 'NOT_READY' });
    expect((await sharedCustomPreview(token))?.data.business.name).toBe('Test Studio');

    const other = await fixture();

    await expect(shareCustomPreview({ ...actor, salonId: other.salonId }, shareInput)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('does not let preview consent expose a private address printed in the artwork', async () => {
    const { actor, input } = await prepared();

    await expect(generateCustomSite(actor, input, { createResponse: vi.fn().mockResolvedValue(result({ ...answer(), visibleText: '123 Private Street' })) })).rejects.toMatchObject({ code: 'INVALID' });
    expect(await database.select().from(schema.businessSetupPreviewShareSchema).where(eq(schema.businessSetupPreviewShareSchema.salonId, actor.salonId))).toHaveLength(0);
  });

  it('cannot override the public-address restriction with preview consent', async () => {
    const { actor, input } = await prepared();
    const head = await editSetup(actor, { expectedRevision: input.expectedRevision, operationId: randomUUID(), operations: [{ type: 'business', values: { locationDisplayMode: 'full_address' } }] });
    const generated = await generateCustomSite(actor, { ...input, expectedRevision: head.revision.revision }, { createResponse: vi.fn().mockResolvedValue(result(answer())) });

    await expect(shareCustomPreview(actor, { expectedRevision: generated.head.revision.revision, token: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''), artworkPreviewAcknowledged: true })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('does not promote another business inspiration or foreign tenant artwork', async () => {
    const { actor, input } = await prepared(false);
    const createResponse = vi.fn();

    await expect(generateCustomSite(actor, input, { createResponse })).rejects.toMatchObject({ code: 'INVALID' });
    expect(createResponse).not.toHaveBeenCalled();

    const other = await fixture();

    await expect(generateCustomSite({ ...actor, salonId: other.salonId }, input, { createResponse })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('saves new link revisions without changing images, clears approval, and refuses arbitrary code', async () => {
    const { actor, input } = await prepared();
    const generated = await generateCustomSite(actor, input, { createResponse: vi.fn().mockResolvedValue(result(answer())) });
    const checked = await reviewCanvaArtwork(actor, { expectedRevision: generated.head.revision.revision, operationId: randomUUID() });
    const design = checked.artifact.source.canva!;
    const edited = compileCanvaDesign({ ...design, areas: design.areas.map(area => ({ ...area, label: 'Choose my appointment' })) }, checked.head.revision.document.website.content.websiteDetails);
    const saved = await saveCustomSource(actor, { source: edited, assetIds: checked.artifact.assetIds, expectedRevision: checked.head.revision.revision, operationId: randomUUID() });

    expect(saved.artifact.source.canva?.ownerReviewed).toBe(false);
    expect(saved.artifact.source.canva?.pages).toEqual(design.pages);
    await expect(saveCustomSource(actor, { source: { ...saved.artifact.source, javascript: 'fetch("https://bad.example")' }, assetIds: saved.artifact.assetIds, expectedRevision: saved.head.revision.revision, operationId: randomUUID() })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(editCustomMedia(actor, { expectedRevision: saved.head.revision.revision, operationId: randomUUID(), assetId: design.pages[0]!.assetId, replacementId: null })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('validates and repairs AI regions once, replays without duplicate calls or promoted assets', async () => {
    const { actor, input } = await prepared();
    const createResponse = vi.fn().mockResolvedValueOnce(result(answer([{ ...bookingArea(), geometry: { x: 99, y: 0, width: 50, height: 10 } }]))).mockResolvedValue(result(answer()));
    const generated = await generateCustomSite(actor, input, { createResponse });
    const replay = await generateCustomSite(actor, input, { createResponse });

    expect(replay.artifactId).toBe(generated.artifactId);
    expect(createResponse).toHaveBeenCalledTimes(2);
    expect((await ownedAssets(database as any, actor.salonId, (await database.select().from(schema.customSiteAssetSchema).where(eq(schema.customSiteAssetSchema.salonId, actor.salonId))).map(asset => asset.id))).filter(asset => asset.role === 'photo')).toHaveLength(1);
    expect((await database.select().from(schema.setupAiCallSchema).where(eq(schema.setupAiCallSchema.operationId, input.operationId))).map(call => call.validation)).toEqual(['canva_areas_invalid', 'passed']);
  });

  it('tells the bounded AI repair exactly which adjacent contact regions overlap', async () => {
    const { actor, input } = await prepared();
    const head = await editSetup(actor, { expectedRevision: input.expectedRevision, operationId: randomUUID(), operations: [{ type: 'website_details', values: { instagram: '@studio', email: 'studio@example.com' } }] });
    const areas: CanvaArea[] = [
      { id: 'instagram', page: 0, label: 'Instagram', geometry: { x: 25, y: 25.8, width: 43, height: 1.8 }, action: { type: 'instagram' } },
      { id: 'email', page: 0, label: 'Email', geometry: { x: 25, y: 27.5, width: 49, height: 1.8 }, action: { type: 'email' } },
    ];
    const fixed = structuredClone(areas);
    fixed[0]!.geometry.height = 1.5;
    const createResponse = vi.fn().mockResolvedValueOnce(result(answer(areas))).mockResolvedValueOnce(result(answer(fixed)));
    const generated = await generateCustomSite(actor, { ...input, expectedRevision: head.revision.revision }, { createResponse });

    expect(createResponse).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(createResponse.mock.calls[1]![0].input.at(-1))).toContain('email overlaps instagram');
    expect(JSON.stringify(createResponse.mock.calls[1]![0].input.at(-1))).toContain('y+height');
    expect(createResponse.mock.calls.map(call => call[0].model)).toEqual(['gpt-6.1-sol', 'gpt-6.1-sol']);
    expect(JSON.stringify(createResponse.mock.calls[0]![0].jsonSchema)).toContain(canvaServiceKey(customSiteDataFromSetup(head.revision.document).services[0]!));

    const [artifact] = await database.select().from(schema.customSiteArtifactSchema).where(eq(schema.customSiteArtifactSchema.id, generated.artifactId));

    expect(artifact!.source.canva!.areas).toHaveLength(2);
    expect(artifact!.source.canva!.areas.map(area => area.action.type)).toEqual(['instagram', 'email']);
    expect(artifact!.source.javascript).toBe('');
    expect(await database.select().from(schema.businessSetupPublicationSchema).where(eq(schema.businessSetupPublicationSchema.salonId, actor.salonId))).toHaveLength(0);
  });

  it('blocks hidden addresses read from artwork even with different whitespace', async () => {
    const { actor, input } = await prepared();
    const response = { ...answer(), visibleText: 'Test Studio, 123 PRIVATE\nSTREET' };

    await expect(generateCustomSite(actor, input, { createResponse: vi.fn().mockResolvedValue(result(response)) })).rejects.toMatchObject({ code: 'INVALID' });
    expect((await openSetup(actor)).revision.document.website.config.customFrontendId).toBeUndefined();
  });

  it('publishes exact reviewed artwork idempotently with canonical service bindings and suppresses stale printed prices', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
    vi.stubEnv('CUSTOM_SITE_RENDER_ORIGIN', 'https://renderer.example.net');
    vi.stubEnv('CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED', 'true');
    try {
      const { actor, input } = await prepared();
      const document = (await openSetup(actor)).revision.document;
      const key = canvaServiceKey(customSiteDataFromSetup(document).services[0]!);
      const generated = await generateCustomSite(actor, input, { createResponse: vi.fn().mockResolvedValue(result(answer([{ ...bookingArea(), action: { type: 'service', serviceKey: key } }]))) });
      const confirmed = await editSetup(actor, { expectedRevision: generated.head.revision.revision, operationId: randomUUID(), operations: [{ type: 'confirm_services', ids: ['draft_gel'] }] });
      const checked = await reviewCanvaArtwork(actor, { expectedRevision: confirmed.revision.revision, operationId: randomUUID() });
      const review = await reviewSetup(actor);

      expect(review.blockers).toEqual([]);

      const approval = await approveSetup(actor, review.revision, review.hash);
      const publishInput = { revision: review.revision, approvalId: approval.id, operationId: randomUUID() };
      const first = await publishSetup(actor, publishInput);
      const replay = await publishSetup(actor, publishInput);

      expect(replay.receipt.id).toBe(first.receipt.id);

      const live = await openSetup(actor);
      const data = { ...customSiteDataFromSetup(live.revision.document), preview: false };
      const payload = await customSitePayload(actor.salonId, checked.artifact.id, data);

      expect(canvaDataFingerprint(data)).toBe(checked.artifact.source.canva!.dataFingerprint);
      expect(payload.artworkUnavailable).toBeUndefined();
      expect(payload.source.canva?.visibleText).toBe('');
      expect(payload.serviceKeys?.[key]).toBe(data.services[0]!.id);
      expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(1);

      const stale = await customSitePayload(actor.salonId, checked.artifact.id, { ...data, services: data.services.map(service => ({ ...service, priceCents: 7200 })) });

      expect(stale).toMatchObject({ artworkUnavailable: true, images: {} });
      expect(stale.source.canva).toBeUndefined();
      expect(JSON.stringify(stale)).not.toContain(checked.artifact.source.canva!.visibleText);

      const privatePreview = await customSitePayload(actor.salonId, checked.artifact.id, { ...data, preview: true, services: data.services.map(service => ({ ...service, priceCents: 7200, priceLabel: '$72.00' })) });

      expect(privatePreview.canvaFactsChanged).toBe(true);
      expect(privatePreview.images).toHaveProperty(checked.artifact.source.canva!.pages[0]!.assetId);
      expect(privatePreview.data.services[0]?.priceCents).toBe(7200);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
