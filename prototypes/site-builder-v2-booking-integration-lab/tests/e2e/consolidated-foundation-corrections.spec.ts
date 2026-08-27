import {
  expect,
  test,
  type CDPSession,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  chooseStarter,
  closeDialog,
  openBookingSettings,
  openFreshLab,
  startRuntimeMonitor,
  waitForSaved,
} from './helpers';

const LAYOUTS = [
  { id: 'visual_grid', label: 'Visual Grid', search: true },
  { id: 'clean_list', label: 'Clean List', search: true },
  { id: 'editorial_cards', label: 'Editorial Cards', search: false },
  { id: 'category_menu', label: 'Category Menu', search: true },
  { id: 'editorial_price_list', label: 'Editorial Price List', search: false },
] as const;

const MOBILE_SCROLL_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 600 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 844, height: 390 },
] as const;

const FULL_JOURNEY_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 600 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
] as const;

const MAX_TRUSTED_SCROLL_SWIPES = 12;

type Point = { x: number; y: number };

async function sendTouch(
  session: CDPSession,
  type: 'touchEnd' | 'touchMove' | 'touchStart',
  point?: Point,
): Promise<void> {
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: point
      ? [{
          force: 1,
          id: 1,
          radiusX: 2,
          radiusY: 2,
          x: point.x,
          y: point.y,
        }]
      : [],
    type,
  });
}

async function trustedSwipeUp(
  page: Page,
  session: CDPSession,
  scrollBody: Locator,
): Promise<void> {
  const box = await scrollBody.boundingBox();
  expect(box, 'service detail scroll body has geometry').not.toBeNull();
  if (!box) return;
  const edgeInset = Math.min(54, Math.max(16, box.height * 0.14));
  const start = {
    x: box.x + box.width * 0.72,
    y: box.y + box.height - edgeInset,
  };
  const end = {
    x: start.x,
    y: Math.max(
      box.y + edgeInset,
      start.y - Math.min(220, box.height - edgeInset * 2),
    ),
  };
  await sendTouch(session, 'touchStart', start);
  for (let step = 1; step <= 8; step += 1) {
    const progress = step / 8;
    await sendTouch(session, 'touchMove', {
      x: start.x,
      y: start.y + (end.y - start.y) * progress,
    });
    await page.waitForTimeout(12);
  }
  await sendTouch(session, 'touchEnd');
  await page.waitForTimeout(80);
}

async function trustedSwipeFrom(
  page: Page,
  session: CDPSession,
  scrollBody: Locator,
  target: Locator,
  options: { backOffEnd?: boolean; xFraction?: number } = {},
): Promise<{ after: number; before: number; startsInsideTarget: boolean }> {
  await target.evaluate(element => element.scrollIntoView({
    block: 'center',
    inline: 'nearest',
  }));
  if (options.backOffEnd) {
    await scrollBody.evaluate((element) => {
      element.scrollTop = Math.max(
        0,
        element.scrollHeight - element.clientHeight - 32,
      );
    });
  }

  const position = await scrollBody.evaluate(element => ({
    maximum: element.scrollHeight - element.clientHeight,
    scrollTop: element.scrollTop,
  }));
  const bodyBox = await scrollBody.boundingBox();
  const targetBox = await target.boundingBox();
  const viewport = page.viewportSize();
  expect(bodyBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!bodyBox || !targetBox || !viewport) {
    return { after: position.scrollTop, before: position.scrollTop, startsInsideTarget: false };
  }

  const visibleTop = Math.max(24, bodyBox.y + 12, targetBox.y);
  const visibleBottom = Math.min(
    viewport.height - 24,
    bodyBox.y + bodyBox.height - 12,
    targetBox.y + targetBox.height,
  );
  expect(visibleBottom - visibleTop).toBeGreaterThanOrEqual(4);
  const canIncrease = position.scrollTop < position.maximum - 4;
  const originInset = Math.min(8, (visibleBottom - visibleTop) * 0.2);
  const start = {
    x: targetBox.x + targetBox.width * (options.xFraction ?? 0.5),
    y: canIncrease ? visibleBottom - originInset : visibleTop + originInset,
  };
  const end = {
    x: start.x,
    y: canIncrease
      ? Math.max(Math.max(24, bodyBox.y + 12), start.y - 220)
      : Math.min(
          Math.min(viewport.height - 24, bodyBox.y + bodyBox.height - 12),
          start.y + 180,
        ),
  };
  const startsInsideTarget = await target.evaluate((element, point) => (
    element.contains(document.elementFromPoint(point.x, point.y))
  ), start);

  await sendTouch(session, 'touchStart', start);
  for (let step = 1; step <= 10; step += 1) {
    const progress = step / 10;
    await sendTouch(session, 'touchMove', {
      x: start.x,
      y: start.y + (end.y - start.y) * progress,
    });
    await page.waitForTimeout(16);
  }
  await sendTouch(session, 'touchEnd');
  await page.waitForTimeout(180);

  return {
    after: await scrollBody.evaluate(element => element.scrollTop),
    before: position.scrollTop,
    startsInsideTarget,
  };
}

async function configureLayout(
  page: Page,
  layout: (typeof LAYOUTS)[number]['id'],
): Promise<void> {
  await page.setViewportSize({ width: 1180, height: 800 });
  const returnToBooking = page.getByRole('button', { name: 'Back to Booking' });
  if (await returnToBooking.isVisible()) {
    await returnToBooking.click();
  }
  const { settings } = await openBookingSettings(page, 'Home');
  const option = settings.locator(`[data-layout-option="${layout}"]`);
  await option.click();
  await expect(option).toHaveAttribute('aria-pressed', 'true');
  if (await page.getByRole('dialog', { name: 'Booking settings' }).isVisible()) {
    await closeDialog(page, 'Booking settings');
  } else {
    await closeDialog(page, 'Booking');
  }
  await waitForSaved(page);
}

async function openRussianService(
  page: Page,
  hasSearch: boolean,
): Promise<{ menuScrollTop: number; renderer: Locator; windowScrollY: number }> {
  const renderer = page.getByTestId('booking-section-preview');
  if (hasSearch) {
    const search = renderer.getByRole('searchbox', { name: 'Search services' });
    await search.fill('Russian manicure');
  }
  const action = renderer.getByRole('button', { name: /Russian Manicure/ }).first();
  await action.scrollIntoViewIfNeeded();
  const menuScrollTop = await page.locator('.client-site').evaluate(
    element => element.scrollTop,
  );
  const windowScrollY = await page.evaluate(() => window.scrollY);
  await action.click();
  await expect(page.getByTestId('service-detail-dialog')).toBeVisible();
  return { menuScrollTop, renderer, windowScrollY };
}

