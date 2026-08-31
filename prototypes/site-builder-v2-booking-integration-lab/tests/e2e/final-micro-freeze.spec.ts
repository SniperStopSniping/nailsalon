import {
  devices,
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

import { MOVE_COMPLETION_SHIELD_DURATION_MS } from '../../src/ui/move-completion-shield';
import {
  bookingCard,
  chooseStarter,
  destinationPageButton,
  documentSurfaceState,
  LAB_STORAGE_KEY,
  openBookingSettings,
  openFreshLab,
  openMoveForBooking,
  readStoredDocument,
  readStoredDocumentJson,
  sectionLabels,
  selectPageFromStructure,
  startRuntimeMonitor,
  waitForSaved,
} from './helpers';

type Point = { x: number; y: number };
type ProtectedEventName = 'click' | 'mousedown' | 'mouseup' | 'pointerdown' | 'pointerup';
type ProbeState = {
  bubbledClicks: number;
  canvasEvents: Record<ProtectedEventName, number>;
  clickTimes: number[];
  writes: number;
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

test.describe.configure({ mode: 'serial' });

let runtimeMonitor: ReturnType<typeof startRuntimeMonitor>;

test.beforeEach(async ({ page }) => {
  runtimeMonitor = startRuntimeMonitor(page);
});

test.afterEach(async () => {
  runtimeMonitor.assertClean();
  runtimeMonitor.stop();
});

async function installInteractionProbe(page: Page): Promise<void> {
  await page.evaluate((storageKey) => {
    const probeWindow = window as typeof window & {
      __microFreezeOriginalSetItem?: typeof Storage.prototype.setItem;
      __microFreezeProbe?: ProbeState;
      __microFreezeProbeInstalled?: boolean;
    };
    probeWindow.__microFreezeProbe = {
      bubbledClicks: 0,
      canvasEvents: {
        click: 0,
        mousedown: 0,
        mouseup: 0,
        pointerdown: 0,
        pointerup: 0,
      },
      clickTimes: [],
      writes: 0,
    };
    if (!probeWindow.__microFreezeOriginalSetItem) {
      const original = Storage.prototype.setItem;
      probeWindow.__microFreezeOriginalSetItem = original;
      Storage.prototype.setItem = function setItem(key: string, value: string) {
        if (key === storageKey && probeWindow.__microFreezeProbe) {
          probeWindow.__microFreezeProbe.writes += 1;
        }
        return original.call(this, key, value);
      };
    }
    if (!probeWindow.__microFreezeProbeInstalled) {
      document.addEventListener('click', () => {
        if (probeWindow.__microFreezeProbe) {
          probeWindow.__microFreezeProbe.bubbledClicks += 1;
          probeWindow.__microFreezeProbe.clickTimes.push(window.performance.now());
        }
      });
      const canvas = document.querySelector('main.final-canvas-shell');
      (['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const)
        .forEach((eventName) => canvas?.addEventListener(eventName, () => {
          if (probeWindow.__microFreezeProbe) {
            probeWindow.__microFreezeProbe.canvasEvents[eventName] += 1;
          }
        }, { capture: true }));
      probeWindow.__microFreezeProbeInstalled = true;
    }
  }, LAB_STORAGE_KEY);
}

async function resetInteractionProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probeWindow = window as typeof window & { __microFreezeProbe?: ProbeState };
    probeWindow.__microFreezeProbe = {
      bubbledClicks: 0,
      canvasEvents: {
        click: 0,
        mousedown: 0,
        mouseup: 0,
        pointerdown: 0,
        pointerup: 0,
      },
      clickTimes: [],
      writes: 0,
    };
  });
}

async function readInteractionProbe(page: Page): Promise<ProbeState> {
  return page.evaluate(() => {
    const probeWindow = window as typeof window & { __microFreezeProbe?: ProbeState };
    return probeWindow.__microFreezeProbe ?? {
      bubbledClicks: -1,
      canvasEvents: {
        click: -1,
        mousedown: -1,
        mouseup: -1,
        pointerdown: -1,
        pointerup: -1,
      },
      clickTimes: [],
      writes: -1,
    };
  });
}

async function center(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('Expected a visible action with clickable geometry.');
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

async function ordinaryClicks(
  page: Page,
  point: Point,
  count: number,
  gapMs: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await page.mouse.click(point.x, point.y);
    if (index < count - 1) await page.waitForTimeout(gapMs);
  }
}

async function instrumentPreviewActivation(page: Page): Promise<Locator> {
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  await preview.evaluate((element) => {
    const probeWindow = window as typeof window & { __backgroundPreviewActivations?: number };
    probeWindow.__backgroundPreviewActivations = 0;
    element.addEventListener('click', () => {
      probeWindow.__backgroundPreviewActivations = (
        probeWindow.__backgroundPreviewActivations ?? 0
      ) + 1;
    });
  });
  return preview;
}

async function actionableBackdropPoint(
  page: Page,
  preview: Locator,
  settings: Locator,
): Promise<Point> {
  const previewBox = await preview.boundingBox();
  const settingsBox = await settings.boundingBox();
  expect(previewBox).not.toBeNull();
  expect(settingsBox).not.toBeNull();
  if (!previewBox || !settingsBox) {
    throw new Error('Expected Preview and settings sheet geometry.');
  }
  const y = Math.min(settingsBox.y - 1.25, previewBox.y + previewBox.height - 0.5);
  expect(y).toBeGreaterThanOrEqual(previewBox.y);
  expect(y).toBeLessThan(settingsBox.y);
  const point = {
    x: previewBox.x + previewBox.width / 2,
    y,
  };
  expect(await page.evaluate(({ x, y: pointY }) => {
    const hit = document.elementFromPoint(x, pointY);
    return Boolean(hit?.matches('.dialog-backdrop'));
  }, point)).toBe(true);
  return point;
}

async function expectPreviewStayedInactive(page: Page): Promise<void> {
  expect(await page.evaluate(() => (
    window as typeof window & { __backgroundPreviewActivations?: number }
  ).__backgroundPreviewActivations ?? 0)).toBe(0);
  await expect(page.getByTestId('final-hybrid-editor')).toHaveAttribute(
    'data-editor-mode',
    'edit',
  );
  await expect(page.getByRole('button', { name: 'Back to editor' })).toHaveCount(0);
}

/**
 * Quick Book's Home page, in starter order. `FIRST_SECTION` is the non-Booking
 * section these tests drag around; moving it down once produces
 * `QUICK_BOOK_FIRST_SECTION_MOVED_DOWN`.
 */
const QUICK_BOOK_HOME_SECTIONS = [
  'Announcement Bar',
  'Salon intro',
  'Featured Services',
  'Booking',
  'Final Booking CTA',
  'Footer',
] as const;

const FIRST_SECTION = QUICK_BOOK_HOME_SECTIONS[0];

const QUICK_BOOK_FIRST_SECTION_MOVED_DOWN = [
  'Salon intro',
  'Announcement Bar',
  'Featured Services',
  'Booking',
  'Final Booking CTA',
  'Footer',
] as const;

/** Multi-page Home, after Booking is moved in at the default last position. */
const MULTI_PAGE_HOME_WITH_BOOKING_LAST = [
  'Announcement Bar',
  'Welcome',
  'Quick Info',
  'Featured work',
  'Reviews',
  'Final Booking CTA',
  'Footer',
  'Booking',
] as const;

async function selectFirstSection(page: Page): Promise<Locator> {
  const card = page.getByRole('listitem', { name: `${FIRST_SECTION} on Home` });
  if (!(await card.evaluate((element) => element.classList.contains('is-selected')))) {
    await card.locator('.section-card__select-surface').click();
  }
  await expect(card).toHaveClass(/is-selected/);
  return card;
}

async function openDirtyFirstSectionMove(page: Page): Promise<{
  card: Locator;
  done: Locator;
  move: Locator;
}> {
  const card = await selectFirstSection(page);
  await page
    .getByTestId('selected-section-toolbar')
    .getByRole('button', { name: 'Move', exact: true })
    .click();
  const move = page.getByRole('dialog', { name: `Move ${FIRST_SECTION}` });
  await move.getByRole('button', { name: `Move ${FIRST_SECTION} down`, exact: true }).click();
  await expect(move.getByText('Order not saved yet', { exact: true })).toBeVisible();
  return {
    card,
    done: move.getByRole('button', { name: 'Done', exact: true }),
    move,
  };
}

async function expectMeaningfulFocusFor(
  page: Page,
  card: Locator,
): Promise<void> {
  const sectionId = await card.getAttribute('data-section-instance-id');
  expect(sectionId).not.toBeNull();
  await expect.poll(() => page.evaluate((expectedId) => {
    const active = document.activeElement as HTMLElement | null;
    return Boolean(
      active
      && active !== document.body
      && active !== document.documentElement
      && active.isConnected
      && (
        active.getAttribute('data-move-trigger-for') === expectedId
        || active.getAttribute('data-section-return-for') === expectedId
        || active.closest('[data-section-instance-id]')
          ?.getAttribute('data-section-instance-id') === expectedId
      )
    );
  }, sectionId)).toBe(true);
}

async function expectNoMoveFallthrough(
  page: Page,
  card: Locator,
  expectedWrites = 1,
): Promise<void> {
  await expect(card).toHaveClass(/is-selected/);
  await expectMeaningfulFocusFor(page, card);
  const probe = await readInteractionProbe(page);
  expect(probe.bubbledClicks).toBe(1);
  expect(probe.canvasEvents).toEqual({
    click: 0,
    mousedown: 0,
    mouseup: 0,
    pointerdown: 0,
    pointerup: 0,
  });
  expect(probe.writes).toBe(expectedWrites);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Remove from (?:page|this page)/ }))
    .toHaveCount(0);
}

