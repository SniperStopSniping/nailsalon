import { expect, type Locator, type Page, test } from '@playwright/test';

import { selectBookableSlotFromApi } from './support/booking';
import { appPath, appPathPattern, e2eConfig } from './support/config';

const IPHONE_CHROME_USER_AGENT
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1';

const MOBILE_VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 600 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

const WIDE_VIEWPORTS = [
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
] as const;

async function openServicePage(page: Page): Promise<void> {
  await page.goto(appPath(`/${e2eConfig.salonSlug}/book/service`), {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('[data-testid^="service-card-"]').first().waitFor({ state: 'visible', timeout: 15_000 });
}

async function expectHydratedControl(control: Locator): Promise<void> {
  await expect.poll(() => control.evaluate(element => (
    Object.keys(element).some(key => key.startsWith('__reactProps$'))
  ))).toBe(true);
}

async function expectNoPageHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
    bodyScroll: document.body.scrollWidth,
    bodyClient: document.body.clientWidth,
  }));

  expect(overflow.docScroll, 'document must not scroll horizontally').toBeLessThanOrEqual(overflow.docClient);
  expect(overflow.bodyScroll, 'body must not scroll horizontally').toBeLessThanOrEqual(overflow.bodyClient);
}

async function expectSingleBookingMain(page: Page): Promise<void> {
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('main main')).toHaveCount(0);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('main h1')).toHaveCount(1);
}

type TargetMeasurement = {
  height: number;
  label: string;
  width: number;
};

async function expectPracticalBookingTargets(page: Page): Promise<TargetMeasurement[]> {
  const targets = await page.locator('button, a[href], input, select, textarea').evaluateAll((elements) => {
    const measured = new Set<Element>();
    return elements.flatMap((element) => {
      if (!(element instanceof HTMLElement)) {
        return [];
      }

      const style = window.getComputedStyle(element);
      const ownBounds = element.getBoundingClientRect();
      if (
        style.display === 'none'
        || style.visibility === 'hidden'
        || ownBounds.width === 0
        || ownBounds.height === 0
      ) {
        return [];
      }

      const effectiveTarget = element instanceof HTMLInputElement
        && (element.type === 'checkbox' || element.type === 'radio')
        ? element.closest('label') ?? element
        : element;
      if (measured.has(effectiveTarget)) {
        return [];
      }
      measured.add(effectiveTarget);

      const bounds = effectiveTarget.getBoundingClientRect();
      const label = element.getAttribute('aria-label')
        || element.getAttribute('title')
        || element.textContent?.replace(/\s+/g, ' ').trim()
        || (element instanceof HTMLInputElement ? element.placeholder : '')
        || element.getAttribute('data-testid')
        || element.tagName.toLowerCase();

      return [{ height: bounds.height, label, width: bounds.width }];
    });
  });

  const unnamed = targets.filter(target => !target.label);
  const undersized = targets.filter(target => target.width < 44 || target.height < 44);

  expect(unnamed, 'Every visible booking target needs an accessible name or visible label.').toEqual([]);
  expect(undersized, `Sub-44px booking targets: ${JSON.stringify(undersized)}`).toEqual([]);

  return targets;
}

async function expectNoTargetOverlap(targets: Locator[]): Promise<void> {
  type TargetMeasurement = {
    box: { height: number; width: number; x: number; y: number };
    label: string;
  };

  await expect.poll(async () => {
    const measured = (await Promise.all(targets.map(target => target.evaluate((element) => {
      const style = window.getComputedStyle(element);
      if (
        (element instanceof HTMLButtonElement && element.disabled)
        || style.display === 'none'
        || style.visibility === 'hidden'
      ) {
        return null;
      }
      const bounds = element.getBoundingClientRect();
      return {
        box: {
          height: bounds.height,
          width: bounds.width,
          x: bounds.x,
          y: bounds.y,
        },
        label: element.getAttribute('aria-label')
          ?? element.textContent
          ?? element.getAttribute('data-testid')
          ?? 'unnamed target',
      };
    }))))
      .filter((entry): entry is TargetMeasurement => entry !== null);

    for (let leftIndex = 0; leftIndex < measured.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < measured.length; rightIndex += 1) {
        const leftTarget = measured[leftIndex]!;
        const rightTarget = measured[rightIndex]!;
        const left = leftTarget.box;
        const right = rightTarget.box;
        const overlapWidth = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
        const overlapHeight = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);

        if (overlapWidth > 0.5 && overlapHeight > 0.5) {
          return `${leftTarget.label.trim()} ${JSON.stringify(left)} vs ${rightTarget.label.trim()} ${JSON.stringify(right)}`;
        }
      }
    }

    return null;
  }, {
    message: 'Interactive targets must settle without overlap.',
  }).toBeNull();
}