async function expectActionInsideScrollBody(
  scrollBody: Locator,
  action: Locator,
): Promise<void> {
  const geometry = await scrollBody.evaluate((body, actionElement) => {
    const bodyRect = body.getBoundingClientRect();
    const actionRect = (actionElement as HTMLElement).getBoundingClientRect();
    return {
      actionBottom: actionRect.bottom,
      actionTop: actionRect.top,
      bodyBottom: bodyRect.bottom,
      bodyTop: bodyRect.top,
    };
  }, await action.elementHandle());
  expect(geometry.actionTop).toBeGreaterThanOrEqual(geometry.bodyTop - 1);
  expect(geometry.actionBottom).toBeLessThanOrEqual(geometry.bodyBottom + 1);
}

type CloseExclusionPosition = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

async function expectCloseExcludedFromScrollBody(
  detail: Locator,
): Promise<CloseExclusionPosition> {
  const geometry = await detail.evaluate((shell) => {
    const panel = shell.querySelector<HTMLElement>('.booking-dialog-panel');
    const body = shell.querySelector<HTMLElement>(
      '[data-testid="service-detail-scroll-body"]',
    );
    const close = shell.querySelector<HTMLButtonElement>(
      'button.booking-dialog-close[aria-label="Close service details"]',
    );
    if (!panel || !body || !close) {
      throw new Error('Service Detail close-exclusion structure is missing.');
    }
    const shellRect = shell.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const closeRect = close.getBoundingClientRect();
    const closeHit = document.elementFromPoint(
      closeRect.left + closeRect.width / 2,
      closeRect.top + closeRect.height / 2,
    );
    const safeAreaHit = document.elementFromPoint(
      bodyRect.left + Math.min(16, bodyRect.width / 4),
      closeRect.top + closeRect.height / 2,
    );
    const panelStyle = getComputedStyle(panel);
    const meaningfulContent = body.querySelectorAll<HTMLElement>([
      '.booking-detail-description',
      '.booking-detail-meta',
      '.booking-add-on-name',
      '.booking-add-on-adjustment',
      '.booking-detail-actions',
    ].join(','));

    return {
      addOnCount: body.querySelectorAll('.booking-add-on-option').length,
      bodyContainsClose: body.contains(close),
      bodyTop: bodyRect.top,
      close: {
        bottom: closeRect.bottom,
        height: closeRect.height,
        left: closeRect.left,
        right: closeRect.right,
        top: closeRect.top,
        width: closeRect.width,
      },
      closeCenterHit: Boolean(closeHit && close.contains(closeHit)),
      closeInsideShell:
        closeRect.left >= shellRect.left - 1
        && closeRect.top >= shellRect.top - 1
        && closeRect.right <= shellRect.right + 1
        && closeRect.bottom <= shellRect.bottom + 1,
      closePosition: getComputedStyle(close).position,
      description: body.querySelector('.booking-detail-description')?.textContent?.trim() ?? '',
      firstGridTrack: Number.parseFloat(panelStyle.gridTemplateRows.split(' ')[0] ?? ''),
      meaningfulContentCount: meaningfulContent.length,
      meaningfulContentOutsideScroller: [...meaningfulContent]
        .some(element => !body.contains(element)),
      panelDisplay: panelStyle.display,
      safeAreaHitInsideBody: Boolean(safeAreaHit && body.contains(safeAreaHit)),
      samePanelParent: close.parentElement === body.parentElement,
    };
  });

  expect(geometry.bodyContainsClose).toBe(false);
  expect(geometry.samePanelParent).toBe(true);
  expect(geometry.panelDisplay).toBe('grid');
  expect(geometry.firstGridTrack).toBeCloseTo(72, 0);
  expect(geometry.closePosition).toBe('relative');
  expect(geometry.bodyTop - geometry.close.bottom).toBeGreaterThanOrEqual(12);
  expect(geometry.close.height).toBeCloseTo(44, 0);
  expect(geometry.close.width).toBeCloseTo(44, 0);
  expect(geometry.closeInsideShell).toBe(true);
  expect(geometry.closeCenterHit).toBe(true);
  expect(geometry.safeAreaHitInsideBody).toBe(false);
  expect(geometry.description.length).toBeGreaterThan(40);
  expect(geometry.addOnCount).toBe(4);
  expect(geometry.meaningfulContentCount).toBeGreaterThanOrEqual(11);
  expect(geometry.meaningfulContentOutsideScroller).toBe(false);

  return geometry.close;
}

function expectClosePositionStable(
  before: CloseExclusionPosition,
  after: CloseExclusionPosition,
): void {
  expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.right - before.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.bottom - before.bottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(1);
}

async function expectFeaturedRailTargetsReachable(
  rail: Locator,
  tiles: Locator,
): Promise<void> {
  await expect(tiles).toHaveCount(6);
  for (const index of [0, 2, 5]) {
    const tile = tiles.nth(index);
    await tile.scrollIntoViewIfNeeded();
    const railBox = await rail.boundingBox();
    const tileBox = await tile.boundingBox();
    expect(railBox, `Featured rail has geometry for tile ${index + 1}`).not.toBeNull();
    expect(tileBox, `Featured tile ${index + 1} has geometry`).not.toBeNull();
    if (!railBox || !tileBox) continue;
    expect(tileBox.x).toBeGreaterThanOrEqual(railBox.x - 1);
    expect(tileBox.x + tileBox.width).toBeLessThanOrEqual(
      railBox.x + railBox.width + 1,
    );
  }
}

