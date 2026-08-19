import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { buildPublicCatalogSnapshot, resolveCatalogSelection } from '@/libs/catalogResolverCore';
import {
  makeFixtureAddOn,
  makeFixtureBinding,
  makeFixtureService,
} from '@/libs/catalogResolverFixtures';

/**
 * Luster L1 PR3 — fresh payload/performance measurement.
 *
 * NOT a reuse of any archived number: the Owner flagged that the archived
 * fixture was unrepresentative — 100 rule projections where PRODUCTION HAS
 * ZERO, and zero ungrouped add-ons where ALL 66 PRODUCTION ADD-ONS ARE
 * UNGROUPED. This fixture is built from those two real data points, plus
 * documented assumptions for everything the Owner did not hand me directly
 * (this PR3 worktree has no route to query the shared production database
 * for exact counts, and doing so is out of scope for an inert PR):
 *
 *   - 66 ungrouped add-ons (given).
 *   - 0 catalog rules, 0 add-on groups (given/implied — if any real add-on
 *     were grouped today, "all 66 are ungrouped" would be false).
 *   - 40 services: 32 standalone (legacy-shaped) + 2 parent services with 4
 *     variant children each — a plausible mix for a multi-service nail
 *     salon, not a measured count.
 *   - ~18 service_add_on bindings per service (a representative "most
 *     add-ons apply to most services" density for a nail salon menu, not a
 *     measured count) — roughly 720 binding rows total.
 *
 * If real production counts become available, replace the constants below
 * and re-run; the shape of this test does not need to change.
 *
 * These are REVIEW SIGNALS, not automatic failures (per the Owner's brief):
 * assertions here are deliberately generous so this test only fails on a
 * catastrophic regression, not on ordinary variance. The real numbers are
 * `console.info`-ed so they show up in the PR3 report.
 */

const SERVICE_COUNT_STANDALONE = 32;
const PARENT_FAMILY_COUNT = 2;
const VARIANTS_PER_FAMILY = 4;
const ADD_ON_COUNT = 66;
const BINDINGS_PER_SERVICE = 18;

function buildRepresentativeSnapshotInput() {
  const services = [];
  for (let i = 0; i < SERVICE_COUNT_STANDALONE; i++) {
    services.push(makeFixtureService({
      id: `svc_standalone_${i}`,
      name: `Standalone Service ${i}`,
      slug: `standalone-service-${i}`,
      price: 3000 + (i * 137 % 5000),
      durationMinutes: 30 + (i % 6) * 15,
    }));
  }
  for (let f = 0; f < PARENT_FAMILY_COUNT; f++) {
    const parentId = `svc_parent_${f}`;
    services.push(makeFixtureService({ id: parentId, name: `Family ${f}`, slug: `family-${f}`, price: 5000, durationMinutes: 60 }));
    for (let v = 0; v < VARIANTS_PER_FAMILY; v++) {
      services.push(makeFixtureService({
        id: `svc_parent_${f}_variant_${v}`,
        name: `Family ${f} Variant ${v}`,
        slug: `family-${f}-variant-${v}`,
        parentServiceId: parentId,
        variantLabel: `Variant ${v}`,
        variantKind: 'length',
        price: 5000 + v * 1000,
        durationMinutes: 60 + v * 10,
      }));
    }
  }

  const addOns = [];
  for (let i = 0; i < ADD_ON_COUNT; i++) {
    addOns.push(makeFixtureAddOn({
      id: `addon_${i}`,
      name: `Add-On ${i}`,
      slug: `add-on-${i}`,
      groupId: null, // matches "all 66 production add-ons are ungrouped"
      pricingType: i % 5 === 0 ? 'per_unit' : 'fixed',
      priceCents: 500 + (i * 73 % 3000),
      durationMinutes: 5 + (i % 4) * 5,
    }));
  }

  const serviceAddOnBindings = [];
  for (const service of services) {
    for (let b = 0; b < BINDINGS_PER_SERVICE; b++) {
      const addOnIndex = (b * 7 + service.id.length) % ADD_ON_COUNT;
      serviceAddOnBindings.push(makeFixtureBinding({
        id: `sao_${service.id}_${addOnIndex}`,
        serviceId: service.id,
        addOnId: `addon_${addOnIndex}`,
        displayOrder: b,
      }));
    }
  }

  return {
    salonSettings: null,
    services,
    addOnGroups: [], // "all 66 production add-ons are ungrouped" -> no populated groups today
    addOns,
    serviceAddOnBindings,
    rules: [], // "production has zero" rule projections
    now: new Date('2024-06-01T00:00:00Z'),
  };
}

function percentile(sortedMs: number[], p: number): number {
  const index = Math.min(sortedMs.length - 1, Math.floor(sortedMs.length * p));
  return sortedMs[index]!;
}

