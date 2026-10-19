import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { getSalonByFormerSlug } from '@/libs/queries';
import { suggestSalonSlug } from '@/libs/tenantSlug';
import * as schema from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

import { rethrowBookingLinkCollision } from './booking-link.server';
import { applySetupOperations, CLOSED_HOURS, setupOperationSchema } from './contracts';
import { approveSetup, editSetup, openSetup, resetSetupDraft, restartSetup, reviewSetup } from './drafts.server';
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

async function fixture() {
  const actor = { salonId: randomUUID(), adminId: randomUUID() };
  await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
  await database.insert(schema.salonSchema).values({ id: actor.salonId, slug: actor.salonId, name: 'Untitled business', publicationStatus: 'draft', onlineBookingEnabled: false, smsRemindersEnabled: false });
  await database.insert(schema.adminSalonMembershipSchema).values({ ...actor, role: 'owner' });
  await openSetup(actor);
  await editSetup(actor, { expectedRevision: 1, operationId: randomUUID(), operations: [
    { type: 'business', values: { name: 'Lily Nails', city: 'Toronto', workMode: 'solo' } },
    { type: 'hours', values: { ...CLOSED_HOURS, monday: { open: '09:00', close: '17:00' } } },
    { type: 'service', values: { id: 'draft_gel', name: 'Gel', description: null, priceCents: 6500, durationMinutes: 60, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, category: 'manicure', bookingCategory: 'manicure' } },
  ] });
  return actor;
}
async function choose(actor: Awaited<ReturnType<typeof fixture>>, slug = `lily-${randomUUID().slice(0, 8)}`) {
  const head = await openSetup(actor);
  return editSetup(actor, { expectedRevision: head.revision.revision, operationId: randomUUID(), operations: [{ type: 'site_url', slug }] });
}
async function approved(actor: Awaited<ReturnType<typeof fixture>>) {
  const review = await reviewSetup(actor);
  const approval = await approveSetup(actor, review.revision, review.hash);
  return { revision: review.revision, approvalId: approval.id, operationId: randomUUID() };
}

it.each([false, true])('preserves the raw live website fields during a first draft edit (saved live fields: %s)', async (existingLive) => {
  const actor = { salonId: randomUUID(), adminId: randomUUID() };
  const settings: SalonSettings & { bookingPage?: ReturnType<typeof resolveBookingPageConfig>; bookingPageContent?: ReturnType<typeof resolveBookingPageContent> } = existingLive ? { bookingPage: { ...resolveBookingPageConfig(null), livePresetBase: null }, bookingPageContent: resolveBookingPageContent(null) } : {};
  await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
  await database.insert(schema.salonSchema).values({ id: actor.salonId, slug: actor.salonId, name: 'Untitled business', publicationStatus: 'draft', onlineBookingEnabled: false, settings });
  await database.insert(schema.adminSalonMembershipSchema).values({ ...actor, role: 'owner' });
  await openSetup(actor);
  await editSetup(actor, { expectedRevision: 1, operationId: randomUUID(), operations: [{ type: 'business', values: { name: 'Draft name', city: 'Toronto' } }] });
  const [saved] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

  const savedSettings = saved!.settings as typeof settings;

  expect(savedSettings.bookingPage?.live).toEqual(existingLive ? settings.bookingPage!.live : undefined);
  expect(savedSettings.bookingPage?.livePresetBase).toEqual(existingLive ? null : undefined);
  expect(savedSettings.bookingPageContent?.live).toEqual(existingLive ? settings.bookingPageContent!.live : undefined);
  expect(resolveBookingPageConfig(saved!.settings).live).toEqual(resolveBookingPageConfig(settings).live);
  expect(resolveBookingPageContent(saved!.settings).live).toEqual(resolveBookingPageContent(settings).live);
  expect(saved).toMatchObject({ name: 'Untitled business', city: null, publicationStatus: 'draft', onlineBookingEnabled: false });
});

it('saves a chosen link only in the draft and includes it in exact review', async () => {
  const actor = await fixture();
  const head = await choose(actor);
  const slug = head.revision.document.siteSlug;
  const [live] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

  expect(head).toMatchObject({ salonSlug: actor.salonId, canChooseBookingLink: true });
  expect(live).toMatchObject({ slug: actor.salonId, publicationStatus: 'draft', onlineBookingEnabled: false });
  expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toEqual([]);
  expect((await reviewSetup(actor)).changes).toContainEqual({ path: 'siteSlug', before: actor.salonId, after: slug });
});

