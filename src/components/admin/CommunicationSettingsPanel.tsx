'use client';

import { LoaderCircle, Plus, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SmsOperationalHealth } from '@/libs/textingStatus';

type ReminderChannel = 'sms' | 'email' | 'both';
type ReminderRule = {
  id: string;
  offsetMinutes: number;
  channels: ReminderChannel;
  enabled: boolean;
};
type CommunicationForm = {
  emailEnabled: boolean;
  smsEnabled: boolean;
  killSwitch: boolean;
  quietHours: { enabled: boolean; start: string; end: string };
  rules: ReminderRule[];
  events: Record<string, { enabled: boolean; channels: ReminderChannel }>;
};
type TextingMode = 'off' | 'manual' | 'automatic';
type SettingsResponse = {
  error?: { message?: string };
  sms?: SmsOperationalHealth | null;
  communications?: {
    email?: { enabled?: boolean };
    sms?: { enabled?: boolean };
    killSwitch?: boolean;
    quietHours?: { enabled?: boolean; start?: string; end?: string };
    reminders?: { rules?: ReminderRule[] };
    events?: CommunicationForm['events'];
  };
};

const DEFAULT_FORM: CommunicationForm = {
  emailEnabled: true,
  smsEnabled: false,
  killSwitch: false,
  quietHours: { enabled: true, start: '21:00', end: '09:00' },
  rules: [],
  events: {},
};

const REMINDER_TIMES = [
  { value: 120, label: '2 hours before' },
  { value: 240, label: '4 hours before' },
  { value: 1440, label: '24 hours before' },
  { value: 2880, label: '2 days before' },
  { value: 4320, label: '3 days before' },
];

function hasAutomaticSms(form: CommunicationForm): boolean {
  return form.rules.some(rule => rule.enabled && (rule.channels === 'sms' || rule.channels === 'both'));
}

function textingMode(form: CommunicationForm): TextingMode {
  if (!form.smsEnabled) {
    return 'off';
  }
  return hasAutomaticSms(form) ? 'automatic' : 'manual';
}

function formFromResponse(data: SettingsResponse | null): CommunicationForm {
  const communications = data?.communications;
  if (!communications) {
    return DEFAULT_FORM;
  }
  return {
    emailEnabled: communications.email?.enabled !== false,
    smsEnabled: communications.sms?.enabled === true,
    killSwitch: communications.killSwitch === true,
    quietHours: {
      enabled: communications.quietHours?.enabled !== false,
      start: communications.quietHours?.start ?? '21:00',
      end: communications.quietHours?.end ?? '09:00',
    },
    rules: (communications.reminders?.rules ?? []).map((rule: ReminderRule) => ({ ...rule })),
    events: { ...(communications.events ?? {}) },
  };
}

function applyTextingMode(form: CommunicationForm, mode: TextingMode): CommunicationForm {
  if (mode === 'off') {
    return { ...form, smsEnabled: false };
  }
  if (mode === 'manual') {
    return {
      ...form,
      smsEnabled: true,
      rules: form.rules.map((rule) => {
        if (!rule.enabled) {
          return rule;
        }
        if (rule.channels === 'both') {
          return { ...rule, channels: 'email' };
        }
        return rule.channels === 'sms' ? { ...rule, enabled: false } : rule;
      }),
    };
  }
  if (hasAutomaticSms(form)) {
    return { ...form, smsEnabled: true };
  }
  const disabledRule = form.rules.find(rule => !rule.enabled);
  if (disabledRule) {
    return {
      ...form,
      smsEnabled: true,
      rules: form.rules.map(rule => rule.id === disabledRule.id
        ? { ...rule, enabled: true, channels: rule.channels === 'email' ? 'both' : rule.channels }
        : rule),
    };
  }
  if (form.rules.length < 3) {
    return {
      ...form,
      smsEnabled: true,
      rules: [...form.rules, {
        id: `crule_${crypto.randomUUID()}`,
        offsetMinutes: 1440,
        channels: 'sms',
        enabled: true,
      }],
    };
  }
  return {
    ...form,
    smsEnabled: true,
    rules: form.rules.map((rule, index) => index === 0
      ? { ...rule, enabled: true, channels: rule.channels === 'email' ? 'both' : rule.channels }
      : rule),
  };
}

const MODE_COPY: Record<TextingMode, { title: string; detail: string }> = {
  off: { title: 'Off', detail: 'Luster sends no texts. You can still prepare a text in your phone.' },
  manual: { title: 'Manual', detail: 'You choose when to send each text. Scheduled text reminders are off.' },
  automatic: { title: 'Automatic', detail: 'Appointment reminders send on schedule. You can still send one-time texts.' },
};

