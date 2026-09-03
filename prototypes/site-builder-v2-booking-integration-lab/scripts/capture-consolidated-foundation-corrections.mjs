import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { chromium } from '@playwright/test';

const baseUrl = process.env.LUSTER_LAB_URL ?? 'http://127.0.0.1:4182';
const outputDirectory = '/tmp/luster-consolidated-foundation-corrections';

const layoutLabels = {
  visual_grid: 'Visual Grid',
  clean_list: 'Clean List',
  editorial_cards: 'Editorial Cards',
  category_menu: 'Category Menu',
  editorial_price_list: 'Editorial Price List',
};

const layouts = Object.keys(layoutLabels);
const searchableLayouts = new Set([
  'visual_grid',
  'clean_list',
  'category_menu',
]);

const screenshotFiles = {
  service390Top: 'screenshots/01-service-detail-390x844-top.png',
  service390Bottom: 'screenshots/02-service-detail-390x844-bottom-action.png',
  service375Top: 'screenshots/03-service-detail-375x600-top.png',
  service375Bottom: 'screenshots/04-service-detail-375x600-bottom.png',
  service320Bottom: 'screenshots/05-service-detail-320x568-bottom.png',
  serviceLandscape: 'screenshots/06-service-detail-844x390-landscape-action.png',
  serviceShow: 'screenshots/07-service-detail-images-show.png',
  serviceHide: 'screenshots/08-service-detail-images-hide.png',
  serviceAuto: 'screenshots/09-service-detail-images-auto.png',
  featuredMobileEdit: 'screenshots/10-featured-mobile-edit.png',
  featuredMobilePreview: 'screenshots/11-featured-mobile-preview.png',
  featuredDesktopEdit: 'screenshots/12-featured-desktop-edit.png',
  featuredDesktopPreview: 'screenshots/13-featured-desktop-preview.png',
  featuredSelected: 'screenshots/14-featured-selected.png',
  searchEmpty: 'screenshots/15-search-empty.png',
  searchTyped: 'screenshots/16-search-typed-one-clear.png',
  searchCleared: 'screenshots/17-search-cleared.png',
  searchNoResults: 'screenshots/18-search-no-results.png',
  warning320: 'screenshots/19-warning-320px.png',
  warningKeepEditing: 'screenshots/20-warning-keep-editing.png',
  warningReturned: 'screenshots/21-warning-returned-option-editor.png',
  hierarchyQuickMobile: 'screenshots/22-hierarchy-quick-book-mobile.png',
  hierarchyOnePageMobile: 'screenshots/23-hierarchy-one-page-mobile.png',
  hierarchySelectedMobile: 'screenshots/24-hierarchy-selected-mobile-section.png',
  hierarchyBookingSelected: 'screenshots/25-hierarchy-booking-selected.png',
  hierarchyHidden: 'screenshots/26-hierarchy-hidden-section.png',
  hierarchyDesktop: 'screenshots/27-hierarchy-desktop-editor.png',
  hierarchyHover: 'screenshots/28-hierarchy-desktop-hover.png',
  starterMobile: 'screenshots/29-starter-chooser-mobile.png',
  starterDesktop: 'screenshots/30-starter-chooser-desktop.png',
};

const videoFiles = {
  serviceScroll: 'videos/01-mobile-service-detail-scroll.webm',
  russianFrench: 'videos/02-russian-manicure-french-flow.webm',
  featuredParity: 'videos/03-featured-edit-preview-comparison.webm',
  hierarchy: 'videos/04-mobile-section-stack-hierarchy.webm',
  keepEditing: 'videos/05-keep-editing-flow.webm',
};

const f1Viewports = [
  { height: 568, label: '320x568', width: 320 },
  { height: 600, label: '320x600', width: 320 },
  { height: 500, label: '375x500', width: 375 },
  { height: 600, label: '375x600', width: 375 },
  { height: 844, label: '390x844', width: 390 },
  { height: 932, label: '430x932', width: 430 },
  { height: 390, label: '844x390-landscape', width: 844 },
];

const f2Viewports = [
  { height: 568, label: '320x568', width: 320 },
  { height: 600, label: '375x600', width: 375 },
  { height: 844, label: '390x844', width: 390 },
  { height: 932, label: '430x932', width: 430 },
  { height: 800, label: '920x800', width: 920 },
  { height: 800, label: '1180x800', width: 1180 },
  { height: 900, label: '1440x900', width: 1440 },
];

const runtimeIssues = [];
const httpChecks = [];
const evidenceEntries = [];
const measurements = {
  f1: [],
  f1Gestures: [],
  f1SimulatedPhone: [],
  f2: [],
  f2SimulatedTablet: [],
  f3: [],
  f4: [],
  hierarchy: [],
  restoration: null,
};

function evidencePath(relativePath) {
  return resolve(outputDirectory, relativePath);
}

async function ensureEvidenceParent(relativePath) {
  const parent = evidencePath(relativePath).split('/').slice(0, -1).join('/');
  await mkdir(parent, { recursive: true });
}

