import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type BookingSelectionReadContext, validatePublicBookingSelection } from '@/libs/bookingQuote';
import * as schema from '@/models/Schema';

import { applySetupOperations, CLOSED_HOURS, setupReadiness, type SetupStaff } from './contracts';
import { runSetupConversation } from './conversation.server';
import { approveSetup, editSetup, openSetup, readSetupSnapshot, resetSetupDraft, restartSetup, reviewSetup } from './drafts.server';
import { setupPreviewBooking } from './preview-data.server';
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

const hours = { ...CLOSED_HOURS, monday: { open: '09:00', close: '17:00' }, tuesday: { open: '09:00', close: '17:00' } };
const gel = { id: 'draft_gel', name: 'Gel manicure', description: null, priceCents: 6500, durationMinutes: 60, preparationBufferMinutes: 0, cleanupBufferMinutes: 10, category: 'manicure', bookingCategory: 'manicure' } as const;
const biab = { ...gel, id: 'draft_biab', name: 'BIAB', category: 'builder_gel' } as const;
const alex: SetupStaff = { id: 'draft_alex', name: 'Alex', isActive: true, hours: { ...CLOSED_HOURS, monday: { open: '09:00', close: '12:00' } }, serviceIds: [gel.id], assignmentMode: 'explicit' };
const sam: SetupStaff = { id: 'draft_sam', name: 'Sam', isActive: true, hours: { ...CLOSED_HOURS, tuesday: { open: '13:00', close: '17:00' } }, serviceIds: [biab.id], assignmentMode: 'explicit' };

async function fixture() {
  const actor = { salonId: randomUUID(), adminId: randomUUID() };
  await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
  await database.insert(schema.salonSchema).values({ id: actor.salonId, name: 'Untitled business', slug: actor.salonId, publicationStatus: 'draft', onlineBookingEnabled: false });
  await database.insert(schema.adminSalonMembershipSchema).values({ ...actor, role: 'owner' });
  await openSetup(actor);
  await editSetup(actor, { expectedRevision: 1, operationId: randomUUID(), operations: [
    { type: 'business', values: { name: 'Team Studio', city: 'Toronto', workMode: 'team' } },
    { type: 'hours', values: hours },
    { type: 'service', values: gel },
    { type: 'service', values: biab },
  ] });
  return actor;
}
async function team(actor: Awaited<ReturnType<typeof fixture>>) {
  return editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'staff', values: alex }, { type: 'staff', values: sam }] });
}
async function publish(actor: Awaited<ReturnType<typeof fixture>>) {
  const review = await reviewSetup(actor);

  expect(review.blockers).toEqual([]);

  const approval = await approveSetup(actor, review.revision, review.hash);
  const input = { revision: review.revision, approvalId: approval.id, operationId: randomUUID() };
  return { input, result: await publishSetup(actor, input) };
}
async function snapshot(actor: Awaited<ReturnType<typeof fixture>>) {
  const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));
  return readSetupSnapshot(database as never, salon!);
}

