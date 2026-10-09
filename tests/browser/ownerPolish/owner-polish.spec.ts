import { expect, test } from '@playwright/test';

test('Today stays readable and retains its financial details at phone widths', async ({ page }, testInfo) => {
  await page.goto('/');

  await expect(page.getByTestId('owner-current-next-appointment')).toContainText('Sofia Martin');
  await expect(page.getByTestId('owner-revenue-summary')).toContainText('$110.00');

  for (const width of [320, 390, 430, 1366]) {
    await page.setViewportSize({ width, height: 844 });

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);

    for (const name of ['New Appointment', 'Walk-in', 'Message Client']) {
      const button = page.getByRole('button', { name, exact: true });
      const bounds = await button.boundingBox();

      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    const messageLabel = page.getByTestId('quick-action-send-sms').locator('span');

    expect(await messageLabel.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(24);

    await page.screenshot({ path: testInfo.outputPath(`S01-${width}.png`), fullPage: true });
  }
  const amount = page.locator('.owner-revenue-amount');

  await expect(amount).toHaveCSS('color', 'rgb(59, 25, 43)');
  await expect(amount.locator('..')).toHaveCSS('background-image', 'none');

  await page.getByRole('button', { name: 'View breakdown', exact: true }).click();

  await expect(page.getByText('Collected today', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Hide breakdown', exact: true }).click();

  await expect(page.getByText('Collected today', { exact: true })).toBeHidden();
});

test('quick actions preserve callbacks, modal dismissal and trigger focus', async ({ page }) => {
  await page.goto('/');
  const actions = [['New Appointment', 'new-appointment'], ['Walk-in', 'walk-in'], ['Message Client', 'send-sms']];
  for (const [name, id] of actions) {
    const trigger = page.getByRole('button', { name: name!, exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog');

    await expect(dialog.getByRole('status')).toHaveText(id!);
    await expect(dialog).toHaveCSS('background-color', 'rgb(255, 252, 250)');

    await page.keyboard.press('Escape');

    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  }
});

test('five tabs keep keyboard navigation and More destinations keep working', async ({ page }, testInfo) => {
  await page.goto('/');

  await expect(page.getByRole('tab')).toHaveCount(5);

  const today = page.getByRole('tab', { name: 'Today', exact: true });
  await today.focus();
  await page.keyboard.press('ArrowLeft');

  await expect(page.getByRole('tab', { name: 'More', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'More', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Booking', exact: true })).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath('more.png'), fullPage: true });
  await page.getByTestId('admin-app-tile-booking-page').click();

  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('booking-page');

  await page.getByRole('button', { name: 'Back', exact: true }).click();

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId('admin-app-tile-booking-page')).toBeFocused();
});

test('empty and failed states remain explicit and usable', async ({ page }, testInfo) => {
  await page.goto('/?state=empty');

  await expect(page.getByText('No appointments today', { exact: true })).toBeVisible();
  await expect(page.getByTestId('owner-revenue-summary-empty')).toContainText('No completed financial activity yet.');

  await page.screenshot({ path: testInfo.outputPath('S01-empty.png'), fullPage: true });
  await page.goto('/?state=error');

  await expect(page.getByTestId('owner-today-agenda')).toContainText('Could not refresh the dashboard. Try again.');
  await expect(page.getByRole('button', { name: 'Refresh dashboard', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'New Appointment', exact: true })).toBeEnabled();
  await expect(page.getByTestId('owner-revenue-summary')).toContainText('Revenue summary is temporarily unavailable.');

  await page.screenshot({ path: testInfo.outputPath('S01-error.png'), fullPage: true });
});

test('long dialog titles stay legible beside reachable Back and Save actions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/?longTitle=1');
  await page.getByRole('button', { name: 'New Appointment', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const title = dialog.getByText('Gel Manicure + Gel Pedicure', { exact: true });

  await expect(title).toBeVisible();
  // Read every box after the spring entrance settles. A visible, translated
  // dialog can produce fractional touch-target heights in WebKit.
  await expect(dialog).toHaveCSS('transform', 'none');

  const bounds = await title.boundingBox();
  const back = await dialog.getByRole('button', { name: 'Services', exact: true }).boundingBox();
  const save = await dialog.getByRole('button', { name: 'Save', exact: true }).boundingBox();

  expect(bounds!.y).toBeGreaterThanOrEqual(back!.y + back!.height);
  expect(bounds!.y).toBeGreaterThanOrEqual(save!.y + save!.height);
  expect(bounds!.height).toBeLessThanOrEqual(60);
  expect(back!.height).toBeGreaterThanOrEqual(44);
  expect(save!.height).toBeGreaterThanOrEqual(44);
  expect(await title.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

  await page.screenshot({ path: testInfo.outputPath('shared-dialog-long-title.png') });
});
