import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';

const storageKey = 'luster:onboarding-v1-lab';
const artwork = path.resolve('src/onboarding/fixtures/assets/daniela-placeholder.jpg');

async function openOnboarding(page: Page) {
  await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(route.request().url()).hostname)
    ? route.continue()
    : route.abort());
  await page.goto('/?audit=1');
}

async function expectFittedAction(page: Page, name: string) {
  const action = page.getByRole('button', { name, exact: true });
  await action.scrollIntoViewIfNeeded();
  const box = await action.boundingBox();

  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('Your Design can reopen after cancellation, save a clickable image and reopen it after reload', async ({ page }) => {
  await openOnboarding(page);
  await page.getByRole('button', { name: 'Start with Your Design' }).click();
  const design = page.getByRole('dialog', { name: 'Upload a Canva design' });

  await expect(design.getByRole('button', { name: 'Save Canva design' })).toBeVisible();

  await design.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expectFittedAction(page, 'Add your design');
  await page.getByRole('button', { name: 'Add your design', exact: true }).click();
  await design.locator('input[type="file"][multiple]').setInputFiles(artwork);
  await design.getByRole('button', { name: 'Make something clickable', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Make your design clickable' });
  await editor.getByRole('button', { name: 'Place button on design' }).click();
  await editor.getByRole('button', { name: 'Place in centre' }).click();
  await editor.getByLabel('Accessible label').fill('Book from this test design');
  await editor.getByLabel('I confirm this label explains the action').check();
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  await design.getByRole('button', { name: 'Save Canva design' }).click();

  await expect(page.getByLabel('Autosave status')).toHaveText('Saved');

  await expectFittedAction(page, 'Edit your design');

  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey);
  await page.reload();
  await page.getByRole('button', { name: 'Edit your design', exact: true }).click();

  await expect(design.locator('[data-image-item-id]')).toHaveCount(1);

  await design.getByRole('button', { name: 'Edit clickable areas', exact: true }).click();

  await expect(editor.getByRole('button', { name: 'Move clickable area: Book from this test design' })).toBeVisible();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).canva.customDesignSectionId, storageKey)).toBe(saved.canva.customDesignSectionId);
});

for (const starter of ['Full Website', 'Quick Book']) {
  test(`switching from ${starter} opens the same Your Design manager and keeps a recovery action`, async ({ page }) => {
    await openOnboarding(page);
    await page.getByRole('button', { name: `Start with ${starter}` }).click();

    await expect(page.getByRole('button', { name: 'Add your design', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Switch to Your Design' }).click();
    await page.getByRole('dialog', { name: 'Switch to Your Design?' }).getByRole('button', { name: 'Switch to Your Design', exact: true }).click();
    const design = page.getByRole('dialog', { name: 'Upload a Canva design' });

    await expect(design.getByRole('button', { name: 'Save Canva design' })).toBeVisible();
    await expect(design.getByText('Choose Canva pages', { exact: true })).toHaveCount(0);

    await design.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expectFittedAction(page, 'Add your design');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: /Current starting point.*Your Design/u }).click();

    await expect(design.getByRole('button', { name: 'Save Canva design' })).toBeVisible();
  });
}
