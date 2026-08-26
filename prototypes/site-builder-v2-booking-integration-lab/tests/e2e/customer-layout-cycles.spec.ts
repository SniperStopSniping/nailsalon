import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  bookingCard,
  chooseStarter,
  openFreshLab,
  selectBooking,
  startRuntimeMonitor,
  waitForSaved,
} from './helpers';

const LAYOUTS = [
  { id: 'visual_grid', label: 'Visual Grid', filtered: true },
  { id: 'clean_list', label: 'Clean List', filtered: true },
  { id: 'editorial_cards', label: 'Editorial Cards', filtered: false },
  { id: 'category_menu', label: 'Category Menu', filtered: true },
  { id: 'editorial_price_list', label: 'Editorial Price List', filtered: false },
] as const;

async function openBookingSettings(page: Page): Promise<Locator> {
  await selectBooking(page, 'Home');
  const mobileEdit = page
    .getByRole('group', { name: 'Booking actions' })
    .getByRole('button', { name: 'Edit', exact: true });
  const desktopEdit = page
    .getByTestId('selected-section-toolbar')
    .getByRole('button', { name: 'Edit', exact: true });
  if (await mobileEdit.isVisible()) {
    await mobileEdit.click();
  } else {
    await desktopEdit.click();
  }
  const settings = page.getByRole('dialog', { name: 'Booking settings' });
  await expect(settings).toBeVisible();
  return settings;
}

async function chooseBrowseCategory(
  renderer: Locator,
  layout: (typeof LAYOUTS)[number]['id'],
): Promise<void> {
  if (layout === 'category_menu') {
    await renderer
      .getByRole('navigation', { name: 'Service category navigation' })
      .getByRole('button', { name: /^Pedicure/ })
      .click();
    return;
  }
  await renderer
    .getByRole('group', { name: 'Service categories' })
    .getByRole('button', { name: 'Pedicure', exact: true })
    .click();
}

async function expectCategoryContext(
  renderer: Locator,
  layout: (typeof LAYOUTS)[number]['id'],
): Promise<void> {
  if (layout === 'editorial_cards') {
    await expect(
      renderer.locator('article').filter({ hasText: 'Russian Manicure' }).first(),
    ).toContainText('Manicure');
    return;
  }
  await expect(
    renderer.locator('.price-category').filter({ hasText: 'Russian Manicure' }),
  ).toContainText('Manicure');
}

for (const layout of LAYOUTS) {
  test(`${layout.label} completes its full customer cycle and restores clean Edit state`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const runtime = startRuntimeMonitor(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');

    const settings = await openBookingSettings(page);
    const layoutOption = settings.locator(`[data-layout-option="${layout.id}"]`);
    await layoutOption.click();
    await expect(layoutOption).toHaveAttribute('aria-pressed', 'true');
    await settings.getByRole('button', { name: 'Close Booking settings' }).click();
    await expect(settings).toHaveCount(0);
    await waitForSaved(page);

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const renderer = page.getByTestId('booking-section-preview');
    await expect(renderer).toHaveAttribute('data-booking-mode', 'preview');
    await expect(renderer.locator('[data-booking-renderer="shared-booking-section"]'))
      .toHaveAttribute('data-layout', layout.id);

    const search = renderer.getByRole('searchbox', { name: 'Search services' });
    if (layout.filtered) {
      await expect(search).toBeVisible();
      await chooseBrowseCategory(renderer, layout.id);
      await search.fill('russ');
      if (layout.id === 'category_menu') {
        await expect(renderer.locator('.category-sidebar-button.is-active'))
          .toContainText('All services');
      } else {
        await expect(renderer.getByRole('group', { name: 'Service categories' })
          .getByRole('button', { name: 'All', exact: true }))
          .toHaveAttribute('aria-pressed', 'true');
      }
    } else {
      await expect(search).toHaveCount(0);
      await expectCategoryContext(renderer, layout.id);
    }

    await renderer
      .getByRole('button', { name: /Russian Manicure/ })
      .last()
      .click();
    const detail = page.getByTestId('service-detail-dialog');
    await expect(detail).toBeVisible();
    await detail.getByRole('checkbox', { name: /French/ }).check();
    await expect(detail.getByTestId('service-detail-total')).toContainText('1 hr 45 min');
    await expect(detail.getByTestId('service-detail-total')).toContainText('From $80');
    await detail.getByRole('button', { name: 'Select service' }).click();

    const summary = page.getByTestId('selected-service-summary');
    await expect(summary).toContainText('Russian Manicure');
    await expect(summary).toContainText('1 hr 45 min · From $80 · 1 add-on');

    await summary.getByRole('button', { name: 'Change' }).click();
    let changedDetail = page.getByTestId('service-detail-dialog');
    await changedDetail.getByRole('checkbox', { name: /French/ }).uncheck();
    await changedDetail.getByRole('button', { name: 'Keep browsing' }).click();
    await expect(summary).toContainText('1 hr 30 min · From $65');
    await expect(summary).not.toContainText('add-on');

    await summary.getByRole('button', { name: 'Change' }).click();
    changedDetail = page.getByTestId('service-detail-dialog');
    await changedDetail.getByRole('checkbox', { name: /French/ }).check();
    await changedDetail.getByRole('button', { name: 'Continue' }).click();
    const handoff = page.getByTestId('booking-handoff-dialog');
    await expect(handoff).toContainText('Booking flow continues here');
    await expect(handoff).toContainText('Russian Manicure · 1 hr 45 min · From $80');
    await handoff.getByRole('button', { name: 'Back to the menu' }).click();

    await page.getByRole('button', { name: 'Back to editor' }).click();
    const editBooking = bookingCard(page, 'Home');
    await expect(editBooking.locator('.booking-surface')).toHaveAttribute(
      'data-has-selection',
      'false',
    );
    await expect(page.getByTestId('selected-service-summary')).toHaveCount(0);
    await expect(page.getByTestId('service-detail-dialog')).toHaveCount(0);
    await expect(page.getByTestId('booking-handoff-dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const restoredRenderer = page.getByTestId('booking-section-preview');
    const restoredSearch = restoredRenderer.getByRole('searchbox', {
      name: 'Search services',
    });
    if (layout.filtered) {
      await expect(restoredSearch).toHaveValue('');
      if (layout.id === 'category_menu') {
        await expect(
          restoredRenderer.locator('.category-sidebar-button.is-active'),
        ).toContainText('All services');
      } else {
        await expect(
          restoredRenderer
            .getByRole('group', { name: 'Service categories' })
            .getByRole('button', { name: 'All', exact: true }),
        ).toHaveAttribute('aria-pressed', 'true');
      }
    }
    await expect(page.getByTestId('selected-service-summary')).toContainText(
      'Russian Manicure',
    );
    await expect(page.getByTestId('selected-service-summary')).toContainText(
      '1 hr 45 min · From $80 · 1 add-on',
    );
    runtime.assertClean();
    runtime.stop();
  });
}
