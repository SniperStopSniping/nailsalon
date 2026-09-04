import { expect, type Locator, test } from '@playwright/test';

async function expectSeparatedLabel(heading: Locator) {
  const geometry = await heading.evaluate((element) => {
    const badge = element.querySelector('span')!;
    const range = document.createRange();
    range.setStart(element.firstChild!, 0);
    range.setEndBefore(badge);
    const title = range.getBoundingClientRect();
    const optional = badge.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    return {
      fits: optional.right <= bounds.right + 1,
      separated: optional.left >= title.right + 7 || optional.top >= title.bottom,
    };
  });

  expect(geometry).toEqual({ fits: true, separated: true });
}

for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932]] as const) {
  test.describe(`optional business labels ${width}×${height}`, () => {
    test.use({ hasTouch: true, viewport: { width, height } });

    test('titles and Optional have clear spacing in collapsed and expanded cards', async ({ page }) => {
      await page.goto('/?audit=1');
      await page.getByRole('button', { name: 'Start with Quick Book' }).click();

      await expect(page.getByRole('heading', { name: 'Let’s start with your business' })).toBeFocused();

      await page.locator('label').filter({ has: page.getByRole('radio', { name: /^Independent nail tech/ }) }).click();

      for (const title of ['Profile photo', 'Logo', 'Instagram']) {
        const heading = page.getByRole('heading', { name: `${title} Optional`, exact: true });

        await expect(heading).toBeVisible();

        await expectSeparatedLabel(heading);

        const card = heading.locator('xpath=ancestor::section[1]');
        const disclosure = card.locator('header button');
        if (await disclosure.isVisible()) {
          await disclosure.click();
          await expectSeparatedLabel(heading);
        }
      }

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await page.getByRole('heading', { name: 'Profile photo Optional', exact: true }).scrollIntoViewIfNeeded();

      await test.info().attach('optional-label-spacing', { body: await page.screenshot(), contentType: 'image/png' });
    });
  });
}
