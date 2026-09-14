import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-12T12:00:00Z'));
});

test('week navigation and full calendar preserve date selection and keyboard access', async ({ page }) => {
  await page.goto('/?count=1');
  const days = page.locator('[data-testid^="calendar-day-"]');

  await expect(days).toHaveCount(7);
  await expect(page.getByTestId('calendar-day-2026-09-11')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Previous week' })).toBeDisabled();

  await page.getByRole('button', { name: 'Next week' }).click();
  await page.getByTestId('calendar-day-2026-09-19').focus();
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('calendar-day-2026-09-19')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('calendar-day-2026-09-19')).toBeEnabled();

  await expect(page.getByText('Only 1 opening available')).toBeVisible();

  await page.getByRole('button', { name: 'View full calendar' }).click();
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByTestId('calendar-day-2026-10-21').click();
  await page.getByRole('button', { name: 'Show one week' }).click();

  await expect(page.getByTestId('calendar-day-2026-10-21')).toHaveAttribute('aria-pressed', 'true');
  await expect(days).toHaveCount(7);
});

test('confirmation keyboard order starts with Back', async ({ page, browserName }) => {
  // macOS WebKit uses Option-Tab to traverse all clickable controls.
  const nextControlKey = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
  await page.goto('/?step=confirm&count=1');

  await page.keyboard.press(nextControlKey);

  const edit = page.getByRole('button', { name: 'Back', exact: true });

  await expect(edit).toBeFocused();
  await expect.poll(() => edit.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
});

test('reduced motion makes opacity changes immediate without a stale transition frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?count=1');
  const summary = page.getByTestId('booking-summary-card');

  await expect(summary).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next week' })).toHaveCSS('transition-property', 'none');

  const concealed = await summary.evaluate((element) => {
    element.style.transition = 'opacity 300ms ease 100ms';
    // Force the starting computed style before reproducing the preview's
    // opacity-zero negative control in the same frame.
    const initialOpacity = getComputedStyle(element).opacity;
    element.style.opacity = '0';
    return { initialOpacity, opacity: getComputedStyle(element).opacity };
  });

  expect(concealed).toEqual({ initialOpacity: '1', opacity: '0' });
});

test('the confirmed receipt keeps the salon appearance', async ({ page }) => {
  await page.goto('/?palette=black_champagne&step=confirm');
  await page.getByRole('textbox', { name: 'Customer name' }).fill('Test Client');
  await page.getByRole('textbox', { name: 'Customer email' }).fill('client@example.test');
  await page.getByRole('textbox', { name: 'Customer phone' }).fill('4165550123');
  await page.getByRole('button', { name: /Confirm appointment/ }).click();

  await expect(page.getByTestId('booking-result-receipt')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Appointment confirmed' })).toHaveCSS('color', 'rgb(255, 247, 232)');
});

test('captures compact calendar evidence', async ({ page }, info) => {
  for (const count of [1, 3, 10, 0]) {
    await page.goto(`/?palette=luster_berry&count=${count}`);

    await expect(page.locator('[data-testid^="time-slot-"]')).toHaveCount(count);
    await expect(page.locator('[data-public-surface="timeSelectionControls"]')).toBeVisible();

    await page.screenshot({ path: info.outputPath(`calendar-${count}.png`), fullPage: true, animations: 'disabled' });
  }
});
