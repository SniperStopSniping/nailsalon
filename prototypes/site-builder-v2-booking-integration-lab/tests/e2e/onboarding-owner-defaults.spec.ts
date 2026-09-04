import { expect, type Page, test } from '@playwright/test';

const STORAGE_KEY = 'luster:onboarding-v1-lab';
const sizes = [[320, 568], [375, 667], [390, 844], [430, 932]] as const;

async function storedState(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}'), STORAGE_KEY);
}

async function chooseBusiness(page: Page, name: RegExp) {
  await page.locator('label').filter({ has: page.getByRole('radio', { name }) }).click();
}

for (const [width, height] of sizes) {
  test.describe(`owner defaults and colours ${width}×${height}`, () => {
    test.use({ hasTouch: true, viewport: { width, height } });

    test('keeps fresh defaults discoverable and preserves chosen privacy and palette data', async ({ page }) => {
      await page.route('https://photon.komoot.io/api/**', route => route.fulfill({ json: { features: [] } }));
      await page.goto('/?audit=1');
      await page.getByRole('button', { name: 'Start with Quick Book' }).click();

      await expect(page.getByRole('heading', { name: 'Let’s start with your business' })).toBeFocused();

      await page.getByLabel('Salon or studio name *', { exact: true }).fill('Maya Test Atelier');
      await chooseBusiness(page, /^Home-based nail tech/);

      await expect.poll(async () => (await storedState(page)).profile?.location.addressVisibility).toBe('after_booking');

      await chooseBusiness(page, /^Independent nail tech/);

      await expect.poll(async () => (await storedState(page)).profile?.location.addressVisibility).toBe('public');

      await page.getByLabel('Your name *', { exact: true }).fill('Maya');
      await page.getByRole('button', { name: 'Show me my site →', exact: true }).click();
      await page.getByRole('button', { name: 'Continue setting up my site', exact: true }).click();

      await expect(page.locator('input[name="address-visibility"][value="public"]')).toBeChecked();

      await page.getByLabel('City *', { exact: true }).fill('Toronto');
      await page.getByLabel('Full address *', { exact: true }).fill('100 Test Avenue');
      await page.locator('label').filter({ has: page.locator('input[name="address-visibility"][value="hidden"]') }).click();

      await expect.poll(async () => (await storedState(page)).profile?.location.addressVisibilityDefaulted).toBe(false);

      await page.getByRole('button', { name: /^Contact/ }).click();

      await expect(page.getByRole('radio', { name: /^Let clients contact me directly/ })).toBeChecked();
      await expect(page.getByLabel('Phone number', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Email · Optional', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Contact/ })).not.toContainText('Complete');

      await page.getByLabel('Email · Optional', { exact: true }).fill('maya@example.test');
      await page.getByRole('button', { name: 'Save and continue', exact: true }).click();

      await expect(page.getByRole('heading', { name: 'When are you open?' })).toBeVisible();

      await page.getByRole('button', { name: 'Apply to selected days', exact: true }).click();
      await page.getByRole('button', { name: 'Save and continue', exact: true }).click();

      await expect(page.getByRole('heading', { name: 'Make it feel like yours' })).toBeVisible();

      const colours = page.getByRole('region', { name: 'Choose your colours' });
      await colours.scrollIntoViewIfNeeded();

      await expect(colours.getByText('Next, make it yours')).toBeVisible();
      await expect(colours).toHaveCSS('border-top-width', '1px');
      await expect(colours).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

      if (height <= 700) {
        const choose = colours.getByRole('button', { name: 'Choose website colours' });

        await expect(choose).toBeVisible();
        expect((await choose.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expect(colours.locator('.onboarding-palette-summary__swatches i')).toHaveCount(5);

        await test.info().attach('colours-collapsed', { body: await colours.screenshot({ path: `/tmp/luster-owner-colours-${width}-collapsed.png` }), contentType: 'image/png' });

        await choose.click();
      }

      await expect.poll(async () => {
        const state = await storedState(page);
        return [state.profile?.email, state.profile?.hours.setupState];
      }).toEqual(['maya@example.test', 'configured']);

      const before = await storedState(page);
      await colours.getByRole('button', { name: /Sage & Stone/ }).click();

      await expect.poll(async () => (await storedState(page)).recipe?.palettePreset).toBe('sage_stone');

      const after = await storedState(page);

      expect(after.profile).toEqual(before.profile);
      expect(after.recipe.stylePreset).toBe(before.recipe.stylePreset);
      expect(after.profile.location.addressVisibility).toBe('hidden');
      expect(after.profile.email).toBe('maya@example.test');
      expect(after.profile.bookingOnlyContact).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await test.info().attach('colours-expanded', { body: await colours.screenshot({ path: `/tmp/luster-owner-colours-${width}-expanded.png` }), contentType: 'image/png' });

      await page.reload();

      if (height <= 700) {
        await page.getByRole('button', { name: 'Choose website colours' }).click();
      }

      await expect(page.getByRole('button', { name: /Sage & Stone/ })).toHaveAttribute('aria-pressed', 'true');
    });
  });
}
