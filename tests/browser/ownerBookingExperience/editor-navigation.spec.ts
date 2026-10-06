import { expect, test } from '@playwright/test';

import { mockApi } from './fixtures';

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus || page.isClosed()) {
    return;
  }
  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll('body *')].map((element) => {
      const bounds = element.getBoundingClientRect();
      return { tag: element.tagName, text: element.textContent?.slice(0, 80), right: bounds.right, width: bounds.width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
    }).filter(element => element.width > 0 && (element.right > window.innerWidth + 0.5 || element.scrollWidth > element.clientWidth + 2)),
  }));
  await testInfo.attach('overflow-geometry', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath('failure-full-page.png'), fullPage: true });
});

async function openSections(page: import('@playwright/test').Page) {
  const toggle = page.getByRole('button', { name: /^Sections/ });
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') {
    await toggle.click();
  }
  return page.getByRole('navigation', { name: 'Booking Page editors' });
}

for (const width of [320, 390, 1440]) {
  test(`grouped entry and section changes at ${width}px and enlarged text`, async ({ page }, testInfo) => {
    await mockApi(page, false);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/en/admin/website?salon=isla');

    await expect(page.getByRole('heading', { name: 'Business profile & content', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Visibility & booking', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Booking Page editors' }).getByRole('link')).toHaveCount(10);

    await page.screenshot({ path: testInfo.outputPath(`hub-${width}.png`), fullPage: true });
    await page.getByRole('link', { name: /Style, Colours & Fonts Fonts/ }).click();

    await expect(page.getByRole('heading', { name: 'Style, Colours & Fonts', exact: true })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Page draft status' })).toHaveText('Published · No page changes');

    await expect.poll(() => page.getByRole('button', { name: /^Sections/ }).isVisible()).toBe(width < 1024);
    await expect.poll(() => page.getByRole('navigation', { name: 'Booking Page editors' }).isVisible()).toBe(width >= 1024);

    await page.screenshot({ path: testInfo.outputPath(`appearance-${width}.png`), fullPage: false });
    const navigation = await openSections(page);
    await navigation.getByRole('link', { name: 'About & Website Text' }).click();

    await expect(page).toHaveURL(/panel=text$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();

    await page.getByTestId('content-bio').fill('A saved fixture biography.');
    await (await openSections(page)).getByRole('link', { name: 'Preview & Publish' }).click();

    await expect(page).toHaveURL(/panel=publish$/);
    await expect(page.getByRole('status', { name: 'Page draft status' })).toContainText('Draft saved · 1 unpublished change');
    await expect(page.getByTestId('booking-page-draft-review')).toContainText('Studio bio changed');

    await page.goBack();

    await expect(page.getByTestId('content-bio')).toHaveValue('A saved fixture biography.');

    await page.addStyleTag({ content: 'html { font-size: 200%; }' });

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.screenshot({ path: testInfo.outputPath(`text-${width}-200-percent.png`), fullPage: true });
    // Wider text must reflow too; fallback-font metrics differ between macOS and Linux.
    await page.addStyleTag({ content: 'html { letter-spacing: 0.12em; }' });

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.screenshot({ path: testInfo.outputPath(`text-${width}-200-percent-spaced.png`), fullPage: true });
  });
}

test('failed draft saves preserve edits and allow retry before changing sections', async ({ page }) => {
  const control = await mockApi(page, false);
  control.failSave = true;
  await page.goto('/?salon=isla&panel=text');
  await page.getByTestId('content-bio').fill('Keep this unsaved biography.');
  await (await openSections(page)).getByRole('link', { name: 'Style, Colours & Fonts' }).click();

  await expect(page.getByRole('status', { name: 'Page draft status' })).toContainText('Could not save the draft');
  await expect(page).toHaveURL(/panel=text$/);
  await expect(page.getByTestId('content-bio')).toHaveValue('Keep this unsaved biography.');

  control.failSave = false;
  await (await openSections(page)).getByRole('link', { name: 'Style, Colours & Fonts' }).click();

  await expect(page).toHaveURL(/panel=appearance$/);
  await expect(page.getByRole('status', { name: 'Page draft status' })).toContainText('1 unpublished change');
});

test('explicit-save messages keep their leave guard and free-solo navigation stays scoped', async ({ page }, testInfo) => {
  const control = await mockApi(page, true);
  await page.goto('/?salon=isla&panel=experience');
  await page.getByLabel('Booking message').fill('Keep my unsaved message.');
  const nav = await openSections(page);

  await expect(nav.getByRole('link', { name: 'Booking Flow' })).toHaveCount(0);

  await nav.getByRole('link', { name: 'About & Website Text' }).click();

  await expect(page.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeVisible();
  await expect(page).toHaveURL(/panel=experience$/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.screenshot({ path: testInfo.outputPath('message-leave-guard.png'), fullPage: true });
  await page.getByRole('button', { name: 'Keep editing' }).click();

  await expect(page.getByLabel('Booking message')).toHaveValue('Keep my unsaved message.');

  await (await openSections(page)).getByRole('link', { name: 'About & Website Text' }).click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();

  await expect(page).toHaveURL(/panel=text$/);
  expect(control.patches).toHaveLength(0);
});
