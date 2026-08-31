import { expect, type Locator, type Page, test } from '@playwright/test';

const showcaseUrl = (params: Record<string, string>): string =>
  `/?${new URLSearchParams({ audit: '1', device: 'phone', full: '1', surface: 'sections', ...params }).toString()}`;

const expectMinimumTouchHeight = async (locator: Locator, label: string) => {
  const count = await locator.count();

  expect(count, `${label} controls`).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const box = await locator.nth(index).boundingBox();

    expect(box, `${label} ${index + 1} is visible`).not.toBeNull();
    expect(box?.height, `${label} ${index + 1} touch height`).toBeGreaterThanOrEqual(44);
  }
};

const openShowcase = async (page: Page, params: Record<string, string>) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto(showcaseUrl(params));

  await expect(page.locator('[data-showcase-ready]')).toBeVisible();
};

test.describe('section-library customer accessibility', () => {
  test('button-like section controls retain a 44px phone touch target', async ({ page }) => {
    await openShowcase(page, { type: 'featured_services' });
    await expectMinimumTouchHeight(page.locator('.customer-lib-text-cta'), 'Featured service CTA');

    await openShowcase(page, { type: 'faq' });
    await expectMinimumTouchHeight(page.locator('.customer-lib-faq summary'), 'FAQ disclosure');

    await openShowcase(page, { recipe: 'signature_one_page' });
    await expectMinimumTouchHeight(page.locator('.customer-lib-section-nav a'), 'Section navigation');

    await openShowcase(page, { type: 'visit_us' });
    await expectMinimumTouchHeight(page.locator('.customer-lib-visit-contact a'), 'Visit contact action');
  });

  test('customer page navigation retains a 44px phone touch target', async ({ page }) => {
    await openShowcase(page, { recipe: 'the_collective' });
    await expectMinimumTouchHeight(
      page.locator('.onboarding-customer-header nav a:visible'),
      'Customer page navigation',
    );
  });
});
