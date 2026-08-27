import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { chromium, devices } from '@playwright/test';

const baseUrl = process.env.LUSTER_LAB_URL ?? 'http://127.0.0.1:4182';
const outputDirectory = '/tmp/luster-starter-chooser-motion';
const labStorageKey =
  'luster:site-builder-v2-booking-integration-lab:document:v1';

const mobileViewport = { height: 844, width: 390 };
const desktopViewport = { height: 900, width: 1440 };
const resetDelayMs = 260;

const starters = {
  multi_page: {
    name: 'Multi-page website',
    previewTestId: 'starter-preview-multi_page',
  },
  one_page: {
    name: 'One-page website',
    previewTestId: 'starter-preview-one_page',
  },
  quick_book: {
    name: 'Quick Book',
    previewTestId: 'starter-preview-quick_book',
  },
};

const requiredScreenshots = [
  '01-mobile-chooser-top-390x844.png',
  '02-mobile-quick-book-active.png',
  '03-mobile-one-page-active.png',
  '04-mobile-multi-page-home.png',
  '05-mobile-multi-page-services.png',
  '06-mobile-multi-page-gallery.png',
  '07-desktop-chooser-idle-1440x900.png',
  '08-desktop-quick-book-hover.png',
  '09-desktop-one-page-hover.png',
  '10-desktop-multi-page-hover.png',
  '11-desktop-keyboard-focused-card.png',
  '12-reduced-motion-mobile-390x844.png',
  '13-reduced-motion-desktop-1440x900.png',
  '14-bottom-reassurance-copy.png',
];

const evidenceEntries = [];
const httpChecks = [];
const runtimeIssues = [];

function card(page, starterId) {
  return page.locator(`[data-starter-id="${starterId}"]`);
}

function preview(page, starterId) {
  return page.getByTestId(starters[starterId].previewTestId);
}

function evidencePath(relativePath) {
  return resolve(outputDirectory, relativePath);
}

async function ensureOutputParent(relativePath) {
  await mkdir(dirname(evidencePath(relativePath)), { recursive: true });
}

