import { expect, test } from '@playwright/test';

import { e2eBaseUrl } from './support/config';

const e2eOrigin = new URL(e2eBaseUrl).origin;

test('retired staff OTP endpoints fail before authentication', async ({ request }) => {
  const send = await request.post('/api/staff/send-otp', {
    headers: { Origin: e2eOrigin },
    data: { phone: '4165550198', salonSlug: 'disabled-staff-auth' },
  });

  expect(send.status()).toBe(410);
  await expect(send.json()).resolves.toEqual({ error: 'LEGACY_OTP_DISABLED' });

  const verify = await request.post('/api/staff/verify-otp', {
    headers: { Origin: e2eOrigin },
    data: { phone: '4165550198', code: '000000', salonSlug: 'disabled-staff-auth' },
  });

  expect(verify.status()).toBe(410);
  await expect(verify.json()).resolves.toEqual({ error: 'LEGACY_OTP_DISABLED' });
});
