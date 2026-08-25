import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  LAB_STORAGE_KEY,
  expectNoDocumentOverflow,
  openFreshLab,
  reorderLabels,
  requireProject,
  sectionLabels,
  sectionsList,
} from './helpers';

type StoredSection = {
  id: string;
  label: string;
  order: number;
  [key: string]: unknown;
};

type StoredPage = {
  id: string;
  name: string;
  sections: StoredSection[];
  [key: string]: unknown;
};

type StoredDocument = {
  pages: StoredPage[];
  [key: string]: unknown;
};

async function chooseQuickBook(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Quick Book/i }).click();
  await expect(
    page.getByRole('button', { name: 'Open Pages & Structure for Home' }),
  ).toBeVisible();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText(
    'Saved',
  );
}

async function chooseMultiPage(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Multi-page website/i }).click();
  await expect(
    page.getByRole('button', { name: 'Open Pages & Structure for Home' }),
  ).toBeVisible();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText(
    'Saved',
  );
}

async function storedDocumentText(page: Page): Promise<string> {
  await expect
    .poll(() =>
      page.evaluate(
        (storageKey) => window.localStorage.getItem(storageKey),
        LAB_STORAGE_KEY,
      ),
    )
    .not.toBeNull();

  return await page.evaluate(
    (storageKey) => window.localStorage.getItem(storageKey) as string,
    LAB_STORAGE_KEY,
  );
}

async function storedDocument(page: Page): Promise<StoredDocument> {
  return JSON.parse(await storedDocumentText(page)) as StoredDocument;
}

async function expectStoredDocument(
  page: Page,
  expected: string,
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        (storageKey) => window.localStorage.getItem(storageKey),
        LAB_STORAGE_KEY,
      ),
    )
    .toBe(expected);
}

function sectionCard(
  page: Page,
  pageName: string,
  sectionName: string,
): Locator {
  return sectionsList(page, pageName).getByRole('listitem', {
    name: `${sectionName} on ${pageName}`,
  });
}

async function selectSection(
  page: Page,
  pageName: string,
  sectionName: string,
): Promise<Locator> {
  const card = sectionCard(page, pageName, sectionName);
  await card.getByRole('button').first().click();
  await expect(card).toHaveClass(/is-selected/);
  return card;
}

async function expectTouchTarget(control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  const bounds = await control.boundingBox();
  expect(bounds, 'control should have measurable mobile geometry').not.toBeNull();
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  expect(bounds?.width).toBeGreaterThanOrEqual(44);
}

async function expectDialogOwnsFocus(dialog: Locator): Promise<void> {
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
}

async function closeDialog(page: Page, title: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: title });
  await dialog.getByRole('button', { name: `Close ${title}` }).click();
  await expect(dialog).toHaveCount(0);
}

async function expectEmptyHistory(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More site options' }).click();
  const undo = page.getByRole('button', { name: 'Undo', exact: true }).last();
  const redo = page.getByRole('button', { name: 'Redo', exact: true }).last();
  await expect(undo).toBeVisible();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await page.keyboard.press('Escape');
}

async function enterReorder(page: Page): Promise<void> {
  const directControl = page.getByRole('button', {
    name: 'Reorder sections',
    exact: true,
  });

  if (!(await directControl.isVisible())) {
    await page
      .getByRole('button', { name: /Open Pages & Structure for/ })
      .click();
    const structure = page.getByRole('dialog', { name: 'Pages & Structure' });
    await structure
      .getByRole('button', { name: 'Reorder sections', exact: true })
      .click();
  } else {
    await directControl.click();
  }

  await expect(page.getByTestId('reorder-list')).toBeVisible();
}

function withoutSectionPlacement(document: StoredDocument): StoredDocument {
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      sections: page.sections
        .map(({ order: _order, ...section }) => section)
        .sort((left, right) =>
          String(left.id).localeCompare(String(right.id)),
        ) as StoredSection[],
    })),
  };
}

