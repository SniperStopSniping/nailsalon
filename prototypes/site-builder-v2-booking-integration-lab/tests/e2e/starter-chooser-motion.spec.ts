import {
  devices,
  expect,
  test,
  type CDPSession,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  LAB_STORAGE_KEY,
  openFreshLab,
  readStoredDocument,
  startRuntimeMonitor,
} from './helpers';

const STARTERS = [
  {
    cta: 'Start with Quick Book',
    description: 'Start taking bookings with only the essentials.',
    id: 'quick_book',
    included: 'Salon intro · Services · Booking',
    label: 'Includes',
    name: 'Quick Book',
  },
  {
    cta: 'Start with One-page',
    description: 'Show your whole business on one scrolling page.',
    id: 'one_page',
    included: 'Welcome · About · Services · Gallery · Reviews · Booking',
    label: 'Includes',
    name: 'One-page website',
  },
  {
    cta: 'Start with Multi-page',
    description: 'Give each part of your business its own page and navigation link.',
    id: 'multi_page',
    included: 'Home · Services & Booking · Gallery · About · Contact',
    label: 'Includes pages',
    name: 'Multi-page website',
  },
] as const;

const REQUIRED_VIEWPORTS = [
  { height: 600, width: 320 },
  { height: 600, width: 375 },
  { height: 844, width: 390 },
  { height: 932, width: 430 },
  { height: 1024, width: 768 },
  { height: 800, width: 920 },
  { height: 800, width: 1180 },
  { height: 900, width: 1440 },
] as const;

type Point = { x: number; y: number };

function card(page: Page, name: string): Locator {
  return page.getByRole('button', { name: new RegExp(`^${name}`) });
}

function preview(page: Page, starterId: string): Locator {
  return page.getByTestId(`starter-preview-${starterId}`);
}

async function expectOnlyActive(page: Page, starterId: string | null): Promise<void> {
  await expect.poll(async () => page.locator('.final-starter-preview[data-preview-active="true"]')
    .evaluateAll((elements) => elements.map((element) => (
      element.closest<HTMLElement>('[data-starter-id]')?.dataset.starterId
    )))).toEqual(starterId ? [starterId] : []);
}

async function sendTouch(
  session: CDPSession,
  type: 'touchEnd' | 'touchMove' | 'touchStart',
  point?: Point,
): Promise<void> {
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: point
      ? [{ force: 1, id: 1, radiusX: 2, radiusY: 2, x: point.x, y: point.y }]
      : [],
    type,
  });
}

async function trustedVerticalGesture(
  page: Page,
  session: CDPSession,
  start: Point,
  distance: number,
): Promise<void> {
  const steps = 10;
  await sendTouch(session, 'touchStart', start);
  for (let step = 1; step <= steps; step += 1) {
    await sendTouch(session, 'touchMove', {
      x: start.x,
      y: start.y - (distance * step) / steps,
    });
    await page.waitForTimeout(16);
  }
  await sendTouch(session, 'touchEnd');
}

async function previewCenter(page: Page, starterId: string): Promise<Point> {
  const box = await preview(page, starterId).boundingBox();
  expect(box, `${starterId} preview has geometry`).not.toBeNull();
  if (!box) throw new Error(`${starterId} preview has no geometry.`);
  return {
    x: box.x + box.width / 2,
    y: Math.min(page.viewportSize()?.height ? page.viewportSize()!.height - 60 : box.y, box.y + box.height / 2),
  };
}

async function setPreviewTimeline(page: Page, starterId: string, timeMs: number): Promise<void> {
  await preview(page, starterId).evaluate((element, timelineTime) => {
    for (const animation of element.getAnimations({ subtree: true })) {
      if (!(animation instanceof CSSAnimation)) continue;
      animation.pause();
      animation.currentTime = timelineTime;
    }
  }, timeMs);
}

