import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { resolveCommunicationSettingsFromSettings } from '@/libs/communicationSettings';
import { resolveDepositPolicy } from '@/libs/depositPolicy';
import * as schema from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

import { applySetupOperations, CLOSED_HOURS } from './contracts';
import { runSetupConversation } from './conversation.server';
import { approveSetup, editSetup, openSetup, reviewSetup } from './drafts.server';
import { publishSetup } from './publish.server';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown, readiness: vi.fn() }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/stripeConnect/readiness', () => ({ refreshAccountReadiness: holder.readiness }));
vi.mock('@/libs/depositPolicy.server', () => ({ EXPECTED_LIVEMODE: false }));
vi.mock('@/libs/integrationHealth', () => ({ getSalonSmsReadiness: async () => ({ automaticEnabled: false, detail: 'Text messages are turned off.' }) }));
const client = new PGlite();
const database = drizzle(client, { schema });

beforeAll(async () => {
  await client.waitReady;
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = database;
}, 60000);

beforeEach(() => holder.readiness.mockReset());

afterAll(async () => {
  await client.close();
});

const rules = [{ id: 'crule_default_24h', offsetMinutes: 2880, channels: 'both', enabled: true }] as const;
async function fixture(settings: SalonSettings = {}) {
  const actor = { salonId: randomUUID(), adminId: randomUUID() };
  await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
  await database.insert(schema.salonSchema).values({ id: actor.salonId, slug: actor.salonId, name: 'Untitled business', publicationStatus: 'draft', onlineBookingEnabled: false, smsRemindersEnabled: false, settings });
  await database.insert(schema.adminSalonMembershipSchema).values({ ...actor, role: 'owner' });
  await openSetup(actor);
  await editSetup(actor, { expectedRevision: 1, operationId: randomUUID(), operations: [
    { type: 'business', values: { name: 'Ready Studio', city: 'Toronto', workMode: 'solo' } },
    { type: 'hours', values: { ...CLOSED_HOURS, monday: { open: '09:00', close: '17:00' } } },
    { type: 'service', values: { id: 'draft_gel', name: 'Gel', description: null, priceCents: 6500, durationMinutes: 60, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, category: 'manicure', bookingCategory: 'manicure' } },
  ] });
  return actor;
}
async function live(actor: Awaited<ReturnType<typeof fixture>>) {
  return (await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId)))[0]!;
}
async function approval(actor: Awaited<ReturnType<typeof fixture>>) {
  const review = await reviewSetup(actor);

  expect(review.blockers).toEqual([]);

  const approved = await approveSetup(actor, review.revision, review.hash, true);
  return { approvalId: approved.id, revision: review.revision, operationId: randomUUID() };
}
async function readyAccount(actor: Awaited<ReturnType<typeof fixture>>) {
  const [account] = await database.insert(schema.salonStripeAccountSchema).values({ id: randomUUID(), salonId: actor.salonId, stripeAccountId: `acct_test_${randomUUID()}`, livemode: false, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, lastSyncedAt: new Date() }).returning();
  return { chargeReady: true, status: 'charge_ready', payoutsPending: false, binding: { ...account!, requirements: { currentlyDue: [], eventuallyDue: [], pastDue: [], pendingVerification: [], currentDeadline: null, futureCurrentDeadline: null } } } as const;
}

it('prepares both settings through chat, leaves live settings untouched, and publishes only approved preferences without delivery', async () => {
  const settings: SalonSettings = { communications: { sms: { enabled: false }, email: { enabled: false }, killSwitch: true, events: { booking_confirmation: { enabled: false, channels: 'email' } } } };
  const actor = await fixture(settings);
  const before = (await live(actor)).settings;
  const provider = { createResponse: vi.fn().mockResolvedValue({ status: 'completed', usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 100 }, items: [{ type: 'message', text: JSON.stringify({ reply: 'Your amount and reminder preferences are proposed. Collection and messages stay off.', operationsJson: JSON.stringify([{ type: 'deposit', values: { enabled: false, amountCents: 2500 } }, { type: 'reminders', values: { rules } }]), designRequest: null }) }] }) };
  const head = (await runSetupConversation(actor, { expectedRevision: 2, operationId: randomUUID(), scope: 'business_and_website', message: 'Save a $25 deposit amount with collection off and a 48-hour reminder.' }, provider)).head;

  expect(head.revision.document.deposit).toEqual({ enabled: false, amountCents: 2500 });
  expect((await live(actor)).settings).toEqual(before);
  expect(holder.readiness).not.toHaveBeenCalled();

  const review = await reviewSetup(actor);

  expect(review.notices).toEqual(expect.arrayContaining([expect.stringMatching(/existing upcoming appointments/), expect.stringMatching(/Text delivery is not ready/)]));

  const input = await approval(actor);
  const published = await publishSetup(actor, input);

  expect((await publishSetup(actor, input)).receipt.id).toBe(published.receipt.id);

  const saved = await live(actor);

  expect(saved.settings?.payments?.deposit).toEqual({ enabled: false, amountCents: 2500 });
  expect(saved.settings?.communications).toMatchObject({ ...settings.communications, reminders: { rules } });
  expect(saved.smsRemindersEnabled).toBe(false);
  expect(holder.readiness).not.toHaveBeenCalled();
  expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, actor.salonId))).toEqual([]);
  expect(await database.select().from(schema.notificationDeliverySchema).where(eq(schema.notificationDeliverySchema.salonId, actor.salonId))).toEqual([]);
  expect(await database.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.salonId, actor.salonId))).toEqual([]);
});

