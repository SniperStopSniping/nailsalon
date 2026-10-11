import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-12T12:00:00Z') });
  // Record the real component's scroll calls while keeping browser geometry
  // and pointer delivery intact. No production API or booking is involved.
  await page.addInitScript(() => {
    const scrollTo = window.scrollTo.bind(window);
    window.scrollTo = (...args: Parameters<typeof window.scrollTo>) => {
      const root = document.documentElement;
      root.dataset.scrollCalls = String(Number(root.dataset.scrollCalls ?? 0) + 1);
      (scrollTo as (...values: Parameters<typeof window.scrollTo>) => void)(...args);
    };
  });
  await page.goto('/?step=time&count=10');

  await expect(page.getByTestId('time-slot-09:30')).toBeVisible();

  await page.clock.pauseAt(new Date('2026-09-12T12:01:00Z'));
});

test('a pointer interaction stops the running automatic scroll', async ({ page }, info) => {
  await page.getByTestId('calendar-day-2026-09-14').click();

  await expect(page.getByTestId('calendar-day-2026-09-14')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('time-slot-09:30')).toBeEnabled();

  await page.clock.runFor(160);

  const callsBefore = await page.locator('html').getAttribute('data-scroll-calls');

  expect(Number(callsBefore)).toBeGreaterThan(1);

  // Native scrolling brings the button into view while the component's
  // animation is still active. Hold down on it while animation time advances:
  // the old loop moves it away before release and loses the selection.
  const opening = page.getByTestId('time-slot-09:30');
  await opening.scrollIntoViewIfNeeded();
  const bounds = await opening.boundingBox();

  expect(bounds).not.toBeNull();

  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.clock.runFor(900);
  await page.mouse.up();

  await page.screenshot({ path: info.outputPath('time-selection.png'), fullPage: true });

  await expect.soft(page.locator('html')).toHaveAttribute('data-scroll-calls', callsBefore!);
  await expect.soft(page.locator('html')).toHaveAttribute('data-navigation', /\/book\/confirm\?.*time=09%3A30/);
});

test('reduced motion reveals times without an animated scroll', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByTestId('calendar-day-2026-09-14').click();

  await expect(page.getByTestId('time-slot-09:30')).toBeEnabled();

  await page.clock.runFor(160);

  const callsBefore = await page.locator('html').getAttribute('data-scroll-calls');

  expect(Number(callsBefore)).toBe(1);

  await page.clock.runFor(900);

  await expect(page.locator('html')).toHaveAttribute('data-scroll-calls', callsBefore!);
  await expect(page.getByTestId('time-slot-09:30')).toBeInViewport();
});
