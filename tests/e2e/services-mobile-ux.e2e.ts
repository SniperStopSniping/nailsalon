/**
 * Mobile QA for the owner Services sheet — real DOM geometry at iPhone widths.
 *
 * Runs against a dev server whose database holds the seeded salon below. It
 * SKIPS itself wherever the admin dashboard is auth-gated (the same guard
 * `admin-service-detail-geometry.e2e.ts` uses), so it never runs against a
 * hosted environment. `SERVICES` mirrors those seeded rows; the names are
 * deliberately long because name/price collision is the defect being checked.
 *
 * Local run:
 *   PORT=3101 E2E_BASE_URL=http://localhost:3101 \
 *     npx playwright test tests/e2e/services-mobile-ux.e2e.ts --project=chromium --no-deps
 */
import { expect, type Page, test } from '@playwright/test';

const VIEWPORTS = [
  { width: 320, height: 700, label: '320x700' },
  { width: 375, height: 667, label: '375x667' },
  { width: 390, height: 844, label: '390x844' },
  { width: 430, height: 932, label: '430x932' },
] as const;

const SERVICES = [
  {
    id: 'svc_combo',
    name: 'Gel Manicure + Gel Pedicure',
    description: null,
    descriptionItems: null,
    price: 9000,
    priceDisplayText: null,
    isIntroPrice: false,
    introPriceLabel: null,
    durationMinutes: 150,
    preparationBufferMinutes: 0,
    cleanupBufferMinutes: 0,
    category: 'combo',
    bookingCategory: 'combo',
    templateKey: null,
    featuredOrder: null,
    imageUrl: null,
    isActive: true,
    assignedTechnicianCount: 2,
  },
  {
    id: 'svc_russian',
    name: 'Russian Manicure — Combination Dry Prep',
    description: null,
    descriptionItems: null,
    price: 3500,
    priceDisplayText: 'Starting at $35',
    isIntroPrice: false,
    introPriceLabel: null,
    durationMinutes: 35,
    preparationBufferMinutes: 0,
    cleanupBufferMinutes: 0,
    category: 'manicure',
    bookingCategory: 'manicure',
    templateKey: null,
    featuredOrder: null,
    imageUrl: null,
    isActive: true,
    assignedTechnicianCount: 2,
  },
  {
    id: 'svc_biab',
    name: 'BIAB + Gel Pedicure',
    description: null,
    descriptionItems: null,
    price: 10500,
    priceDisplayText: 'From $115',
    isIntroPrice: false,
    introPriceLabel: null,
    durationMinutes: 180,
    preparationBufferMinutes: 0,
    cleanupBufferMinutes: 0,
    category: 'combo',
    bookingCategory: 'combo',
    templateKey: null,
    featuredOrder: null,
    imageUrl: null,
    isActive: true,
    assignedTechnicianCount: 2,
  },
  {
    id: 'svc_gelx',
    name: 'Gel-X Extensions (Extra Long Almond Shape)',
    description: null,
    descriptionItems: null,
    price: 12000,
    priceDisplayText: null,
    isIntroPrice: false,
    introPriceLabel: null,
    durationMinutes: 210,
    preparationBufferMinutes: 0,
    cleanupBufferMinutes: 0,
    category: 'extensions',
    bookingCategory: 'manicure',
    templateKey: null,
    featuredOrder: null,
    imageUrl: null,
    isActive: false,
    assignedTechnicianCount: 0,
  },
];

/**
 * Records the service-side relationship writes the sheet makes, so a test can
 * assert that backing out writes nothing and Save writes exactly once. The
 * request still reaches the real route against the disposable local database.
 */
async function recordAddOnWrites(page: Page): Promise<string[]> {
  const writes: string[] = [];
  await page.route('**/api/salon/services/*/add-ons**', async (route) => {
    const body = route.request().postDataJSON() as { addOnIds: string[] };
    writes.push(`${new URL(route.request().url()).pathname} ${JSON.stringify(body.addOnIds)}`);
    await route.continue();
  });
  return writes;
}

