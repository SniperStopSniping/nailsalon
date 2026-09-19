'use client';

import { useEffect, useState } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

import { ScheduleTab } from './staff/tabs/ScheduleTab';

type WorkingSchedule = Record<string, { start: string; end: string } | null>;
type SchedulePerson = { id: string; name: string; isActive: boolean; weeklySchedule: WorkingSchedule | null };

/** The existing schedule/time-off editor, without a Team management workflow. */
export function OwnerScheduleEditor({ salonSlug, section, technicianId, onDirtyChange }: {
  salonSlug: string;
  section: 'hours' | 'time-off';
  technicianId?: string | null;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [people, setPeople] = useState<SchedulePerson[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setPeople([]);
    setSelectedId(null);
    setDirty(false);
    const load = async () => {
      try {
        const all: SchedulePerson[] = [];
        let page = 1;
        let totalPages = 1;
        do {
          const query = new URLSearchParams({ salonSlug, status: 'all', page: String(page), limit: '100' });
          const response = await fetch(`/api/admin/technicians?${query}`, { signal: controller.signal });
          const body = await response.json();
          if (!response.ok) {
            throw new Error(body?.error?.message || 'Could not load working schedules.');
          }
          all.push(...body.data.technicians);
          totalPages = body.data.pagination.totalPages;
          page += 1;
        } while (page <= totalPages);
        if (controller.signal.aborted) {
          return;
        }
        setPeople(all);
        // A record-specific link must never silently open another person.
        if (technicianId && !all.some(person => person.id === technicianId)) {
          throw new Error('This schedule is unavailable for the selected salon.');
        }
        setSelectedId(technicianId || all.find(person => person.isActive)?.id || all[0]?.id || null);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Could not load working schedules.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [salonSlug, technicianId, retry]);

  if (loading) {
    return <p className="p-4 text-sm" role="status">Loading your schedule…</p>;
  }
  if (error) {
    return (
      <div className="space-y-3 p-4">
        <p role="alert">{error}</p>
        <button type="button" className="min-h-11 rounded-xl border px-4" onClick={() => setRetry(value => value + 1)}>Try again</button>
      </div>
    );
  }
  const person = people.find(item => item.id === selectedId);
  if (!person) {
    return <p className="p-4 text-sm">Add a technician during business setup to set working hours.</p>;
  }
  return (
    <div>
      {people.length > 1 && (
        <label className="block px-4 pt-4 text-sm font-medium">
          Whose schedule?
          <select
            aria-label="Whose schedule?"
            className="mt-2 min-h-11 w-full rounded-xl border border-[var(--owner-line)] bg-white px-3"
            value={selectedId ?? ''}
            onChange={(event) => {
              if (dirty) {
                setPendingSelection(event.target.value);
              } else {
                setSelectedId(event.target.value);
              }
            }}
          >
            {people.map(item => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="px-4 pt-4 text-sm text-[var(--owner-muted)]">
        {section === 'hours'
          ? 'These are the hours available for appointments. Salon opening hours are managed separately.'
          : 'Time off is an exception to your normal working hours. Adding time off keeps existing appointments in place.'}
      </p>
      <ScheduleTab
        key={`${salonSlug}:${person.id}:${section}`}
        salonSlug={salonSlug}
        technicianId={person.id}
        weeklySchedule={person.weeklySchedule}
        section={section}
        onDirtyChange={setDirty}
        onUpdate={weeklySchedule => setPeople(current => current.map(item => item.id === person.id ? { ...item, weeklySchedule } : item))}
      />
      <ConfirmDialog
        isOpen={pendingSelection !== null}
        onClose={() => setPendingSelection(null)}
        onConfirm={() => {
          setSelectedId(pendingSelection);
          setPendingSelection(null);
          setDirty(false);
        }}
        title="Discard unsaved working hours?"
        description="Save your changes before switching schedules, or discard them."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        tone="danger"
      />
    </div>
  );
}
