import { expect, test } from '@playwright/test';

const evidence = process.env.SMS_CREDITS_SCREENSHOT_DIR;
const screenshotPath = (info: import('@playwright/test').TestInfo, name: string) => evidence ? `${evidence}/${name}` : info.outputPath(name);

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

for (const [credits, status] of [[100, 'You’re all set.'], [18, 'Running low'], [8, 'Almost out'], [0, 'Out of texts'], [100000, 'You’re all set.']] as const) {
  test(`More ${credits} credits`, async ({ page }, info) => {
    await page.goto(`/?credits=${credits}`);

    await expect(page.getByText(status, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Buy More Texts', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.getByRole('heading', { name: 'Booking', exact: true }).boundingBox()).not.toBeNull();

    await page.screenshot({ path: screenshotPath(info, `More-${credits}-${info.project.name}.png`), fullPage: true });
  });
}

test('top-up packages, last purchase, history and close', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Buy More Texts', exact: true }).click();

  await expect(page.getByText('Best Value', { exact: true })).toBeVisible();
  await expect(page.getByText('Your last purchase')).toBeVisible();
  expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

  await page.screenshot({ path: screenshotPath(info, `Top-up-${info.project.name}.png`) });
  await page.getByRole('button', { name: /View usage history/ }).last().click();

  await expect(page.getByText('Total credits purchased')).toBeVisible();
  await expect(page.getByText('Client follow-up', { exact: true })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Client follow-up' })).toContainText(/−1\s*credit$/);
  await expect(page.getByRole('listitem').filter({ hasText: 'Appointment reminder' })).toContainText(/−2\s*credits$/);
  await expect(page.getByRole('listitem').filter({ hasText: 'Credit purchase' })).toContainText(/\+500\s*credits$/);

  await page.screenshot({ path: screenshotPath(info, `History-${info.project.name}.png`) });
  await page.getByRole('button', { name: 'Close text credits' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Today at ten or fewer links directly to purchase', async ({ page }, info) => {
  await page.goto('/?screen=today&credits=10');
  await page.getByRole('button', { name: 'Buy texts' }).click();

  await expect(page.getByRole('heading', { name: 'Buy more texts' })).toBeVisible();

  await page.screenshot({ path: screenshotPath(info, `Today-top-up-${info.project.name}.png`) });
});

test('failed balance and recovery never display fabricated credits', async ({ page }) => {
  await page.goto('/?state=error');

  await expect(page.getByText('Your balance is unavailable right now.')).toBeVisible();
  await expect(page.getByText('Out of texts', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Restore fixture connection' }).click();

  await expect(page.getByText('Running low', { exact: true })).toBeVisible();
});

test('isolated purchase return updates visible balance', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Buy More Texts', exact: true }).click();
  await page.getByRole('button', { name: 'Buy 500 texts' }).click();
  await page.getByRole('button', { name: 'Simulate verified payment' }).click();

  await expect(page.getByText('518', { exact: true })).toBeVisible();
  await expect(page.getByText('You’re all set.', { exact: true })).toBeVisible();
});
