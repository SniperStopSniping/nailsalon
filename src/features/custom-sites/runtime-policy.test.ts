// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { afterEach, expect, it } from 'vitest';

const runtime = readFileSync('tools/custom-site-renderer/runtime.js', 'utf8');

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

async function renderPolicy(bookingPolicy: { title: string; text: string } | null) {
  document.body.innerHTML = '<div id="site-root"></div>';
  let initialize: (event: unknown) => Promise<void>;
  const parent = { postMessage() {} };
  // This exercises the actual trusted renderer bundle; no generated JS is run.
  runInNewContext(runtime, {
    document,
    parent,
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
  await initialize!({ source: parent, origin: 'https://builder.example', data: { type: 'initialize', channel: 'private-test-channel', payload: {
    source: { html: '<section data-luster-booking-policy><h2 data-luster-field="booking.policyTitle">Stale title</h2><p data-luster-field="booking.policyText">Stale copied policy</p></section>', css: '', javascript: '' },
    data: { business: {}, services: [], bookingPolicy },
    images: {},
  } } });
  return document.querySelector('section')!;
}

it('renders current policy as inert text and clears stale policy when its visibility changes', async () => {
  const first = await renderPolicy({ title: 'Before your appointment', text: 'Arrive on time.\n<script>not executable</script>' });

  expect(first.hidden).toBe(false);
  expect(first.querySelector('p')?.textContent).toBe('Arrive on time.\n<script>not executable</script>');
  expect(document.querySelector('script')).toBeNull();

  const changed = await renderPolicy({ title: 'Updated policy', text: 'Contact us to cancel.' });

  expect(changed).toHaveTextContent(/Contact us to cancel\./);
  expect(changed).not.toHaveTextContent(/Arrive on time/);

  const removed = await renderPolicy(null);

  expect(removed.hidden).toBe(true);
  expect(removed).toHaveTextContent('');
});
