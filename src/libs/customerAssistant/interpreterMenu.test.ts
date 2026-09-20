import { describe, expect, it } from 'vitest';

import type { CustomerMenu } from './catalogue.server';
import { projectCustomerInterpreterMenu } from './interpreterMenu';

const bindingColumns = ['serviceId', 'addOnId', 'required', 'defaultQuantity', 'maxQuantity'] as const;

const restoreBindings = (projected: ReturnType<typeof projectCustomerInterpreterMenu>) => projected.bindings.rows.map(row => Object.fromEntries(
  projected.bindings.columns.map((column, index) => [column, row[index]]),
)) as CustomerMenu['bindings'];

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
    expect(projected.bindings.rows).toEqual([
      ['service-a', 'addon-a', false, 0, 0],
      ['service-a', 'addon-b', true, 1, 7],
      ['service-b', 'addon-c', false, 3, 12],
    ]);
    expect(restoreBindings(projected)).toEqual(originalBindings);
    expect(menu.bindings).toEqual(originalBindings);
    expect(projected.services).toBe(menu.services);
    expect(projected.addOns).toBe(menu.addOns);
    expect(projected.l1).toBe(l1);
    expect(projected.bindings).not.toBe(menu.bindings);
  });
});