for (const layout of LAYOUTS) {
  test(`${layout.label} uses one trusted-touch Service Detail scroller at every critical mobile size`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const runtime = startRuntimeMonitor(page);
    try {
      await openFreshLab(page);
      await chooseStarter(page, 'Quick Book');
      await configureLayout(page, layout.id);
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      const cdp = await page.context().newCDPSession(page);

      for (const viewport of MOBILE_SCROLL_VIEWPORTS) {
        await page.setViewportSize(viewport);
        const { menuScrollTop, windowScrollY } = await openRussianService(
          page,
          layout.search,
        );
        const detail = page.getByTestId('service-detail-dialog');
        const scrollBody = detail.getByTestId('service-detail-scroll-body');
        const primary = detail.getByRole('button', { name: 'Select service' });
        const closeStart = await expectCloseExcludedFromScrollBody(detail);

        const initial = await detail.evaluate((shell) => {
          const panel = shell.querySelector('.booking-dialog-panel');
          const body = shell.querySelector('[data-testid="service-detail-scroll-body"]');
          if (!panel || !body) throw new Error('Service Detail scroll structure is missing.');
          const verticalScrollers = [body, ...body.querySelectorAll('*')]
            .filter((element) => {
              const style = getComputedStyle(element);
              return ['auto', 'scroll'].includes(style.overflowY)
                && element.scrollHeight > element.clientHeight;
            });
          return {
            bodyClientHeight: body.clientHeight,
            bodyOverflowY: getComputedStyle(body).overflowY,
            bodyScrollHeight: body.scrollHeight,
            bodyScrollTop: body.scrollTop,
            panelOverflowY: getComputedStyle(panel).overflowY,
            shellOverflowY: getComputedStyle(shell).overflowY,
            verticalScrollerCount: verticalScrollers.length,
          };
        });
        expect(initial.bodyOverflowY).toBe('auto');
        expect(initial.panelOverflowY).toBe('hidden');
        expect(initial.shellOverflowY).toBe('hidden');
        expect(initial.bodyScrollHeight).toBeGreaterThan(initial.bodyClientHeight);
        expect(initial.bodyScrollTop).toBe(0);
        expect(initial.verticalScrollerCount).toBe(1);

        await trustedSwipeUp(page, cdp, scrollBody);
        await expect.poll(() => scrollBody.evaluate(element => element.scrollTop))
          .toBeGreaterThan(0);
        expect(Math.abs(
          await page.locator('.client-site').evaluate(element => element.scrollTop)
          - menuScrollTop,
        )).toBeLessThanOrEqual(1);
        expect(await page.evaluate(() => window.scrollY)).toBe(windowScrollY);

        for (let swipe = 0; swipe < MAX_TRUSTED_SCROLL_SWIPES; swipe += 1) {
          const atBottom = await scrollBody.evaluate(
            element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
          );
          if (atBottom) break;
          await trustedSwipeUp(page, cdp, scrollBody);
        }
        await expect.poll(() => scrollBody.evaluate(
          element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
        )).toBe(true);
        const closeEnd = await expectCloseExcludedFromScrollBody(detail);
        expectClosePositionStable(closeStart, closeEnd);
        await expectActionInsideScrollBody(scrollBody, primary);
        await expect(primary).toBeEnabled();
        await primary.click({ trial: true });
        await trustedSwipeUp(page, cdp, scrollBody);
        expect(Math.abs(
          await page.locator('.client-site').evaluate(element => element.scrollTop)
          - menuScrollTop,
        )).toBeLessThanOrEqual(1);

        if (viewport === MOBILE_SCROLL_VIEWPORTS[0]) {
          await primary.click();
          const summary = page.getByTestId('selected-service-summary');
          await expect(summary).toContainText('Russian Manicure');
          await summary.getByRole('button', { name: 'Change' }).click();
          const selectedDetail = page.getByTestId('service-detail-dialog');
          await selectedDetail
            .getByRole('button', { name: 'Remove selected service' })
            .click();
          await expect(summary).toHaveCount(0);
        } else {
          await detail.getByRole('button', { name: 'Keep browsing' }).click();
          await expect(detail).toHaveCount(0);
        }
        expect(Math.abs(
          await page.locator('.client-site').evaluate(element => element.scrollTop)
          - menuScrollTop,
        )).toBeLessThanOrEqual(1);
        expect(await page.evaluate(() => window.scrollY)).toBe(windowScrollY);

        const { renderer } = await openRussianService(page, layout.search);
        const reopenedBody = page.getByTestId('service-detail-scroll-body');
        expect(await reopenedBody.evaluate(element => element.scrollTop)).toBe(0);
        await page.getByRole('button', { name: 'Close service details' }).click();
        await expect(page.getByTestId('service-detail-dialog')).toHaveCount(0);
        if (layout.search) {
          await renderer.getByRole('button', { name: 'Clear service search' }).click();
        }
      }
    } finally {
      runtime.assertClean();
      runtime.stop();
    }
  });
}

test('simulated Phone contains the same internal Service Detail scroller', async ({
  page,
}) => {
  const runtime = startRuntimeMonitor(page);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.getByRole('group', { name: 'Preview viewport' })
      .getByRole('button', { name: 'Phone' })
      .click();
    const { menuScrollTop } = await openRussianService(page, true);
    const detail = page.getByTestId('service-detail-dialog');
    const body = detail.getByTestId('service-detail-scroll-body');
    const host = page.locator('.preview-overlay-host');
    const closeStart = await expectCloseExcludedFromScrollBody(detail);
    const containment = await detail.evaluate((shell, hostElement) => {
      const shellRect = shell.getBoundingClientRect();
      const hostRect = (hostElement as HTMLElement).getBoundingClientRect();
      return {
        bodyClientHeight: shell.querySelector<HTMLElement>(
          '[data-testid="service-detail-scroll-body"]',
        )?.clientHeight ?? 0,
        bodyScrollHeight: shell.querySelector<HTMLElement>(
          '[data-testid="service-detail-scroll-body"]',
        )?.scrollHeight ?? 0,
        contained:
          shellRect.left >= hostRect.left - 1
          && shellRect.top >= hostRect.top - 1
          && shellRect.right <= hostRect.right + 1
          && shellRect.bottom <= hostRect.bottom + 1,
        hostHeight: hostRect.height,
        outerVisualViewportHeight: window.visualViewport?.height ?? window.innerHeight,
        shellHeight: shellRect.height,
      };
    }, await host.elementHandle());
    expect(containment.contained).toBe(true);
    expect(containment.bodyScrollHeight).toBeGreaterThan(containment.bodyClientHeight);
    expect(containment.shellHeight).toBeLessThanOrEqual(containment.hostHeight);
    expect(containment.shellHeight).toBeLessThan(containment.outerVisualViewportHeight);

    const cdp = await page.context().newCDPSession(page);
    for (let swipe = 0; swipe < MAX_TRUSTED_SCROLL_SWIPES; swipe += 1) {
      const atBottom = await body.evaluate(
        element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
      );
      if (atBottom) break;
      await trustedSwipeUp(page, cdp, body);
    }
    await expect.poll(() => body.evaluate(
      element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
    )).toBe(true);
    const closeEnd = await expectCloseExcludedFromScrollBody(detail);
    expectClosePositionStable(closeStart, closeEnd);
    expect(Math.abs(
      await page.locator('.client-site').evaluate(element => element.scrollTop)
      - menuScrollTop,
    )).toBeLessThanOrEqual(1);
    await detail.getByRole('button', { name: 'Select service' }).click({ trial: true });
    await detail.getByRole('button', { name: 'Close service details' }).click();

    await page.getByRole('group', { name: 'Preview viewport' })
      .getByRole('button', { name: 'Tablet' })
      .click();
    await openRussianService(page, true);
    const tabletDetail = page.getByTestId('service-detail-dialog');
    const tabletHost = page.locator('.preview-overlay-host');
    const tabletContainment = await tabletDetail.evaluate((shell, hostElement) => {
      const shellRect = shell.getBoundingClientRect();
      const hostRect = (hostElement as HTMLElement).getBoundingClientRect();
      const scrollBody = shell.querySelector<HTMLElement>(
        '[data-testid="service-detail-scroll-body"]',
      );
      return {
        bodyOverflowY: scrollBody ? getComputedStyle(scrollBody).overflowY : '',
        contained:
          shellRect.left >= hostRect.left - 1
          && shellRect.top >= hostRect.top - 1
          && shellRect.right <= hostRect.right + 1
          && shellRect.bottom <= hostRect.bottom + 1,
      };
    }, await tabletHost.elementHandle());
    expect(tabletContainment.contained).toBe(true);
    expect(tabletContainment.bodyOverflowY).toBe('auto');
    await tabletDetail.getByRole('button', { name: 'Close service details' }).click();
  } finally {
    runtime.assertClean();
    runtime.stop();
  }
});

