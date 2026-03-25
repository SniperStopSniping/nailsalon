import { expect, type Page } from '@playwright/test';

import { appPath, e2eConfig } from './config';

type FetchResult<T = unknown> = {
  ok: boolean;
  status: number;
  body: T | null;
};

async function postJson<T>(
  page: Page,
  url: string,
  body: unknown,
): Promise<FetchResult<T>> {
  const result = await page.evaluate(async ({ requestUrl, requestBody }) => {
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    let responseBody: unknown = null;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      body: responseBody,
    };
  }, {
    requestUrl: url,
    requestBody: body,
  });

  return result as FetchResult<T>;
}

async function trySetDevRole(page: Page, role: 'super_admin') {
  return postJson(page, '/api/dev/role', { role });
}

async function ensureOrigin(page: Page) {
  await page.goto(`${appPath('/book/service')}?salonSlug=${e2eConfig.salonSlug}`, {
    waitUntil: 'domcontentloaded',
  });
}

export async function authenticateCustomer(page: Page, phone: string) {
  await ensureOrigin(page);

  const sendResult = await postJson(page, '/api/auth/send-otp', { phone });
  expect(sendResult.ok, JSON.stringify(sendResult.body)).toBeTruthy();

  const verifyResult = await postJson<{
    error?: string;
    success?: boolean;
  }>(page, '/api/auth/verify-otp', {
    phone,
    code: e2eConfig.customerOtpCode,
  });

  expect(verifyResult.ok, JSON.stringify(verifyResult.body)).toBeTruthy();

  await page.goto(`${appPath('/profile')}?salonSlug=${e2eConfig.salonSlug}`, {
    waitUntil: 'domcontentloaded',
  });
}

export async function authenticateStaff(page: Page) {
  await ensureOrigin(page);

  const sendResult = await postJson(page, '/api/staff/send-otp', {
    phone: e2eConfig.staffPhone,
    salonSlug: e2eConfig.salonSlug,
  });
  expect(sendResult.ok, JSON.stringify(sendResult.body)).toBeTruthy();

  const verifyResult = await postJson(page, '/api/staff/verify-otp', {
    phone: e2eConfig.staffPhone,
    code: e2eConfig.staffOtpCode,
    salonSlug: e2eConfig.salonSlug,
  });
  expect(verifyResult.ok, JSON.stringify(verifyResult.body)).toBeTruthy();

  const meResult = await page.evaluate(async () => {
    const response = await fetch('/api/staff/me', { cache: 'no-store' });
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok,
      body,
    };
  });
  expect(meResult.ok, JSON.stringify(meResult.body)).toBeTruthy();
}

export async function authenticateSuperAdmin(page: Page) {
  await ensureOrigin(page);

  const sendResult = await postJson(page, '/api/admin/auth/send-otp', {
    phone: e2eConfig.superAdminPhone,
  });
  expect(sendResult.ok, JSON.stringify(sendResult.body)).toBeTruthy();

  const verifyResult = await postJson(page, '/api/admin/auth/verify-otp', {
    phone: e2eConfig.superAdminPhone,
    code: e2eConfig.superAdminOtpCode,
  });
  expect(verifyResult.ok, JSON.stringify(verifyResult.body)).toBeTruthy();

  const meResponse = await page.evaluate(async () => {
    const response = await fetch('/api/admin/auth/me', { cache: 'no-store' });
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  });

  expect(meResponse.ok, JSON.stringify(meResponse.body)).toBeTruthy();
  expect(meResponse.body?.user?.isSuperAdmin).toBe(true);

  const devRoleResult = await trySetDevRole(page, 'super_admin');
  if (!devRoleResult.ok && devRoleResult.status !== 404) {
    throw new Error(JSON.stringify(devRoleResult.body));
  }
}
