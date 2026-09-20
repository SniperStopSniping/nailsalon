import { describe, expect, it } from 'vitest';

import { completeAppointmentSchema, completionValidationIssues } from './appointmentCompletionContract';

describe('appointmentCompletionContract', () => {
  it('accepts opaque catalog IDs without imposing a legacy UI length limit', () => {
    const result = completeAppointmentSchema.safeParse({
      finalItems: [{
        kind: 'service',
        catalogServiceId: `svc_${'x'.repeat(68)}`,
        name: 'Russian Manicure',
        quantity: 1,
        unitPriceCents: 3500,
      }],
    });

    expect(result.success).toBe(true);
  });

  it('maps catalog-reference validation to safe owner feedback without submitted values', () => {
    const secretReference = 'service-id-that-must-not-appear-in-owner-feedback';
    const issues = completionValidationIssues([
      { path: ['finalItems', 0, 'catalogServiceId'] },
      { path: ['finalItems', 1, 'catalogAddOnId'] },
    ]);

    expect(issues).toEqual([
      {
        path: 'finalItems.0.catalogServiceId',
        message: 'Item 1: this service reference is unavailable. Reload the appointment and select the service again.',
      },
      {
        path: 'finalItems.1.catalogAddOnId',
        message: 'Item 2: this add-on reference is unavailable. Reload the appointment and select the add-on again.',
      },
    ]);
    expect(JSON.stringify(issues)).not.toContain(secretReference);
  });
});
