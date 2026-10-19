import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { type BookingSelectionReadContext, validatePublicBookingSelection } from '@/libs/bookingQuote';
import * as schema from '@/models/Schema';

import { type SetupAddOn, setupAddOnSchema } from './add-ons';
import { CLOSED_HOURS, setupReadiness } from './contracts';
import { runSetupConversation } from './conversation.server';
import { approveSetup, editSetup, openSetup, readSetupSnapshot, resetSetupDraft, restartSetup, reviewSetup } from './drafts.server';
import { publishSetup } from './publish.server';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
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

const art = { id: 'draft_art', name: 'Nail art', category: 'nail_art', descriptionItems: null, priceCents: 1000, priceDisplayText: 'From $10', durationMinutes: 15, pricingType: 'per_unit', unitLabel: 'nail', maxQuantity: 2, isActive: true, serviceIds: ['draft_gel'] } as const;
const values = (addOn: SetupAddOn) => setupAddOnSchema.parse(Object.fromEntries(Object.entries(addOn).filter(([key]) => !['origin', 'confirmed', 'groupId', 'advancedRules', 'priceLabelNeedsReview'].includes(key))));
async function fixture() {
  const actor = { salonId: randomUUID(), adminId: randomUUID() };
  await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
  await database.insert(schema.salonSchema).values({ id: actor.salonId, slug: actor.salonId, name: 'Untitled business', publicationStatus: 'draft', onlineBookingEnabled: false });
  await database.insert(schema.adminSalonMembershipSchema).values({ ...actor, role: 'owner' });
  await openSetup(actor);
  await editSetup(actor, { expectedRevision: 1, operationId: randomUUID(), operations: [
    { type: 'business', values: { name: 'Extras Studio', city: 'Toronto', workMode: 'solo' } },
    { type: 'hours', values: { ...CLOSED_HOURS, monday: { open: '09:00', close: '17:00' } } },
    { type: 'service', values: { id: 'draft_gel', name: 'Gel', description: null, priceCents: 6500, durationMinutes: 60, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, category: 'manicure', bookingCategory: 'manicure' } },
  ] });
  return actor;
}
async function snapshot(actor: Awaited<ReturnType<typeof fixture>>) {
  const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));
  return readSetupSnapshot(database as never, salon!);
}
async function approved(actor: Awaited<ReturnType<typeof fixture>>) {
  const review = await reviewSetup(actor);

  expect(review.blockers).toEqual([]);

  const approval = await approveSetup(actor, review.revision, review.hash, true);
  const input = { revision: review.revision, approvalId: approval.id, operationId: randomUUID() };
  return { input, result: await publishSetup(actor, input) };
}

it('captures an AI-proposed canonical extra, requires review and publishes a correctly priced original booking selection once', async () => {
  const actor = await fixture();
  const createResponse = vi.fn().mockResolvedValue({ status: 'completed', usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 100 }, items: [{ type: 'message', text: JSON.stringify({ reply: 'Nail art is proposed in your draft.', operationsJson: JSON.stringify([{ type: 'add_on', values: art }]), designRequest: null }) }] });
  const request = { expectedRevision: 2, operationId: randomUUID(), scope: 'business_and_website', message: 'Offer nail art for gel, $10 and 15 minutes per nail, up to two nails.' };
  const head = (await runSetupConversation(actor, request, { createResponse })).head;

  expect(head.revision.document.addOns).toEqual([expect.objectContaining({ ...art, confirmed: false, origin: 'assistant' })]);
  expect((await snapshot(actor)).addOns).toEqual([]);
  expect((await runSetupConversation(actor, request, { createResponse })).head.revision.revision).toBe(3);
  expect(createResponse).toHaveBeenCalledTimes(1);
  expect((await reviewSetup(actor)).blockers).toContain('Review the price and extra time for Nail art.');

  await editSetup(actor, { expectedRevision: 3, operationId: randomUUID(), operations: [{ type: 'confirm_add_ons', ids: [art.id] }] });
  const saved = await approved(actor);

  expect((await publishSetup(actor, saved.input)).receipt.id).toBe(saved.result.receipt.id);

  const live = await snapshot(actor);

  expect(live.addOns).toHaveLength(1);
  expect(live.addOnLinks).toHaveLength(1);

  const serviceId = saved.result.receipt.serviceIds.draft_gel!;
  const addOnId = saved.result.receipt.addOnIds.draft_art!;
  const context = { database: database as unknown as BookingSelectionReadContext['database'], salonId: actor.salonId, bookingConfig: live.document.booking, now: new Date() };
  const selection = { baseServiceId: serviceId, selectedAddOns: [{ addOnId, quantity: 2 }] };
  const result = await validatePublicBookingSelection({ salonId: actor.salonId, selection, readContext: context });

  expect(result.quote).toMatchObject({ subtotalCents: 8500, visibleDurationMinutes: 90 });
  await expect(validatePublicBookingSelection({ salonId: actor.salonId, selection: { ...selection, selectedAddOns: [{ addOnId, quantity: 3 }] }, readContext: context })).rejects.toMatchObject({ code: 'invalid_add_on' });
});

