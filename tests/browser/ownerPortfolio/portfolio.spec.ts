import { expect, test } from '@playwright/test';

for (const width of [320, 390, 1280]) {
  test(`photo selection and tagging stay readable and recoverable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    await page.goto('/');
    const choose = page.getByRole('button', { name: 'Choose photos', exact: true });

    await expect(choose).toBeDisabled();

    await page.getByRole('checkbox', { name: 'I confirm I have permission to publicly display this image.' }).check();

    await expect(choose).toBeEnabled();
    expect(await choose.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
    expect(await choose.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(143, 49, 85)');

    const photo = page.getByRole('button', { name: 'French manicure review photo', exact: true });
    await photo.click();

    await expect(photo).toHaveAttribute('aria-pressed', 'true');

    const batch = page.getByRole('region', { name: 'Batch tagging' });
    const geometry = await batch.getByRole('button').evaluateAll(elements => elements.map(element => ({ height: element.getBoundingClientRect().height, font: Number.parseFloat(getComputedStyle(element).fontSize) })));

    expect(geometry.length).toBeGreaterThan(5);

    for (const button of geometry) {
      expect(button.height).toBeGreaterThanOrEqual(44);
      expect(button.font).toBeGreaterThanOrEqual(14);
    }

    await expect(batch.getByRole('button', { name: 'Acrylic', exact: true })).toBeDisabled();

    await batch.getByRole('button', { name: 'Manicure', exact: true }).click();

    await expect(batch.getByRole('alert')).toHaveText(/This change could not be saved/);
    await expect(photo).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await batch.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}

test('a refused deletion stays open with a readable error and the photo retained', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Delete French manicure review photo', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete this portfolio photo?' });

  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Delete photo', exact: true }).click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveText(/This change could not be saved/);
  await expect(dialog.getByRole('button', { name: 'Delete photo', exact: true })).toBeEnabled();

  await dialog.getByRole('button', { name: 'Go back', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'French manicure review photo', exact: true })).toBeVisible();
});

test('load failure offers a reachable retry and renders the recovered library', async ({ page }) => {
  await page.goto('/?state=error');

  await expect(page.getByRole('alert')).toHaveText(/could not be loaded/);

  const retry = page.getByRole('button', { name: 'Retry loading portfolio', exact: true });

  expect(await retry.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

  await retry.click();

  await expect(page.getByRole('button', { name: 'French manicure review photo', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('an interrupted tag request keeps the selection and shows recovery', async ({ page }) => {
  await page.goto('/?failure=network');
  const photo = page.getByRole('button', { name: 'French manicure review photo', exact: true });
  await photo.click();
  const batch = page.getByRole('region', { name: 'Batch tagging' });
  await batch.getByRole('button', { name: 'Short', exact: true }).click();

  await expect(batch.getByRole('alert')).toHaveText(/Could not confirm the update/);
  await expect(photo).toHaveAttribute('aria-pressed', 'true');
  await expect(batch.getByRole('button', { name: 'Short', exact: true })).toBeEnabled();
});

test('an interrupted deletion does not close the confirmation or claim success', async ({ page }) => {
  await page.goto('/?failure=network');
  await page.getByRole('button', { name: 'Delete French manicure review photo', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete this portfolio photo?' });
  await dialog.getByRole('button', { name: 'Delete photo', exact: true }).click();

  await expect(dialog.getByRole('alert')).toHaveText(/Could not confirm the deletion/);
  await expect(dialog.getByRole('button', { name: 'Go back', exact: true })).toBeEnabled();
});

test('empty portfolio preserves upload permission and back navigation', async ({ page }) => {
  await page.goto('/?state=empty');

  await expect(page.getByText('Add your first photos', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose photos', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: 'Back', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Open Portfolio', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose photos', exact: true })).toHaveCount(0);
});
