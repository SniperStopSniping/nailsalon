'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { APPOINTMENT_DATA_CHANGED_EVENT } from '@/libs/dashboardEvents';
import { getDateKeyInTimeZone, getTimeKeyInTimeZone } from '@/libs/timeZone';

type Block = { id: string; technicianId: string; startsAt: string; endsAt: string; label: string | null; updatedAt: string };
type Props = { salonSlug: string; date: string; technicians: Array<{ id: string; name: string }>; technicianId?: string; onClose: () => void };
const fieldClass = 'min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-base';
const buttonClass = 'min-h-11 rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700';

/** One editor for exact intraday blocks, distinct from date-based Days Off. */
export function CalendarBlockTime({ salonSlug, date, technicians, technicianId, onClose }: Props) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Block | null>(null);
  const [selectedTechnician, setSelectedTechnician] = useState(technicianId && technicianId !== 'all' ? technicianId : technicians[0]?.id ?? '');
  const [blockDate, setBlockDate] = useState(date);
  const [start, setStart] = useState('14:00');
  const [end, setEnd] = useState('16:00');
  const [label, setLabel] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const inFlight = useRef(false);
  const loadSequence = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const endpoint = `/api/admin/calendar-blocks?salonSlug=${encodeURIComponent(salonSlug)}`;
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint}&date=${encodeURIComponent(blockDate)}`, { cache: 'no-store' });
      const body = await response.json();
      if (sequence !== loadSequence.current) {
        return;
      }
      if (!response.ok) {
        throw new Error(body.error?.message || 'Blocked time could not be loaded.');
      }
      setBlocks(body.data.blocks);
      setTimeZone(body.data.timeZone);
    } catch (cause) {
      if (sequence !== loadSequence.current) {
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Blocked time could not be loaded.');
      setTimeZone(null);
    } finally {
      if (sequence === loadSequence.current) {
        setLoading(false);
      }
    }
  }, [endpoint, blockDate]);
  useEffect(() => {
    void load();
    return () => {
      loadSequence.current += 1;
    };
  }, [load]);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const reset = () => {
    setEditing(null);
    setLabel('');
    requestId.current = crypto.randomUUID();
    setRemoveId(null);
  };
  const save = async (remove?: Block) => {
    if (inFlight.current || !timeZone) {
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(endpoint, {
        method: remove ? 'DELETE' : editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(remove
          ? { id: remove.id, technicianId: remove.technicianId, version: remove.updatedAt }
          : { id: editing?.id ?? requestId.current, technicianId: selectedTechnician, date: blockDate, startTime: start, endTime: end, label, ...(editing ? { version: editing.updatedAt } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error?.message || 'Blocked time could not be saved.');
      }
      reset();
      setNotice(remove ? 'Block removed. Booking availability has been updated.' : 'Time blocked. Clients cannot book this technician during it.');
      window.dispatchEvent(new Event(APPOINTMENT_DATA_CHANGED_EVENT));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Blocked time could not be saved.');
    } finally {
      setSaving(false);
      inFlight.current = false;
    }
  };
  return (
    <section className="space-y-4 p-4 pb-28" aria-labelledby="block-time-title" data-testid="calendar-block-time">
      <button type="button" className={buttonClass} onClick={onClose} disabled={saving}>Back to Calendar</button>
      <h2 ref={headingRef} tabIndex={-1} id="block-time-title" className="text-xl font-semibold">Block Time</h2>
      <p className="text-sm text-stone-600">Reserve part of a day for a break or personal commitment. Existing appointments are kept; overlapping blocks are refused. For a whole day away, use Days Off.</p>
      {timeZone && (
        <p className="text-sm text-stone-600">
          Times in
          {' '}
          {timeZone}
        </p>
      )}
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-900">
          {error}
          <button type="button" className={`${buttonClass} ml-2`} disabled={saving} onClick={() => void load()}>Refresh</button>
        </div>
      )}
      {notice && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-900">{notice}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="space-y-3"
      >
        {technicians.length > 1 && (
          <label className="block text-sm font-medium">
            Technician
            <select className={fieldClass} value={selectedTechnician} disabled={saving || Boolean(editing)} onChange={event => setSelectedTechnician(event.target.value)}>{technicians.map(tech => <option value={tech.id} key={tech.id}>{tech.name}</option>)}</select>
          </label>
        )}
        <label className="block text-sm font-medium">
          Date
          <input
            type="date"
            required
            className={fieldClass}
            value={blockDate}
            disabled={saving}
            onChange={(event) => {
              setBlockDate(event.target.value);
              setNotice(null);
              setRemoveId(null);
            }}
          />
        </label>
        <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
          <label className="block text-sm font-medium">
            Start time
            <input type="time" required className={fieldClass} value={start} disabled={saving} onChange={event => setStart(event.target.value)} />
          </label>
          <label className="block text-sm font-medium">
            End time
            <input type="time" required className={fieldClass} value={end} disabled={saving} onChange={event => setEnd(event.target.value)} />
          </label>
        </div>
        <label className="block text-sm font-medium">
          Label (optional)
          <input className={fieldClass} value={label} maxLength={120} disabled={saving} onChange={event => setLabel(event.target.value)} placeholder="Lunch, break, personal…" />
        </label>
        <p className="text-xs text-stone-600">This label is for your salon. Clients only see that the time is unavailable.</p>
        <div className="flex flex-wrap gap-2">
          <button className={`${buttonClass} bg-rose-900 text-white disabled:opacity-50`} type="submit" disabled={saving || loading || !timeZone || !selectedTechnician}>{saving ? 'Saving…' : editing ? 'Save block' : 'Block time'}</button>
          {editing && <button type="button" className={buttonClass} disabled={saving} onClick={reset}>Cancel edit</button>}
        </div>
      </form>
      <h3 className="font-semibold">Blocked time on this date</h3>
      {loading ? <p role="status">Loading blocked time…</p> : !blocks.length && <p className="text-sm text-stone-600">No saved intraday blocks on this date.</p>}
      {blocks.map(block => (
        <article key={block.id} className="space-y-2 rounded-xl border border-stone-200 p-3">
          <p className="font-semibold">{block.label || 'Blocked time'}</p>
          <p className="text-sm">
            {timeZone && `${getTimeKeyInTimeZone(new Date(block.startsAt), timeZone)}–${getTimeKeyInTimeZone(new Date(block.endsAt), timeZone)}`}
            {technicians.length > 1 && ` · ${technicians.find(tech => tech.id === block.technicianId)?.name ?? 'Technician'}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={saving || !timeZone}
              onClick={() => {
                setEditing(block);
                setSelectedTechnician(block.technicianId);
                setBlockDate(getDateKeyInTimeZone(new Date(block.startsAt), timeZone));
                setStart(getTimeKeyInTimeZone(new Date(block.startsAt), timeZone));
                setEnd(getTimeKeyInTimeZone(new Date(block.endsAt), timeZone));
                setLabel(block.label ?? '');
                headingRef.current?.focus();
              }}
            >
              Edit block
            </button>
            <button type="button" className={buttonClass} disabled={saving} onClick={() => setRemoveId(block.id)}>Remove block</button>
          </div>
          {removeId === block.id && (
            <div className="space-y-2 rounded-xl bg-amber-50 p-3">
              <p className="text-sm">Remove this block? Working hours and other booking rules will still apply.</p>
              <button type="button" className={buttonClass} disabled={saving} onClick={() => void save(block)}>Confirm removal</button>
              <button type="button" className={`${buttonClass} ml-2`} disabled={saving} onClick={() => setRemoveId(null)}>Keep block</button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
