// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { afterEach, expect, it } from 'vitest';

const runtime = readFileSync('tools/custom-site-renderer/runtime.js', 'utf8');

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

async function render(hrefs: string[]) {
  document.body.innerHTML = '<div id="site-root"></div>';
  let initialize: (event: unknown) => Promise<void>;
  const parent = { postMessage() {} };
  runInNewContext(runtime, {
    document,
    parent,
    URL,
    URLSearchParams,
    PARENT_ORIGIN: 'https://builder.example',
    TRUSTED_FONT_CSS: '',
    addEventListener: (name: string, handler: typeof initialize) => {
      if (name === 'message') {
        initialize = handler;
      }
    },
    ResizeObserver: class {
      observe() {}
    },
    setInterval: () => 1,
    clearInterval() {},
    innerWidth: 390,
  });
  await initialize!({ source: parent, origin: 'https://builder.example', data: { type: 'initialize', channel: 'manual-runtime-test', payload: {
    source: { html: `<section id="manual-home"></section>${hrefs.map((_, i) => `<a id="link-${i}" data-luster-canva-control="owner-${i}">Owner link</a>`).join('')}`, css: '', javascript: '', canva: { areas: [], controls: hrefs.map((href, i) => ({ id: `owner-${i}`, action: { type: 'manual_link', href } })) } },
    data: { business: {}, services: [] },
    images: {},
  } } });
  return [...document.querySelectorAll<HTMLAnchorElement>('a')];
}

it('wires actual trusted-runtime owner contacts, SMS, maps, external links and in-page navigation', async () => {
  const hrefs = ['https://www.instagram.com/my_studio/', 'tel:+14165550100', 'sms:4165550100', 'mailto:studio@example.com?subject=Hello%20there', 'https://www.google.com/maps/search/?api=1&query=Dixie%20Road', '#manual-home'];
  const links = await render(hrefs);

  expect(links.map(link => link.getAttribute('href'))).toEqual(hrefs);
  expect(links[0]!.target).toBe('_blank');
  expect(links[0]!.rel).toBe('noopener noreferrer');
  expect(links[1]!.target).toBe('');
  expect(links[5]!.target).toBe('');
});

it('keeps malformed/malicious navigation inert even if trusted metadata is tampered with before rendering', async () => {
  const links = await render(['javascript:alert(1)', 'data:text/html,hello', 'http://example.com', 'https://127.0.0.1', 'https://example.internal/', 'https://example.com:8443/', 'https://user:password@example.com', 'https://example.com/admin/delete', '/admin', '#missing-page', 'mailto:studio@example.com?bcc=someone@example.com', 'mailto:studio@example.com?subject=Hello%0ABcc%3Aanyone', 'sms:4165550100?body=send', 'tel:123']);

  expect(links.every(link => !link.hasAttribute('href'))).toBe(true);
  expect(document.querySelector('script')).toBeNull();
});