async function writeJson(relativePath, value) {
  await ensureOutputParent(relativePath);
  await writeFile(
    evidencePath(relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

function recordEvidence(relativePath, metadata) {
  evidenceEntries.push({
    file: relativePath,
    ...metadata,
  });
}

function startRuntimeMonitor(page, phase) {
  const listeners = {
    console: (message) => {
      if (message.type() !== 'error' && message.type() !== 'warning') return;
      runtimeIssues.push({
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
      if (response.status() < 400) return;
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

function contextOptions({ mobile, reducedMotion, videoDirectory }) {
  const options = {
    colorScheme: 'light',
    locale: 'en-CA',
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    timezoneId: 'America/Toronto',
    viewport: mobile ? mobileViewport : desktopViewport,
  };

  if (mobile) {
    const pixel = devices['Pixel 5'];
    Object.assign(options, {
      deviceScaleFactor: pixel.deviceScaleFactor,
      hasTouch: true,
      isMobile: true,
      userAgent: pixel.userAgent,
    });
  } else {
    Object.assign(options, {
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
    });
  }

  if (videoDirectory) {
    options.recordVideo = {
      dir: videoDirectory,
      size: mobile ? mobileViewport : desktopViewport,
    };
  }

  return options;
}

async function withPage(browser, phase, options, action) {
  const context = await browser.newContext(contextOptions(options));
  const page = await context.newPage();
  const stopMonitor = startRuntimeMonitor(page, phase);

  try {
    return await action(page, context);
  } finally {
    stopMonitor();
    await context.close();
  }
}

async function openFreshChooser(page, phase) {
  const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  assert.ok(response, `${phase}: the Lab navigation returned no response.`);
  httpChecks.push({ phase, status: response.status(), url: response.url() });
  assert.equal(response.status(), 200, `${phase}: the Lab did not return HTTP 200.`);

  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  const reloadResponse = await page.reload({ waitUntil: 'domcontentloaded' });
  if (reloadResponse) {
    assert.ok(
      reloadResponse.status() < 400,
      `${phase}: the fresh-storage reload returned HTTP ${reloadResponse.status()}.`,
    );
  }

  await page.getByRole('heading', { name: 'Choose your starting point' })
    .waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    if (document.fonts) await document.fonts.ready;
  });
  await page.waitForTimeout(120);

  const storedKeys = await page.evaluate(() => Object.keys(window.localStorage));
  assert.deepEqual(storedKeys, [], `${phase}: localStorage was not fresh.`);
}

async function activeStarterIds(page) {
  return page
    .locator('.final-starter-preview[data-preview-active="true"]')
    .evaluateAll((elements) => elements.map((element) => (
      element.closest('[data-starter-id]')?.getAttribute('data-starter-id')
    )));
}

async function assertActiveStarter(page, expectedStarterId) {
  await page.waitForFunction((expected) => {
    const active = [...document.querySelectorAll(
      '.final-starter-preview[data-preview-active="true"]',
    )].map((element) => (
      element.closest('[data-starter-id]')?.getAttribute('data-starter-id')
    ));
    return expected === null
      ? active.length === 0
      : active.length === 1 && active[0] === expected;
  }, expectedStarterId, { timeout: 4_000 });

  assert.deepEqual(
    await activeStarterIds(page),
    expectedStarterId ? [expectedStarterId] : [],
    `Expected only ${expectedStarterId ?? 'no starter'} to be active.`,
  );
}

async function assertNoStarterSelected(page) {
  assert.equal(
    await page.evaluate((key) => window.localStorage.getItem(key), labStorageKey),
    null,
    'Preview playback unexpectedly created a starter document.',
  );
  assert.equal(
    await page.getByRole('heading', { name: 'Choose your starting point' }).count(),
    1,
    'Preview playback unexpectedly left the chooser.',
  );
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    document: document.documentElement.scrollWidth
      - document.documentElement.clientWidth,
  }));
  assert.deepEqual(overflow, { body: 0, document: 0 });
}

async function scrollCardToMostVisible(page, starterId) {
  await card(page, starterId).evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    const absoluteTop = rectangle.top + window.scrollY;
    const centeredTop = absoluteTop - Math.max(
      16,
      (window.innerHeight - rectangle.height) / 2,
    );
    window.scrollTo({ behavior: 'instant', top: Math.max(0, centeredTop) });
  });
  await assertActiveStarter(page, starterId);
  await page.waitForTimeout(80);
}

async function pausePreviewAt(page, starterId, timeMs) {
  await assertActiveStarter(page, starterId);
  const animationNames = await preview(page, starterId).evaluate(
    (element, requestedTime) => {
      const animations = element
        .getAnimations({ subtree: true })
        .filter((animation) => animation instanceof CSSAnimation);
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = requestedTime;
      }
      return animations.map((animation) => animation.animationName);
    },
    timeMs,
  );
  assert.ok(
    animationNames.length > 0,
    `${starterId} had no CSS animation to position at ${timeMs}ms.`,
  );
  await page.evaluate(() => new Promise((resolveFrame) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolveFrame));
  }));
  await assertActiveStarter(page, starterId);
}

async function assertSceneInPreview(page, starterId, sceneId) {
  const visibleRatio = await preview(page, starterId).evaluate(
    (element, requestedScene) => {
      const viewportRectangle = element
        .querySelector('.final-starter-preview__viewport')
        ?.getBoundingClientRect();
      const sceneRectangle = element
        .querySelector(`[data-preview-scene="${requestedScene}"]`)
        ?.getBoundingClientRect();
      if (!viewportRectangle || !sceneRectangle) return 0;
      const overlap = Math.max(
        0,
        Math.min(viewportRectangle.bottom, sceneRectangle.bottom)
          - Math.max(viewportRectangle.top, sceneRectangle.top),
      );
      return overlap / sceneRectangle.height;
    },
    sceneId,
  );
  assert.ok(
    visibleRatio > 0.85,
    `${starterId}/${sceneId} was not held inside the miniature viewport.`,
  );
}

async function assertMultiPageScene(page, sceneId, activeNavigationIndex) {
  const state = await preview(page, 'multi_page').evaluate(
    (element, requestedScene) => ({
      activeOpacity: Number.parseFloat(getComputedStyle(
        element.querySelector(`[data-preview-scene="${requestedScene}"]`),
      ).opacity),
      navigationBackgrounds: [...element.querySelectorAll(
        '.final-starter-preview__nav > span',
      )].map((item) => getComputedStyle(item).backgroundColor),
      sceneOpacities: [...element.querySelectorAll('[data-preview-scene]')]
        .map((item) => ({
          id: item.getAttribute('data-preview-scene'),
          opacity: Number.parseFloat(getComputedStyle(item).opacity),
        })),
    }),
    sceneId,
  );

  assert.ok(state.activeOpacity > 0.95, `${sceneId} was not the visible page state.`);
  for (const scene of state.sceneOpacities) {
    if (scene.id !== sceneId) {
      assert.ok(scene.opacity < 0.05, `${scene.id} remained visible behind ${sceneId}.`);
    }
  }
  assert.notEqual(
    state.navigationBackgrounds[activeNavigationIndex],
    'rgba(0, 0, 0, 0)',
    `${sceneId} did not have a visible active navigation state.`,
  );
}