test('mobile final hybrid keeps the website primary and shell-only interactions out of document history', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'mobile-chromium');
  await openFreshLab(page);
  await chooseQuickBook(page);

  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Editor modes' }),
  ).toHaveCount(0);
  await expect(page.getByTestId('editor-concept-switcher')).toHaveCount(0);
  await expect(page.locator('.pages-panel')).toBeHidden();
  await expect(page.locator('.inspector-panel')).toBeHidden();
  await expectNoDocumentOverflow(page);

  const pageTrigger = page.getByRole('button', {
    name: 'Open Pages & Structure for Home',
  });
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  const more = page.getByRole('button', { name: 'More site options' });
  const addSection = page.getByRole('button', {
    name: 'Add section',
    exact: true,
  });
  for (const control of [pageTrigger, preview, more, addSection]) {
    await expectTouchTarget(control);
  }

  const initialDocument = await storedDocumentText(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expectStoredDocument(page, initialDocument);

  const selected = await selectSection(page, 'Home', 'Section 01');
  await expect(selected.getByRole('button').first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expectStoredDocument(page, initialDocument);

  const actions = page.getByRole('group', { name: 'Section 01 actions' });
  for (const actionName of ['Edit', 'Move', 'Hide', 'More']) {
    await expectTouchTarget(
      actions.getByRole('button', { name: actionName, exact: true }),
    );
  }

  await actions.getByRole('button', { name: 'Edit', exact: true }).click();
  const editSheet = page.getByRole('dialog', { name: 'Edit Section 01' });
  await expect(editSheet).toBeVisible();
  await expectDialogOwnsFocus(editSheet);
  await expectStoredDocument(page, initialDocument);
  await closeDialog(page, 'Edit Section 01');

  await actions.getByRole('button', { name: 'Move', exact: true }).click();
  const moveSheet = page.getByRole('dialog', {
    name: /^Move Section 01/,
  });
  await expect(moveSheet).toBeVisible();
  await expectDialogOwnsFocus(moveSheet);
  await expectStoredDocument(page, initialDocument);
  await moveSheet.getByRole('button', { name: /^Close Move Section 01/ }).click();

  await page.keyboard.press('Escape');
  await expect(actions).toHaveCount(0);
  await expect(addSection).toBeVisible();

  await addSection.click();
  const library = page.getByRole('dialog', { name: 'Add section' });
  await expect(library).toBeVisible();
  await expectDialogOwnsFocus(library);
  await expectStoredDocument(page, initialDocument);
  await closeDialog(page, 'Add section');

  await more.click();
  const moreSheet = page.getByRole('dialog', { name: 'More' });
  const heightSimulation = moreSheet.getByRole('switch', {
    name: 'Simulate real section heights',
  });
  await heightSimulation.click();
  await expect(heightSimulation).toHaveAttribute('aria-checked', 'true');
  await expectStoredDocument(page, initialDocument);
  await moreSheet.getByRole('button', { name: 'Close More' }).click();

  await expectEmptyHistory(page);
  await expectStoredDocument(page, initialDocument);
});