async function setupQuickBook(page: Page): Promise<string | null> {
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await waitForSaved(page);
  const baseline = await readStoredDocumentJson(page);
  await installInteractionProbe(page);
  return baseline;
}

test('ordinary Done timing sweep protects through 450 ms and releases normally by 600 ms', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1180, height: 800 });

  for (const gapMs of [40, 70, 100, 120, 160, 200, 300, 450, 600]) {
    await setupQuickBook(page);
    const { card, done, move } = await openDirtyFirstSectionMove(page);
    const point = await center(done);
    await resetInteractionProbe(page);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(gapMs);
    const actualGapBeforeSecondClick = await page.evaluate(() => {
      const probe = (window as typeof window & { __microFreezeProbe?: ProbeState })
        .__microFreezeProbe;
      const firstClickAt = probe?.clickTimes[0];
      return firstClickAt === undefined
        ? -1
        : window.performance.now() - firstClickAt;
    });
    test.info().annotations.push({
      description: `${actualGapBeforeSecondClick.toFixed(1)} ms observed before click 2`,
      type: `requested-${gapMs}-ms-gap`,
    });
    await page.mouse.click(point.x, point.y);
    await expect(move).toHaveCount(0);
    await waitForSaved(page);

    const probe = await readInteractionProbe(page);
    expect(probe.writes).toBe(1);
    if (gapMs <= 450) {
      expect(actualGapBeforeSecondClick).toBeGreaterThan(gapMs - 10);
      expect(actualGapBeforeSecondClick).toBeLessThan(MOVE_COMPLETION_SHIELD_DURATION_MS);
      expect(probe.bubbledClicks, `old Done point at ${gapMs} ms`).toBe(1);
      expect(probe.canvasEvents, `canvas sequence at ${gapMs} ms`).toEqual({
        click: 0,
        mousedown: 0,
        mouseup: 0,
        pointerdown: 0,
        pointerup: 0,
      });
      await expect(card).toHaveClass(/is-selected/);
      await expectMeaningfulFocusFor(page, card);
    } else {
      expect(actualGapBeforeSecondClick).toBeGreaterThanOrEqual(
        MOVE_COMPLETION_SHIELD_DURATION_MS,
      );
      expect(probe.bubbledClicks, 'the 550 ms shield has expired').toBe(2);
    }
  }
});