async function writeJson(relativePath, value) {
  await ensureEvidenceParent(relativePath);
  await writeFile(
    evidencePath(relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

function recordEvidence(file, metadata) {
  evidenceEntries.push({ file, ...metadata });
}

async function screenshot(page, file, metadata = {}) {
  const { preservePointer = false, ...evidenceMetadata } = metadata;
  await ensureEvidenceParent(file);
  if (!preservePointer) {
    await page.mouse.move(1, 1);
  }
  await page.waitForTimeout(140);
  await page.screenshot({
    animations: 'disabled',
    path: evidencePath(file),
  });
  recordEvidence(file, { kind: 'screenshot', ...evidenceMetadata });
}

function startRuntimeMonitor(page, phase) {
  const listeners = {
    console: (message) => {
      if (!['error', 'warning'].includes(message.type())) {
        return;
      }
      const location = message.location();
      if (
        location.url.endsWith('/favicon.ico')
        && message.text().includes('404')
      ) {
        return;
      }
      runtimeIssues.push({
        location,
        message: message.text(),
        phase,
        type: `console.${message.type()}`,
      });
    },
    pageerror: (error) => {
      runtimeIssues.push({
        message: error.message,
        phase,
        type: 'pageerror',
      });
    },
    requestfailed: (request) => {
      runtimeIssues.push({
        message: request.failure()?.errorText ?? 'Unknown request failure',
        method: request.method(),
        phase,
        type: 'requestfailed',
        url: request.url(),
      });
    },
    response: (response) => {
      if (response.status() < 400) {
        return;
      }
      runtimeIssues.push({
        method: response.request().method(),
        phase,
        status: response.status(),
        type: 'http-error',
        url: response.url(),
      });
    },
  };

  page.on('console', listeners.console);
  page.on('pageerror', listeners.pageerror);
  page.on('requestfailed', listeners.requestfailed);
  page.on('response', listeners.response);

  return () => {
    page.off('console', listeners.console);
    page.off('pageerror', listeners.pageerror);
    page.off('requestfailed', listeners.requestfailed);
    page.off('response', listeners.response);
  };
}

function contextOptions({
  mobile = false,
  deviceScaleFactor = mobile ? 2 : 1,
  recordVideoDirectory,
  reducedMotion = true,
  viewport,
}) {
  const options = {
    colorScheme: 'light',
    deviceScaleFactor,
    hasTouch: mobile,
    isMobile: mobile,
    locale: 'en-CA',
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    timezoneId: 'America/Toronto',
    viewport,
  };

  if (mobile) {
    options.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0 Mobile/15E148 Safari/604.1';
  }

  if (recordVideoDirectory) {
    options.recordVideo = {
      dir: recordVideoDirectory,
    };
  }

  return options;
}

async function withPage(browser, phase, options, action) {
  const context = await browser.newContext(contextOptions(options));
  await context.route('**/favicon.ico', route => route.fulfill({
    body: '',
    status: 204,
  }));
  const page = await context.newPage();
  const stopMonitor = startRuntimeMonitor(page, phase);

  try {
    return await action(page, context);
  } finally {
    stopMonitor();
    await context.close();
  }
}

async function openFresh(page, phase) {
  const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  assert.ok(response, `${phase}: navigation returned no response.`);
  httpChecks.push({ phase, status: response.status(), url: response.url() });
  assert.equal(response.status(), 200, `${phase}: Lab did not return HTTP 200.`);
  await page.getByRole('heading', { name: 'Choose your starting point' })
    .waitFor({ state: 'visible' });
  await waitForVisualStability(page);
}

async function waitForVisualStability(page) {
  await page.evaluate(async () => {
    if (document.fonts) {
      await document.fonts.ready;
    }
    const visibleImages = [...document.images].filter((image) => {
      const rectangle = image.getBoundingClientRect();
      return rectangle.bottom >= 0
        && rectangle.right >= 0
        && rectangle.top <= window.innerHeight
        && rectangle.left <= window.innerWidth;
    });
    await Promise.race([
      Promise.all(visibleImages.map(async (image) => {
        if (image.complete) {
          return;
        }
        await new Promise((resolveImage) => {
          image.addEventListener('load', resolveImage, { once: true });
          image.addEventListener('error', resolveImage, { once: true });
        });
      })),
      new Promise(resolveTimeout => window.setTimeout(resolveTimeout, 1_500)),
    ]);
  });
  await page.waitForTimeout(120);
}

async function chooseStarter(page, name) {
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await page.getByTestId('final-hybrid-editor').waitFor({ state: 'visible' });
  const toast = page.locator('.toast');
  if (await toast.isVisible()) {
    await toast.waitFor({ state: 'detached', timeout: 5_000 });
  }
  await waitForVisualStability(page);
}

function bookingArticle(page) {
  return page.locator('article[data-section-type="booking"]');
}

function selectedOwnerControls(page, mobile) {
  return mobile
    ? page.locator('.final-mobile-dock__selected')
    : page.getByTestId('selected-section-toolbar');
}

async function selectSection(page, label, mobile) {
  const article = label === 'Booking'
    ? bookingArticle(page)
    : page.locator(`article[data-section-label="${label}"]`);
  await article.scrollIntoViewIfNeeded();
  const surface = article.locator('.section-card__select-surface');
  if (await surface.getAttribute('aria-pressed') !== 'true') {
    await surface.click();
  }
  await selectedOwnerControls(page, mobile).waitFor({ state: 'visible' });
  return article;
}

async function openBookingSettings(page, mobile) {
  await selectSection(page, 'Booking', mobile);
  await selectedOwnerControls(page, mobile)
    .getByRole('button', { exact: true, name: 'Edit' })
    .click();
  await page.getByTestId('booking-settings-panel').waitFor({ state: 'visible' });
}

async function closeBookingSettings(page) {
  await page.getByRole('button', { name: /^Close Booking(?: settings)?$/ }).click();
  await page.getByTestId('booking-settings-panel').waitFor({ state: 'detached' });
}

async function setLayout(page, layout, { imageMode, mobile }) {
  await openBookingSettings(page, mobile);
  const option = page.locator(`[data-layout-option="${layout}"]`);
  await option.scrollIntoViewIfNeeded();
  await option.click();
  await page.locator(`.booking-surface[data-layout="${layout}"]`).first().waitFor();

  if (layout === 'visual_grid' && imageMode) {
    const imageModeGroup = page.getByRole('group', { name: 'Visual Grid image mode' });
    await imageModeGroup.scrollIntoViewIfNeeded();
    await imageModeGroup.getByRole('button', {
      exact: true,
      name: imageMode[0].toUpperCase() + imageMode.slice(1),
    }).click();
  }

  await closeBookingSettings(page);
}

async function enterPreview(page) {
  await page.getByRole('button', { exact: true, name: 'Preview' }).click();
  await page.getByTestId('preview-stage').waitFor({ state: 'visible' });
  await waitForVisualStability(page);
}

async function backToEditor(page) {
  await page.getByRole('button', { name: 'Back to editor' }).click();
  await page.getByTestId('final-hybrid-editor').waitFor({ state: 'visible' });
  await page.waitForTimeout(100);
}

async function selectPreviewDevice(page, name) {
  const button = page.getByRole('button', { exact: true, name });
  if (await button.getAttribute('aria-pressed') !== 'true') {
    await button.click();
  }
  const device = name === 'Phone' ? 'mobile' : name.toLowerCase();
  await page.locator(`.preview-stage--${device}`).waitFor({ state: 'visible' });
  await page.waitForTimeout(100);
}

async function scrollPreviewBookingIntoView(page) {
  const booking = page.locator('.preview-section--booking');
  await booking.scrollIntoViewIfNeeded();
  await booking.waitFor({ state: 'visible' });
  await page.waitForTimeout(100);
}

async function openRussianDetail(page) {
  await scrollPreviewBookingIntoView(page);
  const action = page.getByRole('button', { name: /Russian Manicure/ }).first();
  await action.scrollIntoViewIfNeeded();
  await action.click();
  await page.getByTestId('service-detail-dialog').waitFor({ state: 'visible' });
  await page.waitForTimeout(100);
}

function detailDialog(page) {
  return page.getByTestId('service-detail-dialog');
}

function detailBody(page) {
  return detailDialog(page)
    .locator('.booking-service-detail-body');
}

function primaryDetailAction(page) {
  return detailDialog(page)
    .getByRole('button', { name: 'Continue' });
}

async function trustedVerticalSwipe(
  page,
  locator,
  distance = 300,
  originPoint = null,
  existingSession = null,
) {
  const box = await locator.boundingBox();
  const scrollBox = await detailBody(page).boundingBox();
  assert.ok(box, 'Trusted swipe target was not visible.');
  assert.ok(scrollBox, 'Service-detail scroll body was not visible.');
  const session = existingSession ?? await page.context().newCDPSession(page);
  const x = Math.round(originPoint?.x ?? (box.x + box.width * 0.5));
  const viewportHeight = page.viewportSize().height;
  const visibleTop = Math.max(24, scrollBox.y + 12, box.y);
  const visibleBottom = Math.min(
    viewportHeight - 24,
    scrollBox.y + scrollBox.height - 12,
    box.y + box.height,
  );
  assert.ok(
    visibleBottom - visibleTop >= 4,
    'Trusted swipe target had no usable visible area inside the scroll body.',
  );
  const originInset = Math.min(8, (visibleBottom - visibleTop) * 0.2);
  const startY = Math.round(originPoint?.y ?? (distance >= 0
    ? visibleBottom - originInset
    : visibleTop + originInset));
  const endY = Math.round(distance >= 0
    ? Math.max(Math.max(24, scrollBox.y + 12), startY - distance)
    : Math.min(
      Math.min(viewportHeight - 24, scrollBox.y + scrollBox.height - 12),
      startY + Math.abs(distance),
    ));

  const touchPoint = y => ({
    force: 1,
    id: 1,
    radiusX: 2,
    radiusY: 2,
    x,
    y,
  });
  const startHit = await page.evaluate(({ pointX, pointY }) => {
    const element = document.elementFromPoint(pointX, pointY);
    return element
      ? { className: element.className, tagName: element.tagName }
      : null;
  }, { pointX: x, pointY: startY });
  const scrollSamples = [];

  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [touchPoint(startY)],
    type: 'touchStart',
  });
  for (let step = 1; step <= 10; step += 1) {
    const y = Math.round(startY + ((endY - startY) * step) / 10);
    await session.send('Input.dispatchTouchEvent', {
      touchPoints: [touchPoint(y)],
      type: 'touchMove',
    });
    await page.waitForTimeout(16);
    scrollSamples.push(await detailBody(page).evaluate(element => element.scrollTop));
  }
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [],
    type: 'touchEnd',
  });
  if (!existingSession) {
    await session.detach();
  }
  await page.waitForTimeout(180);
  return {
    endY,
    scrollSamples,
    startHit,
    startX: x,
    startY,
  };
}

async function scrollDetailToBottom(page) {
  const body = detailBody(page);
  const maxAttempts = 14;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const scroll = await body.evaluate(element => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    }));
    if (scroll.scrollTop >= scroll.scrollHeight - scroll.clientHeight - 2) {
      const actionReachability = await primaryDetailAction(page).evaluate((element) => {
        const body = element.closest('.booking-service-detail-body');
        const actionRectangle = element.getBoundingClientRect();
        const bodyRectangle = body?.getBoundingClientRect();
        const viewportTop = window.visualViewport?.offsetTop ?? 0;
        const viewportBottom = viewportTop
          + (window.visualViewport?.height ?? window.innerHeight);

        return {
          insideBody: Boolean(bodyRectangle)
            && actionRectangle.top >= bodyRectangle.top
            && actionRectangle.bottom <= bodyRectangle.bottom,
          insideVisualViewport: actionRectangle.top >= viewportTop
            && actionRectangle.bottom <= viewportBottom,
        };
      });
      assert.ok(
        actionReachability.insideBody && actionReachability.insideVisualViewport,
        'Service-detail body reached its end but the primary action remained unreachable.',
      );
      return;
    }
    await body.hover({ position: { x: 20, y: Math.max(20, Math.min(100, (await body.boundingBox())?.height ?? 100)) } });
    await page.mouse.wheel(0, 650);
    await page.waitForTimeout(80);
  }
  throw new Error('Service-detail primary action did not become viewport-reachable.');
}