it('rejects foreign identities and cross-salon service choices before any live changes', async () => {
  const actor = await fixture();
  const other = await fixture();
  await editSetup(other, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'add_on', values: art }] });
  const saved = await approved(other);

  await expect(editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'add_on', values: { ...art, id: saved.result.receipt.addOnIds.draft_art } }] })).rejects.toMatchObject({ code: 'INVALID' });
  await expect(editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'add_on', values: { ...art, serviceIds: [saved.result.receipt.serviceIds.draft_gel] } }] })).rejects.toMatchObject({ code: 'INVALID' });
  await expect(openSetup({ ...actor, salonId: other.salonId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await snapshot(actor)).addOns).toEqual([]);
});

it('keeps complex links and group membership through a draft price edit and detects external catalogue changes', async () => {
  const actor = await fixture();
  await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'add_on', values: art }] });
  const first = await approved(actor);
  const addOnId = first.result.receipt.addOnIds.draft_art!;
  const groupId = randomUUID();
  await database.insert(schema.addOnGroupSchema).values({ id: groupId, salonId: actor.salonId, name: 'Art choices', slug: groupId, minSelections: 1, maxSelections: 2 });
  await database.update(schema.addOnSchema).set({ groupId }).where(eq(schema.addOnSchema.id, addOnId));
  await database.update(schema.serviceAddOnSchema).set({ selectionMode: 'required', priceMode: 'manual_confirmation', defaultQuantity: 1, maxQuantityOverride: 2, displayOrder: 7 }).where(eq(schema.serviceAddOnSchema.addOnId, addOnId));
  const before = await snapshot(actor);
  let head = await restartSetup(actor, first.input.revision);
  const addOn = head.revision.document.addOns![0]!;

  expect(addOn).toMatchObject({ groupId, advancedRules: true });
  await expect(editSetup(actor, { expectedRevision: head.revision.revision, operationId: randomUUID(), operations: [{ type: 'add_on', values: { ...values(addOn), serviceIds: [] } }] })).rejects.toMatchObject({ code: 'INVALID' });

  head = await editSetup(actor, { expectedRevision: head.revision.revision, operationId: randomUUID(), operations: [{ type: 'add_on', values: { ...values(addOn), priceCents: 1500, durationMinutes: 20 } }] });

  expect(head.revision.document.addOns![0]).toMatchObject({ priceDisplayText: 'From $15.00' });
  expect((await snapshot(actor)).addOns[0]!.priceCents).toBe(1000);

  await approved(actor);
  const after = await snapshot(actor);

  expect(after.addOns[0]).toMatchObject({ priceCents: 1500, durationMinutes: 20, groupId });
  expect(after.addOnLinks).toEqual(before.addOnLinks);

  head = await restartSetup(actor, head.revision.revision);
  await database.update(schema.addOnSchema).set({ priceCents: 1800 }).where(eq(schema.addOnSchema.id, addOnId));

  await expect(editSetup(actor, { expectedRevision: head.revision.revision, operationId: randomUUID(), operations: [{ type: 'copy', bio: 'A lovely studio', specialtyLine: '' }] })).rejects.toMatchObject({ code: 'STALE' });
});

it('restores an archived published extra without duplication and blocks a stale restoration', async () => {
  const actor = await fixture();
  await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'add_on', values: art }] });
  const first = await approved(actor);
  const reset = await resetSetupDraft(actor, { expectedRevision: first.input.revision, operationId: randomUUID() });
  await database.insert(schema.addOnSchema).values({ id: randomUUID(), salonId: actor.salonId, slug: randomUUID(), name: 'Later extra', category: 'repair', priceCents: 500, durationMinutes: 5 });

  // A manual change after reset must be reconciled before any restoration.
  await expect(resetSetupDraft(actor, { expectedRevision: reset.revision.revision, operationId: randomUUID() }, true)).rejects.toMatchObject({ code: 'STALE' });

  // A fresh fixture exercises exact mapped restoration without an unrelated conflict.
  const fresh = await fixture();
  await editSetup(fresh, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'add_on', values: art }] });
  const published = await approved(fresh);
  const laterId = randomUUID();
  await database.insert(schema.addOnSchema).values({ id: laterId, salonId: fresh.salonId, slug: laterId, name: 'Later extra', category: 'repair', priceCents: 500, durationMinutes: 5 });
  const empty = await resetSetupDraft(fresh, { expectedRevision: published.input.revision, operationId: randomUUID() });
  const restored = await resetSetupDraft(fresh, { expectedRevision: empty.revision.revision, operationId: randomUUID() }, true);

  expect(restored.revision.document.addOns!.map(addOn => addOn.id)).toEqual(expect.arrayContaining([published.result.receipt.addOnIds.draft_art, laterId]));

  await approved(fresh);

  expect((await snapshot(fresh)).addOns).toHaveLength(2);
  expect((await snapshot(fresh)).addOnLinks).toHaveLength(1);
});