test('a matching pointer sequence started before expiry stays fully shielded through click', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await setupQuickBook(page);
  const { card, done, move } = await openDirtyFirstSectionMove(page);
  const point = await center(done);
  await resetInteractionProbe(page);
  await page.mouse.click(point.x, point.y);
  await expect(move).toHaveCount(0);

  await page.waitForTimeout(400);
  await page.mouse.down();
  await page.waitForTimeout(180);
  await page.mouse.up();

  await waitForSaved(page);
  await expect(page.locator('.toast')).toHaveCount(1);
  await expectNoMoveFallthrough(page, card);
});

test('ordinary Done sequences preserve selection/focus and create one undoable transaction', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1180, height: 800 });

  for (const scenario of [
    { count: 2, gapMs: 70 },
    { count: 3, gapMs: 70 },
    { count: 4, gapMs: 120 },
    { count: 2, gapMs: 200 },
  ]) {
    const baseline = await setupQuickBook(page);
    const { card, done, move } = await openDirtyFirstSectionMove(page);
    const point = await center(done);
    await resetInteractionProbe(page);
    await ordinaryClicks(page, point, scenario.count, scenario.gapMs);
    await expect(move).toHaveCount(0);
    await waitForSaved(page);
    await expect(sectionLabels(page, 'Home')).resolves
      .toEqual([...QUICK_BOOK_FIRST_SECTION_MOVED_DOWN]);
    await expect(page.locator('.toast')).toHaveCount(1);
    await expect(page.locator('.toast')).toContainText('Section order saved.');
    await expectNoMoveFallthrough(page, card);

    const committed = await readStoredDocumentJson(page);
    expect(committed).not.toBe(baseline);
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    await undo.click();
    await waitForSaved(page);
    expect(await readStoredDocumentJson(page)).toBe(baseline);
    await expect(undo).toBeDisabled();
    const redo = page.getByRole('button', { name: 'Redo', exact: true });
    await redo.click();
    await waitForSaved(page);
    expect(await readStoredDocumentJson(page)).toBe(committed);
  }
});

