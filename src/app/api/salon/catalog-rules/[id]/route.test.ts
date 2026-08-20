/**
 * PATCH/DELETE /api/salon/catalog-rules/[id]. Load-bearing: PATCH
 * re-validates the FULL rule set (including the auto-add cycle check)
 * inside its own write transaction, excluding the rule's own prior state so
 * it can be edited without tripping over itself.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
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
import { POST as createRule } from '../route';
import { DELETE, PATCH } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_rule_id_route';
const SALON_SLUG = 'rule-id-route-salon';
const OTHER_SALON_ID = 'salon_rule_id_route_other';
const SERVICE_ID = 'svc_rule_id_route';
const ADD_ON_A = 'addon_rule_id_route_a';
const ADD_ON_B = 'addon_rule_id_route_b';
const ADD_ON_C = 'addon_rule_id_route_c';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

function patchRequest(id: string, body: unknown): [Request, { params: { id: string } }] {
  return [
    new Request(`http://localhost/api/salon/catalog-rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: { id } },
  ];
}

function deleteRequest(id: string, salonSlug: string): [Request, { params: { id: string } }] {
  return [
    new Request(`http://localhost/api/salon/catalog-rules/${id}?salonSlug=${salonSlug}`, { method: 'DELETE' }),
    { params: { id } },
  ];
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
    { id: SALON_ID, name: 'Rule Id Route Salon', slug: SALON_SLUG, settings: {} },
    { id: OTHER_SALON_ID, name: 'Other Salon', slug: 'rule-id-route-other', settings: {} },
  ]);
  await db.insert(schema.serviceSchema).values({ id: SERVICE_ID, salonId: SALON_ID, name: 'Gel', category: 'manicure', price: 100, durationMinutes: 30, isActive: true });
  await db.insert(schema.addOnSchema).values([
    { id: ADD_ON_A, salonId: SALON_ID, name: 'A', slug: 'a-rule-id', category: 'nail_art', priceCents: 100, durationMinutes: 5, isActive: true },
    { id: ADD_ON_B, salonId: SALON_ID, name: 'B', slug: 'b-rule-id', category: 'nail_art', priceCents: 100, durationMinutes: 5, isActive: true },
    { id: ADD_ON_C, salonId: SALON_ID, name: 'C', slug: 'c-rule-id', category: 'nail_art', priceCents: 100, durationMinutes: 5, isActive: true },
  ]);
}, 60_000);

beforeEach(async () => {
  holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
  await db.delete(schema.catalogRuleSchema);
});

afterAll(async () => {
  await client.close();
});

async function createExcludeRule() {
  const response = await createRule(postRequest({
    salonSlug: SALON_SLUG,
    intent: 'exclude_add_on',
    subjectKind: 'addOn',
    subjectId: ADD_ON_A,
    addOnId: ADD_ON_B,
  }));
  const body = await response.json();
  return body.data.rule.id as string;
}

describe('PATCH /api/salon/catalog-rules/[id]', () => {
  it('rejects unauthenticated callers and leaves the row unchanged', async () => {
    const ruleId = await createExcludeRule();
    holder.adminSalon = null;

    const response = await PATCH(...patchRequest(ruleId, {
      salonSlug: SALON_SLUG,
      intent: 'require_add_on',
      subjectKind: 'addOn',
      subjectId: ADD_ON_A,
      addOnId: ADD_ON_B,
    }));
    const [row] = await db.select().from(schema.catalogRuleSchema).where(eq(schema.catalogRuleSchema.id, ruleId));

    expect(response.status).toBe(401);
    expect(row!.ruleType).toBe('exclude');
  });

  it('re-expresses a rule as a different intent', async () => {
    const ruleId = await createExcludeRule();

    const response = await PATCH(...patchRequest(ruleId, {
      salonSlug: SALON_SLUG,
      intent: 'require_add_on',
      subjectKind: 'addOn',
      subjectId: ADD_ON_A,
      addOnId: ADD_ON_B,
      note: 'now required',
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.rule).toMatchObject({ ruleType: 'requires', note: 'now required' });
  });

  it('cannot edit another salon’s rule', async () => {
    const ruleId = await createExcludeRule();
    holder.adminSalon = { id: OTHER_SALON_ID, slug: 'rule-id-route-other' };

    const response = await PATCH(...patchRequest(ruleId, {
      salonSlug: 'rule-id-route-other',
      intent: 'require_add_on',
      subjectKind: 'addOn',
      subjectId: ADD_ON_A,
      addOnId: ADD_ON_B,
    }));

    expect(response.status).toBe(404);
  });

  it('re-validates the auto-add graph, excluding its own prior state', async () => {
    // A -> B autoAdd, kept as-is via PATCH: must NOT be rejected as a
    // self-cycle just because the rule's own prior edge is still "there"
    // from the database's point of view before the write.
    const createResponse = await createRule(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'bundle_add_on',
      subjectKind: 'addOn',
      subjectId: ADD_ON_A,
      addOnId: ADD_ON_B,
      autoAdd: true,
    }));
    const created = (await createResponse.json()).data.rule.id as string;

    const response = await PATCH(...patchRequest(created, {
      salonSlug: SALON_SLUG,
      intent: 'bundle_add_on',
      subjectKind: 'addOn',
      subjectId: ADD_ON_A,
      addOnId: ADD_ON_B,
      autoAdd: true,
      note: 'unchanged',
    }));

    expect(response.status).toBe(200);
  });

  it('rejects a PATCH that would introduce a real cycle', async () => {
    // A -> B autoAdd (existing, untouched), then edit a DIFFERENT rule
    // (B -> C) into A -> B's partner to form B -> A, closing the loop.
    await createRule(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'bundle_add_on',
      subjectKind: 'addOn',
      subjectId: ADD_ON_A,
      addOnId: ADD_ON_B,
      autoAdd: true,
    }));
    const otherResponse = await createRule(postRequest({
      salonSlug: SALON_SLUG,
      intent: 'bundle_add_on',
      subjectKind: 'addOn',
      subjectId: ADD_ON_B,
      addOnId: ADD_ON_C,
      autoAdd: true,
    }));
    const otherId = (await otherResponse.json()).data.rule.id as string;

    const response = await PATCH(...patchRequest(otherId, {
      salonSlug: SALON_SLUG,
      intent: 'bundle_add_on',
      subjectKind: 'addOn',
      subjectId: ADD_ON_B,
      addOnId: ADD_ON_A,
      autoAdd: true,
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('CYCLIC_AUTO_ADD');
  });
});

describe('DELETE /api/salon/catalog-rules/[id]', () => {
  it('rejects unauthenticated callers', async () => {
    const ruleId = await createExcludeRule();
    holder.adminSalon = null;
    const response = await DELETE(...deleteRequest(ruleId, SALON_SLUG));

    expect(response.status).toBe(401);
  });

  it('deletes the rule', async () => {
    const ruleId = await createExcludeRule();
    const response = await DELETE(...deleteRequest(ruleId, SALON_SLUG));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.deleted).toBe(true);

    const rows = await db.select().from(schema.catalogRuleSchema).where(eq(schema.catalogRuleSchema.id, ruleId));

    expect(rows).toHaveLength(0);
  });

  it('cannot delete another salon’s rule', async () => {
    const ruleId = await createExcludeRule();
    holder.adminSalon = { id: OTHER_SALON_ID, slug: 'rule-id-route-other' };

    const response = await DELETE(...deleteRequest(ruleId, 'rule-id-route-other'));

    expect(response.status).toBe(404);

    holder.adminSalon = { id: SALON_ID, slug: SALON_SLUG };
    const rows = await db.select().from(schema.catalogRuleSchema).where(eq(schema.catalogRuleSchema.id, ruleId));

    expect(rows).toHaveLength(1);
  });
});
