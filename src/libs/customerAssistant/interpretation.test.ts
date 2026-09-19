import { describe, expect, it } from 'vitest';

import { CUSTOMER_INTERPRETATION_JSON_SCHEMA, customerInterpretationSchema } from './interpretation';

const gelFrench = {
  factUpdates: { schemaVersion: 1, treatment: null, desiredApplication: null, maintenance: null, length: null, french: null, existingProduct: null, origin: null, removal: null, repairCount: null },
  action: 'propose',
  serviceId: 'svc_synthetic_gel-manicure',
  addOns: [{ addOnId: 'addon_synthetic_french-tips', quantity: 1 }],
  question: 'details',
  optionIds: [],
};

describe('customer interpretation wire contract', () => {
  it('excludes the reproduced empty-time output at the provider boundary and still rejects it locally', () => {
    const failedDatePreference = { date: '2026-09-19', earliest: '', latest: '' };
    const properties = CUSTOMER_INTERPRETATION_JSON_SCHEMA.properties.datePreference.properties;

    expect(new RegExp(properties.date.pattern).test(failedDatePreference.date)).toBe(true);
    expect(new RegExp(properties.earliest.pattern).test(failedDatePreference.earliest)).toBe(false);
    expect(new RegExp(properties.latest.pattern).test(failedDatePreference.latest)).toBe(false);
    expect(customerInterpretationSchema.safeParse({ ...gelFrench, datePreference: failedDatePreference }).success).toBe(false);
  });

  it('accepts a service proposal without premature availability and preserves a complete later preference', () => {
    expect(customerInterpretationSchema.parse({ ...gelFrench, datePreference: null }).datePreference).toBeNull();

    const datePreference = { date: '2026-09-19', earliest: '12:00', latest: '17:00' };
    const properties = CUSTOMER_INTERPRETATION_JSON_SCHEMA.properties.datePreference.properties;
    for (const key of ['date', 'earliest', 'latest'] as const) {
      expect(new RegExp(properties[key].pattern).test(datePreference[key])).toBe(true);
    }

    expect(customerInterpretationSchema.parse({ ...gelFrench, action: 'availability', datePreference }).datePreference).toEqual(datePreference);
  });
});