async function measureServiceDetail(page, metadata) {
  const dialog = detailDialog(page);
  const action = primaryDetailAction(page);
  const measurement = await dialog.evaluate((element) => {
    const scrollBody = element.querySelector('.booking-service-detail-body')
      ?? element.querySelector('.booking-dialog-panel');
    const actionElement = [...element.querySelectorAll('button')]
      .find(button => button.textContent?.trim() === 'Continue');
    const image = element.querySelector('.booking-detail-image-wrap img');
    const dialogRect = element.getBoundingClientRect();
    const bodyRect = scrollBody?.getBoundingClientRect();
    const actionRect = actionElement?.getBoundingClientRect();
    const imageRect = image?.getBoundingClientRect();
    const clientSite = document.querySelector('.client-site');
    const actionRegion = element.querySelector('.booking-detail-actions');
    const detailCopy = element.querySelector('.booking-detail-copy');
    return {
      action: actionRect
        ? {
            bottom: actionRect.bottom,
            height: actionRect.height,
            top: actionRect.top,
          }
        : null,
      actionInViewport: Boolean(
        actionRect
        && actionRect.top >= 0
        && actionRect.bottom <= (window.visualViewport?.height ?? window.innerHeight),
      ),
      body: scrollBody
        ? {
            clientHeight: scrollBody.clientHeight,
            overflowY: getComputedStyle(scrollBody).overflowY,
            scrollHeight: scrollBody.scrollHeight,
            scrollTop: scrollBody.scrollTop,
          }
        : null,
      actionRegion: actionRegion
        ? {
            bottom: actionRegion.getBoundingClientRect().bottom,
            paddingBottom: getComputedStyle(actionRegion).paddingBottom,
            position: getComputedStyle(actionRegion).position,
          }
        : null,
      background: {
        bodyOverflow: getComputedStyle(document.body).overflowY,
        clientSiteScrollTop: clientSite?.scrollTop ?? null,
        windowScrollY: window.scrollY,
      },
      dialog: {
        bottom: dialogRect.bottom,
        clientHeight: element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight,
        top: dialogRect.top,
      },
      image: imageRect
        ? {
            height: imageRect.height,
            naturalHeight: image.naturalHeight,
            naturalWidth: image.naturalWidth,
            width: imageRect.width,
          }
        : null,
      resolvedDetailPaddingBottom: detailCopy
        ? getComputedStyle(detailCopy).paddingBottom
        : null,
      shellAvailableHeightToken: getComputedStyle(element)
        .getPropertyValue('--booking-overlay-available-height')
        .trim(),
      visualViewportHeight: window.visualViewport?.height ?? window.innerHeight,
      bodyRect: bodyRect
        ? {
            bottom: bodyRect.bottom,
            height: bodyRect.height,
            top: bodyRect.top,
          }
        : null,
    };
  });

  assert.ok(measurement.body, `${metadata.layout}: missing internal service-detail body.`);
  assert.match(
    measurement.body.overflowY,
    /auto|scroll/,
    `${metadata.layout}: internal service-detail body does not allow vertical scrolling.`,
  );
  assert.ok(await action.isEnabled(), `${metadata.layout}: final action is disabled.`);
  return { ...metadata, ...measurement };
}

async function assertBackgroundDidNotMove(page, before, label) {
  const after = await page.evaluate(() => ({
    clientSiteScrollTop: document.querySelector('.client-site')?.scrollTop ?? null,
    windowScrollY: window.scrollY,
  }));
  assert.deepEqual(after, before, `${label}: background moved while detail was open.`);
  return after;
}

async function closeDetail(page) {
  await detailDialog(page)
    .getByRole('button', { name: 'Close service details' })
    .click();
  await detailDialog(page).waitFor({ state: 'detached' });
}

async function captureServiceDetailScreenshots(browser) {
  const cases = [
    {
      bottomFile: screenshotFiles.service390Bottom,
      height: 844,
      topFile: screenshotFiles.service390Top,
      width: 390,
    },
    {
      bottomFile: screenshotFiles.service375Bottom,
      height: 600,
      topFile: screenshotFiles.service375Top,
      width: 375,
    },
    {
      bottomFile: screenshotFiles.service320Bottom,
      height: 568,
      width: 320,
    },
    {
      bottomFile: screenshotFiles.serviceLandscape,
      height: 390,
      width: 844,
    },
  ];

  for (const entry of cases) {
    await withPage(
      browser,
      `service-screenshot-${entry.width}x${entry.height}`,
      { mobile: true, viewport: { height: entry.height, width: entry.width } },
      async (page) => {
        await openFresh(page, `service-screenshot-${entry.width}x${entry.height}`);
        await chooseStarter(page, 'Quick Book');
        await enterPreview(page);
        await openRussianDetail(page);
        if (entry.topFile) {
          await screenshot(page, entry.topFile, {
            state: 'top',
            viewport: `${entry.width}x${entry.height}`,
          });
        }
        await scrollDetailToBottom(page);
        await screenshot(page, entry.bottomFile, {
          state: 'bottom/action reachable',
          viewport: `${entry.width}x${entry.height}`,
        });
      },
    );
  }

  for (const imageMode of ['show', 'hide', 'auto']) {
    await withPage(
      browser,
      `service-image-mode-${imageMode}`,
      { mobile: true, viewport: { height: 844, width: 390 } },
      async (page) => {
        await openFresh(page, `service-image-mode-${imageMode}`);
        await chooseStarter(page, 'Quick Book');
        await setLayout(page, 'visual_grid', { imageMode, mobile: true });
        await enterPreview(page);
        await openRussianDetail(page);
        await screenshot(page, screenshotFiles[`service${imageMode[0].toUpperCase()}${imageMode.slice(1)}`], {
          imageMode,
          viewport: '390x844',
        });
      },
    );
  }
}

