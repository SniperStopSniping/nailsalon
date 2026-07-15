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

async function ensureOrigin(page: Page) {
  await page.goto(`${appPath('/book/service')}?salonSlug=${e2eConfig.salonSlug}`, {
    waitUntil: 'domcontentloaded',
  });
}

export async function authenticateCustomer(page: Page, phone: string) {
  await ensureOrigin(page);

  expect(phone).toBeTruthy();
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

  const loginResult = await postJson(page, '/api/admin/auth/password-login', {
    phone: e2eConfig.superAdminPhone,
    password: e2eConfig.superAdminPassword,
  });

  expect(loginResult.ok, JSON.stringify(loginResult.body)).toBeTruthy();

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
}