async function openServices(page: Page): Promise<boolean> {
  // Dev-only role override (404s in production, where this spec skips).
  await page.request.post('/api/dev/role', { data: { role: 'admin' } }).catch(() => null);
  await page.goto('/admin?salonSlug=nail-salon-no5', { waitUntil: 'domcontentloaded' });

  // The workspace runs a client-side session check that lands on the root
  // route before it renders, so wait for the dashboard itself rather than for
  // the URL.
  const settled = await page
    .getByText('Luster Workspace')
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (!settled) {
    return false;
  }

  const nav = page.getByRole('tab', { name: 'Services' })
    .or(page.getByRole('button', { name: 'Services', exact: true }))
    .first();
  const ok = await nav.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
  if (!ok) {
    return false;
  }
  await nav.click();
  await page.locator('[data-testid^="service-row-"]').first().waitFor({ state: 'visible', timeout: 20_000 });
  // Let the slide-up spring settle before measuring.
  await page.waitForFunction(() => {
    const sheet = document.querySelector('[data-testid="app-modal-panel"]');
    if (!sheet) {
      return false;
    }
    const style = window.getComputedStyle(sheet);
    return style.transform === 'none' || style.transform === 'matrix(1, 0, 0, 1, 0, 0)';
  }, undefined, { timeout: 15_000 });
  return true;
}

