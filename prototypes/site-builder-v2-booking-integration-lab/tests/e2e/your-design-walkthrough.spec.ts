import { expect, test } from '@playwright/test';

test('clickable design demonstration plays without owner input and loops safely', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const demo = page.getByTestId('design-automatic-demo');
  await demo.scrollIntoViewIfNeeded();

  await expect(demo).toHaveAttribute('data-scene', '3', { timeout: 15000 });
  await expect(demo.locator('.final-design-demo__input')).toHaveText('lustergel.app');
  await expect(demo).toHaveAttribute('data-scene', '8', { timeout: 15000 });
  await expect(demo.getByText('Instagram · Example destination')).toBeVisible();
  await expect(demo.locator('a, input')).toHaveCount(0);
  await expect(demo).toHaveAttribute('data-scene', '0', { timeout: 5000 });

  await demo.getByRole('button', { name: 'Pause demo' }).click();

  await expect(demo).toHaveAttribute('data-playing', 'false');
  await expect(page.getByRole('heading', { name: 'Choose your starting point' })).toBeVisible();

  await page.reload();

  await expect(demo.getByRole('button', { name: 'Pause demo' })).toBeVisible();
});