test.describe('real-mobile-style Chromium context', () => {
  test.use({
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 844, height: 390 },
  });

  test('keeps the primary action reachable in mobile landscape', async ({ page }) => {
    const runtime = startRuntimeMonitor(page);
    try {
      await openFreshLab(page);
      await chooseStarter(page, 'Quick Book');
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      await openRussianService(page, true);
      const detail = page.getByTestId('service-detail-dialog');
      const body = detail.getByTestId('service-detail-scroll-body');
      const cdp = await page.context().newCDPSession(page);
      const closeStart = await expectCloseExcludedFromScrollBody(detail);
      for (let swipe = 0; swipe < MAX_TRUSTED_SCROLL_SWIPES; swipe += 1) {
        const atBottom = await body.evaluate(
          element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
        );
        if (atBottom) break;
        await trustedSwipeUp(page, cdp, body);
      }
      await expect.poll(() => body.evaluate(
        element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
      )).toBe(true);
      const closeEnd = await expectCloseExcludedFromScrollBody(detail);
      expectClosePositionStable(closeStart, closeEnd);
      const primary = detail.getByRole('button', { name: 'Select service' });
      await expectActionInsideScrollBody(body, primary);
      const visualReachability = await primary.evaluate((action) => {
        const rectangle = action.getBoundingClientRect();
        const viewportTop = window.visualViewport?.offsetTop ?? 0;
        const viewportBottom = viewportTop
          + (window.visualViewport?.height ?? window.innerHeight);
        return {
          actionBottom: rectangle.bottom,
          actionTop: rectangle.top,
          viewportBottom,
          viewportTop,
        };
      });
      expect(visualReachability.actionTop)
        .toBeGreaterThanOrEqual(visualReachability.viewportTop - 1);
      expect(visualReachability.actionBottom)
        .toBeLessThanOrEqual(visualReachability.viewportBottom + 1);
      await primary.click({ trial: true });
    } finally {
      runtime.assertClean();
      runtime.stop();
    }
  });

  test('scrolls the same body from every content origin', async ({
    page,
  }) => {
    await page.route('**/favicon.ico', route => route.fulfill({
      body: '',
      status: 204,
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await openFreshLab(page);
    const runtime = startRuntimeMonitor(page);
    try {
      await chooseStarter(page, 'Quick Book');
      await page.setViewportSize({ width: 1180, height: 800 });
      const { settings } = await openBookingSettings(page, 'Home');
      await settings
        .getByRole('group', { name: 'Visual Grid image mode' })
        .getByRole('button', { name: 'Show', exact: true })
        .click();
      await closeDialog(page, 'Booking settings');
      await waitForSaved(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      const cdp = await page.context().newCDPSession(page);
      const targets = [
        { label: 'image', selector: '.booking-detail-image-wrap' },
        { label: 'description', selector: '.booking-detail-description' },
        { label: 'add-on row', selector: '.booking-add-on-option' },
        { label: 'empty body area', selector: '.booking-detail-copy', xFraction: 0.01 },
      ] as const;

      for (const targetDefinition of targets) {
        await openRussianService(page, true);
        const detail = page.getByTestId('service-detail-dialog');
        const body = detail.getByTestId('service-detail-scroll-body');
        const target = detail.locator(targetDefinition.selector).first();
        const result = await trustedSwipeFrom(page, cdp, body, target, {
          xFraction: 'xFraction' in targetDefinition
            ? targetDefinition.xFraction
            : undefined,
        });
        expect(result.startsInsideTarget, `${targetDefinition.label} gesture begins in target`)
          .toBe(true);
        expect(
          Math.abs(result.after - result.before),
          `${targetDefinition.label} gesture moves the internal body`,
        ).toBeGreaterThan(1);
        await detail.getByRole('button', { name: 'Keep browsing' }).click();
      }

      await openRussianService(page, true);
      const detail = page.getByTestId('service-detail-dialog');
      const body = detail.getByTestId('service-detail-scroll-body');
      const actions = detail.locator('.booking-detail-actions');
      const options = detail.locator('.booking-add-on-fieldset');
      await actions.evaluate(element => element.scrollIntoView({
        block: 'center',
        inline: 'nearest',
      }));
      await body.evaluate((element) => {
        element.scrollTop = element.scrollHeight - element.clientHeight;
      });
      const actionsBox = await actions.boundingBox();
      const optionsBox = await options.boundingBox();
      expect(actionsBox).not.toBeNull();
      expect(optionsBox).not.toBeNull();
      if (!actionsBox || !optionsBox) return;
      const origin = {
        x: actionsBox.x + 8,
        y: (optionsBox.y + optionsBox.height + actionsBox.y) / 2,
      };
      expect(await page.evaluate(({ x, y }) => (
        document.elementFromPoint(x, y)?.className
      ), origin)).toBe('booking-detail-copy');
      const before = await body.evaluate(element => element.scrollTop);
      await sendTouch(cdp, 'touchStart', origin);
      for (let step = 1; step <= 10; step += 1) {
        await sendTouch(cdp, 'touchMove', {
          x: origin.x,
          y: origin.y + 8 * step,
        });
        await page.waitForTimeout(16);
      }
      await sendTouch(cdp, 'touchEnd');
      await expect.poll(() => body.evaluate(element => element.scrollTop))
        .toBeLessThan(before - 1);
    } finally {
      runtime.assertClean();
      runtime.stop();
    }
  });
});

test('Visual Grid keeps Featured geometry and image-mode detail behavior across mobile sizes', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const runtime = startRuntimeMonitor(page);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    const editRail = page.locator('.final-hybrid-app .featured-scroller').first();
    const editTiles = editRail.locator('.featured-tile');
    await expectFeaturedRailTargetsReachable(editRail, editTiles);
    const editTile = page.locator('.final-hybrid-app .featured-tile').first();
    const editGeometry = await editTile.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        aspectRatio: rect.width / rect.height,
        height: rect.height,
        width: rect.width,
      };
    });
    expect(editGeometry.height).toBeCloseTo(176, 1);
    expect(editGeometry.width).toBeGreaterThanOrEqual(245);

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const previewRail = page.locator('.final-hybrid-preview .featured-scroller').first();
    const previewTiles = previewRail.locator('.featured-tile');
    await expectFeaturedRailTargetsReachable(previewRail, previewTiles);
    const previewTile = page.locator('.final-hybrid-preview .featured-tile').first();
    await expect(previewTile).toHaveJSProperty('tagName', 'BUTTON');
    const previewGeometry = await previewTile.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        aspectRatio: rect.width / rect.height,
        height: rect.height,
        width: rect.width,
      };
    });
    expect(Math.abs(previewGeometry.width - editGeometry.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(previewGeometry.height - editGeometry.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(previewGeometry.aspectRatio - editGeometry.aspectRatio))
      .toBeLessThanOrEqual(0.01);
    await expect(previewTile).toHaveCSS('min-height', '176px');
    await expect(previewTile.locator('img')).toHaveCSS('object-fit', 'cover');
    await previewTile.scrollIntoViewIfNeeded();
    await previewTile.click();
    const selectedDetail = page.getByTestId('service-detail-dialog');
    await selectedDetail.getByTestId('service-detail-scroll-body').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await selectedDetail.getByRole('button', { name: 'Select service' }).click();
    await expect(previewTile).toHaveAttribute('aria-pressed', 'true');
    await expect(previewTile).toHaveAttribute('data-selected', 'true');
    await expect(previewTile.locator('.booking-selected-indicator')).toBeVisible();
    await page.getByTestId('selected-service-summary')
      .getByRole('button', { name: 'Change' })
      .click();
    await page.getByTestId('service-detail-dialog')
      .getByRole('button', { name: 'Remove selected service' })
      .click();
    await page.getByRole('button', { name: 'Back to editor' }).click();
    const cdp = await page.context().newCDPSession(page);

    for (const imageMode of ['Hide', 'Show', 'Auto'] as const) {
      await page.setViewportSize({ width: 1180, height: 800 });
      const returnToBooking = page.getByRole('button', { name: 'Back to Booking' });
      if (await returnToBooking.isVisible()) {
        await returnToBooking.click();
      }
      const { settings } = await openBookingSettings(page, 'Home');
      await settings
        .getByRole('group', { name: 'Visual Grid image mode' })
        .getByRole('button', { name: imageMode, exact: true })
        .click();
      await closeDialog(page, 'Booking settings');
      await waitForSaved(page);
      await page.getByRole('button', { name: 'Preview', exact: true }).click();

      for (const viewport of MOBILE_SCROLL_VIEWPORTS) {
        await page.setViewportSize(viewport);
        const { menuScrollTop, windowScrollY } = await openRussianService(page, true);
        const detail = page.getByTestId('service-detail-dialog');
        const body = detail.getByTestId('service-detail-scroll-body');
        const closeStart = await expectCloseExcludedFromScrollBody(detail);
        await expect(body).toHaveAttribute('data-image-mode', imageMode.toLowerCase());
        await expect(body.locator('.booking-detail-image-wrap'))
          .toHaveCount(imageMode === 'Hide' ? 0 : 1);
        const dimensions = await body.evaluate(element => ({
          clientHeight: element.clientHeight,
          overflowY: getComputedStyle(element).overflowY,
          scrollHeight: element.scrollHeight,
        }));
        expect(dimensions.overflowY).toBe('auto');
        if (dimensions.scrollHeight > dimensions.clientHeight) {
          for (let swipe = 0; swipe < MAX_TRUSTED_SCROLL_SWIPES; swipe += 1) {
            const atBottom = await body.evaluate(
              element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
            );
            if (atBottom) break;
            await trustedSwipeUp(page, cdp, body);
          }
          await expect.poll(() => body.evaluate(
            element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
          )).toBe(true);
        } else {
          expect(dimensions.scrollHeight).toBe(dimensions.clientHeight);
        }
        const closeEnd = await expectCloseExcludedFromScrollBody(detail);
        expectClosePositionStable(closeStart, closeEnd);
        const primary = detail.getByRole('button', {
          name: 'Select service',
        });
        await expectActionInsideScrollBody(body, primary);
        await primary.click({ trial: true });
        expect(Math.abs(
          await page.locator('.client-site').evaluate(element => element.scrollTop)
          - menuScrollTop,
        )).toBeLessThanOrEqual(1);
        expect(await page.evaluate(() => window.scrollY)).toBe(windowScrollY);
        await page.getByRole('button', { name: 'Close service details' }).click();
        await page.getByTestId('booking-section-preview')
          .getByRole('button', { name: 'Clear service search' })
          .click();
      }

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole('group', { name: 'Preview viewport' })
        .getByRole('button', { name: 'Phone' })
        .click();
      const { menuScrollTop, windowScrollY } = await openRussianService(page, true);
      const phoneDetail = page.getByTestId('service-detail-dialog');
      const phoneBody = phoneDetail.getByTestId('service-detail-scroll-body');
      const phoneCloseStart = await expectCloseExcludedFromScrollBody(phoneDetail);
      await expect(phoneBody).toHaveAttribute('data-image-mode', imageMode.toLowerCase());
      await expect(phoneBody.locator('.booking-detail-image-wrap'))
        .toHaveCount(imageMode === 'Hide' ? 0 : 1);
      for (let swipe = 0; swipe < MAX_TRUSTED_SCROLL_SWIPES; swipe += 1) {
        const atBottom = await phoneBody.evaluate(
          element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
        );
        if (atBottom) break;
        await trustedSwipeUp(page, cdp, phoneBody);
      }
      await expect.poll(() => phoneBody.evaluate(
        element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
      )).toBe(true);
      const phoneCloseEnd = await expectCloseExcludedFromScrollBody(phoneDetail);
      expectClosePositionStable(phoneCloseStart, phoneCloseEnd);
      await phoneDetail.getByRole('button', { name: 'Select service' }).click({ trial: true });
      expect(Math.abs(
        await page.locator('.client-site').evaluate(element => element.scrollTop)
        - menuScrollTop,
      )).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => window.scrollY)).toBe(windowScrollY);
      await phoneDetail.getByRole('button', { name: 'Close service details' }).click();
      await page.getByTestId('booking-section-preview')
        .getByRole('button', { name: 'Clear service search' })
        .click();

      await page.setViewportSize({ width: 1180, height: 800 });
      await page.getByRole('button', { name: 'Back to editor' }).click();
    }
  } finally {
    runtime.assertClean();
    runtime.stop();
  }
});

