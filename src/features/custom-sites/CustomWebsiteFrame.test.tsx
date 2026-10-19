// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { compileCanvaDesign } from './canva';
import type { CustomSitePayload } from './contracts';
import { CustomWebsiteFrame } from './CustomWebsiteFrame';
import * as nativeLoader from './native-image-loader';

const payload: CustomSitePayload = {
  source: { title: 'Custom site', html: '', css: '', javascript: '', analysis: '', limitations: [] },
  images: {},
  data: { business: { name: 'Synthetic', city: 'Toronto', address: null, bio: '', hours: {} }, services: [], currency: 'CAD', preview: false },
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('custom website trusted parent bridge', () => {
  it('does not start the server-rendered frame before hydration installs its bridge', () => {
    const markup = renderToString(<CustomWebsiteFrame payload={payload} rendererOrigin="https://renderer.example" />);
    const serverContainer = document.createElement('div');
    serverContainer.innerHTML = markup;
    const serverFrame = serverContainer.querySelector('iframe')!;

    expect(serverFrame).not.toHaveAttribute('src');
    expect(serverFrame).toHaveAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');

    render(<CustomWebsiteFrame payload={payload} rendererOrigin="https://renderer.example" />);

    expect(screen.getByTitle('Custom site')).toHaveAttribute('src', 'https://renderer.example/renderer');
  });

  it('loads a changed draft into a fresh session and rejects the previous session acknowledgement', () => {
    const { rerender } = render(<CustomWebsiteFrame payload={payload} rendererOrigin="https://renderer.example" />);
    const frame = screen.getByTitle('Custom site') as HTMLIFrameElement;
    const firstSend = vi.spyOn(frame.contentWindow!, 'postMessage');
    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'renderer-ready' } })));
    const oldChannel = firstSend.mock.calls[0]![0].channel;
    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'rendered', channel: oldChannel } })));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    const next = { ...payload, source: { ...payload.source, title: 'New saved design' }, data: { ...payload.data, preview: true } };
    rerender(<CustomWebsiteFrame payload={next} rendererOrigin="https://renderer.example" />);
    const currentFrame = screen.getByTitle('New saved design') as HTMLIFrameElement;
    act(() => window.dispatchEvent(new MessageEvent('message', { source: currentFrame.contentWindow, origin: 'null', data: { type: 'rendered', channel: oldChannel } })));

    expect(screen.getByRole('status')).toHaveTextContent('Loading your custom website');

    const nextSend = vi.spyOn(currentFrame.contentWindow!, 'postMessage');
    act(() => window.dispatchEvent(new MessageEvent('message', { source: currentFrame.contentWindow, origin: 'null', data: { type: 'renderer-ready' } })));
    const initialization = nextSend.mock.calls[0]![0];

    expect(initialization.channel).not.toBe(oldChannel);
    expect(initialization.payload).toEqual(next);
    expect(initialization.payload.data.preview).toBe(true);

    act(() => window.dispatchEvent(new MessageEvent('message', { source: currentFrame.contentWindow, origin: 'null', data: { type: 'rendered', channel: initialization.channel } })));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows actual photo loading, reports failure and offers a safe preview reload', () => {
    vi.spyOn(nativeLoader, 'nativeImageLoader').mockReturnValue({ request: vi.fn(), dispose: vi.fn() });
    const media = { artifactId: 'a0000000-0000-4000-8000-000000000001', mediaIds: ['b0000000-0000-4000-8000-000000000001'] };
    render(<CustomWebsiteFrame payload={{ ...payload, data: { ...payload.data, preview: true }, nativeMedia: media }} rendererOrigin="https://renderer.example" />);
    const frame = screen.getByTitle('Custom site') as HTMLIFrameElement;
    const send = vi.spyOn(frame.contentWindow!, 'postMessage');
    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'renderer-ready', capabilities: ['native-images-v1'] } })));
    const channel = send.mock.calls[0]![0].channel;
    const ready = vi.mocked(nativeLoader.nativeImageLoader).mock.calls[0]![1];
    const activity = vi.mocked(nativeLoader.nativeImageLoader).mock.calls[0]![2]!;
    act(() => {
      activity(1);
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'rendered', channel } }));
    });

    expect(screen.getByRole('status')).toHaveTextContent('Loading photos');

    act(() => activity(0));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => ready(media.mediaIds[0]!, null));

    expect(screen.getByRole('status')).toHaveTextContent('A photo could not be loaded.');
    expect(screen.getByRole('button', { name: 'Reload preview' })).toBeEnabled();
    expect(screen.queryByRole('link', { name: 'Open booking menu' })).not.toBeInTheDocument();
    expect(send).toHaveBeenLastCalledWith({ type: 'native-image', channel, mediaId: media.mediaIds[0], dataUrl: null }, '*');
  });

  it('keeps photo authorization out of the isolated frame and requires a compatible renderer', () => {
    const photos = { request: vi.fn(), dispose: vi.fn() };
    vi.spyOn(nativeLoader, 'nativeImageLoader').mockReturnValue(photos);
    const nativeMedia = { artifactId: 'a0000000-0000-4000-8000-000000000001', mediaIds: ['b0000000-0000-4000-8000-000000000001'], shareToken: 'secret-read-only-share-token' };
    const { unmount } = render(<CustomWebsiteFrame payload={{ ...payload, nativeMedia }} rendererOrigin="https://renderer.example" />);
    const frame = screen.getByTitle('Custom site') as HTMLIFrameElement;
    const send = vi.spyOn(frame.contentWindow!, 'postMessage');
    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'renderer-ready' } })));

    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('photos are temporarily unavailable');

    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'renderer-ready', capabilities: { includes: 'native-images-v1' } } })));

    expect(send).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'renderer-ready', capabilities: ['native-images-v1'] } })));
    const initialization = send.mock.calls[0]![0];

    expect(initialization.payload).not.toHaveProperty('nativeMedia');
    expect(JSON.stringify(initialization)).not.toContain(nativeMedia.shareToken);
    expect(nativeLoader.nativeImageLoader).toHaveBeenCalledWith(nativeMedia, expect.any(Function), expect.any(Function));

    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'native-image-request', channel: 'wrong', mediaId: nativeMedia.mediaIds[0] } })));

    expect(photos.request).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'native-image-request', channel: initialization.channel, mediaId: nativeMedia.mediaIds[0] } })));

    expect(photos.request).toHaveBeenCalledWith(nativeMedia.mediaIds[0]);

    unmount();

    expect(photos.dispose).toHaveBeenCalledOnce();
  });

  it('labels stale Canva artwork and shows the current proposed booking values separately', () => {
    const source = compileCanvaDesign({ version: 1, pages: [{ assetId: 'a0000000-0000-4000-8000-000000000001', width: 300, height: 600, alt: 'Original export' }], areas: [], visibleText: 'Gel $65', notes: [], dataFingerprint: 'a'.repeat(64), ownerReviewed: true });
    const input: CustomSitePayload = { ...payload, source, canvaFactsChanged: true, data: { ...payload.data, preview: true, services: [{ id: 'draft-gel', name: 'Gel', description: null, priceCents: 7200, priceLabel: '$72.00', durationMinutes: 60 }] } };
    render(<CustomWebsiteFrame payload={input} rendererOrigin="https://renderer.example" />);

    expect(screen.getByText('Your website details changed.')).toBeVisible();

    fireEvent.click(screen.getByText('Booking details in this preview'));

    expect(screen.getByText('Gel · $72.00 · 60 min')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open booking menu' })).not.toBeInTheDocument();
  });

  it('uses an opaque sandbox and exposes the original booking fallback', () => {
    render(<CustomWebsiteFrame payload={payload} rendererOrigin="https://renderer.example" bookingPath="/salon/book/service" />);

    expect(screen.getByTitle('Custom site')).toHaveAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
    expect(screen.getByRole('link', { name: 'Open booking menu' })).toHaveAttribute('href', '/salon/book/service?nativeBooking=1');
  });

  it('never exposes navigation from a draft or an untrusted booking destination', () => {
    const { rerender } = render(<CustomWebsiteFrame payload={{ ...payload, data: { ...payload.data, preview: true } }} rendererOrigin="https://renderer.example" bookingPath="/salon/book/service" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    rerender(<CustomWebsiteFrame payload={payload} rendererOrigin="https://renderer.example" bookingPath="//attacker.example" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('rejects messages from another frame and messages missing the channel', () => {
    render(<CustomWebsiteFrame payload={payload} rendererOrigin="https://renderer.example" />);
    const frame = screen.getByTitle('Custom site') as HTMLIFrameElement;
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { source: window, origin: 'null', data: { type: 'rendered' } }));
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'rendered', channel: 'forged-channel' } }));
    });

    expect(screen.getByRole('status')).toHaveTextContent('Loading your custom website');
  });
});

