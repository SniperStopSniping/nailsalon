import { expect, test } from '@playwright/test';

import { expectReadableText } from '../assert-readable';

test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://127.0.0.1:3152');

    await route.continue();
  });
});

for (const width of [320, 1280]) {
  test(`calendar polish: keyboard, gaps, readable cards and reflow at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?screen=calendar');
    const views = page.getByRole('group', { name: 'Calendar view' });
    const monthly = views.getByRole('button', { name: 'Monthly', exact: true });
    await monthly.focus();
    await page.keyboard.press('Enter');

    await expect(monthly).toHaveAttribute('aria-pressed', 'true');
    await expect(views.getByRole('button', { name: 'Weekly', exact: true })).toHaveAttribute('aria-pressed', 'false');

    await page.reload();

    await expect(monthly).toHaveAttribute('aria-pressed', 'true');

    const today = page.locator('button[aria-current="date"]');

    await expect(today).toHaveAttribute('aria-label', /1 Luster appointment/);

    await today.focus();
    await page.keyboard.press('Enter');
    const disclosure = page.getByTestId('calendar-openings-disclosure');

    await expect(disclosure).not.toHaveAttribute('open');

    const appointment = page.getByTestId('day-detail-appointment-appt_review');

    await expect(appointment).toBeVisible();
    await expect(appointment.getByTestId('appointment-time-range')).toContainText(/\d[^\n\r\u2013\u2028\u2029]*\u2013.*\d/);
    await expect(appointment.getByTestId('appointment-duration')).toContainText('35');

    await disclosure.locator('summary').focus();
    await page.keyboard.press('Enter');

    await expect(disclosure).toHaveAttribute('open');

    await page.getByRole('button', { name: 'Show all gaps' }).click();

    await expect(page.getByRole('button', { name: 'Show fewer gaps' })).toBeVisible();

    await expectReadableText(page);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.screenshot({ path: testInfo.outputPath(`calendar-gaps-${width}.png`), fullPage: true });
    await page.keyboard.press('Escape');

    await expect(page.getByRole('button', { name: 'Close day details' })).toBeHidden();
    await expect(today).toBeFocused();
  });
}

test('empty calendar day expands gaps without hiding the no-appointments state', async ({ page }) => {
  await page.goto('/?screen=calendar&state=empty');
  await page.locator('button[aria-current="date"]').click();

  await expect(page.getByTestId('calendar-openings-disclosure')).toHaveAttribute('open');
  await expect(page.getByText('No appointments scheduled')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show all gaps' })).toBeVisible();
});

test('short viewport with enlarged text keeps crowded day details reachable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto('/?screen=calendar&state=crowded');
  await page.addStyleTag({ content: 'html { font-size: 24px !important; }' });
  await page.locator('button[aria-current="date"]').click();
  const dialog = page.getByRole('dialog').last();

  await expect(dialog.getByTestId('calendar-day-availability').locator('[data-testid^="calendar-day-availability-blocked-"]')).toHaveCount(8);

  const card = page.getByTestId('day-detail-appointment-appt_review');
  await card.scrollIntoViewIfNeeded();

  await expect(card).toBeInViewport();

  await card.focus();

  await expect(card).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.screenshot({ path: testInfo.outputPath('calendar-large-text-short.png'), fullPage: true });
  await page.keyboard.press('Escape');

  await expect(page.locator('button[aria-current="date"]')).toBeFocused();
});