async function capturePage(page, relativePath, metadata) {
  await ensureOutputParent(relativePath);
  await page.screenshot({
    animations: 'allow',
    caret: 'hide',
    path: evidencePath(relativePath),
  });
  recordEvidence(relativePath, { kind: 'screenshot', ...metadata });
}

async function captureLocator(locator, relativePath, metadata) {
  await ensureOutputParent(relativePath);
  await locator.screenshot({
    animations: 'allow',
    caret: 'hide',
    path: evidencePath(relativePath),
  });
  recordEvidence(relativePath, { kind: 'timed-screenshot', ...metadata });
}

async function captureMobileScreenshots(browser) {
  await withPage(
    browser,
    'mobile-screenshots',
    { mobile: true, reducedMotion: false },
    async (page) => {
      await openFreshChooser(page, 'mobile-screenshots');
      await assertNoHorizontalOverflow(page);
      await assertActiveStarter(page, 'quick_book');

      await pausePreviewAt(page, 'quick_book', 500);
      await assertSceneInPreview(page, 'quick_book', 'intro');
      await capturePage(page, requiredScreenshots[0], {
        activeStarter: 'quick_book',
        moment: 'chooser top / Quick Book intro',
        reducedMotion: false,
        viewport: mobileViewport,
      });

      await pausePreviewAt(page, 'quick_book', 4_400);
      await assertSceneInPreview(page, 'quick_book', 'booking');
      await capturePage(page, requiredScreenshots[1], {
        activeStarter: 'quick_book',
        moment: 'booking final frame',
        reducedMotion: false,
        viewport: mobileViewport,
      });

      await scrollCardToMostVisible(page, 'one_page');
      await pausePreviewAt(page, 'one_page', 3_000);
      await capturePage(page, requiredScreenshots[2], {
        activeStarter: 'one_page',
        moment: 'continuous page journey',
        reducedMotion: false,
        viewport: mobileViewport,
      });

      await scrollCardToMostVisible(page, 'multi_page');
      await pausePreviewAt(page, 'multi_page', 700);
      await assertMultiPageScene(page, 'home', 0);
      await capturePage(page, requiredScreenshots[3], {
        activeStarter: 'multi_page',
        moment: 'Home page',
        reducedMotion: false,
        viewport: mobileViewport,
      });

      await pausePreviewAt(page, 'multi_page', 2_400);
      await assertMultiPageScene(page, 'services', 1);
      await capturePage(page, requiredScreenshots[4], {
        activeStarter: 'multi_page',
        moment: 'Services & Booking page',
        reducedMotion: false,
        viewport: mobileViewport,
      });

      await pausePreviewAt(page, 'multi_page', 4_300);
      await assertMultiPageScene(page, 'gallery', 2);
      await capturePage(page, requiredScreenshots[5], {
        activeStarter: 'multi_page',
        moment: 'Gallery final frame',
        reducedMotion: false,
        viewport: mobileViewport,
      });

      const reassurance = page.locator('.final-starter-reassurance');
      await reassurance.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      assert.equal(await reassurance.getByText('Nothing is permanent.').count(), 1);
      assert.equal(await reassurance.getByText(
        'Every starting point uses the same editor. Add, remove, or rearrange pages and sections anytime.',
      ).count(), 1);
      await capturePage(page, requiredScreenshots[13], {
        activeStarter: (await activeStarterIds(page))[0] ?? null,
        moment: 'bottom reassurance before Lab import controls',
        reducedMotion: false,
        viewport: mobileViewport,
      });

      await assertNoHorizontalOverflow(page);
      await assertNoStarterSelected(page);
    },
  );
}

async function captureSequence(page, starterId, frames, viewport) {
  for (const frame of frames) {
    await pausePreviewAt(page, starterId, frame.timeMs);
    if (frame.scene && starterId === 'multi_page') {
      await assertMultiPageScene(page, frame.scene, frame.navigationIndex);
    } else if (frame.scene && starterId === 'quick_book') {
      await assertSceneInPreview(page, starterId, frame.scene);
    }
    await captureLocator(
      preview(page, starterId),
      `sequences/${starterId}/${frame.file}`,
      {
        activeStarter: starterId,
        moment: frame.label,
        reducedMotion: false,
        timeMs: frame.timeMs,
        viewport,
      },
    );
  }
}