test('the first different-coordinate mouse and keyboard actions work immediately', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await setupQuickBook(page);
  const { card, done, move } = await openDirtyFirstSectionMove(page);
  const point = await center(done);
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  await preview.evaluate((element) => {
    element.addEventListener('click', () => {
      (window as typeof window & { __immediatePreviewAt?: number })
        .__immediatePreviewAt = window.performance.now();
    }, { once: true });
  });
  await resetInteractionProbe(page);
  await page.mouse.click(point.x, point.y);
  const previewPoint = await center(preview);
  await page.mouse.click(previewPoint.x, previewPoint.y);
  const immediateEventGap = await page.evaluate(() => {
    const probe = (window as typeof window & { __microFreezeProbe?: ProbeState })
      .__microFreezeProbe;
    const previewAt = (window as typeof window & { __immediatePreviewAt?: number })
      .__immediatePreviewAt;
    return previewAt === undefined || probe?.clickTimes[0] === undefined
      ? -1
      : previewAt - probe.clickTimes[0];
  });
  expect(immediateEventGap).toBeGreaterThanOrEqual(0);
  expect(immediateEventGap).toBeLessThan(MOVE_COMPLETION_SHIELD_DURATION_MS);
  await expect(move).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to editor' }).click();
  await expect(page.getByTestId('final-hybrid-editor')).toBeVisible();

  await selectFirstSection(page);
  await page
    .getByTestId('selected-section-toolbar')
    .getByRole('button', { name: 'Move', exact: true })
    .click();
  const secondMove = page.getByRole('dialog', { name: `Move ${FIRST_SECTION}` });
  const secondDone = secondMove.getByRole('button', { name: 'Done', exact: true });
  await secondDone.focus();
  await page.keyboard.press('Enter');
  await expect(secondMove).toHaveCount(0);
  await expectMeaningfulFocusFor(page, card);
  await page.keyboard.press('Tab');
  const firstTabTarget = await page.evaluate(() => ({
    body: document.activeElement === document.body,
    connected: document.activeElement instanceof HTMLElement
      ? document.activeElement.isConnected
      : false,
    tagName: document.activeElement?.tagName ?? null,
  }));
  expect(firstTabTarget.body).toBe(false);
  expect(firstTabTarget.connected).toBe(true);
  expect(firstTabTarget.tagName).toMatch(/^(A|BUTTON)$/);
  await page.evaluate(() => {
    const probeWindow = window as typeof window & { __keyboardReleaseActivated?: boolean };
    probeWindow.__keyboardReleaseActivated = false;
    document.activeElement?.addEventListener('click', () => {
      probeWindow.__keyboardReleaseActivated = true;
    }, { once: true });
  });
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (
    window as typeof window & { __keyboardReleaseActivated?: boolean }
  ).__keyboardReleaseActivated)).toBe(true);
});

