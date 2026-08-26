import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  bookingCard,
  chooseStarter,
  closeDialog,
  destinationPageButton,
  documentSurfaceState,
  expectNoDocumentOverflow,
  expectStickyOwnerToolbarReachable,
  LAB_STORAGE_KEY,
  moveSectionToPosition,
  openBookingSettings,
  openFreshLab,
  openMoveForBooking,
  openMoveForBookingVia,
  openMoveFromStructure,
  openPagesAndStructure,
  pageNames,
  readStoredDocument,
  readStoredDocumentJson,
  reorderLabels,
  sectionLabels,
  sectionsList,
  selectPageFromStructure,
  startRuntimeMonitor,
  waitForSaved,
} from './helpers';

type MoveDismissal = 'backdrop' | 'escape' | 'x';
type MoveResolution = 'Discard changes' | 'Keep order';

test.describe.configure({ mode: 'serial' });

let runtimeMonitor: ReturnType<typeof startRuntimeMonitor>;

test.beforeEach(async ({ page }) => {
  runtimeMonitor = startRuntimeMonitor(page);
});

test.afterEach(async () => {
  runtimeMonitor.assertClean();
  runtimeMonitor.stop();
});

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

async function enableRealHeightSimulation(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More site options' }).click();
  const more = page.getByRole('dialog', { name: 'More' });
  const simulation = more.getByRole('switch', {
    name: 'Simulate real section heights',
  });
  if ((await simulation.getAttribute('aria-checked')) !== 'true') {
    await simulation.click();
  }
  await closeDialog(page, 'More');
}

async function runHistoryAction(
  page: Page,
  action: 'Redo' | 'Undo',
): Promise<void> {
  const topbarAction = page
    .getByRole('banner', { name: 'Site builder toolbar' })
    .getByRole('button', { name: action, exact: true });
  if (await topbarAction.isVisible()) {
    await topbarAction.click();
    return;
  }
  await page.getByRole('button', { name: 'More site options' }).click();
  const more = page.getByRole('dialog', { name: 'More' });
  await more.getByRole('button', { name: action, exact: true }).click();
  await closeDialog(page, 'More');
}

async function dirtyMoveBooking(move: Locator): Promise<void> {
  await moveSectionToPosition(move, 'Booking', 1);
  await expect(move.getByText('Order not saved yet', { exact: true })).toBeVisible();
}

async function dismissMove(
  page: Page,
  move: Locator,
  mechanism: MoveDismissal,
): Promise<void> {
  if (mechanism === 'escape') {
    await move.locator('[data-move-target-row="true"]').focus();
    await page.keyboard.press('Escape');
    return;
  }
  if (mechanism === 'x') {
    await move.getByRole('button', { name: 'Close Move Booking' }).click();
    return;
  }
  const backdrop = page
    .getByTestId('dialog-backdrop')
    .filter({ has: move });
  await backdrop.click({ position: { x: 3, y: 3 } });
}

async function expectFocusOutsideDocumentRoot(page: Page): Promise<void> {
  const focus = await page.evaluate(() => ({
    body: document.activeElement === document.body,
    connected: document.activeElement instanceof HTMLElement
      ? document.activeElement.isConnected
      : false,
    html: document.activeElement === document.documentElement,
  }));
  expect(focus).toEqual({ body: false, connected: true, html: false });
}

async function expectBookingMoveFocusRestored(
  page: Page,
  pageName = 'Home',
): Promise<void> {
  const sectionId = await bookingCard(page, pageName).getAttribute(
    'data-section-instance-id',
  );
  expect(sectionId).not.toBeNull();
  await expect.poll(() => page.evaluate((expectedSectionId) => {
    const active = document.activeElement as HTMLElement | null;
    const describe = (candidate: HTMLElement) => {
      const style = window.getComputedStyle(candidate);
      const hiddenAncestor = candidate.closest<HTMLElement>(
        '[aria-hidden="true"], [hidden], [inert]',
      );
      return {
        ariaHidden: candidate.getAttribute('aria-hidden'),
        disabled: candidate.matches(':disabled'),
        display: style.display,
        hiddenAncestor: hiddenAncestor
          ? {
              ariaHidden: hiddenAncestor.getAttribute('aria-hidden'),
              className: hiddenAncestor.className,
              hidden: hiddenAncestor.hasAttribute('hidden'),
              inert: hiddenAncestor.hasAttribute('inert'),
              tagName: hiddenAncestor.tagName,
            }
          : null,
        inert: candidate.hasAttribute('inert'),
        restored: candidate.getAttribute('data-restored-focus'),
        tagName: candidate.tagName,
        visibility: style.visibility,
      };
    };
    const moveSectionId = active?.getAttribute('data-move-trigger-for') ?? null;
    const returnSectionId = active?.getAttribute('data-section-return-for') ?? null;
    const containingSectionId = active?.closest('[data-section-instance-id]')
      ?.getAttribute('data-section-instance-id') ?? null;
    const details = {
      belongsToBooking: moveSectionId === expectedSectionId
        || returnSectionId === expectedSectionId
        || containingSectionId === expectedSectionId,
      containingSectionId,
      expectedSectionId,
      moveSectionId,
      returnSectionId,
      restored: active?.getAttribute('data-restored-focus') === 'true',
      tagName: active?.tagName ?? null,
      text: active?.textContent?.trim().slice(0, 80) ?? null,
    };
    const moveControls = [...document.querySelectorAll<HTMLElement>(
      '[data-move-trigger-for]',
    )]
      .filter((candidate) => (
        candidate.getAttribute('data-move-trigger-for') === expectedSectionId
      ))
      .map(describe);
    const sectionSurfaces = [...document.querySelectorAll<HTMLElement>(
      '[data-section-instance-id]',
    )]
      .filter((candidate) => (
        candidate.getAttribute('data-section-instance-id') === expectedSectionId
      ))
      .flatMap((candidate) => {
        const surface = candidate.querySelector<HTMLElement>('.section-card__select-surface');
        return surface ? [describe(surface)] : [];
      });
    const topbarPage = document.querySelector<HTMLElement>('.final-topbar__page');
    const editor = document.querySelector<HTMLElement>('[data-testid="final-hybrid-editor"]');
    const liveRegion = document.querySelector<HTMLElement>('[data-testid="reorder-live-region"]');
    return details.belongsToBooking && details.restored
      ? 'restored'
      : JSON.stringify({
          active: details,
          editor: editor
            ? {
                ariaHidden: editor.getAttribute('aria-hidden'),
                inert: editor.hasAttribute('inert'),
              }
            : null,
          liveRegion: liveRegion?.textContent ?? null,
          moveControls,
          sectionSurfaces,
          topbarPage: topbarPage ? describe(topbarPage) : null,
        });
  }, sectionId)).toBe('restored');
  await expectFocusOutsideDocumentRoot(page);
}

