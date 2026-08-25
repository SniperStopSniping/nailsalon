// Preserved as UI-concept exploration evidence. The final hybrid shell no
// longer exposes the concept switcher, so Playwright intentionally does not
// discover this file as an active specification.
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  LAB_STORAGE_KEY,
  addSectionAtBottom,
  chooseStarter,
  openFreshLab,
  reorderLabels,
  requireProject,
  sectionLabels,
  sectionsList,
  selectPage,
} from './helpers';

const CONCEPTS = [
  { cardHeading: 'Concept 1 — Canvas First', switcherName: 'Concept 1 — Canvas First' },
  { cardHeading: 'Concept 2 — Dark Studio', switcherName: 'Concept 2 — Dark Studio' },
  { cardHeading: 'Concept 3 — Mobile First', switcherName: 'Concept 3 — Mobile First' },
  { cardHeading: 'Concept 4 — Split Workspace', switcherName: 'Concept 4 — Split Workspace' },
  { cardHeading: 'Concept 5 — Inline Editor', switcherName: 'Concept 5 — Inline Editor' },
] as const;

type StoredDocument = {
  pages: Array<{
    id: string;
    name: string;
    order: number;
    sections: Array<{
      id: string;
      label: string;
      order: number;
    }>;
  }>;
};

async function storedDocumentText(page: Page): Promise<string | null> {
  return page.evaluate(
    (storageKey) => window.localStorage.getItem(storageKey),
    LAB_STORAGE_KEY,
  );
}

async function storedDocument(page: Page): Promise<StoredDocument | null> {
  const serialized = await storedDocumentText(page);
  return serialized ? JSON.parse(serialized) as StoredDocument : null;
}

async function waitForStoredSectionOrder(
  page: Page,
  pageName: string,
  expectedLabels: string[],
): Promise<void> {
  await expect
    .poll(async () => {
      const document = await storedDocument(page);
      return document?.pages
        .find((candidate) => candidate.name === pageName)
        ?.sections
        .sort((left, right) => left.order - right.order)
        .map((section) => section.label);
    })
    .toEqual(expectedLabels);
}

function conceptSwitcher(page: Page): Locator {
  return page.getByTestId('editor-concept-switcher');
}

function conceptButton(page: Page, name: string): Locator {
  return conceptSwitcher(page).getByRole('button', { exact: true, name });
}

async function activateConcept(page: Page, name: string): Promise<void> {
  const button = conceptButton(page, name);
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

async function selectSection(
  page: Page,
  pageName: string,
  sectionName: string,
): Promise<{ card: Locator; id: string }> {
  const card = sectionsList(page, pageName).getByRole('listitem', {
    name: `${sectionName} on ${pageName}`,
  });
  const selectControl = card.getByRole('button', { exact: true, name: 'Select' });
  const selectSurface = card.locator('.section-card__select-surface');

  await card.hover();
  if (await selectControl.isVisible()) {
    await selectControl.click();
  } else if (await selectSurface.isVisible()) {
    await selectSurface.focus();
    await selectSurface.press('Enter');
  } else {
    await card.click();
  }

  await expect(card).toHaveClass(/is-selected/);
  const id = await card.getAttribute('data-section-instance-id');
  expect(id).toBeTruthy();
  return { card, id: id as string };
}

function galleryCard(page: Page, heading: string): Locator {
  return page.getByRole('article').filter({
    has: page.getByRole('heading', { exact: true, name: heading }),
  });
}

test('switching all five concepts preserves the exact document, active selection, and history state', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'chromium');
  await openFreshLab(page);
  await chooseStarter(page, 'Multi-page website');

  await addSectionAtBottom(page, 'Home', 11);
  await addSectionAtBottom(page, 'Home', 12);
  await page.getByRole('button', { exact: true, name: 'Undo' }).click();
  await waitForStoredSectionOrder(page, 'Home', [
    'Section 01',
    'Section 02',
    'Section 11',
  ]);

  await selectPage(page, 'Gallery');
  const selected = await selectSection(page, 'Gallery', 'Section 04');
  const expectedDocumentText = await storedDocumentText(page);
  const expectedDocument = await storedDocument(page);
  expect(expectedDocumentText).toBeTruthy();
  expect(expectedDocument).not.toBeNull();

  const expectedPageState = expectedDocument?.pages.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    order: candidate.order,
    sectionIds: candidate.sections.map((section) => section.id),
  }));

  for (const concept of CONCEPTS) {
    await activateConcept(page, concept.switcherName);
    await expect.poll(() => storedDocumentText(page)).toBe(expectedDocumentText);
    await expect(page.getByRole('heading', { exact: true, level: 1, name: 'Gallery' })).toBeVisible();
    await expect(
      page.locator(`[data-section-instance-id="${selected.id}"]`),
    ).toHaveClass(/is-selected/);
    await expect(sectionLabels(page, 'Gallery')).resolves.toEqual(['Section 04']);
    await expect(page.getByRole('button', { exact: true, name: 'Undo' })).toBeEnabled();
    await expect(page.getByRole('button', { exact: true, name: 'Redo' })).toBeEnabled();

    const currentPageState = (await storedDocument(page))?.pages.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      order: candidate.order,
      sectionIds: candidate.sections.map((section) => section.id),
    }));
    expect(currentPageState).toEqual(expectedPageState);
  }

  await page.getByRole('button', { exact: true, name: 'Redo' }).click();
  await waitForStoredSectionOrder(page, 'Home', [
    'Section 01',
    'Section 02',
    'Section 11',
    'Section 12',
  ]);
  await page.getByRole('button', { exact: true, name: 'Undo' }).click();
  await expect.poll(() => storedDocumentText(page)).toBe(expectedDocumentText);
  await expect(page.locator(`[data-section-instance-id="${selected.id}"]`)).toHaveClass(
    /is-selected/,
  );
});

