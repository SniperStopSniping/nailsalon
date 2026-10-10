import { expect, type Page, test } from '@playwright/test';

async function openRecovery(page: Page, width: number, failFirst = false) {
  const requests: unknown[] = [];
  const unexpected: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3130') {
      unexpected.push(request.url());
      await route.abort();
    } else if (url.pathname === '/api/public/appointments/recovery') {
      requests.push(request.postDataJSON());
      await route.fulfill({ status: failFirst && requests.length === 1 ? 503 : 202, json: { data: { accepted: true } } });
    } else if (url.pathname.startsWith('/api/')) {
      unexpected.push(request.url());
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/en/isla-nail-studio/find-booking');
  return { requests, unexpected };
}

for (const { width, textScale } of [{ width: 320, textScale: 200 }, { width: 390, textScale: 100 }, { width: 1280, textScale: 100 }]) {
  test(`empty recovery focuses contact, announces guidance and clears obsolete errors at ${width}px`, async ({ page }) => {
    const calls = await openRecovery(page, width);
    await page.addStyleTag({ content: `html { font-size: ${textScale}%; }` });
    const email = page.getByLabel('Booking email');
    const phone = page.getByLabel('Mobile phone');
    await email.press('Enter');

    await expect(page.getByRole('alert')).toHaveText('Enter the email or phone number you booked with.');
    await expect(email).toBeFocused();

    for (const field of [email, phone]) {
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      await expect(field).toHaveAccessibleDescription(/If you enter both, we'll email the link.*Enter the email or phone number/);
    }
    await phone.fill('   ');

    await expect(page.getByRole('alert')).toBeVisible();

    await phone.fill('4165550101');

    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(phone).toBeFocused();

    for (const field of [email, phone]) {
      await expect(field).not.toHaveAttribute('aria-invalid', 'true');
      await expect(field).toHaveAccessibleDescription(/If you enter both, we'll email the link/);
    }
    const action = page.getByRole('button', { name: 'Text my booking link' });
    const box = await action.boundingBox();

    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(calls.requests).toEqual([]);
    expect(calls.unexpected).toEqual([]);
  });
}

test('failed recovery retains contacts and error until explicit retry, then announces the neutral result', async ({ page }) => {
  const calls = await openRecovery(page, 390, true);
  await page.getByLabel('Booking email').fill('synthetic@example.test');
  await page.getByLabel('Mobile phone').fill('4165550101');
  await page.getByRole('button', { name: 'Email my booking link' }).click();

  await expect(page.getByRole('alert')).toContainText('We could not process the request');
  await expect(page.getByLabel('Booking email')).toHaveValue('synthetic@example.test');
  await expect(page.getByLabel('Mobile phone')).toHaveValue('4165550101');

  await page.getByLabel('Booking email').fill('edited@example.test');

  await expect(page.getByRole('alert')).toContainText('We could not process the request');
  expect(calls.requests).toHaveLength(1);

  await page.getByRole('button', { name: 'Email my booking link' }).click();

  await expect(page.getByRole('status')).toContainText('If we find a matching appointment');
  await expect(page.getByRole('status')).toContainText('email the secure link to the contact on file');
  expect(calls.requests).toEqual([
    { salonSlug: 'isla-nail-studio', email: 'synthetic@example.test', phone: '4165550101' },
    { salonSlug: 'isla-nail-studio', email: 'edited@example.test', phone: '4165550101' },
  ]);
  expect(calls.unexpected).toEqual([]);
});

test('native email validation still blocks malformed contact before any request', async ({ page }) => {
  const calls = await openRecovery(page, 320);
  const email = page.getByLabel('Booking email');
  await email.fill('invalid-email');
  await page.getByRole('button', { name: 'Email my booking link' }).click();

  await expect(email).toBeFocused();
  expect(await email.evaluate((input: HTMLInputElement) => input.validity.typeMismatch)).toBe(true);
  expect(calls.requests).toEqual([]);
  expect(calls.unexpected).toEqual([]);
});