it('requires complete per-unit proposals and cannot accept suggestions on behalf of the owner', async () => {
  const actor = await fixture();
  const head = await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'add_on', values: { ...art, unitLabel: null, maxQuantity: null } }] }, 'assistant');

  expect(setupReadiness(head.revision.document)).toContain('Add a unit name and maximum quantity for Nail art.');
  await expect(editSetup(actor, { expectedRevision: 3, operationId: randomUUID(), operations: [{ type: 'confirm_add_ons', ids: [art.id] }] }, 'assistant')).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('keeps historical appointment prices and add-on snapshots through a later approved price change', async () => {
  const actor = await fixture();
  await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'add_on', values: art }] });
  const first = await approved(actor);
  const live = await snapshot(actor);
  const addOnId = first.result.receipt.addOnIds.draft_art!;
  const appointmentId = randomUUID();
  const serviceId = first.result.receipt.serviceIds.draft_gel!;
  const [appointment] = await database.insert(schema.appointmentSchema).values({ id: appointmentId, salonId: actor.salonId, technicianId: live.staff[0]!.id, clientPhone: '4165550198', startTime: new Date('2026-10-19T13:00:00Z'), endTime: new Date('2026-10-19T14:15:00Z'), totalPrice: 7500, totalDurationMinutes: 75 }).returning();
  const [bookedService] = await database.insert(schema.appointmentServicesSchema).values({ id: randomUUID(), appointmentId, serviceId, priceAtBooking: 6500, durationAtBooking: 60, nameSnapshot: 'Gel' }).returning();
  const [bookedExtra] = await database.insert(schema.appointmentAddOnSchema).values({ id: randomUUID(), appointmentId, appointmentServiceId: bookedService!.id, addOnId, nameSnapshot: 'Nail art', categorySnapshot: 'nail_art', pricingTypeSnapshot: 'per_unit', unitPriceCentsSnapshot: 1000, durationMinutesSnapshot: 15, lineTotalCentsSnapshot: 1000, lineDurationMinutesSnapshot: 15, priceDisplayTextSnapshot: 'From $10' }).returning();
  const head = await restartSetup(actor, first.input.revision);
  await editSetup(actor, { expectedRevision: head.revision.revision, operationId: randomUUID(), operations: [{ type: 'add_on', values: { ...values(head.revision.document.addOns![0]!), priceCents: 1500, durationMinutes: 20 } }] });
  await approved(actor);

  expect((await snapshot(actor)).addOns[0]).toMatchObject({ id: addOnId, priceCents: 1500, durationMinutes: 20 });
  expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, appointmentId))).toEqual([appointment]);
  expect(await database.select().from(schema.appointmentServicesSchema).where(eq(schema.appointmentServicesSchema.id, bookedService!.id))).toEqual([bookedService]);
  expect(await database.select().from(schema.appointmentAddOnSchema).where(eq(schema.appointmentAddOnSchema.id, bookedExtra!.id))).toEqual([bookedExtra]);
});

it('routes an explicit add-on price edit from the website composer while rejecting extra settings changes', async () => {
  const actor = await fixture();
  let head = await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'add_on', values: art }] });
  const reply = (proposed: unknown) => ({ createResponse: vi.fn().mockResolvedValue({ status: 'completed', usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 100 }, items: [{ type: 'message', text: JSON.stringify({ reply: 'The proposed extra price is saved.', operationsJson: JSON.stringify([{ type: 'add_on', values: proposed }]), designRequest: null }) }] }) });
  const before = head.revision.document;
  head = (await runSetupConversation(actor, { expectedRevision: 3, operationId: randomUUID(), scope: 'website', message: 'Change nail art to $15.' }, reply({ ...values(before.addOns![0]!), priceCents: 1500 }))).head;

  expect(head.revision.document.addOns![0]).toMatchObject({ priceCents: 1500, durationMinutes: 15, confirmed: false, serviceIds: ['draft_gel'], maxQuantity: 2 });
  expect(head.revision.document.website).toEqual(before.website);
  expect(head.revision.document.services).toEqual(before.services);
  await expect(runSetupConversation(actor, { expectedRevision: head.revision.revision, operationId: randomUUID(), scope: 'website', message: 'Change nail art to $20.' }, reply({ ...values(head.revision.document.addOns![0]!), priceCents: 2000, durationMinutes: 45 }))).rejects.toMatchObject({ code: 'INVALID' });
  expect((await openSetup(actor)).revision.revision).toBe(head.revision.revision);
  expect((await snapshot(actor)).addOns).toEqual([]);
});
