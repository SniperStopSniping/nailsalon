/**
 * Regression: the admin Services detail view must start BELOW the sticky
 * detail header at rest. The catalog header is hidden in detail. The hero icon
 * was previously hidden behind the sticky region and only revealed by iOS
 * overscroll bounce. Measures real DOM geometry with no drag/overscroll.
 *
 * Uses the reusable synthetic admin password session and configured E2E salon.
 * Authentication or dashboard failures must fail these geometry checks.
 */
import { expect, type Page, test } from '@playwright/test';

import { createImpersonatedAdminRequestContext } from './support/appointment-ops';
import { appPath, e2eConfig } from './support/config';

const IPHONE_CHROME_USER_AGENT
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1';
const SYNTHETIC_CI_CLERK_BOOTSTRAP_URL
  = 'https://ci.luster.invalid/npm/@clerk/clerk-js@5/dist/clerk.browser.js';

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

async function openServicesList(page: Page): Promise<void> {
  await page.goto(appPath(`/admin?salon=${encodeURIComponent(e2eConfig.salonSlug)}`), {
    waitUntil: 'domcontentloaded',
  });

  const servicesNav = page.getByTestId('owner-nav-services');

  await expect(servicesNav).toBeVisible();

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
    const adminRequest = await createImpersonatedAdminRequestContext();
    const storageState = await adminRequest.storageState().finally(() => adminRequest.dispose());
    const context = await browser.newContext({
      baseURL,
      storageState,
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
          // CI's reserved Clerk placeholder cannot resolve. This geometry lane
          // uses a synthetic password session; it does not verify Clerk login.
          if (process.env.CI === 'true'
            && message.location().url === SYNTHETIC_CI_CLERK_BOOTSTRAP_URL
            && message.text() === 'Failed to load resource: net::ERR_NAME_NOT_RESOLVED') {
            return;
          }
          consoleErrors.push(message.text());
        }
      });
      page.on('response', (response) => {
        if (response.status() >= 400) {
          consoleErrors.push(`${response.status()} ${response.url()}`);
        }
      });

      await openServicesList(page);

      // This spec asserts the Services DETAIL interaction is clean.
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

      await expect(page.getByTestId('services-sticky-chrome')).toBeHidden();

      const [chromeBox, iconBox] = await Promise.all([
        page.getByTestId('service-detail-root').locator(':scope > .sticky').boundingBox(),
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
      const title = page.getByTestId('service-detail-root').getByRole('heading', { level: 2 });
      const titleBox = await title.boundingBox();

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