async function selectPlaceholder(
  page: Page,
  pageName: string,
  sectionName: string,
): Promise<void> {
  const card = sectionsList(page, pageName).getByRole('listitem', {
    name: `${sectionName} on ${pageName}`,
  });
  await card.locator('.section-card__select-surface').click();
  await expect(card).toHaveClass(/is-selected/);
}

async function openMoveForPlaceholder(
  page: Page,
  pageName: string,
  sectionName: string,
): Promise<Locator> {
  await selectPlaceholder(page, pageName, sectionName);
  const actions = page.getByRole('group', { name: `${sectionName} actions` });
  await actions.getByRole('button', { name: 'Move', exact: true }).click();
  const move = page.getByRole('dialog', { name: `Move ${sectionName}` });
  await expect(move).toBeVisible();
  return move;
}

async function setPageVisibility(
  page: Page,
  pageName: string,
  change: 'hidden' | 'not-in-navigation',
): Promise<void> {
  const structure = await openPagesAndStructure(page);
  await structure
    .getByRole('button', { name: `Page settings for ${pageName}` })
    .click();
  const settings = page.getByRole('dialog', { name: `${pageName} settings` });
  const toggle = settings.getByRole('switch', {
    exact: true,
    name: change === 'hidden' ? 'Show page' : 'Show page in menu',
  });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await settings.getByRole('button', { name: 'Save page' }).click();
  await expect(settings).toHaveCount(0);
  await waitForSaved(page);
}

async function runDirtyDismissalMatrix(
  page: Page,
  scenario: {
    entry: 'desktop' | 'mobile';
    viewport: { height: number; width: number };
  },
): Promise<void> {
  const mechanisms: MoveDismissal[] = ['escape', 'x', 'backdrop'];
  const resolutions: MoveResolution[] = ['Keep order', 'Discard changes'];
  await page.setViewportSize(scenario.viewport);
  for (const mechanism of mechanisms) {
    for (const resolution of resolutions) {
      await test.step(`${scenario.entry}: ${mechanism} → ${resolution}`, async () => {
        await openFreshLab(page);
        await chooseStarter(page, 'Quick Book');
        await waitForSaved(page);
        await enableRealHeightSimulation(page);
        const baselineSurface = await documentSurfaceState(page);
        const { move } = await openMoveForBookingVia(
          page,
          'Home',
          scenario.entry,
        );
        await dirtyMoveBooking(move);
        await expect.poll(async () => (await documentSurfaceState(page)).body.overflow)
          .toBe('hidden');

        await dismissMove(page, move, mechanism);
        const warning = page.getByRole('dialog', { name: 'Keep this new order?' });
        await expect(warning).toBeVisible();
        await warning.getByRole('button', { name: resolution }).click();

        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect.poll(() => documentSurfaceState(page)).toEqual(baselineSurface);
        await expectBookingMoveFocusRestored(page);
        await expectStickyOwnerToolbarReachable(page);

        await page.getByRole('button', { name: 'More site options' }).click();
        const more = page.getByRole('dialog', { name: 'More' });
        await expect(more).toBeVisible();
        await expect(more.getByRole('button', { name: 'Undo' })).toBeVisible();
        await expect(more.getByRole('button', { name: 'Redo' })).toBeVisible();
        await closeDialog(page, 'More');
        await expect.poll(() => documentSurfaceState(page)).toEqual(baselineSurface);
      });
    }
  }
}

test('mobile dirty Move Escape/X/backdrop Keep+Discard releases locks and restores focus', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await runDirtyDismissalMatrix(page, {
    entry: 'mobile',
    viewport: { width: 375, height: 600 },
  });
});

test('desktop dirty Move Escape/X/backdrop Keep+Discard releases locks and restores focus', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await runDirtyDismissalMatrix(page, {
    entry: 'desktop',
    viewport: { width: 1180, height: 800 },
  });
});

test('dismissing the dirty warning returns to Move without rebalancing its lock', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 500 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await waitForSaved(page);
  const baselineSurface = await documentSurfaceState(page);

  for (const mechanism of ['escape', 'x'] as const) {
    const move = await openMoveForBooking(page, 'Home');
    await dirtyMoveBooking(move);
    await move.getByRole('button', { name: 'Close Move Booking' }).click();
    const warning = page.getByRole('dialog', { name: 'Keep this new order?' });
    await expect(warning).toBeVisible();
    if (mechanism === 'escape') {
      await page.keyboard.press('Escape');
    } else {
      await warning
        .getByRole('button', { name: 'Close Keep this new order?' })
        .click();
    }
    await expect(warning).toHaveCount(0);
    await expect(move).toBeVisible();
    await expect.poll(async () => (await documentSurfaceState(page)).body.overflow)
      .toBe('hidden');
    await move.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect.poll(() => documentSurfaceState(page)).toEqual(baselineSurface);
  }
});

