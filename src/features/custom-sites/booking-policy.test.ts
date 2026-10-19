import { describe, expect, it, vi } from 'vitest';

import { publicCustomSiteBookingPolicy } from './booking-policy';
import { assertBookingPolicyCoverage } from './website-coverage.server';

vi.mock('server-only', () => ({}));
const saved = { enabled: true, showOnServicePage: true, title: 'Before your visit', text: 'Please arrive on time.\nContact us if you need to cancel.', acknowledgment: { required: true, text: 'Private confirmation wording' }, showInConfirmationEmail: true };
const complete = '<section data-luster-booking-policy><h2 data-luster-field="booking.policyTitle"></h2><p data-luster-field="booking.policyText"></p></section>';

describe('canonical policy copy on custom websites', () => {
  it('includes only the public title and full text, without acknowledgment or configuration metadata', () => {
    expect(publicCustomSiteBookingPolicy(saved)).toEqual({ title: saved.title, text: saved.text });
    expect(publicCustomSiteBookingPolicy({ ...saved, title: null })?.title).toBe('Booking policies');
  });

  it.each([undefined, null, 'policy', {}, { ...saved, enabled: false }, { ...saved, showOnServicePage: false }, { ...saved, showOnServicePage: 'true' }, { ...saved, text: ' ' }])('omits policy copy unless enabled and explicitly visible: %j', (value) => {
    expect(publicCustomSiteBookingPolicy(value)).toBeNull();
  });

  it('rejects missing, hidden, templated or unbound policy text before generation/publication', () => {
    const policy = publicCustomSiteBookingPolicy(saved);

    expect(() => assertBookingPolicyCoverage(complete, policy)).not.toThrow();

    for (const html of [
      '<section>Before your visit: Please arrive on time.</section>',
      complete.replace('booking.policyText', 'business.bio'),
      complete.replace(' data-luster-booking-policy', ''),
      `<template>${complete}</template>`,
      `<div hidden>${complete}</div>`,
      `<div aria-hidden="true">${complete}</div>`,
    ]) {
      expect(() => assertBookingPolicyCoverage(html, policy)).toThrow('saved booking policy');
    }

    expect(() => assertBookingPolicyCoverage('', null)).not.toThrow();
  });
});
