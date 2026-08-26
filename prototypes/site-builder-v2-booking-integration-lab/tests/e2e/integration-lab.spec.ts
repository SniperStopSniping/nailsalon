import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  LAB_STORAGE_KEY,
  bookingCard,
  chooseStarter,
  closeDialog,
  closePagesAndStructure,
  expectNoDocumentOverflow,
  openFreshLab,
  openMoveForBooking,
  openMoveFromStructure,
  openPagesAndStructure,
  pageNames,
  reorderLabels,
  sectionLabels,
  selectBooking,
  type StarterName,
} from './helpers';

const LAYOUTS = [
  ['visual_grid', 'Visual Grid'],
  ['clean_list', 'Clean List'],
  ['editorial_cards', 'Editorial Cards'],
  ['category_menu', 'Category Menu'],
  ['editorial_price_list', 'Editorial Price List'],
] as const;

async function chooseLayout(
  settings: Locator,
  layout: (typeof LAYOUTS)[number][0],
): Promise<void> {
  const option = settings.locator(`[data-layout-option="${layout}"]`);
  await option.click();
  await expect(option).toHaveAttribute('aria-pressed', 'true');
}

async function openBookingSettings(
  page: Page,
  pageName: string,
): Promise<Locator> {
  await selectBooking(page, pageName);
  const mobileEdit = page
    .getByRole('group', { name: 'Booking actions' })
    .getByRole('button', { name: 'Edit', exact: true });
  if (await mobileEdit.isVisible()) {
    await mobileEdit.click();
  } else {
    await page
      .getByTestId('selected-section-toolbar')
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
  }

  const desktopSettings = page.getByRole('dialog', { name: 'Booking settings' });
  const mobileSettings = page.getByRole('dialog', { name: 'Booking', exact: true });
  const settings = (await desktopSettings.isVisible())
    ? desktopSettings
    : mobileSettings;
  await expect(settings).toBeVisible();
  await expect(settings.getByTestId('booking-settings-panel')).toBeVisible();
  return settings;
}

async function closeBookingSettings(page: Page, settings: Locator): Promise<void> {
  const desktopClose = settings.getByRole('button', {
    name: 'Close Booking settings',
  });
  if (await desktopClose.isVisible()) {
    await desktopClose.click();
  } else {
    await settings.getByRole('button', { name: 'Close Booking' }).click();
  }
  await expect(settings).toHaveCount(0);
}

async function enterPreview(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back to editor' })).toBeVisible();
  const renderer = page.getByTestId('booking-section-preview');
  await expect(renderer).toBeVisible();
  return renderer;
}

async function selectPhonePreview(page: Page): Promise<void> {
  const devices = page.getByRole('group', { name: 'Preview viewport' });
  if (await devices.isVisible()) {
    await devices.getByRole('button', { name: 'Phone' }).click();
  }
  await expect(page.getByTestId('preview-stage')).toHaveClass(
    /preview-stage--mobile/,
  );
}

async function chooseRussianManicureWithFrench(
  page: Page,
  renderer: Locator,
): Promise<void> {
  const search = renderer.getByRole('searchbox', { name: 'Search services' });
  await search.fill('russ');
  await renderer
    .getByRole('group', { name: 'Service categories' })
    .getByRole('button', { name: 'Manicure', exact: true })
    .click();
  await renderer
    .getByRole('button', { name: /View details for Russian Manicure/ })
    .last()
    .click();

  const detail = page.getByTestId('service-detail-dialog');
  await expect(detail).toBeVisible();
  await detail.getByRole('checkbox', { name: 'French' }).check();
  await expect(detail.getByTestId('service-detail-total')).toContainText(
    '1 hr 45 min',
  );
  await expect(detail.getByTestId('service-detail-total')).toContainText(
    'From $80',
  );
}

