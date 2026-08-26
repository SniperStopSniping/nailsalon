import {
  expect,
  type ConsoleMessage,
  type Locator,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';

export const LAB_STORAGE_KEY =
  'luster:site-builder-v2-booking-integration-lab:document:v1';

export type StarterName =
  | 'Quick Book'
  | 'One-page website'
  | 'Multi-page website';

export type StoredLabDocument = {
  navigation: {
    enabled: boolean;
  };
  pages: Array<{
    id: string;
    name: string;
    sections: Array<{
      id: string;
      label: string;
      order: number;
      sectionType: string;
    }>;
    visible: boolean;
    visibleInNavigation: boolean;
  }>;
};

export type DocumentSurfaceState = {
  body: {
    attributes: Record<string, string>;
    overflow: string;
    paddingRight: string;
    pointerEvents: string;
    position: string;
    top: string;
  };
  editorAriaHidden: string | null;
  editorInert: boolean;
  html: {
    attributes: Record<string, string>;
    overflow: string;
    paddingRight: string;
    pointerEvents: string;
    position: string;
    top: string;
  };
};

type RuntimeMonitor = {
  assertClean: () => void;
  stop: () => void;
};

export async function openFreshLab(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Choose your starting point' }),
  ).toBeVisible();
}

export async function chooseStarter(
  page: Page,
  starter: StarterName,
): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${starter}`) }).click();
  await expect(page.getByTestId('final-hybrid-editor')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        (key) => window.localStorage.getItem(key) !== null,
        LAB_STORAGE_KEY,
      ),
    )
    .toBe(true);
}

export async function waitForSaved(page: Page): Promise<void> {
  await expect(page.getByLabel('Save status')).toContainText('Saved');
}

export async function readStoredDocumentJson(page: Page): Promise<string | null> {
  return page.evaluate(
    (key) => window.localStorage.getItem(key),
    LAB_STORAGE_KEY,
  );
}

export async function readStoredDocument(page: Page): Promise<StoredLabDocument> {
  const json = await readStoredDocumentJson(page);
  if (!json) {
    throw new Error('The Lab document is missing from localStorage.');
  }
  return JSON.parse(json) as StoredLabDocument;
}

export function startRuntimeMonitor(page: Page): RuntimeMonitor {
  const issues: string[] = [];
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      issues.push(`console.${message.type()}: ${message.text()}`);
    }
  };
  const onPageError = (error: Error) => {
    issues.push(`pageerror: ${error.message}`);
  };
  const onRequestFailed = (request: Request) => {
    issues.push(
      `requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.trim(),
    );
  };
  const onResponse = (response: Response) => {
    if (response.status() < 400) return;
    const currentUrl = page.url();
    const sameOrigin = currentUrl.startsWith('http')
      && new URL(response.url()).origin === new URL(currentUrl).origin;
    if (sameOrigin) {
      issues.push(`response.${response.status()}: ${response.request().method()} ${response.url()}`);
    }
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  return {
    assertClean: () => expect(issues, 'unexpected browser runtime issues').toEqual([]),
    stop: () => {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
    },
  };
}

export async function documentSurfaceState(
  page: Page,
): Promise<DocumentSurfaceState> {
  return page.evaluate(() => {
    const lockAttributes = (element: HTMLElement): Record<string, string> =>
      Object.fromEntries(
        element
          .getAttributeNames()
          .filter((name) => /(?:lock|scroll|inert|aria-hidden|pointer)/i.test(name))
          .map((name) => [name, element.getAttribute(name) ?? '']),
      );
    const stateFor = (element: HTMLElement) => ({
      attributes: lockAttributes(element),
      overflow: element.style.overflow,
      paddingRight: element.style.paddingRight,
      pointerEvents: element.style.pointerEvents,
      position: element.style.position,
      top: element.style.top,
    });
    const editor = document.querySelector<HTMLElement>('[data-testid="final-hybrid-editor"]');
    return {
      body: stateFor(document.body),
      editorAriaHidden: editor?.getAttribute('aria-hidden') ?? null,
      editorInert: editor?.hasAttribute('inert') ?? false,
      html: stateFor(document.documentElement),
    };
  });
}