it('keeps an enabled proposal private and blocks approval until the payment prerequisite is ready', async () => {
  const actor = await fixture();
  let head = await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'deposit', values: { enabled: true, amountCents: 2500 } }] });
  const review = await reviewSetup(actor);

  expect(review.blockers).toContain('Connect your payment account before enabling deposits. Your proposed amount is saved.');
  await expect(approveSetup(actor, review.revision, review.hash)).rejects.toMatchObject({ code: 'NOT_READY' });
  expect((await live(actor)).settings?.payments).toBeUndefined();
  expect(holder.readiness).not.toHaveBeenCalled();

  head = await editSetup(actor, { expectedRevision: head.revision.revision, operationId: randomUUID(), operations: [{ type: 'deposit', values: { enabled: false } }] });

  expect(head.revision.document.deposit).toEqual({ enabled: false, amountCents: 2500 });

  await publishSetup(actor, await approval(actor));

  expect((await live(actor)).settings?.payments?.deposit).toEqual({ enabled: false, amountCents: 2500 });
});

it('uses the shared provider gate only after exact approval and never repeats it after a successful lost-response retry', async () => {
  const actor = await fixture();
  const proof = await readyAccount(actor);
  holder.readiness.mockResolvedValue(proof);
  await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'deposit', values: { enabled: true, amountCents: 2500 } }] });
  const input = await approval(actor);

  expect(holder.readiness).not.toHaveBeenCalled();

  const result = await publishSetup(actor, input);

  expect(holder.readiness).toHaveBeenCalledTimes(1);
  expect(holder.readiness).toHaveBeenCalledWith(actor.salonId);
  expect((await publishSetup(actor, input)).receipt.id).toBe(result.receipt.id);
  expect(holder.readiness).toHaveBeenCalledTimes(1);

  const salon = await live(actor);

  expect(salon.settings?.payments?.deposit).toMatchObject({ enabled: true, amountCents: 2500, activationConfirmed: true, noShowProtection: 'warn_only' });
  expect(resolveDepositPolicy({ settings: salon.settings, features: salon.features, stripeAccount: proof.binding, expectedLivemode: false })).toMatchObject({ active: true, amountCents: 2500 });
});

it('aborts all configuration writes when payment verification fails or its binding is revoked', async () => {
  const actor = await fixture();
  const proof = await readyAccount(actor);
  await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'deposit', values: { enabled: true, amountCents: 2500 } }] });
  const input = await approval(actor);
  holder.readiness.mockRejectedValueOnce(new Error('Synthetic provider outage'));

  await expect(publishSetup(actor, input)).rejects.toMatchObject({ code: 'NOT_READY' });
  expect((await live(actor)).settings?.payments).toBeUndefined();

  holder.readiness.mockImplementationOnce(async () => {
    await database.update(schema.salonStripeAccountSchema).set({ revokedAt: new Date(), revocationCause: 'revoked_local' }).where(eq(schema.salonStripeAccountSchema.id, proof.binding.id));
    return proof;
  });

  await expect(publishSetup(actor, input)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  expect((await live(actor)).publicationStatus).toBe('draft');
  expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toEqual([]);
});

it('cannot use another salon’s provider proof or approve a changed revision', async () => {
  const actor = await fixture();
  await readyAccount(actor);
  const other = await fixture();
  holder.readiness.mockResolvedValue(await readyAccount(other));
  await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'deposit', values: { enabled: true, amountCents: 2500 } }] });
  const input = await approval(actor);

  await expect(publishSetup(actor, input)).rejects.toMatchObject({ code: 'STALE' });

  await editSetup(actor, { expectedRevision: 3, operationId: randomUUID(), operations: [{ type: 'deposit', values: { amountCents: 3000 } }] });

  await expect(publishSetup(actor, input)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  expect((await live(actor)).settings?.payments).toBeUndefined();
});