async function expectContainedBy(inner: Locator, outer: Locator): Promise<void> {
  const [innerBox, outerBox] = await Promise.all([
    inner.boundingBox(),
    outer.boundingBox(),
  ]);
  expect(innerBox, 'inner surface has measurable geometry').not.toBeNull();
  expect(outerBox, 'Preview frame has measurable geometry').not.toBeNull();
  if (!innerBox || !outerBox) return;
  expect(innerBox.x).toBeGreaterThanOrEqual(outerBox.x - 1);
  expect(innerBox.y).toBeGreaterThanOrEqual(outerBox.y - 1);
  expect(innerBox.x + innerBox.width).toBeLessThanOrEqual(
    outerBox.x + outerBox.width + 1,
  );
  expect(innerBox.y + innerBox.height).toBeLessThanOrEqual(
    outerBox.y + outerBox.height + 1,
  );
}

async function selectPageFromStructure(page: Page, pageName: string): Promise<void> {
  const structure = await openPagesAndStructure(page);
  await structure
    .locator('.final-structure__page-select')
    .filter({ hasText: pageName })
    .first()
    .click();
  if (await structure.isVisible()) {
    await closePagesAndStructure(structure);
  }
  await expect(page.getByRole('heading', { level: 1, name: pageName })).toBeVisible();
}

async function readStoredDocument(page: Page): Promise<string | null> {
  return page.evaluate(
    (key) => window.localStorage.getItem(key),
    LAB_STORAGE_KEY,
  );
}

test.describe.configure({ mode: 'serial' });

test('all starting points initialize the same real Booking implementation', async ({
  page,
}) => {
  const starters: Array<{
    bookingPage: string;
    bookingSections: string[];
    home: string[];
    name: StarterName;
    pages: string[];
  }> = [
    {
      bookingPage: 'Home',
      bookingSections: ['Section 01', 'Section 02', 'Booking'],
      home: ['Section 01', 'Section 02', 'Booking'],
      name: 'Quick Book',
      pages: ['Home'],
    },
    {
      bookingPage: 'Home',
      bookingSections: [
        'Section 01',
        'Section 02',
        'Section 03',
        'Section 04',
        'Section 05',
        'Booking',
      ],
      home: [
        'Section 01',
        'Section 02',
        'Section 03',
        'Section 04',
        'Section 05',
        'Booking',
      ],
      name: 'One-page website',
      pages: ['Home'],
    },
    {
      bookingPage: 'Services / Book',
      bookingSections: ['Section 03', 'Booking'],
      home: ['Section 01', 'Section 02'],
      name: 'Multi-page website',
      pages: ['Home', 'Services / Book', 'Gallery', 'About', 'Contact'],
    },
  ];

  for (const starter of starters) {
    await openFreshLab(page);
    await chooseStarter(page, starter.name);
    await expect(pageNames(page)).resolves.toEqual(starter.pages);
    await expect(sectionLabels(page, 'Home')).resolves.toEqual(starter.home);
    if (starter.bookingPage !== 'Home') {
      await selectPageFromStructure(page, starter.bookingPage);
    }
    await expect(sectionLabels(page, starter.bookingPage)).resolves.toEqual(
      starter.bookingSections,
    );
    const booking = bookingCard(page, starter.bookingPage);
    await expect(booking.getByTestId('booking-section-edit')).toBeVisible();
    await expect(booking.locator('.booking-surface')).toHaveAttribute(
      'data-layout',
      'visual_grid',
    );
  }
});