export function CommunicationSettingsPanel({ salonSlug }: { salonSlug: string }) {
  const [form, setForm] = useState<CommunicationForm>(DEFAULT_FORM);
  const [savedForm, setSavedForm] = useState<CommunicationForm>(DEFAULT_FORM);
  const [sms, setSms] = useState<SmsOperationalHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/salon/settings?salonSlug=${encodeURIComponent(salonSlug)}`, { cache: 'no-store', signal });
      const data = await response.json().catch(() => null) as SettingsResponse | null;
      if (!response.ok) {
        throw new Error(data?.error?.message || 'Message settings could not be loaded.');
      }
      const next = formFromResponse(data);
      setForm(next);
      setSavedForm(next);
      setSms(data?.sms ?? null);
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : 'Message settings could not be loaded.');
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [salonSlug]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const mode = textingMode(form);
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(savedForm), [form, savedForm]);

  const save = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      if (form.quietHours.enabled && form.quietHours.start === form.quietHours.end) {
        throw new Error('Choose different start and end times for quiet hours.');
      }
      const enabledOffsets = form.rules.filter(rule => rule.enabled).map(rule => rule.offsetMinutes);
      if (new Set(enabledOffsets).size !== enabledOffsets.length) {
        throw new Error('Choose a different time for each enabled reminder.');
      }
      const response = await fetch(`/api/admin/salon/settings?salonSlug=${encodeURIComponent(salonSlug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          communications: {
            sms: { enabled: form.smsEnabled },
            email: { enabled: form.emailEnabled },
            killSwitch: form.killSwitch,
            quietHours: form.quietHours,
            reminders: { rules: form.rules },
            ...(Object.keys(form.events).length ? { events: form.events } : {}),
          },
        }),
      });
      const data = await response.json().catch(() => null) as SettingsResponse | null;
      if (!response.ok) {
        throw new Error(response.status === 400
          ? 'Check your reminder times and quiet hours, then try again.'
          : data?.error?.message || 'Message settings could not be saved.');
      }
      const next = formFromResponse(data);
      setForm(next);
      setSavedForm(next);
      setSms(data?.sms ?? sms);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Message settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-[var(--owner-muted)]" role="status">
        <LoaderCircle className="size-4 animate-spin" />
        {' '}
        Loading message settings…
      </p>
    );
  }

  if (error && !sms && !dirty) {
    return (
      <div className="p-4 text-sm text-red-700" role="alert">
        <p>{error}</p>
        <button type="button" onClick={() => void load()} className="mt-3 min-h-11 font-semibold underline">Try again</button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8" data-testid="communication-settings-panel">
      <section className="rounded-[20px] bg-[var(--owner-surface)] p-4 shadow-sm">
        <h2 className="text-[17px] font-semibold text-[var(--owner-ink)]">Texting mode</h2>
        {sms && (
          <p className="mt-1 text-[13px] text-[var(--owner-muted)]">
            {sms.senderLabel}
            {' '}
            ·
            {' '}
            {sms.availableCredits === null ? 'credits unavailable' : `${sms.availableCredits} credits`}
          </p>
        )}
        <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Texting mode">
          {(Object.keys(MODE_COPY) as TextingMode[]).map(value => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setForm(current => applyTextingMode(current, value))}
              className={`min-h-11 rounded-xl border px-2 text-sm font-semibold ${mode === value ? 'border-[var(--owner-accent)] bg-rose-50 text-[var(--owner-accent)]' : 'border-[var(--owner-line)] bg-white text-[var(--owner-ink)]'}`}
            >
              {MODE_COPY[value].title}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--owner-muted)]">{MODE_COPY[mode].detail}</p>
        <label className="mt-3 flex min-h-11 items-center justify-between gap-3 border-t border-[var(--owner-line)] pt-3 text-sm font-medium text-[var(--owner-ink)]">
          Pause all client messages
          <input type="checkbox" checked={form.killSwitch} onChange={event => setForm(current => ({ ...current, killSwitch: event.target.checked }))} className="size-5 accent-[var(--owner-accent)]" />
        </label>
      </section>

      <section className="rounded-[20px] bg-[var(--owner-surface)] p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold text-[var(--owner-ink)]">Appointment reminders</h2>
            <p className="mt-1 text-[13px] text-[var(--owner-muted)]">Choose when reminders go out and whether they use text, email or both.</p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-[var(--owner-muted)]">
            Email
            <input type="checkbox" checked={form.emailEnabled} onChange={event => setForm(current => ({ ...current, emailEnabled: event.target.checked }))} className="size-5 accent-[var(--owner-accent)]" />
          </label>
        </div>
        <div className="mt-3 space-y-2">
          {form.rules.map((rule, index) => (
            <div key={rule.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-xl border border-[var(--owner-line)] p-3">
              <input type="checkbox" aria-label={`Reminder ${index + 1} enabled`} checked={rule.enabled} onChange={event => setForm(current => ({ ...current, rules: current.rules.map(item => item.id === rule.id ? { ...item, enabled: event.target.checked } : item) }))} className="size-5 accent-[var(--owner-accent)]" />
              <div className="grid gap-2 sm:grid-cols-2">
                <select aria-label={`Reminder ${index + 1} timing`} value={rule.offsetMinutes} onChange={event => setForm(current => ({ ...current, rules: current.rules.map(item => item.id === rule.id ? { ...item, offsetMinutes: Number(event.target.value) } : item) }))} className="min-h-10 rounded-lg border border-[var(--owner-line)] bg-white px-2 text-sm">{REMINDER_TIMES.map(time => <option key={time.value} value={time.value}>{time.label}</option>)}</select>
                <select aria-label={`Reminder ${index + 1} channel`} value={rule.channels} onChange={event => setForm(current => ({ ...current, rules: current.rules.map(item => item.id === rule.id ? { ...item, channels: event.target.value as ReminderChannel } : item) }))} className="min-h-10 rounded-lg border border-[var(--owner-line)] bg-white px-2 text-sm">
                  <option value="email">Email</option>
                  <option value="sms">Text</option>
                  <option value="both">Email & text</option>
                </select>
              </div>
              <button type="button" aria-label={`Remove reminder ${index + 1}`} onClick={() => setForm(current => ({ ...current, rules: current.rules.filter(item => item.id !== rule.id) }))} className="flex size-10 items-center justify-center rounded-lg text-red-700"><Trash2 className="size-4" /></button>
            </div>
          ))}
          {form.rules.length === 0 && <p className="rounded-xl bg-[var(--owner-ground)] p-3 text-sm text-[var(--owner-muted)]">No automatic appointment reminders.</p>}
        </div>
        {form.rules.length < 3 && (
          <button type="button" onClick={() => setForm(current => ({ ...current, rules: [...current.rules, { id: `crule_${crypto.randomUUID()}`, offsetMinutes: current.rules.length ? 2880 : 1440, channels: current.smsEnabled ? 'both' : 'email', enabled: true }] }))} className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--owner-accent)]">
            <Plus className="size-4" />
            {' '}
            Add reminder
          </button>
        )}
      </section>

      <section className="rounded-[20px] bg-[var(--owner-surface)] p-4 shadow-sm">
        <label className="flex min-h-11 items-center justify-between gap-3">
          <span>
            <span className="block text-[17px] font-semibold text-[var(--owner-ink)]">Quiet hours</span>
            <span className="mt-1 block text-[13px] text-[var(--owner-muted)]">Hold scheduled and manual Luster texts overnight.</span>
          </span>
          <input type="checkbox" checked={form.quietHours.enabled} onChange={event => setForm(current => ({ ...current, quietHours: { ...current.quietHours, enabled: event.target.checked } }))} className="size-5 accent-[var(--owner-accent)]" />
        </label>
        {form.quietHours.enabled && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-[var(--owner-muted)]">
              From
              <input type="time" aria-label="Quiet hours start" value={form.quietHours.start} onChange={event => setForm(current => ({ ...current, quietHours: { ...current.quietHours, start: event.target.value } }))} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--owner-line)] bg-white px-3 text-base text-[var(--owner-ink)]" />
            </label>
            <label className="text-xs font-medium text-[var(--owner-muted)]">
              Until
              <input type="time" aria-label="Quiet hours end" value={form.quietHours.end} onChange={event => setForm(current => ({ ...current, quietHours: { ...current.quietHours, end: event.target.value } }))} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--owner-line)] bg-white px-3 text-base text-[var(--owner-ink)]" />
            </label>
          </div>
        )}
      </section>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {saved && <p role="status" className="text-sm font-medium text-emerald-700">Message settings saved.</p>}
      <button type="button" disabled={!dirty || saving} onClick={() => void save()} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white disabled:opacity-50">
        <Save className="size-4" />
        {' '}
        {saving ? 'Saving…' : 'Save message settings'}
      </button>
    </div>
  );
}
