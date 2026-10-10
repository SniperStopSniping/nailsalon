import { expect, type Page, test } from '@playwright/test';

import { SITE_BUILDER_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { ONBOARDING_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';

async function readDraftContent(page: Page) {
  return page.evaluate(({ stateKey, documentKey }) => {
    const { eventJournal: _journal, progress, ...content } = JSON.parse(localStorage.getItem(stateKey)!);
    const { lastSavedAt: _timestamp, ...navigation } = progress;
    return { content, navigation, document: JSON.parse(localStorage.getItem(documentKey)!) };
  }, { stateKey: ONBOARDING_STORAGE_KEY, documentKey: SITE_BUILDER_STORAGE_KEY });
}

for (const width of [320, 390, 430]) {
  test(`identity conflict keeps account switch and draft visible at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/en/onboarding-v1?account=1');

    await expect(page.getByRole('heading', { name: 'Let’s reconnect your account' })).toBeVisible();
    await expect(page.getByText('owner@example.test', { exact: true })).toBeVisible();

    const draftBefore = await readDraftContent(page);
    const action = page.getByRole('button', { name: 'Sign out and switch account' });

    await expect(action).toBeVisible();
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await page.screenshot({ path: testInfo.outputPath(`account-conflict-${width}.png`), fullPage: true });
    await action.click();

    await expect(page.locator('body')).toHaveAttribute('data-signed-out', '/en/onboarding-v1?account=1&auth=sign-in');

    // Mounting the real setup records telemetry and refreshes the save time;
    // every draft content field, navigation state and site document must survive.
    expect(await readDraftContent(page)).toEqual(draftBefore);
  });

  test(`owner with no salon can continue setup or sign out at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/en/admin?screen=dashboard');

    await expect(page.getByRole('heading', { name: 'Let’s finish setting up your salon' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue building my site' })).toHaveAttribute('href', '/en/onboarding-v1');

    const action = page.getByRole('button', { name: 'Sign out', exact: true });

    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await page.screenshot({ path: testInfo.outputPath(`no-salon-${width}.png`), fullPage: true });
    await action.click();

    await expect(page.locator('body')).toHaveAttribute('data-signed-out');
  });
}

test('failed sign-out keeps recovery actions available', async ({ page }) => {
  await page.goto('/en/onboarding-v1?account=1&signOutFailure=1');
  await page.getByRole('button', { name: 'Sign out and switch account' }).click();

  await expect(page.getByText('We couldn’t sign you out. Try again before choosing a business.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out and switch account' })).toBeEnabled();

  await page.getByRole('button', { name: 'Return to my setup' }).click();

  await expect(page.getByRole('heading', { name: 'Let’s reconnect your account' })).toBeHidden();
});

for (const width of [320, 390, 430]) {
  test(`account mismatch exits the dashboard loop and keeps a restorable setup at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/en/admin?screen=dashboard&scenario=claimed');
    await page.getByRole('link', { name: 'Continue building my site' }).click();

    await expect(page.getByRole('heading', { name: 'Check the account for this website' })).toBeVisible();
    await expect(page.getByText('owner@example.test', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);

    const before = await readDraftContent(page);

    await expect(page.getByRole('button', { name: 'Use a different account' })).toHaveCSS('background-color', 'rgb(143, 49, 85)');

    await page.screenshot({ path: testInfo.outputPath(`saved-account-recovery-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Build a separate website' }).click();
    await page.getByRole('button', { name: 'Go back', exact: true }).click();

    expect(await readDraftContent(page)).toEqual(before);

    await page.getByRole('button', { name: 'Build a separate website' }).click();
    await page.getByRole('button', { name: 'Start a new website' }).click();

    await expect(page.getByRole('heading', { name: 'Check the account for this website' })).toHaveCount(0);
    await expect(page.getByText('Previous setups on this device (1)')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await page.reload();

    await expect(page.getByRole('heading', { name: 'Check the account for this website' })).toHaveCount(0);

    await page.getByText('Previous setups on this device (1)').click();
    await page.getByRole('button', { name: /^Open setup 1/u }).click();
    await page.getByRole('button', { name: 'Open previous setup', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Check the account for this website' })).toBeVisible();
    expect(await readDraftContent(page)).toEqual(before);
    await expect(page.getByRole('button', { name: 'Use a different account' })).toBeVisible();
  });
}
