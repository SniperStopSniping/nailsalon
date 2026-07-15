import { expect, test } from '@playwright/test';

import { appPath } from './support/config';

test('staff login screen explains that phone authentication is retired', async ({ page }) => {
  await page.goto(appPath('/staff-login'));

  await expect(page.getByRole('heading', { name: /staff login is unavailable/i })).toBeVisible();
  await expect(page.getByText(/does not use staff phone authentication/i)).toBeVisible();
});
