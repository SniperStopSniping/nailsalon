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
