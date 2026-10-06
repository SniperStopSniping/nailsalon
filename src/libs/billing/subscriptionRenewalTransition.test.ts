import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown, retrieve: vi.fn(), update: vi.fn() }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/Env', () => ({ Env: { BILLING_PLAN_ENV: 'prod' } }));
vi.mock('@/libs/stripe', () => ({ stripe: { subscriptions: { retrieve: holder.retrieve, update: holder.update } } }));
vi.mock('@/libs/auditLog', () => ({ logAuditEventTx: vi.fn() }));

const { renewalTransitionDecision, transitionSalonSubscriptionRenewals } = await import('./subscriptionRenewalTransition');
const binding = { salonId: 'salon_a', subscriptionId: 'sub_a', customerId: 'cus_a' };
const remote = { id: 'sub_a', customer: 'cus_a', status: 'active', cancel_at_period_end: false, livemode: true, metadata: { salonId: 'salon_a' } };

describe('subscription renewal transition', () => {
  it('stops a verified locally bound live subscription while preserving paid coverage', () => {
    expect(renewalTransitionDecision(binding, remote, true)).toBe('stop_renewal');
  });

  it.each([
    { id: 'sub_other' },
    { customer: 'cus_other' },
    { metadata: { salonId: 'salon_b' } },
    { metadata: {} as Record<string, string> },
    { livemode: false },
  ])('holds ambiguous provider evidence %j', (override) => {
    expect(renewalTransitionDecision(binding, { ...remote, ...override }, true)).toBe('binding_mismatch');
  });

  it.each(['canceled', 'incomplete_expired'])('retries canceled status %s without a provider mutation', (status) => {
    expect(renewalTransitionDecision(binding, { ...remote, status }, true)).toBe('already_stopped');
  });

  it('recognizes an existing scheduled cancellation', () => {
    expect(renewalTransitionDecision(binding, { ...remote, cancel_at_period_end: true }, true)).toBe('already_stopped');
  });
});

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

it('rehearses both tracks read-only, then stops each renewal without changing prepaid coverage', async () => {
  await db.insert(schema.salonSchema).values({ id: 'salon_transition', name: 'Transition', slug: 'transition', stripeCustomerId: 'cus_legacy', stripeSubscriptionId: 'sub_legacy' });
  const paidThrough = new Date('2027-01-01T00:00:00Z');
  await db.insert(schema.billingSubscriptionSchema).values({ id: 'bsub_transition', salonId: 'salon_transition', stripeSubscriptionId: 'sub_modern', stripeCustomerId: 'cus_modern', planDefinitionKey: 'pro_2026_08', billingOfferKey: 'pro_2026_08_annual', billingCadence: 'annual', status: 'active', paidThrough, creditCycleAnchor: new Date() });
  const stopped = new Set<string>();
  holder.retrieve.mockImplementation(async (id: string) => ({ ...remote, id, customer: id === 'sub_legacy' ? 'cus_legacy' : 'cus_modern', metadata: { salonId: 'salon_transition' }, cancel_at_period_end: stopped.has(id) }));
  holder.update.mockImplementation(async (id: string) => {
    stopped.add(id);
    return holder.retrieve(id);
  });
  const rehearsal = await transitionSalonSubscriptionRenewals('salon_transition', 'super', false);

  expect(rehearsal.map(result => result.status)).toEqual(['stop_renewal', 'stop_renewal']);
  expect(holder.update).not.toHaveBeenCalled();

  await transitionSalonSubscriptionRenewals('salon_transition', 'super', true);

  expect(holder.update).toHaveBeenCalledTimes(2);
  expect(holder.update).toHaveBeenCalledWith('sub_modern', { cancel_at_period_end: true }, { idempotencyKey: 'free-model-stop-renewal:salon_transition:sub_modern' });

  const [subscription] = await db.select().from(schema.billingSubscriptionSchema).where(eq(schema.billingSubscriptionSchema.id, 'bsub_transition'));

  expect(subscription).toMatchObject({ paidThrough, status: 'active', cancelAtPeriodEnd: true });

  await transitionSalonSubscriptionRenewals('salon_transition', 'super', true);

  expect(holder.update).toHaveBeenCalledTimes(2);
});
