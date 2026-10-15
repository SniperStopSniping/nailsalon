// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { CustomSitePayload } from './contracts';
import { CustomWebsiteFrame } from './CustomWebsiteFrame';

const payload: CustomSitePayload = {
  source: { title: 'Custom site', html: '', css: '', javascript: '', analysis: '', limitations: [] },
  images: {},
  data: { business: { name: 'Synthetic', city: 'Toronto', address: null, bio: '', hours: {} }, services: [], currency: 'CAD', preview: false },
};

afterEach(cleanup);

describe('custom website trusted parent bridge', () => {
  it('uses an opaque sandbox and exposes the original booking fallback', () => {
    render(<CustomWebsiteFrame payload={payload} rendererOrigin="https://renderer.example" bookingPath="/salon/book/service" />);

    expect(screen.getByTitle('Custom site')).toHaveAttribute('sandbox', 'allow-scripts');
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
