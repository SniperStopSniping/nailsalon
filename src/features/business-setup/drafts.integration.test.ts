import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { synchronizeBookingPageLifecycle } from '@/libs/bookingPageLifecycle';
import * as schema from '@/models/Schema';

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
const client = new PGlite();
const database = drizzle(client, { schema });

beforeAll(async () => {
  await client.waitReady;
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = database;
}, 60000);

afterAll(async () => {
  await client.close();
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
    const createResponse = vi.fn(async () => ({ status: 'completed' as const, usage: { inputTokens: 1000, cachedInputTokens: 100, outputTokens: 100 }, items: [{ type: 'message' as const, text: JSON.stringify({ reply: 'I saved your city and design direction in the draft.', operationsJson: JSON.stringify([{ type: 'business', values: { city: 'Ottawa' } }, { type: 'design', style: 'luxury', palette: 'black_champagne', layout: 'editorial' }]) }) }] }));
    const input = { expectedRevision: 2, operationId: randomUUID(), scope: 'business_and_website', message: 'I am based in Ottawa. Make it cream and black.' };
    const result = await runSetupConversation(actor, input, { createResponse });

    expect(result.head.revision.document.business.city).toBe('Ottawa');
    expect(result.head.revision.document.website.config.sitePalettePreset).toBe('black_champagne');
    expect((await runSetupConversation(actor, input, { createResponse })).head.revision.revision).toBe(3);
    expect(createResponse).toHaveBeenCalledTimes(1);

    const [turn] = await database.select().from(schema.businessSetupTurnSchema).where(eq(schema.businessSetupTurnSchema.id, input.operationId));

    expect(turn).toMatchObject({ status: 'completed', inputTokens: 1000, outputTokens: 100, costMicroUsd: 1133 });
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
