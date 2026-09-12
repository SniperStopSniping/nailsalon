import { expect, test } from '@playwright/test';

test('Your Design explains clickable artwork before entering the existing upload flow', async ({ page }) => {
  await page.goto('/');
  const card = page.getByRole('button', { name: /Start with Your Design/u });
  const preview = page.getByTestId('starter-preview-your_design');

  await expect(preview).toHaveAttribute('data-preview-type', 'design-walkthrough');
  await expect(preview.getByText('Upload your image', { exact: false })).toBeVisible();
  await expect(preview.getByText('Make something clickable', { exact: false })).toBeVisible();
  await expect(preview.getByText('Draw a box around your Instagram')).toBeVisible();
  await expect(preview.getByText('Book appointment', { exact: true })).toBeVisible();
  await expect(preview.locator('button, a, input')).toHaveCount(0);

  await page.reload();

  await expect(preview.getByText('Clients tap to connect', { exact: false })).toBeVisible();

  await card.click();

  await expect(page.getByRole('dialog', { name: 'Upload a Canva design' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose images', exact: true })).toBeVisible();
});
