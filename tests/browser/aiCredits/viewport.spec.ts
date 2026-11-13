import { expect, test } from '@playwright/test';

import { CLOSED_HOURS } from '../../../src/features/business-setup/contracts';
import { resolveBookingConfigFromSettings } from '../../../src/libs/bookingConfig.shared';

test('the full-page AI builder follows Chrome toolbar and keyboard bounds after tab return', async ({ page }) => {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperties(viewport, {
      height: { configurable: true, get: () => window.innerHeight },
      width: { configurable: true, get: () => window.innerWidth },
    });
    Object.defineProperty(window, 'visualViewport', { value: viewport });
  });
  const head = {
    workspace: { status: 'editing' },
    revision: {
      revision: 1,
      document: {
        schemaVersion: 1,
        business: { name: 'Synthetic Studio', city: 'Toronto', exactAddress: '', homeBased: false, workMode: 'solo', locationDisplayMode: 'city_only' },
        hours: CLOSED_HOURS,
        booking: resolveBookingConfigFromSettings(null),
        services: [],
        website: { config: {}, content: {} },
      },
    },
    messages: [],
    uploadReviews: [],
  };
  await page.route('**/api/admin/business-setup**', route => route.fulfill({ json: { data: head } }));
  await page.route('**/api/admin/custom-sites**', route => route.fulfill({ json: { head, assets: [], preferences: null, history: [], attempts: [], configured: true, payload: null, rendererOrigin: null } }));
  await page.goto('/?builder=1');
  const builder = page.locator('main.setup-chat-first');
  const visibleBounds = () => builder.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const viewport = window.visualViewport!;
    return { top: Math.round(box.top - viewport.offsetTop), bottom: Math.round(viewport.offsetTop + viewport.height - box.bottom) };
  });

  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled();
  await expect.poll(visibleBounds).toEqual({ top: 0, bottom: 0 });

  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 430 });
    Object.assign(window.visualViewport!, { offsetTop: 20 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });

  await expect.poll(visibleBounds).toEqual({ top: 0, bottom: 0 });

  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: window.innerHeight });
    Object.assign(window.visualViewport!, { offsetTop: 0 });
    window.dispatchEvent(new Event('pageshow'));
  });

  await expect.poll(visibleBounds).toEqual({ top: 0, bottom: 0 });
});
