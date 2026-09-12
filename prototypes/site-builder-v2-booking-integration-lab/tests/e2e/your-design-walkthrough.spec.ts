import { expect, test } from '@playwright/test';

test('owners can try clickable artwork without advancing onboarding', async ({ page }) => {
  await page.goto('/');
  const demo = page.getByRole('region', { name: 'Try making a design clickable' });
  await demo.getByRole('button', { name: 'Try with example image' }).click();
  await demo.getByRole('button', { name: 'Make something clickable' }).click();
  await demo.getByRole('button', { name: 'Instagram', exact: true }).click();
  await demo.getByRole('button', { name: 'Put a button around @yourstudio' }).click();
  await demo.getByRole('button', { name: 'Test Instagram button' }).click();

  await expect(demo.getByText(/It works!/u)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose your starting point' })).toBeVisible();

  await page.reload();

  await expect(demo.getByRole('button', { name: 'Try with example image' })).toBeVisible();

  await page.getByRole('button', { name: /Start with Your Design/u }).click();

  await expect(page.getByRole('dialog', { name: 'Upload a Canva design' })).toBeVisible();
});