test('Pages & Structure uses the same dirty Keep and Discard lifecycle', async ({
  page,
}) => {
  await page.setViewportSize({ width: 920, height: 800 });
  for (const resolution of ['Keep order', 'Discard changes'] as const) {
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    await waitForSaved(page);
    const baselineSurface = await documentSurfaceState(page);
    const move = await openMoveFromStructure(page);
    await moveSectionToPosition(move, 'Booking', 1);
    await move.locator('[data-move-target-row="true"]').focus();
    await page.keyboard.press('Escape');
    const warning = page.getByRole('dialog', { name: 'Keep this new order?' });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: resolution }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => documentSurfaceState(page)).toEqual(baselineSurface);
    await expectFocusOutsideDocumentRoot(page);
  }
});

test('native Multi-page destination selection and same-page ordering stay staged until Cancel or Done', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 600 });
  await openFreshLab(page);
  await chooseStarter(page, 'Multi-page website');
  await waitForSaved(page);
  await selectPageFromStructure(page, 'Services / Book');
  await page.getByRole('button', { name: 'Add section', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'Add section' });
  await library.getByRole('button', { name: 'Add Section 08' }).click();
  await expect(library).toHaveCount(0);
  await waitForSaved(page);
  await expect(sectionLabels(page, 'Services / Book')).resolves.toEqual([
    'Section 03',
    'Booking',
    'Section 08',
  ]);
  const baselineJson = await readStoredDocumentJson(page);
  await installStorageWriteProbe(page);

  let move = await openMoveForBooking(page, 'Services / Book');
  await move.getByRole('button', { name: 'Move Section 03 down' }).click();
  await expect(move).toHaveAccessibleName('Move Booking');
  await expect(
    move.getByRole('button', { name: 'Move Booking to another page' }),
  ).toBeVisible();
  await move
    .getByRole('button', { name: 'Move Booking to another page' })
    .click();
  await destinationPageButton(move, 'Home').click();
  await expect(move.getByRole('region', { name: 'Staged destination' }))
    .toContainText('Home');
  await expect(move.getByText('Order not saved yet', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Services / Book' }),
  ).toBeVisible();
  await expect(reorderLabels(page)).resolves.toEqual([
    'Booking',
    'Section 03',
    'Section 08',
  ]);
  await page.waitForTimeout(240);
  expect(await readStoredDocumentJson(page)).toBe(baselineJson);
  expect(await storageWriteCount(page)).toBe(0);

  await destinationPageButton(move, 'Services / Book').click();
  await expect(move.getByRole('region', { name: 'Staged destination' })).toHaveCount(0);
  await destinationPageButton(move, 'Contact').click();
  await expect(move.getByRole('region', { name: 'Staged destination' }))
    .toContainText('Contact');
  await move.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(sectionLabels(page, 'Services / Book')).resolves.toEqual([
    'Section 03',
    'Booking',
    'Section 08',
  ]);
  expect(await readStoredDocumentJson(page)).toBe(baselineJson);
  expect(await storageWriteCount(page)).toBe(0);

  await runHistoryAction(page, 'Undo');
  await waitForSaved(page);
  await expect(sectionLabels(page, 'Services / Book')).resolves.toEqual([
    'Section 03',
    'Booking',
  ]);
  await runHistoryAction(page, 'Redo');
  await waitForSaved(page);
  expect(await readStoredDocumentJson(page)).toBe(baselineJson);
  await expect(sectionLabels(page, 'Services / Book')).resolves.toEqual([
    'Section 03',
    'Booking',
    'Section 08',
  ]);
  await installStorageWriteProbe(page);

  move = await openMoveForBooking(page, 'Services / Book');
  await moveSectionToPosition(move, 'Section 08', 1);
  await move
    .getByRole('button', { name: 'Move Booking to another page' })
    .click();
  await destinationPageButton(move, 'Home').click();
  await move
    .getByRole('combobox', { name: 'Position on Home' })
    .selectOption('1');
  await move.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Booking',
    'Section 01',
    'Section 02',
  ]);
  await waitForSaved(page);
  expect(await storageWriteCount(page)).toBe(1);
  const committedJson = await readStoredDocumentJson(page);
  expect(committedJson).not.toBe(baselineJson);
  await expectBookingMoveFocusRestored(page, 'Home');
  await selectPageFromStructure(page, 'Services / Book');
  await expect(sectionLabels(page, 'Services / Book')).resolves.toEqual([
    'Section 08',
    'Section 03',
  ]);
  await selectPageFromStructure(page, 'Home');

  await runHistoryAction(page, 'Undo');
  await waitForSaved(page);
  expect(await readStoredDocumentJson(page)).toBe(baselineJson);
  await selectPageFromStructure(page, 'Services / Book');
  await expect(sectionLabels(page, 'Services / Book')).resolves.toEqual([
    'Section 03',
    'Booking',
    'Section 08',
  ]);
  await runHistoryAction(page, 'Redo');
  await waitForSaved(page);
  expect(await readStoredDocumentJson(page)).toBe(committedJson);
  await page.reload();
  await selectPageFromStructure(page, 'Home');
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Booking',
    'Section 01',
    'Section 02',
  ]);
});

