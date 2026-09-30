'use client';

import { ArrowLeft, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildClientSmsPrefix, STOP_LANGUAGE } from '@/libs/communicationTemplates';
import { defaultRebookingReminderSettings, REBOOKING_REMINDER_MAX_LENGTH, REBOOKING_REMINDER_VARIABLES, type RebookingReminderSettings as RebookingReminderConfig, renderRebookingReminder } from '@/libs/rebookingReminders';
import { calculateSmsSegments, formatSegmentPreview } from '@/libs/smsSegments';

type Props = { salonSlug: string; salonName: string; onClose: () => void };

type ResponseBody = {
  data?: { settings?: RebookingReminderConfig };
  error?: { message?: string };
};

export function RebookingReminderSettings({ salonSlug, salonName, onClose }: Props) {
  const [savedSettings, setSavedSettings] = useState<RebookingReminderConfig | null>(null);
  const [draft, setDraft] = useState<RebookingReminderConfig>(defaultRebookingReminderSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/rebooking-reminders?salonSlug=${encodeURIComponent(salonSlug)}`, { cache: 'no-store' });
      const body = await response.json() as ResponseBody;
      if (!response.ok || !body.data?.settings) {
        throw new Error(body.error?.message || 'Could not load rebooking reminders.');
      }
      setSavedSettings(body.data.settings);
      setDraft(body.data.settings);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load rebooking reminders.');
    } finally {
      setLoading(false);
    }
  }, [salonSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const sampleLink = `https://www.lustergel.app/en/${encodeURIComponent(salonSlug)}/book/service`;
  const preview = useMemo(() => `${buildClientSmsPrefix(salonName)}${renderRebookingReminder(draft.messageTemplate, {
    first_name: 'Alex',
    service_name: 'Gel manicure',
    salon_name: salonName,
    booking_link: sampleLink,
  })} ${STOP_LANGUAGE}`, [draft.messageTemplate, salonName, sampleLink]);
  const segments = calculateSmsSegments(preview);
  const dirty = savedSettings !== null && (
    draft.enabled !== savedSettings.enabled
    || draft.defaultIntervalWeeks !== savedSettings.defaultIntervalWeeks
    || draft.messageTemplate !== savedSettings.messageTemplate
  );

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await fetch(`/api/admin/rebooking-reminders?salonSlug=${encodeURIComponent(salonSlug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: draft.enabled,
          defaultIntervalWeeks: draft.defaultIntervalWeeks,
          messageTemplate: draft.messageTemplate,
        }),
      });
      const body = await response.json() as ResponseBody;
      if (!response.ok || !body.data?.settings) {
        throw new Error(body.error?.message || 'Could not save rebooking reminders.');
      }
      setSavedSettings(body.data.settings);
      setDraft(body.data.settings);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save rebooking reminders.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-full w-full flex-col bg-[var(--owner-ground)] text-[var(--owner-ink)]">
      <div className="sticky top-0 z-10 flex min-h-14 items-center gap-2 border-b border-[var(--owner-line)] bg-[var(--owner-ground)] px-4">
        <button type="button" onClick={onClose} aria-label="Back to Marketing & Messages" className="flex min-h-11 min-w-11 items-center justify-center rounded-full">
          <ArrowLeft className="size-5" aria-hidden="true" />
        </button>
        <h1 className="text-[18px] font-semibold">Rebooking Reminders</h1>
      </div>
      {loading
        ? <div role="status" className="p-5">Loading rebooking reminders…</div>
        : savedSettings === null
          ? (
              <div role="alert" className="p-5">
                {error || 'Could not load rebooking reminders.'}
                {' '}
                <button type="button" onClick={() => void load()} className="underline">Try again</button>
              </div>
            )
          : (
              <>
                <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-28">
                  <section className="rounded-[18px] bg-[var(--owner-surface)] p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-[17px] font-semibold">Automatic rebooking reminders</h2>
                        <p className="mt-1 text-[14px] leading-relaxed text-[var(--owner-muted)]">Automatically remind clients when it’s almost time for their next appointment.</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={draft.enabled}
                        aria-label="Enable rebooking reminders"
                        onClick={() => {
                          setDraft(current => ({ ...current, enabled: !current.enabled }));
                          setSaved(false);
                        }}
                        className={`min-h-11 min-w-14 rounded-full px-2 text-sm font-semibold ${draft.enabled ? 'bg-[var(--owner-accent)] text-white' : 'bg-[var(--owner-line)] text-[var(--owner-ink)]'}`}
                      >
                        {draft.enabled ? 'On' : 'Off'}
                      </button>
                    </div>
                    <p className="mt-3 text-[12px] leading-relaxed text-[var(--owner-muted)]">Only reminder dates from when you turn this on are considered. Clients with an upcoming booking will not get one.</p>
                  </section>
                  <section className="rounded-[18px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
                    <label htmlFor="rebooking-reminder-interval" className="block text-[15px] font-semibold">Send after the last completed appointment</label>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        id="rebooking-reminder-interval"
                        type="number"
                        min={1}
                        max={52}
                        step={1}
                        value={draft.defaultIntervalWeeks}
                        onChange={(event) => {
                          const value = event.currentTarget.valueAsNumber;
                          if (Number.isInteger(value)) {
                            setDraft(current => ({ ...current, defaultIntervalWeeks: value }));
                            setSaved(false);
                          }
                        }}
                        className="min-h-11 w-20 rounded-xl border border-[var(--owner-line)] bg-white px-3 text-[15px]"
                      />
                      <span className="text-[14px] text-[var(--owner-muted)]">weeks</span>
                    </div>
                  </section>
                  <section className="rounded-[18px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
                    <label htmlFor="rebooking-reminder-message" className="block text-[15px] font-semibold">SMS wording</label>
                    <textarea
                      id="rebooking-reminder-message"
                      rows={6}
                      maxLength={REBOOKING_REMINDER_MAX_LENGTH}
                      value={draft.messageTemplate}
                      onChange={(event) => {
                        const messageTemplate = event.currentTarget.value;
                        setDraft(current => ({ ...current, messageTemplate }));
                        setSaved(false);
                      }}
                      className="mt-2 w-full rounded-xl border border-[var(--owner-line)] bg-white px-3 py-2.5 text-[14px]"
                    />
                    <p className="mt-1 text-[12px] text-[var(--owner-muted)]">
                      Available variables:
                      {REBOOKING_REMINDER_VARIABLES.map(variable => `{{${variable}}}`).join(' · ')}
                    </p>
                    <p className="mt-1 text-right text-[12px] text-[var(--owner-muted)]">
                      {draft.messageTemplate.length}
                      /
                      {REBOOKING_REMINDER_MAX_LENGTH}
                    </p>
                  </section>
                  <section className="rounded-[18px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
                    <h2 className="text-[15px] font-semibold">Message preview</h2>
                    <p className="mt-1 text-[12px] text-[var(--owner-muted)]">Sample client and booking link. The final SMS uses each client’s details.</p>
                    <p className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-[var(--owner-ground)] p-3 text-[14px] [overflow-wrap:anywhere]">{preview}</p>
                    <p className="mt-2 text-[12px] text-[var(--owner-muted)]">
                      {formatSegmentPreview(segments)}
                      {' '}
                      with these sample values
                    </p>
                  </section>
                  {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
                  {saved && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Rebooking Reminders saved.</p>}
                </div>
                <div className="sticky bottom-0 border-t border-[var(--owner-line)] bg-[var(--owner-surface)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  <button type="button" onClick={() => void save()} disabled={!dirty || saving || draft.defaultIntervalWeeks < 1 || draft.defaultIntervalWeeks > 52} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white disabled:opacity-50">
                    <Save className="size-4" aria-hidden="true" />
                    {saving ? 'Saving…' : 'Save Rebooking Reminders'}
                  </button>
                </div>
              </>
            )}
    </div>
  );
}
