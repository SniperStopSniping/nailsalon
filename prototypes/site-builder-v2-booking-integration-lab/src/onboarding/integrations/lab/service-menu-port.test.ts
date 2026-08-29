import { CANONICAL_SERVICES } from '../../../booking/data';
import { SERVICE_MENU_PRODUCTION_MAPPINGS } from '../contracts/service-menu-production-mapping';
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
  });
});
