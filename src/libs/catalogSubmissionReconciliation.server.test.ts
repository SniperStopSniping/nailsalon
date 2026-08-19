import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

/* eslint-disable import/first */
import {
  makeFixtureAddOn,
  makeFixtureBinding,
  makeFixtureService,
} from '@/libs/catalogResolverFixtures';
import type { SalonFeatures } from '@/types/salonPolicy';

import {
  type CatalogConflictPayload,
  reconcileCatalogSelection,
} from './catalogSubmissionReconciliation.server';
/* eslint-enable import/first */

/**
 * Luster L1 PR4 — §13 tests. Real PGlite integration, mirroring the exact
 * pattern `catalogResolver.server.test.ts` (PR3) already established. Covers
 * every §21 requirement for this section: material match, material
 * mismatch, revision-changed/material-identical PROCEEDS, the public-safe
 * conflict payload shape (with an inline denylist/allowlist privacy proof,
 * since `catalogPublicDtoBoundary.test.ts` — a PR3-owned, frozen file —
 * intentionally scans only `PublicCatalogSnapshot`, not this module's new
 * conflict-response shape), stable anchors, and zero side effects on
 * mismatch (this module performs no writes at all — proven structurally,
 * not just by absence of assertions, via the "no write capability" test
 * below).
 */

let client: PGlite;
let db: PgliteDatabase<typeof schema>;

const GATED_SALON_ID = 'salon_reconcile_gated';
const LEGACY_SALON_ID = 'salon_reconcile_legacy';
const SERVICE_ID = 'svc_reconcile';
const ADD_ON_ID = 'addon_reconcile';

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    {
      id: GATED_SALON_ID,
      name: 'Gated Salon',
      slug: 'reconcile-gated-salon',
      settings: { booking: { currency: 'USD' } },
      // The dark L1 feature key, set directly on a FIXTURE salon only — no
      // preset or UI path in this codebase can ever do this for a real
      // salon (see `l1CatalogFeatureKeys.test.ts`).
      features: { catalog: { variantsV1: true, addOnGroupsV1: false, bookingModesV1: false } },
    },
    {
      id: LEGACY_SALON_ID,
      name: 'Legacy Salon',
      slug: 'reconcile-legacy-salon',
      settings: {},
      features: null,
    },
  ]);

  // `service.id` / `add_on.id` are GLOBAL primary keys, not salon-scoped —
  // only the GATED salon needs real rows at all: `not_applicable` for the
  // legacy salon is decided purely from `resolveCatalogDomainView(features)`,
  // with no catalog-table read whatsoever (proven by the "no DB read needed"
  // test below), so the legacy salon deliberately has none.
  await db.insert(schema.serviceSchema).values([
    makeFixtureService({ id: SERVICE_ID, salonId: GATED_SALON_ID, price: 5000, durationMinutes: 45 }),
  ]);
  await db.insert(schema.addOnSchema).values([
    makeFixtureAddOn({ id: ADD_ON_ID, salonId: GATED_SALON_ID, priceCents: 1000, durationMinutes: 10 }),
  ]);
  await db.insert(schema.serviceAddOnSchema).values([
    makeFixtureBinding({ id: 'sao_reconcile_gated', salonId: GATED_SALON_ID, serviceId: SERVICE_ID, addOnId: ADD_ON_ID }),
  ]);
}, 60_000);

afterAll(async () => {
  await client.close();
});

async function fetchFeatures(salonId: string): Promise<SalonFeatures | null | undefined> {
  const [row] = await db.select({ features: schema.salonSchema.features }).from(schema.salonSchema)
    .where(eq(schema.salonSchema.id, salonId));
  return row?.features as SalonFeatures | null | undefined;
}

describe('reconcileCatalogSelection — gating', () => {
  it('is not_applicable for a legacy (gate-off) salon — no DB read of catalog_rule/add_on_group needed to know that', async () => {
    const features = await fetchFeatures(LEGACY_SALON_ID);

    const outcome = await reconcileCatalogSelection({
      salonId: LEGACY_SALON_ID,
      features,
      selection: { serviceId: SERVICE_ID, selectedAddOns: [] },
    });

    expect(outcome).toEqual({ status: 'not_applicable' });
  });

  it('is not_applicable when the request has no single resolvable base service (legacy multi-service basket)', async () => {
    const features = await fetchFeatures(GATED_SALON_ID);

    const outcome = await reconcileCatalogSelection({
      salonId: GATED_SALON_ID,
      features,
      selection: null,
    });

    expect(outcome).toEqual({ status: 'not_applicable' });
  });
});

