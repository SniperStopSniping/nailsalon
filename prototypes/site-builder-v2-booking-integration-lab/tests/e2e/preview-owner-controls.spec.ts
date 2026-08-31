import {
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test';

import {
  chooseStarter,
  openFreshLab,
} from './helpers';

const REVIEW_VIEWPORTS = [
  { height: 568, width: 320 },
  { height: 667, width: 375 },
  { height: 844, width: 390 },
  { height: 932, width: 430 },
  { height: 320, width: 568 },
  { height: 1024, width: 768 },
  { height: 390, width: 844 },
  { height: 600, width: 899 },
  { height: 600, width: 900 },
] as const;

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))).toEqual({ body: 0, html: 0 });
}

async function expectHitTarget(locator: Locator): Promise<void> {
  await expect.poll(() => locator.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
    );
    return hit === element || element.contains(hit);
  })).toBe(true);
}

test('Preview keeps the dashboard action in owner chrome at every review viewport', async ({
  page,
}) => {
  test.setTimeout(120_000);

  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');

  for (const [index, viewport] of REVIEW_VIEWPORTS.entries()) {
    await page.setViewportSize(viewport);

    const floatingDashboard = page.locator('.onboarding-builder-return');
    const editorDock = page.locator('.final-mobile-dock');

    await expect(floatingDashboard).toBeVisible();

    if (viewport.width < 900) {
      await expect(editorDock).toBeVisible();
      await expect(floatingDashboard).toHaveCSS('bottom', '88px');
    } else {
      await expect(editorDock).toBeHidden();
      await expect(floatingDashboard).toHaveCSS('bottom', '12px');
    }

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const toolbar = page.getByRole('banner', { name: 'Preview controls' });
    const backToEditor = toolbar.getByRole('button', { name: 'Back to editor' });
    const backToDashboard = toolbar.getByRole('button', { name: 'Back to dashboard' });
    const customerViewport = page.locator(
      '.final-canonical-preview .onboarding-preview-frame',
    );

    await expect(toolbar).toBeVisible();
    await expect(backToDashboard).toBeVisible();
    await expect(floatingDashboard).toBeHidden();
    await expect(editorDock).toHaveCount(0);
    await expect(customerViewport).toHaveAttribute('data-palette-preset', 'luster_berry');
    await expect(customerViewport).toHaveAttribute('data-style-preset', 'modern');
    await expect(page.locator('.final-canonical-preview .onboarding-customer-hero'))
      .toBeVisible();
    await expect(page.locator('.final-canonical-preview [data-library-type]'))
      .not.toHaveCount(0);
    await expect(page.locator('.final-canonical-preview .preview-section__number'))
      .toHaveCount(0);

    const [toolbarBox, dashboardBox, customerBox] = await Promise.all([
      toolbar.boundingBox(),
      backToDashboard.boundingBox(),
      customerViewport.boundingBox(),
    ]);

    expect(toolbarBox).not.toBeNull();
    expect(dashboardBox).not.toBeNull();
    expect(customerBox).not.toBeNull();

    if (toolbarBox && dashboardBox && customerBox) {
      expect(dashboardBox.width).toBeGreaterThanOrEqual(44);
      expect(dashboardBox.height).toBeGreaterThanOrEqual(44);
      expect(dashboardBox.x).toBeGreaterThanOrEqual(toolbarBox.x - 1);
      expect(dashboardBox.x + dashboardBox.width)
        .toBeLessThanOrEqual(toolbarBox.x + toolbarBox.width + 1);
      expect(dashboardBox.y).toBeGreaterThanOrEqual(toolbarBox.y - 1);
      expect(dashboardBox.y + dashboardBox.height)
        .toBeLessThanOrEqual(toolbarBox.y + toolbarBox.height + 1);
      expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(customerBox.y + 1);
    }
    await expectNoHorizontalOverflow(page);

    if (viewport.width === 320) {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');

      await expect(backToDashboard).toBeFocused();
      expect(await backToDashboard.evaluate(element => ({
        focusVisible: element.matches(':focus-visible'),
        outlineStyle: getComputedStyle(element).outlineStyle,
        outlineWidth: getComputedStyle(element).outlineWidth,
      }))).toEqual({
        focusVisible: true,
        outlineStyle: 'solid',
        outlineWidth: '3px',
      });

      await page.keyboard.press('Shift+Tab');

      await expect(backToEditor).toBeFocused();
    }

    if (index === REVIEW_VIEWPORTS.length - 1) {
      await backToDashboard.click();

      await expect(page.getByRole('heading', { name: 'Your Luster site is ready' }))
        .toBeVisible();
    } else {
      await backToEditor.click();

      await expect(page.getByTestId('final-hybrid-editor')).toBeVisible();
    }
  }
});

test('Preview owner controls leave selected-service actions visible and tappable', async ({
  page,
}) => {
  await page.setViewportSize({ height: 568, width: 320 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  const booking = page.getByTestId('booking-section-preview');
  await booking.getByRole('searchbox', { name: 'Search services' })
    .fill('Russian manicure');
  const service = booking.getByRole('button', { name: /Russian Manicure/ }).first();
  await service.scrollIntoViewIfNeeded();
  await expectHitTarget(service);
  await service.click();

  const detail = page.getByTestId('service-detail-dialog');
  await detail.getByRole('button', { name: 'Select service' }).click();

  const summary = page.getByTestId('selected-service-summary');
  const change = summary.getByRole('button', { name: 'Change' });
  const continueBooking = summary.getByRole('button', { name: 'Continue' });
  await change.scrollIntoViewIfNeeded();
  await expectHitTarget(change);
  await expectHitTarget(continueBooking);
  await change.click();

  await expect(page.getByTestId('service-detail-dialog')).toBeVisible();

  await page.getByTestId('service-detail-dialog')
    .getByRole('button', { name: 'Keep browsing' })
    .click();
  await continueBooking.scrollIntoViewIfNeeded();
  await expectHitTarget(continueBooking);
  await continueBooking.click();

  await expect(page.getByTestId('booking-handoff-dialog')).toBeVisible();

  await page.getByRole('button', { name: 'Close booking handoff' }).click();

  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Back to editor' }).click();

  await expect(page.locator('.onboarding-builder-return')).toBeVisible();
});

test('the selected-service summary leaves the final service cards tappable', async ({
  page,
}) => {
  test.setTimeout(90_000);

  await page.setViewportSize({ height: 390, width: 844 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  const booking = page.getByTestId('booking-section-preview');
  const service = booking.getByRole('button', { name: /Russian Manicure/ }).first();
  await service.scrollIntoViewIfNeeded();
  await service.click();
  await page.getByTestId('service-detail-dialog')
    .getByRole('button', { name: 'Select service' })
    .click();

  await expect(page.getByTestId('selected-service-summary')).toBeVisible();

  for (const viewport of [
    { height: 390, width: 844 },
    { height: 1024, width: 768 },
  ]) {
    await page.setViewportSize(viewport);
    const finalService = booking.getByRole('button', {
      name: /Gel Manicure \+ Gel Pedicure/,
    }).last();
    await finalService.scrollIntoViewIfNeeded();
    await expectHitTarget(finalService);
  }
});