describe('custom website browsing viewport', () => {
  it('does not grow a viewport-height hero in response to document height', () => {
    const { container } = render(<CustomWebsiteFrame payload={payload} rendererOrigin="https://renderer.example.net" />);
    const frame = container.querySelector('iframe')!;
    const initialHeight = frame.style.height;
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'renderer-ready' } }));
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'size', height: 16000 } }));
    });

    expect(frame.style.height).toBe(initialHeight);
    expect(Number.parseInt(initialHeight)).toBeLessThanOrEqual(window.innerHeight);
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
  });
});

it('keeps booking disabled in private previews without telling a published owner to publish again', () => {
  const input = { ...payload, data: { ...payload.data, preview: true } };
  render(<CustomWebsiteFrame payload={input} rendererOrigin="https://renderer.example" bookingPath="/salon/book/service" />);
  const frame = screen.getByTitle('Custom site') as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, 'postMessage');
  act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'renderer-ready' } })));
  const initialization = send.mock.calls[0]![0];

  expect(initialization.payload.data.preview).toBe(true);

  act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'preview-booking', channel: initialization.channel } })));

  expect(screen.getByRole('status')).toHaveTextContent('Booking is disabled in this private preview.');
  expect(screen.queryByRole('link', { name: 'Open booking menu' })).not.toBeInTheDocument();

  send.mockRestore();
});