test('the chosen concept survives reload while reorder and preview retain their existing behavior', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'chromium');
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await activateConcept(page, 'Concept 2 — Dark Studio');

  await page
    .getByRole('group', { name: 'Editor modes' })
    .getByRole('button', { exact: true, name: 'Reorder' })
    .click();
  await page.getByRole('button', { name: 'Move Section 02 up' }).click();
  await expect(reorderLabels(page)).resolves.toEqual([
    'Section 02',
    'Section 01',
    'Booking access',
  ]);
  await page.getByRole('button', { exact: true, name: 'Done' }).click();
  await waitForStoredSectionOrder(page, 'Home', [
    'Section 02',
    'Section 01',
    'Booking access',
  ]);

  await activateConcept(page, 'Concept 4 — Split Workspace');
  const expectedDocumentText = await storedDocumentText(page);
  expect(expectedDocumentText).toBeTruthy();
  await page.reload();

  await expect(
    conceptButton(page, 'Concept 4 — Split Workspace'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => storedDocumentText(page)).toBe(expectedDocumentText);
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Section 02',
    'Section 01',
    'Booking access',
  ]);

  await activateConcept(page, 'Concept 5 — Inline Editor');
  await page
    .getByRole('group', { name: 'Editor modes' })
    .getByRole('button', { exact: true, name: 'Preview' })
    .click();
  await expect(page.getByTestId('preview-stage')).toBeVisible();
  await page
    .getByRole('group', { name: 'Preview viewport' })
    .getByRole('button', { exact: true, name: 'Mobile' })
    .click();
  await expect(page.getByTestId('preview-stage')).toHaveClass(/preview-stage--mobile/);
  await expect.poll(() => storedDocumentText(page)).toBe(expectedDocumentText);
  await page.getByRole('button', { exact: true, name: 'Done' }).click();
  await expect(
    conceptButton(page, 'Concept 5 — Inline Editor'),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('the UI Concept Gallery exposes every concept and both activation paths preserve site state', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'chromium');
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await addSectionAtBottom(page, 'Home', 11);
  const selected = await selectSection(page, 'Home', 'Section 11');
  await waitForStoredSectionOrder(page, 'Home', [
    'Section 01',
    'Section 02',
    'Booking access',
    'Section 11',
  ]);
  const expectedDocumentText = await storedDocumentText(page);

  await page.getByRole('button', { exact: true, name: 'Open UI concept gallery' }).click();
  await expect(page.getByRole('heading', { exact: true, name: 'UI Concept Gallery' })).toBeVisible();
  for (const concept of CONCEPTS) {
    const card = galleryCard(page, concept.cardHeading);
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { exact: true, name: 'Open concept' })).toBeVisible();
    await expect(
      card.getByRole('button', { exact: true, name: 'Use same site state' }),
    ).toBeVisible();
  }
  await expect.poll(() => storedDocumentText(page)).toBe(expectedDocumentText);

  await galleryCard(page, 'Concept 3 — Mobile First')
    .getByRole('button', { exact: true, name: 'Use same site state' })
    .click();
  await expect(
    conceptButton(page, 'Concept 3 — Mobile First'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => storedDocumentText(page)).toBe(expectedDocumentText);
  await expect(page.locator(`[data-section-instance-id="${selected.id}"]`)).toHaveClass(
    /is-selected/,
  );

  await page.getByRole('button', { exact: true, name: 'Open UI concept gallery' }).click();
  await galleryCard(page, 'Concept 5 — Inline Editor')
    .getByRole('button', { exact: true, name: 'Open concept' })
    .click();
  await expect(
    conceptButton(page, 'Concept 5 — Inline Editor'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => storedDocumentText(page)).toBe(expectedDocumentText);
  await expect(page.locator(`[data-section-instance-id="${selected.id}"]`)).toHaveClass(
    /is-selected/,
  );
});

