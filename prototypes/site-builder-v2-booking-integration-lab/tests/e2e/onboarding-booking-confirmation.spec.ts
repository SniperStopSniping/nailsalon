import { expect, test } from '@playwright/test';

const STORAGE_KEY = 'luster:onboarding-v1-lab';

test('confirmation mode and minimum notice save together and survive reopening', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(route.request().url()).hostname)
    ? route.continue()
    : route.abort());
  await page.goto('/?audit=1');
  await page.getByRole('button', { name: 'Start with Quick Book' }).click();
  await page.getByLabel('More onboarding options').click();
  await page.getByRole('menuitem', { name: 'Lab review options' }).click();
  await page.getByRole('dialog', { name: 'Lab review options' })
    .getByRole('button', { name: 'Daniela / Isla Nail Studio', exact: true }).click();

  await expect(page.getByLabel('Autosave status')).toHaveText('Saved');

  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    state.progress.currentScreen = 'booking_preferences';
    state.progress.lastActiveScreen = 'booking_preferences';
    // Older drafts also need the new automatic default without losing notice.
    delete state.profile.bookingPreferences.confirmationMode;
    state.profile.bookingPreferences.minimumNoticeMinutes = 120;
    localStorage.setItem(key, JSON.stringify(state));
  }, STORAGE_KEY);
  await page.reload();
  const card = page.getByRole('button', { name: /Confirmation & booking notice/ });
  await card.click();

  await expect(page.getByRole('radio', { name: /Automatically confirm appointments/ })).toBeChecked();

  const notice = page.getByRole('combobox', { name: 'How much notice do you need before an appointment?' });

  await expect(notice).toHaveValue('preset:120');

  await page.getByRole('radio', { name: /Review each request first/ }).check();

  await expect(notice).toHaveValue('preset:120');

  await notice.selectOption('preset:480');

  await expect(page.getByLabel('Autosave status')).toHaveText('Saved');
  await expect.poll(async () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).profile.bookingPreferences, STORAGE_KEY))
    .toMatchObject({ confirmationMode: 'request_approval', minimumNoticeMinutes: 480 });

  await page.reload();
  await card.click();

  await expect(page.getByRole('radio', { name: /Review each request first/ })).toBeChecked();
  await expect(notice).toHaveValue('preset:480');

  await page.screenshot({ path: testInfo.outputPath('booking-confirmation-and-notice.png'), fullPage: true });
  await page.getByRole('radio', { name: /Automatically confirm appointments/ }).check();

  await expect(notice).toHaveValue('preset:480');

  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();

  await expect.poll(async () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).profile.bookingPreferences, STORAGE_KEY))
    .toMatchObject({ confirmationMode: 'instant', minimumNoticeMinutes: 480 });
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
});
