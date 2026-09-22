import { describe, expect, it } from 'vitest';

import type { CustomerMenu } from './catalogue.server';
import { projectCustomerInterpreterMenu } from './interpreterMenu';

const bindingColumns = ['serviceIndex', 'addOnIndex', 'required', 'defaultQuantity', 'maxQuantity', 'priceMode'] as const;

const restoreBindings = (projected: ReturnType<typeof projectCustomerInterpreterMenu>) => projected.bindings.rows.map(row => ({
  serviceId: projected.bindings.serviceIds[row[0]],
  addOnId: projected.bindings.addOnIds[row[1]],
  required: row[2],
  defaultQuantity: row[3],
  maxQuantity: row[4],
  priceMode: row[5],
}));

describe('customer interpreter menu projection', () => {
  it('losslessly projects every binding value in original order without mutating public menu authority', () => {
    const l1 = {
      services: [{ id: 'l1-service', kind: 'service', parentServiceId: null, variantLabel: null, selectionMode: 'single' }],
      addOns: [{ id: 'l1-addon', groupId: 'group-1' }],
      addOnGroups: [{ id: 'group-1', name: 'Finishes' }],
      ruleProjections: [{ id: 'rule-1', serviceId: 'l1-service' }],
    } as unknown as NonNullable<CustomerMenu['l1']>;
    const menu: CustomerMenu = {
      l1,
      services: [{ id: 'service-a', name: 'Service A', description: 'Public description', category: 'manicure' }],
      addOns: [{ id: 'addon-a', name: 'Per nail art', description: 'Public add-on', category: 'art', pricingType: 'per_unit', maxQuantity: 0 }],
      bindings: [
        { serviceId: 'service-a', addOnId: 'addon-a', required: false, defaultQuantity: 0, maxQuantity: 0 },
        { serviceId: 'service-a', addOnId: 'addon-b', required: true, defaultQuantity: 1, maxQuantity: 7 },
        { serviceId: 'service-b', addOnId: 'addon-c', required: false, defaultQuantity: 3, maxQuantity: 12 },
      ],
    };
    const originalBindings = structuredClone(menu.bindings);

    const projected = projectCustomerInterpreterMenu(menu);

    expect(projected.bindings.columns).toEqual(bindingColumns);
    expect(projected.bindings.serviceIds).toEqual(['service-a', 'service-b']);
    expect(projected.bindings.addOnIds).toEqual(['addon-a', 'addon-b', 'addon-c']);
    expect(projected.bindings.rows).toEqual([
      [0, 0, false, 0, 0, 'catalog_priced'],
      [0, 1, true, 1, 7, 'catalog_priced'],
      [1, 2, false, 3, 12, 'catalog_priced'],
    ]);
    expect(restoreBindings(projected)).toEqual(originalBindings.map(binding => ({ ...binding, priceMode: 'catalog_priced' })));
    expect(menu.bindings).toEqual(originalBindings);
    expect(projected.services).toBe(menu.services);
    expect(projected.addOns).toBe(menu.addOns);
    expect(projected.l1).toBe(l1);
    expect(projected.bindings).not.toBe(menu.bindings);
  });

  it('retains all bindings at the catalogue count limit with long opaque IDs', () => {
    const menu: CustomerMenu = { services: [], addOns: [], bindings: Array.from({ length: 160 }, (_, i) => ({
      serviceId: `service_${String(i % 60).padStart(80, '0')}`,
      addOnId: `addon_${String(i % 80).padStart(80, '0')}`,
      required: i % 2 === 0,
      defaultQuantity: i % 3,
      maxQuantity: i % 20,
    })) };
    const projected = projectCustomerInterpreterMenu(menu);

    expect(restoreBindings(projected)).toEqual(menu.bindings.map(binding => ({ ...binding, priceMode: 'catalog_priced' })));
    expect(projected.bindings.rows).toHaveLength(160);
    expect(Buffer.byteLength(JSON.stringify(projected.bindings))).toBeLessThan(Buffer.byteLength(JSON.stringify(menu.bindings)) / 2);
  });
});
