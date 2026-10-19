'use client';

import { useEffect, useRef, useState } from 'react';

import type { CustomSitePayload } from './contracts';
import { nativeImageLoader } from './native-image-loader';

export function CustomWebsiteFrame({ payload, rendererOrigin, bookingPath, managePath }: { payload: CustomSitePayload; rendererOrigin: string; bookingPath?: string; managePath?: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const channelRef = useRef<string | null>(null);
  const rendered = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [height, setHeight] = useState(800);
  const [status, setStatus] = useState('Loading your custom website…');
  const bookingHref = !payload.data.preview && bookingPath?.startsWith('/') && !bookingPath.startsWith('//')
    ? `${bookingPath}${bookingPath.includes('?') ? '&' : '?'}nativeBooking=1`
    : null;
  useEffect(() => {
    // Keep the browsing viewport independent of document content. Expanding an
    // iframe to scrollHeight makes 100vh heroes recursively grow on every resize.
    const resize = () => setHeight(Math.max(500, window.innerHeight - 48));
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    const channel = channelRef.current ?? crypto.randomUUID();
    channelRef.current = channel;
    const { nativeMedia, ...rendererPayload } = payload;
    let photoFailed = false;
    let pendingPhotos = 0;
    const photos = nativeMedia
      ? nativeImageLoader(nativeMedia, (mediaId, dataUrl) => {
        if (!dataUrl) {
          photoFailed = true;
          setStatus('A photo could not be loaded.');
        }
        frame.current?.contentWindow?.postMessage({ type: 'native-image', channel, mediaId, dataUrl }, '*');
      }, (count) => {
        pendingPhotos = count;
        if (rendered.current && !photoFailed) {
          setStatus(count ? 'Loading photos…' : '');
        }
      })
      : null;
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
        if (nativeMedia && (!Array.isArray(event.data.capabilities) || !event.data.capabilities.includes('native-images-v1'))) {
          setStatus('Website photos are temporarily unavailable.');
          return;
        }
        // Opaque origins cannot be named as targetOrigin. The destination is
        // exclusively the server-validated static renderer's WindowProxy.
        frame.current?.contentWindow?.postMessage({ type: 'initialize', channel, payload: rendererPayload }, '*');
        return;
      }
      if (event.data?.channel !== channel) {
        return;
      }
      switch (event.data.type) {
        case 'rendered': window.clearTimeout(slow);
          rendered.current = true;
          setStatus(photoFailed ? 'A photo could not be loaded.' : pendingPhotos ? 'Loading photos…' : '');
          break;
        case 'native-image-request': photos?.request(event.data.mediaId);
          break;
        case 'native-image-error':
          if (nativeMedia?.mediaIds.includes(event.data.mediaId)) {
            photoFailed = true;
            setStatus('A photo could not be loaded.');
          }
          break;
        case 'interaction-stopped': setStatus('An animation stopped safely. The website and booking buttons still work.');
          break;
        case 'preview-booking': setStatus('Booking is disabled in this private preview.');
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
      photos?.dispose();
      window.removeEventListener('message', message);
    };
  }, [payload, rendererOrigin, bookingPath, managePath, attempt]);
  function reloadWebsite() {
    rendered.current = false;
    channelRef.current = null;
    setStatus('Loading your custom website…');
    setAttempt(value => value + 1);
  }
  return (
    <div>
      {status && (
        <div className="p-3 text-center text-sm">
          <p role="status">{status}</p>
          {['The website is taking longer to load.', 'A photo could not be loaded.', 'Website photos are temporarily unavailable.'].includes(status) && (
            <button type="button" className="mt-2 min-h-11 rounded-lg border px-4 py-2" onClick={reloadWebsite}>
              {payload.data.preview ? 'Reload preview' : 'Reload website'}
            </button>
          )}
        </div>
      )}
      {payload.data.preview && payload.source.canva && (
        <div className="p-3 text-sm">
          {payload.canvaFactsChanged && (
            <p role="status">
              <strong>Your booking details changed.</strong>
              {' '}
              This Canva image may still show earlier prices, hours or contact details. Update the artwork and check its links.
            </p>
          )}
          <details>
            <summary>Booking details in this preview</summary>
            <p>{payload.data.business.hoursLabel}</p>
            <ul>{payload.data.services.map(service => <li key={service.id}>{`${service.name} · ${service.priceLabel} · ${service.durationMinutes} min`}</li>)}</ul>
          </details>
        </div>
      )}
      {/* Separate site AND opaque origin: no cookies, persistent storage or cross-salon channels. */}
      <iframe key={attempt} ref={frame} title={payload.source.title} src={`${rendererOrigin}/renderer`} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" style={{ width: '100%', height, border: 0, display: 'block' }} />
      {bookingHref && <p className="p-3 text-center text-sm"><a className="underline" href={bookingHref}>Open booking menu</a></p>}
    </div>
  );
}