describe('reconcileCatalogSelection — material match / mismatch (gated salon)', () => {
  it('MATERIAL MATCH: proceeds (status: ok) with no acknowledgment supplied', async () => {
    const features = await fetchFeatures(GATED_SALON_ID);

    const outcome = await reconcileCatalogSelection({
      salonId: GATED_SALON_ID,
      features,
      selection: { serviceId: SERVICE_ID, selectedAddOns: [{ addOnId: ADD_ON_ID, quantity: 1 }] },
    });

    expect(outcome.status).toBe('ok');

    if (outcome.status === 'ok') {
      expect(outcome.resolution.subtotalCents).toBe(6000);
      expect(outcome.resolutionFingerprint).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('MATERIAL MATCH: proceeds when the client acknowledgment fingerprint agrees with the fresh one', async () => {
    const features = await fetchFeatures(GATED_SALON_ID);
    const selection = { serviceId: SERVICE_ID, selectedAddOns: [{ addOnId: ADD_ON_ID, quantity: 1 }] };

    const first = await reconcileCatalogSelection({ salonId: GATED_SALON_ID, features, selection });
    if (first.status !== 'ok') {
      throw new Error('expected ok');
    }

    const second = await reconcileCatalogSelection({
      salonId: GATED_SALON_ID,
      features,
      selection,
      clientAcknowledgment: { serviceId: SERVICE_ID, resolutionFingerprint: first.resolutionFingerprint },
    });

    expect(second.status).toBe('ok');
  });

  it('MATERIAL MISMATCH: a stale acknowledgment fingerprint returns a conflict, reason "material_change"', async () => {
    const features = await fetchFeatures(GATED_SALON_ID);

    const outcome = await reconcileCatalogSelection({
      salonId: GATED_SALON_ID,
      features,
      selection: { serviceId: SERVICE_ID, selectedAddOns: [{ addOnId: ADD_ON_ID, quantity: 1 }] },
      clientAcknowledgment: { serviceId: SERVICE_ID, resolutionFingerprint: 'stale-fingerprint-the-client-saw-earlier' },
    });

    expect(outcome.status).toBe('conflict');

    if (outcome.status === 'conflict') {
      expect(outcome.payload.reason).toBe('material_change');
      expect(outcome.payload.resolutionFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(outcome.payload.resolutionFingerprint).not.toBe('stale-fingerprint-the-client-saw-earlier');
    }
  });

  it('SELECTION INVALID: a quantity above the effective ceiling is a conflict, reason "selection_invalid", even with no acknowledgment at all', async () => {
    const features = await fetchFeatures(GATED_SALON_ID);

    const outcome = await reconcileCatalogSelection({
      salonId: GATED_SALON_ID,
      features,
      // ADD_ON_ID is `fixed` pricing (see catalogResolverFixtures' default) — quantity must be exactly 1.
      selection: { serviceId: SERVICE_ID, selectedAddOns: [{ addOnId: ADD_ON_ID, quantity: 3 }] },
    });

    expect(outcome.status).toBe('conflict');

    if (outcome.status === 'conflict') {
      expect(outcome.payload.reason).toBe('selection_invalid');
      expect(outcome.payload.resolution.violations).toEqual([
        expect.objectContaining({ code: 'quantity_exceeded', anchor: { kind: 'quantity', addOnId: ADD_ON_ID } }),
      ]);
    }
  });

  it('REVISION-CHANGED / MATERIAL-IDENTICAL PROCEEDS — the single most important behaviour: an owner editing a description bumps the snapshot but must NOT block a customer mid-booking', async () => {
    const features = await fetchFeatures(GATED_SALON_ID);
    const selection = { serviceId: SERVICE_ID, selectedAddOns: [{ addOnId: ADD_ON_ID, quantity: 1 }] };

    const before = await reconcileCatalogSelection({ salonId: GATED_SALON_ID, features, selection });
    if (before.status !== 'ok') {
      throw new Error('expected ok');
    }
    const catalogRevisionBefore = before.snapshot.revision.canonical;

    // A purely presentational, non-material edit: change the service's
    // display text. This changes `revision.canonical` (part of the public
    // semantic model) but changes NOTHING in `CatalogResolutionFingerprintInput`
    // (price/duration/add-ons/confirmation mode) — see ADR 0005.
    await db.update(schema.serviceSchema)
      .set({ priceDisplayText: 'Now with a friendlier description!' })
      .where(eq(schema.serviceSchema.id, SERVICE_ID));

    const after = await reconcileCatalogSelection({
      salonId: GATED_SALON_ID,
      features,
      selection,
      clientAcknowledgment: { serviceId: SERVICE_ID, resolutionFingerprint: before.resolutionFingerprint },
    });

    expect(after.status).toBe('ok');

    if (after.status === 'ok') {
      expect(after.snapshot.revision.canonical).not.toBe(catalogRevisionBefore);
      expect(after.resolutionFingerprint).toBe(before.resolutionFingerprint);
    }

    // Clean up for later tests in this file.
    await db.update(schema.serviceSchema).set({ priceDisplayText: null })
      .where(eq(schema.serviceSchema.id, SERVICE_ID));
  });
});

// =============================================================================
// §17 — capability privacy. `reconcileCatalogSelection` calls
// `resolveCatalogSelectionForSalon` (PR3, `catalogResolver.server.ts`), which
// alone reads `technician_capability` / `catalog_rule` capability rows and
// narrows them to a boolean before the DB-free core ever sees them. This
// proves that end to end through THIS module's own public outcome, not just
// through PR3's own tests.
// =============================================================================

describe('reconcileCatalogSelection — capability composition and privacy (§17)', () => {
  const CAPABILITY_SERVICE_ID = 'svc_reconcile_capability';
  const CAPABILITY_ID = 'capability_reconcile_secret_id';
  const TECH_WITH_ID = 'tech_reconcile_with_skill';
  const TECH_WITHOUT_ID = 'tech_reconcile_without_skill';

  beforeAll(async () => {
    await db.insert(schema.serviceSchema).values([
      makeFixtureService({
        id: CAPABILITY_SERVICE_ID,
        salonId: GATED_SALON_ID,
        name: 'Ombré Nail Art',
        slug: 'ombre-nail-art-reconcile',
        price: 7000,
        durationMinutes: 60,
      }),
    ]);
    await db.insert(schema.technicianSchema).values([
      { id: TECH_WITH_ID, salonId: GATED_SALON_ID, name: 'Tech With Skill' },
      { id: TECH_WITHOUT_ID, salonId: GATED_SALON_ID, name: 'Tech Without Skill' },
    ]);
    await db.insert(schema.capabilitySchema).values([
      { id: CAPABILITY_ID, salonId: GATED_SALON_ID, slug: 'ombre-specialist', name: 'Ombré Specialist' },
    ]);
    await db.insert(schema.technicianCapabilitySchema).values([
      { id: 'tc_reconcile_1', salonId: GATED_SALON_ID, technicianId: TECH_WITH_ID, capabilityId: CAPABILITY_ID },
    ]);
    await db.insert(schema.catalogRuleSchema).values([
      {
        id: 'rule_reconcile_capability',
        salonId: GATED_SALON_ID,
        serviceId: null,
        ruleType: 'requires_capability',
        subjectServiceId: CAPABILITY_SERVICE_ID,
        subjectAddOnId: null,
        objectAddOnId: null,
        capabilityId: CAPABILITY_ID,
        params: {},
        priority: 0,
        isActive: true,
        note: null,
      },
    ]);
  }, 30_000);

  it('SAFE COMPOSITION: a technician WITHOUT the required capability is a conflict (selection_invalid, capability_unavailable)', async () => {
    const features = await fetchFeatures(GATED_SALON_ID);

    const outcome = await reconcileCatalogSelection({
      salonId: GATED_SALON_ID,
      features,
      selection: { serviceId: CAPABILITY_SERVICE_ID, technicianId: TECH_WITHOUT_ID, selectedAddOns: [] },
    });

    expect(outcome.status).toBe('conflict');

    if (outcome.status === 'conflict') {
      expect(outcome.payload.reason).toBe('selection_invalid');
      expect(outcome.payload.resolution.violations).toEqual([
        expect.objectContaining({ code: 'capability_unavailable' }),
      ]);
    }
  });

  it('SAFE ELIGIBILITY: a technician WITH the required capability proceeds', async () => {
    const features = await fetchFeatures(GATED_SALON_ID);

    const outcome = await reconcileCatalogSelection({
      salonId: GATED_SALON_ID,
      features,
      selection: { serviceId: CAPABILITY_SERVICE_ID, technicianId: TECH_WITH_ID, selectedAddOns: [] },
    });

    expect(outcome.status).toBe('ok');
  });

  it('NO PUBLIC CAPABILITY IDS: neither outcome — ineligible or eligible — ever serializes the capability id or the internal rule id', async () => {
    const features = await fetchFeatures(GATED_SALON_ID);

    const ineligible = await reconcileCatalogSelection({
      salonId: GATED_SALON_ID,
      features,
      selection: { serviceId: CAPABILITY_SERVICE_ID, technicianId: TECH_WITHOUT_ID, selectedAddOns: [] },
    });
    const eligible = await reconcileCatalogSelection({
      salonId: GATED_SALON_ID,
      features,
      selection: { serviceId: CAPABILITY_SERVICE_ID, technicianId: TECH_WITH_ID, selectedAddOns: [] },
    });

    for (const outcome of [ineligible, eligible]) {
      const serialized = JSON.stringify(outcome);

      expect(serialized).not.toContain(CAPABILITY_ID);
      expect(serialized).not.toContain('rule_reconcile_capability');
      expect(serialized).not.toContain('capabilityId');
    }
  });
});

describe('reconcileCatalogSelection — public-safe conflict payload (privacy proof)', () => {
  const FORBIDDEN_KEYS = new Set([
    'ruleId',
    'priority',
    'note',
    'notes',
    'internalNote',
    'internalNotes',
    'capabilityId',
    'params',
    'rawParams',
    'salonId',
    'tenantId',
    'auditId',
    'depositId',
    'paymentIntentId',
    'stripeCustomerId',
    'stripeAccountId',
  ]);

  function collectForbiddenKeyPaths(value: unknown, keyPath = '$'): string[] {
    if (value === null || typeof value !== 'object' || value instanceof Date) {
      return [];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item, index) => collectForbiddenKeyPaths(item, `${keyPath}[${index}]`));
    }
    const found: string[] = [];
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = `${keyPath}.${key}`;
      if (FORBIDDEN_KEYS.has(key)) {
        found.push(childPath);
      }
      found.push(...collectForbiddenKeyPaths(child, childPath));
    }
    return found;
  }

  it('non-vacuous: the scanner actually catches an injected forbidden field', () => {
    const poisoned = { resolution: { violations: [{ code: 'x', capabilityId: 'cap_secret' }] } };

    expect(collectForbiddenKeyPaths(poisoned)).toContain('$.resolution.violations[0].capabilityId');
  });

  it('a real conflict payload (material_change) carries none of the forbidden fields, anywhere', async () => {
    const features = await fetchFeatures(GATED_SALON_ID);

    const outcome = await reconcileCatalogSelection({
      salonId: GATED_SALON_ID,
      features,
      selection: { serviceId: SERVICE_ID, selectedAddOns: [{ addOnId: ADD_ON_ID, quantity: 1 }] },
      clientAcknowledgment: { serviceId: SERVICE_ID, resolutionFingerprint: 'definitely-stale' },
    });

    expect(outcome.status).toBe('conflict');

    if (outcome.status !== 'conflict') {
      throw new Error('expected conflict');
    }

    const offenders = collectForbiddenKeyPaths(outcome.payload as unknown);

    expect(offenders).toEqual([]);
  });

  it('the payload carries only bounded, typed reason/recovery metadata — never free text', async () => {
    const features = await fetchFeatures(GATED_SALON_ID);

    const outcome = await reconcileCatalogSelection({
      salonId: GATED_SALON_ID,
      features,
      selection: { serviceId: SERVICE_ID, selectedAddOns: [{ addOnId: ADD_ON_ID, quantity: 1 }] },
      clientAcknowledgment: { serviceId: SERVICE_ID, resolutionFingerprint: 'definitely-stale' },
    });
    if (outcome.status !== 'conflict') {
      throw new Error('expected conflict');
    }

    const payload: CatalogConflictPayload = outcome.payload;

    expect(['material_change', 'selection_invalid']).toContain(payload.reason);
    expect(payload.recovery).toBe('reload_catalog_and_reselect');
  });

  it('violation anchors are stable semantic identifiers, never positional array indices', async () => {
    const features = await fetchFeatures(GATED_SALON_ID);

    const outcome = await reconcileCatalogSelection({
      salonId: GATED_SALON_ID,
      features,
      selection: { serviceId: SERVICE_ID, selectedAddOns: [{ addOnId: ADD_ON_ID, quantity: 3 }] },
    });
    if (outcome.status !== 'conflict') {
      throw new Error('expected conflict');
    }

    for (const violation of outcome.payload.resolution.violations) {
      expect(violation.anchor).not.toHaveProperty('index');
      expect(typeof violation.anchor.kind).toBe('string');
    }
  });
});

describe('reconcileCatalogSelection — zero side effects', () => {
  it('this module never imports a write-capable DB handle: no `db.insert`/`db.update`/`db.delete` call anywhere in its source', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/libs/catalogSubmissionReconciliation.server.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/\bdb\.(insert|update|delete)\s*\(/);
    expect(source).not.toContain('@/libs/DB');
  });
});
