import { expect, test } from '@playwright/test';

for (const width of [320, 390, 1280]) {
  test(`degraded Google connection remains manageable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?app=integrations&google=degraded');

    await expect(page.getByRole('combobox', { name: 'Appointment calendar' })).toHaveValue('review-calendar');
    await expect(page.getByText('Needs attention', { exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('This sync attempt was skipped');
    await expect(page.getByRole('link', { name: /connect google calendar/i })).toHaveCount(0);
    await expect(page.getByText('GOOGLE_CALENDAR_CONNECTION_WRITE_FENCE_LOST', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Calendars saved' })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    for (const target of [
      page.getByRole('combobox', { name: 'Appointment calendar' }),
      page.getByRole('button', { name: 'Back to integrations', exact: true }),
      page.getByRole('button', { name: 'Close integrations', exact: true }),
      page.getByTestId('google-disconnect'),
    ]) {
      expect(await target.evaluate(element => Math.round(element.getBoundingClientRect().height * 1000) / 1000)).toBeGreaterThanOrEqual(44);
    }

    // Confirming disconnect is separate from opening its recoverable prompt.
    await page.getByTestId('google-disconnect').click();

    await expect(page.getByRole('button', { name: 'Yes, disconnect' })).toBeVisible();

    await page.getByRole('button', { name: 'Keep connected' }).click();

    await expect(page.getByRole('button', { name: 'Yes, disconnect' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Close integrations', exact: true }).click();

    await expect(page).toHaveURL(/app=settings/);
  });
}

test('confirmed rejected authorization still requires reconnecting', async ({ page }) => {
  await page.goto('/?app=integrations&google=reconnect_required');

  await expect(page.getByTestId('google-reconnect-banner')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reconnect Google Calendar', exact: true })).toHaveAttribute('href', '/api/integrations/google/connect?salonSlug=isla-browser');
  await expect(page.getByRole('combobox', { name: 'Appointment calendar' })).toHaveCount(0);
});