async function captureDesktopScreenshotsAndSequences(browser) {
  await withPage(
    browser,
    'desktop-screenshots-and-sequences',
    { mobile: false, reducedMotion: false },
    async (page) => {
      await openFreshChooser(page, 'desktop-screenshots-and-sequences');
      await assertNoHorizontalOverflow(page);
      await page.getByRole('heading', { name: 'Choose your starting point' }).hover();
      await page.waitForTimeout(resetDelayMs);
      await assertActiveStarter(page, null);
      await capturePage(page, requiredScreenshots[6], {
        activeStarter: null,
        moment: 'strong static poster frames at idle',
        reducedMotion: false,
        viewport: desktopViewport,
      });

      await card(page, 'quick_book').hover();
      await assertActiveStarter(page, 'quick_book');
      await pausePreviewAt(page, 'quick_book', 2_300);
      await assertSceneInPreview(page, 'quick_book', 'services');
      await capturePage(page, requiredScreenshots[7], {
        activeStarter: 'quick_book',
        moment: 'desktop hover / services',
        reducedMotion: false,
        viewport: desktopViewport,
      });
      await captureSequence(page, 'quick_book', [
        { file: '01-intro-0500ms.png', label: 'Intro', scene: 'intro', timeMs: 500 },
        { file: '02-services-2300ms.png', label: 'Services', scene: 'services', timeMs: 2_300 },
        { file: '03-booking-4400ms.png', label: 'Booking final frame', scene: 'booking', timeMs: 4_400 },
      ], desktopViewport);

      await card(page, 'one_page').hover();
      await assertActiveStarter(page, 'one_page');
      await pausePreviewAt(page, 'one_page', 3_000);
      await capturePage(page, requiredScreenshots[8], {
        activeStarter: 'one_page',
        moment: 'desktop hover / continuous scroll',
        reducedMotion: false,
        viewport: desktopViewport,
      });
      await captureSequence(page, 'one_page', [
        { file: '01-welcome-0400ms.png', label: 'Welcome', timeMs: 400 },
        { file: '02-about-1500ms.png', label: 'About', timeMs: 1_500 },
        { file: '03-services-2400ms.png', label: 'Services', timeMs: 2_400 },
        { file: '04-gallery-3300ms.png', label: 'Gallery', timeMs: 3_300 },
        { file: '05-reviews-4200ms.png', label: 'Reviews', timeMs: 4_200 },
        { file: '06-booking-5400ms.png', label: 'Booking final frame', timeMs: 5_400 },
      ], desktopViewport);

      await card(page, 'multi_page').hover();
      await assertActiveStarter(page, 'multi_page');
      await pausePreviewAt(page, 'multi_page', 2_400);
      await assertMultiPageScene(page, 'services', 1);
      await capturePage(page, requiredScreenshots[9], {
        activeStarter: 'multi_page',
        moment: 'desktop hover / separate Services & Booking page',
        reducedMotion: false,
        viewport: desktopViewport,
      });
      await captureSequence(page, 'multi_page', [
        {
          file: '01-home-0700ms.png',
          label: 'Home page and Home navigation state',
          navigationIndex: 0,
          scene: 'home',
          timeMs: 700,
        },
        {
          file: '02-services-2400ms.png',
          label: 'Services & Booking page and Services navigation state',
          navigationIndex: 1,
          scene: 'services',
          timeMs: 2_400,
        },
        {
          file: '03-gallery-4300ms.png',
          label: 'Gallery page and Gallery navigation state',
          navigationIndex: 2,
          scene: 'gallery',
          timeMs: 4_300,
        },
      ], desktopViewport);

      await page.getByRole('heading', { name: 'Choose your starting point' }).hover();
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      });
      await page.waitForTimeout(resetDelayMs);
      await assertActiveStarter(page, null);
      await page.keyboard.press('Tab');
      assert.equal(
        await page.getByRole('link', { name: 'Luster' }).evaluate((element) => (
          element === document.activeElement
        )),
        true,
        'The first keyboard stop was not the Luster skip/brand link.',
      );
      await page.keyboard.press('Tab');
      assert.equal(
        await card(page, 'quick_book').evaluate((element) => ({
          focusVisible: element.matches(':focus-visible'),
          focused: element === document.activeElement,
        })).then(({ focusVisible, focused }) => focusVisible && focused),
        true,
        'Quick Book did not retain visible keyboard focus.',
      );
      await assertActiveStarter(page, 'quick_book');
      await pausePreviewAt(page, 'quick_book', 500);
      await capturePage(page, requiredScreenshots[10], {
        activeStarter: 'quick_book',
        moment: 'keyboard focus-visible playback',
        reducedMotion: false,
        viewport: desktopViewport,
      });

      await assertNoStarterSelected(page);
    },
  );
}