test('Pages & Structure synchronizes page and section selection without mutating content', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'mobile-chromium');
  await openFreshLab(page);
  await chooseMultiPage(page);
  const initialDocument = await storedDocumentText(page);

  await page
    .getByRole('button', { name: 'Open Pages & Structure for Home' })
    .click();
  let structure = page.getByRole('dialog', { name: 'Pages & Structure' });
  await expect(structure).toBeVisible();
  await expect(structure.getByTestId('structure-tree')).toBeVisible();
  await expectDialogOwnsFocus(structure);
  await expectStoredDocument(page, initialDocument);

  await structure.getByRole('button', { name: /Gallery/ }).first().click();
  await expect(
    page.getByRole('button', { name: 'Open Pages & Structure for Gallery' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Gallery' })).toBeVisible();
  await expectStoredDocument(page, initialDocument);

  await page
    .getByRole('button', { name: 'Open Pages & Structure for Gallery' })
    .click();
  structure = page.getByRole('dialog', { name: 'Pages & Structure' });
  await structure.getByRole('button', { name: /Section 04/ }).click();
  const selected = sectionCard(page, 'Gallery', 'Section 04');
  await expect(selected).toHaveClass(/is-selected/);
  await expect(
    page.getByRole('group', { name: 'Section 04 actions' }),
  ).toBeVisible();
  await expectStoredDocument(page, initialDocument);
  await expectEmptyHistory(page);
});

test('Preview and device switching remove editing chrome without changing the document', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'mobile-chromium');
  await openFreshLab(page);
  await chooseQuickBook(page);
  const selected = await selectSection(page, 'Home', 'Section 01');
  const initialDocument = await storedDocumentText(page);

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back to editor' })).toBeVisible();
  await expect(page.getByTestId('preview-stage')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add section', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('group', { name: 'Section 01 actions' }),
  ).toHaveCount(0);
  await expect(page.locator('.section-card, .section-context-toolbar')).toHaveCount(0);

  const viewportControls = page.getByRole('group', { name: 'Preview viewport' });
  await viewportControls
    .getByRole('button', { name: 'Phone', exact: true })
    .click();
  await expect(page.getByTestId('preview-stage')).toHaveClass(
    /preview-stage--mobile/,
  );
  await expectStoredDocument(page, initialDocument);
  await expectNoDocumentOverflow(page);

  await page.getByRole('button', { name: 'Back to editor' }).click();
  await expect(selected).toHaveClass(/is-selected/);
  await expectStoredDocument(page, initialDocument);
  await expectEmptyHistory(page);
});

test('dedicated reorder cancels to the exact baseline, commits only order, and survives reload', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'mobile-chromium');
  await openFreshLab(page);
  await chooseQuickBook(page);
  const initialText = await storedDocumentText(page);
  const initialDocument = await storedDocument(page);

  await enterReorder(page);
  await expect(page.getByText('Reordering', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Open Pages & Structure for/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Preview', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'More site options' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Redo', exact: true }),
  ).toHaveCount(0);
  const dragHandle = page.getByRole('button', {
    name: 'Drag Section 02. Use arrow keys after lifting with Space.',
  });
  await expectTouchTarget(dragHandle);
  await page.getByRole('button', { name: 'Move Section 02 up' }).click();
  await expect(reorderLabels(page)).resolves.toEqual([
    'Section 02',
    'Section 01',
    'Booking access',
  ]);
  await page
    .getByRole('group', { name: 'Reorder actions' })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Section 01',
    'Section 02',
    'Booking access',
  ]);
  await expectStoredDocument(page, initialText);
  await expectEmptyHistory(page);

  await enterReorder(page);
  await page.getByRole('button', { name: 'Move Section 02 up' }).click();
  await expect(page.getByTestId('reorder-live-region')).toHaveText(
    'Section 02 moved to position 1 of 3.',
  );
  await page
    .getByRole('group', { name: 'Reorder actions' })
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText(
    'Saved',
  );
  const committedDocument = await storedDocument(page);
  expect(withoutSectionPlacement(committedDocument)).toEqual(
    withoutSectionPlacement(initialDocument),
  );
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Section 02',
    'Section 01',
    'Booking access',
  ]);

  const committedText = await storedDocumentText(page);
  expect(committedText).not.toBe(initialText);
  await page.reload();
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Section 02',
    'Section 01',
    'Booking access',
  ]);
  await expectStoredDocument(page, committedText);
});

