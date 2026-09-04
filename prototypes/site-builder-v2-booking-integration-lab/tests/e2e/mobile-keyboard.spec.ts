import { expect, type Locator, type Page, test } from '@playwright/test';

const STORAGE_KEY = 'luster:onboarding-v1-lab';
const sizes = [[320, 568], [375, 667], [390, 844], [430, 932]] as const;

// Desktop browser automation cannot open the native iOS keyboard. Preserve real
// focus/touch behavior and simulate only the keyboard's VisualViewport resize.
async function installKeyboardViewport(page: Page) {
  await page.addInitScript(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      throw new Error('This regression requires VisualViewport support.');
    }
    let height: number | undefined;
    let scale = 1;
    Object.defineProperty(viewport, 'height', { configurable: true, get: () => height ?? window.innerHeight });
    Object.defineProperty(viewport, 'scale', { configurable: true, get: () => scale });
    Object.defineProperty(window, '__setKeyboardViewportHeight', {
      value: (nextHeight: number, nextScale: number) => {
        height = nextHeight;
        scale = nextScale;
        viewport.dispatchEvent(new Event('resize'));
      },
    });
  });
}

async function setKeyboardHeight(page: Page, height: number, scale = 1) {
  await page.evaluate(({ nextHeight, nextScale }) => {
    const setHeight = Reflect.get(window, '__setKeyboardViewportHeight') as (value: number, scale: number) => void;
    setHeight(nextHeight, nextScale);
  }, { nextHeight: height, nextScale: scale });
}

async function openBusiness(page: Page) {
  await page.goto('/?audit=1');
  await page.getByRole('button', { name: 'Start with Quick Book' }).click();

  await expect(page.getByRole('heading', { name: 'Let’s start with your business' })).toBeFocused();
}

