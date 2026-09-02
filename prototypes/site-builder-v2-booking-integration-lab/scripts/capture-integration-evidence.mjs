import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const labDirectory = resolve(scriptDirectory, '..');
const outputDirectory = resolve(labDirectory, 'artifacts/screenshots');
const baseUrl = process.env.LUSTER_LAB_URL ?? 'http://127.0.0.1:4182';

const mobileViewport = { width: 375, height: 600 };
const desktopViewport = { width: 1440, height: 900 };

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
  mobileReorder: '11-mobile-arrange-booking.png',
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
  desktopReorder: '24-desktop-arrange.png',
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
  correctionDesktopSticky: '37-correction-long-booking-desktop-sticky-toolbar.png',
  correctionMobileDock: '38-correction-long-booking-mobile-named-dock.png',
  correctionCollapseDeep: '39-correction-collapse-reachable-deep.png',
  correctionMoveDirty: '40-correction-move-order-not-saved.png',
  correctionReloadBaseline: '41-correction-reload-mid-move-committed-order.png',
  correctionInvalidPosition: '42-correction-invalid-position.png',
  correctionDirtyClose: '43-correction-dirty-close-confirmation.png',
  correctionCrossPageShort: '44-correction-cross-page-375x600.png',
  correctionPhoneSummary: '45-correction-phone-summary-contained.png',
  correctionPhoneDetail: '46-correction-phone-service-detail-contained.png',
  correctionEditCleanState: '47-correction-edit-no-customer-state.png',
  correctionEditAccessibility: '48-correction-edit-accessibility-semantics.png',
  correctionDesktopSettingsColumn: '49-correction-desktop-settings-own-column.png',
  correctionSettings920: '50-correction-settings-920px.png',
  correctionStarter320: '51-correction-starter-chooser-320x600.png',
  correctionOneSectionMove: '52-correction-one-section-move-state.png',
  correctionUnifiedStructureMove: '53-correction-unified-move-from-structure.png',
  correctionHundredCollapsed: '54-correction-100-service-collapsed-editor.png',
  correctionHundredPreview: '55-correction-full-100-service-preview.png',
  correctionFinalBaseline: '56-correction-final-restored-baseline.png',
  correctionSheet: '57-correction-proof-sheet.png',
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

