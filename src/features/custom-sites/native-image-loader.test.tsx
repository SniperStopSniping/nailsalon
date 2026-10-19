// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { nativeImageLoader } from './native-image-loader';

afterEach(() => vi.unstubAllGlobals());

const image = () => new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'Content-Type': 'image/webp' } });
const config = { artifactId: 'a0000000-0000-4000-8000-000000000001', mediaIds: ['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003'], shareToken: 'a'.repeat(64) };

describe('trusted parent native image loader', () => {
  it('evicts old cache entries but permits successful photos to reload during repeated scrolling', async () => {
    const fetcher = vi.fn().mockImplementation(async () => image());
    vi.stubGlobal('fetch', fetcher);
    const ready = vi.fn();
    const mediaIds = Array.from({ length: 9 }, (_, index) => `b0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
    const loader = nativeImageLoader({ ...config, mediaIds }, ready);
    let loaded = 0;
    for (let round = 0; round < 4; round++) {
      for (const id of mediaIds) {
        loader.request(id);
        loaded++;
        await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(loaded), { interval: 5 });
      }
    }

    expect(fetcher).toHaveBeenCalledTimes(36);
    expect(ready.mock.calls.every(([, value]) => typeof value === 'string')).toBe(true);

    loader.dispose();
  });

  it('requests only declared photos at a fixed same-origin endpoint and reuses loaded bytes', async () => {
    const fetcher = vi.fn().mockImplementation(async () => image());
    vi.stubGlobal('fetch', fetcher);
    const ready = vi.fn();
    const loader = nativeImageLoader(config, ready);
    loader.request('https://attacker.invalid');
    loader.request('unlisted-photo');
    loader.request(config.mediaIds[0]);
    loader.request(config.mediaIds[0]);
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1));

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe('/api/custom-sites/media');
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', method: 'POST' });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ artifactId: config.artifactId, mediaId: config.mediaIds[0], shareToken: config.shareToken });
    expect(ready.mock.calls[0]![1]).toMatch(/^data:image\/webp;base64,/u);

    loader.request(config.mediaIds[0]);

    expect(ready).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(1);

    loader.dispose();
  });

  it('bounds concurrency, aborts disposal and never delivers a late photo into another revision', async () => {
    const pending: Array<(value: Response) => void> = [];
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(resolve => pending.push(resolve)));
    vi.stubGlobal('fetch', fetcher);
    const ready = vi.fn();
    const loader = nativeImageLoader(config, ready);
    config.mediaIds.forEach(id => loader.request(id));

    expect(fetcher).toHaveBeenCalledTimes(2);

    pending[0]!(image());
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    loader.dispose();

    expect(fetcher.mock.calls[1]![1].signal.aborted).toBe(true);

    pending[1]!(image());
    pending[2]!(image());
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('rejects wrong types and oversized bodies and bounds retries per image', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('not a photo', { headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetcher);
    const ready = vi.fn();
    const loader = nativeImageLoader(config, ready);
    for (let attempt = 1; attempt <= 3; attempt++) {
      loader.request(config.mediaIds[0]);
      await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(attempt));
    }
    loader.request(config.mediaIds[0]);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(ready).toHaveBeenLastCalledWith(config.mediaIds[0], null);

    loader.dispose();

    fetcher.mockResolvedValue(new Response(new Uint8Array(3_750_001), { headers: { 'Content-Type': 'image/webp' } }));
    const next = nativeImageLoader(config, ready);
    next.request(config.mediaIds[1]);
    await vi.waitFor(() => expect(ready).toHaveBeenLastCalledWith(config.mediaIds[1], null));
    next.dispose();
  });
});
