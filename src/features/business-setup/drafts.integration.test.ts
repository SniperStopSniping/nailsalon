import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { saveCustomSource } from '@/features/custom-sites/artifacts.server';
import * as customArtifacts from '@/features/custom-sites/artifacts.server';
import { ownedAssets, uploadCustomAsset } from '@/features/custom-sites/assets.server';
import { generateCustomSite, resumeCustomSite } from '@/features/custom-sites/generate.server';
import { editCustomMedia } from '@/features/custom-sites/media-edit.server';
import { customSitePayload } from '@/features/custom-sites/payload.server';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { synchronizeBookingPageLifecycle } from '@/libs/bookingPageLifecycle';
import sharp from '@/libs/safeSharp.server';
import * as schema from '@/models/Schema';

import { darkSource, editorialSource } from '../../../tests/browser/businessSetup/custom-design-fixtures';
import { CLOSED_HOURS } from './contracts';
import { runSetupConversation } from './conversation.server';
import { approveSetup, editSetup, openSetup, restartSetup, reviewSetup } from './drafts.server';
import { editSharedSetupWebsite } from './manual-website.server';
import { setupPreviewBooking } from './preview-data.server';
import { publishSetup } from './publish.server';
import { applyOwnUpload, dismissOwnUpload, readOwnUpload, uploadFactsToOperations } from './read-upload.server';

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

    expect(turn).toMatchObject({ status: 'completed', inputTokens: 1000, outputTokens: 100, costMicroUsd: 14100 });
  });

  it.each([
    [{ type: 'confirm_services', ids: ['draft_gel'] }],
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

    expect(usage?.costMicroUsd).toBe(130000);
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

    expect(request.model).toBe('gpt-6-astra');
    expect(countInputTokens).toHaveBeenCalledWith(request);

    const parts = request.input.at(-1).content;

    expect(parts.some((part: any) => part.type === 'input_image' && part.image_url.startsWith('data:image/webp;base64,'))).toBe(true);
    expect(parts.some((part: any) => part.type === 'input_file' && part.file_data.startsWith('data:application/pdf;base64,'))).toBe(true);

    const [job] = await database.select().from(schema.customSiteGenerationSchema).where(eq(schema.customSiteGenerationSchema.salonId, actor.salonId));

    expect(job?.costMicroUsd).toBeNull();
    expect(job!.reservedMicroUsd).toBeGreaterThan(0);
  });

  it('rejects invalid files and oversized token inputs before paid generation', async () => {
    const actor = await fixture();

    await expect(uploadCustomAsset(actor, new File(['<svg onload="bad()"/>'], 'bad.png', { type: 'image/png' }), 'photo')).rejects.toThrow();
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

describe('metered owner generation and automatic repair', () => {
  const response = (source: unknown, usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number } | null = { inputTokens: 2000, outputTokens: 1000, cachedInputTokens: 0 }) => ({ status: 'completed' as const, usage, items: [{ type: 'message' as const, text: JSON.stringify(source) }] });

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
    expect(rows.every(row => row.provider === 'test-double' && row.model === 'gpt-6-astra' && row.elapsedMs !== null)).toBe(true);
    expect(rows.reduce((sum, row) => sum + row.chargedMicroCad, 0)).toBe(280000);
    expect((await resumeCustomSite(actor, input.operationId)).artifactId).toBe(generated.artifactId);
    expect(createResponse).toHaveBeenCalledTimes(2);
    expect((await openSetup(actor)).revision.revision).toBe(3);
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
    expect(applied.revision.document.services[1]).toMatchObject({ name: 'BIAB', priceCents: null, durationMinutes: null, confirmed: false });
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
  async function photo(actor: { salonId: string; adminId: string }, role: 'photo' | 'reference' | 'logo' = 'photo') {
    const bytes = await sharp({ create: { width: 40, height: 60, channels: 3, background: '#eecbdb' } }).png().toBuffer();
    return uploadCustomAsset(actor, new File([new Uint8Array(bytes)], `${role}.png`, { type: 'image/png' }), role);
  }

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
  const model = (value: unknown) => ({ createResponse: vi.fn().mockResolvedValue({ status: 'completed', usage: { inputTokens: 1200, outputTokens: 800, cachedInputTokens: 0 }, items: [{ type: 'message', text: JSON.stringify(value) }] }) });
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

  it.each(['Just get all the info from my image', 'Read my menu and use what is already there', 'Make my website using the details in my design'])('acts on %s, saves unconfirmed facts atomically, and replays without duplicate services or calls', async (message) => {
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
    provider.createResponse.mockImplementationOnce(async () => {
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