async function measureF1Matrix(browser, { gesturesOnly = false } = {}) {
  if (!gesturesOnly) {
    for (const viewport of f1Viewports) {
      await withPage(
        browser,
        `f1-matrix-${viewport.label}`,
        {
          mobile: true,
          viewport: { height: viewport.height, width: viewport.width },
        },
        async (page) => {
          await openFresh(page, `f1-matrix-${viewport.label}`);
          await chooseStarter(page, 'Quick Book');

          for (const layout of layouts) {
            const imageModes = layout === 'visual_grid'
              ? ['hide', 'show', 'auto']
              : ['not-present-by-design'];
            for (const imageMode of imageModes) {
              await setLayout(page, layout, {
                imageMode: imageMode === 'not-present-by-design' ? undefined : imageMode,
                mobile: viewport.width < 900,
              });
              await enterPreview(page);
              await openRussianDetail(page);
              const beforeBackground = await page.evaluate(() => ({
                clientSiteScrollTop: document.querySelector('.client-site')?.scrollTop ?? null,
                windowScrollY: window.scrollY,
              }));
              const top = await measureServiceDetail(page, {
                imageMode,
                layout,
                phase: 'top',
                viewport: viewport.label,
              });
              await scrollDetailToBottom(page);
              const bottom = await measureServiceDetail(page, {
                imageMode,
                layout,
                phase: 'bottom',
                viewport: viewport.label,
              });
              assert.equal(bottom.actionInViewport, true, `${layout} ${viewport.label}: final action was not reachable.`);
              await assertBackgroundDidNotMove(
                page,
                beforeBackground,
                `${layout} ${viewport.label} ${imageMode}`,
              );
              await closeDetail(page);
              const afterClose = await page.evaluate(() => ({
                clientSiteScrollTop: document.querySelector('.client-site')?.scrollTop ?? null,
                windowScrollY: window.scrollY,
              }));
              assert.deepEqual(
                afterClose,
                beforeBackground,
                `${layout} ${viewport.label} ${imageMode}: close did not restore the menu position.`,
              );

              await openRussianDetail(page);
              await scrollDetailToBottom(page);
              await primaryDetailAction(page).click();
              const summary = page.getByTestId('selected-service-summary');
              await summary.waitFor({ state: 'visible' });
              await summary.getByRole('button', { name: 'Change' }).click();
              await detailDialog(page).waitFor({ state: 'visible' });
              await scrollDetailToBottom(page);
              await detailDialog(page)
                .getByRole('button', { name: 'Remove selected service' })
                .click();
              await detailDialog(page).waitFor({ state: 'detached' });
              measurements.f1.push({
                afterClose,
                bottom,
                primaryActionClicked: true,
                top,
              });
              await backToEditor(page);
            }
          }
        },
      );
    }
  }

  await withPage(
    browser,
    'f1-trusted-touch-start-locations',
    {
      mobile: true,
      reducedMotion: false,
      viewport: { height: 844, width: 390 },
    },
    async (page) => {
      await openFresh(page, 'f1-trusted-touch-start-locations');
      await chooseStarter(page, 'Quick Book');
      await setLayout(page, 'visual_grid', { imageMode: 'show', mobile: true });
      await enterPreview(page);

      const targets = [
        ['image', '.booking-detail-image-wrap'],
        ['description', '.booking-detail-description'],
        ['add-on row', '.booking-add-on-option'],
        ['empty body area', '.booking-detail-copy'],
        ['near action region', '.booking-detail-actions'],
      ];
      const gestureSession = await page.context().newCDPSession(page);

      for (const [label, selector] of targets) {
        await openRussianDetail(page);
        const target = detailDialog(page).locator(selector).first();
        await target.evaluate(element => element.scrollIntoView({
          block: 'center',
          inline: 'nearest',
        }));
        const position = await detailBody(page).evaluate(element => ({
          maximum: element.scrollHeight - element.clientHeight,
          scrollTop: element.scrollTop,
        }));
        const before = position.scrollTop;
        let gestureTarget = target;
        let originPoint = null;
        let distance = position.scrollTop < position.maximum - 4 ? 220 : -180;
        if (label === 'near action region') {
          gestureTarget = detailDialog(page).locator('.booking-detail-copy');
          const actionsBox = await target.boundingBox();
          const optionsBox = await detailDialog(page)
            .locator('.booking-add-on-fieldset')
            .boundingBox();
          assert.ok(actionsBox, 'Action region was not visible for the trusted swipe.');
          assert.ok(optionsBox, 'Add-on fieldset was not visible for the trusted swipe.');
          originPoint = {
            x: actionsBox.x + 8,
            y: (optionsBox.y + optionsBox.height + actionsBox.y) / 2,
          };
          const originClass = await page.evaluate(({ x, y }) => (
            document.elementFromPoint(x, y)?.className
          ), originPoint);
          assert.equal(
            originClass,
            'booking-detail-copy',
            'Near-action swipe did not begin on the empty body area above the action row.',
          );
          distance = -80;
        }
        const gesture = await trustedVerticalSwipe(
          page,
          gestureTarget,
          distance,
          originPoint,
          gestureSession,
        );
        const after = await detailBody(page).evaluate(element => element.scrollTop);
        measurements.f1Gestures.push({ after, before, gesture, label });
        assert.notEqual(after, before, `Trusted swipe from ${label} did not move the internal body.`);
        await detailDialog(page)
          .getByRole('button', { name: 'Keep browsing' })
          .click();
        await detailDialog(page).waitFor({ state: 'detached' });
      }
      await gestureSession.detach();
    },
  );

  if (gesturesOnly) {
    return;
  }

  await withPage(
    browser,
    'f1-simulated-phone-containment',
    { mobile: false, viewport: { height: 900, width: 1440 } },
    async (page) => {
      await openFresh(page, 'f1-simulated-phone-containment');
      await chooseStarter(page, 'Quick Book');
      await enterPreview(page);
      await selectPreviewDevice(page, 'Phone');
      await openRussianDetail(page);
      await scrollDetailToBottom(page);
      const dialogBox = await detailDialog(page).boundingBox();
      const frameBox = await page.locator('.preview-frame').boundingBox();
      assert.ok(dialogBox && frameBox, 'Simulated Phone dialog or frame was not visible.');
      const contained = dialogBox.x >= frameBox.x - 1
        && dialogBox.y >= frameBox.y - 1
        && dialogBox.x + dialogBox.width <= frameBox.x + frameBox.width + 1
        && dialogBox.y + dialogBox.height <= frameBox.y + frameBox.height + 1;
      assert.equal(contained, true, 'Service detail escaped the simulated Phone frame.');
      measurements.f1SimulatedPhone.push({ contained, dialogBox, frameBox });
    },
  );
}

async function featuredGeometry(locator) {
  return locator.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    const image = element.querySelector('img');
    const imageRectangle = image?.getBoundingClientRect();
    return {
      aspectRatio: rectangle.width / rectangle.height,
      element: {
        height: rectangle.height,
        width: rectangle.width,
      },
      image: imageRectangle
        ? {
            height: imageRectangle.height,
            objectFit: getComputedStyle(image).objectFit,
            width: imageRectangle.width,
          }
        : null,
      minimumHeight: getComputedStyle(element).minHeight,
      role: element.getAttribute('role'),
      tagName: element.tagName,
    };
  });
}

async function measureFeaturedRail(page) {
  const rail = page.locator('.featured-scroller').first();
  const tiles = rail.locator('.featured-tile');
  const first = tiles.first();
  const middle = tiles.nth(Math.floor((await tiles.count()) / 2));
  const last = tiles.last();
  const [railData, firstBox, middleBox, lastBox] = await Promise.all([
    rail.evaluate(element => ({
      clientWidth: element.clientWidth,
      columnGap: getComputedStyle(element).columnGap,
      scrollLeft: element.scrollLeft,
      scrollWidth: element.scrollWidth,
    })),
    first.boundingBox(),
    middle.boundingBox(),
    last.boundingBox(),
  ]);
  return {
    first: await featuredGeometry(first),
    firstBox,
    lastBox,
    middleBox,
    rail: railData,
    tileCount: await tiles.count(),
  };
}

function classifyGeometry(edit, preview) {
  const heightDelta = Math.abs(edit.first.element.height - preview.first.element.height);
  const ratioDelta = Math.abs(edit.first.aspectRatio - preview.first.aspectRatio);
  if (heightDelta <= 2 && ratioDelta <= 0.04) {
    return 'MATCH';
  }
  if (Math.abs(edit.first.element.width - preview.first.element.width) > 8) {
    return 'INTENTIONAL RESPONSIVE DIFFERENCE';
  }
  return 'UNEXPLAINED MISMATCH';
}

async function measureF2Matrix(browser) {
  for (const viewport of f2Viewports) {
    await withPage(
      browser,
      `f2-${viewport.label}`,
      {
        mobile: viewport.width < 900,
        viewport: { height: viewport.height, width: viewport.width },
      },
      async (page) => {
        await openFresh(page, `f2-${viewport.label}`);
        await chooseStarter(page, 'Quick Book');
        await bookingArticle(page).scrollIntoViewIfNeeded();
        const edit = await measureFeaturedRail(page);
        await enterPreview(page);
        await scrollPreviewBookingIntoView(page);
        const preview = await measureFeaturedRail(page);
        const classification = classifyGeometry(edit, preview);
        assert.notEqual(classification, 'UNEXPLAINED MISMATCH', `${viewport.label}: Featured geometry mismatch.`);
        assert.equal(preview.first.tagName, 'BUTTON', `${viewport.label}: Preview Featured tile lost button semantics.`);
        assert.ok(preview.first.element.height >= 170, `${viewport.label}: Preview Featured tile collapsed.`);
        measurements.f2.push({ classification, edit, preview, viewport: viewport.label });
      },
    );
  }

  await withPage(
    browser,
    'f2-simulated-tablet',
    { mobile: false, viewport: { height: 900, width: 1440 } },
    async (page) => {
      await openFresh(page, 'f2-simulated-tablet');
      await chooseStarter(page, 'Quick Book');
      await enterPreview(page);
      await selectPreviewDevice(page, 'Tablet');
      await scrollPreviewBookingIntoView(page);
      const preview = await measureFeaturedRail(page);
      assert.ok(preview.first.element.height >= 170, 'Simulated Tablet Featured tile collapsed.');
      measurements.f2SimulatedTablet.push({ preview });
    },
  );
}

async function captureFeaturedScreenshots(browser) {
  for (const entry of [
    {
      editFile: screenshotFiles.featuredMobileEdit,
      mobile: true,
      previewFile: screenshotFiles.featuredMobilePreview,
      viewport: { height: 844, width: 390 },
    },
    {
      editFile: screenshotFiles.featuredDesktopEdit,
      mobile: false,
      previewFile: screenshotFiles.featuredDesktopPreview,
      viewport: { height: 900, width: 1440 },
    },
  ]) {
    await withPage(
      browser,
      `featured-screenshots-${entry.viewport.width}`,
      entry,
      async (page) => {
        await openFresh(page, `featured-screenshots-${entry.viewport.width}`);
        await chooseStarter(page, 'Quick Book');
        await bookingArticle(page).scrollIntoViewIfNeeded();
        await screenshot(page, entry.editFile, { mode: 'edit', viewport: entry.viewport });
        await enterPreview(page);
        await scrollPreviewBookingIntoView(page);
        await screenshot(page, entry.previewFile, { mode: 'preview', viewport: entry.viewport });
        if (entry.mobile) {
          await openRussianDetail(page);
          await scrollDetailToBottom(page);
          await primaryDetailAction(page).click();
          await page.getByTestId('selected-service-summary').waitFor({ state: 'visible' });
          const selectedTile = page.locator('.featured-tile[data-selected="true"]');
          await selectedTile.scrollIntoViewIfNeeded();
          const selectedState = await selectedTile.evaluate((tile) => {
            const badge = tile.querySelector('.booking-selected-indicator');
            const badgeRect = badge?.getBoundingClientRect();
            const tileRect = tile.getBoundingClientRect();
            return {
              ariaPressed: tile.getAttribute('aria-pressed'),
              badge: badgeRect
                ? {
                    bottom: badgeRect.bottom - tileRect.top,
                    left: badgeRect.left - tileRect.left,
                    right: badgeRect.right - tileRect.left,
                    top: badgeRect.top - tileRect.top,
                  }
                : null,
              tagName: tile.tagName,
            };
          });
          assert.equal(selectedState.ariaPressed, 'true');
          assert.equal(selectedState.tagName, 'BUTTON');
          assert.ok(selectedState.badge, 'Selected Featured tile lost its selected badge.');
          measurements.f2.push({ selectedState, viewport: '390x844' });
          await screenshot(page, screenshotFiles.featuredSelected, {
            mode: 'preview-selected',
            viewport: entry.viewport,
          });
        }
      },
    );
  }
}