async function expectReducedMotionControl(control: Locator): Promise<void> {
  await expect(control).toBeVisible();

  const transitionProperty = await control.evaluate(
    element => window.getComputedStyle(element).transitionProperty,
  );

  expect(transitionProperty, 'Reduced motion must suppress control transitions.').toBe('none');

  await control.hover();

  const hoveredTransform = await control.evaluate(
    element => window.getComputedStyle(element).transform,
  );

  expect(hoveredTransform, 'Reduced motion must suppress hover scaling.').toBe('none');

  const page = control.page();
  const bounds = await control.boundingBox();

  expect(bounds).not.toBeNull();

  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();

  const activeTransform = await control.evaluate(
    element => window.getComputedStyle(element).transform,
  );

  expect(activeTransform, 'Reduced motion must suppress active scaling.').toBe('none');

  await page.mouse.move(0, 0);
  await page.mouse.up();
}

async function selectConfiguredService(page: Page): Promise<void> {
  const configuredCard = page.getByTestId(`service-card-${e2eConfig.serviceId}`);
  const firstCard = page.locator('[data-testid^="service-card-"]:not([data-testid*="image"]):not([data-testid*="content"]):not([data-testid*="meta"]):not([data-testid*="price"]):not([data-testid*="addon"])').first();
  const card = await configuredCard.isVisible().catch(() => false) ? configuredCard : firstCard;

  await expect(card).toBeVisible();

  await card.click();

  await expect(page.getByTestId('service-continue-button')).toBeVisible();
}

