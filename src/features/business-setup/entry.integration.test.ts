import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { businessSetupSelfServeEnabled, setupAiAvailableForSalon } from './access.server';
import { openSetup } from './drafts.server';
import { openAiBuilder } from './entry.server';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown, onboarding: true }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/features/onboarding-v1-integration/config.server', () => ({ isOnboardingV1IntegrationEnabled: () => holder.onboarding }));
const client = new PGlite();
const database = drizzle(client, { schema });
const identity = () => ({ clerkUserId: `user_${randomUUID()}`, email: `${randomUUID()}@example.invalid`, verifiedEmail: 'verified@example.invalid', name: 'Synthetic owner', phoneE164: null });

beforeAll(async () => {
  await client.waitReady;
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = database;
}, 60000);

beforeEach(() => {
  holder.onboarding = true;
  for (const name of ['BUSINESS_SETUP_AI_ENABLED', 'BUSINESS_SETUP_SELF_SERVE_ENABLED', 'AI_CREDITS_ENABLED', 'AI_CREDIT_METERING_ENABLED']) {
    vi.stubEnv(name, 'true');
  }
});

afterEach(() => vi.unstubAllEnvs());

afterAll(() => client.close());

it('creates exactly one private business across retries and refresh, without services, customer data or credits', async () => {
  const owner = identity();
  const first = await openAiBuilder(owner);

  expect(await openAiBuilder(owner)).toEqual(first);

  const [admin] = await database.select().from(schema.adminUserSchema).where(eq(schema.adminUserSchema.clerkUserId, owner.clerkUserId));
  const members = await database.select().from(schema.adminSalonMembershipSchema).where(eq(schema.adminSalonMembershipSchema.adminId, admin!.id));

  expect(members).toHaveLength(1);

  const salonId = members[0]!.salonId;
  const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, salonId));

  expect(salon).toMatchObject({ publicationStatus: 'draft', onlineBookingEnabled: false, smsRemindersEnabled: false, address: null, email: null, ownerEmail: owner.email, plan: 'free', freeSoloEnabled: true });
  expect(setupAiAvailableForSalon(salonId)).toBe(true);

  for (const table of [schema.serviceSchema, schema.appointmentSchema, schema.salonClientSchema, schema.aiCreditLedgerSchema]) {
    expect(await database.select().from(table).where(eq(table.salonId, salonId))).toHaveLength(0);
  }
  const draft = await openSetup({ salonId, adminId: admin!.id });

  expect(draft.revision.document.business).toMatchObject({ name: 'Untitled business', locationDisplayMode: 'city_only' });
  expect(draft.revision.document.services).toHaveLength(0);
});

it('starts from existing canonical details instead of creating a duplicate salon or replacing business settings', async () => {
  const owner = identity();
  const first = await openAiBuilder(owner);
  if (first.kind !== 'ready') {
    throw new Error('Expected ready');
  }
  await database.update(schema.salonSchema).set({ name: 'Existing Studio', city: 'Toronto', publicationStatus: 'published', onlineBookingEnabled: true, settings: { rebookingPrompt: { enabled: true } } }).where(eq(schema.salonSchema.slug, first.slug));

  expect(await openAiBuilder(owner)).toEqual(first);

  const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.slug, first.slug));

  expect(salon).toMatchObject({ name: 'Existing Studio', city: 'Toronto', settings: { rebookingPrompt: { enabled: true } }, publicationStatus: 'published', onlineBookingEnabled: true });
});

it('requires a choice when the owner has two salons and rejects a staff-only or another owner’s salon', async () => {
  const owner = identity();
  const first = await openAiBuilder(owner);
  if (first.kind !== 'ready') {
    throw new Error('Expected ready');
  }
  const [admin] = await database.select().from(schema.adminUserSchema).where(eq(schema.adminUserSchema.clerkUserId, owner.clerkUserId));
  const secondId = randomUUID();
  await database.insert(schema.salonSchema).values({ id: secondId, slug: secondId, name: 'Second Studio' });
  await database.insert(schema.adminSalonMembershipSchema).values({ adminId: admin!.id, salonId: secondId, role: 'owner' });

  expect(await openAiBuilder(owner)).toMatchObject({ kind: 'choose', salons: expect.arrayContaining([{ slug: first.slug, name: 'Untitled business' }, { slug: secondId, name: 'Second Studio' }]) });
  expect(await openAiBuilder(owner, secondId)).toEqual({ kind: 'ready', slug: secondId });

  const other = await openAiBuilder(identity());
  if (other.kind !== 'ready') {
    throw new Error('Expected ready');
  }

  await expect(openAiBuilder(owner, other.slug)).rejects.toMatchObject({ code: 'FORBIDDEN' });

  await database.update(schema.adminSalonMembershipSchema).set({ role: 'staff' }).where(eq(schema.adminSalonMembershipSchema.salonId, secondId));

  await expect(openAiBuilder(owner, secondId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('does not recover a deleted or removed owner membership by creating another salon', async () => {
  const owner = identity();
  const first = await openAiBuilder(owner);
  if (first.kind !== 'ready') {
    throw new Error('Expected ready');
  }
  const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.slug, first.slug));
  await database.update(schema.salonSchema).set({ deletedAt: new Date() }).where(eq(schema.salonSchema.id, salon!.id));

  await expect(openAiBuilder(owner)).rejects.toMatchObject({ code: 'FORBIDDEN' });

  await database.update(schema.salonSchema).set({ deletedAt: null }).where(eq(schema.salonSchema.id, salon!.id));
  await database.delete(schema.adminSalonMembershipSchema).where(eq(schema.adminSalonMembershipSchema.salonId, salon!.id));

  await expect(openAiBuilder(owner)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it.each(['BUSINESS_SETUP_AI_ENABLED', 'BUSINESS_SETUP_SELF_SERVE_ENABLED', 'AI_CREDITS_ENABLED', 'AI_CREDIT_METERING_ENABLED'])('keeps enrollment disabled without %s', async (flag) => {
  vi.stubEnv(flag, 'false');

  expect(businessSetupSelfServeEnabled()).toBe(false);
  await expect(openAiBuilder(identity())).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

it('requires the existing onboarding account and organization support to be enabled', async () => {
  holder.onboarding = false;

  expect(businessSetupSelfServeEnabled()).toBe(false);
  await expect(openAiBuilder(identity())).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