async function measureSearchState(page, layout, state) {
  const search = page.getByRole('searchbox', { name: 'Search services' }).first();
  const field = search.locator('..');
  const result = await search.evaluate((input) => {
    const wrapper = input.closest('.booking-search-field');
    const clear = wrapper?.querySelectorAll('.booking-search-clear') ?? [];
    const rectangle = input.getBoundingClientRect();
    const clearRectangle = clear[0]?.getBoundingClientRect();
    return {
      accessibleLabel: input.labels?.[0]?.textContent?.trim() ?? null,
      appearance: getComputedStyle(input).appearance,
      clearCount: clear.length,
      clearInsideInput: clearRectangle
        ? clearRectangle.left >= rectangle.left && clearRectangle.right <= rectangle.right
        : null,
      focused: document.activeElement === input,
      placeholder: input.getAttribute('placeholder'),
      value: input.value,
      webkitAppearance: getComputedStyle(input).webkitAppearance,
    };
  });
  return {
    ...result,
    fieldVisible: await field.isVisible(),
    layout,
    state,
  };
}

async function measureF3(browser) {
  await withPage(
    browser,
    'f3-layout-and-state-matrix',
    { mobile: true, viewport: { height: 844, width: 390 } },
    async (page) => {
      await openFresh(page, 'f3-layout-and-state-matrix');
      await chooseStarter(page, 'Quick Book');

      for (const layout of layouts) {
        await setLayout(page, layout, { mobile: true });
        await enterPreview(page);
        await scrollPreviewBookingIntoView(page);
        if (!searchableLayouts.has(layout)) {
          const count = await page.getByRole('searchbox', { name: 'Search services' }).count();
          assert.equal(count, 0, `${layout}: search unexpectedly appeared for canonical menu.`);
          measurements.f3.push({ layout, state: 'NOT PRESENT BY DESIGN' });
          await backToEditor(page);
          continue;
        }

        const search = page.getByRole('searchbox', { name: 'Search services' }).first();
        measurements.f3.push(await measureSearchState(page, layout, 'empty'));
        await search.focus();
        measurements.f3.push(await measureSearchState(page, layout, 'focused'));
        await search.fill('Russian manicure');
        const typed = await measureSearchState(page, layout, 'typed');
        assert.equal(typed.clearCount, 1, `${layout}: expected exactly one Luster clear control.`);
        assert.equal(typed.clearInsideInput, true, `${layout}: clear control escaped the field.`);
        assert.equal(typed.accessibleLabel, 'Search services');
        assert.equal(typed.appearance, 'none');
        assert.equal(typed.placeholder, 'Try “Russian manicure”');
        measurements.f3.push(typed);
        await page.getByRole('button', { name: 'Clear service search' }).click();
        const cleared = await measureSearchState(page, layout, 'cleared');
        assert.equal(cleared.focused, true, `${layout}: clear did not restore focus.`);
        assert.equal(cleared.value, '');
        measurements.f3.push(cleared);
        await search.fill('definitely no matching service');
        await page.getByRole('heading', { name: 'No services found' }).waitFor({ state: 'visible' });
        measurements.f3.push(await measureSearchState(page, layout, 'no results'));
        await page.getByRole('button', { name: 'Clear service search' }).click();
        const pedicure = page.getByRole('button', { name: /^Pedicure(?:,|$)/ }).first();
        await pedicure.scrollIntoViewIfNeeded();
        await pedicure.click();
        await search.fill('Russian manicure');
        const crossCategoryResult = page.getByRole('button', { name: /Russian Manicure/ }).first();
        await crossCategoryResult.waitFor({ state: 'visible' });
        measurements.f3.push({
          crossCategoryResult: await crossCategoryResult.isVisible(),
          layout,
          state: 'cross-category result after category change',
        });
        await page.getByRole('button', { name: 'Clear service search' }).click();
        await backToEditor(page);
      }

      const nativeSuppression = await page.evaluate(() => {
        const cssText = [...document.styleSheets].flatMap((sheet) => {
          try {
            return [...sheet.cssRules].map(rule => rule.cssText);
          } catch {
            return [];
          }
        }).join('\n');
        return {
          cancel: cssText.includes('::-webkit-search-cancel-button'),
          decoration: cssText.includes('::-webkit-search-decoration'),
          resultsButton: cssText.includes('::-webkit-search-results-button'),
          resultsDecoration: cssText.includes('::-webkit-search-results-decoration'),
        };
      });
      assert.deepEqual(nativeSuppression, {
        cancel: true,
        decoration: true,
        resultsButton: true,
        resultsDecoration: true,
      });
      measurements.f3.push({ nativeSuppression, state: 'scoped CSS' });
    },
  );
}

async function captureSearchScreenshots(browser) {
  await withPage(
    browser,
    'search-screenshots',
    { mobile: true, viewport: { height: 844, width: 390 } },
    async (page) => {
      await openFresh(page, 'search-screenshots');
      await chooseStarter(page, 'Quick Book');
      await enterPreview(page);
      await scrollPreviewBookingIntoView(page);
      const search = page.getByRole('searchbox', { name: 'Search services' }).first();
      await search.scrollIntoViewIfNeeded();
      await screenshot(page, screenshotFiles.searchEmpty, { state: 'empty' });
      await search.fill('Russian');
      await screenshot(page, screenshotFiles.searchTyped, { state: 'typed / one clear' });
      await page.getByRole('button', { name: 'Clear service search' }).click();
      await screenshot(page, screenshotFiles.searchCleared, { state: 'cleared / focused' });
      await search.fill('definitely no matching service');
      await page.getByRole('heading', { name: 'No services found' }).waitFor({ state: 'visible' });
      await screenshot(page, screenshotFiles.searchNoResults, { state: 'no results' });
    },
  );
}

async function dirtyDetail(page) {
  await openRussianDetail(page);
  await page.getByRole('checkbox', { name: 'French' }).check();
  const total = detailDialog(page).getByTestId('service-detail-total');
  await total.getByText('1 hr 45 min', { exact: true }).waitFor({ state: 'visible' });
  await total.getByText('From $80', { exact: true }).waitFor({ state: 'visible' });
}

async function requestWarning(page, path) {
  if (path === 'x') {
    await detailDialog(page).getByRole('button', { name: 'Close service details' }).click();
  } else if (path === 'escape') {
    await page.keyboard.press('Escape');
  } else {
    const backdrop = page.getByTestId('service-detail-dialog-backdrop');
    await backdrop.click({ position: { x: 4, y: 4 } });
  }
  await page.getByTestId('booking-option-warning-dialog').waitFor({ state: 'visible' });
}

async function keepEditing(page, layout, path) {
  const warning = page.getByTestId('booking-option-warning-dialog');
  const keep = warning.getByRole('button', { name: 'Keep editing' });
  assert.equal(await keep.isVisible(), true, `${layout} ${path}: Keep editing is not visible.`);
  await keep.click();
  await warning.waitFor({ state: 'detached' });
  assert.equal(await detailDialog(page).isVisible(), true, `${layout} ${path}: detail editor closed.`);
  assert.equal(await page.getByRole('checkbox', { name: 'French' }).isChecked(), true, `${layout} ${path}: draft was lost.`);
  await page.waitForFunction(() => Boolean(
    document.activeElement?.closest('[data-testid="service-detail-dialog"]'),
  ));
  const focus = await page.evaluate(() => ({
    ariaLabel: document.activeElement?.getAttribute('aria-label'),
    insideDetail: Boolean(document.activeElement?.closest('[data-testid="service-detail-dialog"]')),
    text: document.activeElement?.textContent?.trim(),
  }));
  assert.equal(focus.insideDetail, true, `${layout} ${path}: focus did not return to the option editor.`);
  return focus;
}