async function openConfiguredConfirmPage(
  page: Page,
  extraParams: Record<string, string> = {},
): Promise<void> {
  const params = new URLSearchParams({
    salonSlug: e2eConfig.salonSlug,
    serviceIds: e2eConfig.serviceId,
    techId: 'any',
    date: '2030-03-20',
    time: '10:00',
    ...extraParams,
  });

  await page.goto(`${appPath('/book/confirm')}?${params.toString()}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('heading', { name: 'Review your appointment' })).toBeVisible();

  // The heading is present in streamed server HTML. Wait for React to attach
  // the controlled input's event props before filling it so a late hydration
  // pass cannot reset browser-entered fixture values. This observes the actual
  // hydrated control and does not rely on network quietness.
  const hydrationProbe = '__stage3b_hydrated__';
  const nameInput = page.getByLabel('Customer name');

  await expectHydratedControl(nameInput);

  await nameInput.fill(hydrationProbe);

  await expect.poll(() => page.evaluate(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem('luster_booking_contact') ?? '{}');
      return stored.name ?? null;
    } catch {
      return null;
    }
  })).toBe(hydrationProbe);

  await nameInput.fill('');
}

async function completeRequiredConfirmFields(page: Page): Promise<void> {
  await page.getByLabel('Customer name').fill('Stage Three Browser Guest');
  await page.getByLabel('Customer email').fill('stage-three-browser@example.com');
  await page.getByLabel('Customer phone').fill('6475550198');

  const acknowledgment = page.getByTestId('booking-policy-acknowledgment');
  if (await acknowledgment.isVisible().catch(() => false)) {
    await expect(acknowledgment.getByText('Required', { exact: true })).toBeVisible();

    await acknowledgment.getByRole('checkbox').check();
  }

  await expect(page.getByRole('button', { name: /confirm appointment/i })).toBeEnabled();
}

async function expectResultReceiptLeads(page: Page): Promise<void> {
  const order = await page.evaluate(() => {
    const receipt = document.querySelector('[data-testid="booking-result-receipt"]');
    const statusHeading = receipt?.querySelector('h1');
    const summaryHeading = [...(receipt?.querySelectorAll('h3') ?? [])]
      .find(element => element.textContent?.trim() === 'Appointment summary');
    const celebration = document.querySelector('[data-testid="booking-success-celebration"]');

    return {
      statusBeforeSummary: Boolean(
        statusHeading
        && summaryHeading
        && (statusHeading.compareDocumentPosition(summaryHeading) & Node.DOCUMENT_POSITION_FOLLOWING),
      ),
      summaryBeforeCelebration: celebration === null || Boolean(
        summaryHeading
        && (summaryHeading.compareDocumentPosition(celebration) & Node.DOCUMENT_POSITION_FOLLOWING),
      ),
    };
  });

  expect(order.statusBeforeSummary, 'Durable booking status must precede receipt facts.').toBe(true);
  expect(order.summaryBeforeCelebration, 'Receipt facts must precede celebration.').toBe(true);
}

async function walkReadOnlyBookingTargets(page: Page): Promise<void> {
  await openServicePage(page);
  await expectSingleBookingMain(page);

  const search = page.getByPlaceholder(/search services/i);

  await expect(search).toBeVisible();

  await expectHydratedControl(search);

  await search.fill('gel');

  await expect(page.getByRole('button', { name: 'Clear search' })).toBeVisible();

  await expectPracticalBookingTargets(page);
  await page.getByRole('button', { name: 'Clear search' }).click();

  const categoryTargets = await page.getByTestId('service-category-track').getByRole('button').all();
  await expectNoTargetOverlap(categoryTargets);

  await selectConfiguredService(page);
  await expectPracticalBookingTargets(page);

  await expectReducedMotionControl(page.getByTestId('service-continue-button'));

  const addOnTargets = await page.locator('[data-testid^="service-addon-row-"] button').all();
  await expectNoTargetOverlap(addOnTargets);

  await page.getByTestId('service-continue-button').click();
  await page.waitForURL(/\/book\/(?:tech|time)(?:\?|$)/);

  if (appPathPattern('/book/tech').test(page.url())) {
    await expectSingleBookingMain(page);
    await expectPracticalBookingTargets(page);
    const back = page.getByRole('button', { name: 'Go back' });

    await expectReducedMotionControl(back);

    await back.focus();

    await expect(back).toBeFocused();

    const configuredTechnician = page.getByRole('button', {
      name: new RegExp(e2eConfig.staffTechnicianName, 'i'),
    });
    const technician = await configuredTechnician.isVisible().catch(() => false)
      ? configuredTechnician
      : page.getByRole('button', { name: 'Any eligible technician — maximum availability' });
    await technician.click();
  }

  await expect(page).toHaveURL(appPathPattern('/book/time'));

  await expectSingleBookingMain(page);

  await expectPracticalBookingTargets(page);
  await expectReducedMotionControl(page.getByRole('button', { name: 'Previous month' }));
  await expectReducedMotionControl(page.getByRole('button', { name: 'Next month' }));
  await expectNoTargetOverlap([
    page.getByRole('button', { name: 'Previous month' }),
    page.getByRole('button', { name: 'Next month' }),
  ]);
  await expectNoTargetOverlap(await page.locator('[data-testid^="calendar-day-"]:not([disabled])').all());

  const timeStepUrl = new URL(page.url());
  const technicianId = timeStepUrl.searchParams.get('techId');
  await selectBookableSlotFromApi(page, {
    technicianId: technicianId && technicianId !== 'any' ? technicianId : null,
    startDayOffset: 3,
    baseServiceId: timeStepUrl.searchParams.get('baseServiceId'),
    locationId: timeStepUrl.searchParams.get('locationId'),
    selectedAddOns: timeStepUrl.searchParams.get('selectedAddOns'),
  });

  await expect(page).toHaveURL(appPathPattern('/book/confirm'));

  await expectPracticalBookingTargets(page);
  await expectNoPageHorizontalOverflow(page);

  const edit = page.getByRole('button', { name: 'Edit', exact: true });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.keyboard.press('Tab');

  await expect(edit).toBeFocused();
  await expect.poll(() => edit.evaluate(element => window.getComputedStyle(element).outlineStyle)).not.toBe('none');
}

const ACCESSIBILITY_VIEWPORTS = [
  { label: 'compact 320x700', viewport: { height: 700, width: 320 } },
  { label: 'short 375x600', viewport: { height: 600, width: 375 } },
  { label: 'normal mobile 390x844', viewport: { height: 844, width: 390 } },
] as const;

for (const { label, viewport } of ACCESSIBILITY_VIEWPORTS) {
  test(`public booking targets meet the practical floor at ${label} @mobile-layout`, async ({
    browser,
    baseURL,
  }) => {
    test.slow();

    const context = await browser.newContext({
      baseURL,
      viewport,
      deviceScaleFactor: 3,
      hasTouch: true,
      isMobile: true,
      userAgent: IPHONE_CHROME_USER_AGENT,
      reducedMotion: 'reduce',
    });
    const attemptedWrites: string[] = [];

    try {
      const page = await context.newPage();
      await page.route('**/*', async (route) => {
        const method = route.request().method();
        if (method !== 'GET' && method !== 'HEAD') {
          attemptedWrites.push(`${method} ${route.request().url()}`);
          await route.abort('blockedbyclient');
          return;
        }
        await route.continue();
      });

      await walkReadOnlyBookingTargets(page);

      expect(attemptedWrites, 'The accessibility browser walk must remain read-only.').toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test('named add-on quantity controls announce the resulting canonical totals @mobile-layout', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { height: 600, width: 375 },
    reducedMotion: 'reduce',
  });
  const attemptedWrites: string[] = [];

  try {
    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      const method = route.request().method();
      if (method !== 'GET' && method !== 'HEAD') {
        attemptedWrites.push(`${method} ${route.request().url()}`);
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });

    await openServicePage(page);
    await expectSingleBookingMain(page);
    const announcement = page.getByTestId('service-addon-announcement');

    await expect(announcement).toHaveText('');

    await selectConfiguredService(page);

    const decrease = page.getByRole('button', { name: 'Decrease Nail Repair quantity' });
    const increase = page.getByRole('button', { name: 'Increase Nail Repair quantity' });

    await expect(decrease).toBeVisible();
    await expect(decrease).toBeDisabled();
    await expect(increase).toBeEnabled();

    for (const control of [decrease, increase]) {
      const bounds = await control.boundingBox();

      expect(bounds).not.toBeNull();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }

    await increase.click();

    await expect(announcement).toHaveText(
      'Booking total updated. Price $70. Duration 1h 25m.',
    );

    await expect(page.getByTestId('service-sticky-bar').getByText('$70')).toBeVisible();
    await expect(page.getByTestId('service-sticky-bar').getByText('1h 25m')).toBeVisible();

    await expectNoTargetOverlap([decrease, increase]);

    await decrease.click();

    await expect(announcement).toHaveText(
      'Booking total updated. Price $65. Duration 1h 15m.',
    );

    await expect(page.getByTestId('service-sticky-bar').getByText('$65')).toBeVisible();
    await expect(page.getByTestId('service-sticky-bar').getByText('1h 15m')).toBeVisible();

    await expectNoPageHorizontalOverflow(page);

    expect(attemptedWrites, 'The add-on accessibility check must remain read-only.').toEqual([]);
  } finally {
    await context.close();
  }
});

test('public booking targets remain usable under the Chromium 200% CSS zoom approximation @mobile-layout', async ({
  browser,
  baseURL,
}) => {
  test.slow();

  const context = await browser.newContext({
    baseURL,
    viewport: { height: 800, width: 1280 },
    reducedMotion: 'reduce',
  });
  const attemptedWrites: string[] = [];

  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.zoom = '2';
    });
  });

  try {
    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      const method = route.request().method();
      if (method !== 'GET' && method !== 'HEAD') {
        attemptedWrites.push(`${method} ${route.request().url()}`);
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });

    await walkReadOnlyBookingTargets(page);
    await expectNoPageHorizontalOverflow(page);

    expect(attemptedWrites, 'The zoom accessibility walk must remain read-only.').toEqual([]);
  } finally {
    await context.close();
  }
});

for (const viewport of [
  { width: 320, height: 700 },
  { width: 375, height: 600 },
] as const) {
  test(`pending booking retains its known receipt at ${viewport.width}x${viewport.height} @mobile-layout`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ baseURL, viewport, reducedMotion: 'reduce' });
    let postCount = 0;

    try {
      const page = await context.newPage();
      await page.addInitScript((serviceName) => {
        window.addEventListener('DOMContentLoaded', () => {
          let observer: MutationObserver | null = null;
          const capturePendingState = () => {
            const pending = document.querySelector('[data-testid="booking-submit-pending"]');
            if (!pending || Reflect.get(window, '__stage3bPendingSnapshot')) {
              return;
            }

            const confirm = [...document.querySelectorAll('button')]
              .find(button => button.textContent?.includes('Confirming appointment'));
            const contactName = document.querySelector<HTMLInputElement>('[aria-label="Customer name"]');
            Reflect.set(window, '__stage3bPendingSnapshot', {
              confirmDisabled: confirm instanceof HTMLButtonElement && confirm.disabled,
              contactDisabled: contactName?.disabled === true,
              contactName: contactName?.value ?? null,
              noHorizontalOverflow:
                document.documentElement.scrollWidth <= document.documentElement.clientWidth
                && document.body.scrollWidth <= document.body.clientWidth,
              pendingText: pending.textContent,
              serviceVisible: document.body.textContent?.includes(serviceName) === true,
              summaryVisible: document.body.textContent?.includes('Appointment summary') === true,
            });
            observer?.disconnect();
          };
          observer = new MutationObserver(capturePendingState);
          observer.observe(document.documentElement, {
            attributes: true,
            childList: true,
            subtree: true,
          });
          capturePendingState();
        }, { once: true });
      }, e2eConfig.serviceName);
      await page.route('**/api/appointments', async (route) => {
        if (route.request().method() !== 'POST') {
          await route.fallback();
          return;
        }

        postCount += 1;
        // Keep the real client request unresolved long enough for the page-side
        // observer to capture the transient pending DOM before returning a
        // synthetic response. No appointment reaches the server.
        await new Promise(resolve => setTimeout(resolve, 750));
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              appointment: { id: 'appt_e2e_pending', status: 'pending' },
              manageUrl: appPath(`/${e2eConfig.salonSlug}/manage/pending-e2e-token`),
            },
          }),
        });
      });

      await openConfiguredConfirmPage(page);
      await completeRequiredConfirmFields(page);

      const confirm = page.getByRole('button', { name: /confirm appointment/i });
      await confirm.click();

      const pendingSnapshot = await page.evaluate(() => (
        Reflect.get(window, '__stage3bPendingSnapshot')
      )) as {
        confirmDisabled: boolean;
        contactDisabled: boolean;
        contactName: string | null;
        noHorizontalOverflow: boolean;
        pendingText: string | null;
        serviceVisible: boolean;
        summaryVisible: boolean;
      } | undefined;

      expect(pendingSnapshot).toEqual(expect.objectContaining({
        confirmDisabled: true,
        contactDisabled: true,
        contactName: 'Stage Three Browser Guest',
        noHorizontalOverflow: true,
        pendingText: expect.stringContaining('Your booking details remain below'),
        serviceVisible: true,
        summaryVisible: true,
      }));
      expect(postCount).toBe(1);

      await expect(page.getByRole('heading', { name: 'Request received' })).toBeVisible();
      await expect(page.getByText(e2eConfig.serviceName)).toBeVisible();
      await expect(page.getByTestId('booking-success-celebration')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Appointment confirmed' })).toHaveCount(0);

      await expectResultReceiptLeads(page);
      await expectNoPageHorizontalOverflow(page);
    } finally {
      await context.close();
    }
  });
}

test('confirmed receipt leads at the Chromium 200% CSS zoom approximation @mobile-layout', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { height: 800, width: 1280 },
    reducedMotion: 'reduce',
  });
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.zoom = '2';
    });
  });

  try {
    const page = await context.newPage();
    await page.route('**/api/appointments', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            appointment: { id: 'appt_e2e_confirmed', status: 'confirmed' },
            manageUrl: appPath(`/${e2eConfig.salonSlug}/manage/confirmed-e2e-token`),
          },
        }),
      });
    });

    await openConfiguredConfirmPage(page);
    await completeRequiredConfirmFields(page);
    await page.getByRole('button', { name: /confirm appointment/i }).click();

    await expect(page.getByRole('heading', { name: 'Appointment confirmed' })).toBeVisible();
    await expect(page.getByText(e2eConfig.serviceName)).toBeVisible();
    await expect(page.getByTestId('booking-success-celebration')).toBeVisible();

    await expectResultReceiptLeads(page);
    await expectNoPageHorizontalOverflow(page);
  } finally {
    await context.close();
  }
});

test('Smart Fit recovery fits an actual 320px booking viewport @mobile-layout', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 320, height: 700 },
    reducedMotion: 'reduce',
  });

  try {
    const page = await context.newPage();
    await page.route('**/api/appointments', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'SMART_FIT_CHANGED',
            message: 'This discounted time is no longer available. Please choose from the latest times.',
            details: {
              refreshAvailability: true,
              breakdown: {
                subtotalBeforeDiscountCents: 6500,
                discountAmountCents: 0,
                discountType: null,
                discountLabel: null,
                finalTotalCents: 6500,
              },
            },
          },
        }),
      });
    });

    await openConfiguredConfirmPage(page, {
      smartFitDiscountCents: '650',
      smartFitTotalCents: '5850',
    });
    await completeRequiredConfirmFields(page);
    await page.getByRole('button', { name: /confirm appointment/i }).click();

    const comparison = page.getByTestId('smart-fit-price-change');

    await expect(comparison).toContainText('Previously shown');
    await expect(comparison).toContainText('$58.50');
    await expect(comparison).toContainText('Current service price');
    await expect(comparison).toContainText('$65.00');
    await expect(page.getByText('SMART_FIT_CHANGED')).toHaveCount(0);

    const bounds = await comparison.boundingBox();

    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(321);

    await expectNoPageHorizontalOverflow(page);
    await expectPracticalBookingTargets(page);
  } finally {
    await context.close();
  }
});

for (const scenario of [
  { label: '375px', viewport: { width: 375, height: 600 }, zoom: '1' },
  { label: '200% CSS zoom', viewport: { width: 750, height: 900 }, zoom: '2' },
] as const) {
  test(`absolute deposit deadline stays readable at ${scenario.label} @mobile-layout`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: scenario.viewport,
      reducedMotion: 'reduce',
    });
    await context.addInitScript((zoom) => {
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.zoom = zoom;
      });
    }, scenario.zoom);
    const holdExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

    try {
      const page = await context.newPage();
      await page.route('**/api/appointments', async (route) => {
        if (route.request().method() !== 'POST') {
          await route.fallback();
          return;
        }

        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'DEPOSIT_HOLD_ACTIVE',
              message: 'You already have a booking waiting for its deposit.',
              details: { holdExpiresAt },
            },
          }),
        });
      });

      await openConfiguredConfirmPage(page);
      await completeRequiredConfirmFields(page);
      await page.getByRole('button', { name: /confirm appointment/i }).click();

      const deadline = page.getByTestId('hold-deadline');

      await expect(page.getByTestId('hold-countdown')).toBeVisible();
      await expect(deadline).toBeVisible();
      await expect(deadline).toHaveAttribute('datetime', holdExpiresAt);
      await expect(deadline.locator('xpath=..')).toContainText('salon local time');

      await expectNoPageHorizontalOverflow(page);
      await expectPracticalBookingTargets(page);
    } finally {
      await context.close();
    }
  });
}

for (const viewport of MOBILE_VIEWPORTS) {
  test(`service page fits ${viewport.width}x${viewport.height} without clipping @mobile-layout`, async ({
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

    try {
      const page = await context.newPage();
      await openServicePage(page);

      await expectNoPageHorizontalOverflow(page);

      // Heading fully below the viewport top.
      const salonName = page.getByTestId('booking-salon-name');

      await expect(salonName).toBeVisible();

      const nameBox = await salonName.boundingBox();

      expect(nameBox).not.toBeNull();
      expect(nameBox!.y).toBeGreaterThanOrEqual(0);

      // Featured cards stay inside the viewport; the carousel scrolls
      // internally instead of widening the document.
      const featuredScroll = page.getByTestId('featured-services-scroll');
      if (await featuredScroll.count()) {
        const firstFeatured = page.locator('[data-testid^="featured-service-card-"]').first();

        await expect(firstFeatured).toBeVisible();

        const cardBox = await firstFeatured.boundingBox();

        expect(cardBox).not.toBeNull();
        expect(cardBox!.x).toBeGreaterThanOrEqual(0);
        expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(viewport.width + 1);

        const scrollable = await featuredScroll.evaluate(
          element => element.scrollWidth >= element.clientWidth,
        );

        expect(scrollable).toBe(true);
      }

      // Category chips scroll inside their own track.
      const chipScroll = page.getByTestId('service-category-scroll');
      if (await chipScroll.count()) {
        const chipBox = await chipScroll.boundingBox();

        expect(chipBox).not.toBeNull();
        expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(viewport.width + 1);
      }

      await expectNoPageHorizontalOverflow(page);

      // Selecting the LAST card raises the sticky bar; the reserved bottom
      // clearance must keep that card fully above the bar at scroll end.
      const cards = page.locator('[data-testid^="service-card-"]:not([data-testid*="image"]):not([data-testid*="content"]):not([data-testid*="meta"]):not([data-testid*="price"]):not([data-testid*="addon"])');
      const lastCard = cards.last();
      await lastCard.scrollIntoViewIfNeeded();
      await lastCard.click();

      const stickyBar = page.getByTestId('service-sticky-bar');

      await expect(stickyBar).toBeVisible();

      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

      const [cardBox, stickyBox] = await Promise.all([
        lastCard.boundingBox(),
        stickyBar.boundingBox(),
      ]);

      expect(cardBox).not.toBeNull();
      expect(stickyBox).not.toBeNull();
      expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(stickyBox!.y + 1);

      await expectNoPageHorizontalOverflow(page);
    } finally {
      await context.close();
    }
  });
}

for (const viewport of WIDE_VIEWPORTS) {
  test(`service page keeps the tablet/desktop layout at ${viewport.width}x${viewport.height} @mobile-layout`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ baseURL, viewport });

    try {
      const page = await context.newPage();
      await openServicePage(page);

      await expectNoPageHorizontalOverflow(page);

      const firstFeatured = page.locator('[data-testid^="featured-service-card-"]').first();
      if (await firstFeatured.count()) {
        const cardBox = await firstFeatured.boundingBox();

        expect(cardBox).not.toBeNull();
        // sm: widths take over on wide viewports — cards keep their fixed
        // 280/320px width instead of shrinking with the viewport.
        expect(cardBox!.width).toBeGreaterThanOrEqual(279);
      }
    } finally {
      await context.close();
    }
  });
}
