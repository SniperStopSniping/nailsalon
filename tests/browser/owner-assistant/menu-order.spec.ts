import { expect, test } from '@playwright/test';

const menu = [
  { id: 'gel', name: 'Gel manicure', sortOrder: 1 },
  { id: 'pedi', name: 'Pedicure', sortOrder: 2 },
  { id: 'art', name: 'Nail art', sortOrder: 3 },
];

// This is interaction/layout evidence only. Route-domain behavior is covered
// separately against PGlite; all browser requests here are synthetic.
test('owner previews, applies, and undoes a bounded menu-order request', async ({ page }) => {
  const mutations: Array<{ action: string; body: Record<string, unknown> }> = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  await page.route('**/api/admin/owner-assistant/menu-order**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({ json: { data: { enabled: true, menu } } });
      return;
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    mutations.push({ action: String(body.action), body });
    if (body.action === 'prepare') {
      await route.fulfill({ json: { data: { proposal: { id: 'proposal-1', status: 'ready', oldOrder: menu, newOrder: [menu[2], menu[0], menu[1]] } } } });
      return;
    }
    if (body.action === 'apply') {
      await route.fulfill({ json: { data: { receipt: { id: 'proposal-1', status: 'applied', oldOrder: menu, newOrder: [menu[2], menu[0], menu[1]], currentOrder: [menu[2], menu[0], menu[1]] } } } });
      return;
    }
    await route.fulfill({ json: { data: { receipt: { id: 'proposal-1', status: 'undone', oldOrder: menu, newOrder: [menu[2], menu[0], menu[1]], currentOrder: menu } } } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open Menu assistant' }).click();
  await page.getByLabel('What should move?').fill('Move Nail art before Gel manicure');
  await page.getByRole('button', { name: 'Prepare menu preview' }).click();

  await expect(page.getByTestId('owner-menu-assistant-proposal')).toContainText('Only service order will change');

  await page.screenshot({ path: test.info().outputPath('menu-order-preview.png'), fullPage: true });
  await page.getByTestId('owner-menu-assistant-apply').click();

  await expect(page.getByTestId('owner-menu-assistant-receipt')).toContainText('Menu order updated');

  await page.getByTestId('owner-menu-assistant-undo').click();

  await expect(page.getByTestId('owner-menu-assistant-receipt')).toContainText('Menu order restored');

  expect(mutations.map(mutation => mutation.action)).toEqual(['prepare', 'apply', 'undo']);
  expect(mutations[0]?.body).toMatchObject({ salonSlug: 'assistant-fixture', orderedIds: ['art', 'gel', 'pedi'] });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