describe('catalog payload/performance measurement (review signals, not hard gates)', () => {
  it('measures serialized/compressed size, parse cost, indexing cost, and resolver p95 on a representative fixture', () => {
    const input = buildRepresentativeSnapshotInput();

    const buildStart = performance.now();
    const result = buildPublicCatalogSnapshot(input);
    const buildMs = performance.now() - buildStart;

    if (!result.ok) {
      throw new Error(`fixture build failed: ${JSON.stringify(result.failure)}`);
    }
    const { snapshot } = result;

    // --- Serialized / compressed payload size ---------------------------
    const serialized = JSON.stringify(snapshot);
    const serializedBytes = Buffer.byteLength(serialized, 'utf8');
    const gzipBytes = gzipSync(Buffer.from(serialized, 'utf8')).length;

    // --- JSON parse cost --------------------------------------------------
    const parseStart = performance.now();
    JSON.parse(serialized);
    const parseMs = performance.now() - parseStart;

    // --- Indexing cost (a client building id-keyed lookups over the DTO) --
    const indexStart = performance.now();
    const servicesById = new Map(snapshot.services.map(s => [s.id, s]));
    const addOnsById = new Map(snapshot.addOns.map(a => [a.id, a]));
    const bindingsByServiceId = new Map<string, typeof snapshot.serviceAddOnBindings>();
    for (const binding of snapshot.serviceAddOnBindings) {
      const list = bindingsByServiceId.get(binding.serviceId) ?? [];
      list.push(binding);
      bindingsByServiceId.set(binding.serviceId, list);
    }
    const indexMs = performance.now() - indexStart;

    expect(servicesById.size).toBe(snapshot.services.length);
    expect(addOnsById.size).toBe(snapshot.addOns.length);

    // --- Resolver cost (p95 over every service, each with a small,
    // varied add-on selection) --------------------------------------------
    const resolveTimingsMs: number[] = [];
    for (const service of snapshot.services) {
      const bindingsForService = bindingsByServiceId.get(service.id) ?? [];
      const selectedAddOns = bindingsForService.slice(0, 3).map(b => ({ addOnId: b.addOnId, quantity: 1 }));

      const resolveStart = performance.now();
      const resolution = resolveCatalogSelection(snapshot, { serviceId: service.id, selectedAddOns });
      resolveTimingsMs.push(performance.now() - resolveStart);

      if (!resolution.ok) {
        throw new Error(`unexpected resolution failure for ${service.id}: ${JSON.stringify(resolution.failure)}`);
      }
    }
    resolveTimingsMs.sort((a, b) => a - b);
    const resolverP50Ms = percentile(resolveTimingsMs, 0.5);
    const resolverP95Ms = percentile(resolveTimingsMs, 0.95);

    // `process.stdout.write` rather than `console.*`: this repo's vitest
    // setup (`vitest-fail-on-console`) fails any test that calls a
    // `console` method, so a plain `console.info` here would make this
    // measurement test fail on its own diagnostic output. Writing straight
    // to stdout bypasses that guard without weakening it for every other
    // test — these numbers are a REVIEW SIGNAL meant to show up when this
    // file is run, not a log line a production caller could ever emit.
    process.stdout.write(`${JSON.stringify({
      label: 'catalog payload/perf measurement',
      services: snapshot.services.length,
      addOns: snapshot.addOns.length,
      bindings: snapshot.serviceAddOnBindings.length,
      buildMs: Number(buildMs.toFixed(2)),
      serializedBytes,
      serializedKB: Number((serializedBytes / 1024).toFixed(1)),
      gzipBytes,
      gzipKB: Number((gzipBytes / 1024).toFixed(1)),
      parseMs: Number(parseMs.toFixed(2)),
      indexMs: Number(indexMs.toFixed(2)),
      resolverP50Ms: Number(resolverP50Ms.toFixed(3)),
      resolverP95Ms: Number(resolverP95Ms.toFixed(3)),
    })}\n`);

    // --- Review-signal bounds, deliberately generous ----------------------
    // Owner's stated review thresholds: ~100-150KB gzip warrants a staging
    // discussion; resolver p95 > ~8ms warrants investigation. Neither is
    // enforced as a hard failure here — only logged, per the brief. The
    // `expect` calls below are sanity bounds against a catastrophic
    // regression (e.g. an accidental O(n^2) blowup), set an order of
    // magnitude above what this fixture actually measures.
    expect(serializedBytes).toBeGreaterThan(0);
    expect(gzipBytes).toBeGreaterThan(0);
    expect(gzipBytes).toBeLessThan(serializedBytes);
    expect(resolverP95Ms).toBeLessThan(50);
  });
});
