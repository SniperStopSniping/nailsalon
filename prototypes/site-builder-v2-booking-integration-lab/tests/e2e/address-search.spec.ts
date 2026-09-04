import { expect, type Page, type Route, test } from '@playwright/test';

const STORAGE_KEY = 'luster:onboarding-v1-lab';
const PHOTON_ROUTE = 'https://photon.komoot.io/api/**';
const SELECTED_ADDRESS = '100 Queen Street West, Toronto, Ontario M5H 2N2';

function suggestions(houseNumber = '100', street = 'Queen Street West') {
  return {
    features: [{
      geometry: { coordinates: [-79.3832, 43.6532], type: 'Point' },
      properties: {
        city: 'Toronto',
        housenumber: houseNumber,
        postcode: 'M5H 2N2',
        state: 'Ontario',
        street,
      },
      type: 'Feature',
    }],
    type: 'FeatureCollection',
  };
}

async function openLocation(page: Page, visibility: 'hidden' | 'after_booking') {
  await page.goto('/?audit=1');
  await page.getByRole('button', { name: 'Start with Quick Book' }).click();
  await page.getByLabel('Salon or studio name *', { exact: true }).fill('Address Search Test Studio');
  await page.locator('label').filter({ has: page.getByRole('radio', { name: /^Independent nail tech/ }) }).click();
  await page.getByLabel('Your name *', { exact: true }).fill('Test Owner');
  await page.getByRole('button', { name: 'Show me my site →', exact: true }).click();
  await page.getByRole('button', { name: 'Continue setting up my site', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Where can clients find you?' })).toBeVisible();

  await page.getByLabel('City *', { exact: true }).fill('North York');
  await page.locator('label').filter({ has: page.locator(`input[name="address-visibility"][value="${visibility}"]`) }).click();
}

async function storedLocation(page: Page) {
  return page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key) ?? '{}');
    return state.profile?.location;
  }, STORAGE_KEY);
}