test('desktop copy, semantics, exclusive playback, cleanup, and activation stay coherent', async ({ page }) => {
  const runtime = startRuntimeMonitor(page);
  await page.setViewportSize({ height: 900, width: 1440 });
  await openFreshLab(page);

  await expect(page.getByText(
    'Start simple or with a full website. You can add or change pages and sections anytime.',
  )).toBeVisible();
  await expect(page.getByText('Nothing is permanent.')).toBeVisible();
  await expect(page.getByText(
    'Every starting point uses the same editor. Add, remove, or rearrange pages and sections anytime.',
  )).toBeVisible();
  await expect(page.getByText('Site Builder Lab')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import JSON' })).toBeVisible();
  await expect(page.getByText('Mock data only · Saved in this browser · Not connected to Production'))
    .toBeVisible();
  expect(await page.locator('.final-starter-reassurance').evaluate((element) => Boolean(
    element.compareDocumentPosition(document.querySelector('.final-starter-import')!)
      & Node.DOCUMENT_POSITION_FOLLOWING,
  ))).toBe(true);
  await expect(page.getByText(/Starts with [356] (?:sections|pages)/)).toHaveCount(0);
  expect(await page.locator('[data-starter-id]').evaluateAll((elements) => (
    elements.map((element) => (element as HTMLElement).dataset.starterId)
  ))).toEqual([
    'quick_book',
    'one_page',
    'multi_page',
  ]);

  for (const starter of STARTERS) {
    const starterCard = card(page, starter.name);
    await expect(starterCard).toHaveAccessibleName(
      `${starter.name} ${starter.description} ${starter.label} ${starter.included} ${starter.cta}`,
    );
    await expect(starterCard.getByText(starter.description)).toBeVisible();
    await expect(starterCard.getByText(starter.included)).toBeVisible();
    await expect(starterCard.getByText(starter.cta)).toBeVisible();
    await expect(preview(page, starter.id)).toHaveAttribute('aria-hidden', 'true');
    await expect(starterCard.locator('button, a, input, select, textarea, [tabindex]')).toHaveCount(0);
    expect(await preview(page, starter.id).evaluate((element) => getComputedStyle(element).pointerEvents))
      .toBe('none');
  }

  await page.waitForTimeout(350);
  await expectOnlyActive(page, null);
  for (const starter of STARTERS) {
    expect(await preview(page, starter.id).locator('.final-starter-preview__track')
      .evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  }

  await card(page, 'Quick Book').hover();
  await expectOnlyActive(page, 'quick_book');
  const quickAnimation = await preview(page, 'quick_book')
    .locator('.final-starter-preview__track')
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        duration: style.animationDuration,
        fillMode: style.animationFillMode,
        iterationCount: style.animationIterationCount,
        name: style.animationName,
      };
    });
  expect(quickAnimation).toEqual({
    duration: '4.8s',
    fillMode: 'both',
    iterationCount: '1',
    name: 'final-starter-quick-scroll',
  });
  const quickTransforms: string[] = [];
  for (const timeMs of [500, 2_300, 4_400]) {
    await setPreviewTimeline(page, 'quick_book', timeMs);
    quickTransforms.push(await preview(page, 'quick_book')
      .locator('.final-starter-preview__track')
      .evaluate((element) => getComputedStyle(element).transform));
  }
  expect(new Set(quickTransforms).size).toBe(3);
  const quickFinal = await preview(page, 'quick_book')
    .locator('.final-starter-preview__track')
    .evaluate((element) => {
      const animation = element.getAnimations()[0];
      animation?.finish();
      return {
        playState: animation?.playState,
        transform: getComputedStyle(element).transform,
      };
    });
  expect(quickFinal.playState).toBe('finished');
  expect(quickFinal.transform).not.toBe('none');
  expect(await preview(page, 'quick_book').evaluate((element) => {
    const viewportRect = element.querySelector('.final-starter-preview__viewport')!.getBoundingClientRect();
    const bookingRect = element.querySelector('[data-preview-scene="booking"]')!.getBoundingClientRect();
    return bookingRect.top >= viewportRect.top - 1 && bookingRect.bottom <= viewportRect.bottom + 1;
  })).toBe(true);

  await card(page, 'One-page website').hover();
  await expectOnlyActive(page, 'one_page');
  const onePageTrack = preview(page, 'one_page').locator('.final-starter-preview__track');
  expect(await onePageTrack.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.animationName, style.animationDuration, style.animationIterationCount, style.animationFillMode];
  })).toEqual(['final-starter-one-page-scroll', '5.8s', '1', 'both']);
  const onePageTransforms: string[] = [];
  for (const timeMs of [500, 2_900, 5_300]) {
    await setPreviewTimeline(page, 'one_page', timeMs);
    onePageTransforms.push(await onePageTrack.evaluate((element) => getComputedStyle(element).transform));
  }
  expect(new Set(onePageTransforms).size).toBe(3);
  await onePageTrack.evaluate((element) => element.getAnimations()[0]?.finish());
  expect(await preview(page, 'one_page').evaluate((element) => {
    const viewportRect = element.querySelector('.final-starter-preview__viewport')!.getBoundingClientRect();
    const bookingRect = element.querySelector('[data-preview-scene="booking"]')!.getBoundingClientRect();
    return bookingRect.top < viewportRect.bottom && bookingRect.bottom <= viewportRect.bottom + 1;
  })).toBe(true);

  await card(page, 'Multi-page website').hover();
  await expectOnlyActive(page, 'multi_page');
  const multiPageScene = preview(page, 'multi_page').locator('[data-preview-scene]').first();
  expect(await multiPageScene.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.animationDuration, style.animationIterationCount, style.animationFillMode];
  })).toEqual(['5.6s', '1', 'both']);
  const multiStates = [];
  for (const timeMs of [700, 2_400, 4_300]) {
    await setPreviewTimeline(page, 'multi_page', timeMs);
    multiStates.push(await preview(page, 'multi_page').evaluate((element) => ({
      gallery: getComputedStyle(element.querySelector('[data-preview-scene="gallery"]')!).opacity,
      home: getComputedStyle(element.querySelector('[data-preview-scene="home"]')!).opacity,
      nav: [...element.querySelectorAll('.final-starter-preview__nav > span')]
        .map((item) => getComputedStyle(item).backgroundColor),
      services: getComputedStyle(element.querySelector('[data-preview-scene="services"]')!).opacity,
    })));
  }
  expect(multiStates.map(({ gallery, home, services }) => [home, services, gallery]))
    .toEqual([['1', '0', '0'], ['0', '1', '0'], ['0', '0', '1']]);
  expect(multiStates[0]?.nav[0]).not.toBe('rgba(0, 0, 0, 0)');
  expect(multiStates[1]?.nav[1]).not.toBe('rgba(0, 0, 0, 0)');
  expect(multiStates[2]?.nav[2]).not.toBe('rgba(0, 0, 0, 0)');
  const galleryPage = preview(page, 'multi_page').locator('[data-preview-scene="gallery"]');
  await preview(page, 'multi_page').evaluate((element) => {
    for (const animation of element.getAnimations({ subtree: true })) animation.finish();
  });
  await expect.poll(() => galleryPage.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');

  await page.getByRole('heading', { name: 'Choose your starting point' }).hover();
  await page.waitForTimeout(220);
  await expectOnlyActive(page, null);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Luster' })).toBeFocused();
  await page.keyboard.press('Tab');
  const quickBook = card(page, 'Quick Book');
  await expect(quickBook).toBeFocused();
  await expectOnlyActive(page, 'quick_book');
  expect(await quickBook.evaluate((element) => ({
    focusVisible: element.matches(':focus-visible'),
    outlineStyle: getComputedStyle(element).outlineStyle,
    outlineWidth: getComputedStyle(element).outlineWidth,
  }))).toEqual({ focusVisible: true, outlineStyle: 'solid', outlineWidth: '3px' });

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(preview(page, 'quick_book')).toHaveAttribute('data-preview-state', 'paused');
  expect(await preview(page, 'quick_book').locator('.final-starter-preview__track')
    .evaluate((element) => getComputedStyle(element).animationPlayState)).toBe('paused');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(preview(page, 'quick_book')).toHaveAttribute('data-preview-state', 'playing');

  expect(await page.evaluate((key) => window.localStorage.getItem(key), LAB_STORAGE_KEY)).toBeNull();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('final-hybrid-editor')).toBeVisible();
  await expect.poll(() => page.evaluate(
    (key) => window.localStorage.getItem(key) !== null,
    LAB_STORAGE_KEY,
  )).toBe(true);
  expect((await readStoredDocument(page)).pages[0]?.sections).toHaveLength(3);
  runtime.assertClean();
  runtime.stop();
});