async function measureF4(browser) {
  await withPage(
    browser,
    'f4-five-layout-close-matrix',
    { mobile: true, viewport: { height: 844, width: 390 } },
    async (page) => {
      await openFresh(page, 'f4-five-layout-close-matrix');
      await chooseStarter(page, 'Quick Book');

      for (const layout of layouts) {
        await setLayout(page, layout, { mobile: true });
        await enterPreview(page);
        await dirtyDetail(page);

        for (const path of ['x', 'escape', 'backdrop']) {
          await requestWarning(page, path);
          const bodyBefore = await page.evaluate(() => ({
            backdropCount: document.querySelectorAll('.booking-contained-dialog-backdrop').length,
            bodyOverflow: getComputedStyle(document.body).overflowY,
          }));
          const focus = await keepEditing(page, layout, path);
          const bodyAfter = await page.evaluate(() => ({
            backdropCount: document.querySelectorAll('.booking-contained-dialog-backdrop').length,
            bodyOverflow: getComputedStyle(document.body).overflowY,
          }));
          assert.equal(bodyBefore.backdropCount, 2, `${layout} ${path}: nested warning stack was incomplete.`);
          assert.equal(bodyAfter.backdropCount, 1, `${layout} ${path}: warning left an overlay behind.`);
          assert.equal(bodyAfter.bodyOverflow, bodyBefore.bodyOverflow, `${layout} ${path}: scroll-lock state leaked.`);
          measurements.f4.push({
            bodyAfter,
            bodyBefore,
            draftPreserved: true,
            focus,
            layout,
            path,
          });
        }

        await requestWarning(page, 'x');
        await page.getByTestId('booking-option-warning-dialog')
          .getByRole('button', { name: 'Discard changes' })
          .click();
        await detailDialog(page).waitFor({ state: 'detached' });
        measurements.f4.push({ layout, path: 'discard', result: 'detail closed; draft discarded' });

        await dirtyDetail(page);
        await requestWarning(page, 'x');
        await page.getByTestId('booking-option-warning-dialog')
          .getByRole('button', { name: 'Save changes' })
          .click();
        await detailDialog(page).waitFor({ state: 'detached' });
        await page.getByTestId('selected-service-summary').waitFor({ state: 'visible' });
        measurements.f4.push({ layout, path: 'save', result: 'summary visible; selection committed' });

        await page.getByTestId('selected-service-summary')
          .getByRole('button', { name: 'Change' })
          .click();
        await detailDialog(page).waitFor({ state: 'visible' });
        await scrollDetailToBottom(page);
        await detailDialog(page)
          .getByRole('button', { name: 'Remove selected service' })
          .click();
        await detailDialog(page).waitFor({ state: 'detached' });
        await backToEditor(page);
      }
    },
  );
}

async function captureKeepEditingScreenshots(browser) {
  await withPage(
    browser,
    'keep-editing-screenshots',
    { mobile: true, viewport: { height: 568, width: 320 } },
    async (page) => {
      await openFresh(page, 'keep-editing-screenshots');
      await chooseStarter(page, 'Quick Book');
      await enterPreview(page);
      await dirtyDetail(page);
      await requestWarning(page, 'x');
      await screenshot(page, screenshotFiles.warning320, {
        state: 'dirty warning',
        viewport: '320x568',
      });
      const warningGeometry = await page.getByTestId('booking-option-warning-dialog').evaluate((dialog) => {
        const dialogRect = dialog.getBoundingClientRect();
        const actions = [...dialog.querySelectorAll('.booking-option-warning-actions button')]
          .map((button) => {
            const rectangle = button.getBoundingClientRect();
            return {
              bottom: rectangle.bottom,
              label: button.textContent?.trim(),
              left: rectangle.left,
              right: rectangle.right,
              top: rectangle.top,
            };
          });
        return {
          actions,
          clientWidth: dialog.clientWidth,
          contained: actions.every(action => (
            action.left >= dialogRect.left
            && action.right <= dialogRect.right
            && action.top >= dialogRect.top
            && action.bottom <= dialogRect.bottom
          )),
          scrollWidth: dialog.scrollWidth,
        };
      });
      assert.equal(warningGeometry.contained, true, '320px warning actions were clipped.');
      assert.ok(warningGeometry.scrollWidth <= warningGeometry.clientWidth + 1, '320px warning overflowed horizontally.');
      measurements.f4.push({ layout: 'visual_grid', path: '320px geometry', warningGeometry });
      await page.getByTestId('booking-option-warning-dialog')
        .getByRole('button', { name: 'Keep editing' })
        .focus();
      await screenshot(page, screenshotFiles.warningKeepEditing, {
        state: 'visible focused Keep editing action',
        viewport: '320x568',
      });
      await keepEditing(page, 'visual_grid', 'x');
      await screenshot(page, screenshotFiles.warningReturned, {
        state: 'draft-preserving returned editor',
        viewport: '320x568',
      });
    },
  );
}

async function measureHierarchy(page, phase) {
  const result = await page.evaluate(() => {
    const app = document.querySelector('.final-hybrid-app');
    const frame = document.querySelector('.final-canvas-frame');
    const canvas = document.querySelector('.final-site-canvas');
    const list = document.querySelector('.final-sections-list');
    const unselected = document.querySelector('.section-card:not(.is-selected)');
    const selected = document.querySelector('.section-card.is-selected');
    const placeholder = document.querySelector('.placeholder-grid span');
    const preview = document.querySelector('.final-hybrid-preview');
    const shadow = unselected ? getComputedStyle(unselected).boxShadow : null;
    return {
      appTokens: app
        ? {
            cardLine: getComputedStyle(app).getPropertyValue('--edit-card-line').trim(),
            ground: getComputedStyle(app).getPropertyValue('--edit-ground').trim(),
            gutter: getComputedStyle(app).getPropertyValue('--edit-gutter').trim(),
            section: getComputedStyle(app).getPropertyValue('--edit-section').trim(),
            sectionLine: getComputedStyle(app).getPropertyValue('--edit-section-line').trim(),
            sectionLineStrong: getComputedStyle(app).getPropertyValue('--edit-section-line-strong').trim(),
          }
        : null,
      canvasBackground: canvas ? getComputedStyle(canvas).backgroundColor : null,
      frameBackground: frame ? getComputedStyle(frame).backgroundColor : null,
      gap: list ? getComputedStyle(list).rowGap : null,
      placeholder: placeholder
        ? {
            backgroundImage: getComputedStyle(placeholder).backgroundImage,
            border: getComputedStyle(placeholder).border,
            opacity: getComputedStyle(placeholder.closest('.placeholder-grid')).opacity,
          }
        : null,
      previewEditorToken: preview
        ? getComputedStyle(preview).getPropertyValue('--edit-ground').trim()
        : null,
      selected: selected
        ? {
            boxShadow: getComputedStyle(selected).boxShadow,
            outlineColor: getComputedStyle(selected).outlineColor,
            outlineWidth: getComputedStyle(selected).outlineWidth,
          }
        : null,
      unselected: unselected
        ? {
            backgroundColor: getComputedStyle(unselected).backgroundColor,
            borderBlockEnd: getComputedStyle(unselected).borderBlockEnd,
            borderBlockStart: getComputedStyle(unselected).borderBlockStart,
            borderRadius: getComputedStyle(unselected).borderRadius,
            boxShadow: shadow === 'none' ? 'none' : shadow,
          }
        : null,
    };
  });
  measurements.hierarchy.push({ phase, ...result });
  return result;
}

