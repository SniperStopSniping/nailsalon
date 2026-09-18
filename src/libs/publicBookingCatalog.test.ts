import { describe, expect, it } from 'vitest';

import { buildPublicCatalogSnapshot, resolveCatalogSelection } from './catalogResolverCore';
import { makeFixtureAddOn, makeFixtureBinding, makeFixtureRule, makeFixtureService } from './catalogResolverFixtures';
import { projectPublicBookingCatalog } from './publicBookingCatalog';

describe('public bookable L1 projection', () => {
  it('removes excluded catalog material from both content and canonical revision without changing resolution', () => {
    const result = buildPublicCatalogSnapshot({
      salonSettings: null,
      services: [makeFixtureService({ id: 'public' }), makeFixtureService({ id: 'excluded', name: 'HIDDEN_SERVICE_SENTINEL' })],
      addOns: [makeFixtureAddOn({ id: 'option' }), makeFixtureAddOn({ id: 'automatic', durationMinutes: 5 }), makeFixtureAddOn({ id: 'orphan', name: 'HIDDEN_OPTION_SENTINEL' })],
      addOnGroups: [],
      serviceAddOnBindings: [makeFixtureBinding({ serviceId: 'public', addOnId: 'option' }), makeFixtureBinding({ serviceId: 'excluded', addOnId: 'orphan' })],
      rules: [makeFixtureRule({ id: 'include', ruleType: 'include', subjectServiceId: 'public', objectAddOnId: 'automatic', params: { autoAdd: true } })],
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error('Invalid synthetic fixture');
    }
    const projected = projectPublicBookingCatalog(result.snapshot, new Set(['public']));

    expect(JSON.stringify(projected)).not.toContain('HIDDEN_');

    const selection = { serviceId: 'public', selectedAddOns: [{ addOnId: 'option', quantity: 1 }] };

    expect(resolveCatalogSelection(projected, selection)).toEqual(resolveCatalogSelection(result.snapshot, selection));
  });

  it('retains a required dependency constraint even when its target is not offered', () => {
    const result = buildPublicCatalogSnapshot({
      salonSettings: null,
      services: [makeFixtureService({ id: 'public' })],
      addOns: [makeFixtureAddOn({ id: 'unoffered', name: 'UNREACHABLE_NAME' })],
      addOnGroups: [],
      serviceAddOnBindings: [],
      rules: [makeFixtureRule({ id: 'require', ruleType: 'requires', subjectServiceId: 'public', objectAddOnId: 'unoffered', params: {} })],
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error('Invalid synthetic fixture');
    }
    const projected = projectPublicBookingCatalog(result.snapshot, new Set(['public']));

    expect(JSON.stringify(projected)).not.toContain('UNREACHABLE_NAME');

    const selection = { serviceId: 'public', selectedAddOns: [] };

    expect(resolveCatalogSelection(projected, selection)).toEqual(resolveCatalogSelection(result.snapshot, selection));
    expect(resolveCatalogSelection(projected, selection)).toMatchObject({ ok: true, selection: { blocksContinue: true } });
  });
});
