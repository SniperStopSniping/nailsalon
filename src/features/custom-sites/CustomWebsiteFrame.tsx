'use client';

import { useEffect, useRef, useState } from 'react';

import type { CustomSitePayload } from './contracts';

export function CustomWebsiteFrame({ payload, rendererOrigin, bookingPath, managePath }: { payload: CustomSitePayload; rendererOrigin: string; bookingPath?: string; managePath?: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const channelRef = useRef<string | null>(null);
  const rendered = useRef(false);
  const [height, setHeight] = useState(1000);
  const [status, setStatus] = useState('Loading your custom website…');
  const bookingHref = !payload.data.preview && bookingPath?.startsWith('/') && !bookingPath.startsWith('//')
    ? `${bookingPath}${bookingPath.includes('?') ? '&' : '?'}nativeBooking=1`
    : null;
  useEffect(() => {
    const channel = channelRef.current ?? crypto.randomUUID();
    channelRef.current = channel;
    const slow = window.setTimeout(() => {
      if (!rendered.current) {
        setStatus('The website is taking longer to load.');
      }
    }, 15000);
    function message(event: MessageEvent) {
      // The sandbox deliberately has an opaque origin. Bind messages to this
      // exact frame and channel; no other salon frame can speak for it.
      if (event.source !== frame.current?.contentWindow || event.origin !== 'null') {
        return;
      }
      if (event.data?.type === 'renderer-ready') {
        // Opaque origins cannot be named as targetOrigin. The destination is
        // exclusively the server-validated static renderer's WindowProxy.
        frame.current?.contentWindow?.postMessage({ type: 'initialize', channel, payload }, '*');
        return;
      }
      if (event.data?.channel !== channel) {
        return;
      }
      switch (event.data.type) {
        case 'size':
          if (Number.isFinite(event.data.height)) {
            setHeight(Math.max(500, Math.min(16000, event.data.height)));
          }
          break;
        case 'rendered': window.clearTimeout(slow);
          rendered.current = true;
          setStatus('');
          break;
        case 'interaction-stopped': setStatus('An animation stopped safely. The website and booking buttons still work.');
          break;
        case 'preview-booking': setStatus('This is your private preview. Customers can book after you approve and publish.');
          break;
        case 'book': {
          if (payload.data.preview || !bookingPath || !bookingPath.startsWith('/') || bookingPath.startsWith('//')) {
            return;
          }
          const id = event.data.serviceId;
          if (typeof id !== 'string' || (id && !payload.data.services.some(s => s.id === id))) {
            return;
          }
          const url = new URL(bookingPath, window.location.origin);
          url.searchParams.set('nativeBooking', '1');
          if (id) {
            url.searchParams.set('baseServiceId', id);
          }
          window.location.assign(url.pathname + url.search);
          break;
        }
        case 'manage':
          if (!payload.data.preview && managePath?.startsWith('/') && !managePath.startsWith('//')) {
            window.location.assign(managePath);
          }
          break;
      }
    }
    window.addEventListener('message', message);
    return () => {
      window.clearTimeout(slow);
      window.removeEventListener('message', message);
    };
  }, [payload, rendererOrigin, bookingPath, managePath]);
  return (
    <div>
      {status && <p role="status" className="p-3 text-center text-sm">{status}</p>}
      {/* Separate site AND opaque origin: no cookies, persistent storage or cross-salon channels. */}
      <iframe ref={frame} title={payload.source.title} src={`${rendererOrigin}/renderer`} sandbox="allow-scripts" referrerPolicy="no-referrer" style={{ width: '100%', height, border: 0, display: 'block' }} />
      {bookingHref && <p className="p-3 text-center text-sm"><a className="underline" href={bookingHref}>Open booking menu</a></p>}
    </div>
  );
}
