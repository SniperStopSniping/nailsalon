import fs from 'node:fs';
import path from 'node:path';

import { type APIRequestContext, expect, request as playwrightRequest, test } from '@playwright/test';

import {
  authStatePaths,
  e2eBaseUrl,
  e2eConfig,
  usingExternalBaseUrl,
} from './support/config';

function ensureAuthDirectory() {
  fs.mkdirSync(path.dirname(authStatePaths.superAdmin), { recursive: true });
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

test('bootstrap reusable super-admin password session', async () => {
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
      e2eConfig.superAdminPhone,
      'Set E2E_SUPER_ADMIN_PHONE for staging runs.',
    ).toBeTruthy();
    expect(
      e2eConfig.superAdminPassword,
      'Set E2E_SUPER_ADMIN_PASSWORD for staging runs.',
    ).toBeTruthy();
  }

  fs.writeFileSync(authStatePaths.staff, JSON.stringify({ cookies: [], origins: [] }));

  const superAdminContext = await playwrightRequest.newContext({ baseURL: e2eBaseUrl });

  expect(e2eConfig.superAdminPhone, 'E2E_SUPER_ADMIN_PHONE is required.').toBeTruthy();
  expect(e2eConfig.superAdminPassword, 'E2E_SUPER_ADMIN_PASSWORD is required.').toBeTruthy();

  const adminLoginResult = await postJson(superAdminContext, '/api/admin/auth/password-login', {
    phone: e2eConfig.superAdminPhone,
    password: e2eConfig.superAdminPassword,
  });

  expect(adminLoginResult.ok, JSON.stringify(adminLoginResult.body)).toBeTruthy();

  const adminMeResponse = await superAdminContext.get('/api/admin/auth/me');
  const adminMeBody = await adminMeResponse.json().catch(() => null);

  expect(adminMeResponse.ok(), JSON.stringify(adminMeBody)).toBeTruthy();
  expect(adminMeBody?.user?.isSuperAdmin).toBe(true);

  await superAdminContext.storageState({ path: authStatePaths.superAdmin });
  await superAdminContext.dispose();
});
