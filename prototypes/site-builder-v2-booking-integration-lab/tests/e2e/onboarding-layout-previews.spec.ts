import { expect, type Locator, type Page, test } from '@playwright/test';

const STORAGE_KEY = 'luster:onboarding-v1-lab';

async function savedState(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

async function fixtureAt(page: Page, screen: string) {
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

  await page.evaluate(async ({ key, target }) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    const modulePath = '/src/model/index.ts';
    const model = await import(modulePath);
    const document = model.initializeStarter('quick_book', { siteName: state.profile.businessName });
    state.recipe.starterDocumentSiteId = document.siteId;
    localStorage.setItem(model.SITE_BUILDER_STORAGE_KEY, model.exportSiteBuilderDocument(document));
    state.recipe.starter = 'quick_book';
    state.recipe.quickBookLayout = 'compact_dropdown';
    // Match the existing storage parser's canonical Instagram spelling.
    state.profile.instagram = state.profile.instagram.replace(/^@/u, '');
    state.profile.logo = undefined;
    state.profile.profilePhoto = undefined;
    state.profile.coverPhoto = undefined;
    state.progress.currentScreen = target;
    state.progress.lastActiveScreen = target;
    state.progress.screenHistory = ['starter', target];
    state.progress.visitedScreens = [...new Set([...state.progress.visitedScreens, target])];
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: STORAGE_KEY, target: screen });
  await page.reload();

  await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible();
}

async function footerVisible(page: Page, dialog: Locator) {
  const footer = dialog.locator('.onboarding-overlay-actions');
  const box = (await footer.boundingBox())!;

  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);

  await dialog.locator('[data-preview-scroll-container]').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const afterScroll = (await footer.boundingBox())!;

  expect(afterScroll.y).toBeCloseTo(box.y, 0);

  await dialog.getByRole('button', { name: 'Continue', exact: true }).click({ trial: true });
  await dialog.getByRole('button', { name: 'Try another layout', exact: true }).click({ trial: true });
}

