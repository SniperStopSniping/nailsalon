import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertNativePhotoRendererReady } from './native-renderer.server';

const origin = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('./payload.server', () => ({ customSiteRendererOrigin: origin }));

afterEach(() => vi.unstubAllGlobals());

describe('photo publication renderer prerequisite', () => {
  it('checks only the verified renderer origin with bounded HEAD and no redirects or credentials', async () => {
    origin.mockReturnValue('https://isolated.example');
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { headers: { 'X-Luster-Renderer-Capabilities': 'native-images-v1' } }));
    vi.stubGlobal('fetch', fetcher);
    await assertNativePhotoRendererReady();

    expect(fetcher).toHaveBeenCalledWith('https://isolated.example/renderer', expect.objectContaining({ method: 'HEAD', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) }));
    expect(fetcher.mock.calls[0]![1]).not.toHaveProperty('headers');
    expect(fetcher.mock.calls[0]![1]).not.toHaveProperty('credentials');
  });

  it('blocks publication on missing isolation, old renderer capability or an outage', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal('fetch', fetcher);
    origin.mockReturnValue(null);

    await expect(assertNativePhotoRendererReady()).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(fetcher).not.toHaveBeenCalled();

    origin.mockReturnValue('https://isolated.example');

    await expect(assertNativePhotoRendererReady()).rejects.toMatchObject({ code: 'NOT_READY' });

    fetcher.mockRejectedValue(new Error('Private provider detail'));

    await expect(assertNativePhotoRendererReady()).rejects.toMatchObject({ code: 'NOT_READY' });
  });
});
