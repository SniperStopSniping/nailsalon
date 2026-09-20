import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';

const artifactDirectory = path.resolve(__dirname, '../../../artifacts/customer-assistant');
const fingerprint = 'f'.repeat(64);
const flowToken = 'v1.123e4567-e89b-12d3-a456-426614174000.1.signed';

async function installSyntheticHandoffRoutes(page: Page): Promise<{ handoffs: unknown[]; unexpected: string[] }> {
  const handoffs: unknown[] = [];
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
    if (url.pathname === '/api/__fixture/booking-page') {
      await route.fulfill({ json: { stage: 'time', props: { services: [{ id: 'gel-x', name: 'Gel-X Extensions', price: 85, duration: 105 }], addOns: [{ id: 'french', name: 'French tips', price: 15, duration: 15, quantity: 1 }], totalPrice: 100, totalDuration: 120, technician: null, bookingFlow: ['service', 'time', 'confirm'], minimumNoticeMinutes: 0, salonTimeZone: 'America/Toronto', closedWeekdays: [] } } });
      return;
    }
    if (url.pathname === '/api/appointments/availability') {
      await route.fulfill({ json: { slots: [], timeZone: 'America/Toronto' } });
      return;
    }
    if (url.pathname.endsWith('/session') && request.method() === 'POST') {
      await route.fulfill({ json: { conversation: 'synthetic-conversation', salon: { name: 'Synthetic Booking Test Salon' } } });
      return;
    }
    if (url.pathname.endsWith('/chat') && request.method() === 'POST') {
      await route.fulfill({ json: {
        conversation: 'synthetic-proposal',
        result: {
          kind: 'proposal',
          proposal: {
            selection: { baseServiceId: 'gel-x', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] },
            fingerprint,
            service: { id: 'gel-x', name: 'Gel-X Extensions', priceCents: 8500 },
            addOns: [{ id: 'french', name: 'French tips', quantity: 1, priceCents: 1500 }],
            currency: 'CAD',
            subtotalCents: 10000,
            durationMinutes: 120,
            expiresAt: '2030-01-01T00:00:00.000Z',
          },
        },
      } });
      return;
    }
    if (url.pathname.endsWith('/handoff') && request.method() === 'POST') {
      handoffs.push(request.postDataJSON());
      await route.fulfill({ json: {
        conversation: 'synthetic-handoff',
        result: {
          kind: 'handoff',
          handoff: {
            selection: { baseServiceId: 'gel-x', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] },
            datePreference: { date: '2030-01-05', earliest: '12:00', latest: '18:00' },
            flow: { flowToken, expiresAt: '2030-01-01T00:00:00.000Z' },
          },
        },
      } });
      return;
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    await route.abort();
  });
  return { handoffs, unexpected };
}

for (const viewport of [{ width: 390, zoom: 100 }, { width: 320, zoom: 200 }]) {
  test(`synthetic handoff enters normal Time safely at ${viewport.width}px/${viewport.zoom}%`, async ({ page }, testInfo) => {
    const { handoffs, unexpected } = await installSyntheticHandoffRoutes(page);
    await page.setViewportSize({ width: viewport.width, height: 844 });
    await page.goto('/');
    await page.addStyleTag({ content: `html { font-size: ${viewport.zoom}%; }` });

    await page.getByRole('button', { name: 'Help me choose & book' }).tap();
    await page.getByLabel('Tell me what you would like').fill('Gel-X with French tips');
    await page.getByRole('button', { name: 'Send' }).tap();

    await expect(page.getByRole('region', { name: 'Your appointment package' })).toBeVisible();
    await expect(page.getByRole('button', { name: /confirm booking/i })).toHaveCount(0);
    await expect(page.getByLabel('Phone number')).toHaveCount(0);

    const accept = page.getByRole('button', { name: 'Choose these services' });
    await accept.tap();

    await expect.poll(() => handoffs.length).toBe(1);
    expect(handoffs[0]).toEqual({ conversation: 'synthetic-proposal', fingerprint, locale: 'en' });
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const handoffUrl = new URL(page.url());

    expect(handoffUrl.pathname).toContain('/en/isla-nail-studio/book/time');
    expect(handoffUrl.searchParams.get('bookingFlow')).toBe('assistant');
    expect(handoffUrl.searchParams.get('date')).toBe('2030-01-05');
    expect(page.url()).not.toContain(flowToken);
    expect(await page.evaluate(() => sessionStorage.getItem('luster.normal-confirm-handoff.v1.synthetic-browser-isla-salon'))).toContain(flowToken);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.goBack();

    await expect(page.getByRole('button', { name: 'Help me choose & book' })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('luster.normal-confirm-handoff.v1.synthetic-browser-isla-salon'))).toContain(flowToken);

    await page.goForward();
    await page.getByRole('button', { name: 'Help me choose & book' }).tap();

    await expect(page.getByRole('heading', { name: 'AI booking assistant' })).toBeVisible();
    await expect(page.getByLabel('Tell me what you would like')).toBeVisible();

    await page.getByRole('button', { name: 'Continue manually' }).tap();

    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    await page.screenshot({ path: path.join(artifactDirectory, `${testInfo.project.name}-handoff-navigation-${viewport.width}px-${viewport.zoom}zoom.png`), fullPage: true });

    expect(unexpected).toEqual([]);
  });
}

test('the 320px/200% floating launcher reserves room for the normal Time action', async ({ page }, testInfo) => {
  const { handoffs, unexpected } = await installSyntheticHandoffRoutes(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  await page.addStyleTag({ content: 'html { font-size: 200%; } :root { --service-sticky-footer-clearance: 100px; }' });

  await page.getByRole('button', { name: 'Help me choose & book' }).tap();
  await page.getByLabel('Tell me what you would like').fill('Gel-X with French tips');
  await page.getByRole('button', { name: 'Send' }).tap();
  await page.getByRole('button', { name: 'Choose these services' }).tap();

  await expect.poll(() => handoffs.length).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const launcher = page.getByRole('button', { name: 'Help me choose & book' });
  const lastNormalAction = page.getByRole('button', { name: 'Choose another date' });

  await lastNormalAction.scrollIntoViewIfNeeded();

  await expect(lastNormalAction).toBeVisible();
  await expect(launcher).toBeVisible();

  const [launcherBox, actionBox, viewportHeight] = await Promise.all([
    launcher.boundingBox(),
    lastNormalAction.boundingBox(),
    page.evaluate(() => window.innerHeight),
  ]);

  expect(launcherBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(launcherBox!.y).toBeGreaterThanOrEqual(0);
  expect(launcherBox!.y + launcherBox!.height).toBeLessThanOrEqual(viewportHeight - 100);
  expect(launcherBox!.y >= actionBox!.y + actionBox!.height || actionBox!.y >= launcherBox!.y + launcherBox!.height).toBe(true);
  expect(unexpected).toEqual([]);

  await page.screenshot({ path: path.join(artifactDirectory, `${testInfo.project.name}-handoff-geometry-320px-200zoom.png`), fullPage: false });
});
