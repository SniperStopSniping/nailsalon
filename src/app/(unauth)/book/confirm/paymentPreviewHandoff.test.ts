import { describe, expect, it } from 'vitest';

import { paymentPreviewHandoffUrl } from './paymentPreviewHandoff';

describe('same-origin booking payment preview handoff', () => {
  const origin = 'https://preview.luster.test';

  it.each(['/manage/private-token', '/en/salon-a/manage/private-token'])('keeps the capability path and adds only the preview anchor: %s', (path) => {
    expect(paymentPreviewHandoffUrl(path, origin)).toBe(`${path}#customer-payment-preview`);
    expect(paymentPreviewHandoffUrl(`${origin}${path}`, origin)).toBe(`${path}#customer-payment-preview`);
  });

  it('supports same-origin local development without a production canonical-host fallback', () => {
    expect(paymentPreviewHandoffUrl('http://localhost:3101/manage/token', 'http://localhost:3101'))
      .toBe('/manage/token#customer-payment-preview');
    expect(paymentPreviewHandoffUrl('https://luster.test/manage/token', 'http://localhost:3101')).toBeNull();
  });

  it.each([
    null,
    '',
    '/manage/',
    '/manage/token/calendar.ics',
    '/manage/token/payment-quote',
    'manage/token',
    '//preview.luster.test/manage/token',
    'https://other.test/manage/token',
    'https://preview.luster.test:444/manage/token',
    'http://preview.luster.test/manage/token',
    'https://user:password@preview.luster.test/manage/token',
    'javascript:alert(1)',
    '/manage/token?quote=old',
    '/manage/token?',
    '/manage/token#old',
    '/manage/token#',
    '/manage/token\\suffix',
    '/manage/token\n',
    ' /manage/token',
    '/manage/token%2Fother',
  ])('fails closed for an unapproved destination: %s', (value) => {
    expect(paymentPreviewHandoffUrl(value, origin)).toBeNull();
  });
});
