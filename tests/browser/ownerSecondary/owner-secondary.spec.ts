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
  test(`usage balances, message filter and close stay usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    await page.goto('/?app=usage');

    await expect(page.getByText('83 SMS credits remaining', { exact: true })).toBeVisible();
    await expect(page.getByText('Your free-text allowance has been verified. Your existing SMS credits are unchanged.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Claim 100 free texts|Verify free-text allowance/ })).toHaveCount(0);
    await expect(page.getByText('Credit purchases are not available yet.', { exact: true })).toBeVisible();
    await expect(page.getByText('1 SMS credit charged', { exact: true })).toBeVisible();

    await expectReadableFields(page);

    const filter = page.getByRole('combobox', { name: 'Filter message history' });
    await filter.scrollIntoViewIfNeeded();

    await expect(filter).toBeInViewport();
    expect(await page.getByRole('dialog').locator('section').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth))).toBe(true);

    await filter.selectOption('cancellations');

    await expect(page.getByText('1 SMS credit charged', { exact: true })).toHaveCount(0);

    await filter.selectOption('confirmations');

    await expect(page.getByText('1 SMS credit charged', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close usage and billing' })).toBeInViewport();

    await page.getByRole('button', { name: 'Close usage and billing' }).click();

    await expect(page.getByRole('heading', { name: 'Usage & billing', exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/app=settings/);
  });

  test(`free-text verification actions fit without implying a grant at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    await page.goto('/?app=usage&allowance=verification-required');
    const claim = page.getByRole('button', { name: 'Claim 100 free texts', exact: true });

    await expect(claim).toBeVisible();
    expect(await claim.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(143, 49, 85)');
    expect(await claim.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);

    await claim.click();

    await expect(page.getByText('Verify your primary email and phone number to claim your free texts.', { exact: true })).toBeVisible();

    const verify = page.getByRole('button', { name: 'Verify email and phone', exact: true });

    await expect(verify).toBeVisible();
    expect(await verify.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
    await expect(page.getByText('0 SMS credits remaining', { exact: true })).toBeVisible();
    await expect(page.getByText('100 free SMS credits have been added.', { exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

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
    // Chromium can report a 48px target as 47.99993896484375 after the
    // sheet transform. Keep the 48px requirement at CSS subpixel precision.
    expect(await setup.evaluate(element => Number.parseFloat(getComputedStyle(element).minHeight))).toBeGreaterThanOrEqual(48);
    await expect.poll(async () => setup.evaluate(element =>
      Math.round(element.getBoundingClientRect().height * 1000) / 1000)).toBeGreaterThanOrEqual(48);

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

test('usage portal failure remains recoverable with the unchanged balance', async ({ page }) => {
  await page.goto('/?app=usage');
  const portal = page.getByRole('button', { name: 'Manage billing', exact: true });
  await portal.click();

  await expect(page.getByText('Could not open the billing portal. Please try again.', { exact: true })).toBeVisible();
  await expect(portal).toBeEnabled();
  expect(await portal.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
  await expect(page.getByText('83 SMS credits remaining', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/app=usage/);
});

test('allowance lookup failure offers a reachable retry without a claim', async ({ page }) => {
  await page.goto('/?app=usage&allowance=error');
  const retry = page.getByRole('button', { name: 'Retry status check', exact: true });
  await retry.click();

  await expect(page.getByText('We could not check your free-text allowance. Please try again.', { exact: true })).toBeVisible();
  expect(await retry.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
  await expect(page.getByRole('button', { name: /Claim 100 free texts|Verify free-text allowance/ })).toHaveCount(0);
});

test('allowance owner-only state keeps the claim action unavailable', async ({ page }) => {
  await page.goto('/?app=usage&allowance=owner-only');

  await expect(page.getByText('Only the salon owner can verify the free-text allowance. Sign in with the owner account.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Claim 100 free texts|Verify free-text allowance/ })).toHaveCount(0);
});

test('failed allowance claim does not change the balance or show success', async ({ page }) => {
  await page.goto('/?app=usage&allowance=unclaimed');
  const claim = page.getByRole('button', { name: 'Claim 100 free texts', exact: true });
  await claim.click();

  await expect(page.getByText('Free texts could not be claimed. Please try again.', { exact: true })).toBeVisible();
  await expect(claim).toBeEnabled();
  await expect(page.getByText('0 SMS credits remaining', { exact: true })).toBeVisible();
  await expect(page.getByText('100 free SMS credits have been added.', { exact: true })).toHaveCount(0);
});

test('notification destinations and settings inputs remain readable', async ({ page }) => {
  await page.goto('/?app=settings');
  await page.getByRole('button', { name: /^Owner & Staff Alerts/ }).click();

  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();

  await expectReadableFields(page);

  expect(await page.getByRole('checkbox', { name: 'Notify assigned technician for new booking alerts', exact: true }).evaluate(element => getComputedStyle(element).accentColor)).toBe('rgb(143, 49, 85)');
});
