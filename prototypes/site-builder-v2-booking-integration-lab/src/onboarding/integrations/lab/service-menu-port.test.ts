import { CANONICAL_SERVICES, MOCK_ADD_ONS } from '../../../booking/data';
import {
  ADD_ON_PRODUCTION_MAPPINGS,
  SERVICE_MENU_PRODUCTION_MAPPINGS,
} from '../contracts/service-menu-production-mapping';
import { createLabServiceMenuPort } from './service-menu-port';

describe('Lab ServiceMenuPort', () => {
  const port = createLabServiceMenuPort();

  it('stores canonical IDs and narrow overrides instead of duplicate service records', () => {
    const draft = port.createDefaultSelection();
    const canonicalIds = new Set(CANONICAL_SERVICES.map(({ id }) => id));

    expect(port.implementation).toBe('lab-only');
    expect(draft.selectedServiceIds.length).toBeGreaterThan(0);
    expect(draft.selectedServiceIds.every((id) => canonicalIds.has(id))).toBe(true);
    expect(new Set(draft.selectedServiceIds).size).toBe(draft.selectedServiceIds.length);
    expect(draft.ownerOverridesByServiceId).toEqual({});
    expect(JSON.stringify(draft)).not.toMatch(/Russian Manicure|durationLabel|priceLabel/u);
    expect(port.getSelectedServices(draft).every(({ popular }) => popular)).toBe(true);
  });

  it('adds, removes, de-duplicates, and rejects unknown IDs', () => {
    const initial = port.createDefaultSelection();
    const unselected = port.getLibraryServices().find(
      ({ id }) => !initial.selectedServiceIds.includes(id),
    );
    expect(unselected).toBeDefined();

    const added = port.setServiceSelected(initial, unselected!.id, true);
    expect(added.selectedServiceIds).toContain(unselected!.id);
    const addedAgain = port.setServiceSelected(added, unselected!.id, true);
    expect(addedAgain.selectedServiceIds).toEqual(added.selectedServiceIds);

    const removed = port.setServiceSelected(addedAgain, unselected!.id, false);
    expect(removed.selectedServiceIds).not.toContain(unselected!.id);
    expect(port.setServiceSelected(removed, 'not-a-canonical-service', true))
      .toEqual(removed);
  });

  it('has an explicit future Production mapping for every canonical Lab ID', () => {
    expect(SERVICE_MENU_PRODUCTION_MAPPINGS.map(({ labServiceId }) => labServiceId))
      .toEqual(CANONICAL_SERVICES.map(({ id }) => id));
    expect(SERVICE_MENU_PRODUCTION_MAPPINGS.every(
      ({ futureOwnerServiceOperation, productionCanonicalId }) =>
        Boolean(futureOwnerServiceOperation && productionCanonicalId),
    )).toBe(true);
    expect(ADD_ON_PRODUCTION_MAPPINGS.map(({ labServiceId }) => labServiceId))
      .toEqual(MOCK_ADD_ONS.map(({ id }) => id));
  });

  it('keeps add-ons distinct and stores canonical add-on IDs only', () => {
    const initial = port.createDefaultSelection();
    const firstAddOn = port.getLibraryAddOns()[0]!;
    const expectedDefaultIds = MOCK_ADD_ONS.map(({ id }) => id);
    const removed = port.setAddOnSelected(initial, firstAddOn.id, false);
    const restored = port.setAddOnSelected(removed, firstAddOn.id, true);

    expect(firstAddOn.itemKind).toBe('add_on');
    expect(initial.selectedAddOnIds).toEqual(expectedDefaultIds);
    expect(port.getSelectedAddOns(initial)).toHaveLength(4);
    expect(removed.selectedAddOnIds).not.toContain(firstAddOn.id);
    expect(restored.selectedAddOnIds).toEqual(expectedDefaultIds);
    expect(port.setAddOnSelected(restored, firstAddOn.id, true)).toEqual(restored);
    expect(port.setAddOnSelected(restored, 'unknown-add-on', true)).toEqual(restored);
  });

  it('preserves an owner’s explicit saved add-on selection', () => {
    const initial = port.createDefaultSelection();

    expect(port.normalizeSelection({
      ...initial,
      selectedAddOnIds: ['addon-french'],
    }).selectedAddOnIds).toEqual(['addon-french']);
    expect(port.normalizeSelection({
      ...initial,
      selectedAddOnIds: [],
    }).selectedAddOnIds).toEqual([]);
  });
});
