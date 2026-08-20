/**
 * GET/POST /api/salon/catalog-rules — the FIRST writer `catalog_rule` has
 * ever had (migration 0073 created it empty and dark). This is the
 * "domain-intent API" from the PR6 brief: the client sends an owner INTENT
 * (`bundle_add_on`, `exclude_add_on`, ...), never a raw `ruleType`,
 * `params`, or `priority` — `ownerCatalogRules.server.ts` maps intent onto
 * the six landed types via `catalogRuleWriteSchema`.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  adminSalon: null as null | { id: string; slug: string },
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon: vi.fn(async () => {
    if (holder.adminSalon) {
      return { salon: holder.adminSalon, error: null };
    }
    return { salon: null, error: new Response(null, { status: 401 }) };
  }),
}));

/* eslint-disable import/first */
import { GET, POST } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_rule_route';
const SALON_SLUG = 'rule-route-salon';
const OTHER_SALON_ID = 'salon_rule_route_other';

const SERVICE_ID = 'svc_rule_route';
const FOREIGN_SERVICE_ID = 'svc_rule_route_foreign';
const INACTIVE_SERVICE_ID = 'svc_rule_route_inactive';
const ADD_ON_A = 'addon_rule_route_a';
const ADD_ON_B = 'addon_rule_route_b';
const FOREIGN_ADD_ON = 'addon_rule_route_foreign';
const INACTIVE_ADD_ON = 'addon_rule_route_inactive';
const CAPABILITY_ID = 'cap_rule_route';
const FOREIGN_CAPABILITY_ID = 'cap_rule_route_foreign';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

function getRequest(salonSlug: string): Request {
  return new Request(`http://localhost/api/salon/catalog-rules?salonSlug=${salonSlug}`);
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/salon/catalog-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Rule Route Salon', slug: SALON_SLUG, settings: {} },
    { id: OTHER_SALON_ID, name: 'Other Salon', slug: 'rule-route-other', settings: {} },
  ]);
  await db.insert(schema.serviceSchema).values([
    { id: SERVICE_ID, salonId: SALON_ID, name: 'Gel Manicure', category: 'manicure', price: 4500, durationMinutes: 60, isActive: true },
    { id: INACTIVE_SERVICE_ID, salonId: SALON_ID, name: 'Retired Service', category: 'manicure', price: 4500, durationMinutes: 60, isActive: false },
    { id: FOREIGN_SERVICE_ID, salonId: OTHER_SALON_ID, name: 'Foreign', category: 'manicure', price: 1000, durationMinutes: 30, isActive: true },
  ]);
  await db.insert(schema.addOnSchema).values([
    { id: ADD_ON_A, salonId: SALON_ID, name: 'Chrome', slug: 'chrome-rule', category: 'nail_art', priceCents: 500, durationMinutes: 10, isActive: true },
    { id: ADD_ON_B, salonId: SALON_ID, name: 'Gems', slug: 'gems-rule', category: 'nail_art', priceCents: 700, durationMinutes: 15, isActive: true },
    { id: INACTIVE_ADD_ON, salonId: SALON_ID, name: 'Retired Add-on', slug: 'retired-rule', category: 'nail_art', priceCents: 100, durationMinutes: 5, isActive: false },
    { id: FOREIGN_ADD_ON, salonId: OTHER_SALON_ID, name: 'Foreign', slug: 'foreign-rule', category: 'nail_art', priceCents: 500, durationMinutes: 10, isActive: true },
  ]);
  await db.insert(schema.capabilitySchema).values([
    { id: CAPABILITY_ID, salonId: SALON_ID, slug: 'ombre-rule', name: 'Ombre' },
    { id: FOREIGN_CAPABILITY_ID, salonId: OTHER_SALON_ID, slug: 'foreign-rule', name: 'Foreign' },
  ]);
}, 60_000);

beforeEach(async () => {
  holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
  await db.delete(schema.catalogRuleSchema);
});

afterAll(async () => {
  await client.close();
});

describe('GET /api/salon/catalog-rules', () => {
  it('rejects unauthenticated callers', async () => {
    holder.adminSalon = null;
    const response = await GET(getRequest(SALON_SLUG));

    expect(response.status).toBe(401);
  });
});

describe('POST /api/salon/catalog-rules — auth and tenancy', () => {
  it('rejects unauthenticated callers and creates nothing', async () => {
    holder.adminSalon = null;
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'exclude_add_on',
      subjectKind: 'addOn',
      subjectId: ADD_ON_A,
      addOnId: ADD_ON_B,
    }));
    const rows = await db.select().from(schema.catalogRuleSchema);

    expect(response.status).toBe(401);
    expect(rows).toHaveLength(0);
  });

  it('rejects a cross-tenant subject', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'exclude_add_on',
      subjectKind: 'service',
      subjectId: FOREIGN_SERVICE_ID,
      addOnId: ADD_ON_A,
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_RULE_REFERENCE');
  });

  it('rejects a cross-tenant object add-on', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'exclude_add_on',
      subjectKind: 'service',
      subjectId: SERVICE_ID,
      addOnId: FOREIGN_ADD_ON,
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_RULE_REFERENCE');
  });

  it('rejects a cross-tenant capability', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'require_capability',
      subjectKind: 'service',
      subjectId: SERVICE_ID,
      capabilityId: FOREIGN_CAPABILITY_ID,
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_RULE_REFERENCE');
  });

  it('rejects an inactive subject service', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'exclude_add_on',
      subjectKind: 'service',
      subjectId: INACTIVE_SERVICE_ID,
      addOnId: ADD_ON_A,
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_RULE_REFERENCE');
  });

  it('rejects an inactive object add-on', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'exclude_add_on',
      subjectKind: 'service',
      subjectId: SERVICE_ID,
      addOnId: INACTIVE_ADD_ON,
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_RULE_REFERENCE');
  });

  it('rejects an unknown subject id', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'exclude_add_on',
      subjectKind: 'service',
      subjectId: 'svc_does_not_exist',
      addOnId: ADD_ON_A,
    }));

    expect(response.status).toBe(400);
  });
});

