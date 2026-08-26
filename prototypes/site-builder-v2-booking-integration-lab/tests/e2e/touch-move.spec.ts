import {
  devices,
  expect,
  test,
  type CDPSession,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  chooseStarter,
  openFreshLab,
  openMoveForBooking,
  reorderLabels,
  startRuntimeMonitor,
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
    await expect.poll(() => scroll.evaluate((element) => (
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
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(20);
    await expect(reorderLabels(page)).resolves.toEqual(initialOrder);
    await expect(move.locator('.reorder-row.is-dragging')).toHaveCount(0);

    await scroll.evaluate((element) => {
      element.scrollTop = 0;
    });
    const handle = move.getByRole('button', {
      name: 'Drag Booking. Use arrow keys after lifting with Space.',
    });
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    if (!handleBox) {
      throw new Error('The Booking drag handle has no geometry.');
    }
    const handlePoint = await center(handle);
    await expect(handle).toBeInViewport();
    const nearHandle = {
      x: handleBox.x - 4,
      y: handlePoint.y,
    };
    await trustedTouchGesture(
      page,
      session,
      nearHandle,
      { x: nearHandle.x, y: Math.max(90, nearHandle.y - 150) },
      { moveDuration: 80 },
    );
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(20);
    await expect(reorderLabels(page)).resolves.toEqual(initialOrder);
    await expect(move.locator('.reorder-row.is-dragging')).toHaveCount(0);

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
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(20);
    await expect(reorderLabels(page)).resolves.toEqual(draggedOrder);
    await move.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    runtime.assertClean();
    runtime.stop();
  }
});