test('every required chooser viewport avoids horizontal overflow and clipped decision copy', async ({ page }) => {
  const runtime = startRuntimeMonitor(page);
  for (const viewport of REQUIRED_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await openFreshLab(page);
    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth - document.body.clientWidth,
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow, `${viewport.width}×${viewport.height} has no horizontal overflow`)
      .toEqual({ body: 0, document: 0 });

    for (const starter of STARTERS) {
      const starterCard = card(page, starter.name);
      const included = starterCard.getByText(starter.included);
      const [cardBox, includedBox] = await Promise.all([
        starterCard.boundingBox(),
        included.boundingBox(),
      ]);
      expect(cardBox).not.toBeNull();
      expect(includedBox).not.toBeNull();
      if (cardBox && includedBox) {
        expect(includedBox.x).toBeGreaterThanOrEqual(cardBox.x);
        expect(includedBox.x + includedBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
      }
      const finalToken = starter.id === 'multi_page' ? 'Contact' : 'Booking';
      expect(await included.evaluate((element, token) => {
        const range = document.createRange();
        const textNode = element.firstChild;
        if (!textNode) return { finalTokenInside: false };
        const start = textNode.textContent?.lastIndexOf(token) ?? -1;
        if (start < 0) return { finalTokenInside: false };
        range.setStart(textNode, start);
        range.setEnd(textNode, start + token.length);
        const tokenRect = range.getBoundingClientRect();
        const includedRect = element.getBoundingClientRect();
        const parentCardRect = element.closest('[data-starter-id]')!.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          finalTokenInside: tokenRect.right <= includedRect.right + 1
            && tokenRect.bottom <= includedRect.bottom + 1
            && tokenRect.right <= parentCardRect.right + 1
            && tokenRect.bottom <= parentCardRect.bottom + 1,
          heightFits: element.scrollHeight <= element.clientHeight,
          overflowWrap: style.overflowWrap,
          widthFits: element.scrollWidth <= element.clientWidth,
          wordBreak: style.wordBreak,
        };
      }, finalToken)).toEqual({
        finalTokenInside: true,
        heightFits: true,
        overflowWrap: 'normal',
        widthFits: true,
        wordBreak: 'normal',
      });
    }
  }
  runtime.assertClean();
  runtime.stop();
});

