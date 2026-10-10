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

test('Today offers a new owner the free allowance before a paid top-up', async ({ page }, info) => {
  await page.goto('/?screen=today&credits=0&starter=verify');

  await expect(page.getByRole('button', { name: 'Claim 100 free texts' })).toBeVisible();
  await expect(page.getByText('2. Verify phone')).toBeVisible();
  await expect(page.getByText('0 texts remaining', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Buy texts', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.screenshot({ path: screenshotPath(info, `Today-free-claim-${info.project.name}.png`), fullPage: true });
});

test('Today zero balance retains purchasing after the allowance is claimed', async ({ page }) => {
  await page.goto('/?screen=today&credits=0');

  await expect(page.getByRole('button', { name: 'Buy texts', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Claim 100 free texts' })).toHaveCount(0);
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

test('free texts are directly above Buy More Texts, and a claim refreshes the balance', async ({ page }, info) => {
  await page.goto('/?credits=0&starter=ready');
  const card = page.getByTestId('sms-balance-card');
  const claim = card.getByRole('button', { name: 'Claim 100 free texts' });

  await expect(claim).toBeVisible();
  expect((await claim.boundingBox())!.y).toBeLessThan((await card.getByRole('button', { name: 'Buy More Texts', exact: true }).boundingBox())!.y);

  await page.screenshot({ path: screenshotPath(info, `Free-claim-${info.project.name}.png`) });
  await claim.click();

  await expect(card.getByText('100', { exact: true })).toBeVisible();
  await expect(card.getByText('100 free SMS credits have been added.')).toBeVisible();

  await page.reload();
  // Each fixture reload initializes its synthetic balance; persisted no-repeat
  // behavior is covered separately with the verified fixture and API tests.
});

test('unverified contact has a direct verification action on More', async ({ page }, info) => {
  await page.goto('/?credits=0&starter=verify');

  await expect(page.getByRole('button', { name: 'Verify email and phone' })).toBeVisible();
  await expect(page.getByText('✓ Email verified')).toBeVisible();
  await expect(page.getByText('2. Verify phone')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.screenshot({ path: screenshotPath(info, `Free-verification-${info.project.name}.png`) });
});

test('checkout unavailability is explained before disabled packages', async ({ page }, info) => {
  await page.goto('/?credits=0&purchases=off&view=topup');
  const message = page.getByText('Text purchases are currently unavailable. Your existing credits and free core app are unchanged.');
  const buy = page.getByRole('button', { name: 'Buy 100 texts' });

  await expect(message).toBeVisible();
  await expect(buy).toBeDisabled();
  expect((await message.boundingBox())!.y).toBeLessThan((await buy.boundingBox())!.y);

  await page.screenshot({ path: screenshotPath(info, `Checkout-unavailable-${info.project.name}.png`) });
});
