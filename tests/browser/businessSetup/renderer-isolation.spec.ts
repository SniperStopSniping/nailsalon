import { expect, test } from '@playwright/test';
import sharp from 'sharp';

import { compileCanvaDesign } from '../../../src/features/custom-sites/canva';
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

test('Canva artwork stays pixel-identical while contacts and canonical service areas work on desktop and mobile', async ({ page, context }) => {
  const bytes = await sharp({ create: { width: 300, height: 600, channels: 3, background: '#e7cbd6' } }).png().toBuffer();
  const assetId = 'a0000000-0000-4000-8000-000000000001';
  const input = payload('', true);
  input.images = { [assetId]: `data:image/png;base64,${bytes.toString('base64')}` };
  input.data.details = { locationDirections: null, instagram: '@canva_studio', email: null, phone: null, sections: [] };
  input.serviceKeys = { ['a'.repeat(64)]: 'canonical-service' };
  input.source = compileCanvaDesign({ version: 1, pages: [{ assetId, width: 300, height: 600, alt: 'Original export' }], areas: [
    { id: 'book', page: 0, label: 'Book Gel', geometry: { x: 10, y: 60, width: 80, height: 10 }, action: { type: 'service', serviceKey: 'a'.repeat(64) } },
    { id: 'instagram', page: 0, label: 'Open Instagram', geometry: { x: 10, y: 80, width: 80, height: 10 }, action: { type: 'instagram' } },
  ], visibleText: '', notes: [], dataFingerprint: 'b'.repeat(64), ownerReviewed: true }, input.data.details);
  await context.route('https://www.instagram.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Test profile</h1>' }));
  await page.route('http://localhost:3197/canva-probe', route => route.fulfill({ contentType: 'text/html', body: '<html><body><iframe width="100%" height="900" title="Probe" src="http://127.0.0.1:3198/renderer" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"></iframe></body></html>' }));
  await page.goto('/canva-probe');
  await page.evaluate((payload) => {
    const frame = document.querySelector('iframe')!;
    Object.assign(window, { probeMessages: [] });
    window.addEventListener('message', (event) => {
      if (event.source !== frame.contentWindow || event.origin !== 'null') {
        return;
      }
      (window as unknown as { probeMessages: unknown[] }).probeMessages.push(event.data);
      if (event.data?.type === 'renderer-ready') {
        frame.contentWindow!.postMessage({ type: 'initialize', channel: 'canva-test', payload }, '*');
      }
    });
  }, input);
  const site = page.frameLocator('iframe');

  await expect(site.locator('#canva-book')).toBeVisible();
  await expect(site.locator('#canva-book')).toHaveAttribute('data-luster-book', 'canonical-service');

  const rendered = await site.locator('.canva-page img').screenshot({ scale: 'css' });

  expect((await sharp(rendered).metadata()).width).toBe(300);
  expect((await sharp(rendered).removeAlpha().raw().toBuffer()).equals(await sharp(bytes).raw().toBuffer())).toBe(true);

  await site.locator('#canva-book').click();

  await expect.poll(() => page.evaluate(() => (window as unknown as { probeMessages: unknown[] }).probeMessages)).toContainEqual({ channel: 'canva-test', type: 'preview-booking' });

  const opened = context.waitForEvent('page');
  await site.locator('#canva-instagram').click();
  const popup = await opened;

  await expect(popup).toHaveURL('https://www.instagram.com/canva_studio/');

  await popup.close();

  await expect(site.locator('.canva-page img')).toHaveAttribute('src', input.images[assetId]!);
});

test('broken Canva images have no clickable overlay', async ({ page }) => {
  const input = payload('', true);
  const id = 'a0000000-0000-4000-8000-000000000001';
  input.source = compileCanvaDesign({ version: 1, pages: [{ assetId: id, width: 300, height: 600, alt: 'Unavailable export' }], areas: [{ id: 'book', page: 0, label: 'Book', geometry: { x: 10, y: 60, width: 80, height: 10 }, action: { type: 'book' } }], visibleText: '', notes: [], dataFingerprint: 'b'.repeat(64), ownerReviewed: false });
  await page.route('http://localhost:3197/canva-broken', route => route.fulfill({ contentType: 'text/html', body: '<html><body><iframe title="Probe" src="http://127.0.0.1:3198/renderer" sandbox="allow-scripts"></iframe></body></html>' }));
  await page.goto('/canva-broken');
  await page.evaluate((payload) => {
    const frame = document.querySelector('iframe')!;
    window.addEventListener('message', (event) => {
      if (event.source === frame.contentWindow && event.origin === 'null' && event.data?.type === 'renderer-ready') {
        frame.contentWindow!.postMessage({ type: 'initialize', channel: 'canva-broken', payload }, '*');
      }
    });
  }, input);

  await expect(page.frameLocator('iframe').locator('#canva-book')).toBeHidden();
});

test('opaque renderer blocks network, persistent storage, forged booking and canonical data changes', async ({ page }) => {
  // A trusted parent harness drives the same standalone renderer. No database,
  // provider or outbound integration is involved in these hostile-source tests.
  await page.route('http://localhost:3197/renderer-probe', route => route.fulfill({ contentType: 'text/html', body: '<html><body><iframe title="Probe" src="http://127.0.0.1:3198/renderer" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"></iframe></body></html>' }));
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
  await page.route('http://localhost:3197/renderer-probe', route => route.fulfill({ contentType: 'text/html', body: '<html><body><iframe title="Probe" src="http://127.0.0.1:3198/renderer" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"></iframe></body></html>' }));
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

test('trusted contact links are clickable while public directions and complete policies render', async ({ page, context }) => {
  await context.route('https://www.instagram.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Intercepted Instagram destination</h1>' }));
  await page.route('http://localhost:3197/renderer-contacts', route => route.fulfill({ contentType: 'text/html', body: '<html><body><iframe title="Probe" src="http://127.0.0.1:3198/renderer" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"></iframe></body></html>' }));
  await page.goto('/renderer-contacts');
  const input = payload('', true);
  input.data.details = { locationDirections: 'Dixie and Countryside', instagram: '@dynastybeautyy', email: 'studio@example.com', phone: '+1 416 555 0100', sections: [{ id: 'guests', title: 'Guests', text: 'Please come alone.' }] };
  input.source.html += '<p data-luster-field="details.locationDirections"></p><a data-luster-link="instagram"><span data-luster-field="details.instagram"></span></a><a data-luster-link="email">Email</a><a data-luster-link="phone">Call</a><h2 data-luster-field="details.title_guests"></h2><p data-luster-field="details.section_guests"></p>';
  await page.evaluate((payload) => {
    const frame = document.querySelector('iframe')!;
    window.addEventListener('message', (event) => {
      if (event.source === frame.contentWindow && event.origin === 'null' && event.data?.type === 'renderer-ready') {
        frame.contentWindow!.postMessage({ type: 'initialize', channel: 'contact-probe', payload }, '*');
      }
    });
  }, input);
  const site = page.frameLocator('iframe');

  await expect(site.getByText('Dixie and Countryside')).toBeVisible();
  await expect(site.getByText('Please come alone.')).toBeVisible();
  await expect(site.getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:studio@example.com');
  await expect(site.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+14165550100');

  const opened = context.waitForEvent('page');
  await site.getByRole('link', { name: '@dynastybeautyy' }).click();
  const popup = await opened;

  await expect(popup).toHaveURL('https://www.instagram.com/dynastybeautyy/');
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);

  await popup.close();
});