test('desktop reduced motion keeps strong posters static and cards selectable', async ({ page }) => {
  const runtime = startRuntimeMonitor(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ height: 900, width: 1440 });
  await openFreshLab(page);

  await card(page, 'Quick Book').hover();
  await card(page, 'One-page website').focus();
  await expectOnlyActive(page, null);
  for (const starter of STARTERS) {
    const starterPreview = preview(page, starter.id);
    await expect(starterPreview).toHaveAttribute('data-preview-state', 'poster');
    expect(await starterPreview.locator('.final-starter-preview__poster')
      .evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
    expect(await starterPreview.locator('.final-starter-preview__motion')
      .evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
    expect(await starterPreview.locator('.final-starter-preview__track')
      .evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  }

  await card(page, 'Multi-page website').click();
  await expect(page.getByTestId('final-hybrid-editor')).toBeVisible();
  await expect.poll(() => page.evaluate(
    (key) => window.localStorage.getItem(key) !== null,
    LAB_STORAGE_KEY,
  )).toBe(true);
  expect((await readStoredDocument(page)).pages).toHaveLength(5);
  runtime.assertClean();
  runtime.stop();
});

test.describe('mobile visibility playback', () => {
  test.use({
    deviceScaleFactor: devices['Pixel 5'].deviceScaleFactor,
    hasTouch: true,
    isMobile: true,
    userAgent: devices['Pixel 5'].userAgent,
    viewport: { height: 844, width: 390 },
  });

  test('trusted scrolling hands playback to the most-visible card without choosing a starter', async ({ page }) => {
    const runtime = startRuntimeMonitor(page);
    await openFreshLab(page);
    await expectOnlyActive(page, 'quick_book');
    await card(page, 'Quick Book').focus();
    const startScrollY = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(650);
    expect(await page.evaluate(() => window.scrollY)).toBe(startScrollY);
    expect(await preview(page, 'quick_book').evaluate((element) => getComputedStyle(element).pointerEvents))
      .toBe('none');

    const session = await page.context().newCDPSession(page);
    await trustedVerticalGesture(page, session, await previewCenter(page, 'quick_book'), 430);
    await expectOnlyActive(page, 'one_page');
    expect(await page.evaluate((key) => window.localStorage.getItem(key), LAB_STORAGE_KEY)).toBeNull();

    await trustedVerticalGesture(page, session, await previewCenter(page, 'one_page'), 430);
    await expectOnlyActive(page, 'multi_page');
    expect(await page.evaluate((key) => window.localStorage.getItem(key), LAB_STORAGE_KEY)).toBeNull();
    await expect(page.getByRole('heading', { name: 'Choose your starting point' })).toHaveCount(1);
    runtime.assertClean();
    runtime.stop();
  });

  test('a touch-only 768px tablet stacks cards so each preview can become most visible', async ({ page }) => {
    const runtime = startRuntimeMonitor(page);
    await page.setViewportSize({ height: 1024, width: 768 });
    await openFreshLab(page);
    expect(await page.locator('.final-starter-grid').evaluate((element) => (
      getComputedStyle(element).gridTemplateColumns.split(' ').length
    ))).toBe(1);
    await expectOnlyActive(page, 'quick_book');

    const session = await page.context().newCDPSession(page);
    await trustedVerticalGesture(page, session, await previewCenter(page, 'quick_book'), 610);
    await expectOnlyActive(page, 'one_page');
    await trustedVerticalGesture(page, session, await previewCenter(page, 'one_page'), 610);
    await expectOnlyActive(page, 'multi_page');
    expect(await page.evaluate((key) => window.localStorage.getItem(key), LAB_STORAGE_KEY)).toBeNull();
    runtime.assertClean();
    runtime.stop();
  });

  test('mobile reduced motion never starts internal motion during visibility changes', async ({ page }) => {
    const runtime = startRuntimeMonitor(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openFreshLab(page);
    await expectOnlyActive(page, null);

    const session = await page.context().newCDPSession(page);
    await trustedVerticalGesture(page, session, await previewCenter(page, 'quick_book'), 430);
    await expectOnlyActive(page, null);
    for (const starter of STARTERS) {
      await expect(preview(page, starter.id)).toHaveAttribute('data-preview-state', 'poster');
      await expect(card(page, starter.name).getByText(starter.description)).toHaveCount(1);
      await expect(card(page, starter.name).getByText(starter.cta)).toHaveCount(1);
    }

    expect(await page.evaluate((key) => window.localStorage.getItem(key), LAB_STORAGE_KEY)).toBeNull();
    await card(page, 'One-page website').click();
    await expect(page.getByTestId('final-hybrid-editor')).toBeVisible();
    await expect.poll(() => page.evaluate(
      (key) => window.localStorage.getItem(key) !== null,
      LAB_STORAGE_KEY,
    )).toBe(true);
    expect((await readStoredDocument(page)).pages[0]?.sections).toHaveLength(6);
    runtime.assertClean();
    runtime.stop();
  });
});