export function sectionsList(page: Page, pageName: string): Locator {
  return page.getByRole('list', { name: `Sections on ${pageName}` });
}

export async function sectionLabels(
  page: Page,
  pageName: string,
): Promise<string[]> {
  return sectionsList(page, pageName)
    .locator('[data-section-label]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-section-label') ?? ''),
    );
}

export async function reorderLabels(page: Page): Promise<string[]> {
  return page
    .getByTestId('reorder-list')
    .locator('.reorder-row .reorder-row__label > strong')
    .allTextContents();
}

export async function openPagesAndStructure(page: Page): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: 'Pages & Structure' });
  if (!(await dialog.isVisible())) {
    await page
      .getByRole('button', { name: /^Open Pages & Structure for / })
      .click();
  }
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function closePagesAndStructure(dialog: Locator): Promise<void> {
  await dialog
    .getByRole('button', { name: 'Close Pages & Structure' })
    .click();
  await expect(dialog).toHaveCount(0);
}

export async function pageNames(page: Page): Promise<string[]> {
  const structure = await openPagesAndStructure(page);
  const names = await structure
    .getByRole('list', { name: 'Site pages' })
    .locator(':scope > li .final-structure__page-select strong')
    .allTextContents();
  await closePagesAndStructure(structure);
  return names;
}

export async function selectPageFromStructure(
  page: Page,
  pageName: string,
): Promise<void> {
  const structure = await openPagesAndStructure(page);
  await structure
    .locator('.final-structure__page-select')
    .filter({ hasText: pageName })
    .first()
    .click();
  if (await structure.isVisible()) {
    await closePagesAndStructure(structure);
  }
  await expect(
    page.getByRole('heading', { level: 1, name: pageName }),
  ).toBeVisible();
}

export function bookingCard(page: Page, pageName: string): Locator {
  return sectionsList(page, pageName).getByRole('listitem', {
    name: `Booking on ${pageName}`,
  });
}

export async function selectBooking(page: Page, pageName: string): Promise<Locator> {
  const card = bookingCard(page, pageName);
  if (!(await card.evaluate((element) => element.classList.contains('is-selected')))) {
    await card.locator('.section-card__select-surface').click();
  }
  await expect(card).toHaveClass(/is-selected/);
  return card;
}

export async function openMoveFromStructure(page: Page): Promise<Locator> {
  const structure = await openPagesAndStructure(page);
  await structure
    .getByRole('button', { name: 'Arrange sections', exact: true })
    .click();
  const move = page.getByRole('dialog', { name: 'Arrange sections' });
  await expect(move).toBeVisible();
  await expect(move.getByTestId('reorder-list')).toBeVisible();
  return move;
}

export async function openMoveForBooking(
  page: Page,
  pageName: string,
): Promise<Locator> {
  await selectBooking(page, pageName);
  const returnToBooking = page.getByRole('button', { name: 'Back to Booking' });
  const mobileMove = page
    .getByRole('group', { name: 'Booking actions' })
    .getByRole('button', { name: 'Move', exact: true });
  const desktopMove = page
    .getByTestId('selected-section-toolbar')
    .getByRole('button', { name: 'Move', exact: true });
  await expect(mobileMove.or(desktopMove).or(returnToBooking)).toBeVisible();
  if (await returnToBooking.isVisible()) {
    await returnToBooking.click();
  }
  await expect(mobileMove.or(desktopMove)).toBeVisible();
  if (await mobileMove.isVisible()) {
    await mobileMove.click();
  } else {
    await desktopMove.click();
  }
  const move = page.getByRole('dialog', { name: 'Move Booking' });
  await expect(move).toBeVisible();
  return move;
}