async function captureHierarchyScreenshots(browser) {
  await withPage(
    browser,
    'hierarchy-quick-mobile',
    { mobile: true, viewport: { height: 844, width: 390 } },
    async (page) => {
      await openFresh(page, 'hierarchy-quick-mobile');
      await chooseStarter(page, 'Quick Book');
      await screenshot(page, screenshotFiles.hierarchyQuickMobile, { starter: 'Quick Book' });
      const hierarchy = await measureHierarchy(page, 'Quick Book mobile');
      assert.equal(hierarchy.gap, '8px');
      assert.equal(hierarchy.unselected.backgroundColor, 'rgb(255, 255, 255)');
      assert.equal(hierarchy.unselected.borderRadius, '0px');
      assert.equal(hierarchy.unselected.boxShadow, 'none');
      await enterPreview(page);
      const previewIsolation = await page.evaluate(() => {
        const preview = document.querySelector('.final-hybrid-preview');
        const section = document.querySelector('.preview-section');
        return {
          editGroundToken: preview
            ? getComputedStyle(preview).getPropertyValue('--edit-ground').trim()
            : null,
          sectionBackground: section ? getComputedStyle(section).backgroundColor : null,
        };
      });
      assert.equal(previewIsolation.editGroundToken, '');
      measurements.hierarchy.push({
        phase: 'customer Preview editor-token isolation',
        previewIsolation,
      });
    },
  );

  await withPage(
    browser,
    'hierarchy-one-page-mobile',
    { mobile: true, viewport: { height: 844, width: 390 } },
    async (page) => {
      await openFresh(page, 'hierarchy-one-page-mobile');
      await chooseStarter(page, 'One-page website');
      await screenshot(page, screenshotFiles.hierarchyOnePageMobile, { starter: 'One-page website' });

      await selectSection(page, 'Section 01', true);
      await screenshot(page, screenshotFiles.hierarchySelectedMobile, { selected: 'Section 01' });
      await measureHierarchy(page, 'One-page selected Section 01 mobile');

      await selectSection(page, 'Booking', true);
      await screenshot(page, screenshotFiles.hierarchyBookingSelected, { selected: 'Booking' });

      await selectSection(page, 'Section 02', true);
      await selectedOwnerControls(page, true)
        .getByRole('button', { exact: true, name: 'Hide' })
        .click();
      await page.locator('article[data-section-label="Section 02"].is-hidden')
        .waitFor({ state: 'visible' });
      await screenshot(page, screenshotFiles.hierarchyHidden, { hidden: 'Section 02' });
    },
  );

  await withPage(
    browser,
    'hierarchy-desktop',
    { mobile: false, viewport: { height: 900, width: 1440 } },
    async (page) => {
      await openFresh(page, 'hierarchy-desktop');
      await chooseStarter(page, 'One-page website');
      await screenshot(page, screenshotFiles.hierarchyDesktop, { starter: 'One-page website' });
      const section = page.locator('article[data-section-label="Section 02"]');
      await section.scrollIntoViewIfNeeded();
      await section.hover();
      await screenshot(page, screenshotFiles.hierarchyHover, { hovered: 'Section 02' });
      await measureHierarchy(page, 'One-page desktop hover');
    },
  );

  for (const entry of [
    {
      file: screenshotFiles.starterMobile,
      mobile: true,
      phase: 'starter-mobile',
      viewport: { height: 844, width: 390 },
    },
    {
      file: screenshotFiles.starterDesktop,
      mobile: false,
      phase: 'starter-desktop',
      viewport: { height: 900, width: 1440 },
    },
  ]) {
    await withPage(browser, entry.phase, { ...entry, reducedMotion: false }, async (page) => {
      await openFresh(page, entry.phase);
      if (!entry.mobile) {
        await page.locator('[data-starter-id="quick_book"]').hover();
        await page.waitForTimeout(220);
      }
      await screenshot(page, entry.file, {
        preservePointer: !entry.mobile,
        state: entry.mobile ? 'starter chooser idle' : 'starter chooser animated hover',
      });
      const chooser = await page.evaluate(() => {
        const screen = document.querySelector('.final-starter-screen');
        const card = document.querySelector('.final-starter-card');
        const preview = document.querySelector('.final-starter-preview');
        return {
          animationCount: preview?.getAnimations({ subtree: true }).length ?? 0,
          cardBackground: card ? getComputedStyle(card).backgroundColor : null,
          ground: screen ? getComputedStyle(screen).backgroundColor : null,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        };
      });
      assert.equal(chooser.cardBackground, 'rgb(255, 255, 255)');
      assert.equal(chooser.ground, 'rgb(247, 242, 236)');
      assert.ok(chooser.animationCount > 0, `${entry.phase}: starter animation did not remain active.`);
      measurements.hierarchy.push({ chooser, phase: entry.phase });
    });
  }

  await withPage(
    browser,
    'starter-reduced-motion-measurement',
    {
      mobile: false,
      reducedMotion: true,
      viewport: { height: 900, width: 1440 },
    },
    async (page) => {
      await openFresh(page, 'starter-reduced-motion-measurement');
      await page.locator('[data-starter-id="quick_book"]').hover();
      const reducedMotion = await page.evaluate(() => {
        const preview = document.querySelector(
          '[data-starter-id="quick_book"] .final-starter-preview',
        );
        return {
          active: preview?.getAttribute('data-preview-active'),
          animations: preview?.getAnimations({ subtree: true }).map(animation => ({
            currentTime: animation.currentTime,
            playState: animation.playState,
          })) ?? [],
          mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        };
      });
      assert.equal(reducedMotion.mediaMatches, true);
      measurements.hierarchy.push({
        phase: 'starter reduced motion',
        reducedMotion,
      });
    },
  );
}

async function recordVideo(browser, {
  action,
  file,
  mobile,
  phase,
  viewport,
}) {
  const scratchDirectory = await mkdtemp(join(outputDirectory, '.video-'));
  const context = await browser.newContext(contextOptions({
    deviceScaleFactor: 1,
    mobile,
    recordVideoDirectory: scratchDirectory,
    reducedMotion: false,
    viewport,
  }));
  const page = await context.newPage();
  const stopMonitor = startRuntimeMonitor(page, phase);
  const video = page.video();
  let actionError = null;

  try {
    await action(page, context);
  } catch (error) {
    actionError = error;
  } finally {
    stopMonitor();
    await context.close();
  }

  try {
    if (!actionError) {
      assert.ok(video, `${phase}: Playwright did not create a video recorder.`);
      await ensureEvidenceParent(file);
      await video.saveAs(evidencePath(file));
      recordEvidence(file, { kind: 'video', phase, viewport });
    }
  } finally {
    await rm(scratchDirectory, { force: true, recursive: true });
  }

  if (actionError) {
    throw actionError;
  }
}