async function assertReducedMotionPosters(page) {
  await assertActiveStarter(page, null);
  for (const starterId of Object.keys(starters)) {
    const state = await preview(page, starterId).evaluate((element) => ({
      animationName: getComputedStyle(
        element.querySelector('.final-starter-preview__track'),
      ).animationName,
      motionOpacity: getComputedStyle(
        element.querySelector('.final-starter-preview__motion'),
      ).opacity,
      posterOpacity: getComputedStyle(
        element.querySelector('.final-starter-preview__poster'),
      ).opacity,
      previewState: element.getAttribute('data-preview-state'),
      runningAnimations: element
        .getAnimations({ subtree: true })
        .filter((animation) => animation.playState === 'running').length,
    }));
    assert.deepEqual(state, {
      animationName: 'none',
      motionOpacity: '0',
      posterOpacity: '1',
      previewState: 'poster',
      runningAnimations: 0,
    });
  }
}

async function captureReducedMotionScreenshots(browser) {
  await withPage(
    browser,
    'reduced-motion-mobile',
    { mobile: true, reducedMotion: true },
    async (page) => {
      await openFreshChooser(page, 'reduced-motion-mobile');
      await scrollCardToMostVisibleWithoutMotion(page, 'one_page');
      await assertReducedMotionPosters(page);
      await capturePage(page, requiredScreenshots[11], {
        activeStarter: null,
        moment: 'static One-page poster',
        reducedMotion: true,
        viewport: mobileViewport,
      });
      await assertNoHorizontalOverflow(page);
      await assertNoStarterSelected(page);
    },
  );

  await withPage(
    browser,
    'reduced-motion-desktop',
    { mobile: false, reducedMotion: true },
    async (page) => {
      await openFreshChooser(page, 'reduced-motion-desktop');
      await card(page, 'multi_page').hover();
      await card(page, 'multi_page').focus();
      await page.waitForTimeout(180);
      await assertReducedMotionPosters(page);
      await capturePage(page, requiredScreenshots[12], {
        activeStarter: null,
        moment: 'all three strong static posters after hover and focus',
        reducedMotion: true,
        viewport: desktopViewport,
      });
      await assertNoHorizontalOverflow(page);
      await assertNoStarterSelected(page);
    },
  );
}

async function scrollCardToMostVisibleWithoutMotion(page, starterId) {
  await card(page, starterId).evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    const absoluteTop = rectangle.top + window.scrollY;
    window.scrollTo({
      behavior: 'instant',
      top: Math.max(0, absoluteTop - (window.innerHeight - rectangle.height) / 2),
    });
  });
  await page.waitForTimeout(180);
}

async function previewCenter(page, starterId) {
  const box = await preview(page, starterId).boundingBox();
  assert.ok(box, `${starterId} preview had no visible geometry.`);
  return {
    x: box.x + box.width / 2,
    y: Math.min(mobileViewport.height - 60, box.y + box.height / 2),
  };
}

async function dispatchTouch(session, type, point) {
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: point
      ? [{ force: 1, id: 1, radiusX: 2, radiusY: 2, x: point.x, y: point.y }]
      : [],
    type,
  });
}

async function trustedVerticalGesture(page, session, start, distance) {
  const steps = 12;
  await dispatchTouch(session, 'touchStart', start);
  for (let step = 1; step <= steps; step += 1) {
    await dispatchTouch(session, 'touchMove', {
      x: start.x,
      y: start.y - (distance * step) / steps,
    });
    await page.waitForTimeout(18);
  }
  await dispatchTouch(session, 'touchEnd');
}

async function waitForScrollSettled(page) {
  let previous = await page.evaluate(() => window.scrollY);
  let stableSamples = 0;
  for (let sample = 0; sample < 30; sample += 1) {
    await page.waitForTimeout(100);
    const current = await page.evaluate(() => window.scrollY);
    stableSamples = current === previous ? stableSamples + 1 : 0;
    if (stableSamples >= 5) return current;
    previous = current;
  }
  throw new Error('Trusted touch scrolling did not settle before preview playback.');
}