test('the final visible booking path cannot be removed and the explanation uses owner language', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'mobile-chromium');
  await openFreshLab(page);
  await chooseQuickBook(page);
  const initialDocument = await storedDocumentText(page);

  const booking = await selectSection(page, 'Home', 'Booking access');
  const actions = page.getByRole('group', { name: 'Booking access actions' });
  await actions.getByRole('button', { name: 'More', exact: true }).click();
  const secondaryActions = page.getByRole('dialog', {
    name: 'Booking access actions',
  });
  await secondaryActions
    .getByRole('button', { name: /^Remove from (this )?page$/ })
    .click();

  const protection = page.getByRole('dialog', { name: 'Keep a way to book' });
  await expect(protection).toBeVisible();
  await expect(protection.getByRole('alert')).toContainText(
    'Your site needs at least one visible way for clients to start booking.',
  );
  await expect(protection.getByRole('alert')).toContainText(
    'Add or move another Booking section before removing this one.',
  );
  await expectStoredDocument(page, initialDocument);
  await expect(booking).toBeVisible();

  await protection
    .getByRole('button', { name: 'Keep booking access' })
    .click();
  if (await secondaryActions.isVisible()) {
    await secondaryActions
      .getByRole('button', { name: 'Close Booking access actions' })
      .click();
  }
  await expectEmptyHistory(page);
  await expectStoredDocument(page, initialDocument);
});

test('a local save failure exposes backup and reset options', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'mobile-chromium');
  await openFreshLab(page);
  await chooseQuickBook(page);

  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage unavailable', 'QuotaExceededError');
    };
  });

  await selectSection(page, 'Home', 'Section 01');
  await page
    .getByRole('group', { name: 'Section 01 actions' })
    .getByRole('button', { name: 'Hide', exact: true })
    .click();

  const recovery = page.getByRole('button', {
    name: 'Local save failed. Open backup and reset options',
  });
  await expect(recovery).toBeVisible();
  await recovery.click();
  const moreSheet = page.getByRole('dialog', { name: 'More' });
  await expect(moreSheet.getByRole('button', { name: 'Export JSON' })).toBeVisible();
  await expect(moreSheet.getByRole('button', { name: 'Reset Lab' })).toBeVisible();
});

test('desktop expands the same direct-canvas model with temporary edit and structure drawers', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'chromium');
  await openFreshLab(page);
  await chooseQuickBook(page);
  const initialDocument = await storedDocumentText(page);

  await expect(page.locator('.pages-panel')).toBeHidden();
  await expect(page.locator('.inspector-panel')).toBeHidden();
  const selected = await selectSection(page, 'Home', 'Section 01');
  await expect(selected.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(selected.getByRole('button', { name: 'Move', exact: true })).toBeVisible();
  await expect(
    selected.getByRole('button', { name: 'More actions for Section 01' }),
  ).toBeVisible();

  await selected.getByRole('button', { name: 'Edit', exact: true }).click();
  const editDrawer = page.getByRole('dialog', { name: 'Edit Section 01' });
  await expect(editDrawer).toBeVisible();
  await expectStoredDocument(page, initialDocument);
  await closeDialog(page, 'Edit Section 01');

  await page
    .getByRole('button', { name: 'Open Pages & Structure for Home' })
    .click();
  const structureDrawer = page.getByRole('dialog', {
    name: 'Pages & Structure',
  });
  await expect(structureDrawer).toBeVisible();
  await expect(structureDrawer.getByTestId('structure-tree')).toBeVisible();
  await expectStoredDocument(page, initialDocument);
  await closeDialog(page, 'Pages & Structure');

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const viewportControls = page.getByRole('group', {
    name: 'Preview viewport',
  });
  const viewports = [
    { className: 'preview-stage--desktop', name: 'Desktop' },
    { className: 'preview-stage--tablet', name: 'Tablet' },
    { className: 'preview-stage--mobile', name: 'Phone' },
  ] as const;
  for (const viewport of viewports) {
    await viewportControls
      .getByRole('button', { name: viewport.name, exact: true })
      .click();
    await expect(page.getByTestId('preview-stage')).toHaveClass(
      new RegExp(viewport.className),
    );
    await expectStoredDocument(page, initialDocument);
  }
  await page.getByRole('button', { name: 'Back to editor' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expectStoredDocument(page, initialDocument);
});
