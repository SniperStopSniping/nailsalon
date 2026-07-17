import { devices, expect, type Page, test } from '@playwright/test';

import { appPath, e2eConfig } from './support/config';

const IPHONE_CHROME_USER_AGENT
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1';

async function verifyNaturalFooterClearance(page: Page): Promise<string> {
  await page.goto(appPath(`/${e2eConfig.salonSlug}/book/service`), {
    waitUntil: 'domcontentloaded',
  });

  const footer = page.getByTestId('public-salon-footer');

  await expect(footer).toBeVisible();
  await expect(footer).toHaveCSS('margin-bottom', '0px');

  await page.getByTestId(`service-card-${e2eConfig.serviceId}`).click();
  const stickyBar = page.getByTestId('service-sticky-bar');

  await expect(stickyBar).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  await expect(footer).toBeInViewport();

  const [footerBox, stickyBox] = await Promise.all([
    footer.boundingBox(),
    stickyBar.boundingBox(),
  ]);

  expect(footerBox).not.toBeNull();
  expect(stickyBox).not.toBeNull();
  expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(stickyBox!.y + 1);

  const findBookingLink = footer.getByRole('link', { name: /find my booking/i });

  await expect(findBookingLink).toBeVisible();

  const linkIsTopmost = await findBookingLink.evaluate((link) => {
    const bounds = link.getBoundingClientRect();
    const target = document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
    );
    return target === link || link.contains(target);
  });

  expect(linkIsTopmost).toBe(true);

  await findBookingLink.click();

  await expect(page).toHaveURL(new RegExp(`/${e2eConfig.salonSlug}/find-booking(?:\\?|$)`));

  return page.url();
}

test('iPhone Chrome keeps the Free Luster footer above the sticky booking bar @mobile-chrome', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    userAgent: IPHONE_CHROME_USER_AGENT,
  });

  try {
    const destination = await verifyNaturalFooterClearance(await context.newPage());

    expect(destination).toMatch(new RegExp(`/${e2eConfig.salonSlug}/find-booking(?:\\?|$)`));
  } finally {
    await context.close();
  }
});

test('iPhone Safari keeps the Free Luster footer above the sticky booking bar @mobile-safari', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    baseURL,
  });

  try {
    const destination = await verifyNaturalFooterClearance(await context.newPage());

    expect(destination).toMatch(new RegExp(`/${e2eConfig.salonSlug}/find-booking(?:\\?|$)`));
  } finally {
    await context.close();
  }
});