test('dirty cross-page Keep commits atomically and Discard restores atomically', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 600 });
  for (const resolution of ['Discard changes', 'Keep order'] as const) {
    await openFreshLab(page);
    await chooseStarter(page, 'Multi-page website');
    await waitForSaved(page);
    await selectPageFromStructure(page, 'Services / Book');
    const baselineJson = await readStoredDocumentJson(page);
    await installStorageWriteProbe(page);
    const move = await openMoveForBooking(page, 'Services / Book');
    await move
      .getByRole('button', { name: 'Move Booking to another page' })
      .click();
    await destinationPageButton(move, 'Home').click();
    await move.getByRole('button', { name: 'Close Move Booking' }).click();
    const warning = page.getByRole('dialog', { name: 'Keep this new order?' });
    await expect(warning).toContainText('Booking will move to Home');
    await warning.getByRole('button', { name: resolution }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (resolution === 'Discard changes') {
      await expectBookingMoveFocusRestored(page, 'Services / Book');
      await page.waitForTimeout(240);
      expect(await readStoredDocumentJson(page)).toBe(baselineJson);
      expect(await storageWriteCount(page)).toBe(0);
      await expect(sectionLabels(page, 'Services / Book')).resolves.toEqual([
        'Section 03',
        'Booking',
      ]);
    } else {
      await expectBookingMoveFocusRestored(page, 'Home');
      await waitForSaved(page);
      expect(await storageWriteCount(page)).toBe(1);
      await expect(sectionLabels(page, 'Home')).resolves.toEqual([
        'Section 01',
        'Section 02',
        'Booking',
      ]);
    }
  }
});