describe('owner-reviewed team setup and original booking contracts', () => {
  it('captures team changes through the conversation, previews proposed schedules and publishes real identities once', async () => {
    const actor = await fixture();
    const createResponse = vi.fn().mockResolvedValue({ status: 'completed', usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 100 }, items: [{ type: 'message', text: JSON.stringify({ reply: 'Your team is in the draft.', operationsJson: JSON.stringify([{ type: 'staff', values: alex }, { type: 'staff', values: sam }]), designRequest: null }) }] });
    const request = { expectedRevision: 2, operationId: randomUUID(), scope: 'business_and_website', message: 'Alex does gel on Monday mornings. Sam does BIAB on Tuesday afternoons.' };
    const head = (await runSetupConversation(actor, request, { createResponse })).head;

    expect(head.revision.document.staff).toEqual([alex, sam]);
    expect((await runSetupConversation(actor, request, { createResponse })).head.revision.revision).toBe(3);
    expect(createResponse).toHaveBeenCalledTimes(1);
    expect((await snapshot(actor)).staff).toEqual([]);

    const preview = setupPreviewBooking(head.revision.document, { staff: [], assignments: [] }, new Date('2026-10-18T12:00:00Z'));

    expect(preview.technicians.map(person => person.enabledServiceIds)).toEqual([[gel.id], [biab.id]]);
    expect(preview.examples[0]).toMatchObject({ date: '2026-10-19' });
    expect(preview.examples[0]!.times).not.toContain('13:00');

    const saved = await publish(actor);
    const receipt = saved.result.receipt;

    expect((await publishSetup(actor, saved.input)).receipt.id).toBe(receipt.id);

    const live = await snapshot(actor);

    expect(live.staff).toHaveLength(2);
    expect(live.services).toHaveLength(2);
    expect(live.document.staff).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: receipt.staffIds[alex.id], name: 'Alex', hours: alex.hours, serviceIds: [receipt.serviceIds[gel.id]] }),
      expect.objectContaining({ id: receipt.staffIds[sam.id], name: 'Sam', hours: sam.hours, serviceIds: [receipt.serviceIds[biab.id]] }),
    ]));

    const context = { database: database as unknown as BookingSelectionReadContext['database'], salonId: actor.salonId, bookingConfig: live.document.booking, now: new Date() };
    const selection = { baseServiceId: receipt.serviceIds[gel.id]!, selectedAddOns: [] };

    expect((await validatePublicBookingSelection({ salonId: actor.salonId, selection, technicianId: receipt.staffIds[alex.id], readContext: context })).baseServiceRecord).toMatchObject({ price: 6500, durationMinutes: 60 });
    await expect(validatePublicBookingSelection({ salonId: actor.salonId, selection, technicianId: receipt.staffIds[sam.id], readContext: context })).rejects.toMatchObject({ code: 'unsupported_technician' });
  });

  it('preserves appointments, private staff fields and assignment priorities through schedule and price edits', async () => {
    const actor = await fixture();
    await team(actor);
    const first = await publish(actor);
    const technicianId = first.result.receipt.staffIds[alex.id]!;
    const serviceId = first.result.receipt.serviceIds[gel.id]!;
    await database.update(schema.technicianSchema).set({ email: 'private@example.invalid', phone: '4165550198', commissionRate: '0.35', workDays: [1], startTime: '09:00', endTime: '17:00' }).where(eq(schema.technicianSchema.id, technicianId));
    await database.update(schema.technicianServicesSchema).set({ priority: 7 }).where(and(eq(schema.technicianServicesSchema.technicianId, technicianId), eq(schema.technicianServicesSchema.serviceId, serviceId)));
    const customerId = randomUUID();
    await database.insert(schema.salonClientSchema).values({ id: customerId, salonId: actor.salonId, phone: '4165550198', fullName: 'Synthetic customer' });
    const [appointment] = await database.insert(schema.appointmentSchema).values({ id: randomUUID(), salonId: actor.salonId, technicianId, salonClientId: customerId, clientPhone: '4165550198', startTime: new Date('2026-10-19T13:00:00Z'), endTime: new Date('2026-10-19T14:10:00Z'), totalPrice: 6500, totalDurationMinutes: 60 }).returning();
    const [bookedService] = await database.insert(schema.appointmentServicesSchema).values({ id: randomUUID(), appointmentId: appointment!.id, serviceId, priceAtBooking: 6500, durationAtBooking: 60, nameSnapshot: 'Gel manicure' }).returning();
    const head = await restartSetup(actor, first.input.revision);
    const person = head.revision.document.staff!.find(person => person.id === technicianId)!;
    const service = head.revision.document.services.find(service => service.id === serviceId)!;
    await editSetup(actor, { expectedRevision: head.revision.revision, operationId: randomUUID(), operations: [
      { type: 'staff', values: { ...person, hours: { ...CLOSED_HOURS, monday: { open: '13:00', close: '16:00' } } } },
      { type: 'service', values: { ...gel, id: service.id, priceCents: 7200 } },
    ] });

    expect((await snapshot(actor)).document.services.find(service => service.id === serviceId)?.priceCents).toBe(6500);

    await publish(actor);

    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, appointment!.id))).toEqual([appointment]);
    expect(await database.select().from(schema.appointmentServicesSchema).where(eq(schema.appointmentServicesSchema.id, bookedService!.id))).toEqual([bookedService]);

    const live = await snapshot(actor);

    expect(live.staff.find(person => person.id === technicianId)).toMatchObject({ email: 'private@example.invalid', phone: '4165550198', commissionRate: '0.35', workDays: null, startTime: null, endTime: null, weeklySchedule: { monday: { start: '13:00', end: '16:00' } } });
    expect(live.assignments.find(assignment => assignment.technicianId === technicianId && assignment.serviceId === serviceId)?.priority).toBe(7);
    expect(live.document.services.find(service => service.id === serviceId)?.priceCents).toBe(7200);
  });

  it('restores published draft team and service identities without duplicates', async () => {
    const actor = await fixture();
    await team(actor);
    const first = await publish(actor);
    const reset = await resetSetupDraft(actor, { expectedRevision: first.input.revision, operationId: randomUUID() });
    const restored = await resetSetupDraft(actor, { expectedRevision: reset.revision.revision, operationId: randomUUID() }, true);

    expect(restored.revision.document.staff?.map(person => person.id)).toEqual([first.result.receipt.staffIds[alex.id], first.result.receipt.staffIds[sam.id]]);
    expect(restored.revision.document.staff?.flatMap(person => person.serviceIds).sort()).toEqual(Object.values(first.result.receipt.serviceIds).sort());

    await publish(actor);
    const live = await snapshot(actor);

    expect(live.staff).toHaveLength(2);
    expect(live.services).toHaveLength(2);
  });

  it('treats short draft IDs reused in a later setup as new people and services', async () => {
    const actor = await fixture();
    await team(actor);
    const first = await publish(actor);
    const reopened = await restartSetup(actor, first.input.revision);
    const next = await editSetup(actor, { expectedRevision: reopened.revision.revision, operationId: randomUUID(), operations: [
      { type: 'service', values: { ...gel, name: 'Nail art appointment', priceCents: 8500 } },
      { type: 'staff', values: { ...alex, name: 'Alexa', serviceIds: [gel.id] } },
    ] });

    expect(next.revision.document.identityNamespace).not.toBe((await database.select().from(schema.businessSetupRevisionSchema).where(and(eq(schema.businessSetupRevisionSchema.salonId, actor.salonId), eq(schema.businessSetupRevisionSchema.revision, first.input.revision))))[0]?.document.identityNamespace);

    const second = await publish(actor);

    expect(second.result.receipt.serviceIds[gel.id]).not.toBe(first.result.receipt.serviceIds[gel.id]);
    expect(second.result.receipt.staffIds[alex.id]).not.toBe(first.result.receipt.staffIds[alex.id]);

    const live = await snapshot(actor);

    expect(live.services).toHaveLength(3);
    expect(live.staff).toHaveLength(3);
    expect(live.staff.find(person => person.id === first.result.receipt.staffIds[alex.id])?.name).toBe('Alex');
    expect(live.services.find(service => service.id === first.result.receipt.serviceIds[gel.id])?.price).toBe(6500);
  });

  it('rejects unknown tenant identities, foreign services and stale team edits without live writes', async () => {
    const actor = await fixture();
    const other = await fixture();

    await expect(editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'staff', values: { ...alex, id: other.salonId } }] })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'staff', values: { ...alex, serviceIds: [other.salonId] } }] })).rejects.toMatchObject({ code: 'INVALID' });

    await team(actor);

    await expect(editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'staff', values: alex }] })).rejects.toMatchObject({ code: 'STALE' });
    await expect(openSetup({ ...other, salonId: actor.salonId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await snapshot(actor)).staff).toEqual([]);
  });

  it('keeps website-only requests from changing staff or their schedules', async () => {
    const actor = await fixture();
    const createResponse = vi.fn().mockResolvedValue({ status: 'completed', usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 100 }, items: [{ type: 'message', text: JSON.stringify({ reply: 'Changed the team.', operationsJson: JSON.stringify([{ type: 'staff', values: alex }]), designRequest: null }) }] });

    await expect(runSetupConversation(actor, { expectedRevision: 2, operationId: randomUUID(), scope: 'website', message: 'Make the background beige' }, { createResponse })).rejects.toMatchObject({ code: 'INVALID' });
    expect((await openSetup(actor)).revision.document.staff).toEqual([]);
  });

  it('adapts older saved JSON without rewriting immutable revisions and detects later manual staff changes', async () => {
    const actor = await fixture();
    const legacy = structuredClone((await openSetup(actor)).revision.document);
    delete legacy.staff;
    delete legacy.staffUsesExplicitAssignments;
    delete legacy.identityNamespace;
    const [workspace] = await database.select().from(schema.businessSetupWorkspaceSchema).where(eq(schema.businessSetupWorkspaceSchema.salonId, actor.salonId));
    const legacyBaseline = structuredClone(workspace!.baseline);
    delete legacyBaseline.staff;
    delete legacyBaseline.staffUsesExplicitAssignments;
    await database.update(schema.businessSetupRevisionSchema).set({ document: legacy }).where(and(eq(schema.businessSetupRevisionSchema.salonId, actor.salonId), eq(schema.businessSetupRevisionSchema.revision, 2)));
    await database.update(schema.businessSetupWorkspaceSchema).set({ baseline: legacyBaseline }).where(eq(schema.businessSetupWorkspaceSchema.salonId, actor.salonId));

    expect((await openSetup(actor)).revision.document.staff).toEqual([]);

    const [stored] = await database.select().from(schema.businessSetupRevisionSchema).where(and(eq(schema.businessSetupRevisionSchema.salonId, actor.salonId), eq(schema.businessSetupRevisionSchema.revision, 2)));

    expect(stored?.document.staff).toBeUndefined();

    await database.insert(schema.technicianSchema).values({ id: randomUUID(), salonId: actor.salonId, name: 'Manually added' });

    await expect(team(actor)).rejects.toMatchObject({ code: 'STALE' });
  });

  it('requires review of legacy team eligibility and retains a solo owner’s old services when adding a new one', async () => {
    const actor = await fixture();
    const head = (await team(actor)).revision.document;
    const legacy = { ...head, staffUsesExplicitAssignments: false, staff: [{ ...alex, id: randomUUID(), assignmentMode: 'preserve' as const, serviceIds: [] }, sam] };

    expect(setupReadiness(legacy)).toContain('Review Alex’s service assignments before changing the team’s booking eligibility.');

    const solo = { ...head, business: { ...head.business, workMode: 'solo' as const }, services: [head.services[0]!], staff: [legacy.staff[0]!], staffEdited: false };
    const next = applySetupOperations(solo, [{ type: 'service', values: biab }], 'owner');

    expect(next.staff?.[0]?.serviceIds).toEqual([gel.id, biab.id]);
    expect(setupReadiness(next)).toEqual([]);
  });

  it('does not erase a previously proposed schedule when a later team edit leaves hours unchanged', async () => {
    const actor = await fixture();
    await team(actor);
    const first = await publish(actor);
    const reopened = await restartSetup(actor, first.input.revision);
    const person = reopened.revision.document.staff![0]!;
    const proposedHours = { ...CLOSED_HOURS, monday: { open: '14:00', close: '17:00' } };
    const saved = await editSetup(actor, { expectedRevision: reopened.revision.revision, operationId: randomUUID(), operations: [{ type: 'staff', values: { ...person, hours: proposedHours } }] });
    const renamed = await editSetup(actor, { expectedRevision: saved.revision.revision, operationId: randomUUID(), operations: [{ type: 'staff', values: { ...person, name: 'Alex Smith', hours: null } }] });

    expect(renamed.revision.document.staff?.find(item => item.id === person.id)).toMatchObject({ name: 'Alex Smith', hours: proposedHours });
  });
});
