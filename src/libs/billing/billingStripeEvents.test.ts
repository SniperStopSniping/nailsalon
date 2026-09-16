/**
 * `billing_stripe_event` claim machinery — the PR-2 (D19c §2.3 items 4–5)
 * additions, on PGlite: the Y12 reclaim of a livemode-mismatch row once the
 * deployment's mode configuration is corrected, and claim-time-safe salon
 * attribution that can never push a foreign salon id through the row's
 * foreign key.
 *
 * The pre-existing §8.2 ladder (claim once, backoff reclaim, poison at the
 * cap) is pinned in billingSubscriptionProjection.test.ts and is not
 * duplicated here.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

const events = () => import('./billingStripeEvents');

const T0 = new Date('2026-09-16T10:00:00.000Z');

const rowFor = async (eventId: string) => {
  const [row] = await db.select().from(schema.billingStripeEventSchema)
    .where(eq(schema.billingStripeEventSchema.eventId, eventId));
  return row;
};

describe('Y12 — a livemode-mismatch row is reclaimable once configuration is corrected', () => {
  it('parks terminally, stays parked on a replay under the same expectation, then claims with attempts incremented', async () => {
    const { claimBillingEvent, recordIgnoredBillingEvent, resolveBillingEvent } = await events();
    const base = {
      eventId: 'evt_y12_reclaim',
      eventType: 'invoice.payment_succeeded',
      livemode: true,
      apiCreatedAt: T0,
      now: T0,
    };

    // Delivery 1 — the deployment's expectation says test, the event is live.
    await recordIgnoredBillingEvent(base, 'ignored_livemode_mismatch');

    expect((await rowFor(base.eventId))!.status).toBe('ignored_livemode_mismatch');
    expect((await rowFor(base.eventId))!.attempts).toBe(0);

    // Delivery 2 — still mismatched, so the route never reaches the claim and
    // the durable row is untouched (ON CONFLICT DO NOTHING).
    await recordIgnoredBillingEvent(base, 'ignored_livemode_mismatch');

    expect((await rowFor(base.eventId))!.status).toBe('ignored_livemode_mismatch');
    expect((await rowFor(base.eventId))!.attempts).toBe(0);

    // Delivery 3 — the secret has been corrected, so the route's livemode gate
    // now PASSES and it claims. Before PR-2 this answered already_processed
    // and the event was lost forever.
    const claim = await claimBillingEvent({ ...base, now: new Date(T0.getTime() + 60_000) });

    expect(claim).toEqual({ claimed: true, attempts: 1 });
    expect((await rowFor(base.eventId))!.status).toBe('processing');

    // …and it then resolves normally under the CAS fence.
    expect(await resolveBillingEvent(base.eventId, 1, 'processed')).toEqual({ written: true });
    expect((await rowFor(base.eventId))!.status).toBe('processed');
  });

  it('a reclaimed mismatch row still answers already_processed once it is genuinely terminal', async () => {
    const { claimBillingEvent, recordIgnoredBillingEvent, resolveBillingEvent } = await events();
    const base = {
      eventId: 'evt_y12_terminal',
      eventType: 'customer.subscription.updated',
      livemode: true,
      apiCreatedAt: T0,
      now: T0,
    };
    await recordIgnoredBillingEvent(base, 'ignored_livemode_mismatch');
    const claim = await claimBillingEvent({ ...base, now: T0 });

    expect(claim.claimed).toBe(true);

    await resolveBillingEvent(base.eventId, 1, 'ignored_foreign', 'FOREIGN_INVOICE');

    expect(await claimBillingEvent({ ...base, now: new Date(T0.getTime() + 60_000) }))
      .toEqual({ claimed: false, reason: 'already_processed' });
  });
});

describe('§2.3 item 4 — recordBillingEventSalonId', () => {
  it('attributes a claimed row to a LOCAL salon', async () => {
    const { claimBillingEvent, recordBillingEventSalonId } = await events();
    await db.insert(schema.salonSchema).values({ id: 's_attr_local', name: 's', slug: 's-attr-local' });
    await claimBillingEvent({
      eventId: 'evt_attr_local',
      eventType: 'invoice.payment_succeeded',
      livemode: false,
      apiCreatedAt: T0,
      now: T0,
    });

    // Claim time never attributes — §2.3 item 4 defers it to the handler.
    expect((await rowFor('evt_attr_local'))!.salonId).toBeNull();

    await recordBillingEventSalonId('evt_attr_local', 's_attr_local');

    expect((await rowFor('evt_attr_local'))!.salonId).toBe('s_attr_local');
  });

  it('is a no-op on null, and NEVER pushes an unknown salon id through the foreign key', async () => {
    const { claimBillingEvent, recordBillingEventSalonId } = await events();
    await claimBillingEvent({
      eventId: 'evt_attr_foreign',
      eventType: 'customer.subscription.created',
      livemode: false,
      apiCreatedAt: T0,
      now: T0,
    });

    await recordBillingEventSalonId('evt_attr_foreign', null);

    expect((await rowFor('evt_attr_foreign'))!.salonId).toBeNull();

    // A salon id from ANOTHER deployment's metadata: the write is silently
    // skipped rather than raising a foreign-key error inside a webhook that
    // has already committed its financial effect.
    await expect(recordBillingEventSalonId('evt_attr_foreign', 's_not_in_this_database')).resolves.toBeUndefined();

    expect((await rowFor('evt_attr_foreign'))!.salonId).toBeNull();
  });

  it('treats a SOFT-DELETED salon as not attributable (the rule the rest of billing applies)', async () => {
    const { claimBillingEvent, recordBillingEventSalonId } = await events();
    await db.insert(schema.salonSchema).values({
      id: 's_attr_deleted',
      name: 's',
      slug: 's-attr-deleted',
      deletedAt: T0,
    });
    await claimBillingEvent({
      eventId: 'evt_attr_deleted',
      eventType: 'invoice.payment_failed',
      livemode: false,
      apiCreatedAt: T0,
      now: T0,
    });

    await recordBillingEventSalonId('evt_attr_deleted', 's_attr_deleted');

    expect((await rowFor('evt_attr_deleted'))!.salonId).toBeNull();
  });
});