test('Quick Book cards preview the latest choice and restore the chooser through every dismissal', async ({ page }) => {
  await fixtureAt(page, 'about_design');
  const original = await savedState(page);
  const selected = page.getByRole('button', { name: /^Compact Dropdown/ });
  await selected.click();
  let dialog = page.getByRole('dialog', { name: 'Preview your Quick Book layout' });

  await expect(dialog.locator('[data-quick-book-layout]')).toHaveAttribute('data-quick-book-layout', 'compact_dropdown');

  await dialog.getByRole('button', { name: 'Try another layout' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(selected).toBeFocused();

  const card = page.getByRole('button', { name: /^Asymmetric Luxe/ });
  await card.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);
  await card.click();
  dialog = page.getByRole('dialog', { name: 'Preview your Quick Book layout' });

  await expect(dialog.locator('[data-quick-book-layout]')).toHaveAttribute('data-quick-book-layout', 'asymmetric_luxe');
  await expect(dialog.locator('.onboarding-preview-stage')).toHaveAttribute('data-preview-initial-target', 'top');
  await expect.poll(() => dialog.locator('[data-preview-scroll-container]').evaluate(element => element.scrollTop)).toBe(0);

  for (const device of ['Tablet', 'Desktop', 'Phone']) {
    await dialog.getByRole('button', { name: device, exact: true }).click();
    await footerVisible(page, dialog);
  }
  await page.screenshot({ path: `/tmp/onboarding-quick-book-popup-${test.info().project.name}.png` });
  await dialog.getByRole('button', { name: 'Try another layout' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(card).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(scroll, 0);
  await expect(card).toHaveAttribute('aria-pressed', 'true');

  for (const method of ['close', 'escape', 'back']) {
    await card.click();

    await expect(dialog).toBeVisible();

    if (method === 'close') {
      await dialog.getByRole('button', { name: 'Close Preview your Quick Book layout' }).click();
    } else if (method === 'escape') {
      await page.keyboard.press('Escape');
    } else {
      await page.goBack();
    }

    await expect(dialog).toHaveCount(0);
    await expect(card).toBeFocused();
    await expect(page.locator('[data-screen="about_design"]')).toBeVisible();
  }
  await page.goForward();

  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Continue', exact: true }).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  await expect(page.locator('[data-screen="policies"]')).toBeVisible();
  await expect(page.getByLabel('Autosave status')).toHaveText('Saved');

  const saved = await savedState(page);

  expect(saved.progress.screenHistory.filter((id: string) => id === 'policies')).toHaveLength(1);
  expect(saved.recipe.quickBookLayout).toBe('asymmetric_luxe');
  expect(saved.recipe.palettePreset).toBe(original.recipe.palettePreset);
  expect(saved.recipe.stylePreset).toBe(original.recipe.stylePreset);
  expect(saved.profile).toEqual(original.profile);

  await page.reload();

  expect((await savedState(page)).recipe.quickBookLayout).toBe('asymmetric_luxe');
});

test('booking cards preview the latest service layout at booking and accept exactly once', async ({ page }) => {
  await fixtureAt(page, 'booking_layout');
  const card = page.locator('[data-layout-option="clean_list"]');
  await card.click();
  const dialog = page.getByRole('dialog', { name: 'Preview your booking layout' });

  await expect(dialog.locator('[data-booking-renderer]')).toHaveAttribute('data-layout', 'clean_list');
  await expect(dialog.locator('.onboarding-preview-stage')).toHaveAttribute('data-preview-initial-target', 'booking');
  await expect.poll(() => dialog.locator('[data-preview-scroll-container]').evaluate(element => element.scrollTop)).toBeGreaterThan(0);

  await footerVisible(page, dialog);
  await page.screenshot({ path: `/tmp/onboarding-booking-popup-${test.info().project.name}.png` });
  await dialog.getByRole('button', { name: 'Try another layout' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(card).toBeFocused();
  await expect(card).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Preview selected layout' }).click();

  await expect(dialog.locator('[data-booking-renderer]')).toHaveAttribute('data-layout', 'clean_list');

  await page.keyboard.press('Escape');

  await expect(dialog).toHaveCount(0);

  await page.reload();

  await expect(card).toHaveAttribute('aria-pressed', 'true');

  await card.click();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  await expect(page.locator('[data-screen="final_preview"]')).toBeVisible();
  await expect.poll(async () => (await savedState(page)).progress.screenHistory.filter((id: string) => id === 'final_preview').length).toBe(1);
});

test('the first preview uses Compact Dropdown with only entered facts and preserves resumed choices', async ({ page }) => {
  await page.goto('/?audit=1');
  await page.getByRole('button', { name: 'Start with Quick Book' }).click();
  await expect(page.getByRole('heading', { name: 'Let’s start with your business' })).toBeFocused();
  await page.locator('label').filter({ has: page.getByRole('radio', { name: /^Independent nail tech/ }) }).click();
  await page.getByLabel('Salon or studio name *', { exact: true }).fill('Maya Atelier');
  await page.getByLabel('Your name *', { exact: true }).fill('Maya');
  await expect.poll(async () => (await savedState(page)).profile.businessName).toBe('Maya Atelier');
  await page.getByRole('button', { name: 'Show me my site →', exact: true }).click();
  const profile = page.locator('[data-quick-book-layout]');

  await expect(profile).toHaveAttribute('data-quick-book-layout', 'compact_dropdown');
  await expect(profile).toHaveAttribute('data-preview-phase', 'business');
  await expect(profile).toContainText('Maya Atelier');
  await expect(profile).not.toContainText('Toronto');
  await expect(profile).not.toContainText('Closed');
  await expect(profile).not.toContainText('Before you book');

  await expect(page.getByLabel('Autosave status')).toHaveText('Saved');

  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    state.profile.location.cityOrArea = 'Toronto';
    state.profile.location.exactAddress = '100 Owner Entered Avenue';
    state.profile.location.addressVisibility = 'public';
    state.recipe.quickBookLayout = 'clean_card';
    localStorage.setItem(key, JSON.stringify(state));
  }, STORAGE_KEY);
  await page.reload();

  await expect(profile).toHaveAttribute('data-quick-book-layout', 'clean_card');
  await expect(profile).toContainText('100 Owner Entered Avenue');

  await page.getByRole('button', { name: 'Preview my site' }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview your starting site' });

  await expect(dialog.locator('[data-quick-book-layout]')).toHaveAttribute('data-quick-book-layout', 'clean_card');
  await expect(dialog).toContainText('100 Owner Entered Avenue');
  await expect(dialog.getByRole('button', { name: 'Continue setup' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
});
