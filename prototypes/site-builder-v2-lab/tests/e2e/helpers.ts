import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

export const LAB_STORAGE_KEY = 'luster.site-builder-v2-lab.schema-1';

export function requireProject(testInfo: TestInfo, projectName: string): void {
  testInfo.skip(
    testInfo.project.name !== projectName,
    `Covered by the ${projectName} project.`,
  );
}

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
  starter: 'Quick Book' | 'One-page website' | 'Multi-page website',
): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${starter}`) }).click();
  await expect(page.getByRole('group', { name: 'Editor modes' })).toBeVisible();
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
    .locator('.reorder-row > .reorder-row__label > strong')
    .allTextContents();
}

export async function pageNames(page: Page): Promise<string[]> {
  return page
    .getByRole('list', { name: 'Site pages' })
    .locator(':scope > li .page-list-button__copy > strong')
    .allTextContents();
}

export async function selectPage(page: Page, pageName: string): Promise<void> {
  const pages = page.getByRole('list', { name: 'Site pages' });
  await pages
    .locator(':scope > li')
    .filter({ has: page.locator('strong', { hasText: pageName }) })
    .getByRole('button')
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1, name: pageName })).toBeVisible();
}

export async function addSectionAtBottom(
  page: Page,
  pageName: string,
  sectionNumber: number,
): Promise<void> {
  const bottom = page.getByRole('button', {
    name: `Add section at bottom of ${pageName}`,
  });
  const insertionControl = (await bottom.count()) > 0
    ? bottom
    : page.getByRole('button', { name: `Add section at top of ${pageName}` });
  await insertionControl.click();
  const library = page.getByRole('dialog', { name: 'Section library' });
  await expect(library).toBeVisible();
  await library
    .getByRole('button', {
      name: `Add Section ${String(sectionNumber).padStart(2, '0')}`,
      exact: true,
    })
    .click();
}

export async function addPage(
  page: Page,
  name: string,
  address = '',
): Promise<void> {
  await page.getByRole('button', { name: 'Add page', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add page' });
  await dialog.getByLabel('Page name').fill(name);
  if (address) {
    await dialog.getByLabel('Page address').fill(address);
  }
  await dialog.getByRole('button', { name: 'Add page', exact: true }).click();
}

export async function removePage(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Remove ${name} page` }).click();
  const confirmation = page.getByRole('dialog', { name: 'Remove this page?' });
  await confirmation.getByRole('button', { name: 'Remove page' }).click();
}

export async function startAgain(
  page: Page,
  starter: 'Quick Book' | 'One-page website' | 'Multi-page website',
): Promise<void> {
  await page.getByRole('button', { name: 'Lab options' }).click();
  await page
    .getByRole('dialog', { name: 'Lab options' })
    .getByRole('button', { name: 'Start again from another kit' })
    .click();
  await page
    .getByRole('dialog', { name: 'Start again from a kit' })
    .getByRole('button', { name: new RegExp(`^${starter}`) })
    .click();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText(
    'Saved',
  );
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