test('Search exposes one scoped clear control and restores focus without duplicate prompt copy', async ({
  page,
}) => {
  const runtime = startRuntimeMonitor(page);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const renderer = page.getByTestId('booking-section-preview');
    const search = renderer.getByRole('searchbox', { name: 'Search services' });
    await expect(search).toHaveAttribute('placeholder', 'Try “Russian manicure”');
    const hiddenLabelTreatment = await renderer
      .locator('.booking-search-field .sr-only')
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          clip: style.clip,
          height: style.height,
          overflow: style.overflow,
          position: style.position,
          width: style.width,
        };
      });
    expect(hiddenLabelTreatment).toEqual({
      clip: 'rect(0px, 0px, 0px, 0px)',
      height: '1px',
      overflow: 'hidden',
      position: 'absolute',
      width: '1px',
    });
    await search.fill('  RuSs  ');
    await expect(renderer.getByRole('button', { name: 'Clear service search' }))
      .toHaveCount(1);
    await expect(renderer.getByRole('button', { name: /Russian Manicure/ }).first())
      .toBeVisible();
    const decoration = await search.evaluate((element) => ({
      appearance: getComputedStyle(element).appearance,
      cancelAppearance: getComputedStyle(
        element,
        '::-webkit-search-cancel-button',
      ).webkitAppearance,
    }));
    expect(decoration.appearance).toBe('none');
    expect(decoration.cancelAppearance).toBe('none');
    const nativeDecorationRules = await page.evaluate(() => {
      const css = [...document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules].map(rule => rule.cssText);
        } catch {
          return [];
        }
      }).join('\n');
      return {
        cancel: css.includes('::-webkit-search-cancel-button'),
        decoration: css.includes('::-webkit-search-decoration'),
        resultsButton: css.includes('::-webkit-search-results-button'),
        resultsDecoration: css.includes('::-webkit-search-results-decoration'),
      };
    });
    expect(nativeDecorationRules).toEqual({
      cancel: true,
      decoration: true,
      resultsButton: true,
      resultsDecoration: true,
    });

    await search.fill('definitely-no-service');
    await expect(renderer.getByText('No services found')).toBeVisible();
    await renderer.getByRole('button', { name: 'Clear service search' }).click();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');
    await expect(search).toHaveAttribute('placeholder', 'Try “Russian manicure”');
    await expect(renderer.getByRole('button', { name: 'Clear service search' }))
      .toHaveCount(0);

    await page.setViewportSize({ width: 1440, height: 900 });
    await search.fill('Russian');
    await expect(renderer.getByRole('button', { name: 'Clear service search' }))
      .toHaveCount(1);
    await renderer.getByRole('button', { name: 'Clear service search' }).click();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');
  } finally {
    runtime.assertClean();
    runtime.stop();
  }
});

