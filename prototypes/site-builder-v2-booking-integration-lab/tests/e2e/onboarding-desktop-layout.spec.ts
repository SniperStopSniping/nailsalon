import { expect, type Locator, type Page, test } from '@playwright/test';

const STORAGE_KEY = 'luster:onboarding-v1-lab';
const VIEWPORTS = [
  { width: 920, height: 900 },
  { width: 1280, height: 900 },
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;
const STARTERS = ['quick_book', 'one_page'] as const;

async function openDesignFixture(page: Page, starter: typeof STARTERS[number]) {
  // This regression exercises the local prototype only, including its fixture
  // and storage adapter. It must never contact the real app or its providers.
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      ? route.continue()
      : route.abort();
  });
  await page.goto('/?audit=1');
  await page.getByRole('button', { name: 'Start with Quick Book' }).click();
  await page.getByLabel('More onboarding options').click();
  await page.getByRole('menuitem', { name: 'Lab review options' }).click();
  await page.getByRole('dialog', { name: 'Lab review options' })
    .getByRole('button', { name: 'Daniela / Isla Nail Studio', exact: true }).click();

  await expect(page.getByLabel('Autosave status')).toHaveText('Saved');

  // Match the existing mobile audit's saved-state hop without replaying every
  // unrelated onboarding screen just to reach this layout regression.
  await page.evaluate(({ key, selectedStarter }) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    state.progress.currentScreen = 'about_design';
    state.progress.lastActiveScreen = 'about_design';
    state.profile.ownerName = 'Maya';
    state.profile.businessName = 'Maya Nail Atelier';
    state.profile.logo = undefined;
    state.profile.profilePhoto = undefined;
    state.profile.coverPhoto = undefined;
    state.profile.about.shortBio = 'Thoughtful nail appointments in a calm studio.';
    state.recipe.starter = selectedStarter;
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: STORAGE_KEY, selectedStarter: starter });
  await page.reload();

  await expect(page.locator('[data-screen="about_design"]')).toBeVisible();

  await page.evaluate(() => document.fonts.ready);
}

async function geometry(locator: Locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      x: box.x,
      y: box.y,
      right: box.right,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
      contentWidth: box.width - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight),
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    };
  });
}

for (const viewport of VIEWPORTS) {
  for (const starter of STARTERS) {
    test(`About design stays readable: ${starter} at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openDesignFixture(page, starter);

      const screen = page.locator('[data-screen="about_design"]');
      const heading = screen.locator(':scope > header');
      const choices = screen.getByRole('group', {
        name: starter === 'quick_book' ? 'Quick Book layouts' : 'About design presets',
        exact: true,
      });
      const preview = screen.locator(':scope > .onboarding-about-design-preview');
      const previewStage = preview.locator('.onboarding-preview-stage');
      const actions = screen.locator(':scope > .sticky-onboarding-actions[aria-label="Onboarding actions"]');
      const primary = actions.getByRole('button', {
        name: starter === 'quick_book' ? 'Use this layout' : 'Use this design',
        exact: true,
      });
      const back = actions.getByRole('button', { name: 'Back to edit About', exact: true });
      const stages = page.getByRole('navigation', { name: 'Onboarding progress' }).getByRole('listitem');

      await expect(heading.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(stages).toHaveCount(5);
      await expect(choices.locator('[data-layout-family]')).toHaveCount(starter === 'quick_book' ? 3 : 0);

      const [screenBox, headingBox, choicesBox, previewBox, previewStageBox, stageBoxes] = await Promise.all([
        geometry(screen),
        geometry(heading),
        geometry(choices),
        geometry(preview),
        geometry(previewStage),
        stages.evaluateAll(elements => elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, right: box.right, width: box.width };
        })),
      ]);

      await test.info().attach('design-layout-geometry', {
        body: JSON.stringify({ viewport, starter, screenBox, headingBox, choicesBox, previewBox, previewStageBox, stageBoxes }),
        contentType: 'application/json',
      });

      // Width plus vertical ordering catches implicit extra grid columns even
      // when overflow is hidden and every element still counts as "visible".
      expect.soft(headingBox.width, 'heading has a readable text column')
        .toBeGreaterThanOrEqual(Math.min(520, screenBox.contentWidth * 0.8));
      expect.soft(headingBox.bottom, 'heading appears above the layout choices').toBeLessThanOrEqual(choicesBox.y + 2);
      expect.soft(choicesBox.width, 'choices retain the available content width')
        .toBeGreaterThanOrEqual(Math.min(920, screenBox.contentWidth) * 0.9);
      expect.soft(previewBox.y, 'preview follows all layout choices').toBeGreaterThanOrEqual(choicesBox.bottom - 2);
      expect.soft(previewBox.width, 'preview retains the available content width')
        .toBeGreaterThanOrEqual(Math.min(920, screenBox.contentWidth) * 0.9);
      expect.soft(previewStageBox.width, 'customer preview itself is not collapsed')
        .toBeGreaterThanOrEqual(Math.min(340, screenBox.contentWidth * 0.7));
      expect.soft(Math.max(...stageBoxes.map(box => box.y)) - Math.min(...stageBoxes.map(box => box.y)), 'all five progress stages stay on one row')
        .toBeLessThanOrEqual(2);

      for (const [index, box] of stageBoxes.entries()) {
        expect.soft(box.width, `progress stage ${index + 1} is not collapsed`).toBeGreaterThan(24);
        expect.soft(box.x).toBeGreaterThanOrEqual(0);
        expect.soft(box.right).toBeLessThanOrEqual(viewport.width + 1);
      }
      for (const [index, box] of stageBoxes.slice(1).entries()) {
        expect.soft(box.x, 'progress follows its visual order').toBeGreaterThanOrEqual(stageBoxes[index]!.right - 1);
      }

      await actions.scrollIntoViewIfNeeded();

      await expect(primary).toBeEnabled();
      await expect(back).toBeEnabled();

      const actionsBox = await geometry(actions);

      expect.soft(actionsBox.width, 'sticky actions use the content width')
        .toBeGreaterThanOrEqual(Math.min(920, screenBox.contentWidth) * 0.8);

      for (const control of [primary, back]) {
        const box = await geometry(control);

        expect.soft(box.width, 'action label has readable width').toBeGreaterThanOrEqual(100);
        expect.soft(box.height, 'action retains its touch target').toBeGreaterThanOrEqual(44);
        expect.soft(box.scrollWidth, 'action label is not clipped horizontally').toBeLessThanOrEqual(box.clientWidth + 1);
        expect.soft(box.x).toBeGreaterThanOrEqual(-1);
        expect.soft(box.right).toBeLessThanOrEqual(viewport.width + 1);

        // Trial only: verifies the sticky control is unobscured and reachable
        // without advancing onboarding or changing the selected layout.
        await control.click({ trial: true });
      }

      expect(await page.evaluate(() => document.documentElement.scrollWidth), 'page has no horizontal overflow')
        .toBeLessThanOrEqual(viewport.width + 1);
    });
  }
}