async function recordJourneyVideo(browser, {
  action,
  activeStarter,
  file,
  mobile,
  phase,
  viewport,
}) {
  const scratchDirectory = await mkdtemp(join(
    tmpdir(),
    'luster-starter-motion-video-',
  ));
  const context = await browser.newContext(contextOptions({
    mobile,
    reducedMotion: false,
    videoDirectory: scratchDirectory,
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
    assert.ok(video, `${phase}: Playwright did not create a video recorder.`);
    await ensureOutputParent(file);
    await video.saveAs(evidencePath(file));
    recordEvidence(file, {
      activeStarter,
      kind: 'video',
      moment: phase,
      reducedMotion: false,
      viewport,
    });
  } finally {
    await rm(scratchDirectory, { force: true, recursive: true });
  }

  if (actionError) throw actionError;
}

async function captureJourneyVideos(browser) {
  await recordJourneyVideo(browser, {
    action: async (page, context) => {
      await openFreshChooser(page, 'mobile-visibility-video');
      await assertActiveStarter(page, 'quick_book');
      let scrollPosition = await page.evaluate(() => window.scrollY);
      await page.waitForTimeout(5_000);
      assert.equal(await page.evaluate(() => window.scrollY), scrollPosition);

      const session = await context.newCDPSession(page);
      await trustedVerticalGesture(
        page,
        session,
        await previewCenter(page, 'quick_book'),
        430,
      );
      await assertActiveStarter(page, 'one_page');
      scrollPosition = await waitForScrollSettled(page);
      await page.waitForTimeout(6_000);
      assert.equal(await page.evaluate(() => window.scrollY), scrollPosition);

      await trustedVerticalGesture(
        page,
        session,
        await previewCenter(page, 'one_page'),
        430,
      );
      await assertActiveStarter(page, 'multi_page');
      scrollPosition = await waitForScrollSettled(page);
      await page.waitForTimeout(5_800);
      assert.equal(await page.evaluate(() => window.scrollY), scrollPosition);
      await assertNoStarterSelected(page);
    },
    activeStarter: 'quick_book → one_page → multi_page',
    file: 'journeys/mobile-visibility-390x844.webm',
    mobile: true,
    phase: 'mobile visibility journey with trusted touch scrolling',
    viewport: mobileViewport,
  });

  await recordJourneyVideo(browser, {
    action: async (page) => {
      await openFreshChooser(page, 'desktop-hover-video');
      await assertActiveStarter(page, null);
      await card(page, 'quick_book').hover();
      await assertActiveStarter(page, 'quick_book');
      await page.waitForTimeout(5_000);

      await card(page, 'one_page').hover();
      await assertActiveStarter(page, 'one_page');
      await page.waitForTimeout(6_000);

      await card(page, 'multi_page').hover();
      await assertActiveStarter(page, 'multi_page');
      await page.waitForTimeout(5_800);

      await page.getByRole('heading', { name: 'Choose your starting point' }).hover();
      await page.waitForTimeout(resetDelayMs);
      await assertActiveStarter(page, null);
      await assertNoStarterSelected(page);
    },
    activeStarter: 'quick_book → one_page → multi_page',
    file: 'journeys/desktop-hover-1440x900.webm',
    mobile: false,
    phase: 'desktop hover journey',
    viewport: desktopViewport,
  });
}

const expectedDefaultBookingPresentation = {
  bodyScale: 'standard',
  headingScale: 'standard',
  layout: 'visual_grid',
  layoutMemory: {
    category_menu: {
      density: 'comfortable',
      desktopNavigation: 'sidebar',
      mobileNavigation: 'tabs',
      showCategoryCounts: true,
      showDescriptions: true,
    },
    clean_list: {
      categoryNavigation: 'pills',
      density: 'compact',
      showDescriptions: true,
      showThumbnails: false,
    },
    editorial_cards: {
      density: 'comfortable',
      descriptionLength: 'full',
      featuredTreatment: 'large',
      imageShape: 'landscape',
    },
    editorial_price_list: {
      density: 'spacious',
      descriptionLength: 'full',
      dividerStyle: 'fine',
      showCategoryImages: false,
    },
    visual_grid: {
      categoryNavigation: 'pills',
      density: 'comfortable',
      imageMode: 'auto',
      showDescriptions: false,
      showFeatured: true,
    },
  },
  layoutSettings: {
    categoryNavigation: 'pills',
    density: 'comfortable',
    imageMode: 'auto',
    showDescriptions: false,
    showFeatured: true,
  },
  spacing: 'comfortable',
  typographyPreset: 'modern',
  version: 1,
};

async function captureFreshQuickBookStructure(browser) {
  await withPage(
    browser,
    'fresh-quick-book-structure',
    { mobile: false, reducedMotion: false },
    async (page) => {
      await openFreshChooser(page, 'fresh-quick-book-structure');
      await card(page, 'quick_book').click();
      await page.getByTestId('final-hybrid-editor').waitFor({ state: 'visible' });
      await page.waitForFunction((key) => window.localStorage.getItem(key) !== null, labStorageKey);
      const storedDocument = await page.evaluate((key) => JSON.parse(
        window.localStorage.getItem(key),
      ), labStorageKey);

      assert.equal(storedDocument.originStarter, 'quick_book');
      assert.equal(storedDocument.pages.length, 1);
      const home = storedDocument.pages[0];
      assert.deepEqual({
        isHome: home.isHome,
        name: home.name,
        order: home.order,
        slug: home.slug,
        visible: home.visible,
        visibleInNavigation: home.visibleInNavigation,
      }, {
        isHome: true,
        name: 'Home',
        order: 0,
        slug: '',
        visible: true,
        visibleInNavigation: true,
      });
      assert.deepEqual(home.sections.map((section) => ({
        label: section.label,
        order: section.order,
        sectionType: section.sectionType,
      })), [
        { label: 'Section 01', order: 0, sectionType: 'section_01' },
        { label: 'Section 02', order: 1, sectionType: 'section_02' },
        { label: 'Booking', order: 2, sectionType: 'booking' },
      ]);
      assert.equal(home.sections[0].size, 'compact');
      assert.equal(home.sections[1].size, 'medium');
      const booking = home.sections[2];
      assert.deepEqual(booking.settings, expectedDefaultBookingPresentation);
      assert.equal(storedDocument.navigation.enabled, false);
      assert.equal(storedDocument.navigation.items.length, 1);
      assert.equal(storedDocument.navigation.items[0].pageId, home.id);
      assert.equal(storedDocument.navigation.items[0].label, 'Home');
      assert.equal(storedDocument.navigation.items[0].order, 0);
      assert.deepEqual(storedDocument.removedPages, []);
      assert.deepEqual(storedDocument.unusedSections, []);
      assert.deepEqual(await page.evaluate(() => Object.keys(window.localStorage)), [
        labStorageKey,
      ]);

      await writeJson('quick-book-structure.json', {
        document: storedDocument,
        verification: {
          bookingPresentation: expectedDefaultBookingPresentation,
          navigationEnabled: false,
          pageCount: 1,
          pageName: 'Home',
          sectionCount: 3,
          sectionOrder: ['Section 01', 'Section 02', 'Booking'],
          starter: 'quick_book',
        },
      });
      recordEvidence('quick-book-structure.json', {
        kind: 'structure-json',
        moment: 'separate fresh Quick Book context',
      });
    },
  );
}

async function captureFinalCleanChooser(browser) {
  await withPage(
    browser,
    'final-clean-chooser',
    { mobile: false, reducedMotion: false },
    async (page) => {
      await openFreshChooser(page, 'final-clean-chooser');
      await page.getByRole('heading', { name: 'Choose your starting point' }).hover();
      await page.waitForTimeout(resetDelayMs);
      await assertActiveStarter(page, null);
      const state = await page.evaluate((key) => {
        const styles = (element) => ({
          overflow: element.style.overflow,
          paddingRight: element.style.paddingRight,
          pointerEvents: element.style.pointerEvents,
          position: element.style.position,
          top: element.style.top,
        });
        const quickPreview = document.querySelector(
          '[data-testid="starter-preview-quick_book"]',
        );
        return {
          activeStarterIds: [...document.querySelectorAll(
            '.final-starter-preview[data-preview-active="true"]',
          )].map((element) => (
            element.closest('[data-starter-id]')?.getAttribute('data-starter-id')
          )),
          bodyStyles: styles(document.body),
          documentStorageValue: window.localStorage.getItem(key),
          htmlStyles: styles(document.documentElement),
          localStorageKeys: Object.keys(window.localStorage),
          modalCount: document.querySelectorAll('[role="dialog"]').length,
          quickBook: {
            active: quickPreview?.getAttribute('data-preview-active'),
            animationName: getComputedStyle(
              quickPreview?.querySelector('.final-starter-preview__track'),
            ).animationName,
            motionOpacity: getComputedStyle(
              quickPreview?.querySelector('.final-starter-preview__motion'),
            ).opacity,
            posterOpacity: getComputedStyle(
              quickPreview?.querySelector('.final-starter-preview__poster'),
            ).opacity,
            previewState: quickPreview?.getAttribute('data-preview-state'),
            runningAnimations: quickPreview
              ?.getAnimations({ subtree: true })
              .filter((animation) => animation.playState === 'running').length,
          },
          sessionStorageKeys: Object.keys(window.sessionStorage),
          toastCount: [...document.querySelectorAll('.toast')]
            .filter((element) => {
              const rectangle = element.getBoundingClientRect();
              return rectangle.width > 0 && rectangle.height > 0;
            }).length,
          url: window.location.href,
        };
      }, labStorageKey);

      assert.deepEqual(state.activeStarterIds, []);
      assert.deepEqual(state.localStorageKeys, []);
      assert.deepEqual(state.sessionStorageKeys, []);
      assert.equal(state.documentStorageValue, null);
      assert.equal(state.modalCount, 0);
      assert.equal(state.toastCount, 0);
      assert.deepEqual(state.bodyStyles, {
        overflow: '',
        paddingRight: '',
        pointerEvents: '',
        position: '',
        top: '',
      });
      assert.deepEqual(state.htmlStyles, {
        overflow: '',
        paddingRight: '',
        pointerEvents: '',
        position: '',
        top: '',
      });
      assert.deepEqual(state.quickBook, {
        active: 'false',
        animationName: 'none',
        motionOpacity: '0',
        posterOpacity: '1',
        previewState: 'poster',
        runningAnimations: 0,
      });
      assert.equal(new URL(state.url).origin, new URL(baseUrl).origin);

      await capturePage(page, '15-final-clean-chooser-state.png', {
        activeStarter: null,
        moment: 'final fresh-storage chooser with Quick Book poster idle',
        reducedMotion: false,
        viewport: desktopViewport,
      });
      await writeJson('final-clean-chooser-state.json', state);
      recordEvidence('final-clean-chooser-state.json', {
        kind: 'state-json',
        moment: 'final fresh-storage chooser assertions',
      });
    },
  );
}

function runtimeReport(scriptError) {
  const consoleErrors = runtimeIssues.filter(({ type }) => type === 'console.error');
  const consoleWarnings = runtimeIssues.filter(({ type }) => type === 'console.warning');
  const pageExceptions = runtimeIssues.filter(({ type }) => type === 'pageerror');
  const failedRequests = runtimeIssues.filter(({ type }) => type === 'requestfailed');
  const httpErrors = runtimeIssues.filter(({ type }) => type === 'http-error');
  const reactWarnings = runtimeIssues.filter(({ message = '', type }) => (
    (type === 'console.error' || type === 'console.warning')
      && /(?:react|warning:|validateDOMNesting|hydration)/i.test(message)
  ));
  return {
    consoleErrors,
    consoleWarnings,
    failedRequests,
    httpChecks,
    httpErrors,
    issues: runtimeIssues,
    pageExceptions,
    passed: runtimeIssues.length === 0 && scriptError === null,
    reactWarnings,
    scriptError,
  };
}

async function writeManifest(status, scriptError) {
  const generatedFiles = evidenceEntries.map(({ file }) => file);
  const missingRequiredScreenshots = requiredScreenshots.filter(
    (file) => !generatedFiles.includes(file),
  );
  await writeJson('manifest.json', {
    baseUrl,
    evidence: evidenceEntries,
    missingRequiredScreenshots,
    requiredScreenshots,
    scriptError,
    status,
  });
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let caughtError = null;

  try {
    await captureMobileScreenshots(browser);
    await captureDesktopScreenshotsAndSequences(browser);
    await captureReducedMotionScreenshots(browser);
    await captureJourneyVideos(browser);
    await captureFreshQuickBookStructure(browser);
    await captureFinalCleanChooser(browser);

    assert.deepEqual(runtimeIssues, [], 'Browser runtime issues were captured.');
    const generatedFiles = evidenceEntries.map(({ file }) => file);
    assert.deepEqual(
      requiredScreenshots.filter((file) => !generatedFiles.includes(file)),
      [],
      'One or more required screenshots were not captured.',
    );
  } catch (error) {
    caughtError = error instanceof Error
      ? { message: error.message, name: error.name, stack: error.stack }
      : { message: String(error), name: 'UnknownError' };
  } finally {
    await browser.close();
    await writeJson('runtime-issues.json', runtimeReport(caughtError));
    recordEvidence('runtime-issues.json', {
      kind: 'runtime-json',
      moment: 'console, request, response, page exception, and React warning monitor',
    });
    await writeManifest(caughtError ? 'failed' : 'passed', caughtError);
  }

  if (caughtError) {
    throw new Error(
      `Starter chooser motion evidence capture failed: ${caughtError.message}`,
      { cause: caughtError },
    );
  }
}

await main();
