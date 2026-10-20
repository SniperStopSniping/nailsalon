// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';

const runtime = readFileSync('tools/custom-site-renderer/runtime.js', 'utf8');

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

async function start() {
  document.body.innerHTML = '<div id="site-root"></div>';
  const handlers: Array<(event: unknown) => unknown> = [];
  let observer: (entries: { target: Element; isIntersecting: boolean }[]) => void;
  const parent = { postMessage: vi.fn() };
  runInNewContext(runtime, { document, parent, URL, URLSearchParams, PARENT_ORIGIN: 'https://builder.example', TRUSTED_FONT_CSS: '', addEventListener: (name: string, handler: (event: unknown) => unknown) => {
    if (name === 'message') {
      handlers.push(handler);
    }
  }, IntersectionObserver: class {
    constructor(callback: typeof observer) {
      observer = callback;
    }

    observe() {} disconnect() {}
  }, setInterval: () => 1, clearInterval() {}, innerWidth: 390 });
  const send = async (data: unknown, origin = 'https://builder.example', source = parent) => {
    for (const handler of handlers) {
      await handler({ source, origin, data });
    }
  };
  const id = 'a0000000-0000-4000-8000-000000000001';
  await send({ type: 'initialize', channel: 'native-runtime-test', payload: { source: { html: `<figure><img data-luster-native-image="${id}" width="400" height="900" alt="Owned photo"><figcaption data-luster-native-status="${id}" hidden>Photo unavailable</figcaption></figure>`, css: '', javascript: '' }, data: { business: {}, services: [] }, images: {} } });
  const node = document.querySelector('img')!;
  return { id, node, parent, send, observe: (visible: boolean) => observer!([{ target: node, isIntersecting: visible }]) };
}

describe('actual trusted runtime native photo bridge', () => {
  it('requests visible photos only, binds exact parent/channel responses and unloads offscreen data', async () => {
    const test = await start();

    expect(test.parent.postMessage).toHaveBeenCalledWith({ type: 'renderer-ready', capabilities: ['native-images-v1'] }, 'https://builder.example');
    expect(test.parent.postMessage.mock.calls.some(([message]) => message.type === 'native-image-request')).toBe(false);

    test.observe(true);

    expect(test.parent.postMessage).toHaveBeenCalledWith({ type: 'native-image-request', channel: 'native-runtime-test', mediaId: test.id }, 'https://builder.example');

    const answer = { type: 'native-image', channel: 'native-runtime-test', mediaId: test.id, dataUrl: 'data:image/webp;base64,UklGRg==' };

    await test.send(answer, 'https://attacker.example');

    await test.send({ ...answer, channel: 'wrong' });

    await test.send({ ...answer, mediaId: 'unknown' });

    expect(test.node).not.toHaveAttribute('src');

    await test.send(answer);

    expect(test.node).toHaveAttribute('src', answer.dataUrl);

    test.observe(false);

    expect(test.node).not.toHaveAttribute('src');
    expect(test.node).toHaveAttribute('width', '400');
    expect(test.node).toHaveAttribute('height', '900');
  });

  it('rejects executable or oversized image payloads and surfaces a recoverable failure', async () => {
    const test = await start();

    test.observe(true);

    await test.send({ type: 'native-image', channel: 'native-runtime-test', mediaId: test.id, dataUrl: 'data:image/svg+xml,<svg onload="publish()"/>' });

    expect(test.node).not.toHaveAttribute('src');
    expect(document.querySelector('figcaption')).not.toHaveAttribute('hidden');

    test.observe(true);

    await test.send({ type: 'native-image', channel: 'native-runtime-test', mediaId: test.id, dataUrl: `data:image/webp;base64,${'A'.repeat(5000101)}` });

    expect(test.node).not.toHaveAttribute('src');
    expect(document.querySelector('script')).toBeNull();
  });
});