describe('POST /api/salon/catalog-rules — never accepts raw ruleType/params/priority', () => {
  it('ignores a client-sent ruleType/params/priority and maps from intent instead', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'exclude_add_on',
      subjectKind: 'service',
      subjectId: SERVICE_ID,
      addOnId: ADD_ON_A,
      // Attempted injection — none of these fields exist on the intent
      // schema, so they are simply dropped, never reaching the database.
      ruleType: 'requires_capability',
      params: { maxQuantity: 999 },
      priority: 999,
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.rule.ruleType).toBe('exclude');
    expect(body.data.rule.priority).toBe(0);
    expect(body.data.rule.params).toEqual({});
  });

  it('rejects an unrecognized intent', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'do_something_arbitrary',
      subjectKind: 'service',
      subjectId: SERVICE_ID,
      addOnId: ADD_ON_A,
    }));

    expect(response.status).toBe(400);
  });
});

describe('POST /api/salon/catalog-rules — the six rule types', () => {
  it('bundle_add_on → include, with autoAdd carried into params', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'bundle_add_on',
      subjectKind: 'service',
      subjectId: SERVICE_ID,
      addOnId: ADD_ON_A,
      autoAdd: true,
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.rule).toMatchObject({
      ruleType: 'include',
      subjectServiceId: SERVICE_ID,
      objectAddOnId: ADD_ON_A,
      capabilityId: null,
      params: { autoAdd: true },
    });
  });

  it('exclude_add_on → exclude', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'exclude_add_on',
      subjectKind: 'addOn',
      subjectId: ADD_ON_A,
      addOnId: ADD_ON_B,
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.rule).toMatchObject({ ruleType: 'exclude', subjectAddOnId: ADD_ON_A, objectAddOnId: ADD_ON_B });
  });

  it('require_add_on → requires', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'require_add_on',
      subjectKind: 'service',
      subjectId: SERVICE_ID,
      addOnId: ADD_ON_A,
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.rule.ruleType).toBe('requires');
  });

  it('prevent_combination → mutually_exclusive', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'prevent_combination',
      subjectKind: 'addOn',
      subjectId: ADD_ON_A,
      addOnId: ADD_ON_B,
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.rule.ruleType).toBe('mutually_exclusive');
  });

  it('limit_add_on_quantity → max_quantity, with maxQuantity carried into params', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'limit_add_on_quantity',
      subjectKind: 'service',
      subjectId: SERVICE_ID,
      addOnId: ADD_ON_A,
      maxQuantity: 3,
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.rule).toMatchObject({ ruleType: 'max_quantity', params: { maxQuantity: 3 } });
  });

  it('limit_add_on_quantity requires maxQuantity', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'limit_add_on_quantity',
      subjectKind: 'service',
      subjectId: SERVICE_ID,
      addOnId: ADD_ON_A,
    }));

    expect(response.status).toBe(400);
  });

  it('require_capability → requires_capability, with no objectAddOnId', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'require_capability',
      subjectKind: 'service',
      subjectId: SERVICE_ID,
      capabilityId: CAPABILITY_ID,
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.rule).toMatchObject({ ruleType: 'requires_capability', capabilityId: CAPABILITY_ID, objectAddOnId: null });
  });

  it('rejects an add-on pointed at itself (no self-pairing)', async () => {
    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'exclude_add_on',
      subjectKind: 'addOn',
      subjectId: ADD_ON_A,
      addOnId: ADD_ON_A,
    }));

    expect(response.status).toBe(400);
  });
});

describe('POST /api/salon/catalog-rules — auto-add cycle rejection', () => {
  it('rejects a bundling rule that would create a 2-cycle between two add-ons', async () => {
    const first = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'bundle_add_on',
      subjectKind: 'addOn',
      subjectId: ADD_ON_A,
      addOnId: ADD_ON_B,
      autoAdd: true,
    }));

    expect(first.status).toBe(201);

    const second = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'bundle_add_on',
      subjectKind: 'addOn',
      subjectId: ADD_ON_B,
      addOnId: ADD_ON_A,
      autoAdd: true,
    }));
    const secondBody = await second.json();

    expect(second.status).toBe(409);
    expect(secondBody.error.code).toBe('CYCLIC_AUTO_ADD');

    // The cycle-forming rule was never persisted.
    const rows = await db.select().from(schema.catalogRuleSchema);

    expect(rows).toHaveLength(1);
  });

  it('does NOT reject the identical add-on pair when autoAdd is false (no edge, no cycle)', async () => {
    await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'bundle_add_on',
      subjectKind: 'addOn',
      subjectId: ADD_ON_A,
      addOnId: ADD_ON_B,
      autoAdd: false,
    }));

    const response = await POST(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'bundle_add_on',
      subjectKind: 'addOn',
      subjectId: ADD_ON_B,
      addOnId: ADD_ON_A,
      autoAdd: false,
    }));

    expect(response.status).toBe(201);
  });
});