async function assertContainedWithin(locator, container, label) {
  const [targetBox, containerBox] = await Promise.all([
    locator.boundingBox(),
    container.boundingBox(),
  ]);
  if (!targetBox || !containerBox) {
    throw new Error(`${label} or its containing frame was not visible.`);
  }
  const tolerance = 1;
  const contained = targetBox.x >= containerBox.x - tolerance
    && targetBox.y >= containerBox.y - tolerance
    && targetBox.x + targetBox.width <= containerBox.x + containerBox.width + tolerance
    && targetBox.y + targetBox.height <= containerBox.y + containerBox.height + tolerance;
  if (!contained) {
    throw new Error(`${label} escaped the simulated Preview frame.`);
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

async function scrollDeepIntoEditorBooking(page, ratio = 0.65) {
  await bookingArticle(page).evaluate((element, requestedRatio) => {
    const rect = element.getBoundingClientRect();
    const absoluteTop = rect.top + window.scrollY;
    const target = absoluteTop + Math.max(0, element.getBoundingClientRect().height - window.innerHeight) * requestedRatio;
    window.scrollTo({ top: target, behavior: 'instant' });
  }, ratio);
  await page.waitForTimeout(120);
}

function selectedOwnerControls(page, formFactor) {
  return formFactor === 'mobile'
    ? page.locator('.final-mobile-dock__selected')
    : page.getByTestId('selected-section-toolbar');
}

async function selectBooking(page, formFactor) {
  const article = bookingArticle(page);
  const selectSurface = article.locator('.section-card__select-surface');
  if (await selectSurface.getAttribute('aria-pressed') !== 'true') {
    await selectSurface.click();
  }
  const actions = selectedOwnerControls(page, formFactor);
  if (formFactor === 'mobile') {
    const back = page.locator('.final-mobile-dock__back');
    await actions.or(back).waitFor({ state: 'visible' });
    if (await back.isVisible()) {
      await back.click();
    }
  }
  await actions.waitFor({ state: 'visible' });
  await page.waitForTimeout(250);
}

async function openBookingSettings(page, formFactor) {
  await scrollEditorBookingIntoView(page);
  await selectBooking(page, formFactor);
  const actionScope = selectedOwnerControls(page, formFactor);
  await actionScope.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByTestId('booking-settings-panel').waitFor({ state: 'visible' });
}

async function closeBookingSettings(page) {
  await page.getByRole('button', { name: /^Close Booking(?: settings)?$/ }).click();
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
  await booking.scrollIntoViewIfNeeded();
  await booking.evaluate(element => {
    const scroller = element.closest('.client-site');
    if (scroller) {
      scroller.scrollTop = Math.max(0, element.offsetTop - 72);
    }
  });
  await page.waitForTimeout(120);
}

async function selectPreviewDevice(page, name) {
  const button = page.getByRole('button', { name, exact: true });
  if (await button.getAttribute('aria-pressed') !== 'true') {
    await button.click();
  }
  await page.locator(`.preview-stage--${name === 'Phone' ? 'mobile' : name.toLowerCase()}`).waitFor();
}

async function openMovePanel(page, formFactor) {
  await scrollEditorBookingIntoView(page);
  await selectBooking(page, formFactor);
  await selectedOwnerControls(page, formFactor).getByRole('button', { name: 'Move', exact: true }).click();
  const panel = page.getByTestId('move-section-panel');
  await panel.waitFor({ state: 'visible' });
  return panel;
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
    await page.getByRole('button', { name: 'Arrange sections' }).click();
    await page.getByRole('heading', { name: 'Arrange sections' }).waitFor();
    await capture(page, evidence.mobileReorder);
    await page.getByTestId('move-section-panel').getByRole('button', { name: 'Cancel', exact: true }).click();

    await openBookingSettings(page, 'mobile');
    await setLayout(page, 'visual_grid');
    await closeBookingSettings(page);
    await enterPreview(page);
    await openRussianDetail(page);
    await capture(page, evidence.mobileServiceDetail);
    await page.getByRole('checkbox', { name: /French/ }).check();
    await page.getByRole('button', { name: 'Keep browsing' }).click();
    const summary = page.getByTestId('selected-service-summary');
    await summary.waitFor();
    await assertFullyInViewport(summary, 'Mobile selected-service summary');
    await capture(page, evidence.mobileSummary);
    await backToEditor(page);

    await scrollEditorBookingIntoView(page);
    await selectBooking(page, 'mobile');
    await selectedOwnerControls(page, 'mobile').getByRole('button', { name: 'Move', exact: true }).click();
    const moveDialog = page.getByRole('dialog', { name: 'Move Booking' });
    await moveDialog.getByRole('button', { name: 'Move Booking to another page' }).click();
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
    await selectedOwnerControls(page, 'desktop').getByRole('button', { name: 'Edit', exact: true }).click();
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
    await page.getByRole('button', { name: 'Arrange sections' }).click();
    await page.getByRole('heading', { name: 'Arrange sections' }).waitFor();
    await capture(page, evidence.desktopReorder);
    await page.getByTestId('move-section-panel').getByRole('button', { name: 'Cancel', exact: true }).click();

    await openBookingSettings(page, 'desktop');
    await setLayout(page, 'visual_grid');
    await closeBookingSettings(page);
    await enterPreview(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(page, evidence.desktopDevices);
    await openRussianDetail(page);
    await capture(page, evidence.desktopServiceDetail);
    await page.getByRole('checkbox', { name: /French/ }).check();
    await page.getByRole('button', { name: 'Keep browsing' }).click();
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
    await partialGrid.scrollIntoViewIfNeeded();
    await capture(page, evidence.partialImages);
    await backToEditor(page);

    await setLabFixture(page, { images: 'no_images' });
    await enterPreview(page);
    const noImageGrid = page.locator('.vg-grid').first();
    await noImageGrid.scrollIntoViewIfNeeded();
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
    await longService.scrollIntoViewIfNeeded();
    await capture(page, evidence.longName);
  } finally {
    await context.close();
  }

  const narrow = await preparePage(browser, { width: 320, height: 600 });
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
      { file: evidence.mobileReorder, label: 'Arrange' },
      { file: evidence.mobileVisual, label: 'Customer Preview' },
    ],
    { columns: 3, tileHeight: 700, title: 'Mobile · edit, arrange and preview', width: 1300 },
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

async function resetToStarter(page) {
  await page.getByRole('button', { name: 'More site options' }).click();
  const more = page.getByRole('dialog', { name: 'More' });
  await more.getByRole('button', { name: 'Reset to starter kit' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Reset to the starting point?' });
  await confirmation.getByRole('button', { name: 'Reset to starter' }).click();
  await page.getByTestId('final-hybrid-editor').waitFor({ state: 'visible' });
  await waitForToastGone(page);
}

async function captureLongSectionCorrections(browser) {
  const desktop = await preparePage(browser, desktopViewport);
  try {
    await chooseQuickBook(desktop.page);
    await scrollEditorBookingIntoView(desktop.page);
    await selectBooking(desktop.page, 'desktop');
    const article = bookingArticle(desktop.page);
    await article.waitFor();
    await desktop.page.waitForFunction(() => (
      document.querySelector('article[data-section-type="booking"]')
        ?.getAttribute('data-booking-editor-collapsed') === 'true'
    ));
    await scrollDeepIntoEditorBooking(desktop.page, 0.7);
    const toolbar = selectedOwnerControls(desktop.page, 'desktop');
    await toolbar.waitFor({ state: 'visible' });
    await toolbar.getByRole('button', { name: /^(Expand|Collapse)$/ }).waitFor();
    await capture(desktop.page, evidence.correctionDesktopSticky);
    await article.locator('.booking-editor-preview__edge-toggle').scrollIntoViewIfNeeded();
    await capture(desktop.page, evidence.correctionCollapseDeep);
  } finally {
    await desktop.context.close();
  }

  const mobile = await preparePage(browser, mobileViewport);
  try {
    await chooseQuickBook(mobile.page);
    await scrollEditorBookingIntoView(mobile.page);
    await selectBooking(mobile.page, 'mobile');
    await mobile.page.waitForFunction(() => (
      document.querySelector('article[data-section-type="booking"]')
        ?.getAttribute('data-booking-editor-collapsed') === 'true'
    ));
    await scrollDeepIntoEditorBooking(mobile.page, 0.55);
    const dock = selectedOwnerControls(mobile.page, 'mobile');
    await dock.getByText('Booking', { exact: true }).waitFor();
    await dock.getByRole('button', { name: /^(Expand|Collapse)$/ }).waitFor();
    await capture(mobile.page, evidence.correctionMobileDock);
  } finally {
    await mobile.context.close();
  }
}

async function captureMoveCorrections(browser) {
  const { context, page } = await preparePage(browser, mobileViewport);
  try {
    await chooseQuickBook(page);
    let panel = await openMovePanel(page, 'mobile');
    let position = panel.getByLabel('Position for Booking');
    await position.fill('1');
    await position.press('Enter');
    await panel.getByText('Order not saved yet', { exact: true }).waitFor();
    await capture(page, evidence.correctionMoveDirty);

    // The working order is intentionally in memory only. Reload must recover the
    // last committed order (Booking at position 3), never the temporary position 1.
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('final-hybrid-editor').waitFor();
    panel = await openMovePanel(page, 'mobile');
    position = panel.getByLabel('Position for Booking');
    if (await position.inputValue() !== '3') {
      throw new Error('Reload promoted a temporary Move order instead of restoring Booking at position 3.');
    }
    await capture(page, evidence.correctionReloadBaseline);
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();

    panel = await openMovePanel(page, 'mobile');
    position = panel.getByLabel('Position for Booking');
    await position.fill('99');
    await position.press('Enter');
    await panel.getByText('Enter a position from 1 to 3.', { exact: true }).waitFor();
    await capture(page, evidence.correctionInvalidPosition);
    await position.fill('1');
    await position.press('Enter');
    await page.getByRole('button', { name: 'Close Move Booking' }).click();
    await page.getByRole('dialog', { name: 'Keep this new order?' }).waitFor();
    await capture(page, evidence.correctionDirtyClose);
    await page.getByRole('dialog', { name: 'Keep this new order?' })
      .getByRole('button', { name: 'Discard changes' }).click();

    panel = await openMovePanel(page, 'mobile');
    await panel.getByRole('button', { name: 'Move Booking to another page' }).click();
    const pageName = panel.getByPlaceholder('Page name');
    await pageName.waitFor({ state: 'visible' });
    await pageName.fill('Services');
    await panel.getByRole('button', { name: 'Create page and move' }).waitFor({ state: 'visible' });
    await capture(page, evidence.correctionCrossPageShort);
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.getByRole('button', { name: /Open Pages & Structure/ }).click();
    await page.getByTestId('structure-tree').waitFor();
    await page.getByRole('button', { name: 'Arrange sections' }).click();
    panel = page.getByTestId('move-section-panel');
    await panel.waitFor();
    await page.getByRole('heading', { name: 'Arrange sections' }).waitFor();
    await capture(page, evidence.correctionUnifiedStructureMove);
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    await context.close();
  }
}

async function capturePreviewBoundaryCorrections(browser) {
  const { context, page } = await preparePage(browser, desktopViewport);
  try {
    await chooseQuickBook(page);
    await enterPreview(page);
    await selectPreviewDevice(page, 'Phone');
    await scrollPreviewBookingIntoView(page);
    const frame = page.locator('.preview-frame');
    await openRussianDetail(page);
    const detail = page.getByTestId('service-detail-dialog');
    await assertContainedWithin(detail, frame, 'Phone Service Detail');
    await capture(page, evidence.correctionPhoneDetail);
    await page.getByRole('checkbox', { name: /French/ }).check();
    await page.getByRole('button', { name: 'Keep browsing' }).click();
    const summary = page.getByTestId('selected-service-summary');
    await summary.waitFor();
    await assertContainedWithin(summary, frame, 'Phone selected-service summary');
    await capture(page, evidence.correctionPhoneSummary);

    await backToEditor(page);
    await scrollEditorBookingIntoView(page);
    const editPreview = page.getByRole('group', {
      name: 'Booking menu preview — 24 services, Visual Grid. Not interactive while editing.',
    });
    await editPreview.waitFor();
    if (await editPreview.getAttribute('aria-hidden') !== null) {
      throw new Error('The Edit-mode Booking preview is still hidden from assistive technology.');
    }
    if (await editPreview.locator('.booking-surface').getAttribute('data-has-selection') !== 'false') {
      throw new Error('Customer selection leaked visually into Edit mode.');
    }
    if (await page.getByTestId('selected-service-summary').count() !== 0) {
      throw new Error('Selected customer summary leaked into Edit mode.');
    }
    const editorSearch = editPreview.locator('input[placeholder="Try “Russian manicure”"]');
    if (await editorSearch.inputValue() !== '') {
      throw new Error('Customer search text leaked into Edit mode.');
    }
    if (await editorSearch.getAttribute('aria-hidden') !== 'true') {
      throw new Error('The read-only Edit search field is still exposed as an actionable searchbox.');
    }
    if (await editPreview.getByRole('button').count() !== 0
      || await editPreview.getByRole('searchbox').count() !== 0
      || await editPreview.getByRole('tab').count() !== 0) {
      throw new Error('The Edit-mode Booking preview still exposes dead customer controls as actions.');
    }
    await capture(page, evidence.correctionEditCleanState);
    await editPreview.scrollIntoViewIfNeeded();
    await capture(page, evidence.correctionEditAccessibility, { locator: editPreview });
  } finally {
    await context.close();
  }
}

async function captureSettingsCorrections(browser) {
  const desktop = await preparePage(browser, desktopViewport);
  try {
    await chooseQuickBook(desktop.page);
    await openBookingSettings(desktop.page, 'desktop');
    const drawer = desktop.page.locator('.final-booking-settings-drawer');
    const canvas = desktop.page.locator('.final-canvas-shell');
    const topbar = desktop.page.locator('.final-topbar');
    const [drawerBox, canvasBox, topbarBox] = await Promise.all([
      drawer.boundingBox(),
      canvas.boundingBox(),
      topbar.boundingBox(),
    ]);
    if (!drawerBox || !canvasBox || !topbarBox
      || canvasBox.x + canvasBox.width > drawerBox.x + 1
      || drawerBox.y < topbarBox.y + topbarBox.height - 1) {
      throw new Error('Desktop Booking settings did not occupy a separate column below the global toolbar.');
    }
    await capture(desktop.page, evidence.correctionDesktopSettingsColumn);
  } finally {
    await desktop.context.close();
  }

  const compact = await preparePage(browser, { width: 920, height: 768 });
  try {
    await chooseQuickBook(compact.page);
    await openBookingSettings(compact.page, 'desktop');
    await compact.page.getByRole('button', { name: 'View preview' }).waitFor();
    await capture(compact.page, evidence.correctionSettings920);
  } finally {
    await compact.context.close();
  }

  const starter = await preparePage(browser, { width: 320, height: 600 });
  try {
    const quickAction = starter.page.getByRole('button', { name: /Quick Book/ });
    const box = await quickAction.boundingBox();
    if (!box || box.y > 648) {
      throw new Error('Quick Book action remains materially below the 320×600 starter viewport.');
    }
    await capture(starter.page, evidence.correctionStarter320);
  } finally {
    await starter.context.close();
  }
}

async function captureOneSectionAndStressCorrections(browser) {
  const mobile = await preparePage(browser, mobileViewport);
  try {
    await chooseQuickBook(mobile.page);
    let panel = await openMovePanel(mobile.page, 'mobile');
    await panel.getByRole('button', { name: 'Move Booking to another page' }).click();
    await panel.getByPlaceholder('Page name').fill('Services');
    await panel.getByRole('button', { name: 'Create page and move' }).click();
    const navigation = mobile.page.getByRole('dialog', { name: 'Add a menu?' });
    if (await navigation.isVisible()) {
      await navigation.getByRole('button', { name: 'Add menu' }).click();
    }
    await waitForToastGone(mobile.page);
    await scrollEditorBookingIntoView(mobile.page);
    panel = await openMovePanel(mobile.page, 'mobile');
    await panel.getByText('Booking is the only section on Services.', { exact: true }).waitFor();
    if (await panel.getByLabel('Position for Booking').count() !== 0) {
      throw new Error('The one-section Move state exposed a useless position field.');
    }
    await capture(mobile.page, evidence.correctionOneSectionMove);
  } finally {
    await mobile.context.close();
  }

  const stress = await preparePage(browser, desktopViewport);
  try {
    await chooseQuickBook(stress.page);
    await setLabFixture(stress.page, { images: 'image_rich', menu: 'stress_100' });
    await openBookingSettings(stress.page, 'desktop');
    await setLayout(stress.page, 'category_menu');
    await closeBookingSettings(stress.page);
    await scrollEditorBookingIntoView(stress.page);
    await selectBooking(stress.page, 'desktop');
    await stress.page.waitForFunction(() => (
      document.querySelector('article[data-section-type="booking"]')
        ?.getAttribute('data-booking-editor-collapsed') === 'true'
    ));
    await bookingArticle(stress.page).locator('.booking-editor-preview__edge-toggle').scrollIntoViewIfNeeded();
    await selectedOwnerControls(stress.page, 'desktop').waitFor({ state: 'visible' });
    await capture(stress.page, evidence.correctionHundredCollapsed);

    await enterPreview(stress.page);
    await scrollPreviewBookingIntoView(stress.page);
    const hundredMenu = stress.page.locator('.booking-surface[data-layout="category_menu"]');
    await hundredMenu.waitFor();
    await capture(stress.page, evidence.correctionHundredPreview, { locator: hundredMenu });
  } finally {
    await stress.context.close();
  }
}

async function captureFinalBaseline(browser) {
  const { context, page } = await preparePage(browser, mobileViewport);
  try {
    await chooseQuickBook(page);
    await resetToStarter(page);
    const labels = await page.locator('.final-sections-list [data-section-instance-id]').evaluateAll((articles) => (
      articles.map(article => article.getAttribute('data-section-label'))
    ));
    if (JSON.stringify(labels) !== JSON.stringify(['Section 01', 'Section 02', 'Booking'])) {
      throw new Error(`Final baseline order was ${JSON.stringify(labels)} instead of Section 01, Section 02, Booking.`);
    }
    await scrollEditorBookingIntoView(page);
    await capture(page, evidence.correctionFinalBaseline);
  } finally {
    await context.close();
  }
}

async function captureCorrectionProofs(browser) {
  await captureLongSectionCorrections(browser);
  await captureMoveCorrections(browser);
  await capturePreviewBoundaryCorrections(browser);
  await captureSettingsCorrections(browser);
  await captureOneSectionAndStressCorrections(browser);
  await captureFinalBaseline(browser);

  await createCorrectionProofSheet(browser);
}

async function createCorrectionProofSheet(browser) {
  const correctionEntries = [
    [evidence.correctionDesktopSticky, '1 · Desktop sticky toolbar'],
    [evidence.correctionMobileDock, '2 · Mobile named dock'],
    [evidence.correctionCollapseDeep, '3 · Collapse reachable deep'],
    [evidence.correctionMoveDirty, '4 · Unsaved Move status'],
    [evidence.correctionReloadBaseline, '5 · Reload restores committed order'],
    [evidence.correctionInvalidPosition, '6 · Invalid position feedback'],
    [evidence.correctionDirtyClose, '7 · Dirty-close choice'],
    [evidence.correctionCrossPageShort, '8 · Cross-page at 375×600'],
    [evidence.correctionPhoneSummary, '9 · Phone summary contained'],
    [evidence.correctionPhoneDetail, '10 · Phone detail contained'],
    [evidence.correctionEditCleanState, '11 · Edit state is clean'],
    [evidence.correctionEditAccessibility, '12 · Readable Edit semantics'],
    [evidence.correctionDesktopSettingsColumn, '13 · Desktop settings column'],
    [evidence.correctionSettings920, '14 · 920px settings behavior'],
    [evidence.correctionStarter320, '15 · Starter at 320×600'],
    [evidence.correctionOneSectionMove, '16 · One-section Move'],
    [evidence.correctionUnifiedStructureMove, '17 · Shared Move from Structure'],
    [evidence.correctionHundredCollapsed, '18 · 100 services collapsed'],
    [evidence.correctionHundredPreview, '19 · Full 100-service Preview'],
    [evidence.correctionFinalBaseline, '20 · Restored baseline'],
  ].map(([file, label]) => ({ file, label }));
  await createCollage(browser, evidence.correctionSheet, correctionEntries, {
    columns: 4,
    tileHeight: 430,
    title: 'Luster Builder + Booking · final UX correction proof sheet',
    width: 1900,
  });
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const response = await fetch(baseUrl);
  if (!response.ok) {
    throw new Error(`Integration Lab did not respond at ${baseUrl} (${response.status}).`);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    if (process.env.LUSTER_CORRECTION_FINAL_ONLY === '1') {
      await captureFinalBaseline(browser);
      await createCorrectionProofSheet(browser);
    } else {
      await captureMobile(browser);
      await captureDesktop(browser);
      await captureEdgeCases(browser);
      await captureComparisons(browser);
      await captureCorrectionProofs(browser);
    }
  } finally {
    await browser.close();
  }

  process.stdout.write(`Captured ${Object.keys(evidence).length} evidence images in ${outputDirectory}\n`);
}

await main();