for (const layout of LAYOUTS) {
  test(`${layout.label} offers Keep editing for dirty X, Escape, and backdrop paths at 320px`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const runtime = startRuntimeMonitor(page);
    try {
      await openFreshLab(page);
      await chooseStarter(page, 'Quick Book');
      await configureLayout(page, layout.id);
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      await page.setViewportSize({ width: 320, height: 568 });
      await openRussianService(page, layout.search);
      const detail = page.getByTestId('service-detail-dialog');
      const french = detail.getByRole('checkbox', { name: 'French' });
      await french.check();
      const close = detail.getByRole('button', { name: 'Close service details' });

      const expectWarningAndKeepEditing = async () => {
        const warning = page.getByTestId('booking-option-warning-dialog');
        await expect(warning).toBeVisible();
        for (const action of ['Keep editing', 'Discard changes', 'Save changes']) {
          await expect(warning.getByRole('button', { name: action })).toBeVisible();
        }
        const warningBox = await warning.boundingBox();
        expect(warningBox, 'warning has geometry').not.toBeNull();
        if (warningBox) {
          expect(warningBox.x).toBeGreaterThanOrEqual(0);
          expect(warningBox.x + warningBox.width).toBeLessThanOrEqual(320);
        }
        await warning.getByRole('button', { name: 'Keep editing' }).click();
        await expect(warning).toHaveCount(0);
        await expect(detail).toBeVisible();
        await expect(french).toBeChecked();
        await expect(close).toBeFocused();
      };

      await close.click();
      await expectWarningAndKeepEditing();
      await page.keyboard.press('Escape');
      await expectWarningAndKeepEditing();
      await page.getByTestId('service-detail-dialog-backdrop').click({
        position: { x: 2, y: 2 },
      });
      await expectWarningAndKeepEditing();

      await close.click();
      let warning = page.getByTestId('booking-option-warning-dialog');
      await warning.getByRole('button', { name: 'Discard changes' }).click();
      await expect(detail).toHaveCount(0);
      await expect(page.getByTestId('selected-service-summary')).toHaveCount(0);

      await openRussianService(page, layout.search);
      const saveDetail = page.getByTestId('service-detail-dialog');
      await saveDetail.getByRole('checkbox', { name: 'French' }).check();
      await saveDetail.getByRole('button', { name: 'Close service details' }).click();
      warning = page.getByTestId('booking-option-warning-dialog');
      await warning.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByTestId('selected-service-summary'))
        .toContainText('1 hr 45 min · From $80 · 1 add-on');
      expect(await page.evaluate(() => ({
        bodyOverflow: document.body.style.overflow,
        htmlOverflow: document.documentElement.style.overflow,
      }))).toEqual({ bodyOverflow: '', htmlOverflow: '' });
    } finally {
      runtime.assertClean();
      runtime.stop();
    }
  });
}