export async function openMoveForBookingVia(
  page: Page,
  pageName: string,
  entry: 'desktop' | 'mobile',
): Promise<{ move: Locator; trigger: Locator }> {
  await selectBooking(page, pageName);
  const returnToBooking = page.getByRole('button', { name: 'Back to Booking' });
  if (await returnToBooking.isVisible()) {
    await returnToBooking.click();
  }
  const trigger = entry === 'mobile'
    ? page
        .getByRole('group', { name: 'Booking actions' })
        .getByRole('button', { name: 'Move', exact: true })
    : page
        .getByTestId('selected-section-toolbar')
        .getByRole('button', { name: 'Move', exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const move = page.getByRole('dialog', { name: 'Move Booking' });
  await expect(move).toBeVisible();
  return { move, trigger };
}

export async function openBookingSettings(
  page: Page,
  pageName: string,
): Promise<{ settings: Locator; trigger: Locator }> {
  await selectBooking(page, pageName);
  const mobileTrigger = page
    .getByRole('group', { name: 'Booking actions' })
    .getByRole('button', { name: 'Edit', exact: true });
  const desktopTrigger = page
    .getByTestId('selected-section-toolbar')
    .getByRole('button', { name: 'Edit', exact: true });
  const trigger = await mobileTrigger.isVisible() ? mobileTrigger : desktopTrigger;
  await expect(trigger).toBeVisible();
  await trigger.click();
  const desktopSettings = page.getByRole('dialog', { name: 'Booking settings' });
  const mobileSettings = page.getByRole('dialog', { name: 'Booking', exact: true });
  const settings = await desktopSettings.isVisible()
    ? desktopSettings
    : mobileSettings;
  await expect(settings).toBeVisible();
  await expect(settings.getByTestId('booking-settings-panel')).toBeVisible();
  return { settings, trigger };
}

export function destinationPageButton(
  move: Locator,
  pageName: string,
): Locator {
  const escapedName = pageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return move
    .getByRole('list', { name: 'Destination pages' })
    .getByRole('button', {
      name: new RegExp(`^${escapedName}(?:\\s|$)`),
    });
}

export async function moveSectionToPosition(
  move: Locator,
  sectionName: string,
  position: number,
): Promise<void> {
  const input = move.getByLabel(`Position for ${sectionName}`);
  await input.fill(String(position));
  await input.press('Enter');
  await expect(input).toHaveValue(String(position));
}

export async function expectStickyOwnerToolbarReachable(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
  const topbar = page.getByRole('banner', { name: 'Site builder toolbar' });
  await expect(topbar).toBeVisible();
  await expect(topbar).toHaveCSS('position', 'sticky');
  const box = await topbar.boundingBox();
  expect(box, 'sticky top bar has geometry after a substantial scroll').not.toBeNull();
  if (box) {
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.y).toBeLessThanOrEqual(1);
  }
  for (const name of ['Preview', 'Undo', 'Redo', 'More site options']) {
    const control = topbar.getByRole('button', { name, exact: true });
    if (!(await control.isVisible())) {
      continue;
    }
    const hitTestable = await control.evaluate((element) => {
      const rectangle = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rectangle.left + rectangle.width / 2,
        rectangle.top + rectangle.height / 2,
      );
      return hit === element || (hit !== null && element.contains(hit));
    });
    expect(hitTestable, `${name} remains hit-testable`).toBe(true);
  }
}

export async function expectNoDocumentOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    overflowingElements: [...document.querySelectorAll<HTMLElement>('body *')]
      .map((element) => {
        const rectangle = element.getBoundingClientRect();
        return {
          className: element.className,
          right: Math.round(rectangle.right),
          tagName: element.tagName,
        };
      })
      .filter((element) => element.right > document.documentElement.clientWidth + 1)
      .slice(0, 8),
  }));

  expect(
    dimensions.documentScrollWidth,
    `document overflow: ${dimensions.documentScrollWidth} > ${dimensions.documentClientWidth}; elements=${JSON.stringify(dimensions.overflowingElements)}`,
  ).toBeLessThanOrEqual(dimensions.documentClientWidth);
  expect(
    dimensions.bodyScrollWidth,
    `body overflow: ${dimensions.bodyScrollWidth} > ${dimensions.bodyClientWidth}; elements=${JSON.stringify(dimensions.overflowingElements)}`,
  ).toBeLessThanOrEqual(dimensions.bodyClientWidth);
}

export async function closeDialog(page: Page, title: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: title });
  await dialog.getByRole('button', { name: `Close ${title}` }).click();
  await expect(dialog).toHaveCount(0);
}