async function expectActionsHidden(page: Page) {
  await expect(page.locator('.onboarding-shell')).toHaveAttribute('data-keyboard-open', 'true');
  await expect(page.locator('.sticky-onboarding-actions')).toHaveCSS('visibility', 'hidden');
  await expect(page.getByRole('button', { includeHidden: true, name: 'Show me my site →', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { includeHidden: true, name: 'Back', exact: true })).toBeHidden();
}

async function expectActionsVisible(page: Page) {
  await expect(page.locator('.sticky-onboarding-actions')).toHaveCSS('visibility', 'visible');
  await expect(page.getByRole('button', { name: 'Show me my site →', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
}

async function swipe(target: Locator) {
  await target.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const point = { identifier: 1, target: element, clientX: bounds.x + bounds.width / 2, clientY: bounds.y + 60 };
    const end = { ...point, clientY: point.clientY - 45 };
    // Desktop WebKit does not expose a constructible native Touch. Dispatch the
    // gesture coordinates explicitly; taps elsewhere still use real browser input.
    for (const [type, touches] of [['touchstart', [point]], ['touchmove', [end]], ['touchend', []]] as const) {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, 'touches', { value: touches });
      element.dispatchEvent(event);
    }
  });
}

for (const [width, height] of sizes) {
  test.describe(`mobile keyboard ${width}×${height}`, () => {
    test.use({ hasTouch: true, viewport: { width, height } });

    test('actions hide while typing and return after keyboard dismissal without losing changes', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await installKeyboardViewport(page);
      await openBusiness(page);
      const name = page.getByLabel('Salon or studio name *', { exact: true });
      await name.fill('Maya Nail Atelier');

      // A hardware keyboard or focus alone must not remove the action area.
      await expectActionsVisible(page);
      await setKeyboardHeight(page, height - 260);
      await expectActionsHidden(page);

      await expect(name).toBeFocused();

      await name.press('End');
      await name.pressSequentially(' & Studio');

      await expect(name).toHaveValue('Maya Nail Atelier & Studio');

      if (width === 390) {
        await test.info().attach('keyboard-open-actions-hidden', { body: await page.screenshot(), contentType: 'image/png' });
      }

      // Native focus/validation may scroll the page. Only an intentional gesture
      // should dismiss editing, not the resulting scroll events themselves.
      await page.evaluate(() => window.scrollBy({ top: 150, behavior: 'instant' }));
      await name.scrollIntoViewIfNeeded();

      await expect(name).toBeFocused();

      await expectActionsHidden(page);

      // Even sequential keyboard navigation must skip the hidden action area.
      await page.locator('main').evaluate((element) => {
        const controls = [...element.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href]')]
          .filter(control => control.tabIndex >= 0 && control.getClientRects().length > 0
            && getComputedStyle(control).visibility !== 'hidden');
        controls.at(-1)?.focus();
      });
      await page.keyboard.press('Tab');

      expect(await page.evaluate(() => document.activeElement?.closest('.sticky-onboarding-actions') === null)).toBe(true);

      await name.focus();
      await expectActionsHidden(page);

      // Closing the keyboard with its own Done control does not always blur iOS inputs.
      await setKeyboardHeight(page, height);
      await expectActionsVisible(page);

      await expect(name).toBeFocused();

      await setKeyboardHeight(page, height - 260);
      await expectActionsHidden(page);

      await page.getByRole('heading', { name: 'Let’s start with your business' }).tap();

      await expect(name).not.toBeFocused();

      await setKeyboardHeight(page, height);
      await expectActionsVisible(page);

      await name.tap();
      await setKeyboardHeight(page, height - 260);
      await expectActionsHidden(page);
      await swipe(name);

      await expect(name).toBeFocused();

      await expectActionsHidden(page);
      await swipe(page.getByRole('heading', { name: 'Let’s start with your business' }));

      await expect(name).not.toBeFocused();

      await setKeyboardHeight(page, height);
      await expectActionsVisible(page);
      if (width === 390) {
        await test.info().attach('keyboard-dismissed-actions-restored', { body: await page.screenshot(), contentType: 'image/png' });
      }

      await expect(page.getByLabel('Autosave status')).toHaveText('Saved');
      await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').profile?.businessName, STORAGE_KEY))
        .toBe('Maya Nail Atelier & Studio');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await page.reload();

      await expect(name).toHaveValue('Maya Nail Atelier & Studio');

      await expectActionsVisible(page);

      expect(errors).toEqual([]);
    });

    test('address suggestion taps remain usable while keyboard actions are hidden', async ({ page }) => {
      await installKeyboardViewport(page);
      await page.route('https://photon.komoot.io/api/**', route => route.fulfill({
        json: {
          features: [{
            geometry: { coordinates: [-79.3832, 43.6532], type: 'Point' },
            properties: { city: 'Toronto', housenumber: '100', postcode: 'M5H 2N2', state: 'Ontario', street: 'Queen Street West' },
            type: 'Feature',
          }],
          type: 'FeatureCollection',
        },
      }));
      await openBusiness(page);
      await page.getByLabel('Salon or studio name *', { exact: true }).fill('Maya Nail Atelier');
      await page.locator('label').filter({ has: page.getByRole('radio', { name: /^Independent nail tech/ }) }).click();
      await page.getByLabel('Your name *', { exact: true }).fill('Maya');
      await page.getByRole('button', { name: 'Show me my site →', exact: true }).click();
      await page.getByRole('button', { name: 'Continue setting up my site', exact: true }).click();
      await page.getByLabel('City *', { exact: true }).fill('North York');
      await page.locator('label').filter({ has: page.locator('input[name="address-visibility"][value="after_booking"]') }).click();
      const address = page.getByRole('combobox', { name: 'Full address *', exact: true });
      await address.fill('100 Queen');
      await setKeyboardHeight(page, height - 260);

      await expect(page.locator('.sticky-onboarding-actions')).toHaveCSS('visibility', 'hidden');

      const option = page.getByRole('option', { name: '100 Queen Street West, Toronto, Ontario M5H 2N2', exact: true });

      await expect(option).toBeVisible();

      await option.tap();

      await expect(address).toHaveValue('100 Queen Street West, Toronto, Ontario M5H 2N2');
      await expect(page.getByLabel('City *', { exact: true })).toHaveValue('Toronto');
      await expect(page.locator('input[name="address-visibility"][value="after_booking"]')).toBeChecked();

      await setKeyboardHeight(page, height);

      await expect(page.locator('.sticky-onboarding-actions')).toHaveCSS('visibility', 'visible');
    });
  });
}

test.describe('mobile focus zoom', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('keyboard detection handles Safari focus zoom without mistaking pinch zoom for a keyboard', async ({ page }) => {
    await installKeyboardViewport(page);
    await openBusiness(page);
    const name = page.getByLabel('Salon or studio name *', { exact: true });
    await name.fill('Maya Nail Atelier');
    await setKeyboardHeight(page, 844 / 1.3, 1.3);
    await expectActionsVisible(page);
    await setKeyboardHeight(page, (844 - 260) / 1.3, 1.3);
    await expectActionsHidden(page);

    await expect(name).toBeFocused();

    await setKeyboardHeight(page, 844 / 1.3, 1.3);
    await expectActionsVisible(page);

    await expect(name).toBeFocused();
  });
});

test.describe('desktop keyboard', () => {
  test.use({ hasTouch: false, viewport: { width: 1440, height: 900 } });

  test('typing with a hardware keyboard leaves onboarding actions available', async ({ page }) => {
    await installKeyboardViewport(page);
    await openBusiness(page);
    const name = page.getByLabel('Salon or studio name *', { exact: true });
    await name.fill('Desktop Studio');
    await setKeyboardHeight(page, 600);
    await expectActionsVisible(page);

    await expect(name).toBeFocused();
  });
});