test('Keep editing stays reachable on direct desktop/mobile and simulated Phone/Tablet', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const runtime = startRuntimeMonitor(page);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();

    const verifyKeepEditing = async (label: string) => {
      await openRussianService(page, true);
      const detail = page.getByTestId('service-detail-dialog');
      await detail.getByRole('checkbox', { name: 'French' }).check();
      const lockBefore = await page.evaluate(() => ({
        body: document.body.style.overflow,
        html: document.documentElement.style.overflow,
      }));
      const close = detail.getByRole('button', { name: 'Close service details' });
      await close.click();
      const warning = page.getByTestId('booking-option-warning-dialog');
      await expect(warning, `${label}: warning`).toBeVisible();
      await expect(warning.getByRole('button', { name: 'Keep editing' })).toBeVisible();
      await warning.getByRole('button', { name: 'Keep editing' }).click();
      await expect(warning).toHaveCount(0);
      await expect(detail).toBeVisible();
      await expect(detail.getByRole('checkbox', { name: 'French' })).toBeChecked();
      await expect(close).toBeFocused();
      expect(await page.evaluate(() => ({
        body: document.body.style.overflow,
        html: document.documentElement.style.overflow,
      }))).toEqual(lockBefore);
      await close.click();
      await page.getByTestId('booking-option-warning-dialog')
        .getByRole('button', { name: 'Discard changes' })
        .click();
      await expect(detail).toHaveCount(0);
      await page.getByTestId('booking-section-preview')
        .getByRole('button', { name: 'Clear service search' })
        .click();
    };

    for (const viewport of [
      { height: 600, label: '375×600', width: 375 },
      { height: 844, label: '390×844', width: 390 },
      { height: 900, label: '1440×900', width: 1440 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await verifyKeepEditing(viewport.label);
    }

    for (const device of ['Phone', 'Tablet'] as const) {
      await page.getByRole('group', { name: 'Preview viewport' })
        .getByRole('button', { name: device })
        .click();
      await verifyKeepEditing(`simulated ${device}`);
    }
  } finally {
    runtime.assertClean();
    runtime.stop();
  }
});

