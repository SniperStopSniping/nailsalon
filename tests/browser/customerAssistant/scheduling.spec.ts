import path from 'node:path';

import { expect, test } from '@playwright/test';

const proposal = {
  selection: { baseServiceId: 'gel-x', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] },
  fingerprint: 'f'.repeat(64),
  service: { id: 'gel-x', name: 'Gel-X Extensions', priceCents: 8500 },
  addOns: [{ id: 'french', name: 'French', quantity: 1, priceCents: 1500 }],
  currency: 'CAD',
  subtotalCents: 10000,
  durationMinutes: 120,
  expiresAt: '2026-09-18T12:05:00Z',
};
const preference = { date: '2026-09-19', earliest: '12:00', latest: '18:00' };
const firstSlot = { time: '13:00', startTime: '2026-09-19T17:00:00.000Z' };
const secondSlot = { time: '13:30', startTime: '2026-09-19T17:30:00.000Z' };
const timeZone = 'America/Toronto';

for (const viewport of [{ width: 390, zoom: 100 }, { width: 320, zoom: 200 }]) {
  test(`synthetic scheduling retains explicit selection and stale-slot recovery at ${viewport.width}px/${viewport.zoom}%`, async ({ page }, testInfo) => {
    const actions: Record<string, unknown>[] = [];
    const unexpected: string[] = [];
    let turn = 0;
    let selectionAttempts = 0;
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== 'http://127.0.0.1:3130') {
        unexpected.push(url.origin);
        await route.abort();
        return;
      }
      if (!url.pathname.startsWith('/api/')) {
        await route.continue();
        return;
      }
      const token = () => `synthetic-scheduling-${++turn}`;
      if (url.pathname.endsWith('/session')) {
        await route.fulfill({ json: { conversation: token() } });
        return;
      }
      const body = request.postDataJSON() as Record<string, unknown>;
      if (url.pathname.endsWith('/chat')) {
        const result = body.message === 'Saturday afternoon'
          ? { kind: 'slots', proposal, preference, timeZone, slots: [firstSlot, secondSlot], checkedAt: '2026-09-18T12:00:00Z' }
          : { kind: 'proposal', proposal };
        await route.fulfill({ json: { conversation: token(), result } });
        return;
      }
      if (url.pathname.endsWith('/action')) {
        actions.push(body);
        if (body.action === 'accept_selection') {
          await route.fulfill({ json: { conversation: token(), result: { kind: 'date_prompt', proposal, today: '2026-09-18', timeZone } } });
          return;
        }
        if (body.action === 'select_slot') {
          selectionAttempts += 1;
          const result = selectionAttempts === 1
            ? { kind: 'slots', proposal, preference, timeZone, slots: [secondSlot], checkedAt: '2026-09-18T12:01:00Z', slotDisappeared: true }
            : { kind: 'slot_selected', proposal, preference, timeZone, slot: secondSlot };
          await route.fulfill({ json: { conversation: token(), result } });
          return;
        }
      }
      unexpected.push(`${request.method()} ${url.pathname}`);
      await route.abort();
    });

    await page.setViewportSize({ width: viewport.width, height: 844 });
    await page.goto('/');
    await page.addStyleTag({ content: `html { font-size: ${viewport.zoom}%; }` });
    await page.getByRole('button', { name: 'Help me choose & book' }).tap();
    await page.getByLabel('Describe the nails you want').fill('Short Gel-X with French');
    await page.getByRole('button', { name: 'Send' }).tap();

    await expect(page.getByRole('button', { name: 'Choose these services' })).toBeVisible();
    expect(actions).toHaveLength(0);

    await page.getByRole('button', { name: 'Choose these services' }).tap();

    await expect(page.getByText('What day works for you?')).toBeVisible();

    await page.getByLabel('Describe the nails you want').fill('Saturday afternoon');
    await page.getByRole('button', { name: 'Send' }).tap();
    await page.getByRole('button', { name: /1:00.*p\.?m\.?/i }).tap();

    await expect(page.getByText('That time is no longer available. Here are the current options.')).toBeVisible();
    await expect(page.getByRole('button', { name: /1:00.*p\.?m\.?/i })).toHaveCount(0);

    await page.getByRole('button', { name: /1:30.*p\.?m\.?/i }).tap();

    await expect(page.getByRole('status').filter({ hasText: 'no appointment has been created' })).toBeVisible();
    await expect(page.getByRole('button', { name: /confirm booking/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue manually' })).toBeInViewport();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.screenshot({ path: path.resolve(__dirname, `../../../artifacts/customer-assistant/${testInfo.project.name}-selected-time-${viewport.width}px-${viewport.zoom}zoom.png`), fullPage: true });

    expect(actions.map(action => action.action)).toEqual(['accept_selection', 'select_slot', 'select_slot']);
    expect(actions[0]?.fingerprint).toBe(proposal.fingerprint);
    expect(unexpected).toEqual([]);

    await page.getByRole('button', { name: 'Continue manually' }).tap();

    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}
