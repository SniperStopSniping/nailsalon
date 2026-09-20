import { expect, test } from '@playwright/test';

async function fixture(page: import('@playwright/test').Page, offer = false) {
  const posts: string[] = [];
  await page.route('**/api/public/appointments/manage/private-token/rebook', async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().method());
      return route.fulfill({ json: { data: { bookingUrl: '/book/service' } } });
    }
    return route.fulfill({ json: { data: {
      promptEnabled: true,
      promptKey: 'opaque-visit-key',
      bookingUrl: '/book/service',
      offer: offer ? { deadlineDate: '2026-10-20', currency: 'CAD', settings: { discountType: 'percent', value: 5 } } : null,
    } } });
  });
  await page.route('**/book/service', route => route.fulfill({ contentType: 'text/html', body: '<h1>Choose your services</h1>' }));
  await page.goto('/?rebooking');
  return posts;
}

test('generic prompt dismisses across refresh, and keeps a quiet rebook action', async ({ page }) => {
  const posts = await fixture(page);

  await expect(page.getByText('Ready to book your next visit?')).toBeVisible();
  await expect(page.getByText(/save.*%/i)).toHaveCount(0);

  await page.getByRole('button', { name: 'Not now' }).click();
  await page.reload();

  await expect(page.getByRole('button', { name: 'Book next appointment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Not now' })).toHaveCount(0);
  await expect(page.getByText('Ready to book your next visit?')).toHaveCount(0);
  expect(posts).toEqual([]);
});

test('starting a fresh booking suppresses the prompt on return, without copying old selections', async ({ page }) => {
  const posts = await fixture(page, true);

  await expect(page.getByText('Book your next eligible visit by 2026-10-20 and save 5%.')).toBeVisible();

  await page.getByRole('button', { name: 'Book next appointment' }).click();

  await expect(page.getByRole('heading', { name: 'Choose your services' })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  expect(posts).toEqual(['POST']);

  await page.goBack();

  await expect(page.getByRole('button', { name: 'Book next appointment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Not now' })).toHaveCount(0);
  await expect(page.getByText(/save.*%/i)).toHaveCount(0);
});

test('320px, doubled text, keyboard and touch targets stay usable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page, true);
  const rebook = page.getByRole('button', { name: 'Book next appointment' });

  await expect(rebook).toBeVisible();

  await page.evaluate(() => {
    const elements = [...document.querySelectorAll('*')].filter((el): el is HTMLElement => el instanceof HTMLElement);
    const sizes = elements.map(el => ({ font: Number.parseFloat(getComputedStyle(el).fontSize), line: Number.parseFloat(getComputedStyle(el).lineHeight) }));
    elements.forEach((el, index) => {
      el.style.fontSize = `${sizes[index]!.font * 2}px`;
      if (Number.isFinite(sizes[index]!.line)) {
        el.style.lineHeight = `${sizes[index]!.line * 2}px`;
      }
    });
  });
  await rebook.focus();

  await expect(rebook).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('button').evaluateAll(buttons => buttons.every((button) => {
    const rect = button.getBoundingClientRect();
    return rect.height >= 44 && rect.left >= 0 && rect.right <= window.innerWidth;
  }))).toBe(true);

  if (testInfo.project.name === 'mobile-chromium') {
    await page.keyboard.press('Tab');
  } else {
    // Mobile WebKit does not enable desktop full-keyboard Tab navigation.
    await page.getByRole('button', { name: 'Not now' }).focus();
  }

  await expect(page.getByRole('button', { name: 'Not now' })).toBeFocused();

  await page.keyboard.press('Enter');

  await expect(page.getByText('Ready to book your next visit?')).toHaveCount(0);

  await page.screenshot({ path: testInfo.outputPath(`rebooking-${testInfo.project.name}.png`), fullPage: true });
});

test('owner setting is separate from offers, explicit and accessible', async ({ page }) => {
  const updates: unknown[] = [];
  await page.route('**/api/admin/rebooking-prompt?*', async (route) => {
    const settings = route.request().method() === 'PATCH' ? route.request().postDataJSON() : { enabled: false };
    if (route.request().method() === 'PATCH') {
      updates.push(settings);
    }
    return route.fulfill({ json: { data: { settings } } });
  });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/?rebooking-settings');
  const toggle = page.getByRole('switch', { name: 'Turn on Rebooking Prompt' });

  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  await page.evaluate(() => {
    const elements = [...document.querySelectorAll('*')].filter((el): el is HTMLElement => el instanceof HTMLElement);
    const sizes = elements.map(el => ({ font: Number.parseFloat(getComputedStyle(el).fontSize), line: Number.parseFloat(getComputedStyle(el).lineHeight) }));
    elements.forEach((el, index) => {
      el.style.fontSize = `${sizes[index]!.font * 2}px`;
      if (Number.isFinite(sizes[index]!.line)) {
        el.style.lineHeight = `${sizes[index]!.line * 2}px`;
      }
    });
  });

  await expect(page.getByText('Ready to book your next visit?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Rebooking Prompt' })).toBeDisabled();
  expect(await toggle.evaluate(el => el.getBoundingClientRect().height >= 44)).toBe(true);

  await toggle.click();
  await page.getByRole('button', { name: 'Save Rebooking Prompt' }).click();

  await expect(page.getByText('Rebooking Prompt saved.')).toBeVisible();
  expect(updates).toEqual([{ enabled: true }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
