/**
 * Super-admin salon settings — LG-4 (Rev 2.3 §5 companion, D19c).
 *
 * The super-admin select must show the TRUTH: once the legacy webhook route
 * stops flipping `salon.billingMode` for new-track sessions (§5 isolation
 * exception), a paying new-track salon still reads `NONE` in the legacy column,
 * and an operator looking at this screen would conclude the salon is on cash.
 *
 * The derived read is display-only. The PATCH keeps writing the legacy column,
 * and that is asserted here rather than assumed, because the write side is what
 * the operator's next action depends on.
 *
 * Real PGlite + the shipped migrations: the live-row predicate is SQL.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const { requireSuperAdmin, logAuditEvent } = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(async (): Promise<Response | null> => null),
  logAuditEvent: vi.fn(async () => {}),
}));

vi.mock('@/libs/superAdmin', () => ({ requireSuperAdmin }));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent }));

const { GET, PATCH } = await import('./route');

let db: ReturnType<typeof drizzle<typeof schema>>;

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function seedSalon(
  id: string,
  billingMode: string | null,
  stripeSubscriptionStatus: string | null = null,
) {
  await db.insert(schema.salonSchema).values({
    id,
    name: `Salon ${id}`,
    slug: `salon-${id}`,
    billingMode,
    stripeSubscriptionStatus,
    reviewsEnabled: true,
    rewardsEnabled: true,
  });
}

async function seedSubscription(salonId: string, status: schema.BillingSubscriptionStatus) {
  await db.insert(schema.billingSubscriptionSchema).values({
    id: `bsub_${salonId}`,
    salonId,
    stripeSubscriptionId: `sub_${salonId}`,
    stripeCustomerId: `cus_${salonId}`,
    planDefinitionKey: 'starter_2026_08',
    billingOfferKey: 'starter_2026_08_monthly',
    billingCadence: 'monthly',
    status,
    paidThrough: new Date('2026-10-16T00:00:00Z'),
    creditCycleAnchor: new Date('2026-09-16T00:00:00Z'),
  });
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(() => {
  vi.clearAllMocks();
  requireSuperAdmin.mockResolvedValue(null);
});

describe('LG-4 — super-admin GET derives the billing display', () => {
  it('shows STRIPE and the row status for a live billing_subscription even though the legacy column says NONE', async () => {
    await seedSalon('sa_live', 'NONE');
    await seedSubscription('sa_live', 'past_due');

    const response = await GET(new Request('http://localhost/x'), params('sa_live'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settings.billingMode).toBe('STRIPE');
    expect(body.subscriptionStatus).toBe('past_due');
    expect(body.billingSource).toBe('billing_subscription');

    // Display only: the stored column is untouched by the read.
    const [row] = await db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, 'sa_live'));

    expect(row?.billingMode).toBe('NONE');
  });

  it('falls back to the legacy columns for a canceled-only row', async () => {
    await seedSalon('sa_canceled', 'NONE', 'canceled');
    await seedSubscription('sa_canceled', 'canceled');

    const response = await GET(new Request('http://localhost/x'), params('sa_canceled'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settings.billingMode).toBe('NONE');
    expect(body.subscriptionStatus).toBeNull();
    expect(body.billingSource).toBe('legacy');
  });

  it('leaves a genuine legacy Stripe subscriber exactly as it reads today', async () => {
    await seedSalon('sa_legacy', 'STRIPE', 'active');

    const response = await GET(new Request('http://localhost/x'), params('sa_legacy'));
    const body = await response.json();

    expect(body.settings.billingMode).toBe('STRIPE');
    expect(body.subscriptionStatus).toBe('active');
    expect(body.billingSource).toBe('legacy');
  });

  it('still 404s for an unknown salon', async () => {
    const response = await GET(new Request('http://localhost/x'), params('sa_missing'));

    expect(response.status).toBe(404);
  });
});

describe('LG-4 — super-admin PATCH keeps writing the LEGACY column', () => {
  it('persists billingMode to the legacy column while the response shows the derived truth', async () => {
    await seedSalon('sa_patch', 'NONE');
    await seedSubscription('sa_patch', 'active');

    const response = await PATCH(
      new Request('http://localhost/x', {
        method: 'PATCH',
        body: JSON.stringify({ reviewsEnabled: false }),
      }),
      params('sa_patch'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settings.reviewsEnabled).toBe(false);
    expect(body.settings.billingMode).toBe('STRIPE');
    expect(body.billingSource).toBe('billing_subscription');

    const [row] = await db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, 'sa_patch'));

    // The derived READ never rewrites the column the PATCH owns.
    expect(row?.billingMode).toBe('NONE');
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
  });

  it('an explicit billingMode edit still lands in the legacy column', async () => {
    await seedSalon('sa_patch_mode', 'NONE');

    const response = await PATCH(
      new Request('http://localhost/x', {
        method: 'PATCH',
        body: JSON.stringify({ billingMode: 'STRIPE' }),
      }),
      params('sa_patch_mode'),
    );

    expect(response.status).toBe(200);

    const [row] = await db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, 'sa_patch_mode'));

    expect(row?.billingMode).toBe('STRIPE');
    expect((await response.json()).billingSource).toBe('legacy');
  });

  it('the no-change branch derives the display too', async () => {
    await seedSalon('sa_nochange', 'NONE');
    await seedSubscription('sa_nochange', 'trialing');

    const response = await PATCH(
      new Request('http://localhost/x', {
        method: 'PATCH',
        body: JSON.stringify({ reviewsEnabled: true }),
      }),
      params('sa_nochange'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settings.billingMode).toBe('STRIPE');
    expect(body.subscriptionStatus).toBe('trialing');
    expect(body.billingSource).toBe('billing_subscription');
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('still refuses an unauthenticated caller before touching anything', async () => {
    requireSuperAdmin.mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    const response = await PATCH(
      new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ billingMode: 'STRIPE' }) }),
      params('sa_live'),
    );

    expect(response.status).toBe(401);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
