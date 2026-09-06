'use client';

import { ArrowLeft, Monitor, Smartphone, Tablet } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * AG-hub-publish-08 — owner chrome around the private draft preview.
 *
 * The preview renders the REAL customer booking flow, so it used to be
 * indistinguishable from the public site except for a status strip: no way
 * back to the editor other than the browser's own Back, and no way to see the
 * draft at another width without resizing the window.
 *
 * Two rules shape this component:
 *
 *  1. The customer markup is never rewritten. `children` is the untouched
 *     server render of `renderBookServicePage`, mounted at the top level of
 *     the document exactly as before whenever the selected width matches the
 *     owner's own viewport (which is the initial state, and the only state an
 *     automated visit ever sees).
 *  2. Another width is honest only inside a real viewport. Tailwind's
 *     breakpoints answer to the window, not to an ancestor's width, so simply
 *     narrowing a wrapper would show desktop classes in a phone-shaped box.
 *     A non-matching width therefore mounts the same route in a same-origin
 *     iframe sized to that device and scaled to fit, and the direct render is
 *     hidden (not unmounted) beneath it.
 */

const DEVICES = [
  { icon: Smartphone, id: 'phone', label: 'Phone', width: 390 },
  { icon: Tablet, id: 'tablet', label: 'Tablet', width: 834 },
  { icon: Monitor, id: 'desktop', label: 'Desktop', width: 1280 },
] as const;

type DeviceId = (typeof DEVICES)[number]['id'];

function deviceForWidth(width: number): DeviceId {
  if (width < 768) {
    return 'phone';
  }
  return width < 1180 ? 'tablet' : 'desktop';
}

export function OwnerDraftPreviewChrome({
  children,
  editorUrl,
  frameSrc,
}: {
  children: React.ReactNode;
  /** Back to the Booking Page hub, with the fragment that restores focus. */
  editorUrl: string;
  /** This same route with owner chrome suppressed, for the scaled frames. */
  frameSrc: string;
}) {
  // `null` until the browser reports its own width: the first paint (and every
  // server render) is the plain direct render, never an iframe.
  const [viewportDevice, setViewportDevice] = useState<DeviceId | null>(null);
  const [device, setDevice] = useState<DeviceId | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ height: 0, width: 0 });

  useEffect(() => {
    const sync = () => {
      const next = deviceForWidth(window.innerWidth);
      setViewportDevice(next);
      setDevice(current => current ?? next);
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  const selected = device ?? viewportDevice;
  const framed = selected !== null && viewportDevice !== null && selected !== viewportDevice;

  useEffect(() => {
    const element = stageRef.current;
    if (!element || !framed || typeof ResizeObserver === 'undefined') {
      return;
    }
    const measure = () => setStage({ height: element.clientHeight, width: element.clientWidth });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [framed]);

  const frameWidth = DEVICES.find(entry => entry.id === selected)?.width ?? 390;
  const scale = stage.width > 0 ? Math.min(1, stage.width / frameWidth) : 1;

  return (
    <div>
      <div
        className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 bg-white px-3 py-2"
        data-testid="owner-draft-preview-bar"
      >
        <a
          className="inline-flex min-h-11 items-center gap-2 rounded-full px-2 text-sm font-semibold text-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700"
          data-testid="owner-draft-preview-back"
          href={editorUrl}
        >
          <ArrowLeft aria-hidden="true" size={18} />
          Back to editor
        </a>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Draft preview</p>
        <div
          aria-label="Preview width"
          className="flex rounded-full border border-stone-200 bg-stone-50 p-1"
          role="group"
        >
          {DEVICES.map(({ icon: Icon, id, label }) => (
            <button
              aria-pressed={selected === id}
              className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700 ${
                selected === id ? 'bg-rose-800 text-white' : 'text-stone-600'
              }`}
              data-testid={`owner-draft-preview-device-${id}`}
              key={id}
              onClick={() => setDevice(id)}
              type="button"
            >
              <Icon aria-hidden="true" size={16} />
              <span className="hidden min-[380px]:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {framed && (
        <div
          className="flex justify-center overflow-hidden bg-stone-100 p-3"
          data-testid="owner-draft-preview-stage"
          ref={stageRef}
          style={{ height: 'calc(100dvh - 3.75rem)' }}
        >
          <div style={{ height: stage.height * scale, width: frameWidth * scale }}>
            {/*
              `allow-scripts` is required, not optional: the booking page's
              server render is a Suspense shell, so an unhydrated frame shows
              a spinner and nothing else — verified in the browser before this
              was widened. The frame is this same first-party admin route on
              this same origin, showing the same draft the owner is already
              looking at directly, so it is exactly as interactive as the
              render it stands in for and no more.
            */}
            <iframe
              className="block border-0 bg-white shadow-sm"
              data-testid="owner-draft-preview-frame"
              // eslint-disable-next-line react-dom/no-unsafe-iframe-sandbox -- first-party same-origin admin route; see the note above
              sandbox="allow-same-origin allow-scripts"
              src={frameSrc}
              style={{
                height: stage.height > 0 ? stage.height / scale : '100%',
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                width: frameWidth,
              }}
              title="Draft preview at another width"
            />
          </div>
        </div>
      )}

      <div data-testid="owner-draft-preview-content" hidden={framed}>{children}</div>
    </div>
  );
}
