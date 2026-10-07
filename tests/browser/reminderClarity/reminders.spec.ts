import { expect, type Page, test } from '@playwright/test';

import { defaultRebookingReminderSettings } from '../../../src/libs/rebookingReminders';

async function settings(page: Page, options: { failLoad?: boolean; failSave?: boolean; waitForSave?: Promise<void> } = {}) {
  let saved = { ...defaultRebookingReminderSettings };
  const writes: unknown[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/admin/rebooking-reminders') {
      await route.abort();
      return;
    }
    if (route.request().method() === 'PATCH') {
      writes.push(route.request().postDataJSON());
      if (options.waitForSave) {
        await options.waitForSave;
      }
      if (options.failSave) {
        options.failSave = false;
        await route.fulfill({ status: 503, json: { error: { message: 'Could not save. Please retry.' } } });
        return;
      }
      saved = { ...saved, ...route.request().postDataJSON() };
    } else if (options.failLoad) {
      options.failLoad = false;
      await route.fulfill({ status: 503, json: { error: { message: 'Settings unavailable.' } } });
      return;
    }
    await route.fulfill({ json: { data: { settings: saved } } });
  });
  return writes;
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
}

test('shows timing, eligibility and estimated sample credits before activation', async ({ page }, info) => {
  const writes = await settings(page);
  await page.goto('/');

  await expect(page.getByRole('switch')).not.toBeChecked();
  await expect(page.getByText('4 SMS credits', { exact: true })).toBeVisible();
  await expect(page.getByText(/eligible for salon-promotion texts/)).toBeVisible();
  await expect(page.getByText(/Reminders become due at 10 AM/)).toBeVisible();
  await expect(page.getByText(/Changes take effect when you save/)).toBeVisible();

  await page.screenshot({ path: info.outputPath('S49-estimated-usage.png'), fullPage: true });
  await noOverflow(page);

  expect(writes).toHaveLength(0);
});

test('shorter wording recalculates the full message and undo restores the exact draft', async ({ page }, info) => {
  const writes = await settings(page);
  await page.goto('/');
  const wording = page.getByLabel('SMS wording');

  await expect(wording).toBeVisible();

  const original = await wording.inputValue();
  await page.getByRole('button', { name: 'Try shorter wording' }).click();

  await expect(page.getByText('1 SMS credit', { exact: true })).toBeVisible();
  await expect(page.getByText(/Isla Nail Studio via Luster: Hi Alex, book your next visit:/)).toContainText('Reply STOP to opt out.');
  await expect(page.getByRole('switch')).not.toBeChecked();

  await page.screenshot({ path: info.outputPath('S49-shorter-wording.png'), fullPage: true });
  await page.getByRole('button', { name: 'Undo wording change' }).click();

  await expect(wording).toHaveValue(original);
  await expect(page.getByRole('button', { name: 'Save reminders' })).toBeDisabled();
  expect(writes).toHaveLength(0);
});

test('failed save keeps the draft and successful retry reloads it without activation', async ({ page }, info) => {
  const writes = await settings(page, { failSave: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try shorter wording' }).click();
  await page.getByRole('button', { name: 'Save reminders' }).click();

  await expect(page.getByRole('alert')).toHaveText('Could not save. Please retry.');
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  await page.screenshot({ path: info.outputPath('S49-save-error.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save reminders' }).click();

  await expect(page.getByRole('status')).toHaveText('Rebooking Reminders saved.');

  await page.reload();

  await expect(page.getByLabel('SMS wording')).toHaveValue('Hi {{first_name}}, book your next visit: {{booking_link}}');
  await expect(page.getByText('Reminders off')).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toMatchObject({ enabled: false });
});

test('pending save locks editing and leaves the selected activation state explicit', async ({ page }) => {
  let finish!: () => void;
  const waitForSave = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await settings(page, { waitForSave });
  await page.goto('/');
  await page.getByRole('switch').click();
  await page.getByRole('button', { name: 'Save reminders' }).click();

  await expect(page.getByLabel('SMS wording')).toBeDisabled();
  await expect(page.getByRole('switch')).toBeDisabled();
  await expect(page.getByLabel('Send after the last completed appointment')).toBeDisabled();

  finish();

  await expect(page.getByText('Reminders on')).toBeVisible();
});

test('320px and enlarged text keep actions and estimates readable', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await settings(page);
  await page.goto('/');

  await expect(page.getByRole('switch')).toBeVisible();

  await page.addStyleTag({ content: 'html { font-size: 20px !important; }' });
  await page.screenshot({ path: info.outputPath('S49-320px-text-size.png'), fullPage: true });
  await noOverflow(page);
  for (const name of ['Try shorter wording', 'Save reminders']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();

    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test('load error provides recovery and Back returns to the messaging hub', async ({ page }, info) => {
  await settings(page, { failLoad: true });
  await page.goto('/');

  await expect(page.getByRole('alert')).toContainText('Settings unavailable.');

  await page.screenshot({ path: info.outputPath('S49-load-error.png'), fullPage: true });
  await page.getByRole('button', { name: 'Try again' }).click();

  await expect(page.getByRole('switch')).not.toBeChecked();

  await page.getByRole('button', { name: 'Back to Marketing & Messages' }).click();

  await expect(page.getByRole('heading', { name: 'Marketing & Messages' })).toBeVisible();
});
