'use client';

import '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/components/custom-design.css';

import type { PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import { HotspotOverlay } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/components/HotspotOverlay';
import type { CustomDesignResizeHandle } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/geometry';
import { moveNormalizedRect, resizeNormalizedRect } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/geometry';
import type { CanvaArea, CanvaDesign } from './canva';
import { canvaDesignSchema, compileCanvaDesign } from './canva';
import type { CustomSitePayload, CustomSiteSource } from './contracts';

function AreaPage({ page, index, areas, selected, endpoint, disabled, onSelect, onChange }: {
  page: CanvaDesign['pages'][number];
  index: number;
  areas: CanvaArea[];
  selected: string;
  endpoint: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, geometry: CanvaArea['geometry']) => void;
}) {
  const image = useRef<HTMLImageElement>(null);
  const cleanup = useRef<() => void>(() => {});
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (image.current) {
        setSize({ width: image.current.clientWidth, height: image.current.clientHeight });
      }
    });
    if (image.current) {
      observer.observe(image.current);
    }
    return () => {
      observer.disconnect();
      cleanup.current();
    };
  }, []);
  function adjust(id: string, delta: { x: number; y: number }, handle?: CustomDesignResizeHandle) {
    const area = areas.find(area => area.id === id);
    if (area && !disabled) {
      onChange(id, handle ? resizeNormalizedRect(area.geometry, handle, delta, size).rect : moveNormalizedRect(area.geometry, delta, size).rect);
    }
  }
  function drag(id: string, event: ReactPointerEvent<HTMLButtonElement>, handle?: CustomDesignResizeHandle) {
    if (disabled) {
      return;
    }
    event.preventDefault();
    onSelect(id);
    cleanup.current();
    const area = areas.find(area => area.id === id)!;
    const start = { x: event.clientX, y: event.clientY };
    const move = (event: PointerEvent) => {
      const delta = { x: event.clientX - start.x, y: event.clientY - start.y };
      onChange(id, handle ? resizeNormalizedRect(area.geometry, handle, delta, size).rect : moveNormalizedRect(area.geometry, delta, size).rect);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    cleanup.current = end;
  }
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: page.width, margin: '12px auto' }}>
      {/* The editor displays the same immutable, authorized asset as publication. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={image}
        src={`${endpoint}&asset=${page.assetId}`}
        alt={`Page ${index + 1} of your Canva design`}
        style={{ display: 'block', width: '100%', height: 'auto' }}
        onLoad={() => {
          setLoaded(true);
          setSize({ width: image.current!.clientWidth, height: image.current!.clientHeight });
        }}
        onError={() => setLoaded(false)}
      />
      {loaded && !disabled && <HotspotOverlay areas={areas.filter(area => area.page === index).map((area, semanticOrder) => ({ ...area, semanticOrder, accessibleLabel: area.label, labelConfirmed: true, action: { type: 'start_booking' }, validationStatus: 'valid', reviewStatus: 'needs_review' }))} renderedWidth={size.width} renderedHeight={size.height} selectedAreaId={selected} onSelect={onSelect} onKeyboardMove={(id, delta) => adjust(id, delta)} onKeyboardResize={(id, handle, delta) => adjust(id, delta, handle)} onMoveStart={(id, event) => drag(id, event)} onResizeStart={(id, handle, event) => drag(id, event, handle)} />}
    </div>
  );
}

export function CanvaAreaEditor({ payload, endpoint, disabled, onSave, onReview }: { payload: CustomSitePayload; endpoint: string; disabled: boolean; onSave: (source: CustomSiteSource) => void; onReview: () => void }) {
  const [design, setDesign] = useState(payload.source.canva!);
  const [selected, setSelected] = useState(design.areas[0]?.id ?? '');
  const [dirty, setDirty] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const area = design.areas.find(area => area.id === selected);
  function change(areas: CanvaArea[]) {
    setDesign({ ...design, areas, ownerReviewed: false });
    setDirty(true);
    setChecked(false);
    setError('');
  }
  function update(values: Partial<CanvaArea>) {
    change(design.areas.map(item => item.id === selected ? { ...item, ...values } : item));
  }
  return (
    <details className="studio-step">
      <summary>Check Canva links & artwork</summary>
      <p>Your artwork stays unchanged. Select a highlighted area to change its link. Drag it, use the arrow keys, or enter its position below. Changes to printed text or photos are made in Canva, then uploaded again.</p>
      {design.pages.map((page, index) => <AreaPage key={page.assetId} page={page} index={index} areas={design.areas} endpoint={endpoint} disabled={disabled} selected={selected} onSelect={setSelected} onChange={(id, geometry) => change(design.areas.map(item => item.id === id ? { ...item, geometry } : item))} />)}
      <fieldset disabled={disabled}>
        <legend>Links in your design</legend>
        <label>
          Choose an area
          <select value={selected} onChange={event => setSelected(event.target.value)}>
            <option value="">Choose…</option>
            {design.areas.map(area => <option key={area.id} value={area.id}>{area.label}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            const id = `link-${crypto.randomUUID().slice(0, 8)}`;
            change([...design.areas, { id, page: 0, label: 'Book an appointment', geometry: { x: 10, y: 10, width: 40, height: 5 }, action: { type: 'book' } }]);
            setSelected(id);
          }}
        >
          Add clickable area
        </button>
        {area && (
          <>
            <label>
              Accessible label
              <input value={area.label} maxLength={200} onChange={event => update({ label: event.target.value })} />
            </label>
            <label>
              Page
              <select value={area.page} onChange={event => update({ page: Number(event.target.value) })}>{design.pages.map((_, index) => <option key={design.pages[index]!.assetId} value={index}>{index + 1}</option>)}</select>
            </label>
            <label>
              Opens
              <select
                value={area.action.type === 'service' ? `service:${area.action.serviceKey}` : area.action.type}
                onChange={(event) => {
                  const value = event.target.value;
                  update({ action: value.startsWith('service:') ? { type: 'service', serviceKey: value.slice(8) } : value === 'website' ? { type: 'website', url: 'https://' } : { type: value as 'book' | 'manage' | 'instagram' | 'email' | 'phone' } });
                }}
              >
                <option value="book">Luster booking menu</option>
                <option value="manage">Manage an existing booking</option>
                <option value="instagram">My Instagram</option>
                <option value="email">My email</option>
                <option value="phone">Call my number</option>
                <option value="website">Website link</option>
                {Object.entries(payload.serviceKeys ?? {}).map(([key, id]) => (
                  <option key={key} value={`service:${key}`}>
                    Book
                    {payload.data.services.find(service => service.id === id)?.name}
                  </option>
                ))}
                {area.action.type === 'service' && !payload.serviceKeys?.[area.action.serviceKey] && <option value={`service:${area.action.serviceKey}`}>Service changed · choose again</option>}
              </select>
            </label>
            {area.action.type === 'website' && (
              <label>
                HTTPS website address
                <input value={area.action.url} onChange={event => update({ action: { type: 'website', url: event.target.value } })} />
              </label>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
              {(['x', 'y', 'width', 'height'] as const).map(key => (
                <label key={key}>
                  {({ x: 'Left', y: 'Top', width: 'Width', height: 'Height' })[key]}
                  {' '}
                  (%)
                  <input type="number" min={0} max={100} step={0.1} value={area.geometry[key]} onChange={event => update({ geometry: { ...area.geometry, [key]: Number(event.target.value) } })} />
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                change(design.areas.filter(item => item.id !== selected));
                setSelected('');
              }}
            >
              Remove this area
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <button
          type="button"
          disabled={!dirty}
          onClick={() => {
            const parsed = canvaDesignSchema.safeParse(design);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Check the clickable areas.');
              return;
            }
            onSave(compileCanvaDesign(parsed.data, payload.data.details));
          }}
        >
          Save clickable areas
        </button>
      </fieldset>
      <p>The text inside your image cannot update automatically when prices or hours change. Check the artwork against Details before sharing or publishing. A later business change will show Luster’s current booking page until you review an updated export.</p>
      {design.ownerReviewed && !payload.canvaReviewRequired && !dirty
        ? <p role="status">Artwork checked. Review and publish when you’re ready.</p>
        : (
            <fieldset disabled={disabled || dirty}>
              <legend>Check the artwork</legend>
              <label>
                <input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />
                I checked all printed prices, times, policies, contact details and addresses against my current settings. Everything shown is correct and intended to be public.
              </label>
              <button type="button" disabled={!checked} onClick={onReview}>Artwork is correct</button>
            </fieldset>
          )}
    </details>
  );
}
