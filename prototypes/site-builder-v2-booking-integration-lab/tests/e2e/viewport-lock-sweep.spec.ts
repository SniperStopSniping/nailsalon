import { expect, test, type Page } from '@playwright/test';

import {
  chooseStarter,
  closeDialog,
  documentSurfaceState,
  expectStickyOwnerToolbarReachable,
  moveSectionToPosition,
  openFreshLab,
  openMoveForBooking,
  startRuntimeMonitor,
  waitForSaved,
} from './helpers';

async function discardDirtyMove(page: Page): Promise<void> {
  const move = await openMoveForBooking(page, 'Home');
  await moveSectionToPosition(move, 'Booking', 1);
  await move.locator('[data-move-target-row="true"]').focus();
  await page.keyboard.press('Escape');
  const warning = page.getByRole('dialog', { name: 'Keep this new order?' });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement;
    return active !== document.body
      && active !== document.documentElement
      && active instanceof HTMLElement
      && active.isConnected;
  })).toBe(true);
}

test('nested Move cleanup stays exact across every required viewport and repeated cycles', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const runtime = startRuntimeMonitor(page);
  try {
    for (const viewport of [
      { width: 320, height: 600 },
      { width: 375, height: 600 },
      { width: 375, height: 500 },
      { width: 920, height: 800 },
      { width: 1180, height: 800 },
      { width: 1440, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await openFreshLab(page);
      await chooseStarter(page, 'Quick Book');
      await waitForSaved(page);
      const baseline = await documentSurfaceState(page);

      await discardDirtyMove(page);
      await expect.poll(() => documentSurfaceState(page)).toEqual(baseline);
      await expectStickyOwnerToolbarReachable(page);
      await page.getByRole('button', { name: 'More site options' }).click();
      await expect(page.getByRole('dialog', { name: 'More' })).toBeVisible();
      await closeDialog(page, 'More');
      await expect.poll(() => documentSurfaceState(page)).toEqual(baseline);
    }

    await page.setViewportSize({ width: 375, height: 600 });
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    await waitForSaved(page);
    const repeatBaseline = await documentSurfaceState(page);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await discardDirtyMove(page);
      await expect.poll(() => documentSurfaceState(page)).toEqual(repeatBaseline);
      await page.getByRole('button', { name: 'More site options' }).click();
      await closeDialog(page, 'More');
      await expect.poll(() => documentSurfaceState(page)).toEqual(repeatBaseline);
    }
  } finally {
    runtime.assertClean();
    runtime.stop();
  }
});
