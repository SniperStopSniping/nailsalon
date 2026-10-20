import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import type { CustomSitePayload } from '../../../src/features/custom-sites/contracts';

// Exercise HTTPS/opaque-origin behavior with the real handler and CSP. All
// requests are fulfilled locally: no Production request, cookie or account.
const approvedParent = 'https://www.lustergel.app';
const rendererOrigin = 'https://isolated-renderer.example.test';
const sandbox = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';
const channel = 'renderer-https-regression';
let renderer: { status: number; headers: Record<string, string>; body: string };

test.beforeAll(async () => {
  process.env.CUSTOM_SITE_PARENT_ORIGIN = approvedParent;
  const { default: handler } = await import(pathToFileURL(path.resolve('tools/custom-site-renderer/handler.mjs')).href);
  renderer = { status: 0, headers: {}, body: '' };
  handler({ method: 'GET', url: '/renderer' }, {
    writeHead(status: number, headers: Record<string, string>) {
      renderer.status = status;
      renderer.headers = headers;
    },
    end(body: string) {
      renderer.body = body;
    },
  });

  expect(renderer.status).toBe(200);
  expect(renderer.headers['Content-Security-Policy']).toContain(`frame-ancestors ${approvedParent};`);
  expect(renderer.headers['Content-Security-Policy']).not.toContain('allow-same-origin');
  expect(Object.keys(renderer.headers).some(key => key.toLowerCase() === 'set-cookie')).toBe(false);
});

function payload(javascript: string): CustomSitePayload {
  return {
    source: {
      title: 'HTTPS isolation fixture',
      analysis: '',
      limitations: [],
      javascript,
      html: '<main><h1 data-luster-field="business.name"></h1><p id="diagnostic">Waiting</p><p id="leak"></p><div data-luster-services></div><template data-luster-service><article><h2 data-luster-field="service.name"></h2><span class="price" data-luster-field="service.priceLabel"></span><button data-luster-book>Book service</button></article></template></main>',
      css: 'body{font-family:system-ui;padding:16px}button{padding:12px}',
    },
    images: {},
    data: {
      business: { name: 'Synthetic isolated salon', city: 'Toronto', address: null, bio: '', hours: {} },
      services: [{ id: 'setup_preview_service', name: 'Gel', description: null, priceCents: 6500, priceLabel: '$65.00', durationMinutes: 60 }],
      currency: 'CAD',
      preview: true,
    },
  };
}

type Message = { type: string; channel?: string; reason?: string; serviceId?: string };
const messages = (page: Page) => page.evaluate(() => (window as unknown as { rendererProbeMessages: Message[] }).rendererProbeMessages);

async function mount(context: BrowserContext, page: Page, input: CustomSitePayload, parentOrigin = approvedParent) {
  const denied: string[] = [];
  const cspErrors: string[] = [];
  // Listener precedes frame navigation so ready messages cannot race the test.
  const encoded = JSON.stringify(input).replaceAll('<', '\\u003c');
  const parentHtml = `<!doctype html><meta charset="utf-8"><script>
    window.parentCanary='synthetic-parent-marker';window.rendererProbeMessages=[];
    const frame=document.createElement('iframe');frame.title='Isolated site';frame.width='100%';frame.height='700';frame.sandbox=${JSON.stringify(sandbox)};
    addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.origin!=='null')return;window.rendererProbeMessages.push(event.data);if(event.data?.type==='renderer-ready')frame.contentWindow.postMessage({type:'initialize',channel:${JSON.stringify(channel)},payload:${encoded}},'*')});
    addEventListener('DOMContentLoaded',()=>{document.body.append(frame);frame.src=${JSON.stringify(`${rendererOrigin}/renderer`)}});
    </script>`;
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === parentOrigin) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: parentHtml });
    }
    if (url.origin === rendererOrigin && url.pathname === '/renderer') {
      return route.fulfill({ status: renderer.status, headers: renderer.headers, body: renderer.body });
    }
    denied.push(url.origin);
    return route.abort();
  });
  page.on('console', message => cspErrors.push(message.text()));
  await page.goto(`${parentOrigin}/isolated-renderer-test`, { waitUntil: 'load' });
  return { site: page.frameLocator('iframe'), denied, cspErrors };
}

