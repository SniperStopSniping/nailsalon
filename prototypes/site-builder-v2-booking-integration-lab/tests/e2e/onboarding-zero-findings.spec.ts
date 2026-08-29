import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  expect,
  test,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  clearCustomDesignAssets,
  LAB_STORAGE_KEY,
  readCustomDesignAssetRecordCounts,
  startRuntimeMonitor,
} from './helpers';

const ONBOARDING_STORAGE_KEY = 'luster:onboarding-v1-lab';
const EVIDENCE_DIRECTORY = '/tmp/luster-onboarding-zero-findings-correction';
const PORTRAIT_PATH = fileURLToPath(new URL(
  '../../src/onboarding/fixtures/assets/daniela-placeholder.jpg',
  import.meta.url,
));

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

type StoredState = {
  canva: {
    customDesignSectionId: string | null;
    displayMode: string;
    images: Array<{ fileName: string; storageId?: string }>;
    uploadResult: null | {
      addedCount: number;
      failures: Array<{ fileName: string; message: string }>;
      summary: string;
    };
  };
  profile: {
    about: {
      certifications: string[];
      languages: string[];
      specialties: string[];
    };
    businessName: string;
    hours: {
      setupState: string;
      showOnSite: boolean;
    };
  };
  progress: {
    currentScreen: string;
    sessionStatus: string;
  };
  recipe: {
    aboutPreset: string;
    canvaEnabled: boolean;
    starter: 'multi_page' | 'one_page' | 'quick_book' | null;
  };
};

type StoredDocument = {
  originStarter: 'multi_page' | 'one_page' | 'quick_book';
  pages: Array<{
    name: string;
    sections: Array<{
      sectionType: string;
      settings?: {
        displayMode?: string;
        images?: Array<{ assetId: string; fileName: string }>;
      };
    }>;
  }>;
};

const runtimeMonitors = new WeakMap<
  Page,
  ReturnType<typeof startRuntimeMonitor>
>();

const heading = (page: Page, name: string): Locator =>
  page.getByRole('heading', { level: 1, name });

async function capture(page: Page, fileName: string): Promise<void> {
  if (process.env.LUSTER_CAPTURE_EVIDENCE !== '1') return;
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: join(EVIDENCE_DIRECTORY, `${fileName}.png`),
  });
}

async function captureLocator(locator: Locator, fileName: string): Promise<void> {
  if (process.env.LUSTER_CAPTURE_EVIDENCE !== '1') return;
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await locator.screenshot({
    animations: 'disabled',
    path: join(EVIDENCE_DIRECTORY, `${fileName}.png`),
  });
}

