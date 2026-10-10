import { expect, test } from '@playwright/test';

for (const width of [320, 390, 430, 1280]) {
  test(`both booking screens are readable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    for (const screen of ['find', 'manage']) {
      await page.goto(`/?screen=${screen}${screen === 'manage' ? '&closed=1' : ''}`);

      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('img', { name: 'Luster' })).toBeVisible();

      const geometry = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));

      expect(geometry.content).toBeLessThanOrEqual(geometry.width + 1);

      for (const control of await page.locator('main :is(input,button,a)').all()) {
        const rect = await control.boundingBox();

        expect(rect?.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: info.outputPath(`${screen}-${width}.png`), fullPage: true });
    }
  });
}

test('email and phone recovery preserve privacy, pending feedback and retry', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Email my booking link' }).click();

  await expect(page.getByRole('alert')).toContainText('Enter the email or phone');

  await page.getByLabel('Mobile phone').fill('4165550101');
  await page.route('**/api/public/appointments/recovery', route => route.fulfill({ status: 503, json: {} }));
  await page.getByRole('button', { name: 'Text my booking link' }).click();

  await expect(page.getByTestId('find-booking-error')).toBeVisible();
  await expect(page.getByLabel('Mobile phone')).toHaveValue('4165550101');

  await page.unroute('**/api/public/appointments/recovery');
  let finish: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**/api/public/appointments/recovery', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ salonSlug: 'fixture', phone: '4165550101' });

    await gate;
    await route.fulfill({ status: 202, json: {} });
  });
  await page.getByRole('button', { name: 'Text my booking link' }).click();

  await expect(page.getByRole('button', { name: 'Sending request…' })).toBeDisabled();

  finish();

  await expect(page.getByRole('status')).toContainText('If we find a matching appointment');
  await expect(page.getByRole('status')).toContainText('text the secure link to the contact on file');
});

test('management actions preserve confirmation, errors and cancellation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/?screen=manage&long=1');

  await expect(page.getByRole('link', { name: 'Choose a new time' })).toHaveAttribute('href', /\/manage\/synthetic-private-token\/reschedule$/);

  await page.route('**/api/public/appointments/manage/*', route => route.fulfill({ status: 503, json: {} }));
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Cancel appointment' }).click();

  await expect(page.getByRole('alert')).toHaveCount(0);

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Cancel appointment' }).click();

  await expect(page.getByRole('alert')).toContainText('We couldn’t confirm the cancellation');

  await page.unroute('**/api/public/appointments/manage/*');
  await page.route('**/api/public/appointments/manage/*', route => route.fulfill({ status: 200, json: {} }));
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Cancel appointment' }).click();

  await expect(page.getByRole('status')).toHaveText('This appointment is cancelled.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('invalid and financial error states remain recoverable', async ({ page }) => {
  await page.goto('/?screen=manage&invalid=expired');

  await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Find my booking' })).toHaveAttribute('href', '/en/fixture/find-booking');

  await page.goto('/?screen=manage&closed=1');

  await expect(page.getByRole('button', { name: 'Cancel appointment' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Choose a new time' })).toBeVisible();
  await expect(page.getByText('Online changes are closed')).toHaveCount(0);
  await expect(page.getByTestId('manage-balance')).toHaveText('$35.00 CAD');
  await expect(page.getByRole('link', { name: 'Add to Apple Calendar' })).toHaveAttribute('href', /\/calendar\.ics$/);

  await page.goto('/?screen=manage&financial-error=1');

  await expect(page.getByText('Financial details are under review. Contact the salon for confirmed amounts.')).toBeVisible();
  await expect(page.getByTestId('manage-balance')).toHaveCount(0);
});

test('keyboard focus stays visible and larger text reflows', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.keyboard.press('Tab');

  await expect(page.getByLabel('Booking email')).toBeFocused();
  expect(await page.getByLabel('Booking email').evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');

  await page.evaluate(() => {
    const elements = [...document.querySelectorAll<HTMLElement>('main :is(p,span,strong,h1,button,input)')];
    const sizes = elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize));
    elements.forEach((element, index) => {
      element.style.fontSize = `${sizes[index]! * 2}px`;
    });
  });

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Email my booking link' })).toBeVisible();
});
