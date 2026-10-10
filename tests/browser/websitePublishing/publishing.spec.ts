import { expect, test } from '@playwright/test';

test('mobile launch shows one clear action and optional editing', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Your website', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish website' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Booking Page editors' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Preview draft' })).toHaveAttribute('href', '/en/admin/booking-page/preview/synthetic-publishing-salon');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.screenshot({ path: `/tmp/luster-publishing-${test.info().project.name}.png`, fullPage: true });
  await page.getByText('Edit website', { exact: true }).click();

  await expect(page.getByRole('link', { name: /Business Information/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Review saved setup/ })).toBeVisible();
});

test('confirmed first publish gives live sharing controls with one request', async ({ page }) => {
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/admin/salon/publish')) {
      writes++;
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Publish website' }).click();
  const dialog = page.getByRole('alertdialog');

  await expect(dialog).toContainText('This address becomes permanent');
  await expect(dialog).toContainText('synthetic-publishing-salon');

  await dialog.getByRole('button', { name: 'Publish website' }).click();

  await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open live site' })).toHaveAttribute('href', 'https://www.lustergel.app/en/synthetic-publishing-salon');
  await expect(page.getByText('Your website is live.', { exact: false })).toBeVisible();
  expect(writes).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.screenshot({ path: `/tmp/luster-publishing-success-${test.info().project.name}.png`, fullPage: true });
});

test('keep draft does not publish and returns keyboard focus', async ({ page }) => {
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/admin/salon/publish')) {
      writes++;
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Publish website' }).click();
  await page.getByRole('button', { name: 'Keep draft' }).click();

  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Publish website' })).toBeFocused();
  expect(writes).toBe(0);
});

test('failed publication keeps draft and offers retry', async ({ page }) => {
  await page.route('**/api/admin/salon/publish?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Publish website' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish website' }).click();

  await expect(page.getByRole('alert')).toContainText('Your saved setup is safe');
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Publish website' })).toBeEnabled();
});

test('collaborators can edit but cannot publish', async ({ page }) => {
  await page.goto('/?collaborator=1');

  await expect(page.getByText('Publishing is owner only')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish website' })).toBeHidden();
  await expect(page.getByRole('link', { name: /Business Information/ })).toBeVisible();
});

test('published sites retain existing editing and draft review', async ({ page }) => {
  await page.goto('/?published=1&changes=1');

  await expect(page.getByText('Live · Draft changes not published')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review & publish changes' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Booking Page editors' })).toBeVisible();
});
