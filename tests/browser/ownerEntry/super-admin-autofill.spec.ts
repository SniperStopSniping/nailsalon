import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const phone = '+1 416 555 0123';
const password = '  example-autofill-password  ';
const endpoint = '**/api/admin/auth/password-login';

async function autofill(page: Page) {
  // Reproduce password-manager values without input/change events or field focus.
  await page.getByLabel('Phone number').evaluate((input: HTMLInputElement, value) => {
    input.value = value;
  }, phone);
  await page.getByLabel('Password', { exact: true }).evaluate((input: HTMLInputElement, value) => {
    input.value = value;
  }, password);
}

for (const width of [320, 390]) {
  test(`autofill submits immediately and fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const submissions: unknown[] = [];
    await page.route(endpoint, async (route) => {
      submissions.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, json: {} });
    });
    await page.goto('/?screen=super-admin');

    await expect(page.locator('form')).toHaveAttribute('method', 'post');

    await autofill(page);

    await expect(page.getByLabel('Phone number')).not.toBeFocused();
    await expect(page.getByLabel('Password', { exact: true })).not.toBeFocused();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    for (const control of await page.locator('form input, form button').all()) {
      expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page).toHaveURL(/\/en\/super-admin$/);
    await expect(page.getByRole('status')).toContainText('No live session was created.');
    expect(submissions).toEqual([{ phone, password }]);
  });
}

test('native required validation prevents empty requests', async ({ page }) => {
  let submissions = 0;
  await page.route(endpoint, async (route) => {
    submissions += 1;
    await route.fulfill({ status: 401, json: {} });
  });
  await page.goto('/?screen=super-admin');
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page.locator('input:invalid')).toHaveCount(2);

  await page.getByLabel('Phone number').fill(phone);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page.locator('input:invalid')).toHaveCount(1);
  expect(submissions).toBe(0);
});

test('generic failure allows retry with current autofill and localized redirect', async ({ page }) => {
  const submissions: unknown[] = [];
  await page.route(endpoint, async (route) => {
    submissions.push(route.request().postDataJSON());
    await route.fulfill({ status: submissions.length === 1 ? 401 : 200, json: { error: 'Private account detail' } });
  });
  await page.goto('/?screen=super-admin&locale=fr');
  await page.getByLabel('Phone number').fill('+1 416 555 0199');
  await page.getByLabel('Password', { exact: true }).fill('earlier-example-password');
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page.getByRole('alert')).toHaveText('Invalid credentials');
  await expect(page.getByText('Private account detail')).toHaveCount(0);

  await autofill(page);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page).toHaveURL(/\/fr\/super-admin$/);
  expect(submissions).toEqual([
    { phone: '+1 416 555 0199', password: 'earlier-example-password' },
    { phone, password },
  ]);
});

test('pending request disables repeat submissions and can be retried after failure', async ({ page }) => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let submissions = 0;
  await page.route(endpoint, async (route) => {
    submissions += 1;
    await pending;
    await route.fulfill({ status: 401, json: {} });
  });
  await page.goto('/?screen=super-admin');
  await autofill(page);
  await page.locator('form').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });

  await expect(page.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
  await expect.poll(() => submissions).toBe(1);

  release?.();

  await expect(page.getByRole('alert')).toHaveText('Invalid credentials');
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled();
  expect(submissions).toBe(1);
});
