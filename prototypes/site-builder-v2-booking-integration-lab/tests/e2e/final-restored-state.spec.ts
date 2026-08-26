import { expect, test, type Page } from '@playwright/test';

import {
  chooseStarter,
  closeDialog,
  documentSurfaceState,
  LAB_STORAGE_KEY,
  moveSectionToPosition,
  openBookingSettings,
  openFreshLab,
  openMoveForBooking,
  sectionLabels,
  startRuntimeMonitor,
  waitForSaved,
} from './helpers';

type RestoredDocument = {
  navigation: { enabled: boolean };
  pages: Array<{
    name: string;
    sections: Array<{
      label: string;
      order: number;
      sectionType: string;
      settings?: {
        bodyScale: string;
        headingScale: string;
        layout: string;
        spacing: string;
        typographyPreset: string;
      };
      visible: boolean;
    }>;
  }>;
  removedPages: unknown[];
  unusedSections: unknown[];
};

async function expectPristineQuickBook(page: Page): Promise<void> {
  await expect(page.getByTestId('final-hybrid-editor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('selected-section-toolbar')).toHaveCount(0);
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Section 01',
    'Section 02',
    'Booking',
  ]);

  const stored = await page.evaluate((key) => (
    JSON.parse(window.localStorage.getItem(key) ?? 'null') as RestoredDocument | null
  ), LAB_STORAGE_KEY);
  expect(stored).not.toBeNull();
  expect(stored?.pages).toHaveLength(1);
  expect(stored?.pages[0]?.name).toBe('Home');
  expect(stored?.pages[0]?.sections.map((section) => ({
    label: section.label,
    order: section.order,
    visible: section.visible,
  }))).toEqual([
    { label: 'Section 01', order: 0, visible: true },
    { label: 'Section 02', order: 1, visible: true },
    { label: 'Booking', order: 2, visible: true },
  ]);
  const booking = stored?.pages[0]?.sections.find(
    (section) => section.sectionType === 'booking',
  );
  expect(booking?.settings).toMatchObject({
    bodyScale: 'standard',
    headingScale: 'standard',
    layout: 'visual_grid',
    spacing: 'comfortable',
    typographyPreset: 'modern',
  });
  expect(stored?.navigation.enabled).toBe(false);
  expect(stored?.removedPages).toEqual([]);
  expect(stored?.unusedSections).toEqual([]);

  const editRegion = page.getByRole('group', {
    name: 'Booking menu preview — 24 services, Visual Grid. Not interactive while editing.',
  });
  await expect(editRegion).toBeVisible();
  await expect(editRegion.locator('input[placeholder="Search services"]')).toHaveValue('');
  await expect(
    editRegion
      .getByRole('group', { name: 'Service categories' })
      .locator('.booking-category-pill.is-active'),
  ).toContainText('All');
  await expect(page.getByTestId('selected-service-summary')).toHaveCount(0);
  await expect(page.getByTestId('service-detail-dialog')).toHaveCount(0);
  await expect(page.getByTestId('booking-handoff-dialog')).toHaveCount(0);

  const surface = await documentSurfaceState(page);
  expect(surface.body.overflow).toBe('');
  expect(surface.body.paddingRight).toBe('');
  expect(surface.body.pointerEvents).toBe('');
  expect(surface.body.position).toBe('');
  expect(surface.body.top).toBe('');
  expect(surface.html.overflow).toBe('');
  expect(surface.html.paddingRight).toBe('');
  expect(surface.html.pointerEvents).toBe('');
  expect(surface.html.position).toBe('');
  expect(surface.html.top).toBe('');
  expect(surface.editorAriaHidden).toBeNull();
  expect(surface.editorInert).toBe(false);

  const storageKeys = await page.evaluate(() => Object.keys(window.localStorage));
  expect(storageKeys).toEqual([LAB_STORAGE_KEY]);
}

test('restores the Lab through live controls and persists the pristine freeze baseline', async ({
  page,
}) => {
  const runtime = startRuntimeMonitor(page);
  try {
    await page.setViewportSize({ width: 375, height: 600 });
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    await waitForSaved(page);

    const { settings } = await openBookingSettings(page, 'Home');
    await settings.locator('[data-layout-option="clean_list"]').click();
    await closeDialog(page, 'Booking');
    await waitForSaved(page);

    const move = await openMoveForBooking(page, 'Home');
    await moveSectionToPosition(move, 'Booking', 1);
    await move.getByRole('button', { name: 'Done', exact: true }).click();
    await waitForSaved(page);
    await expect(sectionLabels(page, 'Home')).resolves.toEqual([
      'Booking',
      'Section 01',
      'Section 02',
    ]);

    await page.getByRole('button', { name: 'More site options' }).click();
    let more = page.getByRole('dialog', { name: 'More' });
    await more.getByRole('switch', { name: 'Simulate real section heights' }).click();
    await more.getByLabel('Booking service menu fixture').selectOption('stress_100');
    await more.getByLabel('Booking service menu fixture').selectOption('canonical');
    await more.getByRole('switch', { name: 'Simulate real section heights' }).click();
    await more.getByRole('button', { name: 'Reset to starter kit' }).click();

    const confirmation = page.getByRole('dialog', {
      name: 'Reset to the starting point?',
    });
    await confirmation.getByRole('button', { name: 'Reset to starter' }).click();
    await waitForSaved(page);
    await expectPristineQuickBook(page);

    await page.getByRole('button', { name: 'More site options' }).click();
    more = page.getByRole('dialog', { name: 'More' });
    await expect(more.getByRole('switch', {
      name: 'Simulate real section heights',
    })).toHaveAttribute('aria-checked', 'false');
    await expect(more.getByLabel('Booking service menu fixture')).toHaveValue('canonical');
    await closeDialog(page, 'More');

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const preview = page.getByTestId('booking-section-preview');
    await expect(preview.getByRole('searchbox', { name: 'Search services' })).toHaveValue('');
    await expect(
      preview
        .getByRole('group', { name: 'Service categories' })
        .getByRole('button', { name: 'All', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('selected-service-summary')).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to editor' }).click();

    await page.reload();
    await expectPristineQuickBook(page);
  } finally {
    runtime.assertClean();
    runtime.stop();
  }
});
