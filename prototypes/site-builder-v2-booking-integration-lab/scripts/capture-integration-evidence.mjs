import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const labDirectory = resolve(scriptDirectory, '..');
const outputDirectory = resolve(labDirectory, 'artifacts/screenshots');
const baseUrl = process.env.LUSTER_LAB_URL ?? 'http://127.0.0.1:4182';

const mobileViewport = { width: 375, height: 600 };
const desktopViewport = { width: 1440, height: 1000 };

const evidence = {
  mobileQuickVisual: '01-mobile-quick-book-visual.png',
  mobileBookingSelected: '02-mobile-booking-selected.png',
  mobileSettings: '03-mobile-booking-settings-sheet.png',
  mobileLayoutChooser: '04-mobile-layout-chooser.png',
  mobileVisual: '05-mobile-preview-visual.png',
  mobileList: '06-mobile-preview-list.png',
  mobileEditorial: '07-mobile-preview-editorial.png',
  mobileCategories: '08-mobile-preview-categories.png',
  mobilePriceList: '09-mobile-preview-price-list.png',
  mobileStructure: '10-mobile-pages-structure-booking.png',
  mobileReorder: '11-mobile-reorder-booking.png',
  mobileServiceDetail: '12-mobile-preview-service-detail.png',
  mobileSummary: '13-mobile-preview-selected-summary.png',
  mobileMoved: '14-mobile-booking-moved-services.png',
  desktopEditor: '15-desktop-default-editor.png',
  desktopSelected: '16-desktop-booking-selected.png',
  desktopSettings: '17-desktop-booking-settings-drawer.png',
  desktopVisual: '18-desktop-preview-visual.png',
  desktopList: '19-desktop-preview-list.png',
  desktopEditorial: '20-desktop-preview-editorial.png',
  desktopCategories: '21-desktop-preview-categories.png',
  desktopPriceList: '22-desktop-preview-price-list.png',
  desktopStructure: '23-desktop-pages-structure.png',
  desktopReorder: '24-desktop-reorder.png',
  desktopServiceDetail: '25-desktop-service-detail.png',
  desktopSummary: '26-desktop-selected-summary.png',
  desktopDevices: '27-desktop-device-preview-controls.png',
  mobileLayoutsComparison: '28-comparison-all-five-mobile.png',
  desktopLayoutsComparison: '29-comparison-all-five-desktop.png',
  mobileModesComparison: '30-comparison-mobile-edit-reorder-preview.png',
  desktopModesComparison: '31-comparison-desktop-edit-preview.png',
  partialImages: '32-edge-partial-images.png',
  noImages: '33-edge-no-images.png',
  longName: '34-edge-long-service-name.png',
  hundredServices: '35-edge-100-service-category-menu.png',
  narrow320: '36-edge-320px.png',
};

const layoutEvidence = {
  visual_grid: { mobile: evidence.mobileVisual, desktop: evidence.desktopVisual },
  clean_list: { mobile: evidence.mobileList, desktop: evidence.desktopList },
  editorial_cards: { mobile: evidence.mobileEditorial, desktop: evidence.desktopEditorial },
  category_menu: { mobile: evidence.mobileCategories, desktop: evidence.desktopCategories },
  editorial_price_list: { mobile: evidence.mobilePriceList, desktop: evidence.desktopPriceList },
};

const layoutLabels = {
  visual_grid: 'Visual Grid',
  clean_list: 'Clean List',
  editorial_cards: 'Editorial Cards',
  category_menu: 'Category Menu',
  editorial_price_list: 'Editorial Price List',
};

function outputPath(name) {
  return resolve(outputDirectory, name);
}

