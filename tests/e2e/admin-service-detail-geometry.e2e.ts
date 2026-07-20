/**
 * Regression: the admin Services detail view must start BELOW the sticky
 * chrome (Services header + tabs + category chips) at rest — the hero icon
 * was previously hidden behind the sticky region and only revealed by iOS
 * overscroll bounce. Measures real DOM geometry with no drag/overscroll.
 *
 * Requires a dev-mode server (dev auth bypass) to reach /admin; the spec
 * skips itself in environments where the admin is auth-gated.
 */
import { expect, type Page, test } from '@playwright/test';

import { appPath, e2eConfig } from './support/config';

const IPHONE_CHROME_USER_AGENT
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1';

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

async function openServicesList(page: Page): Promise<boolean> {
  // Dev-only role override (404s in production, where this spec skips).
  await page.request
    .post(appPath('/api/dev/role'), { data: { role: 'admin' } })
    .catch(() => null);

  await page.goto(appPath(`/admin?salonSlug=${e2eConfig.salonSlug}`), {
    waitUntil: 'domcontentloaded',
  });

  // Dev-only surface: skip cleanly when the admin dashboard is auth-gated.
  const servicesNav = page.getByRole('button', { name: 'Services', exact: true });
  const navAvailable = await servicesNav
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!navAvailable) {
    return false;
  }

  await servicesNav.click();

  // Wait for the sheet's slide-up spring to fully settle near the top.
  await page.waitForFunction(() => {
    const sheet = [...document.querySelectorAll('div')].find(el =>
      el.className.includes?.('z-50') && el.className.includes('bottom-0') && el.className.includes('rounded-t-'));
    if (!sheet) {
      return false;
    }
    const { top } = sheet.getBoundingClientRect();
    return top >= 0 && top < window.innerHeight * 0.1;
  }, undefined, { timeout: 15_000 });

  await page.locator('[data-testid^="service-row-"]').first().waitFor({ state: 'visible', timeout: 15_000 });

  return true;
}

async function openFirstDetail(page: Page): Promise<void> {
  await page.locator('[data-testid^="service-row-"]').first().click();

  // Wait for the detail's slide-in transform to settle to identity.
  const detail = page.getByTestId('service-detail-root');
  await detail.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-testid="service-detail-root"]');
    if (!root) {
      return false;
    }
    const { transform } = getComputedStyle(root);
    return transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)';
  }, undefined, { timeout: 10_000 });
}

for (const viewport of VIEWPORTS) {
  test(`detail hero icon is fully visible at rest at ${viewport.width}x${viewport.height} @admin-geometry`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      viewport,
      deviceScaleFactor: 3,
      hasTouch: true,
      isMobile: true,
      userAgent: IPHONE_CHROME_USER_AGENT,
    });

    const consoleErrors: string[] = [];

    try {
      const page = await context.newPage();
      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(message.text());
        }
      });
      page.on('response', (response) => {
        if (response.status() >= 400) {
          consoleErrors.push(`${response.status()} ${response.url()}`);
        }
      });

      const reachable = await openServicesList(page);

      test.skip(!reachable, 'Admin dashboard is auth-gated in this environment; run against a dev server.');

      // The dashboard shell may emit environment-auth noise under the dev
      // role; this spec asserts the Services DETAIL interaction is clean.
      consoleErrors.length = 0;
      await openFirstDetail(page);

      // At rest: the sheet scroller must start at scrollTop 0 (no content
      // already consumed above the fold).
      const scrollState = await page.evaluate(() => {
        const scroller = [...document.querySelectorAll('div')].find(el =>
          el.className.includes?.('overscroll-contain'));
        return scroller ? { scrollTop: scroller.scrollTop } : null;
      });

      expect(scrollState).not.toBeNull();
      expect(scrollState!.scrollTop).toBe(0);

      const [chromeBox, iconBox] = await Promise.all([
        page.getByTestId('services-sticky-chrome').boundingBox(),
        page.getByTestId('service-detail-hero-icon').boundingBox(),
      ]);

      expect(chromeBox).not.toBeNull();
      expect(iconBox).not.toBeNull();

      const stickyBottom = chromeBox!.y + chromeBox!.height;
      const iconTop = iconBox!.y;

      // The whole icon sits below the sticky chrome, fully inside the
      // viewport, with no dependence on overscroll.
      expect(iconTop, `iconTop (${iconTop}) must clear stickyBottom (${stickyBottom})`).toBeGreaterThanOrEqual(stickyBottom);
      expect(iconBox!.y + iconBox!.height).toBeLessThanOrEqual(viewport.height);
      expect(iconBox!.x).toBeGreaterThanOrEqual(0);
      expect(iconBox!.x + iconBox!.width).toBeLessThanOrEqual(viewport.width);

      // No huge dead gap between chrome and hero (header + card padding only).
      expect(iconTop - stickyBottom).toBeLessThanOrEqual(220);

      // Nothing hides the icon: no negative transform on the detail root and
      // no ancestor clipping it above the chrome.
      const iconHidden = await page.evaluate(() => {
        const icon = document.querySelector('[data-testid="service-detail-hero-icon"]');
        if (!icon) {
          return 'missing';
        }
        const rect = icon.getBoundingClientRect();
        const probe = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 2);
        return probe && (icon === probe || icon.contains(probe) || probe.contains(icon)) ? null : 'covered';
      });

      expect(iconHidden).toBeNull();

      // Title fully visible.
      const title = page.getByRole('heading', { level: 2 });
      const titleBox = await title.first().boundingBox();

      expect(titleBox).not.toBeNull();
      expect(titleBox!.y).toBeGreaterThanOrEqual(stickyBottom - 1);
      expect(titleBox!.y + titleBox!.height).toBeLessThanOrEqual(viewport.height);

      // No page-level horizontal overflow.
      const overflow = await page.evaluate(() => ({
        docScroll: document.documentElement.scrollWidth,
        docClient: document.documentElement.clientWidth,
      }));

      expect(overflow.docScroll).toBeLessThanOrEqual(overflow.docClient);

      // Bottom of the detail is still reachable: Edit + Deactivate/Reactivate.
      await page.evaluate(() => {
        const scroller = [...document.querySelectorAll('div')].find(el =>
          el.className.includes?.('overscroll-contain'));
        if (scroller) {
          scroller.scrollTop = scroller.scrollHeight;
        }
      });

      const [editBox, toggleBox] = await Promise.all([
        page.getByTestId('service-detail-edit').boundingBox(),
        page.getByTestId('service-detail-toggle-active').boundingBox(),
      ]);

      expect(editBox).not.toBeNull();
      expect(toggleBox).not.toBeNull();
      expect(editBox!.y).toBeGreaterThanOrEqual(0);
      expect(editBox!.y + editBox!.height).toBeLessThanOrEqual(viewport.height);
      expect(toggleBox!.y).toBeGreaterThanOrEqual(0);
      expect(toggleBox!.y + toggleBox!.height).toBeLessThanOrEqual(viewport.height);

      expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
