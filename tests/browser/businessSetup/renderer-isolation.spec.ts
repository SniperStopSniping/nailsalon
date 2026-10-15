import { expect, test } from '@playwright/test';

import type { CustomSitePayload } from '../../../src/features/custom-sites/contracts';

const html = '<main><h1 data-luster-field="business.name"></h1><p id="diagnostic">Waiting</p><div data-luster-services></div><template data-luster-service><article><h2 data-luster-field="service.name"></h2><span class="price" data-luster-field="service.priceLabel"></span><button data-luster-book>Book service</button></article></template></main>';
const payload = (javascript: string, preview = false): CustomSitePayload => ({
  source: { title: 'Isolation probe', html, css: '', javascript, analysis: '', limitations: [] },
  images: {},
  data: {
    business: { name: 'Synthetic isolated salon', city: 'Toronto', address: null, bio: '', hours: {} },
    services: [{ id: 'canonical-service', name: 'Gel', description: null, priceCents: 6500, priceLabel: '$65.00', durationMinutes: 60 }],
    currency: 'CAD',
    preview,
  },
});

test('opaque renderer blocks network, persistent storage, forged booking and canonical data changes', async ({ page }) => {
  // A trusted parent harness drives the same standalone renderer. No database,
  // provider or outbound integration is involved in these hostile-source tests.
  await page.route('http://localhost:3197/renderer-probe', route => route.fulfill({ contentType: 'text/html', body: '<html><body><iframe title="Probe" src="http://127.0.0.1:3198/renderer" sandbox="allow-scripts"></iframe></body></html>' }));
  await page.goto('/renderer-probe');
  const source = payload(`
    (async () => {
      const blocked = [];
      try { await fetch('http://localhost:3197/must-not-be-requested'); } catch { blocked.push('network'); }
      try { indexedDB.open('cross-salon'); } catch { blocked.push('storage'); }
      try { new BroadcastChannel('cross-salon'); } catch { blocked.push('channel'); }
      try { new Worker('data:text/javascript,postMessage(1)'); } catch { blocked.push('worker'); }
      self.postMessage({type:'book',serviceId:'canonical-service'});
      Luster.update({selector:'.price',text:'$1.00'});
      Luster.update({selector:'#diagnostic',text:blocked.join(',')});
    })();
  `);
  let forbiddenRequests = 0;
  page.on('request', request => forbiddenRequests += Number(request.url().includes('must-not-be-requested')));
  await page.evaluate((input) => {
    const frame = document.querySelector('iframe')!;
    const messages: { type: string }[] = [];
    Object.assign(window, { probeMessages: messages });
    window.addEventListener('message', (event) => {
      if (event.source !== frame.contentWindow || event.origin !== 'null') {
        return;
      }
      messages.push(event.data);
      if (event.data?.type === 'renderer-ready') {
        frame.contentWindow!.postMessage({ type: 'initialize', channel: 'probe-channel', payload: input }, '*');
      }
    });
  }, source);
  const site = page.frameLocator('iframe');

  await expect(site.locator('#diagnostic')).toHaveText('network,storage,channel,worker');
  await expect(site.locator('.price')).toHaveText('$65.00');
  expect(forbiddenRequests).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { probeMessages: { type: string }[] }).probeMessages.filter(item => item.type === 'book'))).toEqual([]);

  await site.getByRole('button', { name: 'Book service' }).click();

  await expect.poll(() => page.evaluate(() => (window as unknown as { probeMessages: unknown[] }).probeMessages)).toContainEqual({ channel: 'probe-channel', type: 'book', serviceId: 'canonical-service' });
});

test('runaway interaction terminates while the draft remains visible and cannot book', async ({ page }) => {
  await page.route('http://localhost:3197/renderer-probe', route => route.fulfill({ contentType: 'text/html', body: '<html><body><iframe title="Probe" src="http://127.0.0.1:3198/renderer" sandbox="allow-scripts"></iframe></body></html>' }));
  await page.goto('/renderer-probe');
  await page.evaluate((input) => {
    const frame = document.querySelector('iframe')!;
    const messages: { type: string }[] = [];
    Object.assign(window, { probeMessages: messages });
    window.addEventListener('message', (event) => {
      if (event.source !== frame.contentWindow || event.origin !== 'null') {
        return;
      }
      messages.push(event.data);
      if (event.data?.type === 'renderer-ready') {
        frame.contentWindow!.postMessage({ type: 'initialize', channel: 'probe-channel', payload: input }, '*');
      }
    });
  }, payload('while(true){}', true));
  const site = page.frameLocator('iframe');

  await expect(site.getByText('Synthetic isolated salon')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { probeMessages: unknown[] }).probeMessages)).toContainEqual({ channel: 'probe-channel', type: 'interaction-stopped', reason: 'watchdog' });

  await site.getByRole('button', { name: 'Book service' }).click();

  await expect.poll(() => page.evaluate(() => (window as unknown as { probeMessages: unknown[] }).probeMessages)).toContainEqual({ channel: 'probe-channel', type: 'preview-booking' });
  expect(await page.evaluate(() => (window as unknown as { probeMessages: { type: string }[] }).probeMessages.filter(item => item.type === 'book'))).toEqual([]);
});
