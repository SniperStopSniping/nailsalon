// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { compileCanvaDesign } from './canva';
import type { CustomSitePayload } from './contracts';
import { CustomWebsiteFrame } from './CustomWebsiteFrame';

const payload: CustomSitePayload = {
  source: { title: 'Custom site', html: '', css: '', javascript: '', analysis: '', limitations: [] },
  images: {},
  data: { business: { name: 'Synthetic', city: 'Toronto', address: null, bio: '', hours: {} }, services: [], currency: 'CAD', preview: false },
};

afterEach(cleanup);

describe('custom website trusted parent bridge', () => {
  it('labels stale Canva artwork and shows the current proposed booking values separately', () => {
    const source = compileCanvaDesign({ version: 1, pages: [{ assetId: 'a0000000-0000-4000-8000-000000000001', width: 300, height: 600, alt: 'Original export' }], areas: [], visibleText: 'Gel $65', notes: [], dataFingerprint: 'a'.repeat(64), ownerReviewed: true });
    const input: CustomSitePayload = { ...payload, source, canvaFactsChanged: true, data: { ...payload.data, preview: true, services: [{ id: 'draft-gel', name: 'Gel', description: null, priceCents: 7200, priceLabel: '$72.00', durationMinutes: 60 }] } };
    render(<CustomWebsiteFrame payload={input} rendererOrigin="https://renderer.example" />);

    expect(screen.getByText('Your booking details changed.')).toBeVisible();

    fireEvent.click(screen.getByText('Current draft booking details'));

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
