import { expect, test } from '@playwright/test';

import { appPath, authStatePaths } from './support/config';

test.use({ storageState: authStatePaths.superAdmin });

test('super admin creates a test invite with a usable link when email delivery is unavailable', async ({ browserName, context, page }) => {
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  }
  await page.goto(appPath('/super-admin'), { waitUntil: 'domcontentloaded' });

  const email = `luster+clerk_test_${Date.now()}@example.com`;
  await page.getByLabel('Nail tech email').fill(email);
  await page.getByLabel('Campaign source').fill('playwright-local');
  await page.getByRole('button', { name: /create invitation/i }).click();

  await expect(page.getByRole('status')).toContainText('Invitation created, but email delivery failed.');
  await expect(page.locator('#luster-invite')).toContainText('Delivery failed');

  const joinUrl = (await page.getByTestId('test-invite-url').textContent())?.trim();

  expect(joinUrl).toBeTruthy();

  const parsedJoinUrl = new URL(joinUrl!);

  expect(parsedJoinUrl.pathname).toMatch(/\/(?:en\/)?join\//);
  expect(['http:', 'https:']).toContain(parsedJoinUrl.protocol);

  await page.getByRole('button', { name: /copy invitation link/i }).click();

  await expect(page.getByRole('status')).toContainText('Invitation link copied.');

  if (browserName === 'chromium') {
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(joinUrl);
  } else {
    await page.evaluate(() => {
      const probe = document.createElement('textarea');
      probe.dataset.testid = 'e2e-invite-clipboard-probe';
      probe.setAttribute('aria-label', 'Temporary clipboard verification');
      probe.style.cssText = 'position:fixed;left:12px;top:12px;width:320px;height:48px;z-index:2147483647;opacity:1;';
      document.body.appendChild(probe);
    });

    try {
      const probe = page.getByTestId('e2e-invite-clipboard-probe');
      await probe.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');

      await expect.poll(async () => (await probe.inputValue()) === joinUrl).toBe(true);
    } finally {
      await page.evaluate(() => {
        document.querySelector('[data-testid="e2e-invite-clipboard-probe"]')?.remove();
      });
    }
  }

  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: /open invitation link/i }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  const openedUrl = new URL(popup.url());
  const expectedUrl = new URL(joinUrl!);

  expect(openedUrl.origin).toBe(expectedUrl.origin);
  expect(openedUrl.pathname).toMatch(/\/(?:en\/)?join\//);
  await expect(popup.getByRole('heading', { name: /create your owner account/i })).toBeVisible();

  await popup.close();
});