it('binds deposit approval to the payment account shown at review, without serializing its identity', async () => {
  const actor = await fixture();
  const old = await readyAccount(actor);
  await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'deposit', values: { enabled: true, amountCents: 2500 } }] });
  const reviewed = await reviewSetup(actor);

  expect(JSON.stringify(reviewed)).not.toContain(old.binding.stripeAccountId);

  const input = await approval(actor);
  await database.update(schema.salonStripeAccountSchema).set({ revokedAt: new Date(), revocationCause: 'revoked_local' }).where(eq(schema.salonStripeAccountSchema.id, old.binding.id));
  holder.readiness.mockResolvedValue(await readyAccount(actor));

  await expect(publishSetup(actor, input)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  expect(holder.readiness).not.toHaveBeenCalled();
  expect((await live(actor)).settings?.payments).toBeUndefined();
});

it('does not activate a dormant deposit or remove existing no-show protection during an amount-only edit', async () => {
  const actor = await fixture({ payments: { deposit: { enabled: true, activationConfirmed: false, amountCents: 2000, noShowProtection: 'deposit_2' } } });
  await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'deposit', values: { amountCents: 2500 } }] });
  await publishSetup(actor, await approval(actor));

  expect((await live(actor)).settings?.payments?.deposit).toEqual({ enabled: true, activationConfirmed: false, amountCents: 2500, noShowProtection: 'deposit_2' });
  expect(holder.readiness).not.toHaveBeenCalled();
});

it('reviews the canonical dormant-protection reset before regular deposit activation', async () => {
  const actor = await fixture({ payments: { deposit: { enabled: true, activationConfirmed: false, amountCents: 2000, noShowProtection: 'deposit_2' } } });
  holder.readiness.mockResolvedValue(await readyAccount(actor));
  await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'deposit', values: { enabled: true } }] });
  const review = await reviewSetup(actor);

  expect(review.changes).toContainEqual({ path: 'deposit.activationEffect.noShowProtection', before: 'deposit_2', after: 'warn_only' });
  expect(review.notices).toContain('Your previous no-show deposit rule was never activated. Enabling regular deposits leaves no-show protection at Warn only. You can choose enforcement separately in Payments.');

  await publishSetup(actor, await approval(actor));

  expect((await live(actor)).settings?.payments?.deposit).toMatchObject({ activationConfirmed: true, noShowProtection: 'warn_only' });
});

it('mints new reminder identities through the canonical writer while retaining saved rule identities', async () => {
  const actor = await fixture();
  const head = await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'reminders', values: { rules: [{ ...rules[0] }, { id: 'model_chosen_id', offsetMinutes: 120, channels: 'sms', enabled: true }] } }] }, 'assistant');

  expect(head.revision.document.reminders!.rules[0]!.id).toBe('crule_default_24h');
  expect(head.revision.document.reminders!.rules[1]!.id).toMatch(/^crule_[\da-f-]{36}$/u);
  expect(head.revision.document.reminders!.rules[1]!.id).not.toBe('model_chosen_id');

  await publishSetup(actor, await approval(actor));

  expect(resolveCommunicationSettingsFromSettings((await live(actor)).settings).reminders.rules).toEqual(head.revision.document.reminders!.rules);
});

it('does not unpause malformed communications or change channel masters while saving a rule', async () => {
  const actor = await fixture({ communications: { quietHours: { enabled: true, start: 'broken', end: '08:00' }, email: { enabled: false } } });
  await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'reminders', values: { rules, quietHours: { enabled: true, start: '22:00', end: '08:00' } } }] });
  await publishSetup(actor, await approval(actor));
  const settings = (await live(actor)).settings;

  expect(settings?.communications?.sms).toBeUndefined();
  expect(settings?.communications?.email).toEqual({ enabled: false });
  expect(resolveCommunicationSettingsFromSettings(settings).killSwitch).toBe(true);
});

it('rejects duplicate rules, unsupported activation fields and model changes outside business scope', async () => {
  const actor = await fixture();
  const document = (await openSetup(actor)).revision.document;

  expect(() => applySetupOperations(document, [{ type: 'reminders', values: { rules: [rules[0], { ...rules[0], id: 'another_rule' }] } }], 'assistant')).toThrow(/Duplicate enabled reminder offset/);
  expect(() => applySetupOperations(document, [{ type: 'deposit', values: { enabled: true, activationConfirmed: true } } as never], 'assistant')).toThrow();

  const provider = { createResponse: vi.fn().mockResolvedValue({ status: 'completed', usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 100 }, items: [{ type: 'message', text: JSON.stringify({ reply: 'Changed.', operationsJson: JSON.stringify([{ type: 'deposit', values: { enabled: true, amountCents: 2500 } }]), designRequest: null }) }] }) };

  await expect(runSetupConversation(actor, { expectedRevision: 2, operationId: randomUUID(), scope: 'website', message: 'Set a $25 deposit.' }, provider)).rejects.toMatchObject({ code: 'INVALID' });
  expect((await openSetup(actor)).revision.revision).toBe(2);
});