for (const scenario of [
  {
    activation: 'mouse-double' as const,
    height: 600,
    label: 'mouse double-click',
    width: 375,
  },
  {
    activation: 'mouse-triple' as const,
    height: 800,
    label: 'mouse triple-click',
    width: 920,
  },
  {
    activation: 'enter-double' as const,
    height: 800,
    label: 'Enter twice',
    width: 1180,
  },
  {
    activation: 'enter-triple' as const,
    height: 900,
    label: 'Enter three times',
    width: 1440,
  },
  {
    activation: 'space-double' as const,
    height: 800,
    label: 'Space twice',
    width: 1024,
  },
  {
    activation: 'mouse-enter' as const,
    height: 800,
    label: 'mouse then Enter',
    width: 920,
  },
  {
    activation: 'enter-mouse' as const,
    height: 600,
    label: 'Enter then mouse',
    width: 375,
  },
]) {
  test(`rapid ${scenario.label} on Done produces one mutation, write, message, and history operation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    await waitForSaved(page);
    const baselineJson = await readStoredDocumentJson(page);
    await installStorageWriteProbe(page);
    const move = await openMoveForBooking(page, 'Home');
    await dirtyMoveBooking(move);
    const done = move.getByRole('button', { name: 'Done', exact: true });

    if (scenario.activation === 'enter-mouse') {
      const doneBox = await done.boundingBox();
      expect(doneBox).not.toBeNull();
      if (!doneBox) {
        throw new Error('Done has no clickable geometry.');
      }
      await done.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(120);
      await page.mouse.click(
        doneBox.x + doneBox.width / 2,
        doneBox.y + doneBox.height / 2,
      );
    } else if (scenario.activation.startsWith('mouse')) {
      const doneBox = await done.boundingBox();
      expect(doneBox).not.toBeNull();
      if (!doneBox) {
        throw new Error('Done has no clickable geometry.');
      }
      await page.mouse.click(
        doneBox.x + doneBox.width / 2,
        doneBox.y + doneBox.height / 2,
        {
          clickCount: scenario.activation === 'mouse-triple'
            ? 3
            : scenario.activation === 'mouse-enter'
              ? 1
              : 2,
          delay: 12,
        },
      );
      if (scenario.activation === 'mouse-enter') {
        await page.keyboard.press('Enter');
      }
    } else {
      await done.focus();
      const key = scenario.activation === 'space-double' ? 'Space' : 'Enter';
      const repetitions = scenario.activation === 'enter-triple' ? 3 : 2;
      for (let press = 0; press < repetitions; press += 1) {
        await page.keyboard.press(key);
      }
    }

    await expect(move).toHaveCount(0);
    if (scenario.activation === 'mouse-double') {
      await expectBookingMoveFocusRestored(page, 'Home');
      await page.evaluate(() => {
        const probe = window as typeof window & { __rapidNormalClick?: boolean };
        probe.__rapidNormalClick = false;
        document.addEventListener('click', () => {
          probe.__rapidNormalClick = true;
        }, { capture: true, once: true });
      });
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.tagName)).toMatch(/^(A|BUTTON)$/);
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => (
        window as typeof window & { __rapidNormalClick?: boolean }
      ).__rapidNormalClick)).toBe(true);
      if (await page.getByRole('dialog').count()) {
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }
    }
    await waitForSaved(page);
    await page.waitForTimeout(1_000);
    expect(await storageWriteCount(page)).toBe(1);
    const committedJson = await readStoredDocumentJson(page);
    expect(committedJson).not.toBe(baselineJson);
    await expect(sectionLabels(page, 'Home')).resolves.toEqual([
      'Booking',
      'Section 01',
      'Section 02',
    ]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.toast')).toHaveCount(1);
    await expect(page.locator('.toast')).toContainText('Section order saved.');
    await expect(bookingCard(page, 'Home')).toHaveClass(/is-selected/);
    if (scenario.activation === 'mouse-double') {
      await expectFocusOutsideDocumentRoot(page);
    } else {
      await expectBookingMoveFocusRestored(page, 'Home');
    }

    await runHistoryAction(page, 'Undo');
    await waitForSaved(page);
    expect(await readStoredDocumentJson(page)).toBe(baselineJson);
    await expect(page.locator('button[aria-label="Undo"]')).toBeDisabled();
    await runHistoryAction(page, 'Redo');
    await waitForSaved(page);
    expect(await readStoredDocumentJson(page)).toBe(committedJson);
  });
}

test('rapid repeated Enter commits a cross-page Move exactly once', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openFreshLab(page);
  await chooseStarter(page, 'Multi-page website');
  await waitForSaved(page);
  await selectPageFromStructure(page, 'Services / Book');
  const baselineJson = await readStoredDocumentJson(page);
  await installStorageWriteProbe(page);
  const move = await openMoveForBooking(page, 'Services / Book');
  await move.getByRole('button', { name: 'Move Booking to another page' }).click();
  await destinationPageButton(move, 'Home').click();
  await move.getByRole('combobox', { name: 'Position on Home' }).selectOption('1');
  const done = move.getByRole('button', { name: 'Done', exact: true });
  await done.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  await expect(move).toHaveCount(0);
  await waitForSaved(page);
  await page.waitForTimeout(1_000);
  expect(await storageWriteCount(page)).toBe(1);
  const committedJson = await readStoredDocumentJson(page);
  expect(committedJson).not.toBe(baselineJson);
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Booking',
    'Section 01',
    'Section 02',
  ]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveCount(1);
  await expect(page.locator('.toast')).toContainText('Booking moved to Home.');
  await expectBookingMoveFocusRestored(page, 'Home');

  await runHistoryAction(page, 'Undo');
  await waitForSaved(page);
  expect(await readStoredDocumentJson(page)).toBe(baselineJson);
  await expect(page.locator('button[aria-label="Undo"]')).toBeDisabled();
});

test('rapid repeated Enter creates a page and moves once without dismissing the navigation prompt', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 600 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await waitForSaved(page);
  const baselineJson = await readStoredDocumentJson(page);
  await installStorageWriteProbe(page);
  const move = await openMoveForBooking(page, 'Home');
  await move.getByRole('button', { name: 'Move Booking to another page' }).click();
  await move.getByPlaceholder('Page name').fill('Rapid portfolio');
  await move.getByRole('button', { name: 'Create page and move' }).click();
  const done = move.getByRole('button', { name: 'Done', exact: true });
  await done.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  await expect(move).toHaveCount(0);
  const menuPrompt = page.getByRole('dialog', { name: 'Add a menu?' });
  await expect(menuPrompt).toBeVisible();
  await waitForSaved(page);
  await page.waitForTimeout(1_000);
  expect(await storageWriteCount(page)).toBe(1);
  const committedJson = await readStoredDocumentJson(page);
  expect(committedJson).not.toBe(baselineJson);
  await expect(sectionLabels(page, 'Rapid portfolio')).resolves.toEqual(['Booking']);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.locator('.toast')).toHaveCount(1);
  await expect(page.locator('.toast')).toContainText('Rapid portfolio created with Booking intact.');
  await expectFocusOutsideDocumentRoot(page);
  await menuPrompt.getByRole('button', { name: 'Not now' }).click();

  await runHistoryAction(page, 'Undo');
  await waitForSaved(page);
  expect(await readStoredDocumentJson(page)).toBe(baselineJson);
  await expect(page.locator('button[aria-label="Undo"]')).toBeDisabled();
});

for (const path of ['cross-page', 'create-page'] as const) {
  test(`rapid mouse double-click commits ${path} movement exactly once`, async ({ page }) => {
    await page.setViewportSize({ width: path === 'cross-page' ? 920 : 375, height: 800 });
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
      await move.getByPlaceholder('Page name').fill('Pointer portfolio');
      await move.getByRole('button', { name: 'Create page and move' }).click();
    }
    const done = move.getByRole('button', { name: 'Done', exact: true });
    const doneBox = await done.boundingBox();
    expect(doneBox).not.toBeNull();
    if (!doneBox) throw new Error('Done has no clickable geometry.');
    await page.mouse.click(
      doneBox.x + doneBox.width / 2,
      doneBox.y + doneBox.height / 2,
      { clickCount: 2, delay: 12 },
    );

    await expect(move).toHaveCount(0);
    const prompt = page.getByRole('dialog', { name: 'Add a menu?' });
    if (path === 'create-page') {
      await expect(prompt).toBeVisible();
      await prompt.getByRole('button', { name: 'Not now' }).click();
    }
    await waitForSaved(page);
    await page.waitForTimeout(1_000);
    expect(await storageWriteCount(page)).toBe(1);
    const committedJson = await readStoredDocumentJson(page);
    expect(committedJson).not.toBe(baselineJson);
    const destination = path === 'cross-page' ? 'Home' : 'Pointer portfolio';
    await expect(sectionLabels(page, destination)).resolves.toContain('Booking');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.toast')).toHaveCount(1);
    await expectFocusOutsideDocumentRoot(page);

    await runHistoryAction(page, 'Undo');
    await waitForSaved(page);
    expect(await readStoredDocumentJson(page)).toBe(baselineJson);
    await expect(page.locator('button[aria-label="Undo"]')).toBeDisabled();
    await runHistoryAction(page, 'Redo');
    await waitForSaved(page);
    expect(await readStoredDocumentJson(page)).toBe(committedJson);
  });
}

for (const scenario of [
  { activation: 'mouse-double' as const, resolution: 'Keep order' as const },
  { activation: 'enter-double' as const, resolution: 'Keep order' as const },
  { activation: 'mouse-double' as const, resolution: 'Discard changes' as const },
  { activation: 'enter-double' as const, resolution: 'Discard changes' as const },
]) {
  test(`rapid ${scenario.activation} on dirty ${scenario.resolution} resolves once without fall-through`, async ({
    page,
  }) => {
    await page.setViewportSize({
      height: scenario.activation === 'mouse-double' ? 600 : 900,
      width: scenario.activation === 'mouse-double' ? 375 : 1440,
    });
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    await waitForSaved(page);
    const baselineJson = await readStoredDocumentJson(page);
    await installStorageWriteProbe(page);
    const move = await openMoveForBooking(page, 'Home');
    await dirtyMoveBooking(move);
    await move.getByRole('button', { name: 'Close Move Booking' }).click();
    const warning = page.getByRole('dialog', { name: 'Keep this new order?' });
    const action = warning.getByRole('button', { name: scenario.resolution });

    if (scenario.activation === 'mouse-double') {
      const actionBox = await action.boundingBox();
      expect(actionBox).not.toBeNull();
      if (!actionBox) {
        throw new Error(`${scenario.resolution} has no clickable geometry.`);
      }
      await page.mouse.click(
        actionBox.x + actionBox.width / 2,
        actionBox.y + actionBox.height / 2,
        { clickCount: 2, delay: 12 },
      );
    } else {
      await action.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
    }

    await expect(warning).toHaveCount(0);
    await page.waitForTimeout(1_000);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(bookingCard(page, 'Home')).toHaveClass(/is-selected/);
    await expectBookingMoveFocusRestored(page, 'Home');

    if (scenario.resolution === 'Keep order') {
      await waitForSaved(page);
      expect(await storageWriteCount(page)).toBe(1);
      const committedJson = await readStoredDocumentJson(page);
      expect(committedJson).not.toBe(baselineJson);
      await expect(sectionLabels(page, 'Home')).resolves.toEqual([
        'Booking',
        'Section 01',
        'Section 02',
      ]);
      await expect(page.locator('.toast')).toHaveCount(1);
      await expect(page.locator('.toast')).toContainText('Section order saved.');
      await runHistoryAction(page, 'Undo');
      await waitForSaved(page);
      expect(await readStoredDocumentJson(page)).toBe(baselineJson);
      await expect(page.locator('button[aria-label="Undo"]')).toBeDisabled();
    } else {
      expect(await storageWriteCount(page)).toBe(0);
      expect(await readStoredDocumentJson(page)).toBe(baselineJson);
      await expect(sectionLabels(page, 'Home')).resolves.toEqual([
        'Section 01',
        'Section 02',
        'Booking',
      ]);
      await expect(page.locator('.toast')).toHaveCount(0);
      await expect(page.locator('button[aria-label="Undo"]')).toBeDisabled();
    }
  });
}

test('Create page and move stages, cancels, survives reload rules, and is one Undo/Redo operation', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 600 });
  await openFreshLab(page);
  await chooseStarter(page, 'Multi-page website');
  await waitForSaved(page);
  await selectPageFromStructure(page, 'Services / Book');
  const baselineJson = await readStoredDocumentJson(page);

  let move = await openMoveForBooking(page, 'Services / Book');
  await move
    .getByRole('button', { name: 'Move Booking to another page' })
    .click();
  await move.getByPlaceholder('Page name').fill('Draft services');
  await move.getByRole('button', { name: 'Create page and move' }).click();
  await expect(move.getByRole('region', { name: 'Staged destination' }))
    .toContainText('Draft services will be created when you press Done.');
  expect((await readStoredDocument(page)).pages.map((candidate) => candidate.name))
    .not.toContain('Draft services');
  await move.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await readStoredDocumentJson(page)).toBe(baselineJson);

  move = await openMoveForBooking(page, 'Services / Book');
  await move
    .getByRole('button', { name: 'Move Booking to another page' })
    .click();
  await move.getByPlaceholder('Page name').fill('Reload draft');
  await move.getByRole('button', { name: 'Create page and move' }).click();
  await page.reload();
  expect((await readStoredDocument(page)).pages.map((candidate) => candidate.name))
    .not.toContain('Reload draft');
  await selectPageFromStructure(page, 'Services / Book');
  await expect(sectionLabels(page, 'Services / Book')).resolves.toEqual([
    'Section 03',
    'Booking',
  ]);

  await installStorageWriteProbe(page);
  move = await openMoveForBooking(page, 'Services / Book');
  await move
    .getByRole('button', { name: 'Move Booking to another page' })
    .click();
  await move.getByPlaceholder('Page name').fill('Portfolio');
  await move.getByRole('button', { name: 'Create page and move' }).click();
  await move.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeVisible();
  await expect(sectionLabels(page, 'Portfolio')).resolves.toEqual(['Booking']);
  await expectBookingMoveFocusRestored(page, 'Portfolio');
  await waitForSaved(page);
  expect(await storageWriteCount(page)).toBe(1);
  const committedJson = await readStoredDocumentJson(page);
  expect(committedJson).not.toBe(baselineJson);

  await runHistoryAction(page, 'Undo');
  await waitForSaved(page);
  expect(await readStoredDocumentJson(page)).toBe(baselineJson);
  expect((await readStoredDocument(page)).pages.map((candidate) => candidate.name))
    .not.toContain('Portfolio');
  await runHistoryAction(page, 'Redo');
  await waitForSaved(page);
  expect(await readStoredDocumentJson(page)).toBe(committedJson);
  await page.reload();
  await expect(pageNames(page)).resolves.toContain('Portfolio');
  await selectPageFromStructure(page, 'Portfolio');
  await expect(sectionLabels(page, 'Portfolio')).resolves.toEqual(['Booking']);
});

test('Create page and move dirty warning shares Discard and Keep semantics', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 600 });
  for (const resolution of ['Discard changes', 'Keep order'] as const) {
    await openFreshLab(page);
    await chooseStarter(page, 'Multi-page website');
    await waitForSaved(page);
    await selectPageFromStructure(page, 'Services / Book');
    const baselineJson = await readStoredDocumentJson(page);
    const pageName = resolution === 'Keep order' ? 'Kept page' : 'Discarded page';
    const move = await openMoveForBooking(page, 'Services / Book');
    await move
      .getByRole('button', { name: 'Move Booking to another page' })
      .click();
    await move.getByPlaceholder('Page name').fill(pageName);
    await move.getByRole('button', { name: 'Create page and move' }).click();
    await page.keyboard.press('Escape');
    const warning = page.getByRole('dialog', { name: 'Keep this new order?' });
    await expect(warning).toContainText(`${pageName} will be created`);
    await warning.getByRole('button', { name: resolution }).click();
    if (resolution === 'Discard changes') {
      await expectBookingMoveFocusRestored(page, 'Services / Book');
      expect(await readStoredDocumentJson(page)).toBe(baselineJson);
      expect((await readStoredDocument(page)).pages.map((candidate) => candidate.name))
        .not.toContain(pageName);
    } else {
      await expect(page.getByRole('heading', { level: 1, name: pageName })).toBeVisible();
      await expectBookingMoveFocusRestored(page, pageName);
      await waitForSaved(page);
      expect((await readStoredDocument(page)).pages.map((candidate) => candidate.name))
        .toContain(pageName);
    }
  }
});

test('incidental controls keep the cross-page target pinned until explicit row activation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 600 });
  await openFreshLab(page);
  await chooseStarter(page, 'Multi-page website');
  await selectPageFromStructure(page, 'Services / Book');
  let move = await openMoveForBooking(page, 'Services / Book');

  await move.getByRole('button', { name: 'Move Section 03 down' }).click();
  await moveSectionToPosition(move, 'Section 03', 2);
  await expect(move).toHaveAccessibleName('Move Booking');
  await expect(
    move.getByRole('button', { name: 'Move Booking to another page' }),
  ).toBeVisible();
  await expect(move.locator('[data-move-target-row="true"]')).toContainText('Booking');

  const selectSection03 = move.getByRole('button', {
    name: /Select Section 03 for cross-page movement/,
  });
  await selectSection03.click();
  move = page.getByRole('dialog', { name: 'Move Section 03' });
  await expect(move).toBeVisible();
  await expect(
    move.getByRole('button', { name: 'Move Section 03 to another page' }),
  ).toBeVisible();
  await expect(
    move.locator('.reorder-row__select').filter({ hasText: 'Section 03' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('reorder-live-region'))
    .toHaveText('Section 03 selected for cross-page movement.');
  await move.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('hidden, not-in-navigation, and unavailable destinations are distinct before selection', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 600 });
  await openFreshLab(page);
  await chooseStarter(page, 'Multi-page website');
  await waitForSaved(page);
  await setPageVisibility(page, 'Gallery', 'hidden');
  await selectPageFromStructure(page, 'Services / Book');

  let move = await openMoveForPlaceholder(page, 'Services / Book', 'Section 03');
  await move
    .getByRole('button', { name: 'Move Section 03 to another page' })
    .click();
  const hiddenAllowed = destinationPageButton(move, 'Gallery');
  await expect(hiddenAllowed).toContainText('Hidden from clients');
  await expect(hiddenAllowed).not.toHaveAttribute('aria-disabled', 'true');
  await hiddenAllowed.click();
  await expect(move.getByRole('region', { name: 'Staged destination' }))
    .toContainText('Gallery');
  await move.getByRole('button', { name: 'Cancel', exact: true }).click();

  move = await openMoveForBooking(page, 'Services / Book');
  await move
    .getByRole('button', { name: 'Move Booking to another page' })
    .click();
  const hiddenUnavailable = destinationPageButton(move, 'Gallery');
  await expect(hiddenUnavailable).toContainText('Hidden from clients');
  await expect(hiddenUnavailable).toHaveAttribute('aria-disabled', 'true');
  const unavailableReasonId = await hiddenUnavailable.getAttribute(
    'aria-describedby',
  );
  expect(unavailableReasonId).toMatch(/^move-destination-reason-/);
  if (!unavailableReasonId) {
    throw new Error('Unavailable destination has no accessible reason.');
  }
  await expect(move.locator(`#${unavailableReasonId}`))
    .toContainText('Unavailable');
  await expect(move.getByRole('region', { name: 'Staged destination' })).toHaveCount(0);
  await move.getByRole('button', { name: 'Cancel', exact: true }).click();

  await setPageVisibility(page, 'About', 'not-in-navigation');
  await selectPageFromStructure(page, 'Services / Book');
  move = await openMoveForPlaceholder(page, 'Services / Book', 'Section 03');
  await move
    .getByRole('button', { name: 'Move Section 03 to another page' })
    .click();
  const omitted = destinationPageButton(move, 'About');
  await expect(omitted).toContainText('Not in navigation');
  await expect(omitted).not.toContainText('Hidden from clients');
  await move.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('desktop Booking settings have one heading and Escape closes to their trigger at every desktop width', async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const width of [920, 1024, 1179, 1180, 1280, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    const { settings, trigger } = await openBookingSettings(page, 'Home');
    await expect(
      settings.locator('h2').filter({ hasText: /^Booking$/ }),
    ).toHaveCount(1);
    await expect(
      settings.getByText(/Choose how clients browse your services/, { exact: false }),
    ).toHaveCount(1);
    const settingsBody = settings.locator('.final-booking-settings-drawer__body');
    await settingsBody.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const reset = settings.getByRole('button', { name: 'Reset presentation' });
    await reset.focus();
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expectFocusOutsideDocumentRoot(page);
  }
});

test('desktop settings retain state and a singular heading across 1179/1180 while Hide settings remains truthful', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1179, height: 800 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const { settings } = await openBookingSettings(page, 'Home');
  const editorial = settings.locator('[data-layout-option="editorial_cards"]');
  await editorial.click();
  const settingsBody = settings.locator('.final-booking-settings-drawer__body');
  await settingsBody.evaluate((element) => {
    element.scrollTop = Math.min(240, element.scrollHeight - element.clientHeight);
  });
  const scrollTop = await settingsBody.evaluate((element) => element.scrollTop);

  for (const width of [1180, 1179]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(settings).toBeVisible();
    await expect(settings.locator('h2').filter({ hasText: /^Booking$/ })).toHaveCount(1);
    await expect(editorial).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => settingsBody.evaluate((element) => element.scrollTop))
      .toBe(scrollTop);
  }

  await settings.getByRole('button', { name: 'Hide settings' }).click();
  await expect(settings).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show Booking settings' }))
    .toHaveCount(0);
  await page
    .getByTestId('selected-section-toolbar')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Booking' })).toBeFocused();

  await page.getByRole('button', { name: 'More site options' }).click();
  const more = page.getByRole('dialog', { name: 'More' });
  await expect(more).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(more).toHaveCount(0);
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Reset presentation' }).focus();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
});

