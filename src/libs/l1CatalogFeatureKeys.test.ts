/**
 * L1 PR1 — the catalog feature keys must be registered and dark.
 *
 * "Dark" is the whole safety story of this PR: the schema exists, nothing
 * reads it, and no preset can switch it on by accident.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  APPOINTMENT_CANCELLATION_REASONS,
  CANCEL_REASONS,
  L1_REQUEST_LIFECYCLE_CANCEL_REASONS,
} from '@/models/Schema';

import { FEATURE_DEFAULTS, resolveEntitlement } from './featureEntitlements';
import { ELITE_FEATURES, PRO_FEATURES, STARTER_FEATURES } from './featureTiers';
import {
  applySalonFeaturePreset,
  DARK_CATALOG_FEATURE_KEYS,
  OPTIONAL_SALON_FEATURES,
} from './salonFeatureRegistry';

vi.mock('server-only', () => ({}));

const CATALOG_KEYS = ['variantsV1', 'addOnGroupsV1', 'bookingModesV1'] as const;

describe('catalog feature keys are registered', () => {
  it('exposes all three keys in the optional feature registry', () => {
    const registered = OPTIONAL_SALON_FEATURES
      .filter(f => f.group === 'catalog')
      .map(f => f.nestedKey)
      .sort();

    expect(registered).toEqual([...CATALOG_KEYS].sort());
  });

  it('names them as dark so no preset can enable them', () => {
    expect([...DARK_CATALOG_FEATURE_KEYS].sort())
      .toEqual(['catalogAddOnGroupsV1', 'catalogBookingModesV1', 'catalogVariantsV1']);
  });
});

describe('catalog feature keys default OFF', () => {
  it('defaults every catalog key to false', () => {
    for (const key of CATALOG_KEYS) {
      expect(FEATURE_DEFAULTS.catalog[key], key).toBe(false);
    }
  });

  it('resolves to false for a salon with no features recorded', () => {
    for (const key of CATALOG_KEYS) {
      expect(resolveEntitlement(null, 'catalog', key), key).toBe(false);
      expect(resolveEntitlement({}, 'catalog', key), key).toBe(false);
    }
  });

  it('stays off on every feature tier', () => {
    for (const tier of [STARTER_FEATURES, PRO_FEATURES, ELITE_FEATURES]) {
      for (const key of CATALOG_KEYS) {
        expect(resolveEntitlement(tier, 'catalog', key), key).toBe(false);
      }
    }
  });

  it('stays off even under the most permissive preset', () => {
    // 'all_available' is the widest preset Super Admin can apply. A dark key
    // that it could switch on would not be dark.
    const applied = applySalonFeaturePreset({}, 'all_available');

    for (const key of CATALOG_KEYS) {
      expect(resolveEntitlement(applied, 'catalog', key), key).toBe(false);
    }
  });

  it('is only reachable by explicit opt-in', () => {
    const explicit = { catalog: { variantsV1: true } };

    expect(resolveEntitlement(explicit, 'catalog', 'variantsV1')).toBe(true);
    expect(resolveEntitlement(explicit, 'catalog', 'bookingModesV1')).toBe(false);
  });
});

describe('cancellation reason vocabulary', () => {
  it('extends the existing vocabulary rather than restating it', () => {
    // Derivation, not duplication: every writable reason has exactly one
    // definition, so the two lists cannot drift apart.
    expect(APPOINTMENT_CANCELLATION_REASONS.slice(0, CANCEL_REASONS.length))
      .toEqual([...CANCEL_REASONS]);
  });

  it('adds the two L1 request-lifecycle reasons', () => {
    expect(APPOINTMENT_CANCELLATION_REASONS).toContain('declined_by_salon');
    expect(APPOINTMENT_CANCELLATION_REASONS).toContain('request_expired');
    expect(APPOINTMENT_CANCELLATION_REASONS).toHaveLength(
      CANCEL_REASONS.length + L1_REQUEST_LIFECYCLE_CANCEL_REASONS.length,
    );
  });

  it('leaves the writable API vocabulary untouched', () => {
    // CANCEL_REASONS feeds `z.enum(...)` on the appointment PATCH and cancel
    // routes. If an L1 reason leaked into it, a caller could submit
    // `request_expired` today — a live behaviour change this PR must not make.
    for (const reason of L1_REQUEST_LIFECYCLE_CANCEL_REASONS) {
      expect(CANCEL_REASONS as readonly string[]).not.toContain(reason);
    }
  });

  it('contains no duplicates and is append-only in shape', () => {
    expect(new Set(APPOINTMENT_CANCELLATION_REASONS).size)
      .toBe(APPOINTMENT_CANCELLATION_REASONS.length);
  });
});