async function preparePage(browser, viewport) {
  const context = await browser.newContext({
    colorScheme: 'light',
    deviceScaleFactor: 1,
    locale: 'en-CA',
    reducedMotion: 'reduce',
    timezoneId: 'America/Toronto',
    viewport,
  });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
    `,
  });
  return { context, page };
}

async function capture(page, name, options = {}) {
  const target = options.locator ?? page;
  if (options.locator) {
    await options.locator.scrollIntoViewIfNeeded();
  }
  await page.mouse.move(1, 1);
  await page.waitForTimeout(180);
  await target.screenshot({
    animations: 'disabled',
    path: outputPath(name),
    ...options.screenshot,
  });
}

async function waitForToastGone(page) {
  const toast = page.locator('.toast');
  if (await toast.isVisible()) {
    await toast.waitFor({ state: 'detached', timeout: 5_000 });
  }
}

async function assertFullyInViewport(locator, label) {
  const visible = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0
      && rect.left >= 0
      && rect.bottom <= window.innerHeight
      && rect.right <= window.innerWidth;
  });
  if (!visible) {
    throw new Error(`${label} was not fully visible in the viewport without scrolling.`);
  }
}

async function chooseQuickBook(page) {
  await page.getByRole('button', { name: /Quick Book/ }).click();
  await page.getByTestId('final-hybrid-editor').waitFor();
  const starterToast = page.locator('.toast');
  if (await starterToast.isVisible()) {
    await starterToast.waitFor({ state: 'detached', timeout: 5_000 });
  }
}

function bookingArticle(page) {
  return page.locator('article[data-section-type="booking"]');
}

async function scrollEditorBookingIntoView(page) {
  await bookingArticle(page).evaluate(element => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, top - 76), behavior: 'instant' });
  });
  await page.waitForTimeout(80);
}

async function selectBooking(page, formFactor) {
  const article = bookingArticle(page);
  const selectSurface = article.locator('.section-card__select-surface');
  if (await selectSurface.getAttribute('aria-pressed') !== 'true') {
    await selectSurface.click();
  }
  const actions = formFactor === 'mobile'
    ? page.locator('.final-mobile-dock__selected')
    : article.locator('.section-context-toolbar');
  await actions.waitFor({ state: 'visible' });
  await page.waitForTimeout(250);
}

async function openBookingSettings(page, formFactor) {
  await scrollEditorBookingIntoView(page);
  await selectBooking(page, formFactor);
  const actionScope = formFactor === 'mobile'
    ? page.locator('.final-mobile-dock__selected')
    : bookingArticle(page).locator('.section-context-toolbar');
  await actionScope.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByTestId('booking-settings-panel').waitFor({ state: 'visible' });
}

async function closeBookingSettings(page) {
  await page.getByRole('button', { name: 'Close Booking' }).click();
  await page.getByTestId('booking-settings-panel').waitFor({ state: 'detached' });
}

async function setLayout(page, layout) {
  const option = page.locator(`[data-layout-option="${layout}"]`);
  await option.scrollIntoViewIfNeeded();
  await option.click();
  await page.locator(`.booking-surface[data-layout="${layout}"]`).first().waitFor();
  await page.waitForTimeout(120);
}

async function enterPreview(page) {
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByTestId('preview-stage').waitFor({ state: 'visible' });
  await page.waitForTimeout(100);
}

async function backToEditor(page) {
  await page.getByRole('button', { name: 'Back to editor' }).click();
  await page.getByTestId('final-hybrid-editor').waitFor({ state: 'visible' });
  await page.waitForTimeout(100);
}

async function scrollPreviewBookingIntoView(page) {
  const booking = page.locator('.preview-section--booking');
  await booking.evaluate(element => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, top - 72), behavior: 'instant' });
  });
  await page.waitForTimeout(120);
}

async function capturePreviewLayout(page, name) {
  await scrollPreviewBookingIntoView(page);
  await capture(page, name);
}

async function switchLayoutAndCapturePreview(page, formFactor, layout, name) {
  await openBookingSettings(page, formFactor);
  await setLayout(page, layout);
  await closeBookingSettings(page);
  await enterPreview(page);
  await capturePreviewLayout(page, name);
  await backToEditor(page);
}

async function openRussianDetail(page) {
  const action = page.getByRole('button', { name: /View details for Russian Manicure/ }).first();
  await action.scrollIntoViewIfNeeded();
  await action.click();
  await page.getByTestId('service-detail-dialog').waitFor({ state: 'visible' });
}

async function createCollage(browser, name, entries, options = {}) {
  const width = options.width ?? 1500;
  const tileColumns = options.columns ?? entries.length;
  const tileWidth = Math.floor((width - 64 - (tileColumns - 1) * 16) / tileColumns);
  const encoded = await Promise.all(entries.map(async entry => ({
    ...entry,
    source: `data:image/png;base64,${(await readFile(outputPath(entry.file))).toString('base64')}`,
  })));
  const rows = Math.ceil(encoded.length / tileColumns);
  const context = await browser.newContext({ viewport: { width, height: 1200 } });
  const page = await context.newPage();
  await page.setContent(`<!doctype html>
    <html><head><style>
      * { box-sizing: border-box; }
      body { margin: 0; padding: 32px; background: #f4ede4; color: #35251f; font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; }
      h1 { margin: 0 0 24px; font-family: Georgia, serif; font-size: 28px; font-weight: 500; }
      .grid { display: grid; grid-template-columns: repeat(${tileColumns}, minmax(0, 1fr)); gap: 16px; align-items: start; }
      figure { margin: 0; padding: 10px; border: 1px solid #d9c8b8; border-radius: 16px; background: #fffaf4; box-shadow: 0 8px 30px rgb(62 38 27 / 8%); }
      img { display: block; width: 100%; height: ${options.tileHeight ?? 620}px; object-fit: contain; object-position: top center; border-radius: 9px; border: 1px solid #eadfd3; background: #f2eee9; }
      figcaption { padding: 10px 4px 2px; text-align: center; font-size: 13px; font-weight: 700; letter-spacing: .02em; }
    </style></head><body>
      <h1>${options.title ?? 'Luster Integration Lab evidence'}</h1>
      <div class="grid">${encoded.map(entry => `<figure><img alt="" src="${entry.source}" width="${tileWidth}"><figcaption>${entry.label}</figcaption></figure>`).join('')}</div>
    </body></html>`);
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: outputPath(name),
  });
  await context.close();
  return rows;
}

async function captureMobile(browser) {
  const { context, page } = await preparePage(browser, mobileViewport);
  try {
    await chooseQuickBook(page);
    await scrollEditorBookingIntoView(page);
    await capture(page, evidence.mobileQuickVisual);

    await selectBooking(page, 'mobile');
    await capture(page, evidence.mobileBookingSelected);

    await page.locator('.final-mobile-dock__selected').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByTestId('booking-settings-panel').waitFor();
    await capture(page, evidence.mobileSettings);
    const chooser = page.locator('.booking-layout-picker');
    await chooser.scrollIntoViewIfNeeded();
    await capture(page, evidence.mobileLayoutChooser);
    await closeBookingSettings(page);

    for (const [layout, file] of Object.entries(layoutEvidence)) {
      await switchLayoutAndCapturePreview(page, 'mobile', layout, file.mobile);
    }

    await waitForToastGone(page);
    await page.getByRole('button', { name: /Open Pages & Structure/ }).click();
    await page.getByTestId('structure-tree').waitFor();
    await capture(page, evidence.mobileStructure);
    await page.getByRole('button', { name: 'Reorder sections' }).click();
    await page.getByRole('heading', { name: 'Reorder sections' }).waitFor();
    await capture(page, evidence.mobileReorder);
    await page.locator('.final-mobile-dock__reorder').getByRole('button', { name: 'Cancel' }).click();

    await openBookingSettings(page, 'mobile');
    await setLayout(page, 'visual_grid');
    await closeBookingSettings(page);
    await enterPreview(page);
    await openRussianDetail(page);
    await capture(page, evidence.mobileServiceDetail);
    await page.getByRole('checkbox', { name: /French/ }).check();
    await page.getByRole('button', { name: 'Select service' }).click();
    const summary = page.getByTestId('selected-service-summary');
    await summary.waitFor();
    await assertFullyInViewport(summary, 'Mobile selected-service summary');
    await capture(page, evidence.mobileSummary);
    await backToEditor(page);

    await scrollEditorBookingIntoView(page);
    await selectBooking(page, 'mobile');
    await page.locator('.final-mobile-dock__selected').getByRole('button', { name: 'Move', exact: true }).click();
    const moveDialog = page.getByRole('dialog', { name: 'Move Booking' });
    await moveDialog.getByPlaceholder('Page name').fill('Services');
    await moveDialog.getByRole('button', { name: 'Create page and move' }).click();
    const navigationDialog = page.getByRole('dialog', { name: 'Add a menu?' });
    await navigationDialog.getByRole('button', { name: 'Add menu' }).click();
    await waitForToastGone(page);
    await scrollEditorBookingIntoView(page);
    await capture(page, evidence.mobileMoved);
  } finally {
    await context.close();
  }
}

async function captureDesktop(browser) {
  const { context, page } = await preparePage(browser, desktopViewport);
  try {
    await chooseQuickBook(page);
    await scrollEditorBookingIntoView(page);
    await capture(page, evidence.desktopEditor);
    await selectBooking(page, 'desktop');
    await capture(page, evidence.desktopSelected);
    await bookingArticle(page).locator('.section-context-toolbar').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByTestId('booking-settings-panel').waitFor();
    await capture(page, evidence.desktopSettings);
    await closeBookingSettings(page);

    for (const [layout, file] of Object.entries(layoutEvidence)) {
      await switchLayoutAndCapturePreview(page, 'desktop', layout, file.desktop);
    }

    await waitForToastGone(page);
    await page.getByRole('button', { name: /Open Pages & Structure/ }).click();
    await page.getByTestId('structure-tree').waitFor();
    await capture(page, evidence.desktopStructure);
    await page.getByRole('button', { name: 'Reorder sections' }).click();
    await page.getByRole('heading', { name: 'Reorder sections' }).waitFor();
    await capture(page, evidence.desktopReorder);
    await page.locator('.final-reorder-desktop-actions').getByRole('button', { name: 'Cancel' }).click();

    await openBookingSettings(page, 'desktop');
    await setLayout(page, 'visual_grid');
    await closeBookingSettings(page);
    await enterPreview(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(page, evidence.desktopDevices);
    await openRussianDetail(page);
    await capture(page, evidence.desktopServiceDetail);
    await page.getByRole('checkbox', { name: /French/ }).check();
    await page.getByRole('button', { name: 'Select service' }).click();
    const summary = page.getByTestId('selected-service-summary');
    await summary.waitFor();
    await assertFullyInViewport(summary, 'Desktop selected-service summary');
    await capture(page, evidence.desktopSummary);
  } finally {
    await context.close();
  }
}

async function setLabFixture(page, { images, menu }) {
  await page.getByRole('button', { name: 'More site options' }).click();
  const moreDialog = page.getByRole('dialog', { name: 'More' });
  if (images) {
    await moreDialog.getByLabel('Booking service photo fixture').selectOption(images);
  }
  if (menu) {
    await moreDialog.getByLabel('Booking service menu fixture').selectOption(menu);
  }
  await moreDialog.getByRole('button', { name: 'Close More' }).click();
}

async function captureEdgeCases(browser) {
  const { context, page } = await preparePage(browser, mobileViewport);
  try {
    await chooseQuickBook(page);

    await setLabFixture(page, { images: 'partial_images' });
    await enterPreview(page);
    const partialGrid = page.locator('.vg-grid').first();
    await partialGrid.evaluate(element => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: Math.max(0, top - 150), behavior: 'instant' });
    });
    await capture(page, evidence.partialImages);
    await backToEditor(page);

    await setLabFixture(page, { images: 'no_images' });
    await enterPreview(page);
    const noImageGrid = page.locator('.vg-grid').first();
    await noImageGrid.evaluate(element => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: Math.max(0, top - 150), behavior: 'instant' });
    });
    await capture(page, evidence.noImages);
    await backToEditor(page);

    await setLabFixture(page, { images: 'image_rich', menu: 'stress_100' });
    await openBookingSettings(page, 'mobile');
    await setLayout(page, 'category_menu');
    await closeBookingSettings(page);
    await enterPreview(page);
    await scrollPreviewBookingIntoView(page);
    await capture(page, evidence.hundredServices);

    const search = page.getByRole('searchbox', { name: /Search services/ }).first();
    await search.fill('Complete Structured Manicure');
    const longService = page.getByText(/The Complete Structured Manicure with Precision Cuticle Care/).first();
    await longService.evaluate(element => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: Math.max(0, top - 260), behavior: 'instant' });
    });
    await capture(page, evidence.longName);
  } finally {
    await context.close();
  }

  const narrow = await preparePage(browser, { width: 320, height: 640 });
  try {
    await chooseQuickBook(narrow.page);
    await enterPreview(narrow.page);
    await capturePreviewLayout(narrow.page, evidence.narrow320);
  } finally {
    await narrow.context.close();
  }
}

async function captureComparisons(browser) {
  await createCollage(
    browser,
    evidence.mobileLayoutsComparison,
    Object.entries(layoutEvidence).map(([layout, files]) => ({ file: files.mobile, label: layoutLabels[layout] })),
    { columns: 5, tileHeight: 650, title: 'All five Booking layouts · integrated mobile Preview', width: 1800 },
  );
  await createCollage(
    browser,
    evidence.desktopLayoutsComparison,
    Object.entries(layoutEvidence).map(([layout, files]) => ({ file: files.desktop, label: layoutLabels[layout] })),
    { columns: 2, tileHeight: 620, title: 'All five Booking layouts · integrated desktop Preview', width: 1800 },
  );
  await createCollage(
    browser,
    evidence.mobileModesComparison,
    [
      { file: evidence.mobileBookingSelected, label: 'Edit · selected' },
      { file: evidence.mobileReorder, label: 'Reorder' },
      { file: evidence.mobileVisual, label: 'Customer Preview' },
    ],
    { columns: 3, tileHeight: 700, title: 'Mobile · edit, reorder and preview', width: 1300 },
  );
  await createCollage(
    browser,
    evidence.desktopModesComparison,
    [
      { file: evidence.desktopSelected, label: 'Edit · selected' },
      { file: evidence.desktopVisual, label: 'Customer Preview' },
    ],
    { columns: 2, tileHeight: 720, title: 'Desktop · edit and preview', width: 1800 },
  );
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const response = await fetch(baseUrl);
  if (!response.ok) {
    throw new Error(`Integration Lab did not respond at ${baseUrl} (${response.status}).`);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    await captureMobile(browser);
    await captureDesktop(browser);
    await captureEdgeCases(browser);
    await captureComparisons(browser);
  } finally {
    await browser.close();
  }

  process.stdout.write(`Captured ${Object.keys(evidence).length} evidence images in ${outputDirectory}\n`);
}

await main();