test('ordinary cross-page Done clicks commit once without activating the destination canvas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await openFreshLab(page);
  await chooseStarter(page, 'Multi-page website');
  await waitForSaved(page);
  await selectPageFromStructure(page, 'Services / Book');
  const baseline = await readStoredDocumentJson(page);
  await installInteractionProbe(page);
  const move = await openMoveForBooking(page, 'Services / Book');
  await move.getByRole('button', { name: 'Move Booking to another page' }).click();
  await destinationPageButton(move, 'Home').click();
  const done = move.getByRole('button', { name: 'Done', exact: true });
  const point = await center(done);
  await resetInteractionProbe(page);
  await ordinaryClicks(page, point, 3, 70);

  await expect(move).toHaveCount(0);
  await waitForSaved(page);
  await expect(sectionLabels(page, 'Home')).resolves
    .toEqual([...MULTI_PAGE_HOME_WITH_BOOKING_LAST]);
  const card = bookingCard(page, 'Home');
  await expectNoMoveFallthrough(page, card);
  await expect(page.locator('.toast')).toHaveCount(1);
  await expect(page.locator('.toast')).toContainText('Booking moved to Home.');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back to editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to editor' }).click();
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await undo.click();
  await waitForSaved(page);
  expect(await readStoredDocumentJson(page)).toBe(baseline);
  await expect(undo).toBeDisabled();
});

test('ordinary Create page and move Done clicks create once and allow the prompt action immediately', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  const baseline = await setupQuickBook(page);
  const move = await openMoveForBooking(page, 'Home');
  await move.getByRole('button', { name: 'Move Booking to another page' }).click();
  await move.getByPlaceholder('Page name').fill('Micro services');
  const createPage = move.getByRole('button', { name: 'Create page and move' });
  const createPoint = await center(createPage);
  await ordinaryClicks(page, createPoint, 3, 70);
  expect(await readStoredDocumentJson(page)).toBe(baseline);
  expect((await readInteractionProbe(page)).writes).toBe(0);
  const done = move.getByRole('button', { name: 'Done', exact: true });
  const point = await center(done);
  await resetInteractionProbe(page);
  await ordinaryClicks(page, point, 3, 70);

  await expect(move).toHaveCount(0);
  const menuPrompt = page.getByRole('dialog', { name: 'Add a menu?' });
  await expect(menuPrompt).toBeVisible();
  await waitForSaved(page);
  const probe = await readInteractionProbe(page);
  expect(probe.bubbledClicks).toBe(1);
  expect(probe.canvasEvents).toEqual({
    click: 0,
    mousedown: 0,
    mouseup: 0,
    pointerdown: 0,
    pointerup: 0,
  });
  expect(probe.writes).toBe(1);
  await expect(sectionLabels(page, 'Micro services')).resolves.toEqual(['Booking']);
  const stored = await readStoredDocument(page);
  expect(stored.pages.filter((candidate) => candidate.name === 'Micro services')).toHaveLength(1);
  await expect(page.locator('.toast')).toHaveCount(1);
  await expect(page.locator('.toast')).toContainText('Micro services created with Booking intact.');
  const activeElement = await page.evaluate(() => ({
    body: document.activeElement === document.body,
    connected: document.activeElement instanceof HTMLElement
      ? document.activeElement.isConnected
      : false,
    insideDialog: Boolean(document.activeElement?.closest('[role="dialog"]')),
  }));
  expect(activeElement).toEqual({ body: false, connected: true, insideDialog: true });

  await menuPrompt.getByRole('button', { name: 'Not now' }).click();
  await expect(menuPrompt).toHaveCount(0);
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await undo.click();
  await waitForSaved(page);
  expect(await readStoredDocumentJson(page)).toBe(baseline);
  await expect(undo).toBeDisabled();
});