it('publishes the exact chosen link, preserves identities, and replays the same receipt after a lost response', async () => {
  const actor = await fixture();
  const head = await choose(actor);
  const input = await approved(actor);
  const first = await publishSetup(actor, input);
  const retry = await publishSetup(actor, input);

  expect(first.salonSlug).toBe(head.revision.document.siteSlug);
  expect(retry.receipt.id).toBe(first.receipt.id);
  expect(retry.salonSlug).toBe(first.salonSlug);
  expect(await getSalonByFormerSlug(actor.salonId)).toMatchObject({ id: actor.salonId, slug: first.salonSlug });
  expect(await database.select().from(schema.salonAuditLogSchema).where(eq(schema.salonAuditLogSchema.salonId, actor.salonId))).toHaveLength(1);
  expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(1);
  expect(await openSetup(actor)).toMatchObject({ salonSlug: first.salonSlug, canChooseBookingLink: false, workspace: { status: 'published' } });
});

it('rejects a new URL under an older approval without publishing anything', async () => {
  const actor = await fixture();
  await choose(actor);
  const input = await approved(actor);
  await choose(actor);

  await expect(publishSetup(actor, input)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  expect(await getSalonByFormerSlug(actor.salonId)).toBeNull();
});

it('blocks a taken name including an inactive salon without exposing its identity', async () => {
  const actor = await fixture();
  const slug = `taken-${randomUUID().slice(0, 8)}`;
  await database.insert(schema.salonSchema).values({ id: randomUUID(), slug, name: 'Private other business', isActive: false });
  await choose(actor, slug);
  const review = await reviewSetup(actor);

  expect(review.blockers).toContain('That booking link is already in use. Choose another in Details, then review again.');
  expect(JSON.stringify(review)).not.toContain('Private other business');
  await expect(approveSetup(actor, review.revision, review.hash)).rejects.toMatchObject({ code: 'NOT_READY' });
});

it('detects a URL claimed after approval and keeps the entire publication private', async () => {
  const actor = await fixture();
  const head = await choose(actor);
  const input = await approved(actor);
  await database.insert(schema.salonSchema).values({ id: randomUUID(), slug: head.revision.document.siteSlug!, name: 'Another business' });

  await expect(publishSetup(actor, input)).rejects.toMatchObject({ code: 'NOT_READY' });
  expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);
  expect((await openSetup(actor)).workspace.status).toBe('editing');
});

it('protects published URLs through editing and restore without losing service configuration', async () => {
  const actor = await fixture();
  const head = await choose(actor);
  const published = await publishSetup(actor, await approved(actor));
  const editing = await restartSetup(actor, head.revision.revision);

  await expect(choose(actor)).rejects.toMatchObject({ code: 'INVALID' });

  const reset = await resetSetupDraft(actor, { expectedRevision: editing.revision.revision, operationId: randomUUID() });
  const restored = await resetSetupDraft(actor, { expectedRevision: reset.revision.revision, operationId: randomUUID() }, true);

  expect(restored.revision.document.siteSlug).toBe(published.salonSlug);
  expect(restored.revision.document.services).toHaveLength(1);
});

it('hydrates old drafts without changing their immutable source or guessing another address', async () => {
  const actor = await fixture();
  const head = await openSetup(actor);
  const legacy = structuredClone(head.revision.document);
  delete legacy.siteSlug;
  const row = and(eq(schema.businessSetupRevisionSchema.workspaceId, head.workspace.id), eq(schema.businessSetupRevisionSchema.revision, head.revision.revision));
  await database.update(schema.businessSetupRevisionSchema).set({ document: legacy }).where(row);

  expect((await openSetup(actor)).revision.document.siteSlug).toBe(actor.salonId);
  expect((await database.select().from(schema.businessSetupRevisionSchema).where(row))[0]!.document.siteSlug).toBeUndefined();
});

it('rejects non-owner and model-origin URL writes and invalid/reserved names', async () => {
  const actor = await fixture();
  const foreign = await fixture();

  await expect(editSetup({ ...actor, adminId: foreign.adminId }, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'site_url', slug: 'other-name' }] })).rejects.toMatchObject({ code: 'FORBIDDEN' });

  const head = await openSetup(actor);

  expect(() => applySetupOperations(head.revision.document, [{ type: 'site_url', slug: 'other-name' }], 'assistant')).toThrow('Choose your booking link in Details');

  for (const slug of ['admin', 'https://elsewhere.test', 'has spaces', 'a'.repeat(48)]) {
    expect(setupOperationSchema.safeParse({ type: 'site_url', slug }).success).toBe(false);
  }
});

it('suggests readable names and handles uniqueness errors without concealing other failures', () => {
  expect(suggestSalonSlug('Élégance Nails & Spa')).toBe('elegance-nails-spa');
  expect(suggestSalonSlug('Admin')).toBe('luster-studio');
  expect(suggestSalonSlug(`${'x'.repeat(37)} hello`)).toBe('x'.repeat(37));
  expect(() => rethrowBookingLinkCollision({ cause: { code: '23505', constraint: 'salon_slug_unique' } })).toThrow('That booking link was just taken');

  const original = new Error('Other database failure');

  expect(() => rethrowBookingLinkCollision(original)).toThrow(original);
});