test('Edit is readable but inert, while Phone Preview restores contained customer state', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');

  const booking = bookingCard(page, 'Home');
  const editRegion = booking.getByRole('group', {
    name: 'Booking menu preview — 24 services, Visual Grid. Not interactive while editing.',
  });
  await expect(editRegion).toBeVisible();
  await expect(editRegion).not.toHaveAttribute('aria-hidden', 'true');
  await expect(editRegion).not.toHaveAttribute('inert', '');
  const editSearch = editRegion.locator('input[placeholder="Search services"]');
  await expect(editSearch).toHaveValue('');
  await expect(editSearch).toHaveAttribute('tabindex', '-1');
  await expect(editSearch).toHaveAttribute('aria-hidden', 'true');
  await expect(editRegion.getByRole('button')).toHaveCount(0);
  await expect(booking.locator('.booking-surface')).toHaveAttribute(
    'data-has-selection',
    'false',
  );
  await expect(booking.getByText('Russian Manicure', { exact: true }).last()).toBeVisible();
  await expect(page.getByTestId('selected-service-summary')).toHaveCount(0);
  await booking.getByTestId('booking-section-edit').click({ position: { x: 120, y: 180 } });
  await expect(page.getByTestId('selected-section-toolbar')).toContainText('Booking');
  await expect(page.getByTestId('service-detail-dialog')).toHaveCount(0);
  await expect(page.getByTestId('selected-service-summary')).toHaveCount(0);

  let renderer = await enterPreview(page);
  await selectPhonePreview(page);
  const frame = page.locator('.preview-frame');
  await chooseRussianManicureWithFrench(page, renderer);

  const detail = page.getByTestId('service-detail-dialog');
  await expectContainedBy(detail, frame);
  await detail.getByRole('button', { name: 'Select service' }).click();

  const summary = page.getByTestId('selected-service-summary');
  await expect(summary).toContainText('Russian Manicure');
  await expect(summary).toContainText('1 hr 45 min · From $80 · 1 add-on');
  await expectContainedBy(summary, frame);
  await summary.getByRole('button', { name: 'Continue' }).click();

  const handoff = page.getByTestId('booking-handoff-dialog');
  await expect(handoff).toContainText('Booking flow continues here');
  await expectContainedBy(handoff, frame);
  await handoff.getByRole('button', { name: 'Back to the menu' }).click();

  await page.getByRole('button', { name: 'Back to editor' }).click();
  const cleanEditRegion = bookingCard(page, 'Home').getByRole('group', {
    name: 'Booking menu preview — 24 services, Visual Grid. Not interactive while editing.',
  });
  await expect(cleanEditRegion.locator('input[placeholder="Search services"]')).toHaveValue('');
  await expect(
    cleanEditRegion
      .getByRole('group', { name: 'Service categories' })
      .locator('.booking-category-pill.is-active'),
  ).toContainText('All');
  await expect(cleanEditRegion.locator('.booking-selected-indicator')).toHaveCount(0);
  await expect(bookingCard(page, 'Home').locator('.booking-surface')).toHaveAttribute(
    'data-has-selection',
    'false',
  );
  await expect(page.getByTestId('selected-service-summary')).toHaveCount(0);
  await expect(page.getByTestId('service-detail-dialog')).toHaveCount(0);
  await expect(page.getByTestId('booking-handoff-dialog')).toHaveCount(0);

  renderer = await enterPreview(page);
  await selectPhonePreview(page);
  await expect(renderer.getByRole('searchbox', { name: 'Search services' })).toHaveValue('');
  await expect(
    renderer
      .getByRole('group', { name: 'Service categories' })
      .getByRole('button', { name: 'All', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('selected-service-summary')).toContainText(
    'Russian Manicure',
  );
  await expect(page.getByTestId('selected-service-summary')).toContainText(
    '1 hr 45 min · From $80 · 1 add-on',
  );

  for (const device of ['Tablet', 'Desktop'] as const) {
    await page.getByRole('group', { name: 'Preview viewport' })
      .getByRole('button', { name: device })
      .click();
    const deviceFrame = page.locator('.preview-frame');
    const deviceSummary = page.getByTestId('selected-service-summary');
    await expectContainedBy(deviceSummary, deviceFrame);
    await expect(page.locator('.booking-preview-summary')).toHaveCSS('position', 'sticky');
    await expect(page.locator('.client-site')).toHaveClass(/has-booking-selection/);
    await deviceSummary.getByRole('button', { name: 'Change' }).click();
    const deviceDetail = page.getByTestId('service-detail-dialog');
    await expectContainedBy(deviceDetail, deviceFrame);
    await deviceDetail.getByRole('button', { name: 'Continue' }).click();
    const deviceHandoff = page.getByTestId('booking-handoff-dialog');
    await expectContainedBy(deviceHandoff, deviceFrame);
    await deviceHandoff.getByRole('button', { name: 'Back to the menu' }).click();
  }
});

test('Move is transactional: Enter only, safe dirty dismissal, reload isolation, and Done persistence', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 600 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const committed = await readStoredDocument(page);
  expect(committed).not.toBeNull();

  let move = await openMoveForBooking(page, 'Home');
  const activeRow = move.locator('[data-move-target-row="true"]');
  await expect(activeRow).toBeFocused();
  await expect(move.getByLabel('Position for Booking')).not.toBeFocused();
  await expect(reorderLabels(page)).resolves.toEqual([
    'Section 01',
    'Section 02',
    'Booking',
  ]);
  await expect(
    move.getByRole('button', {
      name: 'Move Booking down, unavailable — already last',
    }),
  ).toHaveAttribute('aria-disabled', 'true');

  const position = move.getByLabel('Position for Booking');
  await position.fill('1');
  await position.press('Tab');
  await expect(position).toHaveValue('3');
  await expect(reorderLabels(page)).resolves.toEqual([
    'Section 01',
    'Section 02',
    'Booking',
  ]);

  await position.fill('1');
  await position.press('Escape');
  await expect(move).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Keep this new order?' })).toHaveCount(0);
  await expect(position).toHaveValue('3');
  await expect(activeRow).toBeFocused();

  await position.fill('0');
  await position.press('Enter');
  await expect(move.getByText('Enter a position from 1 to 3.')).toBeVisible();
  await expect(position).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('reorder-live-region')).toHaveText(
    'Enter a position from 1 to 3.',
  );

  await position.fill('1');
  await position.press('Enter');
  await expect(position).toBeFocused();
  await expect(position).toHaveValue('1');
  await expect(reorderLabels(page)).resolves.toEqual([
    'Booking',
    'Section 01',
    'Section 02',
  ]);
  await expect(page.getByLabel('Save status')).toContainText('Order not saved yet');
  await expect(move.getByText('Order not saved yet')).toBeVisible();
  expect(await readStoredDocument(page)).toBe(committed);

  await page.reload();
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Section 01',
    'Section 02',
    'Booking',
  ]);

  move = await openMoveForBooking(page, 'Home');
  await move.getByLabel('Position for Booking').fill('1');
  await move.getByLabel('Position for Booking').press('Enter');
  await move.getByRole('button', { name: 'Close Move Booking' }).click();
  let confirmation = page.getByRole('dialog', { name: 'Keep this new order?' });
  await expect(confirmation).toContainText('position 1 instead of 3');
  await confirmation.getByRole('button', { name: 'Discard changes' }).click();
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Section 01',
    'Section 02',
    'Booking',
  ]);

  move = await openMoveForBooking(page, 'Home');
  await move.getByLabel('Position for Booking').fill('1');
  await move.getByLabel('Position for Booking').press('Enter');
  await move.locator('[data-move-target-row="true"]').focus();
  await page.keyboard.press('Escape');
  confirmation = page.getByRole('dialog', { name: 'Keep this new order?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Keep order' }).click();
  await expect(page.locator('.toast').getByText('Section order saved.')).toBeVisible();
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Booking',
    'Section 01',
    'Section 02',
  ]);
  await expect.poll(() => readStoredDocument(page)).not.toBe(committed);

  await page.reload();
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Booking',
    'Section 01',
    'Section 02',
  ]);
  const bookingFirstCommitted = await readStoredDocument(page);

  move = await openMoveForBooking(page, 'Home');
  await move.getByLabel('Position for Booking').fill('3');
  await move.getByLabel('Position for Booking').press('Enter');
  await expect(page.getByTestId('final-hybrid-editor')).toHaveAttribute('inert', '');
  await page.keyboard.press('Control+z');
  await move.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Booking',
    'Section 01',
    'Section 02',
  ]);

  move = await openMoveForBooking(page, 'Home');
  await move.getByLabel('Position for Booking').fill('3');
  await move.getByLabel('Position for Booking').press('Enter');
  await page.getByTestId('dialog-backdrop').click({ position: { x: 4, y: 4 } });
  confirmation = page.getByRole('dialog', { name: 'Keep this new order?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Discard changes' }).click();
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Booking',
    'Section 01',
    'Section 02',
  ]);

  move = await openMoveForBooking(page, 'Home');
  await move.getByRole('button', { name: 'Move Booking down' }).click();
  const handle = move.getByRole('button', {
    name: 'Drag Booking. Use arrow keys after lifting with Space.',
  });
  await handle.focus();
  await handle.press('Space');
  await handle.press('ArrowDown');
  await handle.press('Escape');
  await expect(move).toBeVisible();
  await expect(move.getByLabel('Position for Booking')).toHaveValue('2');
  await handle.focus();
  await handle.press('Space');
  await handle.press('ArrowDown');
  await handle.press('Space');
  await expect(move.getByLabel('Position for Booking')).toHaveValue('3');
  await move.getByRole('button', { name: 'Move Booking up' }).click();
  await expect(move.getByLabel('Position for Booking')).toHaveValue('2');
  await move.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.toast').getByText('Section order saved.')).toBeVisible();
  await expect(page.getByLabel('Save status')).toContainText('Saved');
  await expect.poll(() => readStoredDocument(page)).not.toBe(bookingFirstCommitted);
  await page.reload();
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Section 01',
    'Booking',
    'Section 02',
  ]);
});