test('ordinary Keep and Discard clicks preserve their exact transaction semantics', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1180, height: 800 });

  for (const resolution of ['Keep order', 'Discard changes'] as const) {
    const baseline = await setupQuickBook(page);
    const { card, move } = await openDirtyFirstSectionMove(page);
    await page.keyboard.press('Escape');
    const warning = page.getByRole('dialog', { name: 'Keep this new order?' });
    await expect(warning).toBeVisible();
    const action = warning.getByRole('button', { name: resolution });
    await action.focus();
    const point = await center(action);
    await resetInteractionProbe(page);
    await ordinaryClicks(page, point, 3, 70);
    await expect(warning).toHaveCount(0);
    await expect(move).toHaveCount(0);
    await expectMeaningfulFocusFor(page, card);

    let probe = await readInteractionProbe(page);
    expect(probe.bubbledClicks).toBe(1);
    expect(probe.canvasEvents).toEqual({
      click: 0,
      mousedown: 0,
      mouseup: 0,
      pointerdown: 0,
      pointerup: 0,
    });
    if (resolution === 'Keep order') {
      await waitForSaved(page);
      probe = await readInteractionProbe(page);
      expect(probe.writes).toBe(1);
      expect(await readStoredDocumentJson(page)).not.toBe(baseline);
      await expect(sectionLabels(page, 'Home')).resolves
        .toEqual([...QUICK_BOOK_FIRST_SECTION_MOVED_DOWN]);
      await expect(page.locator('.toast')).toHaveCount(1);
      await expect(page.locator('.toast')).toContainText('Section order saved.');
    } else {
      expect(probe.writes).toBe(0);
      expect(await readStoredDocumentJson(page)).toBe(baseline);
      await expect(sectionLabels(page, 'Home')).resolves
        .toEqual([...QUICK_BOOK_HOME_SECTIONS]);
      await expect(page.locator('.toast').filter({ hasText: 'Section order saved.' }))
        .toHaveCount(0);
      await expect(page.getByTestId('reorder-live-region')).toContainText('Order restored.');
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    }

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Back to editor' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to editor' }).click();
    if (resolution === 'Keep order') {
      const undo = page.getByRole('button', { name: 'Undo', exact: true });
      await undo.click();
      await waitForSaved(page);
      expect(await readStoredDocumentJson(page)).toBe(baseline);
      await expect(undo).toBeDisabled();
    }
  }
});

async function assertMobileSettingsModal(
  page: Page,
  viewport: { height: number; width: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await waitForSaved(page);
  const steadyState = await documentSurfaceState(page);
  const { settings, trigger } = await openBookingSettings(page, 'Home');
  await expect(settings).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByTestId('final-hybrid-editor')).toHaveAttribute('inert', '');
  await expect(settings.locator('[data-dialog-title]')).toBeFocused();
  expect((await documentSurfaceState(page)).body.overflow).toBe('hidden');

  const insideSheetPoint = await center(settings.locator('.dialog-header'));
  await page.mouse.click(insideSheetPoint.x, insideSheetPoint.y);
  await expect(settings).toBeVisible();

  const focusable = settings.locator(FOCUSABLE_SELECTOR);
  const focusableCount = await focusable.count();
  expect(focusableCount).toBeGreaterThan(2);
  for (let step = 0; step < focusableCount + 2; step += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(
      document.activeElement?.closest('[role="dialog"][aria-modal="true"]'),
    ))).toBe(true);
  }

  await focusable.last().focus();
  await page.keyboard.press('Tab');
  await expect(focusable.first()).toBeFocused();
  await focusable.first().focus();
  await page.keyboard.press('Shift+Tab');
  await expect(focusable.last()).toBeFocused();

  const backgroundControls = [
    page.getByRole('button', { name: 'Preview', exact: true }),
    page.locator('.final-topbar__page').first(),
    page
      .getByRole('group', { name: 'Booking actions' })
      .getByRole('button', { name: 'Move', exact: true }),
  ];
  for (const control of backgroundControls) {
    await expect(control).toBeVisible();
    const receivedFocus = await control.evaluate((element) => {
      (element as HTMLElement).focus();
      return document.activeElement === element;
    });
    expect(receivedFocus, 'visible Builder control stays unavailable behind the modal').toBe(false);
    expect(await page.evaluate(() => Boolean(
      document.activeElement?.closest('[role="dialog"][aria-modal="true"]'),
    ))).toBe(true);
  }
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('final-hybrid-editor')).toHaveAttribute('data-editor-mode', 'edit');

  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await documentSurfaceState(page)).toEqual(steadyState);

  const reopened = await openBookingSettings(page, 'Home');
  await expect(reopened.settings).toBeVisible();
  await page.mouse.click(3, 3);
  await expect(reopened.settings).toHaveCount(0);
  await expect(reopened.trigger).toBeFocused();
  expect(await documentSurfaceState(page)).toEqual(steadyState);

  const actionable = await openBookingSettings(page, 'Home');
  await expect(actionable.settings).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const preview = await instrumentPreviewActivation(page);
  const backdropPoint = await actionableBackdropPoint(page, preview, actionable.settings);
  await page.mouse.click(backdropPoint.x, backdropPoint.y);
  await expect(actionable.settings).toHaveCount(0);
  await expect(
    bookingCard(page, 'Home').locator('.section-card__select-surface'),
  ).toBeFocused();
  await expectPreviewStayedInactive(page);
  expect(await documentSurfaceState(page)).toEqual(steadyState);
}