test('a pointer-opened native settings select consumes the first Escape before the drawer closes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const { settings, trigger } = await openBookingSettings(page, 'Home');
  const typography = settings.getByRole('combobox', {
    name: 'Booking typography preset',
  });

  await typography.click();
  await page.keyboard.press('Escape');
  await expect(settings).toBeVisible();
  await expect(typography).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('device controls keep aria-pressed and announce the measured preview width once', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const devices = page.getByRole('group', { name: 'Preview viewport' });
  const announcement = page.getByTestId('preview-viewport-announcement');
  const frame = page.locator('.preview-frame');

  for (const interaction of [
    { input: 'pointer', label: 'Phone' },
    { input: 'keyboard', label: 'Tablet' },
    { input: 'pointer', label: 'Desktop' },
  ] as const) {
    const control = devices.getByRole('button', { name: interaction.label });
    if (interaction.input === 'keyboard') {
      await control.focus();
      await page.keyboard.press('Enter');
    } else {
      await control.click();
    }
    await expect(control).toHaveAttribute('aria-pressed', 'true');
    await expect(announcement).toContainText(interaction.label);
    await expect(announcement).toContainText('preview');
    const width = Math.round((await frame.boundingBox())?.width ?? 0);
    expect(width).toBeGreaterThan(0);
    await expect(announcement).toContainText(`${width} pixels wide`);
    for (const other of ['Phone', 'Tablet', 'Desktop']) {
      await expect(devices.getByRole('button', { name: other }))
        .toHaveAttribute('aria-pressed', other === interaction.label ? 'true' : 'false');
    }
  }

  const desktop = devices.getByRole('button', { name: 'Desktop' });
  const before = await announcement.textContent();
  await desktop.click();
  await expect(announcement).toHaveCount(1);
  await expect(announcement).toHaveText(before ?? '');

  const renderer = page.getByTestId('booking-section-preview');
  await renderer.getByRole('searchbox', { name: 'Search services' }).fill('russ');
  await renderer
    .getByRole('button', { name: /View details for Russian Manicure/ })
    .last()
    .click();
  const detail = page.getByTestId('service-detail-dialog');
  await expect(detail).toBeVisible();
  await devices.getByRole('button', { name: 'Phone' }).click();
  await expect(detail).toBeVisible();
  await expect(announcement).toContainText('Phone preview selected');
  const [detailBox, frameBox] = await Promise.all([
    detail.boundingBox(),
    frame.boundingBox(),
  ]);
  expect(detailBox).not.toBeNull();
  expect(frameBox).not.toBeNull();
  if (detailBox && frameBox) {
    expect(detailBox.x).toBeGreaterThanOrEqual(frameBox.x - 1);
    expect(detailBox.x + detailBox.width)
      .toBeLessThanOrEqual(frameBox.x + frameBox.width + 1);
  }
});