test('HTTPS worker blocks network/storage/admin access and cannot forge bookings or prices', async ({ page, context }) => {
  const input = payload(`(async()=>{
    const blocked=[];
    try{await fetch('https://must-not-be-requested.example.test/')}catch{blocked.push('network')}
    try{importScripts('https://must-not-be-requested.example.test/extra.js')}catch{blocked.push('imports')}
    try{indexedDB.open('other-tenant')}catch{blocked.push('storage')}
    try{new BroadcastChannel('other-tenant')}catch{blocked.push('channel')}
    try{new Worker('data:text/javascript,postMessage(1)')}catch{blocked.push('worker')}
    try{const value=parent.document.cookie;Luster.update({selector:'#leak',text:value})}catch{blocked.push('admin')}
    self.postMessage({type:'book',serviceId:'another-salon-service'});
    Luster.update({selector:'.price',text:'$1.00'});
    Luster.update({selector:'#diagnostic',text:blocked.join(',')});
  })();`);
  const { site, denied } = await mount(context, page, input);

  await expect(site.locator('#diagnostic')).toHaveText('network,imports,storage,channel,worker,admin');
  await expect(site.locator('.price')).toHaveText('$65.00');
  await expect(site.locator('#leak')).toBeEmpty();
  await expect(site.locator('[data-luster-book]')).toHaveAttribute('data-luster-book', 'setup_preview_service');
  expect((await messages(page)).filter(message => message.type === 'book')).toEqual([]);
  expect(denied).toEqual([]);

  await site.getByRole('button', { name: 'Book service' }).click();

  await expect.poll(() => messages(page)).toContainEqual({ channel, type: 'preview-booking' });
  expect((await messages(page)).filter(message => message.type === 'book')).toEqual([]);
  expect(denied).toEqual([]);
});

test('runaway HTTPS worker is terminated while the draft and booking protection remain', async ({ page, context }) => {
  const { site, denied } = await mount(context, page, payload('while(true){}'));

  await expect(site.getByRole('heading', { name: 'Synthetic isolated salon' })).toBeVisible();
  await expect.poll(() => messages(page)).toContainEqual({ channel, type: 'interaction-stopped', reason: 'watchdog' });

  await site.getByRole('button', { name: 'Book service' }).click();

  await expect.poll(() => messages(page)).toContainEqual({ channel, type: 'preview-booking' });
  expect((await messages(page)).filter(message => message.type === 'book')).toEqual([]);
  expect(denied).toEqual([]);
});

test('custom navigation still responds to child-icon and keyboard activation on HTTPS', async ({ page, context }) => {
  const input = payload(`let open=false;Luster.on(event=>{if(event.type==='click'&&event.id==='nav-toggle'){open=!open;Luster.update({selector:'#custom-nav',className:open?'navigation is-open':'navigation'});Luster.update({selector:'#nav-toggle',expanded:open})}});`);
  input.source.html += '<button id="nav-toggle" aria-expanded="false">Menu <span data-testid="nav-icon">+</span></button><nav id="custom-nav" class="navigation">Custom menu</nav>';
  input.source.javascript += 'Luster.update({selector:"#diagnostic",text:"Élise ✨"});';
  input.source.css += '.navigation{display:none}.navigation.is-open{display:block}';
  const { site, denied } = await mount(context, page, input);

  await expect(site.getByRole('heading', { name: 'Synthetic isolated salon' })).toBeVisible();
  await expect(site.locator('#diagnostic')).toHaveText('Élise ✨');

  await site.getByTestId('nav-icon').click();

  await expect(site.locator('#custom-nav')).toBeVisible();
  await expect(site.locator('#nav-toggle')).toHaveAttribute('aria-expanded', 'true');

  await site.locator('#nav-toggle').focus();
  await site.locator('#nav-toggle').press('Enter');

  await expect(site.locator('#custom-nav')).toBeHidden();
  await expect(site.locator('#nav-toggle')).toHaveAttribute('aria-expanded', 'false');
  expect(denied).toEqual([]);
});

for (const origin of ['https://lustergel.app', 'https://admin.lustergel.app', 'https://www.lustergel.app.evil.test']) {
  test(`CSP refuses a parent other than the exact approved origin: ${new URL(origin).host}`, async ({ page, context }) => {
    const { cspErrors, denied } = await mount(context, page, payload(''), origin);

    await expect.poll(() => cspErrors.some(text => /frame-ancestors|ancestor|framing/iu.test(text))).toBe(true);
    expect(await messages(page)).toEqual([]);
    expect(denied).toEqual([]);
  });
}