async function captureVideos(browser) {
  await recordVideo(browser, {
    action: async (page) => {
      await openFresh(page, 'video-service-detail-scroll');
      await chooseStarter(page, 'Quick Book');
      await enterPreview(page);
      await openRussianDetail(page);
      await page.waitForTimeout(500);
      await trustedVerticalSwipe(page, detailBody(page), 360);
      await page.waitForTimeout(350);
      await trustedVerticalSwipe(page, detailBody(page), 360);
      await page.waitForTimeout(350);
      await scrollDetailToBottom(page);
      assert.equal(await primaryDetailAction(page).isVisible(), true);
      await page.waitForTimeout(1_100);
    },
    file: videoFiles.serviceScroll,
    mobile: true,
    phase: 'mobile Service Detail scrolling',
    viewport: { height: 600, width: 375 },
  });

  await recordVideo(browser, {
    action: async (page) => {
      await openFresh(page, 'video-russian-french-flow');
      await chooseStarter(page, 'Quick Book');
      await enterPreview(page);
      await openRussianDetail(page);
      await page.getByRole('checkbox', { name: 'French' }).check();
      const total = detailDialog(page).getByTestId('service-detail-total');
      await total.getByText('1 hr 45 min', { exact: true }).waitFor();
      await total.getByText('From $80', { exact: true }).waitFor();
      await page.waitForTimeout(650);
      await scrollDetailToBottom(page);
      await page.waitForTimeout(650);
      await primaryDetailAction(page).click();
      const summary = page.getByTestId('selected-service-summary');
      await summary.waitFor({ state: 'visible' });
      await page.waitForTimeout(650);
      await summary.getByRole('button', { name: 'Continue' }).click();
      await page.getByTestId('booking-handoff-dialog').waitFor({ state: 'visible' });
      await page.waitForTimeout(650);
      await page.getByRole('button', { name: 'Back to the menu' }).click();
      await page.getByTestId('booking-handoff-dialog').waitFor({ state: 'detached' });
      await page.waitForTimeout(650);
    },
    file: videoFiles.russianFrench,
    mobile: true,
    phase: 'Russian Manicure and French journey',
    viewport: { height: 600, width: 375 },
  });

  await recordVideo(browser, {
    action: async (page) => {
      await openFresh(page, 'video-featured-parity');
      await chooseStarter(page, 'Quick Book');
      await bookingArticle(page).scrollIntoViewIfNeeded();
      const editRailBox = await page.locator('.featured-scroller').first().boundingBox();
      assert.ok(editRailBox, 'Featured Edit rail was not visible for the comparison video.');
      await page.mouse.move(
        editRailBox.x + editRailBox.width / 2,
        editRailBox.y + editRailBox.height / 2,
      );
      await page.waitForTimeout(1_200);
      await enterPreview(page);
      await scrollPreviewBookingIntoView(page);
      const rail = page.locator('.featured-scroller').first();
      await rail.hover();
      await page.waitForTimeout(700);
      await page.mouse.wheel(450, 0);
      await page.waitForTimeout(1_000);
      await page.mouse.wheel(-450, 0);
      await page.waitForTimeout(900);
    },
    file: videoFiles.featuredParity,
    mobile: false,
    phase: 'Featured Edit and Preview comparison',
    viewport: { height: 900, width: 1440 },
  });

  await recordVideo(browser, {
    action: async (page) => {
      await openFresh(page, 'video-mobile-section-hierarchy');
      await chooseStarter(page, 'One-page website');
      await page.locator('article[data-section-label="Section 01"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await selectSection(page, 'Section 01', true);
      await page.waitForTimeout(700);
      await selectSection(page, 'Section 03', true);
      await page.waitForTimeout(700);
      await selectSection(page, 'Booking', true);
      await page.waitForTimeout(700);
    },
    file: videoFiles.hierarchy,
    mobile: true,
    phase: 'mobile section-stack hierarchy',
    viewport: { height: 600, width: 375 },
  });

  await recordVideo(browser, {
    action: async (page) => {
      await openFresh(page, 'video-keep-editing');
      await chooseStarter(page, 'Quick Book');
      await enterPreview(page);
      await dirtyDetail(page);
      await page.waitForTimeout(650);
      await requestWarning(page, 'x');
      await page.waitForTimeout(900);
      await keepEditing(page, 'visual_grid', 'x');
      await page.waitForTimeout(1_100);
      await requestWarning(page, 'escape');
      await page.waitForTimeout(900);
      await page.getByTestId('booking-option-warning-dialog')
        .getByRole('button', { name: 'Discard changes' })
        .click();
      await detailDialog(page).waitFor({ state: 'detached' });
      await page.waitForTimeout(650);
    },
    file: videoFiles.keepEditing,
    mobile: true,
    phase: 'Keep editing dirty-options flow',
    viewport: { height: 568, width: 320 },
  });
}

async function restoreAndVerify(browser) {
  await withPage(
    browser,
    'final-live-ui-restoration',
    { mobile: false, viewport: { height: 900, width: 1440 } },
    async (page) => {
      await openFresh(page, 'final-live-ui-restoration');
      await chooseStarter(page, 'Quick Book');

      await selectSection(page, 'Section 01', false);
      await page.getByRole('button', { name: 'More site options' }).click();
      const more = page.getByRole('dialog', { name: 'More' });
      await more.getByRole('button', { name: 'Reset to starter kit' }).click();
      const confirmation = page.getByRole('dialog', { name: 'Reset to the starting point?' });
      await confirmation.getByRole('button', { name: 'Reset to starter' }).click();
      await page.getByTestId('final-hybrid-editor').waitFor({ state: 'visible' });
      const toast = page.locator('.toast');
      if (await toast.isVisible()) {
        await toast.waitFor({ state: 'detached', timeout: 5_000 });
      }

      const reload = await page.reload({ waitUntil: 'domcontentloaded' });
      assert.ok(reload && reload.status() < 400, 'Restored-state reload failed.');
      await page.getByTestId('final-hybrid-editor').waitFor({ state: 'visible' });

      const restored = await page.evaluate(() => {
        const sections = [...document.querySelectorAll(
          '.final-sections-list article[data-section-label]',
        )]
          .map(element => ({
            label: element.getAttribute('data-section-label'),
            selected: element.classList.contains('is-selected'),
            type: element.getAttribute('data-section-type'),
            visible: !element.classList.contains('is-hidden'),
          }));
        const storedDocuments = Object.entries(localStorage)
          .filter(([, value]) => value.includes('originStarter'))
          .map(([key, value]) => ({ key, value: JSON.parse(value) }));
        return {
          activeDialogs: document.querySelectorAll('[role="dialog"]:not([hidden])').length,
          bodyOverflow: getComputedStyle(document.body).overflowY,
          bookingLayout: document.querySelector('.booking-surface')?.getAttribute('data-layout'),
          bookingServiceCount: document.querySelector('[aria-label^="Booking menu preview"]')
            ?.getAttribute('aria-label'),
          handoff: document.querySelectorAll('[data-testid="booking-handoff-dialog"]').length,
          helperStorageKeys: Object.keys(localStorage).filter(key => !storedDocuments.some(document => document.key === key)),
          mode: document.querySelector('[data-testid="final-hybrid-editor"]') ? 'edit' : 'other',
          searchValues: [...document.querySelectorAll('input[type="search"]')]
            .map(input => input.value),
          sections,
          serviceDetail: document.querySelectorAll('[data-testid="service-detail-dialog"]').length,
          storedDocuments,
          warning: document.querySelectorAll('[data-testid="booking-option-warning-dialog"]').length,
          windowScrollY: window.scrollY,
        };
      });

      assert.deepEqual(restored.sections.map(section => section.label), [
        'Section 01',
        'Section 02',
        'Booking',
      ]);
      assert.equal(restored.sections.some(section => section.selected), false);
      assert.equal(restored.sections.every(section => section.visible), true);
      assert.equal(restored.bookingLayout, 'visual_grid');
      assert.match(restored.bookingServiceCount ?? '', /24 services/);
      assert.equal(restored.mode, 'edit');
      assert.equal(restored.activeDialogs, 0);
      assert.equal(restored.serviceDetail, 0);
      assert.equal(restored.warning, 0);
      assert.equal(restored.handoff, 0);
      assert.deepEqual(restored.searchValues, ['']);
      assert.deepEqual(restored.helperStorageKeys, []);
      assert.notEqual(restored.bodyOverflow, 'hidden');
      assert.equal(restored.storedDocuments.length, 1);
      const restoredDocument = restored.storedDocuments[0].value;
      assert.equal(restoredDocument.originStarter, 'quick_book');
      assert.equal(restoredDocument.pages.length, 1);
      assert.equal(restoredDocument.pages[0].name, 'Home');
      assert.equal(restoredDocument.pages[0].sections.length, 3);
      assert.equal(restoredDocument.pages[0].sections[2].settings.layout, 'visual_grid');
      measurements.restoration = restored;
    },
  );
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const startedAt = new Date().toISOString();
  const focusedCheck = process.argv[2] ?? null;
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: false,
  });
  let runError = null;

  try {
    if (focusedCheck === '--gesture-check') {
      await measureF1Matrix(browser, { gesturesOnly: true });
    } else if (focusedCheck === '--keep-editing-check') {
      await captureKeepEditingScreenshots(browser);
      await measureF4(browser);
    } else if (focusedCheck === '--hierarchy-check') {
      await captureHierarchyScreenshots(browser);
    } else if (focusedCheck === '--videos-check') {
      await captureVideos(browser);
    } else if (focusedCheck === '--restore-check') {
      await restoreAndVerify(browser);
    } else {
      await captureServiceDetailScreenshots(browser);
      await measureF1Matrix(browser);
      await captureFeaturedScreenshots(browser);
      await measureF2Matrix(browser);
      await captureSearchScreenshots(browser);
      await measureF3(browser);
      await captureKeepEditingScreenshots(browser);
      await measureF4(browser);
      await captureHierarchyScreenshots(browser);
      await captureVideos(browser);
      await restoreAndVerify(browser);

      assert.deepEqual(
        Object.values(screenshotFiles).sort(),
        evidenceEntries.filter(entry => entry.kind === 'screenshot').map(entry => entry.file).sort(),
        'The evidence run did not capture the complete 30-screenshot manifest.',
      );
      assert.deepEqual(
        Object.values(videoFiles).sort(),
        evidenceEntries.filter(entry => entry.kind === 'video').map(entry => entry.file).sort(),
        'The evidence run did not capture the complete five-video manifest.',
      );
    }
    assert.deepEqual(runtimeIssues, [], 'Runtime monitoring found console, page, request, or HTTP failures.');
  } catch (error) {
    runError = error;
  } finally {
    await browser.close();
    await Promise.all([
      writeJson('measurements/f1-service-detail.json', {
        gestures: measurements.f1Gestures,
        matrix: measurements.f1,
        simulatedPhone: measurements.f1SimulatedPhone,
      }),
      writeJson('measurements/f2-featured-parity.json', {
        matrix: measurements.f2,
        simulatedTablet: measurements.f2SimulatedTablet,
      }),
      writeJson('measurements/f3-search.json', measurements.f3),
      writeJson('measurements/f4-keep-editing.json', measurements.f4),
      writeJson('measurements/editor-hierarchy.json', measurements.hierarchy),
      writeJson('measurements/final-restored-state.json', measurements.restoration),
      writeJson('runtime/http-checks.json', httpChecks),
      writeJson('runtime/runtime-issues.json', runtimeIssues),
      writeJson('evidence-manifest.json', {
        entries: evidenceEntries,
        finishedAt: new Date().toISOString(),
        startedAt,
        status: runError ? 'failed' : 'passed',
      }),
    ]);
  }

  if (runError) {
    throw runError;
  }
  process.stdout.write(
    `Consolidated evidence captured: ${evidenceEntries.length} files; runtime issues: ${runtimeIssues.length}.\n`,
  );
}

await main();
