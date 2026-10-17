import { expect, type Page, test } from '@playwright/test';

const STORAGE_KEY = 'luster:onboarding-v1-lab';

async function savedState(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

async function openStyle(page: Page) {
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
    state.recipe.stylePreset = 'modern';
    state.recipe.headingFont = undefined;
    state.recipe.bodyFont = 'inter';
    state.progress.currentScreen = 'site_style';
    state.progress.lastActiveScreen = 'site_style';
    state.progress.screenHistory = ['starter', 'site_style'];
    localStorage.setItem(key, JSON.stringify(state));
  }, STORAGE_KEY);
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Choose your look', exact: true })).toBeVisible();
}

test('a ready-made look can be previewed and used without customisation', async ({ page }) => {
  await openStyle(page);
  const original = await savedState(page);
  const styles = page.getByRole('group', { name: 'Site style presets' });

  await expect(styles.getByRole('button')).toHaveCount(6);
  await expect(page.getByRole('group', { name: 'Heading font choices' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Website colour palettes' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Change fonts/u })).toContainText('Outfit + Inter');

  const cards = styles.locator('.onboarding-style-miniature');
  const colours = await cards.evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor));
  const corners = await cards.locator('.onboarding-style-miniature__card').evaluateAll(elements => elements.map(element => getComputedStyle(element).borderRadius));

  expect(new Set(colours).size).toBe(1);
  expect(new Set(corners).size).toBeGreaterThanOrEqual(4);
  await expect(cards.first()).toContainText(original.profile.businessName);

  await styles.getByRole('button', { name: 'Soft website style' }).click();
  await page.getByRole('button', { name: 'Preview my site', exact: true }).click();
  const dialog = page.getByRole('dialog');

  await expect(dialog.locator('[data-style-preset="soft"]')).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(dialog).toHaveCount(0);
  await expect(styles.getByRole('button', { name: 'Soft website style' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Use this look', exact: true }).click();

  await expect(page.locator('[data-screen="site_style"]')).toHaveCount(0);
  await expect(page.getByLabel('Autosave status')).toHaveText('Saved');

  const saved = await savedState(page);

  expect(saved.recipe).toMatchObject({ stylePreset: 'soft', styleConfirmed: true, palettePreset: original.recipe.palettePreset, bodyFont: 'inter' });
  expect(saved.profile).toEqual(original.profile);
});

test('optional colours and fonts update the preview, survive reload, and keep saved media', async ({ page }) => {
  await openStyle(page);
  const original = await savedState(page);
  await page.getByRole('button', { name: /^Change fonts/u }).click();
  await page.getByRole('button', { name: 'Outfit heading font' }).click();
  await page.getByRole('button', { name: 'Nunito body font' }).click();
  await page.getByRole('button', { name: /^Change fonts/u }).click();
  await page.getByRole('button', { name: 'Bold website style' }).click();
  await page.getByRole('button', { name: 'Change website colours', exact: true }).click();
  await page.getByRole('group', { name: 'Website colour palettes' }).getByRole('button', { name: /^Sage & Stone/u }).click();
  await page.getByRole('button', { name: 'Close website colours' }).click();

  await expect(page.getByLabel('Autosave status')).toHaveText('Saved');

  await page.reload();

  await expect(page.getByRole('button', { name: /^Change fonts/u })).toContainText('Outfit + Nunito');
  await expect(page.getByRole('group', { name: 'Heading font choices' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Bold website style' })).toHaveAttribute('aria-pressed', 'true');

  const saved = await savedState(page);

  expect(saved.recipe).toMatchObject({ stylePreset: 'bold', palettePreset: 'sage_stone', headingFont: 'modern', bodyFont: 'nunito' });
  expect(saved.profile).toEqual(original.profile);
  expect(saved.gallery).toEqual(original.gallery);
  expect(saved.canva).toEqual(original.canva);

  await page.getByRole('button', { name: 'Preview my site', exact: true }).click();
  const dialog = page.getByRole('dialog');

  await expect(dialog.locator('[data-style-preset="bold"][data-palette-preset="sage_stone"][data-heading-font="modern"][data-body-font="nunito"]')).toBeVisible();

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Change fonts/u }).click();

  await expect(page.getByRole('button', { name: 'Outfit heading font' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Nunito body font' })).toHaveAttribute('aria-pressed', 'true');

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  const actions = page.locator('.sticky-onboarding-actions > button:visible');
  for (const action of await actions.all()) {
    expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
});