test('the mobile concept switcher and core editor controls retain accessible names and touch targets', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'mobile-chromium');
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const expectedDocumentText = await storedDocumentText(page);

  await expect(conceptSwitcher(page)).toBeVisible();
  for (const concept of CONCEPTS) {
    const button = conceptButton(page, concept.switcherName);
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
    const bounds = await button.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    await activateConcept(page, concept.switcherName);
    await expect.poll(() => storedDocumentText(page)).toBe(expectedDocumentText);

    await page.evaluate(() => window.scrollTo(0, 320));
    const dockBounds = await page.locator('.concept-lab-dock').boundingBox();
    const toolbarBounds = await page.locator('.top-toolbar').boundingBox();
    expect(toolbarBounds?.y).toBeGreaterThanOrEqual(
      (dockBounds?.y ?? 0) + (dockBounds?.height ?? 0) - 1,
    );
    await page.evaluate(() => window.scrollTo(0, 0));

    const modes = page.getByRole('group', { name: 'Editor modes' });
    await expect(modes.getByRole('button', { exact: true, name: 'Edit' })).toBeVisible();
    await expect(modes.getByRole('button', { exact: true, name: 'Reorder' })).toBeVisible();
    await expect(modes.getByRole('button', { exact: true, name: 'Preview' })).toBeVisible();
  }

  await activateConcept(page, 'Concept 1 — Canvas First');
  const selected = await selectSection(page, 'Home', 'Section 01');
  const actions = page.getByRole('dialog', { name: 'Section 01 actions' });
  await expect(actions).toBeVisible();
  for (const name of [
    'Edit placeholder settings',
    'Hide section',
    'Move to another page',
    'Remove from this page',
  ]) {
    const action = actions.getByRole('button', { exact: true, name });
    const bounds = await action.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
  await actions.getByRole('button', { name: 'Close Section 01 actions' }).click();
  await expect(page.locator(`[data-section-instance-id="${selected.id}"]`)).toHaveClass(
    /is-selected/,
  );

  await page
    .getByRole('group', { name: 'Editor modes' })
    .getByRole('button', { exact: true, name: 'Reorder' })
    .click();
  await expect(page.getByTestId('reorder-list')).toBeVisible();
  const dragHandle = page.getByRole('button', {
    name: 'Drag Section 01. Use arrow keys after lifting with Space.',
  });
  const dragBounds = await dragHandle.boundingBox();
  expect(dragBounds?.height).toBeGreaterThanOrEqual(44);
  expect(dragBounds?.width).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { exact: true, name: 'Done' }).click();

  await page
    .getByRole('group', { name: 'Editor modes' })
    .getByRole('button', { exact: true, name: 'Preview' })
    .click();
  await expect(page.getByTestId('preview-stage')).toBeVisible();
  await page.getByRole('button', { exact: true, name: 'Done' }).click();
  await expect.poll(() => storedDocumentText(page)).toBe(expectedDocumentText);
});
