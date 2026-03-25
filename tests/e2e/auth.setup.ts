import fs from 'node:fs';
import path from 'node:path';

import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import {
  authStatePaths,
  e2eBaseUrl,
  e2eConfig,
  usingExternalBaseUrl,
} from './support/config';

function ensureAuthDirectory() {
  fs.mkdirSync(path.dirname(authStatePaths.staff), { recursive: true });
}

async function postJson<T>(
  requestContext: APIRequestContext,
  url: string,
  body: unknown,
) {
  const response = await requestContext.post(url, {
    data: body,
  });

  return {
    ok: response.ok(),
    status: response.status(),
    body: await response.json().catch(() => null) as T | null,
  };
}

test.setTimeout(120_000);

test('bootstrap reusable staff and super-admin browser sessions', async () => {
  ensureAuthDirectory();

  if (usingExternalBaseUrl()) {
    expect(
      process.env.E2E_BASE_URL,
      'Set E2E_BASE_URL to the staging or staging-like host for the browser gate.',
    ).toBeTruthy();
    expect(
      e2eConfig.salonSlug,
      'Set E2E_SALON_SLUG for staging runs.',
    ).toBeTruthy();
    expect(
      e2eConfig.salonName,
      'Set E2E_SALON_NAME for staging runs.',
    ).toBeTruthy();
    expect(
      e2eConfig.serviceId,
      'Set E2E_SERVICE_ID for staging runs.',
    ).toBeTruthy();
    expect(
      e2eConfig.staffPhone,
      'Set E2E_STAFF_PHONE for staging runs or keep the seeded local default fixture.',
    ).toBeTruthy();
    expect(
      e2eConfig.superAdminPhone,
      'Set E2E_SUPER_ADMIN_PHONE for staging runs or keep the seeded local default fixture.',
    ).toBeTruthy();
    expect(
      e2eConfig.customerOtpCode,
      'Set E2E_OTP_CODE or E2E_CUSTOMER_OTP_CODE for staging runs.',
    ).toBeTruthy();
  }

  const staffContext = await playwrightRequest.newContext({ baseURL: e2eBaseUrl });
  const staffSendResult = await postJson(staffContext, '/api/staff/send-otp', {
    phone: e2eConfig.staffPhone,
    salonSlug: e2eConfig.salonSlug,
  });
  expect(staffSendResult.ok, JSON.stringify(staffSendResult.body)).toBeTruthy();

  const staffVerifyResult = await postJson(staffContext, '/api/staff/verify-otp', {
    phone: e2eConfig.staffPhone,
    code: e2eConfig.staffOtpCode,
    salonSlug: e2eConfig.salonSlug,
  });
  expect(staffVerifyResult.ok, JSON.stringify(staffVerifyResult.body)).toBeTruthy();

  const staffMeResponse = await staffContext.get('/api/staff/me');
  const staffMeBody = await staffMeResponse.json().catch(() => null);
  expect(staffMeResponse.ok(), JSON.stringify(staffMeBody)).toBeTruthy();
  await staffContext.storageState({ path: authStatePaths.staff });
  await staffContext.dispose();

  const superAdminContext = await playwrightRequest.newContext({ baseURL: e2eBaseUrl });
  const adminSendResult = await postJson(superAdminContext, '/api/admin/auth/send-otp', {
    phone: e2eConfig.superAdminPhone,
  });
  expect(adminSendResult.ok, JSON.stringify(adminSendResult.body)).toBeTruthy();

  const adminVerifyResult = await postJson(superAdminContext, '/api/admin/auth/verify-otp', {
    phone: e2eConfig.superAdminPhone,
    code: e2eConfig.superAdminOtpCode,
  });
  expect(adminVerifyResult.ok, JSON.stringify(adminVerifyResult.body)).toBeTruthy();

  const adminMeResponse = await superAdminContext.get('/api/admin/auth/me');
  const adminMeBody = await adminMeResponse.json().catch(() => null);
  expect(adminMeResponse.ok(), JSON.stringify(adminMeBody)).toBeTruthy();
  expect(adminMeBody?.user?.isSuperAdmin).toBe(true);

  const devRoleResult = await postJson(superAdminContext, '/api/dev/role', {
    role: 'super_admin',
  });
  if (!devRoleResult.ok && devRoleResult.status !== 404) {
    throw new Error(JSON.stringify(devRoleResult.body));
  }

  await superAdminContext.storageState({ path: authStatePaths.superAdmin });
  await superAdminContext.dispose();
});