for (const layout of LAYOUTS) {
  test(`${layout.label} completes the full customer journey at every required viewport`, async ({
    page,
  }) => {
    test.setTimeout(360_000);
    const runtime = startRuntimeMonitor(page);
    try {
      await openFreshLab(page);
      await chooseStarter(page, 'Quick Book');
      await configureLayout(page, layout.id);
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      const cdp = await page.context().newCDPSession(page);

      const scrollToBottom = async (body: Locator) => {
        for (let attempt = 0; attempt < MAX_TRUSTED_SCROLL_SWIPES; attempt += 1) {
          const atBottom = await body.evaluate(
            element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
          );
          if (atBottom) return;
          await trustedSwipeUp(page, cdp, body);
        }
        await expect.poll(() => body.evaluate(
          element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
        )).toBe(true);
      };

      const openWarning = async (
        path: 'backdrop' | 'escape' | 'x',
      ): Promise<Locator> => {
        const detail = page.getByTestId('service-detail-dialog');
        if (path === 'x') {
          await detail.getByRole('button', { name: 'Close service details' }).click();
        } else if (path === 'escape') {
          await page.keyboard.press('Escape');
        } else {
          await page.getByTestId('service-detail-dialog-backdrop').click({
            position: { x: 2, y: 2 },
          });
        }
        const warning = page.getByTestId('booking-option-warning-dialog');
        await expect(warning).toBeVisible();
        return warning;
      };

      for (const viewport of FULL_JOURNEY_VIEWPORTS) {
        await page.setViewportSize(viewport);
        const renderer = page.getByTestId('booking-section-preview');

        if (layout.search) {
          if (layout.id === 'category_menu') {
            const mobilePedicure = renderer
              .getByRole('navigation', { name: 'Browse service categories' })
              .getByRole('button', { name: /^Pedicure/ });
            const desktopPedicure = renderer
              .getByRole('navigation', { name: 'Service category navigation' })
              .getByRole('button', { name: /^Pedicure/ });
            await (await mobilePedicure.isVisible() ? mobilePedicure : desktopPedicure).click();
          } else {
            await renderer
              .getByRole('group', { name: 'Service categories' })
              .getByRole('button', { name: 'Pedicure', exact: true })
              .click();
          }
          const search = renderer.getByRole('searchbox', { name: 'Search services' });
          await search.fill('Russian manicure');
          await expect(renderer.getByRole('button', { name: 'Clear service search' }))
            .toHaveCount(1);
          await expect(renderer.getByRole('button', { name: /Russian Manicure/ }).first())
            .toBeVisible();
        } else {
          await expect(renderer.getByRole('searchbox', { name: 'Search services' }))
            .toHaveCount(0);
        }

        await openRussianService(page, layout.search);
        let detail = page.getByTestId('service-detail-dialog');
        let body = detail.getByTestId('service-detail-scroll-body');
        await scrollToBottom(body);
        await expectActionInsideScrollBody(
          body,
          detail.getByRole('button', { name: 'Select service' }),
        );
        await detail.getByRole('checkbox', { name: 'French' }).check();
        await expect(detail.getByTestId('service-detail-total'))
          .toContainText('1 hr 45 min');
        await expect(detail.getByTestId('service-detail-total'))
          .toContainText('From $80');
        await detail.getByRole('checkbox', { name: 'Chrome' }).check();
        await expect(detail.getByTestId('service-detail-total'))
          .toContainText('1 hr 55 min');
        await expect(detail.getByTestId('service-detail-total'))
          .toContainText('From $90');
        await detail.getByRole('checkbox', { name: 'Chrome' }).uncheck();
        await expect(detail.getByTestId('service-detail-total'))
          .toContainText('1 hr 45 min');
        await detail.getByRole('button', { name: 'Keep browsing' }).click();
        await page.getByTestId('booking-option-warning-dialog')
          .getByRole('button', { name: 'Discard changes' })
          .click();
        await expect(detail).toHaveCount(0);

        await openRussianService(page, layout.search);
        detail = page.getByTestId('service-detail-dialog');
        body = detail.getByTestId('service-detail-scroll-body');
        await detail.getByRole('checkbox', { name: 'French' }).check();
        await scrollToBottom(body);
        await detail.getByRole('button', { name: 'Select service' }).click();
        const summary = page.getByTestId('selected-service-summary');
        await expect(summary).toContainText('1 hr 45 min · From $80 · 1 add-on');

        await summary.getByRole('button', { name: 'Change' }).click();
        detail = page.getByTestId('service-detail-dialog');
        await detail.getByRole('checkbox', { name: 'Chrome' }).check();
        let warning = await openWarning('x');
        await warning.getByRole('button', { name: 'Keep editing' }).click();
        await expect(detail.getByRole('checkbox', { name: 'Chrome' })).toBeChecked();
        await expect(detail.getByRole('button', { name: 'Close service details' }))
          .toBeFocused();

        warning = await openWarning('escape');
        await warning.getByRole('button', { name: 'Keep editing' }).click();
        warning = await openWarning('escape');
        await warning.getByRole('button', { name: 'Discard changes' }).click();
        await expect(summary).toContainText('1 hr 45 min · From $80 · 1 add-on');

        await summary.getByRole('button', { name: 'Change' }).click();
        detail = page.getByTestId('service-detail-dialog');
        await detail.getByRole('checkbox', { name: 'Chrome' }).check();
        warning = await openWarning('backdrop');
        await warning.getByRole('button', { name: 'Keep editing' }).click();
        warning = await openWarning('backdrop');
        await warning.getByRole('button', { name: 'Save changes' }).click();
        await expect(summary).toContainText('1 hr 55 min · From $90 · 2 add-ons');

        await summary.getByRole('button', { name: 'Change' }).click();
        detail = page.getByTestId('service-detail-dialog');
        await detail.getByRole('checkbox', { name: 'Chrome' }).uncheck();
        await scrollToBottom(detail.getByTestId('service-detail-scroll-body'));
        await detail.getByRole('button', { name: 'Continue' }).click();
        const handoff = page.getByTestId('booking-handoff-dialog');
        await expect(handoff).toContainText('Russian Manicure · 1 hr 45 min · From $80');
        await handoff.getByRole('button', { name: 'Back to the menu' }).click();
        await expect(handoff).toHaveCount(0);

        await summary.getByRole('button', { name: 'Continue' }).click();
        const summaryHandoff = page.getByTestId('booking-handoff-dialog');
        await expect(summaryHandoff)
          .toContainText('Russian Manicure · 1 hr 45 min · From $80');
        await summaryHandoff.getByRole('button', { name: 'Back to the menu' }).click();
        await expect(summaryHandoff).toHaveCount(0);

        await summary.getByRole('button', { name: 'Change' }).click();
        detail = page.getByTestId('service-detail-dialog');
        await scrollToBottom(detail.getByTestId('service-detail-scroll-body'));
        await detail.getByRole('button', { name: 'Remove selected service' }).click();
        await expect(summary).toHaveCount(0);

        if (layout.search) {
          const search = renderer.getByRole('searchbox', { name: 'Search services' });
          await search.fill('Complimentary Nail Consultation');
          const shortService = renderer.getByRole('button', {
            name: /Complimentary Nail Consultation/,
          }).first();
          await expect(shortService).toBeVisible();
          await shortService.click();
          detail = page.getByTestId('service-detail-dialog');
          await scrollToBottom(detail.getByTestId('service-detail-scroll-body'));
          await detail.getByRole('button', { name: 'Select service' }).click({ trial: true });
          await detail.getByRole('button', { name: 'Close service details' }).click();
          await renderer.getByRole('button', { name: 'Clear service search' }).click();
          await expect(search).toBeFocused();
          await expect(renderer.getByRole('button', { name: 'Clear service search' }))
            .toHaveCount(0);
          if (layout.id === 'category_menu') {
            const mobileAll = renderer
              .getByRole('navigation', { name: 'Browse service categories' })
              .getByRole('button', { name: /^All/ });
            const desktopAll = renderer
              .getByRole('navigation', { name: 'Service category navigation' })
              .getByRole('button', { name: /^All services/ });
            await (await mobileAll.isVisible() ? mobileAll : desktopAll).click();
          } else {
            await renderer
              .getByRole('group', { name: 'Service categories' })
              .getByRole('button', { name: 'All', exact: true })
              .click();
          }
        } else {
          const shortService = renderer.getByRole('button', {
            name: /Complimentary Nail Consultation/,
          }).first();
          await shortService.scrollIntoViewIfNeeded();
          await shortService.click();
          detail = page.getByTestId('service-detail-dialog');
          await scrollToBottom(detail.getByTestId('service-detail-scroll-body'));
          await detail.getByRole('button', { name: 'Select service' }).click({ trial: true });
          await detail.getByRole('button', { name: 'Close service details' }).click();
        }

        await expect(page.getByTestId('service-detail-dialog')).toHaveCount(0);
        await expect(page.getByTestId('booking-option-warning-dialog')).toHaveCount(0);
        await expect(page.getByTestId('booking-handoff-dialog')).toHaveCount(0);
        expect(await page.evaluate(() => ({
          bodyOverflow: document.body.style.overflow,
          htmlOverflow: document.documentElement.style.overflow,
        }))).toEqual({ bodyOverflow: '', htmlOverflow: '' });
      }

      await page.setViewportSize({ width: 1440, height: 900 });
      for (const device of ['Phone', 'Tablet'] as const) {
        await page.getByRole('group', { name: 'Preview viewport' })
          .getByRole('button', { name: device })
          .click();
        await openRussianService(page, layout.search);
        let detail = page.getByTestId('service-detail-dialog');
        await detail.getByRole('checkbox', { name: 'French' }).check();

        let warning = await openWarning('x');
        await warning.getByRole('button', { name: 'Keep editing' }).click();
        warning = await openWarning('escape');
        await warning.getByRole('button', { name: 'Keep editing' }).click();
        warning = await openWarning('escape');
        await warning.getByRole('button', { name: 'Discard changes' }).click();

        await openRussianService(page, layout.search);
        detail = page.getByTestId('service-detail-dialog');
        await detail.getByRole('checkbox', { name: 'French' }).check();
        warning = await openWarning('backdrop');
        await warning.getByRole('button', { name: 'Keep editing' }).click();
        warning = await openWarning('backdrop');
        await warning.getByRole('button', { name: 'Save changes' }).click();

        const summary = page.getByTestId('selected-service-summary');
        await expect(summary).toContainText('1 hr 45 min · From $80 · 1 add-on');
        await summary.getByRole('button', { name: 'Change' }).click();
        detail = page.getByTestId('service-detail-dialog');
        await scrollToBottom(detail.getByTestId('service-detail-scroll-body'));
        await detail.getByRole('button', { name: 'Remove selected service' }).click();
        if (layout.search) {
          await page.getByTestId('booking-section-preview')
            .getByRole('button', { name: 'Clear service search' })
            .click();
        }
        await expect(page.getByTestId('service-detail-dialog')).toHaveCount(0);
        await expect(page.getByTestId('booking-option-warning-dialog')).toHaveCount(0);
        expect(await page.evaluate(() => ({
          bodyOverflow: document.body.style.overflow,
          htmlOverflow: document.documentElement.style.overflow,
        }))).toEqual({ bodyOverflow: '', htmlOverflow: '' });
      }
    } finally {
      runtime.assertClean();
      runtime.stop();
    }
  });
}
