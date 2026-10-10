import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { expectReadableText } from '../assert-readable';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:3154') {
      return route.abort();
    }
    return route.continue();
  });
});

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function actionVisible(action: Locator) {
  await expect(action).toBeInViewport();

  const geometry = await action.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { height: box.height, bottom: box.bottom, viewport: window.innerHeight };
  });

  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport);
}

async function readableFields(container: Locator) {
  await expect(container).toBeVisible();

  const fields = await container.locator('input:not([type="checkbox"]):not([type="file"]), select, textarea').evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().height > 0).map(element => ({ font: Number.parseFloat(getComputedStyle(element).fontSize), height: element.getBoundingClientRect().height })));

  expect(fields.length).toBeGreaterThan(0);

  for (const field of fields) {
    expect(field.font).toBeGreaterThanOrEqual(16);
    expect(field.height).toBeGreaterThanOrEqual(44);
  }
}

for (const width of [320, 390, 430, 1280]) {
  test(`add-on editing keeps actions visible and restores focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?screen=services&addons=1&state=error');
    await page.getByRole('tab', { name: 'Add-ons', exact: true }).click();
    const edit = page.getByTestId('addon-row-addon_fixture');
    await edit.click();
    const editor = page.getByRole('dialog', { name: 'Edit Add-on', exact: true });
    await readableFields(editor);
    await editor.getByRole('textbox', { name: 'Description', exact: true }).fill('Detailed finish');
    await actionVisible(editor.getByRole('button', { name: 'Update Add-on', exact: true }));
    await editor.getByRole('button', { name: 'Update Add-on', exact: true }).click();

    await expect(editor.getByRole('alert')).toContainText('Synthetic save failure');
    await expect(editor.getByRole('alert')).toBeInViewport();
    await expect(editor.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('Detailed finish');

    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(edit).toBeFocused();

    await noOverflow(page);
  });

  test(`add-on creation keeps validation and cancellation visible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?screen=services&addons=1&state=error');
    await page.getByRole('tab', { name: 'Add-ons', exact: true }).click();
    const trigger = page.getByRole('button', { name: 'New add-on', exact: true });
    await trigger.click();
    const create = page.getByRole('dialog', { name: 'New add-on', exact: true });
    await readableFields(create);
    await actionVisible(create.getByRole('button', { name: 'Create Add-on', exact: true }));
    await create.getByRole('button', { name: 'Create Add-on', exact: true }).click();

    await expect(create.getByRole('alert')).toBeInViewport();

    await create.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(trigger).toBeFocused();

    await noOverflow(page);
  });

  test(`service add-on selection preserves the draft and return focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?screen=services&addons=1&state=error');
    await page.getByRole('button', { name: 'New service', exact: true }).click();
    const service = page.getByRole('dialog', { name: 'Add Service', exact: true });
    await service.getByLabel('Name', { exact: true }).fill('Review service');
    await service.getByRole('button', { name: 'Choose add-ons', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Add-ons for Review service', exact: true });

    await expect(picker).toBeVisible();

    await actionVisible(picker.getByRole('button', { name: 'Done', exact: true }));
    await noOverflow(page);
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(service.getByLabel('Name', { exact: true })).toHaveValue('Review service');
    await expect(service.getByRole('button', { name: 'Choose add-ons', exact: true })).toBeFocused();
  });

  test(`service form keeps actions reachable and restores focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?screen=services');
    const trigger = page.getByRole('button', { name: 'New service', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Add Service', exact: true });

    await expect(dialog).toBeVisible();

    await readableFields(dialog);
    await expectReadableText(page);
    await actionVisible(dialog.getByRole('button', { name: 'Save Service', exact: true }));

    expect(await dialog.getByRole('button', { name: 'Save Service', exact: true }).evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(143, 49, 85)');

    await dialog.getByText('Photo, buffers & display options', { exact: true }).click();
    await dialog.getByLabel('Description items', { exact: true }).fill('Detailed manicure\nSoft finish');
    await readableFields(dialog);
    await actionVisible(dialog.getByRole('button', { name: 'Save Service', exact: true }));

    await expect(dialog.getByRole('heading', { name: 'Add Service', exact: true })).toBeInViewport();

    await noOverflow(page);
    await page.keyboard.press('Escape');

    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.getByRole('button', { name: /Russian Manicure/ }).click();
    const edit = page.getByRole('button', { name: 'Edit Service', exact: true });
    await edit.click();
    const editDialog = page.getByRole('dialog', { name: 'Edit Service', exact: true });

    await expect(editDialog.getByLabel('Name', { exact: true })).toHaveValue('Russian Manicure');
    await expect(editDialog.getByTestId('service-form-advanced')).toHaveAttribute('open', '');

    await editDialog.getByRole('textbox', { name: 'Description items', exact: true }).focus();
    await actionVisible(editDialog.getByRole('button', { name: 'Update Service', exact: true }));
    await editDialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(edit).toBeFocused();
  });

  test(`client form preserves drafts on validation and keeps actions visible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?screen=client');
    const trigger = page.getByRole('button', { name: 'Add client', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Add client', exact: true });
    await readableFields(dialog);
    const save = dialog.getByRole('button', { name: 'Add client', exact: true });
    await actionVisible(save);
    await save.click();

    await expect(dialog.getByRole('alert')).toContainText('Review the highlighted fields');
    await expect(dialog.getByLabel('First name', { exact: true })).toBeFocused();

    await dialog.getByLabel('Notes', { exact: true }).fill('Prefers natural colour.');
    await actionVisible(save);
    await noOverflow(page);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test(`block time remains readable and preserves failed save at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?screen=block&state=error');

    await expect(page.getByText('Times in America/Toronto')).toBeVisible();

    await readableFields(page.getByTestId('calendar-block-time'));
    await page.getByLabel('Label (optional)', { exact: true }).fill('Personal time');
    await page.getByRole('button', { name: 'Block time', exact: true }).click();

    await expect(page.getByRole('alert')).toContainText('Synthetic save failure');
    await expect(page.getByRole('alert')).toBeInViewport();
    await expect(page.getByRole('alert')).toBeFocused();
    await expect(page.getByLabel('Label (optional)', { exact: true })).toHaveValue('Personal time');

    await noOverflow(page);
    await page.getByRole('button', { name: 'Edit block', exact: true }).click();

    await expect(page.getByLabel('Label (optional)', { exact: true })).toHaveValue('Lunch break');
    await expect(page.getByRole('heading', { name: 'Block Time', exact: true })).toBeFocused();

    await page.getByRole('button', { name: 'Cancel edit', exact: true }).click();
    await page.getByRole('button', { name: 'Remove block', exact: true }).click();
    await page.getByRole('button', { name: 'Keep block', exact: true }).click();

    await expect(page.getByText('Remove this block?', { exact: false })).toBeHidden();
  });
}

