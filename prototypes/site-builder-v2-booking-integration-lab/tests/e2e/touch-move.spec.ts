import {
  type CDPSession,
  devices,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test';

import {
  bookingCard,
  chooseStarter,
  destinationPageButton,
  LAB_STORAGE_KEY,
  openBookingSettings,
  openFreshLab,
  openMoveForBooking,
  readStoredDocumentJson,
  reorderLabels,
  sectionLabels,
  selectPageFromStructure,
  startRuntimeMonitor,
  waitForSaved,
} from './helpers';

test.use({
  ...devices['Pixel 5'],
  hasTouch: true,
  isMobile: true,
  viewport: { width: 375, height: 600 },
});

test.describe.configure({ mode: 'serial' });

type Point = { x: number; y: number };

async function center(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();

  expect(box, 'touch target has geometry').not.toBeNull();

  if (!box) {
    throw new Error('The touch target has no geometry.');
  }
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

async function sendTouch(
  session: CDPSession,
  type: 'touchCancel' | 'touchEnd' | 'touchMove' | 'touchStart',
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

async function trustedTouchGesture(
  page: Page,
  session: CDPSession,
  start: Point,
  end: Point,
  options: {
    cancel?: boolean;
    holdBeforeMove?: number;
    moveDuration?: number;
    steps?: number;
  } = {},
): Promise<void> {
  const {
    cancel = false,
    holdBeforeMove = 0,
    moveDuration = 120,
    steps = 8,
  } = options;
  await sendTouch(session, 'touchStart', start);
  if (holdBeforeMove > 0) {
    await page.waitForTimeout(holdBeforeMove);
  }
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    await sendTouch(session, 'touchMove', {
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
    });
    if (moveDuration > 0) {
      await page.waitForTimeout(moveDuration / steps);
    }
  }
  await sendTouch(session, cancel ? 'touchCancel' : 'touchEnd');
}

async function trustedTap(
  session: CDPSession,
  point: Point,
): Promise<void> {
  await sendTouch(session, 'touchStart', point);
  await sendTouch(session, 'touchEnd');
}

async function installStorageWriteProbe(page: Page): Promise<void> {
  await page.evaluate((storageKey) => {
    const probe = window as typeof window & {
      __lusterLabOriginalSetItem?: typeof Storage.prototype.setItem;
      __lusterLabWriteCount?: number;
    };
    if (!probe.__lusterLabOriginalSetItem) {
      const original = Storage.prototype.setItem;
      probe.__lusterLabOriginalSetItem = original;
      Storage.prototype.setItem = function setItem(key: string, value: string) {
        if (key === storageKey) {
          probe.__lusterLabWriteCount = (probe.__lusterLabWriteCount ?? 0) + 1;
        }
        return original.call(this, key, value);
      };
    }
    probe.__lusterLabWriteCount = 0;
  }, LAB_STORAGE_KEY);
}

async function storageWriteCount(page: Page): Promise<number> {
  return page.evaluate(() => (
    window as typeof window & { __lusterLabWriteCount?: number }
  ).__lusterLabWriteCount ?? 0);
}

test('trusted touch scrolling does not reorder, while a deliberate handle hold can drag and cancel safely', async ({
  page,
}) => {
  test.setTimeout(90_000);

  const runtime = startRuntimeMonitor(page);
  try {
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    const move = await openMoveForBooking(page, 'Home');
    await move
      .getByRole('button', { name: 'Move Booking to another page' })
      .click();
    const scroll = move.locator('.section-move-panel__scroll');

    await expect.poll(() => scroll.evaluate(element => (
      element.scrollHeight > element.clientHeight
    ))).toBe(true);

    const session = await page.context().newCDPSession(page);
    const initialOrder = await reorderLabels(page);

    const rowBody = move
      .getByRole('button', { name: /Booking Keeps booking available/ })
      .first();
    const rowStart = await center(rowBody);
    await trustedTouchGesture(
      page,
      session,
      rowStart,
      { x: rowStart.x, y: Math.max(90, rowStart.y - 180) },
      { moveDuration: 90 },
    );

    await expect.poll(() => scroll.evaluate(element => element.scrollTop))
      .toBeGreaterThan(20);
    await expect(reorderLabels(page)).resolves.toEqual(initialOrder);
    await expect(move.locator('.reorder-row.is-dragging')).toHaveCount(0);

    await scroll.evaluate((element) => {
      element.scrollTop = 0;
    });
    const handle = move.getByRole('button', {
      name: 'Drag Booking. Use arrow keys after lifting with Space.',
    });
    for (const holdBeforeMove of [0, 60, 135]) {
      await scroll.evaluate((element) => {
        element.scrollTop = 0;
      });
      const handlePoint = await center(handle);

      await expect(handle).toBeInViewport();

      await trustedTouchGesture(
        page,
        session,
        handlePoint,
        { x: handlePoint.x, y: Math.max(90, handlePoint.y - 150) },
        { holdBeforeMove, moveDuration: 80 },
      );

      await expect.poll(() => scroll.evaluate(element => element.scrollTop))
        .toBeGreaterThan(20);
      await expect(reorderLabels(page)).resolves.toEqual(initialOrder);
      await expect(move.locator('.reorder-row.is-dragging')).toHaveCount(0);
    }

    await move
      .getByRole('button', { name: 'Move Booking to another page' })
      .click();
    await scroll.evaluate((element) => {
      element.scrollTop = 0;
    });
    const firstRow = move.locator('.reorder-row').first();

    await expect(firstRow).toBeInViewport();

    const firstRowBox = await firstRow.boundingBox();

    expect(firstRowBox).not.toBeNull();

    if (!firstRowBox) {
      throw new Error('The first reorder row has no geometry.');
    }
    const targetPoint = {
      x: firstRowBox.x + firstRowBox.width / 2,
      y: firstRowBox.y + 8,
    };
    const refreshedHandlePoint = await center(handle);

    await expect(handle).toBeInViewport();

    await trustedTouchGesture(
      page,
      session,
      refreshedHandlePoint,
      { x: refreshedHandlePoint.x, y: targetPoint.y },
      { holdBeforeMove: 230, moveDuration: 240, steps: 12 },
    );

    await expect.poll(() => reorderLabels(page)).not.toEqual(initialOrder);

    const draggedOrder = await reorderLabels(page);

    expect(draggedOrder[0]).toBe('Booking');
    await expect(move.locator('.reorder-row.is-dragging')).toHaveCount(0);

    const movedHandle = move.getByRole('button', {
      name: 'Drag Booking. Use arrow keys after lifting with Space.',
    });
    const movedHandlePoint = await center(movedHandle);
    const lastRowPoint = await center(move.locator('.reorder-row').last());
    await trustedTouchGesture(
      page,
      session,
      movedHandlePoint,
      { x: movedHandlePoint.x, y: lastRowPoint.y },
      {
        cancel: true,
        holdBeforeMove: 230,
        moveDuration: 160,
        steps: 8,
      },
    );

    await expect(reorderLabels(page)).resolves.toEqual(draggedOrder);
    await expect(move.locator('.reorder-row.is-dragging')).toHaveCount(0);

    await move
      .getByRole('button', { name: 'Move Booking to another page' })
      .click();
    await scroll.evaluate((element) => {
      element.scrollTop = 0;
    });
    const recoveryStart = await center(rowBody);
    await trustedTouchGesture(
      page,
      session,
      recoveryStart,
      { x: recoveryStart.x, y: Math.max(90, recoveryStart.y - 160) },
      { moveDuration: 90 },
    );

    await expect.poll(() => scroll.evaluate(element => element.scrollTop))
      .toBeGreaterThan(20);
    await expect(reorderLabels(page)).resolves.toEqual(draggedOrder);

    await move.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    runtime.assertClean();
    runtime.stop();
  }
});

test('trusted rapid double-tap on Done commits once without touching the control beneath it', async ({
  page,
}) => {
  test.setTimeout(60_000);

  const runtime = startRuntimeMonitor(page);
  try {
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    await waitForSaved(page);
    const baselineJson = await readStoredDocumentJson(page);
    await installStorageWriteProbe(page);
    const move = await openMoveForBooking(page, 'Home');
    const position = move.getByLabel('Position for Booking');
    await position.fill('1');
    await position.press('Enter');
    const done = move.getByRole('button', { name: 'Done', exact: true });
    const point = await center(done);
    const session = await page.context().newCDPSession(page);

    await sendTouch(session, 'touchStart', point);
    await sendTouch(session, 'touchEnd');
    await page.waitForTimeout(24);
    await sendTouch(session, 'touchStart', point);
    await sendTouch(session, 'touchEnd');

    await expect(move).toHaveCount(0);

    const moreButton = page.getByRole('button', { name: 'More site options' });
    await trustedTap(session, await center(moreButton));
    const more = page.getByRole('dialog', { name: 'More' });

    await expect(more).toBeVisible();

    await waitForSaved(page);
    await page.waitForTimeout(1_000);

    expect(await storageWriteCount(page)).toBe(1);

    const committedJson = await readStoredDocumentJson(page);

    expect(committedJson).not.toBe(baselineJson);
    await expect(sectionLabels(page, 'Home')).resolves.toEqual([
      'Booking',
      'Announcement Bar',
      'Salon intro',
      'Featured Services',
      'Final Booking CTA',
      'Footer',
    ]);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(more).toBeVisible();
    await expect(page.locator('.toast')).toHaveCount(1);
    await expect(page.locator('.toast')).toContainText('Section order saved.');
    await expect(bookingCard(page, 'Home')).toHaveClass(/is-selected/);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);

    await more.getByRole('button', { name: 'Undo', exact: true }).click();
    await waitForSaved(page);

    expect(await readStoredDocumentJson(page)).toBe(baselineJson);
    await expect(more.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  } finally {
    runtime.assertClean();
    runtime.stop();
  }
});

test('trusted touch keeps hidden-settings controls distinct and same-device activation silent', async ({
  page,
}) => {
  test.setTimeout(60_000);

  const runtime = startRuntimeMonitor(page);
  try {
    await page.setViewportSize({ width: 920, height: 800 });
    await openFreshLab(page);
    const contrast = await page.locator('.final-starter-disclaimer').evaluate((element) => {
      const channels = (color: string) => color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
      const linear = (channel: number) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (color: string) => {
        const [red = 0, green = 0, blue = 0] = channels(color);
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
      };
      const foreground = luminance(getComputedStyle(element).color);
      let backgroundElement: Element | null = element;
      let backgroundColor = 'rgb(255, 255, 255)';
      while (backgroundElement) {
        const candidate = getComputedStyle(backgroundElement).backgroundColor;
        if (candidate !== 'rgba(0, 0, 0, 0)' && candidate !== 'transparent') {
          backgroundColor = candidate;
          break;
        }
        backgroundElement = backgroundElement.parentElement;
      }
      const background = luminance(backgroundColor);
      return (Math.max(foreground, background) + 0.05)
        / (Math.min(foreground, background) + 0.05);
    });

    expect(contrast).toBeGreaterThanOrEqual(4.5);
    expect(await page.evaluate(() => window.devicePixelRatio)).toBeGreaterThan(1);

    await chooseStarter(page, 'Quick Book');
    const session = await page.context().newCDPSession(page);
    const { settings } = await openBookingSettings(page, 'Home');
    await trustedTap(session, await center(settings.getByRole('button', { name: 'Hide settings' })));

    await expect(settings).toBeHidden();

    const toolbar = page.getByTestId('selected-section-toolbar');
    const edit = toolbar.getByRole('button', { name: 'Edit', exact: true });
    await trustedTap(session, await center(edit));

    await expect(settings).toBeVisible();

    await trustedTap(session, await center(settings.getByRole('button', { name: 'Hide settings' })));
    const collapse = toolbar.getByRole('button', { name: 'Collapse', exact: true });
    if (await collapse.isVisible()) {
      await trustedTap(session, await center(collapse));
    }
    const expand = toolbar.getByRole('button', { name: 'Expand', exact: true });
    await trustedTap(session, await center(expand));
    const moreButton = toolbar.getByRole('button', { name: 'More', exact: true });
    await trustedTap(session, await center(moreButton));
    const actions = page.getByRole('dialog', { name: 'Booking actions' });

    await expect(actions).toBeVisible();

    await actions.getByRole('button', { name: 'Close Booking actions' }).click();

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const phone = page.getByRole('group', { name: 'Preview viewport' })
      .getByRole('button', { name: 'Phone' });
    await trustedTap(session, await center(phone));
    const liveRegion = page.getByTestId('preview-viewport-announcement');

    await expect(liveRegion).toContainText('Phone preview selected');

    await page.evaluate(() => {
      const probe = window as typeof window & { __sameDeviceMutations?: number };
      probe.__sameDeviceMutations = 0;
      const region = document.querySelector('[data-testid="preview-viewport-announcement"]');
      if (region) {
        new MutationObserver(() => {
          probe.__sameDeviceMutations = (probe.__sameDeviceMutations ?? 0) + 1;
        })
          .observe(region, { characterData: true, childList: true, subtree: true });
      }
    });
    await trustedTap(session, await center(phone));
    await page.waitForTimeout(350);

    expect(await page.evaluate(() => (
      window as typeof window & { __sameDeviceMutations?: number }
    ).__sameDeviceMutations)).toBe(0);
    await expect(phone).toHaveAttribute('aria-pressed', 'true');
  } finally {
    runtime.assertClean();
    runtime.stop();
  }
});

test('trusted rapid double-tap commits cross-page and create-page movement only once', async ({
  page,
}) => {
  test.setTimeout(90_000);

  const runtime = startRuntimeMonitor(page);
  try {
    for (const path of ['cross-page', 'create-page'] as const) {
      await openFreshLab(page);
      await chooseStarter(page, path === 'cross-page' ? 'Multi-page website' : 'Quick Book');
      await waitForSaved(page);
      if (path === 'cross-page') {
        await selectPageFromStructure(page, 'Services / Book');
      }
      const sourcePage = path === 'cross-page' ? 'Services / Book' : 'Home';
      const baselineJson = await readStoredDocumentJson(page);
      await installStorageWriteProbe(page);
      const move = await openMoveForBooking(page, sourcePage);
      await move.getByRole('button', { name: 'Move Booking to another page' }).click();
      if (path === 'cross-page') {
        await destinationPageButton(move, 'Home').click();
        await move.getByRole('combobox', { name: 'Position on Home' }).selectOption('1');
      } else {
        await move.getByPlaceholder('Page name').fill('Touch portfolio');
        await move.getByRole('button', { name: 'Create page and move' }).click();
      }
      const session = await page.context().newCDPSession(page);
      const point = await center(move.getByRole('button', { name: 'Done', exact: true }));
      await trustedTap(session, point);
      await page.waitForTimeout(24);
      await trustedTap(session, point);

      await expect(move).toHaveCount(0);

      const prompt = page.getByRole('dialog', { name: 'Add a menu?' });
      let more: Locator | null = null;
      if (path === 'create-page') {
        await expect(prompt).toBeVisible();

        await trustedTap(session, await center(prompt.getByRole('button', { name: 'Not now' })));

        await expect(prompt).toHaveCount(0);
      } else {
        await trustedTap(
          session,
          await center(page.getByRole('button', { name: 'More site options' })),
        );
        more = page.getByRole('dialog', { name: 'More' });

        await expect(more).toBeVisible();
      }
      await waitForSaved(page);
      await page.waitForTimeout(1_000);

      expect(await storageWriteCount(page)).toBe(1);

      const committedJson = await readStoredDocumentJson(page);

      expect(committedJson).not.toBe(baselineJson);

      const destination = path === 'cross-page' ? 'Home' : 'Touch portfolio';

      await expect(sectionLabels(page, destination)).resolves.toContain('Booking');
      await expect(page.getByRole('dialog')).toHaveCount(path === 'cross-page' ? 1 : 0);
      await expect(page.locator('.toast')).toHaveCount(1);
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);

      if (!more) {
        await trustedTap(
          session,
          await center(page.getByRole('button', { name: 'More site options' })),
        );
        more = page.getByRole('dialog', { name: 'More' });
      }

      await expect(more).toBeVisible();

      await more.getByRole('button', { name: 'Undo', exact: true }).click();
      await waitForSaved(page);

      expect(await readStoredDocumentJson(page)).toBe(baselineJson);
      await expect(more.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();

      await more.getByRole('button', { name: 'Close More' }).click();
      await session.detach();
    }
  } finally {
    runtime.assertClean();
    runtime.stop();
  }
});