async function expectPrivacy(page: Page, visibility: 'hidden' | 'after_booking') {
  await expect(page.locator(`input[name="address-visibility"][value="${visibility}"]`)).toBeChecked();
  await expect(page.getByLabel('Autosave status')).toHaveText('Saved');

  await expect.poll(async () => {
    const location = await storedLocation(page);
    return {
      visibility: location?.addressVisibility,
      generalDirections: location?.allowGeneralAreaDirections,
    };
  }).toEqual({ visibility, generalDirections: visibility === 'hidden' });
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  const visibility = viewport.width === 320 ? 'hidden' : 'after_booking';

  test.describe(`address search ${viewport.width}px`, () => {
    test.use({ hasTouch: true, viewport });

    test('keyboard and touch selection fill both fields without changing address privacy', async ({ page }) => {
      const requests: string[] = [];
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route(PHOTON_ROUTE, async (route) => {
        requests.push(route.request().url());

        expect(route.request().method()).toBe('GET');
        expect(route.request().headers().cookie).toBeUndefined();
        expect(route.request().headers().referer).toBeUndefined();

        await route.fulfill({ json: suggestions() });
      });
      await openLocation(page, visibility);
      const address = page.getByRole('combobox', { name: 'Full address *', exact: true });
      await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
      await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
      await address.fill('100');
      await page.clock.runFor(700);

      expect(requests).toHaveLength(0);

      await address.fill('100 Queen');
      await page.clock.runFor(649);

      expect(requests).toHaveLength(0);

      await page.clock.runFor(1);
      const option = page.getByRole('option', { name: SELECTED_ADDRESS, exact: true });

      await expect(option).toBeVisible();
      expect(requests).toHaveLength(1);
      expect(new URL(requests[0]!).searchParams.get('q')).toBe('100 Queen, North York');
      await expect(address).toHaveAttribute('aria-expanded', 'true');

      await address.press('ArrowDown');

      await expect(option).toHaveAttribute('aria-selected', 'true');
      await expect(address).toHaveAttribute('aria-activedescendant', (await option.getAttribute('id'))!);

      await address.press('Enter');

      await expect(address).toHaveValue(SELECTED_ADDRESS);
      await expect(page.getByLabel('City *', { exact: true })).toHaveValue('Toronto');
      await expect(address).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('listbox', { name: 'Address suggestions' })).toHaveCount(0);

      await page.clock.runFor(1_000);

      expect(requests).toHaveLength(1);

      await expectPrivacy(page, visibility);
      const saved = await storedLocation(page);

      expect(saved.exactAddress).toBe(SELECTED_ADDRESS);
      expect(saved.cityOrArea).toBe('Toronto');
      expect(saved).not.toHaveProperty('coordinates');
      expect(saved).not.toHaveProperty('geometry');

      // Escape preserves the typed value; a subsequent edit reopens suggestions.
      await address.fill('100 Queen Street');
      await page.clock.runFor(650);

      await expect(option).toBeVisible();

      await address.press('Escape');

      await expect(option).toHaveCount(0);
      await expect(address).toHaveValue('100 Queen Street');

      await address.fill('100 Queen Street West');
      await page.clock.runFor(650);

      await expect(option).toBeVisible();

      await option.scrollIntoViewIfNeeded();
      const bounds = await option.boundingBox();

      expect(bounds!.height).toBeGreaterThanOrEqual(48);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);

      await expectNoOverflow(page);

      const screenshot = test.info().outputPath('address-suggestions-mobile.png');
      await page.screenshot({ path: screenshot });

      await test.info().attach('address-suggestions-mobile', { path: screenshot, contentType: 'image/png' });

      await option.tap();

      await expect(address).toHaveValue(SELECTED_ADDRESS);
      await expect(page.getByLabel('City *', { exact: true })).toHaveValue('Toronto');

      await page.clock.runFor(1_000);
      await expectPrivacy(page, visibility);

      expect(errors).toEqual([]);
    });

    test('stale and unavailable search never prevent a manual address from continuing', async ({ page }) => {
      let delayedRoute: Route | undefined;
      await page.route(PHOTON_ROUTE, async (route) => {
        const query = new URL(route.request().url()).searchParams.get('q') ?? '';
        if (query.startsWith('100 Old')) {
          delayedRoute = route;
          return;
        }
        if (query.startsWith('Unavailable')) {
          await route.fulfill({ status: 503, json: { error: 'unavailable' } });
          return;
        }
        await route.fulfill({ json: suggestions('200', 'New Street') });
      });
      await openLocation(page, 'after_booking');
      const address = page.getByRole('combobox', { name: 'Full address *', exact: true });
      await page.clock.install();
      await address.fill('100 Old Street');
      await page.clock.runFor(650);

      await expect.poll(() => Boolean(delayedRoute)).toBe(true);

      await address.fill('200 New Street');
      await page.clock.runFor(650);

      await expect(page.getByRole('option', { name: '200 New Street, Toronto, Ontario M5H 2N2', exact: true })).toBeVisible();

      await delayedRoute!.fulfill({ json: suggestions('100', 'Old Street') });

      await expect(page.getByRole('option')).toHaveCount(1);
      await expect(page.getByRole('option')).toHaveText('200 New Street, Toronto, Ontario M5H 2N2');
      await expect(address).toHaveValue('200 New Street');

      await address.fill('Unavailable address');
      await page.clock.runFor(650);

      await expect(page.getByRole('status').filter({ hasText: 'Search is unavailable. You can still enter your address manually.' })).toBeVisible();
      await expect(page.getByRole('option')).toHaveCount(0);

      await address.fill('55 Manual Lane, Suite 2');
      await page.getByLabel('City *', { exact: true }).fill('Toronto');
      await page.locator('[aria-controls="onboarding-contact-card-panel"]').click();
      await page.locator('label').filter({ has: page.getByRole('radio', { name: /^Online booking only/ }) }).click();
      await page.getByRole('button', { name: 'Save and continue', exact: true }).click();

      await expect(page.getByRole('heading', { name: 'When are you open?' })).toBeVisible();

      await page.clock.runFor(1_000);

      await expect.poll(() => storedLocation(page)).toMatchObject({
        addressVisibility: 'after_booking',
        allowGeneralAreaDirections: false,
        cityOrArea: 'Toronto',
        exactAddress: '55 Manual Lane, Suite 2',
      });

      await expectNoOverflow(page);
    });
  });
}
