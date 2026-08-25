import { readFile } from 'node:fs/promises';

import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  LAB_STORAGE_KEY,
  bookingCard,
  chooseStarter,
  closeDialog,
  closePagesAndStructure,
  enterReorder,
  expectNoDocumentOverflow,
  openFreshLab,
  openPagesAndStructure,
  pageNames,
  reorderLabels,
  sectionLabels,
  selectBooking,
  sectionsList,
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
  await settings.locator(`[data-layout-option="${layout}"]`).click();
  await expect(settings.locator(`[data-layout-option="${layout}"]`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

async function openBookingSettings(
  page: Page,
  pageName: string,
): Promise<Locator> {
  const card = await selectBooking(page, pageName);
  const contextualEdit = card
    .getByRole('button', { name: 'Edit', exact: true })
    .last();
  const mobileEdit = page
    .getByRole('group', { name: 'Booking actions' })
    .getByRole('button', { name: 'Edit', exact: true });
  if (await mobileEdit.isVisible()) {
    await mobileEdit.click();
  } else {
    await contextualEdit.click();
  }
  const dialog = page.getByRole('dialog', { name: 'Booking' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('booking-settings-panel')).toBeVisible();
  return dialog;
}

async function enterPreview(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back to editor' })).toBeVisible();
  const renderer = page.getByTestId('booking-section-preview');
  await expect(renderer).toBeVisible();
  return renderer;
}

async function resetEntireLab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More site options' }).click();
  await page
    .getByRole('dialog', { name: 'More' })
    .getByRole('button', { name: 'Reset Lab' })
    .click();
  await page
    .getByRole('dialog', { name: 'Reset the entire Lab?' })
    .getByRole('button', { name: 'Reset Lab' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Choose your starting point' }),
  ).toBeVisible();
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

test.describe.configure({ mode: 'serial' });

test('all three starter kits initialize the same real Booking section', async ({
  page,
}) => {
  const starters: Array<{
    name: StarterName;
    pages: string[];
    home: string[];
    bookingPage: string;
    bookingSections: string[];
  }> = [
    {
      name: 'Quick Book',
      pages: ['Home'],
      home: ['Section 01', 'Section 02', 'Booking'],
      bookingPage: 'Home',
      bookingSections: ['Section 01', 'Section 02', 'Booking'],
    },
    {
      name: 'One-page website',
      pages: ['Home'],
      home: [
        'Section 01',
        'Section 02',
        'Section 03',
        'Section 04',
        'Section 05',
        'Booking',
      ],
      bookingPage: 'Home',
      bookingSections: [
        'Section 01',
        'Section 02',
        'Section 03',
        'Section 04',
        'Section 05',
        'Booking',
      ],
    },
    {
      name: 'Multi-page website',
      pages: ['Home', 'Services / Book', 'Gallery', 'About', 'Contact'],
      home: ['Section 01', 'Section 02'],
      bookingPage: 'Services / Book',
      bookingSections: ['Section 03', 'Booking'],
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

test('375x600 mobile journey separates editing from the shared customer flow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 600 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await expectNoDocumentOverflow(page);

  const booking = bookingCard(page, 'Home');
  await expect(booking.locator('.booking-customer-region')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await expect(booking.locator('.booking-customer-region')).toHaveAttribute(
    'inert',
    '',
  );
  await expect(page.getByTestId('service-detail-dialog')).toHaveCount(0);
  await booking.locator('.section-card__select-surface').click();
  await expect(page.getByTestId('service-detail-dialog')).toHaveCount(0);
  await expect(booking).toHaveClass(/is-selected/);

  const settings = await openBookingSettings(page, 'Home');
  await expect(settings).toContainText(
    'Your services, prices and booking settings stay the same.',
  );
  for (const [layout] of LAYOUTS) {
    await chooseLayout(settings, layout);
    await expect(booking.locator('.booking-surface')).toHaveAttribute(
      'data-layout',
      layout,
    );
  }
  await chooseLayout(settings, 'visual_grid');
  await closeDialog(page, 'Booking');

  let renderer = await enterPreview(page);
  await expect(page.locator('.section-context-toolbar')).toHaveCount(0);
  const search = renderer.getByRole('searchbox', { name: 'Search services' });
  await search.fill('Russian');
  await expect(
    renderer.getByRole('button', { name: /View details for Russian Manicure/ }).first(),
  ).toBeVisible();
  await search.fill('');
  await renderer
    .getByRole('button', { name: /View details for Russian Manicure/ })
    .first()
    .click();

  const detail = page.getByTestId('service-detail-dialog');
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Russian Manicure' })).toBeVisible();
  await detail.getByRole('checkbox', { name: /French/ }).check();
  await expect(detail.getByTestId('service-detail-total')).toContainText(
    '1 hr 45 min',
  );
  await expect(detail.getByTestId('service-detail-total')).toContainText(
    'From $80',
  );
  await detail.getByRole('button', { name: 'Select service' }).click();

  const summary = page.getByTestId('selected-service-summary');
  await expect(summary).toContainText('Russian Manicure');
  await expect(summary).toContainText('1 hr 45 min · From $80');
  const summaryBeforeScroll = await summary.boundingBox();
  expect(summaryBeforeScroll).not.toBeNull();
  expect(
    (summaryBeforeScroll?.y ?? 0) + (summaryBeforeScroll?.height ?? 0),
  ).toBeLessThanOrEqual(600);
  await page.mouse.wheel(0, 900);
  const summaryAfterScroll = await summary.boundingBox();
  expect(summaryAfterScroll).not.toBeNull();
  expect(Math.abs(
    (summaryAfterScroll?.y ?? 0) - (summaryBeforeScroll?.y ?? 0),
  )).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Back to editor' }).click();
  const settingsAfterSelection = await openBookingSettings(page, 'Home');
  await chooseLayout(settingsAfterSelection, 'clean_list');
  await closeDialog(page, 'Booking');
  renderer = await enterPreview(page);
  await expect(renderer.locator('.booking-surface')).toHaveAttribute(
    'data-layout',
    'clean_list',
  );
  await expect(page.getByTestId('selected-service-summary')).toContainText(
    'Russian Manicure',
  );
  await page
    .getByTestId('selected-service-summary')
    .getByRole('button', { name: 'Continue' })
    .click();
  await expect(page.getByTestId('booking-handoff-dialog')).toContainText(
    'Booking flow continues here',
  );
  const futureFlow = page.getByLabel('Future canonical booking flow');
  for (const step of [
    'Service',
    'Options',
    'Technician',
    'Time',
    'Details',
    'Payment',
    'Confirmation',
  ]) {
    await expect(futureFlow.getByText(step, { exact: true })).toBeVisible();
  }
});

test('selected Booking Move edits local order with cancel and commit boundaries', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');

  await selectBooking(page, 'Home');
  await page
    .getByRole('group', { name: 'Booking actions' })
    .getByRole('button', { name: 'Move', exact: true })
    .click();

  let move = page.getByRole('dialog', { name: 'Move Booking' });
  await expect(move).toBeVisible();
  await expect(move.getByLabel('Position for Booking')).toBeFocused();
  let compactOrder = move.getByTestId('reorder-list');
  await expect(compactOrder).toBeVisible();
  await expect(
    compactOrder.locator('.reorder-row > .reorder-row__label > strong').allTextContents(),
  ).resolves.toEqual(['Section 01', 'Section 02', 'Booking']);
  await expect(move.getByLabel('Position for Section 01')).toHaveValue('1');
  await expect(move.getByLabel('Position for Section 02')).toHaveValue('2');
  await expect(move.getByLabel('Position for Booking')).toHaveValue('3');
  await expect(move.getByRole('button', { name: 'Move Booking up' })).toBeVisible();
  await expect(move.getByRole('button', { name: 'Move Booking down' })).toBeDisabled();
  await expect(move.getByRole('button', {
    name: 'Drag Booking. Use arrow keys after lifting with Space.',
  })).toBeVisible();
  await expect(
    move.getByRole('button', { name: 'Move Booking to another page' }),
  ).toBeVisible();

  await move.getByLabel('Position for Booking').fill('1');
  await move.getByLabel('Position for Booking').press('Enter');
  await expect(
    compactOrder.locator('.reorder-row > .reorder-row__label > strong').allTextContents(),
  ).resolves.toEqual(['Booking', 'Section 01', 'Section 02']);
  await move.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(move).toHaveCount(0);
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Section 01',
    'Section 02',
    'Booking',
  ]);

  await selectBooking(page, 'Home');
  await page
    .getByRole('group', { name: 'Booking actions' })
    .getByRole('button', { name: 'Move', exact: true })
    .click();
  move = page.getByRole('dialog', { name: 'Move Booking' });
  compactOrder = move.getByTestId('reorder-list');
  await move.getByLabel('Position for Booking').fill('1');
  await move.getByLabel('Position for Booking').press('Enter');
  await move.getByRole('button', { name: 'Move Booking down' }).click();
  await expect(move.getByLabel('Position for Booking')).toHaveValue('2');
  await move.getByRole('button', { name: 'Move Booking up' }).click();
  await expect(move.getByLabel('Position for Booking')).toHaveValue('1');

  const handle = move.getByRole('button', {
    name: 'Drag Booking. Use arrow keys after lifting with Space.',
  });
  await handle.focus();
  await handle.press('Space');
  await handle.press('ArrowDown');
  await handle.press('Space');
  await expect(move.getByLabel('Position for Booking')).toHaveValue('2');
  await move.getByRole('button', { name: 'Move Booking up' }).click();
  await expect(move.getByLabel('Position for Booking')).toHaveValue('1');

  const dragStart = await handle.boundingBox();
  const dragTarget = await compactOrder.locator('.reorder-row').last().boundingBox();
  expect(dragStart).not.toBeNull();
  expect(dragTarget).not.toBeNull();
  if (!dragStart || !dragTarget) {
    throw new Error('Unified Move pointer-drag geometry was unavailable.');
  }
  await page.mouse.move(
    dragStart.x + dragStart.width / 2,
    dragStart.y + dragStart.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    dragTarget.x + dragTarget.width / 2,
    dragTarget.y + dragTarget.height / 2,
    { steps: 14 },
  );
  await page.mouse.up();
  await expect(move.getByLabel('Position for Booking')).toHaveValue('3');
  await move.getByLabel('Position for Booking').fill('1');
  await move.getByLabel('Position for Booking').press('Enter');
  await move.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(move).toHaveCount(0);
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Booking',
    'Section 01',
    'Section 02',
  ]);

  await page.reload();
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Booking',
    'Section 01',
    'Section 02',
  ]);
});

test('Booking reorders, moves, persists, exports safely, and remains protected', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');

  await enterReorder(page);
  await page.getByRole('button', { name: 'Move Booking up' }).click();
  await expect(reorderLabels(page)).resolves.toEqual([
    'Section 01',
    'Booking',
    'Section 02',
  ]);
  await page
    .getByRole('group', { name: 'Reorder actions' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Section 01',
    'Section 02',
    'Booking',
  ]);

  await enterReorder(page);
  const bookingHandle = page.getByRole('button', {
    name: 'Drag Booking. Use arrow keys after lifting with Space.',
  });
  await bookingHandle.focus();
  await bookingHandle.press('Space');
  await bookingHandle.press('ArrowUp');
  await bookingHandle.press('Space');
  await expect(reorderLabels(page)).resolves.toEqual([
    'Section 01',
    'Booking',
    'Section 02',
  ]);
  await expect(page.getByTestId('reorder-live-region')).toHaveText(
    'Booking moved to position 2 of 3.',
  );
  await page
    .getByRole('group', { name: 'Reorder actions' })
    .getByRole('button', { name: 'Done' })
    .click();

  const bookingSettings = await openBookingSettings(page, 'Home');
  await chooseLayout(bookingSettings, 'clean_list');
  await closeDialog(page, 'Booking');

  await selectBooking(page, 'Home');
  await page
    .getByRole('group', { name: 'Booking actions' })
    .getByRole('button', { name: 'Move', exact: true })
    .click();
  const move = page.getByRole('dialog', { name: 'Move Booking' });
  await expect(move.getByRole('list', { name: 'Destination pages' })).toHaveCount(0);
  await move
    .getByRole('button', { name: 'Move Booking to another page' })
    .click();
  await expect(move.getByRole('list', { name: 'Destination pages' })).toHaveCount(1);
  await expect(move.getByPlaceholder('Page name')).toBeVisible();
  await move.getByPlaceholder('Page name').fill('Services');
  await move.getByRole('button', { name: 'Create page and move' }).click();
  const navigationPrompt = page.getByRole('dialog', { name: 'Add a menu?' });
  if (await navigationPrompt.isVisible()) {
    await navigationPrompt.getByRole('button', { name: 'Add menu' }).click();
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Services' })).toBeVisible();
  await expect(sectionLabels(page, 'Services')).resolves.toEqual(['Booking']);
  await expect(bookingCard(page, 'Services').locator('.booking-surface')).toHaveAttribute(
    'data-layout',
    'clean_list',
  );

  await enterPreview(page);
  await expect(page.getByRole('main', { name: 'Services preview' })).toBeVisible();
  const openNavigation = page.getByRole('button', { name: 'Open site navigation' });
  if (await openNavigation.isVisible()) {
    await openNavigation.click();
  }
  await page
    .getByRole('navigation', { name: 'Preview site navigation' })
    .getByRole('button', { name: 'Home' })
    .click();
  await expect(page.getByRole('main', { name: 'Home preview' })).toBeVisible();
  await expect(page.getByTestId('booking-section-preview')).toHaveCount(0);
  if (await openNavigation.isVisible()) {
    await openNavigation.click();
  }
  await page
    .getByRole('navigation', { name: 'Preview site navigation' })
    .getByRole('button', { name: 'Services' })
    .click();
  await expect(page.getByTestId('booking-section-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Back to editor' }).click();

  await selectBooking(page, 'Services');
  await page
    .getByRole('group', { name: 'Booking actions' })
    .getByRole('button', { name: 'Hide' })
    .click();
  const protection = page.getByRole('dialog', { name: 'Keep a way to book' });
  await expect(protection).toContainText(
    'Your site needs at least one visible way for clients to start booking.',
  );
  await protection.getByRole('button', { name: 'Keep Booking' }).click();
  await expect(bookingCard(page, 'Services')).not.toHaveClass(/is-hidden/);
  await page
    .getByRole('group', { name: 'Booking actions' })
    .getByRole('button', { name: 'More' })
    .click();
  await page
    .getByRole('dialog', { name: 'Booking actions' })
    .getByRole('button', { name: 'Remove from page' })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Keep a way to book' }),
  ).toContainText('Your site needs at least one visible way');
  await page
    .getByRole('dialog', { name: 'Keep a way to book' })
    .getByRole('button', { name: 'Keep Booking' })
    .click();
  await expect(sectionLabels(page, 'Services')).resolves.toEqual(['Booking']);

  await page.reload();
  await expect(pageNames(page)).resolves.toEqual(['Home', 'Services']);
  await selectPageFromStructure(page, 'Services');
  await expect(sectionLabels(page, 'Services')).resolves.toEqual(['Booking']);

  await page.getByRole('button', { name: 'More site options' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page
    .getByRole('dialog', { name: 'More' })
    .getByRole('button', { name: 'Export JSON' })
    .click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const exported = await readFile(path as string, 'utf8');
  const exportedDocument = JSON.parse(exported) as {
    pages: Array<{ sections: Array<{ sectionType: string; settings?: { layout: string } }> }>;
  };
  expect(exported).not.toContain('Russian Manicure');
  expect(exported).not.toContain('selectedServiceId');
  expect(
    exportedDocument.pages
      .flatMap((candidate) => candidate.sections)
      .find((section) => section.sectionType === 'booking')?.settings?.layout,
  ).toBe('clean_list');

  await resetEntireLab(page);
  await page.getByLabel('Import site JSON file').setInputFiles({
    buffer: Buffer.from(exported),
    mimeType: 'application/json',
    name: 'integration-lab.json',
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await selectPageFromStructure(page, 'Services');
  await expect(sectionLabels(page, 'Services')).resolves.toEqual(['Booking']);

  const invalidDocument = JSON.parse(exported) as {
    pages: Array<{ sections: Array<{ sectionType: string }> }>;
  };
  for (const candidate of invalidDocument.pages) {
    candidate.sections = candidate.sections.filter(
      (section) => section.sectionType !== 'booking',
    );
  }
  await page.getByRole('button', { name: 'More site options' }).click();
  await page
    .getByRole('dialog', { name: 'More' })
    .getByLabel('Import site JSON file')
    .setInputFiles({
      buffer: Buffer.from(JSON.stringify(invalidDocument)),
      mimeType: 'application/json',
      name: 'missing-booking.json',
    });
  await expect(
    page.getByRole('dialog', { name: 'Import could not be completed' }),
  ).toContainText(/booking/i);
});

test('1440px uses a temporary drawer and one responsive renderer in every layout', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const settings = await openBookingSettings(page, 'Home');
  const settingsBox = await settings.boundingBox();
  expect(settingsBox?.x).toBeGreaterThan(900);
  await expect(page.getByTestId('booking-section-edit')).toBeVisible();

  for (const [layout] of LAYOUTS) {
    await chooseLayout(settings, layout);
    await expect(page.getByTestId('booking-section-edit').locator('.booking-surface')).toHaveAttribute(
      'data-layout',
      layout,
    );
  }
  await chooseLayout(settings, 'editorial_price_list');
  await closeDialog(page, 'Booking');

  let renderer = await enterPreview(page);
  await expect(renderer.locator('.booking-surface')).toHaveAttribute(
    'data-layout',
    'editorial_price_list',
  );
  const devices = page.getByRole('group', { name: 'Preview viewport' });
  for (const [button, stageClass] of [
    ['Phone', 'preview-stage--mobile'],
    ['Tablet', 'preview-stage--tablet'],
    ['Desktop', 'preview-stage--desktop'],
  ] as const) {
    await devices.getByRole('button', { name: button }).click();
    await expect(page.getByTestId('preview-stage')).toHaveClass(
      new RegExp(stageClass),
    );
  }

  await page.getByRole('button', { name: 'Back to editor' }).click();
  for (const [layout, label] of LAYOUTS) {
    const drawer = await openBookingSettings(page, 'Home');
    await chooseLayout(drawer, layout);
    await closeDialog(page, 'Booking');
    renderer = await enterPreview(page);
    await expect(renderer.locator('.booking-surface')).toHaveAttribute(
      'data-layout',
      layout,
    );
    await expect(renderer.locator('.booking-surface')).toHaveAttribute(
      'aria-label',
      `${label} booking menu`,
    );
    await page.getByRole('button', { name: 'Back to editor' }).click();
  }
});

test('responsive, reduced-motion, and 100-service states stay operable without overflow', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const scenarios = [
    { height: 700, width: 320, zoom: '1' },
    { height: 600, width: 375, zoom: '1' },
    { height: 900, width: 750, zoom: '2' },
  ] as const;

  for (const scenario of scenarios) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await openFreshLab(page);
    await page.evaluate((zoom) => {
      document.documentElement.style.zoom = zoom;
    }, scenario.zoom);
    await chooseStarter(page, 'Quick Book');
    await expectNoDocumentOverflow(page);
    const booking = bookingCard(page, 'Home');
    const motion = await booking.evaluate((element) => {
      const styles = window.getComputedStyle(element);
      return {
        animationDuration: styles.animationDuration,
        transitionDuration: styles.transitionDuration,
      };
    });
    expect(Number.parseFloat(motion.animationDuration)).toBeLessThanOrEqual(0.001);
    expect(Number.parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(0.001);
    await enterPreview(page);
    await page
      .getByRole('group', { name: 'Preview viewport' })
      .getByRole('button', { name: 'Phone' })
      .click();
    await expectNoDocumentOverflow(page);
  }

  await page.setViewportSize({ width: 375, height: 600 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await page.getByRole('button', { name: 'More site options' }).click();
  const options = page.getByRole('dialog', { name: 'More' });
  await options.getByLabel('Booking service menu fixture').selectOption('stress_100');
  await closeDialog(page, 'More');
  const booking = bookingCard(page, 'Home');
  await expect(booking.getByRole('button', { name: 'Show full Booking preview' })).toBeVisible();
  const settings = await openBookingSettings(page, 'Home');
  await chooseLayout(settings, 'category_menu');
  await closeDialog(page, 'Booking');
  const renderer = await enterPreview(page);
  await expect(renderer).toContainText('100 services');
  await expect(renderer.getByRole('searchbox', { name: 'Search services' })).toBeVisible();
  await expectNoDocumentOverflow(page);

  const stored = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    LAB_STORAGE_KEY,
  );
  expect(stored).not.toContain('stress-manicure-001');
  expect(stored).not.toContain('Russian Manicure');
});