test('service validation and simulated save failure preserve entered details', async ({ page }) => {
  await page.goto('/?screen=services&state=error');
  await page.getByRole('button', { name: 'New service', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Service', exact: true });
  await dialog.getByRole('button', { name: 'Save Service', exact: true }).click();

  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('alert')).toBeInViewport();

  await dialog.getByLabel('Name', { exact: true }).fill('Review manicure');
  await dialog.getByLabel('Price', { exact: true }).fill('35');
  await dialog.getByLabel('Duration', { exact: true }).fill('35');
  await dialog.getByRole('button', { name: 'Save Service', exact: true }).click();

  await expect(dialog.getByRole('alert')).toContainText('Synthetic save failure');
  await expect(dialog.getByRole('alert')).toBeInViewport();
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Review manicure');

  await actionVisible(dialog.getByRole('button', { name: 'Save Service', exact: true }));
});

test('client simulated save error retains draft and successful local response closes dialog', async ({ page }) => {
  await page.goto('/?screen=client&state=error');
  await page.getByRole('button', { name: 'Add client', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Add client', exact: true });
  await dialog.getByLabel('First name', { exact: true }).fill('Sofia');
  await dialog.getByLabel('Phone', { exact: true }).fill('4165550101');
  await dialog.getByRole('button', { name: 'Add client', exact: true }).click();

  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('First name', { exact: true })).toHaveValue('Sofia');
  await expect(dialog.getByLabel('Phone', { exact: true })).toHaveValue('4165550101');

  await page.goto('/?screen=client');
  await page.getByRole('button', { name: 'Add client', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Add client', exact: true });
  await dialog.getByLabel('First name', { exact: true }).fill('Sofia');
  await dialog.getByLabel('Phone', { exact: true }).fill('4165550101');
  await dialog.getByRole('button', { name: 'Add client', exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toHaveText('Client added in isolated fixture.');
});
