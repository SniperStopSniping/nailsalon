import { expect, test } from '@playwright/test';

async function expectReadableFields(page: import('@playwright/test').Page) {
  const fields = page.locator('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="color"]), select, textarea');

  await expect(fields.first()).toBeVisible();

  const geometry = await fields.evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().width > 0).map(element => ({ font: Number.parseFloat(getComputedStyle(element).fontSize), height: element.getBoundingClientRect().height })));

  expect(geometry.length).toBeGreaterThan(0);

  for (const field of geometry) {
    expect(field.font).toBeGreaterThanOrEqual(16);
    expect(field.height).toBeGreaterThanOrEqual(44);
  }

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const width of [320, 390, 430, 1280]) {
  test(`account draft, leave guard and failed save remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    await page.goto('/?app=settings&view=account');

    await expect(page.getByRole('textbox', { name: /^Email/ })).toHaveValue('review@example.com');

    await expectReadableFields(page);

    await expect(page.getByRole('textbox', { name: /^Email/ })).toHaveAttribute('readonly', '');

    const name = page.getByRole('textbox', { name: 'Name', exact: true });
    await name.fill('Review owner updated');
    await page.getByRole('button', { name: 'Open Plan & Usage', exact: true }).click();
    const guard = page.getByRole('alertdialog', { name: 'Unsaved changes' });

    await expect(guard).toBeVisible();

    for (const label of ['Keep editing', 'Discard']) {
      const height = await guard.getByRole('button', { name: label, exact: true }).evaluate(element => element.getBoundingClientRect().height);

      expect(height).toBeGreaterThanOrEqual(44);
    }
    await guard.getByRole('button', { name: 'Keep editing', exact: true }).click();

    await expect(name).toHaveValue('Review owner updated');

    await page.getByRole('button', { name: 'Save profile', exact: true }).click();

    await expect(page.getByText('Changes could not be saved. Try again.', { exact: true })).toBeVisible();
    await expect(name).toHaveValue('Review owner updated');
    await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeEnabled();
  });

  test(`booking rules use a clear back row and retain failed drafts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    await page.goto('/?app=booking-rules&view=rules');
    const back = page.getByRole('button', { name: 'Booking Rules & Policies', exact: true });

    await expect(back).toBeVisible();

    const backBox = await back.boundingBox();

    expect(backBox?.height).toBeLessThanOrEqual(48);
    await expect(page.getByRole('heading', { name: 'Booking rules', exact: true })).toHaveCount(1);

    await expectReadableFields(page);
    const buffer = page.getByRole('spinbutton', { name: 'Buffer minutes', exact: true });
    await buffer.fill('15');
    await page.getByRole('button', { name: 'Save booking rules', exact: true }).click();

    await expect(page.getByText('Changes could not be saved. Try again.', { exact: true })).toBeVisible();
    await expect(buffer).toHaveValue('15');

    await back.click();

    await expect(page.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeVisible();

    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();

    await expect(buffer).toHaveValue('15');
  });

  test(`payment status uses owner styling and guarded setup recovery at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    await page.goto('/?app=payments&view=stripe');
    const setup = page.getByRole('button', { name: 'Resume onboarding', exact: true });

    await expect(setup).toBeVisible();
    expect(await setup.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(143, 49, 85)');
    expect(await setup.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);

    const status = page.getByText('Status not confirmed yet.', { exact: true });

    expect(await status.evaluate(element => getComputedStyle(element).color)).toBe('rgb(117, 101, 107)');
    await expect(page.getByText('Continue setup', { exact: true })).toBeVisible();

    await setup.click();

    await expect(page.getByText('Payment setup could not be started. Try again shortly.', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/view=stripe/);

    await page.getByRole('button', { name: 'Back to Payments', exact: true }).click();

    await expect(page.getByText('Payments', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deposits Amount, requirement and collection readiness', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('notification destinations and settings inputs remain readable', async ({ page }) => {
  await page.goto('/?app=settings');
  await page.getByRole('button', { name: /^Owner & Staff Alerts/ }).click();

  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();

  await expectReadableFields(page);

  expect(await page.getByRole('checkbox', { name: 'Notify assigned technician for new booking alerts', exact: true }).evaluate(element => getComputedStyle(element).accentColor)).toBe('rgb(143, 49, 85)');
});
