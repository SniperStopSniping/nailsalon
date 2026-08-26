import { expect, type Locator, type Page } from '@playwright/test';

export const LAB_STORAGE_KEY =
  'luster:site-builder-v2-booking-integration-lab:document:v1';

export type StarterName =
  | 'Quick Book'
  | 'One-page website'
  | 'Multi-page website';

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