test.describe('Services sheet — mobile UX', () => {
  for (const viewport of VIEWPORTS) {
    test(`layout holds at ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      test.skip(!(await openServices(page)), 'admin dashboard is auth-gated here');

      // --- 1. The sheet uses the screen ---
      const panel = (await page.locator('[data-testid="app-modal-panel"]').boundingBox())!;

      expect(panel.y, 'sheet should start within a few mm of the top').toBeLessThanOrEqual(14);
      expect(panel.y, 'sheet should still leave a visible gap').toBeGreaterThan(0);

      // --- 2. No content under the header, and a real gutter ---
      const chrome = (await page.getByTestId('services-sticky-chrome').boundingBox())!;
      const firstRow = (await page.locator('[data-testid^="service-row-"]').first().boundingBox())!;

      expect(
        firstRow.y,
        `first row (${firstRow.y}) must clear the chrome (${chrome.y + chrome.height})`,
      ).toBeGreaterThanOrEqual(chrome.y + chrome.height);
      expect(
        firstRow.y - (chrome.y + chrome.height),
        'a visible gutter, not a flush edge',
      ).toBeGreaterThanOrEqual(4);

      // --- 3. Chrome must not eat the sheet ---
      const chromeShare = chrome.height / panel.height;

      expect(chromeShare, `chrome is ${Math.round(chromeShare * 100)}% of the sheet`).toBeLessThan(0.4);

      // --- 4. Name never overlaps price ---
      for (const service of SERVICES) {
        const row = page.locator(`[data-testid="service-row-${service.id}"]`);
        if (!(await row.count())) {
          continue;
        }
        const nameBox = (await row.locator('div.line-clamp-2').first().boundingBox())!;
        const priceBox = (await page.getByTestId(`service-row-price-${service.id}`).boundingBox())!;

        expect(
          nameBox.x + nameBox.width,
          `${service.name}: name must end before the price starts`,
        ).toBeLessThanOrEqual(priceBox.x + 0.5);
        expect(priceBox.width, `${service.name}: price must be laid out`).toBeGreaterThan(0);
        expect(
          priceBox.x + priceBox.width,
          `${service.name}: price must stay inside the sheet`,
        ).toBeLessThanOrEqual(panel.x + panel.width);
      }

      // --- 5. No horizontal overflow anywhere in the sheet ---
      const overflow = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="app-modal-panel"]')!;
        return { scroll: root.scrollWidth, client: root.clientWidth };
      });

      expect(overflow.scroll, 'sheet must not scroll horizontally').toBeLessThanOrEqual(overflow.client + 1);

      // --- 6. Tab labels stay on one line ---
      for (const id of ['services-tab-menu', 'services-tab-addons', 'services-tab-library', 'services-tab-catalog']) {
        // Count the label's own painted line boxes. The button is `min-h-11`
        // for the touch target, so its height says nothing about wrapping.
        const lines = await page.getByTestId(id).evaluate((el) => {
          const text = el.firstChild;
          if (!text || text.nodeType !== Node.TEXT_NODE) {
            return 0;
          }
          const range = document.createRange();
          range.selectNodeContents(text);
          const rects = [...range.getClientRects()];
          const tops = new Set(rects.map(rect => Math.round(rect.top)));
          return tops.size;
        });

        expect(lines, `${id} label wrapped onto ${lines} lines`).toBeLessThanOrEqual(1);
      }

      // --- 7. Touch targets ---
      const small = await page.evaluate(() => {
        const panelEl = document.querySelector('[data-testid="app-modal-panel"]')!;
        return [...panelEl.querySelectorAll('button, a[href], input, select')]
          .filter((el) => {
            const box = el.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && box.height < 40;
          })
          .map(el => `${el.tagName}:${(el.getAttribute('data-testid') ?? el.textContent ?? '').trim().slice(0, 40)}:${Math.round(el.getBoundingClientRect().height)}`);
      });

      expect(small, `controls under 40px tall: ${small.join(' | ')}`).toEqual([]);

      await page.screenshot({ path: `/tmp/services-qa/menu-${viewport.label}.png` });
    });
  }

  test('service images and menu display live in Setup, not above the list @flow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    test.skip(!(await openServices(page)), 'admin dashboard is auth-gated here');

    await expect(page.getByTestId('service-images-visibility-row')).toHaveCount(0);

    await page.getByTestId('services-tab-catalog').click();

    await expect(page.getByTestId('service-images-visibility-row')).toBeVisible();
    await expect(page.getByTestId('menu-display-settings')).toBeVisible();

    await page.screenshot({ path: '/tmp/services-qa/setup-tab.png' });
  });

  test('add-ons are reachable and editable from inside a service @flow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const writes = await recordAddOnWrites(page);

    test.skip(!(await openServices(page)), 'admin dashboard is auth-gated here');

    await page.locator('[data-testid="service-row-svc_combo"]').click();

    // The detail slides in from the right; measure and shoot only once its
    // spring has settled to identity.
    await page.waitForFunction(() => {
      const detail = document.querySelector('[data-testid="service-detail-root"]');
      if (!detail) {
        return false;
      }
      const { transform } = window.getComputedStyle(detail);
      return transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)';
    }, undefined, { timeout: 15_000 });

    const summary = page.getByTestId('service-addons-summary');

    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Add-ons for this service');
    await expect(page.getByTestId('service-addons-summary-names')).toContainText('French Tips');

    // The detail must not paint outside the sheet once settled.
    const panel = (await page.locator('[data-testid="app-modal-panel"]').boundingBox())!;
    const summaryBox = (await summary.boundingBox())!;

    expect(summaryBox.x).toBeGreaterThanOrEqual(panel.x);
    expect(summaryBox.x + summaryBox.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);

    await page.screenshot({ path: '/tmp/services-qa/detail-addons.png' });

    await page.getByTestId('service-addons-summary-manage').click();

    await expect(page.getByTestId('service-addon-picker')).toBeVisible();
    await expect(page.getByTestId('service-addon-picker')).toContainText('Add-ons for Gel Manicure + Gel Pedicure');
    await expect(page.getByTestId('service-addon-option-addon_french')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('service-addon-option-addon_detailed')).toHaveAttribute('aria-checked', 'false');

    await page.screenshot({ path: '/tmp/services-qa/addon-picker.png' });

    // Cancel must not write.
    await page.getByTestId('service-addon-option-addon_detailed').click();
    await page.getByTestId('service-addon-picker-cancel').click();

    await expect(page.getByTestId('service-addon-picker')).toHaveCount(0);
    expect(writes, 'cancel must not write').toEqual([]);

    // Save writes exactly once, to this service, and it actually persists.
    await page.getByTestId('service-addons-summary-manage').click();
    await page.getByTestId('service-addon-option-addon_detailed').click();

    const saved = page.waitForResponse(response =>
      response.url().includes('/api/salon/services/svc_combo/add-ons')
      && response.request().method() === 'PUT');

    await page.getByTestId('service-addon-picker-save').click();

    const response = await saved;

    expect(response.status(), 'the relationship write must succeed').toBe(200);
    expect(await response.json()).toMatchObject({
      data: { serviceId: 'svc_combo', addOnIds: expect.arrayContaining(['addon_detailed']) },
    });
    expect(writes, 'exactly one write, to this service').toHaveLength(1);
    expect(writes[0]).toContain('/api/salon/services/svc_combo/add-ons');

    // The picker only closes on success, and the detail re-reads the add-on
    // list — so this is the round trip, not just the request.
    await expect(page.getByTestId('service-addon-picker')).toHaveCount(0);
    await expect(page.getByTestId('service-addons-summary-names')).toContainText('Detailed Nail Art');

    // The other direction agrees: the add-on now reports one more service.
    await page.getByTestId('service-detail-root').getByRole('button', { name: 'Services' }).click();
    await page.getByTestId('services-tab-addons').click();

    await expect(page.getByTestId('addon-row-services-addon_detailed')).toContainText('Offered with 1 service');
  });

  test('reorder mode keeps rows readable while browsing @flow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    test.skip(!(await openServices(page)), 'admin dashboard is auth-gated here');

    await expect(page.locator('[data-testid^="service-row-move-up-"]')).toHaveCount(0);

    await page.getByTestId('services-reorder-toggle').click();

    await expect(page.locator('[data-testid^="service-row-move-up-"]').first()).toBeVisible();

    await page.screenshot({ path: '/tmp/services-qa/reorder-mode.png' });

    await page.getByTestId('services-reorder-toggle').click();

    await expect(page.locator('[data-testid^="service-row-move-up-"]')).toHaveCount(0);
  });

  test('the add-ons tab keeps one create action @flow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    test.skip(!(await openServices(page)), 'admin dashboard is auth-gated here');

    await page.getByTestId('services-tab-addons').click();

    await expect(page.getByTestId('services-primary-add')).toContainText('Add-on');
    await expect(page.getByTestId('addons-create-open')).toHaveCount(0);
    await expect(page.getByTestId('addon-row-services-addon_french')).toContainText('Offered with 4 services');

    await page.screenshot({ path: '/tmp/services-qa/addons-tab.png' });
  });

  test('the create form offers add-ons without demanding them @flow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    test.skip(!(await openServices(page)), 'admin dashboard is auth-gated here');

    await page.getByTestId('services-primary-add').click();
    const formAddOns = page.getByTestId('service-form-addons');

    await expect(formAddOns).toBeVisible();
    await expect(formAddOns).toContainText('Optional');

    // Essentials first: the form used to open on a photo picker and two
    // buffer fields before it ever asked for a name.
    const nameBox = (await page.getByLabel('Name').boundingBox())!;
    const priceBox = (await page.getByLabel('Price', { exact: true }).boundingBox())!;
    const addOnBox = (await formAddOns.boundingBox())!;
    const advanced = page.getByTestId('service-form-advanced');
    const advancedBox = (await advanced.boundingBox())!;

    expect(nameBox.y, 'name is the first field').toBeLessThan(priceBox.y);
    expect(priceBox.y, 'price precedes add-ons').toBeLessThan(addOnBox.y);
    expect(addOnBox.y, 'add-ons precede the advanced section').toBeLessThan(advancedBox.y);

    // Collapsed while creating, so photo/buffers never block a save.
    await expect(advanced).not.toHaveAttribute('open', '');
    await expect(page.getByTestId('service-image-preview')).toBeHidden();

    await page.screenshot({ path: '/tmp/services-qa/create-form.png' });

    await advanced.getByRole('group').or(advanced.locator('summary')).first().click();

    await expect(page.getByTestId('service-image-preview')).toBeVisible();
  });
});
