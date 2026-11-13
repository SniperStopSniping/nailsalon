import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

// The real admin host lazily compiles the full app bundle on the first visit.
test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperties(viewport, {
      height: { configurable: true, get: () => window.innerHeight },
      width: { configurable: true, get: () => window.innerWidth },
    });
    Object.defineProperty(window, 'visualViewport', { value: viewport });
  });
});

async function setViewport(page: Page, height: number, top: number, event = 'resize') {
  await page.evaluate(({ height, top, event }) => {
    const viewport = window.visualViewport!;
    Object.defineProperty(viewport, 'height', { configurable: true, value: height });
    Object.assign(viewport, { offsetTop: top });
    viewport.dispatchEvent(new Event(event));
  }, { height, top, event });
}

const bounds = (locator: Locator) => locator.evaluate((element) => {
  const box = element.getBoundingClientRect();
  const viewport = window.visualViewport!;
  return {
    top: Math.round(box.top - viewport.offsetTop),
    bottom: Math.round(viewport.offsetTop + viewport.height - box.bottom),
    width: Math.round(box.width),
  };
});

for (const [screen, name] of Object.entries({
  marketing: 'Marketing',
  settings: 'Settings',
  payments: 'Payments',
  team: 'Team',
  clients: 'Clients',
  calendar: 'Calendar',
  services: 'Services',
})) {
  test(`${name}: shared sheet and backdrop follow the visible screen`, async ({ page }) => {
    await page.goto(`/?screen=${screen}&surface=sheet&closed`);
    await page.getByRole('button', { name: `Open ${name}` }).click();
    const sheet = page.getByRole('dialog', { name, exact: true });
    const backdrop = page.getByTestId('app-modal-backdrop');

    await expect(sheet).toBeVisible();
    await expect.poll(() => bounds(sheet)).toEqual({ top: 10, bottom: 0, width: page.viewportSize()!.width });

    await setViewport(page, 480, 18);

    await expect.poll(() => bounds(sheet)).toEqual({ top: 10, bottom: 0, width: page.viewportSize()!.width });
    await expect.poll(() => bounds(backdrop)).toEqual({ top: 0, bottom: 0, width: page.viewportSize()!.width });

    await setViewport(page, page.viewportSize()!.height, 0);

    await expect.poll(() => bounds(sheet)).toEqual({ top: 10, bottom: 0, width: page.viewportSize()!.width });
  });
}

test('Marketing recovers after tab return and delayed keyboard dismissal without resize', async ({ page }) => {
  await page.goto('/?screen=marketing&surface=sheet');
  const sheet = page.getByRole('dialog', { name: 'Marketing', exact: true });

  await expect(sheet.getByRole('button', { name: /Write a message/ })).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 460 });
    Object.assign(window.visualViewport!, { offsetTop: 24 });
    window.dispatchEvent(new Event('pageshow'));
  });

  await expect.poll(() => bounds(sheet)).toEqual({ top: 10, bottom: 0, width: page.viewportSize()!.width });

  await sheet.getByRole('button', { name: /Write a message/ }).click();
  const input = sheet.getByRole('textbox').first();
  await input.focus();
  await page.evaluate(() => {
    (document.activeElement as HTMLElement).blur();
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: window.innerHeight });
    Object.assign(window.visualViewport!, { offsetTop: 0 });
  });

  await expect.poll(() => bounds(sheet)).toEqual({ top: 10, bottom: 0, width: page.viewportSize()!.width });
});

test('shared dialogs keep long forms and nested confirmations reachable above the keyboard', async ({ page }) => {
  await page.goto('/?screen=viewport-dialog');
  const overlay = page.getByTestId('dialog-shell-overlay').first();
  const form = page.getByRole('dialog', { name: 'Shared form' });
  await page.getByRole('textbox', { name: 'Message' }).focus();
  await setViewport(page, 420, 16);

  await expect.poll(() => bounds(overlay)).toEqual({ top: 0, bottom: 0, width: page.viewportSize()!.width });
  await expect(form.getByRole('button', { name: 'Save form' })).toBeInViewport();

  await form.getByRole('button', { name: 'Open confirmation' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Confirmation' });

  await expect(confirmation.getByRole('button', { name: 'Close confirmation' })).toBeInViewport();

  await confirmation.getByRole('button', { name: 'Close confirmation' }).click();

  await expect(confirmation).toBeHidden();
  await expect(page.getByRole('button', { name: 'Save form' })).toBeInViewport();
});

test('client details remain inside the shared sheet after its entrance animation', async ({ page }) => {
  await page.goto('/?screen=clients&surface=sheet');
  await page.getByRole('button', { name: 'Open Clients' }).click();
  const sheet = page.getByRole('dialog', { name: 'Clients', exact: true });
  await sheet.getByRole('button', { name: /SM Sofia Martin/ }).click();
  const profile = page.getByTestId('client-detail-scroll');

  await expect(profile.getByRole('button', { name: 'Clients', exact: true })).toBeVisible();
  await expect.poll(() => bounds(profile)).toEqual({ top: 10, bottom: 0, width: page.viewportSize()!.width });

  await setViewport(page, 460, 18);

  await expect.poll(() => bounds(profile)).toEqual({ top: 10, bottom: 0, width: page.viewportSize()!.width });
});

test('shared dialogs preserve native fixed bounds at 200% page zoom', async ({ page }) => {
  await page.goto('/?screen=viewport-dialog');
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
    window.dispatchEvent(new Event('resize'));
  });
  const overlay = page.getByTestId('dialog-shell-overlay').first();

  await expect.poll(() => overlay.evaluate(element => element.getBoundingClientRect().right <= window.innerWidth + 1)).toBe(true);
  await expect(page.getByRole('button', { name: 'Save form' })).toBeInViewport();
});
