import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';

const artifactDirectory = path.resolve(__dirname, '../../../artifacts/customer-assistant');

async function installSyntheticAssistantRoutes(page: Page) {
  const unexpected: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3130') {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    if (url.pathname === '/api/public/customer-assistant/isla-nail-studio/session' && request.method() === 'POST') {
      await route.fulfill({ json: { conversation: 'synthetic-conversation' } });
      return;
    }
    if (url.pathname === '/api/public/customer-assistant/isla-nail-studio/chat' && request.method() === 'POST') {
      await route.fulfill({ json: {
        conversation: 'rotated-synthetic-conversation',
        result: {
          kind: 'proposal',
          proposal: {
            selection: { baseServiceId: 'gel-x', selectedAddOns: [{ addOnId: 'removal', quantity: 1 }, { addOnId: 'french', quantity: 1 }] },
            fingerprint: 'synthetic-menu-fingerprint',
            service: { id: 'gel-x', name: 'Gel-X Extensions', priceCents: 8500 },
            addOns: [
              { id: 'removal', name: 'Removal', quantity: 1, priceCents: 2000 },
              { id: 'french', name: 'French', quantity: 1, priceCents: 1500 },
            ],
            currency: 'CAD',
            subtotalCents: 12000,
            durationMinutes: 150,
            expiresAt: '2026-09-18T12:00:00.000Z',
          },
        },
      } });
      return;
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 404, json: { error: 'Unknown component-browser fixture endpoint' } });
  });
  return unexpected;
}

async function setMobileViewportAndTextZoom(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
}

test('component-browser fixture shows an authoritative proposal at 200% text zoom without horizontal overflow', async ({ page }, testInfo) => {
  const unexpected = await installSyntheticAssistantRoutes(page);
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text());
    }
  });

  await page.goto('/');
  await setMobileViewportAndTextZoom(page, 390);
  await page.getByRole('button', { name: 'Help me choose & book' }).tap();

  await expect(page.getByRole('heading', { name: 'Help me choose' })).toBeVisible();

  await page.getByLabel('Describe the nails you want').fill('Long Gel-X with French and old extensions from another salon');
  await page.getByRole('button', { name: 'Send' }).tap();

  const proposal = page.getByRole('region', { name: 'Suggested services' });

  await expect(proposal).toBeVisible();
  await expect(page.getByText('Gel-X Extensions')).toBeVisible();
  await expect(page.getByText('Removal')).toBeVisible();
  await expect(page.getByText('French', { exact: true })).toBeVisible();
  await expect(page.getByText('$120.00')).toBeVisible();
  await expect(page.getByText('2h 30m')).toBeVisible();
  await expect(page.getByRole('button', { name: /confirm booking/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue manually' })).toBeVisible();

  for (const name of ['Close assistant', 'Send', 'Continue manually']) {
    const box = await page.getByRole('button', { name }).boundingBox();

    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await expect(page.getByRole('button', { name: 'Continue manually' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Close assistant' })).toBeInViewport();
  await expect(page.getByText('$120.00')).toBeInViewport();

  await page.screenshot({ path: path.join(artifactDirectory, `${testInfo.project.name}-proposal-390px-200zoom.png`), fullPage: true });

  await page.addStyleTag({ content: 'html { font-size: 100%; }' });

  await expect(page.getByText('$120.00')).toBeInViewport();

  await page.screenshot({ path: path.join(artifactDirectory, `${testInfo.project.name}-proposal-390px.png`), fullPage: true });

  expect(unexpected).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test('component-browser fixture preserves the manual escape at 320px and 200% text zoom', async ({ page }, testInfo) => {
  const unexpected = await installSyntheticAssistantRoutes(page);
  await page.goto('/');
  await setMobileViewportAndTextZoom(page, 320);
  await page.getByRole('button', { name: 'Help me choose & book' }).tap();

  const manual = page.getByRole('button', { name: 'Continue manually' });

  await expect(manual).toBeVisible();

  const manualBox = await manual.boundingBox();

  expect(manualBox?.height).toBeGreaterThanOrEqual(44);
  await expect(manual).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.screenshot({ path: path.join(artifactDirectory, `${testInfo.project.name}-manual-320px-200zoom.png`), fullPage: true });

  await manual.tap();

  await expect(page.getByRole('heading', { name: 'Help me choose' })).toHaveCount(0);
  expect(unexpected).toEqual([]);
});