test('mobile Booking settings are genuinely modal at every required compact viewport', async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const viewport of [
    { height: 600, width: 320 },
    { height: 600, width: 375 },
    { height: 500, width: 375 },
  ]) {
    await assertMobileSettingsModal(page, viewport);
  }
});

test('Pixel 5 touch emulation retains modal focus, AX isolation, and backdrop dismissal', async ({
  baseURL,
  browser,
}) => {
  const context: BrowserContext = await browser.newContext({
    ...devices['Pixel 5'],
    baseURL,
  });
  const page = await context.newPage();
  const monitor = startRuntimeMonitor(page);
  try {
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    await waitForSaved(page);
    const steadyState = await documentSurfaceState(page);
    const { settings, trigger } = await openBookingSettings(page, 'Home');
    await expect(settings).toHaveAttribute('aria-modal', 'true');
    await expect(settings.locator('[data-dialog-title]')).toBeFocused();
    await expect(page.getByTestId('final-hybrid-editor')).toHaveAttribute('inert', '');
    expect((await documentSurfaceState(page)).body.overflow).toBe('hidden');
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))))
      .toBe(true);

    const cdp = await context.newCDPSession(page);
    const tree = await cdp.send('Accessibility.getFullAXTree');
    const exposed = tree.nodes.filter((node) => !node.ignored);
    const valueOf = (value?: { value?: unknown }) => String(value?.value ?? '');
    const dialogs = exposed.filter((node) => valueOf(node.role) === 'dialog');
    expect(dialogs).toHaveLength(1);
    expect(valueOf(dialogs[0]?.name)).toBe('Booking');
    expect(exposed.some((node) => (
      valueOf(node.role) === 'button' && valueOf(node.name) === 'Preview'
    ))).toBe(false);
    expect(exposed.some((node) => (
      valueOf(node.role) === 'button'
      && valueOf(node.name).startsWith('Open Pages & Structure')
    ))).toBe(false);
    expect(exposed.some((node) => (
      valueOf(node.role) === 'button' && valueOf(node.name) === 'Close Booking'
    ))).toBe(true);
    const namedControlRoles = new Set(['button', 'checkbox', 'combobox', 'radio', 'slider']);
    const exposedControls = exposed.filter((node) => namedControlRoles.has(valueOf(node.role)));
    expect(exposedControls.length).toBeGreaterThan(5);
    expect(exposedControls.filter((node) => valueOf(node.name).trim() === '')).toEqual([]);
    expect(await settings.locator(FOCUSABLE_SELECTOR).evaluateAll((elements) => (
      elements.filter((element) => {
        const candidate = element as HTMLElement;
        const style = window.getComputedStyle(candidate);
        return Boolean(candidate.closest('[aria-hidden="true"], [hidden]'))
          || style.display === 'none'
          || style.visibility === 'hidden';
      }).length
    ))).toBe(0);
    await cdp.detach();

    await page.touchscreen.tap(3, 3);
    await expect(settings).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await documentSurfaceState(page)).toEqual(steadyState);

    const actionable = await openBookingSettings(page, 'Home');
    await expect(actionable.settings).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    const preview = await instrumentPreviewActivation(page);
    const backdropPoint = await actionableBackdropPoint(page, preview, actionable.settings);
    await page.touchscreen.tap(backdropPoint.x, backdropPoint.y);
    await expect(actionable.settings).toHaveCount(0);
    await expect(
      bookingCard(page, 'Home').locator('.section-card__select-surface'),
    ).toBeFocused();
    await expectPreviewStayedInactive(page);
    expect(await documentSurfaceState(page)).toEqual(steadyState);
  } finally {
    monitor.assertClean();
    monitor.stop();
    await context.close();
  }
});