test('Pages & Structure opens the same Move surface and a one-section page exposes only cross-page movement', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 600 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await selectBooking(page, 'Home');

  let move = await openMoveFromStructure(page);
  await expect(move.getByTestId('move-section-panel')).toBeVisible();
  await expect(move.locator('[data-move-target-row="true"]')).toContainText(
    'Booking',
  );
  await expect(move.locator('[data-move-target-row="true"]')).toContainText(
    'Moving',
  );
  await expect(move.getByRole('group', { name: 'Move actions' })).toBeVisible();

  await move
    .getByRole('button', { name: 'Move Booking to another page' })
    .click();
  const pageName = move.getByPlaceholder('Page name');
  await expect(pageName).toBeFocused();
  await expect(pageName).toBeInViewport();
  const createAndMove = move.getByRole('button', { name: 'Create page and move' });
  await expect(createAndMove).toBeInViewport();
  const [createBox, footerBox] = await Promise.all([
    createAndMove.boundingBox(),
    move.getByRole('group', { name: 'Move actions' }).boundingBox(),
  ]);
  expect(createBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  if (createBox && footerBox) {
    expect(createBox.y + createBox.height).toBeLessThanOrEqual(footerBox.y + 1);
  }

  await pageName.fill('Services');
  const committedBeforeCreate = await readStoredDocument(page);
  await createAndMove.click();
  await expect(move).toBeVisible();
  await expect(move.getByRole('region', { name: 'Staged destination' }))
    .toContainText('Services will be created when you press Done.');
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  expect(await readStoredDocument(page)).toEqual(committedBeforeCreate);
  await move.getByRole('button', { name: 'Done', exact: true }).click();
  const menuPrompt = page.getByRole('dialog', { name: 'Add a menu?' });
  if (await menuPrompt.isVisible()) {
    const notNow = menuPrompt.getByRole('button', { name: /Not now|Keep menu off/ });
    await notNow.click();
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Services' })).toBeVisible();
  await expect(sectionLabels(page, 'Services')).resolves.toEqual(['Booking']);

  const structure = await openPagesAndStructure(page);
  await expect(
    structure.getByRole('button', { name: 'Arrange sections', exact: true }),
  ).toHaveCount(0);
  await closePagesAndStructure(structure);

  move = await openMoveForBooking(page, 'Services');
  await expect(move).toContainText('Booking is the only section on Services.');
  await expect(move.getByLabel('Position for Booking')).toHaveCount(0);
  await expect(move.getByRole('button', { name: /Move Booking up/ })).toHaveCount(0);
  await expect(
    move.getByRole('button', {
      name: 'Drag Booking. Use arrow keys after lifting with Space.',
    }),
  ).toHaveCount(0);
  await expect(
    move.getByRole('button', { name: 'Move Booking to another page' }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(move.getByRole('list', { name: 'Destination pages' })).toBeVisible();
  await move.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('long selected Booking keeps named contextual controls reachable without top-bar collisions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 768 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  let booking = bookingCard(page, 'Home');
  await expect(booking).toHaveAttribute('data-booking-editor-collapsed', 'true');
  await selectBooking(page, 'Home');

  const toolbar = page.getByTestId('selected-section-toolbar');
  await expect(toolbar).toContainText('Booking');
  await expect(toolbar).toContainText('Visual Grid');
  for (const action of ['Edit', 'Move', 'Expand', 'More']) {
    await expect(toolbar.getByRole('button', { name: action, exact: true })).toBeVisible();
  }
  const [topbarBox, toolbarBox] = await Promise.all([
    page.getByRole('banner', { name: 'Site builder toolbar' }).boundingBox(),
    toolbar.boundingBox(),
  ]);
  expect(topbarBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  if (topbarBox && toolbarBox) {
    expect(toolbarBox.y).toBeGreaterThanOrEqual(topbarBox.y + topbarBox.height - 1);
  }
  for (const action of ['Edit', 'Move', 'Expand', 'More']) {
    const hitTestable = await toolbar
      .getByRole('button', { name: action, exact: true })
      .evaluate((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return hit === button || (hit !== null && button.contains(hit));
      });
    expect(hitTestable, `${action} remains hit-testable`).toBe(true);
  }

  await toolbar.getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(booking).toHaveAttribute('data-booking-editor-collapsed', 'false');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(booking).toHaveAttribute('data-booking-editor-collapsed', 'false');
  await page.setViewportSize({ width: 1440, height: 768 });
  await booking.evaluate((element) => {
    const absoluteTop = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: absoluteTop + 1800, behavior: 'auto' });
  });
  await expect(toolbar.getByRole('button', { name: 'Collapse', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  const returnToBooking = toolbar.getByRole('button', { name: 'Back to Booking' });
  await expect(returnToBooking).toBeVisible();
  await returnToBooking.click();
  await expect(toolbar.getByRole('button', { name: 'Collapse', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 600 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  booking = bookingCard(page, 'Home');
  await expect(booking).toHaveAttribute('data-booking-editor-collapsed', 'true');
  await selectBooking(page, 'Home');
  const dock = page.getByRole('group', { name: 'Booking actions' });
  await expect(dock).toContainText('Booking');
  await expect(dock).toContainText('Visual Grid');
  await expect(dock.getByRole('button', { name: 'Expand', exact: true })).toBeVisible();
  await dock.getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(booking).toHaveAttribute('data-booking-editor-collapsed', 'false');
  await booking.evaluate((element) => {
    const absoluteTop = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: absoluteTop + 1800, behavior: 'auto' });
  });
  await expect(dock.getByRole('button', { name: 'Collapse', exact: true })).toBeVisible();
  await dock.getByRole('button', { name: 'Collapse', exact: true }).click();
  await expect(booking).toHaveAttribute('data-booking-editor-collapsed', 'true');
});

test('desktop Booking settings use a non-overlapping column and retain the canvas compare loop', async ({
  page,
}) => {
  for (const width of [1440, 1280, 1180, 1179, 1024, 920]) {
    await page.setViewportSize({ width, height: 768 });
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    const settings = await openBookingSettings(page, 'Home');
    const topbar = page.getByRole('banner', { name: 'Site builder toolbar' });
    const [settingsBox, topbarBox] = await Promise.all([
      settings.boundingBox(),
      topbar.boundingBox(),
    ]);
    expect(settingsBox).not.toBeNull();
    expect(topbarBox).not.toBeNull();
    if (settingsBox && topbarBox) {
      expect(settingsBox.y).toBeGreaterThanOrEqual(
        topbarBox.y + topbarBox.height - 1,
      );
    }

    await expect(topbar.getByRole('button', { name: 'Preview' })).toBeVisible();
    await expect(topbar.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(topbar.getByRole('button', { name: 'Redo' })).toBeVisible();
    await expect(topbar.getByRole('button', { name: 'More site options' })).toBeVisible();

    if (width >= 1180) {
      const canvasBox = await page.locator('.final-canvas-frame').boundingBox();
      expect(canvasBox).not.toBeNull();
      if (canvasBox && settingsBox) {
        expect(canvasBox.x + canvasBox.width).toBeLessThanOrEqual(settingsBox.x + 1);
      }
    }

    for (const [layout] of LAYOUTS) {
      await chooseLayout(settings, layout);
      await expect(
        page.getByTestId('booking-section-edit').locator('.booking-surface'),
      ).toHaveAttribute('data-layout', layout);
    }

    const scrollBody = settings.locator('.final-booking-settings-drawer__body');
    await scrollBody.evaluate((element) => {
      element.scrollTop = Math.min(220, element.scrollHeight - element.clientHeight);
    });
    const scrollTop = await scrollBody.evaluate((element) => element.scrollTop);
    await expect(
      settings.locator('h2').filter({ hasText: /^Booking$/ }),
    ).toHaveCount(1);
    await expect(
      settings.getByText(/Choose how clients browse your services/, { exact: false }),
    ).toHaveCount(1);
    await settings.getByRole('button', { name: 'Hide settings' }).click();
    await expect(settings).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show Booking settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Show Booking settings' }).click();
    await expect(settings).toBeVisible();
    await expect.poll(() => scrollBody.evaluate((element) => element.scrollTop)).toBe(
      scrollTop,
    );
    await closeBookingSettings(page, settings);
  }
});

test('short mobile viewports keep the starter action, editor, and Move controls reachable', async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 600 },
    { width: 375, height: 600 },
    { width: 375, height: 500 },
  ]) {
    await page.setViewportSize(viewport);
    await openFreshLab(page);
    const quickBook = page.getByRole('button', { name: /^Quick Book/ });
    const quickBookBox = await quickBook.boundingBox();
    expect(quickBookBox).not.toBeNull();
    if (quickBookBox) {
      expect(quickBookBox.y).toBeLessThan(viewport.height);
    }
    await expect(quickBook).toBeInViewport();
    await quickBook.click();
    await expectNoDocumentOverflow(page);

    const move = await openMoveForBooking(page, 'Home');
    await expectNoDocumentOverflow(page);
    await move
      .getByRole('button', { name: 'Move Booking to another page' })
      .click();
    await expect(move.getByPlaceholder('Page name')).toBeFocused();
    await expect(move.getByPlaceholder('Page name')).toBeInViewport();
    await expect(
      move.getByRole('button', { name: 'Create page and move' }),
    ).toBeInViewport();
    await expect(move.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(move.getByRole('button', { name: 'Done' })).toBeVisible();
    await move.getByRole('button', { name: 'Cancel' }).click();
  }
});

test('all five layouts remain shared and the 100-service editor collapses while Preview stays full', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const settings = await openBookingSettings(page, 'Home');
  for (const [layout, label] of LAYOUTS) {
    await chooseLayout(settings, layout);
    const surface = page.getByTestId('booking-section-edit').locator('.booking-surface');
    await expect(surface).toHaveAttribute('data-layout', layout);
    await expect(surface).toHaveAttribute('aria-label', `${label} booking menu`);
  }
  await chooseLayout(settings, 'visual_grid');
  await closeBookingSettings(page, settings);

  await page.getByRole('button', { name: 'More site options' }).click();
  const options = page.getByRole('dialog', { name: 'More' });
  await options.getByLabel('Booking service menu fixture').selectOption('stress_100');
  await closeDialog(page, 'More');
  const booking = bookingCard(page, 'Home');
  await expect(booking).toHaveAttribute('data-booking-editor-collapsed', 'true');
  await expect(booking.getByRole('button', { name: 'Show full preview' }).first()).toBeVisible();

  const hundredSettings = await openBookingSettings(page, 'Home');
  await chooseLayout(hundredSettings, 'category_menu');
  await closeBookingSettings(page, hundredSettings);
  await expect(booking).toHaveAttribute('data-booking-editor-collapsed', 'true');

  const renderer = await enterPreview(page);
  await expect(renderer.locator('.booking-surface')).toHaveAttribute(
    'data-layout',
    'category_menu',
  );
  await expect(renderer).toContainText('100 services');
  await expect(renderer.getByRole('searchbox', { name: 'Search services' })).toBeVisible();
  await expect(page.locator('.booking-editor-preview')).toHaveCount(0);
  await expectNoDocumentOverflow(page);

  const stored = await readStoredDocument(page);
  expect(stored).not.toContain('stress-manicure-001');
  expect(stored).not.toContain('Russian Manicure');
});

test('measured collapse holds across the required layout and viewport matrix', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const scenarios = [
    { layout: 'visual_grid', menuSize: 'canonical', expectedServices: 24 },
    { layout: 'editorial_cards', menuSize: 'canonical', expectedServices: 24 },
    { layout: 'category_menu', menuSize: 'stress_100', expectedServices: 100 },
  ] as const;
  const viewports = [
    { width: 375, height: 600 },
    { width: 320, height: 600 },
    { width: 1440, height: 768 },
    { width: 1440, height: 900 },
  ] as const;

  for (const scenario of scenarios) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    if (scenario.menuSize === 'stress_100') {
      await page.getByRole('button', { name: 'More site options' }).click();
      const options = page.getByRole('dialog', { name: 'More' });
      await options.getByLabel('Booking service menu fixture').selectOption('stress_100');
      await closeDialog(page, 'More');
    }
    if (scenario.layout !== 'visual_grid') {
      const settings = await openBookingSettings(page, 'Home');
      await chooseLayout(settings, scenario.layout);
      await closeBookingSettings(page, settings);
    }

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const booking = bookingCard(page, 'Home');
      await expect(booking).toHaveAttribute('data-booking-editor-collapsed', 'true');
      const measurement = await booking.evaluate((element) => {
        const content = element.querySelector<HTMLElement>('.booking-editor-preview__measure');
        const preview = element.querySelector<HTMLElement>('.booking-editor-preview');
        const topbar = document.querySelector<HTMLElement>('.final-topbar');
        const available = Math.max(
          320,
          window.innerHeight - (topbar?.getBoundingClientRect().bottom ?? 82),
        );
        return {
          available,
          maxHeight: preview ? Number.parseFloat(getComputedStyle(preview).maxHeight) : 0,
          naturalHeight: content?.scrollHeight ?? 0,
        };
      });
      expect(measurement.naturalHeight).toBeGreaterThan(measurement.available * 3);
      expect(measurement.maxHeight).toBeLessThanOrEqual(
        Math.min(measurement.available * 2, 1200) + 1,
      );

      const renderer = await enterPreview(page);
      await expect(renderer.locator('.booking-surface')).toHaveAttribute(
        'data-layout',
        scenario.layout,
      );
      await expect(page.locator('.booking-editor-preview')).toHaveCount(0);
      if (scenario.expectedServices === 100) {
        await expect(renderer.locator('.category-service-row')).toHaveCount(100);
      } else {
        await expect(renderer).toContainText('24 services');
      }
      await page.getByRole('button', { name: 'Back to editor' }).click();
    }
  }
});