async function captureJson(fileName: string, value: unknown): Promise<void> {
  if (process.env.LUSTER_CAPTURE_EVIDENCE !== '1') return;
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await writeFile(
    join(EVIDENCE_DIRECTORY, `${fileName}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

async function openFresh(page: Page): Promise<void> {
  await page.goto('/?audit=1');
  await expect(heading(page, 'Let’s build your website')).toBeVisible();
}

async function waitForSaved(page: Page): Promise<void> {
  await expect(page.getByLabel('Autosave status')).toHaveText('Saved', { timeout: 20_000 });
}

async function expectAtTop(page: Page, name: string): Promise<void> {
  const title = heading(page, name);
  await expect(title).toBeVisible();
  await expect(title).toBeFocused();
  const box = await title.boundingBox();
  expect(box, `${name} should have a visible layout box`).not.toBeNull();
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
    page.viewportSize()?.height ?? Number.POSITIVE_INFINITY,
  );
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function openReviewOptions(page: Page): Promise<Locator> {
  await page.getByLabel('More onboarding options').click();
  await page.getByRole('menuitem', { name: 'Lab review options' }).click();
  const dialog = page.getByRole('dialog', { name: 'Lab review options' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function applyFixture(
  page: Page,
  label: string,
  destinationHeading: string,
): Promise<void> {
  const dialog = await openReviewOptions(page);
  await dialog.getByRole('button', { exact: true, name: label }).click();
  await expect(dialog).toBeHidden();
  await expectAtTop(page, destinationHeading);
  await waitForSaved(page);
}

async function applyFixtureFromFresh(
  page: Page,
  label: string,
  destinationHeading: string,
): Promise<void> {
  await openFresh(page);
  await page.getByRole('button', { name: 'Build my website' }).click();
  await expectAtTop(page, 'Tell us about your nail business');
  await applyFixture(page, label, destinationHeading);
}

async function readState(page: Page): Promise<StoredState> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error('Missing onboarding state.');
    return JSON.parse(raw) as StoredState;
  }, ONBOARDING_STORAGE_KEY);
}

async function readDocument(page: Page): Promise<StoredDocument> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error('Missing Builder document.');
    return JSON.parse(raw) as StoredDocument;
  }, LAB_STORAGE_KEY);
}

async function openCanvaDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /Upload Canva design|Edit design/u }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload a Canva design' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openReadinessDrawerWhenVisible(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: /Site readiness/u });
  if (await trigger.isVisible() && await trigger.getAttribute('aria-expanded') !== 'true') {
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  }
}

async function addValidCanvaPage(
  dialog: Locator,
  fileName = 'canva-page.png',
): Promise<void> {
  await dialog.locator('input[type="file"]').first().setInputFiles({
    buffer: ONE_PIXEL_PNG,
    mimeType: 'image/png',
    name: fileName,
  });
  await expect(dialog.getByRole('list', { name: 'Selected Canva pages' }))
    .toContainText(fileName);
  await dialog.getByRole('button', { name: 'Add Canva design' }).click();
  await expect(dialog).toBeHidden();
  await waitForSaved(dialog.page());
}

async function activateWithKeyboard(locator: Locator): Promise<void> {
  await locator.focus();
  await locator.press('Enter');
}

test.describe('Onboarding zero-findings browser acceptance', () => {
  test.beforeEach(async ({ page }) => {
    runtimeMonitors.set(page, startRuntimeMonitor(page));
  });

  test.afterEach(async ({ page }) => {
    const monitor = runtimeMonitors.get(page);
    try {
      monitor?.assertClean();
    } finally {
      monitor?.stop();
      runtimeMonitors.delete(page);
    }
  });

  test('A04-1 and A16-2 put the style task first and keep its inline preview inert', async ({ page }) => {
    await page.setViewportSize({ height: 568, width: 320 });
    await applyFixtureFromFresh(page, 'Policies Off', 'Choose your website style');

    const styleOption = page.getByRole('button', { name: /^Modern/u });
    for (const viewport of [
      { height: 568, width: 320 },
      { height: 600, width: 375 },
      { height: 844, width: 390 },
      { height: 390, width: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo({ left: 0, top: 0 }));
      await heading(page, 'Choose your website style').focus();
      await expect(styleOption).toBeVisible();
      const titleBox = await heading(page, 'Choose your website style').boundingBox();
      const optionBox = await styleOption.boundingBox();
      const headerBox = await page.locator('.onboarding-shell__header').boundingBox();
      const footerBox = await page.locator('.sticky-onboarding-actions').boundingBox();
      await captureJson(`01-style-first-viewport-${viewport.width}x${viewport.height}`, {
        option: optionBox,
        title: titleBox,
        viewport,
      });
      expect(titleBox?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((titleBox?.y ?? 9999) + (titleBox?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
      expect(titleBox?.y ?? 9999).toBeLessThan(optionBox?.y ?? -1);
      expect(titleBox?.y ?? -1).toBeGreaterThanOrEqual(
        (headerBox?.y ?? 0) + (headerBox?.height ?? 0),
      );
      expect((optionBox?.y ?? 9999) + (optionBox?.height ?? 0)).toBeLessThanOrEqual(
        footerBox?.y ?? viewport.height,
      );
      await expectNoHorizontalOverflow(page);
    }
    await page.setViewportSize({ height: 568, width: 320 });
    await page.evaluate(() => window.scrollTo({ left: 0, top: 0 }));
    await heading(page, 'Choose your website style').focus();

    const inlineStage = page.locator(
      '[data-screen="site_style"] [data-preview-interaction="inline"]',
    );
    await expect(inlineStage).toBeVisible();
    await expect(inlineStage.locator('.onboarding-site-preview')).toHaveAttribute('inert', '');

    await heading(page, 'Choose your website style').focus();
    for (let index = 0; index < 18; index += 1) {
      await page.keyboard.press('Tab');
      const insidePreview = await page.evaluate(() => Boolean(
        document.activeElement?.closest('.onboarding-site-preview'),
      ));
      expect(insidePreview).toBe(false);
    }
    await expectNoHorizontalOverflow(page);
    await capture(page, '01-choose-look-task-and-style-visible');
    await capture(page, '15-inline-preview-inert');
  });

  test('A03-1 derives opening copy and omits it when hours are unavailable', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await applyFixtureFromFresh(page, 'Preview time · Closed', 'Review your site');
    let preview = page.getByLabel('Final phone customer preview');
    await expect(preview.locator('[data-hours-status="closed"]'))
      .toContainText('Opens tomorrow at 10:00 AM');
    await expect(preview).not.toContainText(/Next opening|Tomorrow at 10:30 AM/u);
    await capture(page, '03-derived-next-opening');

    await page.addInitScript((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) throw new Error('Missing onboarding state.');
      const state = JSON.parse(raw) as {
        reviewOptions: { previewTimestamp: string };
      };
      state.reviewOptions.previewTimestamp = '2026-08-27T18:30:00.000Z';
      window.localStorage.setItem(key, JSON.stringify(state));
    }, ONBOARDING_STORAGE_KEY);
    await page.reload();
    preview = page.getByLabel('Final phone customer preview');
    await expect(preview.locator('[data-hours-status="open"]')).toContainText('Open until 6:00 PM');
    await expect(preview).not.toContainText(/Next opening|Tomorrow at 10:30 AM/u);

    await page.addInitScript((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) throw new Error('Missing onboarding state.');
      const state = JSON.parse(raw) as {
        profile: { hours: { setupState: string; showOnSite: boolean } };
      };
      state.profile.hours.setupState = 'unset';
      state.profile.hours.showOnSite = false;
      window.localStorage.setItem(key, JSON.stringify(state));
    }, ONBOARDING_STORAGE_KEY);
    await page.reload();
    await expect(heading(page, 'Review your site')).toBeVisible();
    await expect(page.getByLabel('Final phone customer preview')).not.toContainText(
      /Open until|Opens .* at|Tomorrow at|Next opening/u,
    );
    await capture(page, '02-hours-unset-no-opening-claim');
  });

  test('A14-1 and A14-2 render all enabled Daniela facts without overlap', async ({ page }) => {
    await page.setViewportSize({ height: 600, width: 375 });
    await applyFixtureFromFresh(page, 'All essentials complete', 'Review your site');
    await openReadinessDrawerWhenVisible(page);
    await page.getByRole('button', { name: 'Edit About section' }).click();
    await expectAtTop(page, 'Would you like an About section?');

    await page.locator('details.onboarding-about-more > summary').click();
    const certifications = page.getByLabel('Certifications — optional');
    await expect(certifications).toBeVisible();
    await expect(page.getByLabel('About section live preview')
      .locator('.onboarding-site-preview')).toHaveAttribute('inert', '');
    await certifications.pressSequentially(
      'Russian manicure certification, BIAB certification',
      { delay: 5 },
    );
    const customSpecialties = page.getByLabel('Custom specialties separated by commas');
    await customSpecialties.pressSequentially('Structured gel, Bridal nails', { delay: 5 });
    await expect(customSpecialties).toHaveValue('Structured gel, Bridal nails');
    await page.getByRole('button', { name: 'Choose an About design' }).click();
    await expectAtTop(page, 'Choose your About design');
    await page.getByRole('button', { name: /About \+ Before You Book/u }).click();

    const preview = page.locator(
      '[data-screen="about_design"] [data-preview-interaction="inline"]',
    );
    await expect(preview.locator('.onboarding-site-preview')).toHaveAttribute('inert', '');
    for (const value of [
      'Russian Manicure',
      'BIAB',
      'Gel-X',
      'Hard Gel',
      'Structured gel',
      'Bridal nails',
      '6',
      'Russian manicure certification',
      'BIAB certification',
      'English',
      'Spanish',
      'Private home studio',
    ]) {
      await expect(preview).toContainText(value);
    }

    const specialtyList = preview.getByRole('list', { name: 'Specialties' }).first();
    await expect(specialtyList.getByRole('listitem')).toHaveCount(6);
    const specialtyMetrics = await specialtyList.evaluate((element) => ({
      clientWidth: element.clientWidth,
      items: [...element.querySelectorAll('li')].map((item) => ({
        clientWidth: item.clientWidth,
        scrollWidth: item.scrollWidth,
      })),
      scrollWidth: element.scrollWidth,
    }));
    expect(specialtyMetrics.scrollWidth).toBeLessThanOrEqual(specialtyMetrics.clientWidth + 1);
    expect(specialtyMetrics.items.every((item) => (
      item.scrollWidth <= item.clientWidth + 1
    ))).toBe(true);
    await expectNoHorizontalOverflow(page);
    await specialtyList.scrollIntoViewIfNeeded();
    await capture(page, '04-about-before-book-all-enabled-facts');
    await capture(page, '05-four-specialties-no-overlap');

    await page.getByRole('button', { name: 'Use this design' }).click();
    await expectAtTop(page, 'Set clear expectations');
    await page.getByRole('button', { name: 'Save policies' }).click();
    await expectAtTop(page, 'Choose your website style');
    const stylePreview = page.locator(
      '[data-screen="site_style"] [data-preview-interaction="inline"]',
    );
    for (const value of ['Russian Manicure', 'BIAB', 'Gel-X', 'Hard Gel', 'Structured gel', 'Bridal nails', '6', 'English', 'Spanish']) {
      await expect(stylePreview).toContainText(value);
    }
    await page.getByRole('button', { name: 'Continue with Soft' }).click();
    await expectAtTop(page, 'Add something extra');
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await expectAtTop(page, 'Review your site');
    const finalPreview = page.getByLabel('Final phone customer preview');
    for (const value of ['Russian Manicure', 'BIAB', 'Gel-X', 'Hard Gel', 'Structured gel', 'Bridal nails', '6', 'English', 'Spanish']) {
      await expect(finalPreview).toContainText(value);
    }
  });

  test('A04-2 closes the Screen 7 Preview through X, Escape, backdrop, and browser Back without advancing', async ({ page }) => {
    await page.setViewportSize({ height: 600, width: 375 });
    await applyFixtureFromFresh(page, 'Multi-page starter', 'Your starting site is ready');
    const trigger = page.getByRole('button', { name: 'Preview my site' });
    await expect(page.locator(
      '.onboarding-starting-preview__canvas [data-preview-interaction="inline"] .onboarding-site-preview',
    )).toHaveAttribute('inert', '');

    await trigger.click();
    let dialog = page.getByRole('dialog', { name: 'Preview your starting site' });
    await expect(dialog).toBeVisible();
    const skipPreview = dialog.getByRole('link', { name: 'Skip preview content' });
    await skipPreview.focus();
    await expect(skipPreview).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(dialog.locator('.onboarding-overlay-actions')).toBeFocused();
    await dialog.getByRole('button', { name: 'Close Preview your starting site' }).click();
    await expect(dialog).toBeHidden();
    await expect(heading(page, 'Your starting site is ready')).toBeVisible();
    await expect(trigger).toBeFocused();
    await capture(page, '06-screen7-preview-x-only-closes');

    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    dialog = page.getByRole('dialog', { name: 'Preview your starting site' });
    await page.getByTestId('dialog-backdrop').dispatchEvent('mousedown');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.goBack();
    await expect(dialog).toBeHidden();
    await expect(heading(page, 'Your starting site is ready')).toBeVisible();
    await page.goForward();
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toBeHidden();
    expect((await readState(page)).progress.currentScreen).toBe('starting_preview');
  });

  test('OB-05 keeps in-app and browser history directional after reload', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1180 });
    await applyFixtureFromFresh(page, 'All essentials complete', 'Review your site');
    await page.getByRole('button', { name: 'Edit About section' }).click();
    await expectAtTop(page, 'Would you like an About section?');
    await page.getByRole('button', { name: 'Choose an About design' }).click();
    await expectAtTop(page, 'Choose your About design');
    await page.getByRole('button', { name: 'Use this design' }).click();
    await expectAtTop(page, 'Set clear expectations');

    const policiesCursor = await page.evaluate(() => (
      window.history.state as { onboardingCursor?: number } | null
    )?.onboardingCursor ?? -1);
    await page.reload();
    await expectAtTop(page, 'Set clear expectations');
    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await expectAtTop(page, 'Choose your About design');
    expect(await page.evaluate(() => (
      window.history.state as { onboardingCursor?: number } | null
    )?.onboardingCursor ?? -1)).toBe(policiesCursor - 1);

    await page.goBack();
    await expectAtTop(page, 'Would you like an About section?');
    await page.goForward();
    await expectAtTop(page, 'Choose your About design');
    await page.goForward();
    await expectAtTop(page, 'Set clear expectations');
  });

  test('A06-1 keeps no-deposit policy wording internally consistent', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1180 });
    await applyFixtureFromFresh(page, 'All essentials complete', 'Review your site');
    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await expectAtTop(page, 'Add something extra');
    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await expectAtTop(page, 'Choose your website style');
    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await expectAtTop(page, 'Set clear expectations');
    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await expectAtTop(page, 'Choose your About design');
    await page.getByRole('button', { name: 'Back to edit About' }).click();
    await expectAtTop(page, 'Would you like an About section?');
    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await expectAtTop(page, 'Your starting site is ready');
    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await expectAtTop(page, 'Choose your starting point');
    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await expectAtTop(page, 'How do clients book with you?');
    await page.getByRole('group', { name: 'How do you handle booking deposits?' })
      .getByRole('radio', { name: 'No deposit' })
      .check();
    await page.getByRole('button', { name: 'Save booking setup' }).click();
    await expectAtTop(page, 'Choose your starting point');
    await page.locator('[data-starter-id="one_page"]').click();
    await expectAtTop(page, 'Your starting site is ready');
    await page.getByRole('button', { name: 'Continue setting up my site' }).click();
    await expectAtTop(page, 'Would you like an About section?');
    await page.getByRole('button', { name: 'Choose an About design' }).click();
    await expectAtTop(page, 'Choose your About design');
    await page.getByRole('button', { name: 'Use this design' }).click();
    await expectAtTop(page, 'Set clear expectations');
    const policyPreview = page.locator('.onboarding-policy-copy-list');
    await expect(policyPreview).toContainText('No deposit is required');
    await expect(policyPreview).not.toContainText(/deposit (?:is|will be) lost|forfeit(?:ed)? the deposit/u);
    await capture(page, '07-no-deposit-consistent-policies');
  });

  test('A01-1 shows distinct real starter structures and names a switch destination', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1180 });
    const expectStructureInFirstFrame = async (structure: Locator) => {
      const geometry = await structure.evaluate((element) => {
        const frame = element.closest('.onboarding-preview-frame')?.getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        return {
          frameBottom: frame?.bottom ?? 0,
          frameTop: frame?.top ?? 0,
          structureBottom: bounds.bottom,
          structureTop: bounds.top,
        };
      });
      expect(geometry.structureTop).toBeGreaterThanOrEqual(geometry.frameTop);
      expect(geometry.structureBottom).toBeLessThanOrEqual(geometry.frameBottom);
    };
    await applyFixtureFromFresh(page, 'Multi-page starter', 'Your starting site is ready');
    let preview = page.getByLabel('Isla Nail Studio starting website preview');
    const multiStructure = preview.locator('[data-starter-structure="multi_page"]');
    for (const pageName of ['Home', 'Services & Booking', 'Gallery', 'About', 'Contact']) {
      await expect(multiStructure.getByRole('heading', { name: pageName, exact: true })).toBeVisible();
    }
    await expectStructureInFirstFrame(multiStructure);
    await capture(page, '10-multi-page-preview');

    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await expectAtTop(page, 'Choose your starting point');
    await page.locator('[data-starter-id="quick_book"]').click();
    const switchQuick = page.getByRole('dialog', { name: 'Switch to Quick Book?' });
    await expect(switchQuick).toContainText('Quick Book');
    await capture(page, '25-starter-switch-named-target');
    await switchQuick.getByRole('button', { exact: true, name: 'Switch to Quick Book' }).click();
    await expectAtTop(page, 'Your starting site is ready');
    preview = page.getByLabel('Isla Nail Studio starting website preview');
    const quickStructure = preview.locator('[data-starter-structure="quick_book"]');
    for (const sectionName of ['Salon intro', 'Services', 'Booking']) {
      await expect(quickStructure.getByRole('listitem').filter({ hasText: sectionName })).toBeVisible();
    }
    await expectStructureInFirstFrame(quickStructure);
    await expect(preview).not.toContainText('Reviews');
    await capture(page, '08-quick-book-preview');

    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await page.locator('[data-starter-id="one_page"]').click();
    const switchOnePage = page.getByRole('dialog', { name: 'Switch to One-page website?' });
    await expect(switchOnePage).toContainText('One-page website');
    await switchOnePage.getByRole('button', { exact: true, name: 'Switch to One-page website' }).click();
    await expectAtTop(page, 'Your starting site is ready');
    preview = page.getByLabel('Isla Nail Studio starting website preview');
    const onePageStructure = preview.locator('[data-starter-structure="one_page"]');
    for (const sectionName of ['Welcome', 'About', 'Services', 'Gallery', 'Reviews', 'Booking']) {
      await expect(onePageStructure.getByRole('listitem').filter({ hasText: sectionName })).toBeVisible();
    }
    await expectStructureInFirstFrame(onePageStructure);
    await capture(page, '09-one-page-preview');
  });

  test('A13-F1, A16-1, A16-6, and A16-5 give the plan overlay truthful history and dashboard focus', async ({ page }) => {
    await page.setViewportSize({ height: 430, width: 932 });
    await applyFixtureFromFresh(page, 'All essentials complete', 'Review your site');
    const finishSetup = page.getByRole('button', { name: 'Finish setup' });
    await finishSetup.click();
    let dialog = page.getByRole('dialog', { name: 'Your site is saved' });
    const planHeading = dialog.getByRole('heading', { level: 2, name: 'Your site is saved' });
    await expect(planHeading).toBeFocused();
    const focusBox = await planHeading.boundingBox();
    const dialogBox = await dialog.boundingBox();
    expect(focusBox?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((focusBox?.y ?? 9999) + (focusBox?.height ?? 0)).toBeLessThanOrEqual(430);
    expect(dialogBox?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((dialogBox?.y ?? 9999) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual(430);
    const freeOption = dialog.getByRole('radio', { name: /^Free/u });
    const foundingOption = dialog.getByRole('radio', { name: /^Founding offer/u });
    const monthlyOption = dialog.getByRole('radio', { name: /^Monthly/u });
    await expect(freeOption).toBeVisible();
    await expect(foundingOption).toBeAttached();
    await expect(monthlyOption).toBeAttached();
    await expect(dialog.getByRole('button', { name: 'Continue free' })).toBeVisible();
    await dialog.locator('label.is-founding').click();
    await expect(dialog.getByRole('button', { name: 'Reserve founding offer' })).toBeVisible();
    await dialog.locator('label.is-monthly').click();
    await expect(dialog.getByRole('button', { name: 'I’m interested in monthly' })).toBeVisible();
    await dialog.locator('label.is-free').click();
    await capture(page, '14-plan-sheet-heading-focus');
    await capture(page, '36-unclipped-landscape-plan-sheet');
    await page.setViewportSize({ height: 900, width: 1440 });
    await captureLocator(dialog, '41-named-plan-buttons');
    await page.setViewportSize({ height: 430, width: 932 });

    await page.goBack();
    await expect(dialog).toBeHidden();
    await expect(heading(page, 'Review your site')).toBeVisible();
    await capture(page, '11-plan-back-closes-only-sheet');
    await page.goForward();
    dialog = page.getByRole('dialog', { name: 'Your site is saved' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Your site is saved' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(finishSetup).toBeFocused();

    await finishSetup.click();
    dialog = page.getByRole('dialog', { name: 'Your site is saved' });
    await dialog.getByRole('button', { name: 'Close Your site is saved' }).click();
    await expect(dialog).toBeHidden();
    await expect(finishSetup).toBeFocused();

    await finishSetup.click();
    dialog = page.getByRole('dialog', { name: 'Your site is saved' });
    await page.getByTestId('dialog-backdrop').dispatchEvent('mousedown');
    await expect(dialog).toBeHidden();
    await expect(finishSetup).toBeFocused();

    await finishSetup.click();
    await page.reload();
    dialog = page.getByRole('dialog', { name: 'Your site is saved' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Your site is saved' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(finishSetup).toBeFocused();

    await finishSetup.click();
    await page.getByRole('dialog', { name: 'Your site is saved' })
      .getByRole('button', { name: 'Continue free' })
      .click();
    const dashboardHeading = page.getByRole('heading', {
      level: 1,
      name: 'Your Luster site is ready',
    });
    await expect(dashboardHeading).toBeFocused();
    await expect(page.getByRole('dialog', { name: 'Welcome to your Luster workspace' }))
      .toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Take a quick tour' }).first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Dashboard destinations' }))
      .toBeVisible();
    await expect(page.locator('h1:visible')).toHaveCount(1);
    await capture(page, '40-dashboard-one-h1-focus');
    await capture(page, '45-continue-free-dashboard-handoff');
  });

  test('A13-F2 renders real target device widths inside a contained phone host', async ({ page }) => {
    await page.setViewportSize({ height: 568, width: 320 });
    await applyFixtureFromFresh(page, 'All essentials complete', 'Review your site');
    const controls = page.getByRole('group', { name: 'Customer preview device size' });
    const expectations = [
      ['Phone', 'phone', 390],
      ['Tablet', 'tablet', 768],
      ['Desktop', 'desktop', 1180],
    ] as const;

    for (const [label, device, targetWidth] of expectations) {
      const button = controls.getByRole('button', { name: label });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      const stage = page.locator(`[data-preview-device="${device}"][data-preview-interaction="inline"]`);
      await expect(stage).toBeVisible();
      await expect(stage.locator('.onboarding-site-preview')).toHaveAttribute('inert', '');
      const measured = await stage.locator('.onboarding-preview-frame').evaluate((element) => ({
        cssWidth: Number.parseFloat(getComputedStyle(element).width),
        rectWidth: element.getBoundingClientRect().width,
      }));
      await captureJson(`12-device-target-${device}`, {
        ...measured,
        hostViewport: page.viewportSize(),
        targetWidth,
      });
      expect(measured.cssWidth).toBe(targetWidth);
      expect(measured.rectWidth).toBeLessThanOrEqual(320);
      expect(measured.rectWidth).toBeGreaterThan(0);
      await expectNoHorizontalOverflow(page);
      if (device === 'phone') await capture(page, '42-final-phone-preview');
      if (device === 'tablet') await capture(page, '12-real-tablet-preview-on-phone');
      if (device === 'tablet') await capture(page, '43-final-tablet-preview');
      if (device === 'desktop') await capture(page, '13-real-desktop-preview-on-phone');
      if (device === 'desktop') await capture(page, '44-final-desktop-preview');
    }
  });

  test('A15-01 and A15-02 keep a complete starter choice and compact chrome in short viewports', async ({ page }) => {
    await page.setViewportSize({ height: 390, width: 844 });
    await applyFixtureFromFresh(page, 'Reduced motion', 'Choose your starting point');
    const card = page.locator('[data-starter-id="quick_book"]');
    await card.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    let cardBox = await card.boundingBox();
    const clippedBy = (cardBox?.y ?? 0) + (cardBox?.height ?? 0) - 390;
    if (clippedBy > 0) {
      await page.evaluate((delta) => window.scrollBy({ behavior: 'instant', top: Math.ceil(delta) }), clippedBy);
      cardBox = await card.boundingBox();
    }
    const scrollMetrics = await page.evaluate(() => ({
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
      scrollY: window.scrollY,
    }));
    await captureJson('16-short-landscape-starter-card-bounds', {
      card: cardBox,
      scroll: scrollMetrics,
      viewport: page.viewportSize(),
    });
    expect(cardBox?.height ?? 9999).toBeLessThanOrEqual(390);
    const headerBox = await page.locator('.onboarding-shell__header').boundingBox();
    const footerBox = await page.locator('.sticky-onboarding-actions').boundingBox();
    expect(cardBox?.y ?? -1).toBeGreaterThanOrEqual(
      (headerBox?.y ?? 0) + (headerBox?.height ?? 0),
    );
    expect((cardBox?.y ?? 9999) + (cardBox?.height ?? 0)).toBeLessThanOrEqual(
      footerBox?.y ?? 390,
    );
    await expect(card).toContainText('Quick Book');
    await expect(card).toContainText('Start taking bookings with only the essentials.');
    await expect(card).toContainText('Salon intro · Services · Booking');
    await expect(card.locator('[data-preview-type]')).toBeVisible();
    await expect(card).toContainText('Switch to Quick Book');
    await expectNoHorizontalOverflow(page);
    await capture(page, '16-short-landscape-complete-starter-card');

    await page.setViewportSize({ height: 360, width: 320 });
    await page.locator('[data-starter-id="quick_book"]').scrollIntoViewIfNeeded();
    const shellChrome = await page.evaluate(() => {
      const header = document.querySelector('.onboarding-shell__header')?.getBoundingClientRect();
      const progress = document.querySelector('.onboarding-stage-progress')?.getBoundingClientRect();
      return (header?.height ?? 0) + (progress?.height ?? 0);
    });
    expect(shellChrome).toBeLessThan(180);
    await expectNoHorizontalOverflow(page);
    await capture(page, '34-compact-320x360-chrome');
  });

  test('A15-03 and A15-05 expose every validation error and focus the first invalid field', async ({ page }) => {
    await page.setViewportSize({ height: 390, width: 844 });
    await openFresh(page);
    await page.getByRole('button', { name: 'Build my website' }).click();
    await expectAtTop(page, 'Tell us about your nail business');
    await page.getByRole('button', { exact: true, name: 'Continue' }).click();

    const summary = page.getByRole('alert').filter({ hasText: 'Check the highlighted information.' });
    await expect(summary).toContainText('3 answers need attention.');
    await expect(summary).toContainText('Add your salon or studio name.');
    await expect(summary).toContainText('Add your name.');
    await expect(summary).toContainText('Choose who you’re setting Luster up for.');
    await expect(page.getByLabel('Salon or studio name')).toBeFocused();
    const summaryBox = await summary.boundingBox();
    const stickyTop = await page.evaluate(() => Math.max(
      document.querySelector('.onboarding-shell__header')?.getBoundingClientRect().bottom ?? 0,
      document.querySelector('.onboarding-shell__progress')?.getBoundingClientRect().bottom ?? 0,
    ));
    expect(summaryBox?.y ?? -1).toBeGreaterThanOrEqual(stickyTop);
    expect((summaryBox?.y ?? 9999) + (summaryBox?.height ?? 0)).toBeLessThanOrEqual(390);
    const firstFieldBox = await page.getByLabel('Salon or studio name').boundingBox();
    const shellHeaderBox = await page.locator('.onboarding-shell__header').boundingBox();
    await captureJson('35-landscape-validation-bounds', {
      firstField: firstFieldBox,
      shellHeader: shellHeaderBox,
      summary: summaryBox,
      viewport: page.viewportSize(),
    });
    await capture(page, '35-landscape-validation-summary');

    await page.setViewportSize({ height: 360, width: 320 });
    await page.getByRole('button', { exact: true, name: 'Continue' }).click();
    await expect(page.getByLabel('Salon or studio name')).toBeFocused();
    const compactBusinessBounds = await page.evaluate(() => {
      const alert = [...document.querySelectorAll<HTMLElement>('[role="alert"]')]
        .find((element) => element.textContent?.includes('Check the highlighted information.'))
        ?.getBoundingClientRect();
      const stickyTop = Math.max(
        document.querySelector('.onboarding-shell__header')?.getBoundingClientRect().bottom ?? 0,
        document.querySelector('.onboarding-shell__progress')?.getBoundingClientRect().bottom ?? 0,
      );
      const stickyBottom = document.querySelector('.sticky-onboarding-actions')
        ?.getBoundingClientRect().top ?? 360;
      return { alertBottom: alert?.bottom ?? 9999, alertTop: alert?.top ?? -1, stickyBottom, stickyTop };
    });
    expect(compactBusinessBounds.alertTop).toBeGreaterThanOrEqual(compactBusinessBounds.stickyTop);
    expect(compactBusinessBounds.alertBottom).toBeLessThanOrEqual(compactBusinessBounds.stickyBottom);

    await page.setViewportSize({ height: 390, width: 844 });

    await page.getByLabel('Salon or studio name').fill('Validation Studio');
    await page.getByLabel('Your name').fill('Val Owner');
    await page.getByRole('radio', { name: 'Solo nail tech' }).check();
    await page.getByRole('button', { exact: true, name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByLabel('City or general service area')).toBeFocused();
    await expect(page.getByRole('button', { name: /Location.*2 issues/u })).toBeVisible();
    await expect(page.getByRole('button', { name: /Contact.*Complete/u })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Check the highlighted information.' }))
      .toContainText('2 answers need attention.');
    const locationBounds = await page.evaluate(() => {
      const alert = [...document.querySelectorAll<HTMLElement>('[role="alert"]')]
        .find((element) => element.textContent?.includes('Check the highlighted information.'))
        ?.getBoundingClientRect();
      const stickyTop = Math.max(
        document.querySelector('.onboarding-shell__header')?.getBoundingClientRect().bottom ?? 0,
        document.querySelector('.onboarding-shell__progress')?.getBoundingClientRect().bottom ?? 0,
      );
      const stickyBottom = document.querySelector('.sticky-onboarding-actions')
        ?.getBoundingClientRect().top ?? 390;
      return { alertBottom: alert?.bottom ?? 9999, alertTop: alert?.top ?? -1, stickyBottom, stickyTop };
    });
    expect(locationBounds.alertTop).toBeGreaterThanOrEqual(locationBounds.stickyTop);
    expect(locationBounds.alertBottom).toBeLessThanOrEqual(locationBounds.stickyBottom);
    await capture(page, '37-all-invalid-groups-identifiable');
  });

  test('A09-1, A10-1, A12-F1, and A13-F3 keep long identity and customer actions truthful', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1180 });
    await applyFixtureFromFresh(page, 'All essentials complete', 'Review your site');
    const longBusinessName = 'Polished Beauty Lounge and Academy of Natural Nail Art';
    await page.evaluate(({ key, name }) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) throw new Error('Missing onboarding state.');
      const state = JSON.parse(raw) as {
        profile: {
          bookingOnlyContact: boolean;
          businessName: string;
          clientContact: {
            callEnabled: boolean;
            differentTextNumber: string;
            primaryNumber: string;
            textEnabled: boolean;
            useDifferentTextNumber: boolean;
          };
          location: {
            addressVisibility: string;
            allowGeneralAreaDirections: boolean;
            cityOrArea: string;
            exactAddress: string;
          };
          preferredContact: string;
        };
      };
      state.profile.businessName = name;
      state.profile.bookingOnlyContact = false;
      state.profile.clientContact = {
        callEnabled: true,
        differentTextNumber: '416-555-0199',
        primaryNumber: '416-555-0188',
        textEnabled: true,
        useDifferentTextNumber: true,
      };
      state.profile.preferredContact = 'text';
      state.profile.location.addressVisibility = 'public';
      state.profile.location.allowGeneralAreaDirections = true;
      state.profile.location.cityOrArea = 'Toronto, Ontario';
      state.profile.location.exactAddress = '100 Queen Street West';
      window.localStorage.setItem(key, JSON.stringify(state));
    }, { key: ONBOARDING_STORAGE_KEY, name: longBusinessName });
    await page.reload();
    await expect(heading(page, 'Review your site')).toBeVisible();
    await openReadinessDrawerWhenVisible(page);
    await page.getByRole('button', { name: 'Edit About section' }).click();
    await expectAtTop(page, 'Would you like an About section?');
    const aboutPreview = page.getByLabel('About section live preview');
    await expect(aboutPreview.getByText('Private home studio').first()).toBeVisible();
    const aboutFacts = aboutPreview.locator('.onboarding-about-facts');
    await aboutFacts.scrollIntoViewIfNeeded();
    await captureLocator(aboutFacts, '27-about-business-location-facts');
    await page.getByRole('button', { name: 'Choose an About design' }).click();
    await page.getByRole('button', { name: 'Use this design' }).click();
    await page.getByRole('button', { name: 'Save policies' }).click();
    await page.getByRole('button', { name: 'Continue with Soft' }).click();
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await expectAtTop(page, 'Review your site');
    const editAbout = page.getByRole('button', { name: 'Edit About section' });
    await expect(editAbout).toBeVisible();
    await editAbout.evaluate((button) => button.closest('li')?.scrollIntoView({ block: 'center' }));
    await captureLocator(editAbout.locator('xpath=..'), '33-final-review-edit-about');

    const deviceControls = page.getByRole('group', { name: 'Customer preview device size' });
    await deviceControls.getByRole('button', { name: 'Desktop' }).click();
    const desktopPreview = page.getByLabel('Final desktop customer preview');
    const headerGeometry = await desktopPreview.evaluate((element) => {
      const brand = element.querySelector('.onboarding-customer-brand')?.getBoundingClientRect();
      const navigation = element.querySelector('.onboarding-customer-header nav')?.getBoundingClientRect();
      return {
        brand: brand ? {
          bottom: brand.bottom,
          left: brand.left,
          right: brand.right,
          top: brand.top,
        } : null,
        navigation: navigation ? {
          bottom: navigation.bottom,
          left: navigation.left,
          right: navigation.right,
          top: navigation.top,
        } : null,
      };
    });
    expect(headerGeometry.brand).not.toBeNull();
    expect(headerGeometry.navigation).not.toBeNull();
    expect(
      (headerGeometry.brand?.right ?? 0) <= (headerGeometry.navigation?.left ?? 0)
      || (headerGeometry.brand?.bottom ?? 0) <= (headerGeometry.navigation?.top ?? 0)
      || (headerGeometry.navigation?.bottom ?? 0) <= (headerGeometry.brand?.top ?? 0),
    ).toBe(true);
    await capture(page, '17-long-brand-no-navigation-overlap');

    await deviceControls.getByRole('button', { name: 'Phone' }).click();
    const inlinePhonePreview = page.getByLabel('Final phone customer preview');
    const inlinePreviewFrame = inlinePhonePreview.locator('.onboarding-preview-frame');
    const inlineContactActions = inlinePhonePreview.locator(
      '.onboarding-customer-contact .onboarding-customer-actions',
    );
    await inlineContactActions.evaluate((element) => {
      const frame = element.closest<HTMLElement>('.onboarding-preview-frame');
      const contact = element.closest<HTMLElement>('.onboarding-customer-contact');
      if (frame && contact) frame.scrollTop = Math.max(0, contact.offsetTop - 24);
    });
    await expect(inlineContactActions).toContainText('Call');
    await expect(inlineContactActions).toContainText('Text · Preferred');
    await captureLocator(inlinePreviewFrame, '28-both-call-and-text-actions');

    await page.getByRole('button', { name: 'Open interactive preview' }).click();
    const fullPreview = page.getByRole('dialog', { name: 'Preview your site' });
    await fullPreview.getByRole('group', { name: 'Preview device' })
      .getByRole('button', { name: 'Desktop' })
      .click();
    await expect(fullPreview).toContainText(longBusinessName);
    await expect(fullPreview.getByRole('link', { name: 'Call' })).toBeVisible();
    await expect(fullPreview.getByRole('link', { name: 'Text · Preferred' })).toBeVisible();
    await fullPreview.getByRole('group', { name: 'Preview device' })
      .getByRole('button', { name: 'Phone' })
      .click();
    const contactSection = fullPreview.locator('.onboarding-customer-contact');
    const contactActions = contactSection.locator(':scope > .onboarding-customer-actions');
    await contactActions.scrollIntoViewIfNeeded();
    const directions = fullPreview.getByRole('link', { name: /Directions to 100 Queen Street West/u });
    await expect(directions).toHaveAttribute('href', /google\.com\/maps/u);
    const directionsHref = await directions.getAttribute('href');
    await page.context().route('**/maps/**', async (route) => {
      await route.fulfill({ body: '<title>Directions test</title>', contentType: 'text/html' });
    });
    await directions.focus();
    const [directionsPage] = await Promise.all([
      page.context().waitForEvent('page'),
      page.keyboard.press('Enter'),
    ]);
    await directionsPage.waitForLoadState('domcontentloaded');
    const openedDirectionsUrl = directionsPage.url();
    expect(openedDirectionsUrl).toMatch(/google\.com\/maps/u);
    await directionsPage.close();
    await fullPreview.getByRole('button', { name: 'Return to setup' }).click();
    await expect(fullPreview).toBeHidden();
    await captureLocator(inlinePreviewFrame, '32-working-directions-action');
    await captureJson('32-working-directions-action', {
      href: directionsHref,
      openedUrl: openedDirectionsUrl,
    });
  });

  test('A04-3, A05-F1, and A16-4 preserve immediate edits and meaningful menu/pause focus', async ({ page }) => {
    await page.setViewportSize({ height: 568, width: 320 });
    await openFresh(page);
    await page.getByRole('button', { name: 'Build my website' }).click();
    await expectAtTop(page, 'Tell us about your nail business');

    const businessName = page.getByLabel('Salon or studio name');
    await businessName.pressSequentially('Immediate Pagehide Studio', { delay: 4 });
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await page.reload();
    await expect(heading(page, 'Tell us about your nail business')).toBeVisible();
    await expect(businessName).toHaveValue('Immediate Pagehide Studio');

    const more = page.getByLabel('More onboarding options');
    await more.focus();
    await page.keyboard.press('Enter');
    const saveForLater = page.getByRole('menuitem', { name: 'Save and finish later' });
    await expect(saveForLater).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Start over' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
    await capture(page, '39-more-closes-on-tab-out');

    await more.focus();
    await page.keyboard.press('Enter');
    await expect(saveForLater).toBeFocused();
    await page.keyboard.press('Enter');
    const pausedHeading = heading(page, 'Setup saved');
    await expect(pausedHeading).toBeFocused();
    await expect(page.getByRole('status')).toContainText('Your setup is saved.');
    await capture(page, '26-setup-saved-focus');
    await page.reload();
    await expect(pausedHeading).toBeFocused();
    await page.getByRole('button', { name: 'Resume setup' }).click();
    await expectAtTop(page, 'Tell us about your nail business');
  });

  test('A11-1–A11-3 and A16-3 make the writing helper dismissible, focused, and revision-safe', async ({ page }) => {
    await page.setViewportSize({ height: 600, width: 375 });
    await applyFixtureFromFresh(page, 'All essentials complete', 'Review your site');
    await openReadinessDrawerWhenVisible(page);
    await page.getByRole('button', { name: 'Edit About section' }).click();
    await expectAtTop(page, 'Would you like an About section?');
    const bio = page.getByLabel('Short bio');
    const originalBio = await bio.inputValue();
    const helper = page.getByRole('button', { name: /Help me with wording/u });

    await helper.click();
    let dialog = page.getByRole('dialog', { name: 'Use this suggested bio?' });
    await expect(dialog.getByRole('heading', { name: 'Use this suggested bio?' })).toBeFocused();
    await expect(dialog).toContainText('Current bio');
    await expect(dialog).toContainText('Suggested bio');
    await captureLocator(dialog, '38-writing-helper-announced-dialog');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(helper).toBeFocused();
    await expect(bio).toHaveValue(originalBio);
    await capture(page, '29-writing-helper-escape');

    await helper.click();
    dialog = page.getByRole('dialog', { name: 'Use this suggested bio?' });
    await dialog.getByRole('button', { name: 'Use suggestion' }).click();
    await expect(dialog).toBeHidden();
    await expect(bio).toBeFocused();
    await expect(bio).toHaveValue(/^(?:Hi, )?I’m Daniela/u);
    await capture(page, '30-writing-helper-focus');

    await bio.pressSequentially(' This is my later edit.', { delay: 4 });
    await expect(page.getByRole('button', { name: 'Undo suggestion' })).toHaveCount(0);
    await expect(page.getByText(
      'Your bio changed, so the earlier suggestion can no longer be undone.',
      { exact: true },
    )).toHaveAttribute('role', 'status');
    await expect(bio).toHaveValue(/This is my later edit\.$/u);
    await capture(page, '31-writing-helper-safe-undo');
  });

  test('A07-1 reports Gallery partial failures with filenames and reasons', async ({ page }) => {
    await page.setViewportSize({ height: 600, width: 375 });
    await applyFixtureFromFresh(page, 'Canva intent', 'Add something extra');
    await page.getByRole('button', { name: 'Add Gallery' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Gallery' });
    const validJpeg = await readFile(PORTRAIT_PATH);
    await dialog.locator('input[type="file"]').setInputFiles([
      {
        buffer: validJpeg,
        mimeType: 'image/jpeg',
        name: 'valid-gallery.jpg',
      },
      {
        buffer: Buffer.from('not a decodable image'),
        mimeType: 'image/png',
        name: 'broken-gallery.png',
      },
    ]);
    const result = dialog.getByRole('alert');
    await expect(result).toContainText('1 image was added and 1 was skipped.');
    await expect(result).toContainText('broken-gallery.png');
    await expect(result).toContainText('This image couldn’t be opened. Try exporting or selecting it again.');
    await expect(dialog.locator('.onboarding-gallery-draft-list img')).toHaveCount(1);
    await captureLocator(result, '18-gallery-failure-filenames');
  });

  test('A08-F1–F4 make Canva upload results and shared re-edit controls complete', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1180 });
    await applyFixtureFromFresh(page, 'Canva intent', 'Add something extra');
    let dialog = await openCanvaDialog(page);
    await expect(dialog.locator('input[type="file"]')).toHaveClass(/visually-hidden/u);
    await expect(dialog.getByText('Choose Canva pages')).toHaveCount(1);
    await dialog.locator('input[type="file"]').setInputFiles([
      {
        buffer: ONE_PIXEL_PNG,
        mimeType: 'image/png',
        name: 'canva-valid-1.png',
      },
      {
        buffer: Buffer.from('broken canva bytes'),
        mimeType: 'image/png',
        name: 'canva-broken.png',
      },
    ]);
    await dialog.getByRole('button', { name: 'Add Canva design' }).click();
    const uploadResult = dialog.getByRole('status', { name: 'Canva upload result' });
    await expect(uploadResult).toContainText(/1 image was added/u);
    await expect(uploadResult).toContainText('canva-broken.png');
    await expect(uploadResult).toContainText('This image couldn’t be opened');
    await expect(dialog.locator('[data-image-item-id]')).toHaveCount(1);
    await captureLocator(uploadResult, '21-canva-partial-failure-rows');

    const chooseMoreInput = dialog.getByText('Choose more images')
      .locator('input[type="file"]');
    await chooseMoreInput.setInputFiles({
      buffer: ONE_PIXEL_PNG,
      mimeType: 'image/png',
      name: 'canva-valid-2.png',
    });
    await expect(dialog.locator('[data-image-item-id]')).toHaveCount(2);
    await dialog.getByRole('button', { name: 'Move page 2 up' }).click();
    await dialog.getByRole('button', { name: 'Save order' }).click();
    await dialog.locator('[data-image-item-id]').nth(1).getByRole('button', { name: 'Remove' }).click();
    await expect(dialog.locator('[data-image-item-id]')).toHaveCount(1);
    await dialog.getByRole('radio', { name: 'Full width' }).check();
    await dialog.getByRole('radio', { name: 'Before Booking' }).check();
    await dialog.getByRole('button', { name: 'Save Canva design' }).click();
    await expect(dialog).toBeHidden();
    await waitForSaved(page);

    dialog = await openCanvaDialog(page);
    await expect(dialog.locator('[data-image-item-id]')).toHaveCount(1);
    await expect(dialog.getByRole('radio', { name: 'Full width' })).toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Remove' })).toBeVisible();
    await expect(dialog.getByText('Replace')).toBeVisible();
    await capture(page, '22-canva-shared-reedit-image-manager');
    await dialog.getByRole('radio', { name: 'Poster' }).check();
    await dialog.getByRole('button', { name: 'Save Canva design' }).click();
    await expect(dialog).toBeHidden();
    await waitForSaved(page);
    await expect.poll(async () => (await readState(page)).canva.displayMode).toBe('poster');
    await capture(page, '23-canva-settings-only-save');

    await page.getByRole('button', { name: 'Continue to review' }).click();
    await expectAtTop(page, 'Review your site');
    await page.getByRole('group', { name: 'Customer preview device size' })
      .getByRole('button', { name: 'Desktop' })
      .click();
    let rendered = page.locator('[data-onboarding-custom-design-mode="poster"]');
    let imageStack = rendered.locator('[data-display-mode="poster"] .custom-design-image-stack');
    await expect(imageStack).toBeVisible();
    const posterWidth = (await imageStack.boundingBox())?.width ?? 0;
    await capture(page, '19-canva-poster-mode');

    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await expectAtTop(page, 'Add something extra');
    await page.getByRole('button', { name: 'Edit design' }).click();
    dialog = page.getByRole('dialog', { name: 'Upload a Canva design' });
    await dialog.getByRole('radio', { name: 'Contained' }).check();
    await dialog.getByRole('button', { name: 'Save Canva design' }).click();
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await page.getByRole('group', { name: 'Customer preview device size' })
      .getByRole('button', { name: 'Desktop' })
      .click();
    rendered = page.locator('[data-onboarding-custom-design-mode="contained"]');
    imageStack = rendered.locator('[data-display-mode="contained"] .custom-design-image-stack');
    await expect(imageStack).toBeVisible();
    const containedWidth = (await imageStack.boundingBox())?.width ?? 0;
    await capture(page, '19-canva-contained-mode');

    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await page.getByRole('button', { name: 'Edit design' }).click();
    dialog = page.getByRole('dialog', { name: 'Upload a Canva design' });
    await dialog.getByRole('radio', { name: 'Full width' }).check();
    await dialog.getByRole('button', { name: 'Save Canva design' }).click();
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await page.getByRole('group', { name: 'Customer preview device size' })
      .getByRole('button', { name: 'Desktop' })
      .click();
    rendered = page.locator('[data-onboarding-custom-design-mode="full_width"]');
    imageStack = rendered.locator('[data-display-mode="full_width"] .custom-design-image-stack');
    await expect(imageStack).toBeVisible();
    const fullWidth = (await imageStack.boundingBox())?.width ?? 0;
    expect(posterWidth).toBeGreaterThan(0);
    expect(containedWidth).toBeGreaterThan(posterWidth);
    expect(fullWidth).toBeGreaterThan(containedWidth);
    await captureJson('19-canva-display-mode-widths', {
      contained: containedWidth,
      fullWidth,
      poster: posterWidth,
    });
    await capture(page, '19-canva-full-width-mode');
  });

  test('A08-F2 reports over-cap Canva filenames and never saves more than ten pages', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1180 });
    await applyFixtureFromFresh(page, 'Canva intent', 'Add something extra');
    const dialog = await openCanvaDialog(page);
    const files = Array.from({ length: 12 }, (_, index) => ({
      buffer: ONE_PIXEL_PNG,
      mimeType: 'image/png',
      name: `canva-page-${String(index + 1).padStart(2, '0')}.png`,
    }));
    await dialog.locator('input[type="file"]').setInputFiles(files);
    await dialog.getByRole('button', { name: 'Add Canva design' }).click();
    const result = dialog.getByRole('status', { name: 'Canva upload result' });
    await expect(result).toContainText('up to 10 images');
    await expect(result).toContainText('10 images were added and 2 were skipped');
    await expect(result).toContainText('canva-page-11.png');
    await expect(result).toContainText('canva-page-12.png');
    await expect(dialog.locator('[data-image-item-id]')).toHaveCount(10);
    await expect.poll(async () => (await readState(page)).canva.images.length).toBe(10);
    await captureLocator(result, '20-canva-over-cap-filenames');
  });

  test('A08-F5 surfaces a missing Canva asset before Builder handoff', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1180 });
    await applyFixtureFromFresh(page, 'Canva intent', 'Add something extra');
    const dialog = await openCanvaDialog(page);
    await addValidCanvaPage(dialog, 'missing-before-builder.png');
    await clearCustomDesignAssets(page);
    await page.reload();
    await expectAtTop(page, 'Add something extra');
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await expectAtTop(page, 'Review your site');
    const readiness = page.getByLabel('Site readiness');
    await expect(readiness).toContainText('Needs attention');
    await expect(readiness).toContainText('missing-before-builder.png');
    await expect(readiness).toContainText('Replace');
    await expect(page.getByRole('button', { name: 'Resolve 1 issue' })).toBeVisible();
    await capture(page, '24-missing-canva-asset-readiness');
  });

  test('Journey I completes the full onboarding and free dashboard handoff with keyboard input only', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1180 });
    await openFresh(page);
    await activateWithKeyboard(page.getByRole('button', { name: 'Build my website' }));
    await expectAtTop(page, 'Tell us about your nail business');

    await page.getByLabel('Salon or studio name').focus();
    await page.keyboard.type('Keyboard Nail Studio');
    await page.getByLabel('Your name').focus();
    await page.keyboard.type('Kai');
    await page.getByRole('radio', { name: 'Solo nail tech' }).focus();
    await page.keyboard.press('Space');
    await activateWithKeyboard(page.getByRole('button', { exact: true, name: 'Continue' }));
    await expectAtTop(page, 'Add your photo and Instagram');

    await activateWithKeyboard(page.getByRole('button', { name: 'Skip for now' }));
    await expectAtTop(page, 'Where can clients find you?');
    await page.getByLabel('City or general service area').focus();
    await page.keyboard.type('Hamilton, Ontario');
    await page.getByRole('radio', { name: 'Salon suite' }).focus();
    await page.keyboard.press('Space');
    await activateWithKeyboard(page.locator(
      'button[aria-controls="onboarding-contact-card-panel"]',
    ));
    await expect(page.getByRole('switch', { name: 'Clients should use online booking only' }))
      .toBeChecked();
    await activateWithKeyboard(page.getByRole('button', { name: 'Save and continue' }));
    await expectAtTop(page, 'How do clients book with you?');

    await page.getByRole('radio', { name: 'Appointment only' }).focus();
    await page.keyboard.press('Space');
    await page.getByRole('group', { name: 'Accepting new clients' })
      .getByRole('radio', { name: 'Yes' }).focus();
    await page.keyboard.press('Space');
    await activateWithKeyboard(page.getByRole('button', {
      name: 'Save booking setup',
    }));
    await expectAtTop(page, 'Choose your starting point');

    await activateWithKeyboard(page.getByRole('button', { name: /^Quick Book/u }));
    await expectAtTop(page, 'Your starting site is ready');
    await activateWithKeyboard(page.getByRole('button', {
      name: 'Continue setting up my site',
    }));
    await expectAtTop(page, 'Would you like an About section?');
    await page.getByRole('switch', { name: 'Include an About section' }).focus();
    await page.keyboard.press('Space');
    await activateWithKeyboard(page.getByRole('button', {
      name: 'Continue without About',
    }));
    await expectAtTop(page, 'Set clear expectations');

    await activateWithKeyboard(page.getByRole('button', { name: 'Skip for now' }));
    await expectAtTop(page, 'Choose your website style');
    await expect(page.locator(
      '[data-screen="site_style"] [data-preview-interaction="inline"] .onboarding-site-preview',
    )).toHaveAttribute('inert', '');
    await activateWithKeyboard(page.getByRole('button', { name: 'Use Modern' }));
    await expectAtTop(page, 'Add something extra');
    await activateWithKeyboard(page.getByRole('button', { name: 'Continue to review' }));
    await expectAtTop(page, 'Review your site');

    let tabsToFinish = 0;
    while (tabsToFinish < 25) {
      await page.keyboard.press('Tab');
      tabsToFinish += 1;
      const activeName = await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-label')
        ?? document.activeElement?.textContent?.trim()
        ?? '');
      if (activeName.includes('Finish setup')) break;
    }
    expect(tabsToFinish).toBeLessThan(25);
    await expect(page.getByRole('button', { name: 'Finish setup' })).toBeFocused();
    await page.keyboard.press('Enter');

    const plan = page.getByRole('dialog', { name: 'Your site is saved' });
    await expect(plan.getByRole('heading', { name: 'Your site is saved' })).toBeFocused();
    let tabsToFree = 0;
    while (tabsToFree < 12) {
      await page.keyboard.press('Tab');
      tabsToFree += 1;
      if (await plan.getByRole('button', { name: 'Continue free' }).evaluate(
        (element) => element === document.activeElement,
      )) break;
    }
    expect(tabsToFree).toBeLessThan(12);
    await expect(plan.getByRole('button', { name: 'Continue free' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Welcome to your Luster workspace' }))
      .toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Your Luster site is ready' }))
      .toBeFocused();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('final Reset restores a clean Welcome and removes only onboarding-owned state', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await applyFixtureFromFresh(page, 'Canva intent', 'Add something extra');
    const dialog = await openCanvaDialog(page);
    await addValidCanvaPage(dialog, 'reset-owned-canva.png');
    await page.evaluate(() => window.localStorage.setItem(
      'luster:onboarding-zero-findings:unrelated-sentinel',
      'preserve-me',
    ));

    await page.getByLabel('More onboarding options').click();
    await page.getByRole('menuitem', { name: 'Start over' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Start over?' });
    await confirmation.getByRole('button', {
      exact: true,
      name: 'Start over',
    }).click();

    await expect(heading(page, 'Let’s build your website')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => page.evaluate(
      (key) => window.localStorage.getItem(key),
      'luster:onboarding-zero-findings:unrelated-sentinel',
    )).toBe('preserve-me');
    await expect.poll(() => page.evaluate(
      (key) => window.localStorage.getItem(key),
      LAB_STORAGE_KEY,
    )).toBeNull();
    await expect.poll(async () => Object.values(
      await readCustomDesignAssetRecordCounts(page),
    ).reduce((total, count) => total + count, 0)).toBe(0);
    const restoredRaw = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      ONBOARDING_STORAGE_KEY,
    );
    if (restoredRaw !== null) {
      const restored = JSON.parse(restoredRaw) as StoredState & {
        eventJournal: Array<{ type: string }>;
      };
      expect(restored.profile.businessName).toBe('');
      expect(restored.recipe.starter).toBeNull();
      expect(restored.canva.images).toHaveLength(0);
      expect(restored.progress.currentScreen).toBe('welcome');
      expect(restored.eventJournal.length).toBeLessThanOrEqual(1);
      if (restored.eventJournal[0]) {
        expect(restored.eventJournal[0].type).toBe('screen_viewed');
      }
    } else {
      expect(restoredRaw).toBeNull();
    }
    await expectNoHorizontalOverflow(page);
    await capture(page, '46-clean-welcome-restoration');

    await page.evaluate(() => window.localStorage.removeItem(
      'luster:onboarding-zero-findings:unrelated-sentinel',
    ));
  });

  test('@webkit-smoke shared Canva storage supports thumbnails, reload, mode edit, and removal', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1180 });
    await applyFixtureFromFresh(page, 'Canva intent', 'Add something extra');
    let dialog = await openCanvaDialog(page);
    await addValidCanvaPage(dialog, 'webkit-canva.png');
    const countsBefore = await readCustomDesignAssetRecordCounts(page);
    expect(Object.values(countsBefore).some((count) => count > 0)).toBe(true);

    await page.reload();
    await expectAtTop(page, 'Add something extra');
    dialog = await openCanvaDialog(page);
    await expect(dialog.locator('[data-image-item-id] img')).toBeVisible();
    await expect(dialog).toContainText('webkit-canva.png');
    await dialog.getByRole('radio', { name: 'Full width' }).check();
    await dialog.getByRole('button', { name: 'Save Canva design' }).click();
    await expect.poll(async () => (await readState(page)).canva.displayMode).toBe('full_width');

    dialog = await openCanvaDialog(page);
    await dialog.getByRole('button', { name: 'Remove' }).click();
    await expect(dialog).toContainText('Remove this Canva design?');
    await dialog.getByRole('button', { name: 'Remove design' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await readState(page)).canva.images.length).toBe(0);
    await expect.poll(async () => {
      const document = await readDocument(page);
      return document.pages.flatMap((item) => item.sections)
        .filter((section) => section.sectionType === 'custom_design').length;
    }).toBe(0);
  });
});
