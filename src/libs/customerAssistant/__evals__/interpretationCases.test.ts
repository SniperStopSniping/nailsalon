import { describe, expect, it } from 'vitest';

import { CUSTOMER_INTERPRETATION_EVAL_CASES, SYNTHETIC_CUSTOMER_MENU } from './interpretationCases';

describe('customer interpretation synthetic eval fixtures', () => {
  it('contains the required representative customer and injection cases', () => {
    expect(CUSTOMER_INTERPRETATION_EVAL_CASES).toHaveLength(23);
    expect(CUSTOMER_INTERPRETATION_EVAL_CASES.map(item => item.id)).toEqual(expect.arrayContaining([
      'gelx-french-foreign-removal',
      'builder-gel-foreign-removal',
      'short-correction-replaces-long',
      'french-follow-up',
      'current-selection-price-question',
      'unsupported-acrylic',
      'invented-price-and-confirmation',
      'other-tenant-injection',
      'owner-calendar-injection',
      'accepted-saturday-afternoon',
      'accepted-after-five',
      'accepted-anything-later',
      'dst-date-explicit',
    ]));
  });

  it('only expects identifiers that occur in the synthetic menu and are bound to the selected service', () => {
    const services = new Set(SYNTHETIC_CUSTOMER_MENU.services.map(item => item.id));
    const addOnIds = new Set(SYNTHETIC_CUSTOMER_MENU.addOns.map(item => item.id));

    for (const testCase of CUSTOMER_INTERPRETATION_EVAL_CASES) {
      if (testCase.expected.serviceId) {
        expect(services).toContain(testCase.expected.serviceId);
      }
      for (const addOnId of testCase.expected.addOnIds ?? []) {
        expect(addOnIds).toContain(addOnId);
        expect(SYNTHETIC_CUSTOMER_MENU.bindings).toContainEqual(expect.objectContaining({ serviceId: testCase.expected.serviceId, addOnId }));
      }
    }
  });
});
