import { expect, test } from '@playwright/test';

const settings = { enabled: false, windowDays: 30, discountType: 'percent', value: 5, eligibleServiceIds: [], messageTemplate: 'We look forward to seeing you for your next visit.' };
async function mock(page: import('@playwright/test').Page) {
  const mutations: unknown[] = [];
  await page.route('**/api/**', async (r) => {
    const q = new URL(r.request().url());
    if (q.pathname === '/api/admin/next-visit-offer') {
      if (r.request().method() === 'PATCH') {
        mutations.push(r.request().postDataJSON());
        return r.fulfill({ json: { data: { settings: r.request().postDataJSON(), availableServices: [{ id: 'gel', name: 'Gel Manicure' }, { id: 'biab', name: 'BIAB' }], status: { enabledSince: null, issued: 0, reserved: 0, used: 0 } } } });
      }
      return r.fulfill({ json: { data: { settings, availableServices: [{ id: 'gel', name: 'Gel Manicure' }, { id: 'biab', name: 'BIAB' }], status: { enabledSince: null, issued: 0, reserved: 0, used: 0 } } } });
    }
    if (q.pathname.endsWith('/next-visit-offer')) {
      if (r.request().method() === 'POST') {
        return r.fulfill({ json: { data: { offer: { bookingUrl: '/book?campaign=opaque' } } } });
      }
      return r.fulfill({ json: { data: { offer: { deadlineDate: '2026-10-20', currency: 'CAD', settings: { ...settings, enabled: true, value: 10, messageTemplate: 'Come back soon' } } } } });
    }
    return r.fulfill({ status: 404 });
  });
  return mutations;
}

test('settings defaults, validates, saves selected services and rebook uses no account', async ({ page }) => {
  const m = await mock(page);
  await page.goto('/');

  await expect(page.getByText('Off · no new offers will be issued.')).toBeVisible();

  await page.getByRole('switch', { name: 'Turn on Next Visit Offer' }).click();
  await page.getByRole('button', { name: 'Custom' }).click();
  await page.getByLabel('Custom days').fill('31');
  await page.getByRole('button', { name: 'Selected services' }).click();
  await page.getByLabel('Gel Manicure').check();
  await page.getByRole('button', { name: 'Save Next Visit Offer' }).click();

  await expect.poll(() => m.length).toBe(1);
  expect(m[0]).toMatchObject({ enabled: true, windowDays: 31, eligibleServiceIds: ['gel'] });
  await expect(page.getByText('No account needed.')).toBeVisible();

  await page.getByRole('button', { name: 'Rebook with this offer' }).click();

  await expect.poll(() => page.url()).toMatch(/campaign=opaque/);
});

test('mobile remains usable at 200% text without horizontal overflow', async ({ page }, testInfo) => {
  await mock(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const toggle = page.getByRole('switch', { name: 'Turn on Next Visit Offer' });

  await expect(toggle).toBeVisible();
  expect(await toggle.evaluate(el => el.getBoundingClientRect().height >= 44)).toBe(true);

  const rebook = page.getByRole('button', { name: 'Rebook with this offer' });

  expect(await rebook.evaluate(el => el.getBoundingClientRect().height >= 44)).toBe(true);

  await page.evaluate(() => {
    const elements = [...document.querySelectorAll('*')].filter((element): element is HTMLElement => element instanceof HTMLElement);
    const sizes = elements.map(element => ({ font: Number.parseFloat(getComputedStyle(element).fontSize), line: Number.parseFloat(getComputedStyle(element).lineHeight) }));
    elements.forEach((element, index) => {
      element.style.fontSize = `${sizes[index]!.font * 2}px`;
      if (Number.isFinite(sizes[index]!.line)) {
        element.style.lineHeight = `${sizes[index]!.line * 2}px`;
      }
    });
  });
  await rebook.focus();

  await expect(rebook).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await expect(page.getByRole('button', { name: 'Selected services' })).toBeVisible();

  const clipped = await page.locator('button, input, textarea, [role="switch"]').evaluateAll(elements => elements.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left < 0 || rect.right > window.innerWidth;
  }).map(element => element.textContent));

  expect(clipped).toEqual([]);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}.png`), fullPage: true });
});