test('Booking settings keep meaningful focus and truthful modality across the 900 px breakpoint', async ({
  page,
}) => {
  await page.setViewportSize({ height: 600, width: 375 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await waitForSaved(page);
  const mobile = await openBookingSettings(page, 'Home');
  await expect(mobile.settings).toHaveAttribute('aria-modal', 'true');
  await expect(mobile.settings.locator('[data-dialog-title]')).toBeFocused();

  await page.setViewportSize({ height: 800, width: 920 });
  const desktopSettings = page.getByRole('dialog', { name: 'Booking settings' });
  await expect(desktopSettings).toHaveAttribute('aria-modal', 'false');
  await expect(page.getByTestId('final-hybrid-editor')).not.toHaveAttribute('inert');
  expect((await documentSurfaceState(page)).body.overflow).toBe('');
  await expect(desktopSettings.getByRole('heading', { name: 'Booking' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(desktopSettings).toHaveCount(0);
  const desktopEdit = page
    .getByTestId('selected-section-toolbar')
    .getByRole('button', { name: 'Edit', exact: true });
  await expect(desktopEdit).toBeFocused();

  await desktopEdit.click();
  await expect(desktopSettings.getByRole('heading', { name: 'Booking' })).toBeFocused();
  await page.setViewportSize({ height: 600, width: 375 });
  const mobileSettings = page.getByRole('dialog', { name: 'Booking', exact: true });
  await expect(mobileSettings).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByTestId('final-hybrid-editor')).toHaveAttribute('inert', '');
  expect((await documentSurfaceState(page)).body.overflow).toBe('hidden');
  await expect(mobileSettings.locator('[data-dialog-title]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(mobileSettings).toHaveCount(0);
  const mobileEdit = page
    .getByRole('group', { name: 'Booking actions' })
    .getByRole('button', { name: 'Edit', exact: true });
  await expect(mobileEdit).toBeFocused();
  const released = await documentSurfaceState(page);
  expect(released.body.overflow).toBe('');
  expect(released.editorInert).toBe(false);
});

test('desktop Booking settings remain explicitly nonmodal and keyboard-reachable', async ({
  page,
}) => {
  test.setTimeout(90_000);
  for (const viewport of [
    { height: 800, width: 920 },
    { height: 800, width: 1180 },
  ]) {
    await page.setViewportSize(viewport);
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    await waitForSaved(page);
    const steadyState = await documentSurfaceState(page);
    const { settings, trigger } = await openBookingSettings(page, 'Home');
    await expect(settings).toHaveAttribute('aria-modal', 'false');
    await expect(page.getByTestId('final-hybrid-editor')).not.toHaveAttribute('inert');
    expect(await documentSurfaceState(page)).toEqual(steadyState);
    await expect(settings.getByRole('heading', { name: 'Booking' })).toBeFocused();

    let escaped = false;
    const focusableCount = await settings.locator(FOCUSABLE_SELECTOR).count();
    for (let step = 0; step < focusableCount + 4; step += 1) {
      await page.keyboard.press('Tab');
      escaped = await page.evaluate(() => !document.activeElement?.closest(
        '[role="dialog"][aria-modal="false"]',
      ));
      if (escaped) break;
    }
    expect(escaped).toBe(true);
    const outsideFocus = await page.evaluate((focusableSelector) => {
      const active = document.activeElement as HTMLElement | null;
      return {
        body: active === document.body || active === document.documentElement,
        connected: active?.isConnected ?? false,
        focusable: active?.matches(focusableSelector) ?? false,
        insideDrawer: Boolean(active?.closest('[role="dialog"][aria-modal="false"]')),
      };
    }, FOCUSABLE_SELECTOR);
    expect(outsideFocus).toEqual({
      body: false,
      connected: true,
      focusable: true,
      insideDrawer: false,
    });

    await settings.getByRole('heading', { name: 'Booking' }).focus();
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await documentSurfaceState(page)).toEqual(steadyState);
  }
});