it('recovers a stalled website in a new opaque frame without accepting the old channel', () => {
  vi.useFakeTimers();
  render(<CustomWebsiteFrame payload={payload} rendererOrigin="https://renderer.example" bookingPath="/salon/book/service" />);
  const oldFrame = screen.getByTitle('Custom site') as HTMLIFrameElement;
  const oldWindow = oldFrame.contentWindow!;
  const oldSend = vi.spyOn(oldWindow, 'postMessage');
  act(() => window.dispatchEvent(new MessageEvent('message', { source: oldWindow, origin: 'null', data: { type: 'renderer-ready' } })));
  const oldChannel = oldSend.mock.calls[0]![0].channel;
  act(() => vi.advanceTimersByTime(15000));

  expect(screen.getByRole('status')).toHaveTextContent('taking longer to load');

  fireEvent.click(screen.getByRole('button', { name: 'Reload website' }));
  const freshFrame = screen.getByTitle('Custom site') as HTMLIFrameElement;

  expect(freshFrame).not.toBe(oldFrame);
  expect(freshFrame).toHaveAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
  expect(freshFrame).toHaveAttribute('src', 'https://renderer.example/renderer');
  expect(screen.getByRole('link', { name: 'Open booking menu' })).toHaveAttribute('href', '/salon/book/service?nativeBooking=1');

  act(() => window.dispatchEvent(new MessageEvent('message', { source: oldWindow, origin: 'null', data: { type: 'rendered', channel: oldChannel } })));

  expect(screen.getByRole('status')).toHaveTextContent('Loading your custom website');

  const freshSend = vi.spyOn(freshFrame.contentWindow!, 'postMessage');
  act(() => window.dispatchEvent(new MessageEvent('message', { source: freshFrame.contentWindow, origin: 'null', data: { type: 'renderer-ready' } })));
  const initialization = freshSend.mock.calls[0]![0];

  expect(initialization.channel).not.toBe(oldChannel);
  expect(initialization.payload).toStrictEqual(payload);

  act(() => window.dispatchEvent(new MessageEvent('message', { source: freshFrame.contentWindow, origin: 'null', data: { type: 'rendered', channel: initialization.channel } })));

  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reload website' })).not.toBeInTheDocument();
});

it('keeps a recovered private preview private and unable to navigate to live booking', () => {
  vi.useFakeTimers();
  const input = { ...payload, data: { ...payload.data, preview: true } };
  render(<CustomWebsiteFrame payload={input} rendererOrigin="https://renderer.example" bookingPath="/salon/book/service" />);
  act(() => vi.advanceTimersByTime(15000));
  fireEvent.click(screen.getByRole('button', { name: 'Reload preview' }));
  const frame = screen.getByTitle('Custom site') as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, 'postMessage');
  act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'renderer-ready' } })));
  const initialization = send.mock.calls[0]![0];

  expect(initialization.payload.data.preview).toBe(true);
  expect(screen.queryByRole('link', { name: 'Open booking menu' })).not.toBeInTheDocument();

  act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'preview-booking', channel: initialization.channel } })));

  expect(screen.getByRole('status')).toHaveTextContent('Booking is disabled in this private preview.');
  expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
});