test('starter cards keep identity-first semantics and reachable CTAs at short mobile viewports', async ({
  page,
}) => {
  const starters = [
    ['Quick Book', 'Fastest way to start taking bookings.'],
    ['One-page website', 'A complete scrolling salon website.'],
    ['Multi-page website', 'Separate pages with a navigation menu.'],
  ] as const;
  for (const viewport of [
    { width: 320, height: 600 },
    { width: 375, height: 600 },
    { width: 375, height: 500 },
  ]) {
    await page.setViewportSize(viewport);
    await openFreshLab(page);
    await expectNoDocumentOverflow(page);
    for (const [name, description] of starters) {
      const card = page.getByRole('button', { name: new RegExp(`^${name}`) });
      await expect(card).toHaveAccessibleName(new RegExp(`^${name} ${description}`));
      const copy = card.locator('.final-starter-card__copy');
      const preview = card.locator('.final-starter-mini');
      await expect(preview).toHaveAttribute('aria-hidden', 'true');
      expect(await copy.evaluate((element) => element.nextElementSibling?.classList.contains('final-starter-mini')))
        .toBe(true);
      const cta = card.getByText('Choose this start', { exact: false });
      await expect(cta).toBeVisible();
      const [cardBox, ctaBox] = await Promise.all([card.boundingBox(), cta.boundingBox()]);
      expect(cardBox).not.toBeNull();
      expect(ctaBox).not.toBeNull();
      if (cardBox && ctaBox) {
        expect(ctaBox.y - cardBox.y).toBeLessThan(viewport.height);
      }
      await card.scrollIntoViewIfNeeded();
      await card.focus();
      await expect(card).toBeFocused();
    }
  }
});
