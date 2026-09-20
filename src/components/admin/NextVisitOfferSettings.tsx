'use client';

import { ArrowLeft, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_NEXT_VISIT_OFFER_SETTINGS, type NextVisitOfferSettings as NextVisitOfferSettingsData } from '@/libs/nextVisitOfferSettings';

type DiscountType = 'percent' | 'fixed';
type Service = { id: string; name: string };
type Settings = NextVisitOfferSettingsData;
type Status = {
  enabledSince: string | null;
  issued: number;
  reserved: number;
  used: number;
};
type ResponsePayload = {
  data?: {
    settings?: Partial<Settings>;
    availableServices?: Service[];
    status?: Partial<Status>;
  };
  error?: { message?: string } | string;
  message?: string;
};
type FieldErrors = Partial<Record<'windowDays' | 'value' | 'services', string>>;
type ServiceMode = 'all' | 'selected';

const DEFAULT_SETTINGS: Settings = DEFAULT_NEXT_VISIT_OFFER_SETTINGS;
const DEFAULT_STATUS: Status = { enabledSince: null, issued: 0, reserved: 0, used: 0 };
const WINDOW_PRESETS = [14, 21, 28, 30, 42] as const;

function messageFrom(payload: ResponsePayload | null, fallback: string): string {
  if (typeof payload?.error === 'string') {
    return payload.error;
  }
  return payload?.error?.message || payload?.message || fallback;
}

function normalizeSettings(input: Partial<Settings> | undefined): Settings {
  const discountType: DiscountType = input?.discountType === 'fixed' ? 'fixed' : 'percent';
  const rawWindowDays = input?.windowDays;
  const rawValue = input?.value;
  const windowDays = typeof rawWindowDays === 'number' && Number.isInteger(rawWindowDays) && rawWindowDays >= 1 && rawWindowDays <= 90
    ? rawWindowDays
    : DEFAULT_SETTINGS.windowDays;
  const value = typeof rawValue === 'number' && Number.isInteger(rawValue) && rawValue > 0
    ? rawValue
    : DEFAULT_SETTINGS.value;

  return {
    enabled: input?.enabled === true,
    windowDays,
    discountType,
    value,
    eligibleServiceIds: Array.isArray(input?.eligibleServiceIds)
      ? Array.from(new Set((input?.eligibleServiceIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0)))
      : [],
    messageTemplate: typeof input?.messageTemplate === 'string'
      ? input.messageTemplate
      : DEFAULT_SETTINGS.messageTemplate,
  };
}

function normalizeStatus(input: Partial<Status> | undefined): Status {
  return {
    enabledSince: typeof input?.enabledSince === 'string' ? input.enabledSince : null,
    issued: typeof input?.issued === 'number' && Number.isInteger(input.issued) && input.issued >= 0 ? input.issued : 0,
    reserved: typeof input?.reserved === 'number' && Number.isInteger(input.reserved) && input.reserved >= 0 ? input.reserved : 0,
    used: typeof input?.used === 'number' && Number.isInteger(input.used) && input.used >= 0 ? input.used : 0,
  };
}

function parseWholeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseDollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const cents = Math.round(Number.parseFloat(trimmed) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function formatEnabledSince(value: string | null): string {
  if (!value) {
    return 'Not enabled yet';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Enabled' : `Enabled ${date.toLocaleDateString()}`;
}

export function NextVisitOfferSettings({
  salonSlug,
  onClose,
}: {
  salonSlug: string;
  onClose?: () => void;
}) {
  const [savedSettings, setSavedSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [status, setStatus] = useState<Status>(DEFAULT_STATUS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serviceMode, setServiceMode] = useState<ServiceMode>('all');
  const [customWindow, setCustomWindow] = useState(false);
  const [valueText, setValueText] = useState<string | null>(null);
  const activeSalonSlug = useRef(salonSlug);
  const requestVersion = useRef(0);
  const windowInputRef = useRef<HTMLInputElement>(null);
  const valueInputRef = useRef<HTMLInputElement>(null);

  activeSalonSlug.current = salonSlug;

  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSaved(false);
    setDraft(null);
    setSavedSettings(null);
    try {
      const response = await fetch(`/api/admin/next-visit-offer?salonSlug=${encodeURIComponent(salonSlug)}`, {
        cache: 'no-store',
        signal,
      });
      const payload = await response.json().catch(() => null) as ResponsePayload | null;
      if (!response.ok || !payload?.data?.settings) {
        throw new Error(messageFrom(payload, 'Could not load Next Visit Offer settings.'));
      }
      if (signal?.aborted || version !== requestVersion.current || activeSalonSlug.current !== salonSlug) {
        return;
      }
      const next = normalizeSettings(payload.data.settings);
      setSavedSettings(next);
      setDraft(next);
      setServices(Array.isArray(payload.data.availableServices)
        ? payload.data.availableServices.filter((service): service is Service => Boolean(service && typeof service.id === 'string' && typeof service.name === 'string'))
        : []);
      setStatus(normalizeStatus(payload.data.status));
      setServiceMode(next.eligibleServiceIds.length > 0 ? 'selected' : 'all');
      setCustomWindow(!WINDOW_PRESETS.includes(next.windowDays as (typeof WINDOW_PRESETS)[number]));
      setFieldErrors({});
      setValueText(null);
    } catch (cause) {
      if (!signal?.aborted && version === requestVersion.current && activeSalonSlug.current === salonSlug) {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load Next Visit Offer settings.');
      }
    } finally {
      if (!signal?.aborted && version === requestVersion.current && activeSalonSlug.current === salonSlug) {
        setLoading(false);
      }
    }
  }, [salonSlug]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const dirty = useMemo(() => draft !== null && savedSettings !== null && JSON.stringify(draft) !== JSON.stringify(savedSettings), [draft, savedSettings]);
  const valueInput = valueText ?? (draft
    ? draft.discountType === 'fixed' ? (draft.value / 100).toFixed(2) : String(draft.value)
    : '');

  const update = useCallback((updater: (current: Settings) => Settings) => {
    setDraft(current => current ? updater(current) : current);
    setSaved(false);
    setSaveError(null);
  }, []);

  const validate = useCallback((): FieldErrors => {
    if (!draft) {
      return {};
    }
    const errors: FieldErrors = {};
    if (!Number.isInteger(draft.windowDays) || draft.windowDays < 1 || draft.windowDays > 90) {
      errors.windowDays = 'Choose a window from 1 to 90 days.';
    }
    if (!Number.isInteger(draft.value) || draft.value <= 0) {
      errors.value = draft.discountType === 'fixed'
        ? 'Enter a dollar amount greater than $0.00.'
        : 'Enter a whole percentage greater than 0.';
    } else if (draft.discountType === 'percent' && draft.value > 100) {
      errors.value = 'Percentage cannot exceed 100%.';
    }
    if (serviceMode === 'selected' && draft.eligibleServiceIds.length === 0) {
      errors.services = 'Select at least one service, or choose all services.';
    }
    return errors;
  }, [draft, serviceMode]);

  const focusFirstError = (errors: FieldErrors) => {
    if (errors.windowDays) {
      windowInputRef.current?.focus();
    } else if (errors.value) {
      valueInputRef.current?.focus();
    }
  };

  const save = useCallback(async () => {
    if (!draft || saving) {
      return;
    }
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors);
      return;
    }
    try {
      setSaving(true);
      setSaved(false);
      setSaveError(null);
      const response = await fetch(`/api/admin/next-visit-offer?salonSlug=${encodeURIComponent(salonSlug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: draft.enabled,
          windowDays: draft.windowDays,
          discountType: draft.discountType,
          value: draft.value,
          eligibleServiceIds: draft.eligibleServiceIds,
          messageTemplate: draft.messageTemplate,
        }),
      });
      const payload = await response.json().catch(() => null) as ResponsePayload | null;
      if (!response.ok || !payload?.data?.settings) {
        throw new Error(messageFrom(payload, 'Could not save Next Visit Offer settings.'));
      }
      if (activeSalonSlug.current !== salonSlug) {
        return;
      }
      const next = normalizeSettings(payload.data.settings);
      setSavedSettings(next);
      setDraft(next);
      setServices(Array.isArray(payload.data.availableServices)
        ? payload.data.availableServices.filter((service): service is Service => Boolean(service && typeof service.id === 'string' && typeof service.name === 'string'))
        : services);
      setStatus(normalizeStatus(payload.data.status));
      setServiceMode(next.eligibleServiceIds.length > 0 ? 'selected' : 'all');
      setSaved(true);
      setFieldErrors({});
    } catch (cause) {
      if (activeSalonSlug.current === salonSlug) {
        setSaveError(cause instanceof Error ? cause.message : 'Could not save Next Visit Offer settings.');
      }
    } finally {
      if (activeSalonSlug.current === salonSlug) {
        setSaving(false);
      }
    }
  }, [draft, salonSlug, saving, services, validate]);

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center" role="status">
        <span className="size-6 animate-spin rounded-full border-2 border-[var(--owner-accent)] border-t-transparent motion-reduce:animate-none" />
        <span className="sr-only">Loading Next Visit Offer settings</span>
      </div>
    );
  }

  if (loadError || !draft) {
    return (
      <div className="space-y-3 p-4">
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError || 'Could not load Next Visit Offer settings.'}</p>
        <button type="button" onClick={() => void load()} className="min-h-11 rounded-xl bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white">Try again</button>
      </div>
    );
  }

  const selectedServiceNames = services.filter(service => draft.eligibleServiceIds.includes(service.id)).map(service => service.name);
  const preview = draft.messageTemplate;

  const setDiscountType = (discountType: DiscountType) => {
    setValueText(null);
    update(current => ({
      ...current,
      discountType,
      value: discountType === current.discountType ? current.value : discountType === 'percent' ? 5 : 500,
    }));
    setFieldErrors(current => ({ ...current, value: undefined }));
  };

  return (
    <div className="flex min-h-full w-full min-w-0 flex-col bg-[var(--owner-ground)] text-[var(--owner-ink)]">
      <div className="sticky top-0 z-10 border-b border-[var(--owner-line)] bg-[var(--owner-ground)] px-4 py-3">
        <div className="flex min-h-11 items-center gap-2">
          {onClose && <button type="button" onClick={onClose} aria-label="Back to Offers" className="inline-flex size-11 items-center justify-center rounded-full text-[var(--owner-ink)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"><ArrowLeft className="size-5" aria-hidden="true" /></button>}
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold">Next Visit Offer</h2>
            <p className="text-[12px] text-[var(--owner-muted)]">Encourage clients to book again soon.</p>
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-4 overflow-y-auto p-3 pb-[max(6rem,env(safe-area-inset-bottom))] sm:p-4">
        <section className="rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 basis-40">
              <h3 className="text-[16px] font-semibold">Offer status</h3>
              <p className="mt-1 text-[13px] leading-5 text-[var(--owner-muted)]">After a completed appointment with a positive service value, clients can use one offer if their next appointment takes place by the deadline.</p>
            </div>
            <button type="button" role="switch" aria-checked={draft.enabled} aria-label="Turn on Next Visit Offer" onClick={() => update(current => ({ ...current, enabled: !current.enabled }))} className={`relative mt-1 min-h-11 w-12 shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] ${draft.enabled ? 'bg-[var(--owner-accent)]' : 'bg-gray-300'}`}><span aria-hidden="true" className={`absolute left-1 top-3 size-5 rounded-full bg-white shadow transition-transform ${draft.enabled ? 'translate-x-5' : ''}`} /></button>
          </div>
          <p className="mt-3 rounded-xl bg-[var(--owner-ground)] px-3 py-2 text-[13px] text-[var(--owner-muted)]">{draft.enabled ? `On · ${formatEnabledSince(status.enabledSince)}` : 'Off · no new offers will be issued.'}</p>
        </section>

        <section className="space-y-4 rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
          <div>
            <h3 className="text-[16px] font-semibold">Offer details</h3>
            <p className="mt-1 text-[13px] text-[var(--owner-muted)]">Turning this off stops new offers. Previously issued offers remain valid until their original deadline, and existing bookings stay honored. Offers do not stack with other discounts.</p>
          </div>
          <fieldset>
            <legend className="text-[14px] font-medium">Next appointment within</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {WINDOW_PRESETS.map(days => (
                <button
                  key={days}
                  type="button"
                  onClick={() => {
                    setCustomWindow(false);
                    update(current => ({ ...current, windowDays: days }));
                    setFieldErrors(current => ({ ...current, windowDays: undefined }));
                  }}
                  className={`min-h-11 rounded-xl border px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] ${!customWindow && draft.windowDays === days ? 'border-[var(--owner-accent)] bg-[var(--owner-blush)] text-[var(--owner-accent)]' : 'border-[var(--owner-line)]'}`}
                >
                  {days}
                  {' '}
                  days
                </button>
              ))}
              <button type="button" onClick={() => setCustomWindow(true)} className={`min-h-11 rounded-xl border px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] ${customWindow ? 'border-[var(--owner-accent)] bg-[var(--owner-blush)] text-[var(--owner-accent)]' : 'border-[var(--owner-line)]'}`}>Custom</button>
            </div>
            {customWindow && (
              <label className="mt-3 block text-sm font-medium">
                Custom days
                <input
                  ref={windowInputRef}
                  aria-invalid={Boolean(fieldErrors.windowDays)}
                  type="number"
                  min="1"
                  max="90"
                  value={draft.windowDays}
                  onChange={(event) => {
                    const value = parseWholeNumber(event.target.value);
                    update(current => ({ ...current, windowDays: value ?? 0 }));
                    setFieldErrors(current => ({ ...current, windowDays: undefined }));
                  }}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--owner-line)] bg-white px-3 text-base"
                />
              </label>
            )}
            {fieldErrors.windowDays && <p className="text-sm text-red-700" role="alert">{fieldErrors.windowDays}</p>}
          </fieldset>
          <fieldset>
            <legend className="text-[14px] font-medium">Discount</legend>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--owner-line)] px-3 text-sm">
                <input type="radio" name="next-visit-discount" checked={draft.discountType === 'percent'} onChange={() => setDiscountType('percent')} />
                Percentage
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--owner-line)] px-3 text-sm">
                <input type="radio" name="next-visit-discount" checked={draft.discountType === 'fixed'} onChange={() => setDiscountType('fixed')} />
                Fixed amount
              </label>
            </div>
            <label className="mt-3 block text-sm font-medium">
              {draft.discountType === 'percent' ? 'Discount percentage' : 'Discount amount'}
              <input
                ref={valueInputRef}
                aria-invalid={Boolean(fieldErrors.value)}
                inputMode="decimal"
                value={valueInput}
                onChange={(event) => {
                  const raw = event.target.value;
                  setValueText(raw);
                  const next = draft.discountType === 'percent'
                    ? parseWholeNumber(raw)
                    : parseDollarsToCents(raw);
                  update(current => ({ ...current, value: next ?? 0 }));
                  setFieldErrors(current => ({ ...current, value: undefined }));
                }}
                onBlur={() => setValueText(null)}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--owner-line)] bg-white px-3 text-base"
              />
            </label>
            {fieldErrors.value && <p className="text-sm text-red-700" role="alert">{fieldErrors.value}</p>}
          </fieldset>
          <fieldset>
            <legend className="text-[14px] font-medium">Eligible services</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setServiceMode('all');
                  update(current => ({ ...current, eligibleServiceIds: [] }));
                  setFieldErrors(current => ({ ...current, services: undefined }));
                }}
                className={`min-h-11 rounded-xl border px-3 text-sm ${serviceMode === 'all' ? 'border-[var(--owner-accent)] bg-[var(--owner-blush)] text-[var(--owner-accent)]' : 'border-[var(--owner-line)]'}`}
              >
                All services
              </button>
              <button
                type="button"
                onClick={() => {
                  setServiceMode('selected');
                  setFieldErrors(current => ({ ...current, services: undefined }));
                }}
                className={`min-h-11 rounded-xl border px-3 text-sm ${serviceMode === 'selected' ? 'border-[var(--owner-accent)] bg-[var(--owner-blush)] text-[var(--owner-accent)]' : 'border-[var(--owner-line)]'}`}
              >
                Selected services
              </button>
            </div>
            {serviceMode === 'selected' && (
              <div className="mt-3 space-y-2">
                {services.length === 0
                  ? <p className="text-sm text-[var(--owner-muted)]">No active services are available.</p>
                  : services.map(service => (
                    <label key={service.id} className="flex min-h-11 items-center gap-3 rounded-xl bg-[var(--owner-ground)] px-3 text-sm">
                      <input type="checkbox" checked={draft.eligibleServiceIds.includes(service.id)} onChange={() => update(current => ({ ...current, eligibleServiceIds: current.eligibleServiceIds.includes(service.id) ? current.eligibleServiceIds.filter(id => id !== service.id) : [...current.eligibleServiceIds, service.id] }))} />
                      {service.name}
                    </label>
                  ))}
              </div>
            )}
            {fieldErrors.services && <p className="mt-2 text-sm text-red-700" role="alert">{fieldErrors.services}</p>}
          </fieldset>
        </section>

        <section className="space-y-3 rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
          <div>
            <h3 className="text-[16px] font-semibold">Client message</h3>
            <p className="mt-1 text-[13px] text-[var(--owner-muted)]">This is the wording shown with the offer. Luster does not send promotional messages automatically.</p>
          </div>
          <label className="block text-sm font-medium">
            Message
            <textarea
              value={draft.messageTemplate}
              onChange={(event) => {
                const messageTemplate = event.target.value;
                update(current => ({ ...current, messageTemplate }));
              }}
              rows={4}
              maxLength={1000}
              className="mt-1 w-full rounded-xl border border-[var(--owner-line)] bg-white px-3 py-2 text-base"
            />
          </label>
          <div className="rounded-xl bg-[var(--owner-ground)] p-3 text-sm">
            <p className="font-medium">Preview</p>
            <p className="mt-1 break-words text-[var(--owner-muted)]">{preview || 'No extra customer message.'}</p>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
          <h3 className="text-[16px] font-semibold">Offer activity</h3>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-center min-[400px]:grid-cols-3">
            <div className="rounded-xl bg-[var(--owner-ground)] p-2">
              <dt className="text-xs text-[var(--owner-muted)]">Issued</dt>
              <dd className="mt-1 text-lg font-semibold">{status.issued}</dd>
            </div>
            <div className="rounded-xl bg-[var(--owner-ground)] p-2">
              <dt className="text-xs text-[var(--owner-muted)]">Reserved</dt>
              <dd className="mt-1 text-lg font-semibold">{status.reserved}</dd>
            </div>
            <div className="rounded-xl bg-[var(--owner-ground)] p-2">
              <dt className="text-xs text-[var(--owner-muted)]">Used</dt>
              <dd className="mt-1 text-lg font-semibold">{status.used}</dd>
            </div>
          </dl>
          {serviceMode === 'selected' && selectedServiceNames.length > 0 && (
            <p className="mt-3 text-xs text-[var(--owner-muted)]">
              {`For: ${selectedServiceNames.join(', ')}`}
            </p>
          )}
        </section>
      </div>
      <div className="sticky bottom-0 border-t border-[var(--owner-line)] bg-[var(--owner-surface)] p-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
        {saveError && <p className="mb-2 text-center text-sm text-red-700" role="alert">{saveError}</p>}
        {saved && <p className="mb-2 text-center text-sm text-emerald-700" role="status">Next Visit Offer saved.</p>}
        <button type="button" disabled={!dirty || saving} onClick={() => void save()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          <Save className="size-4" aria-hidden="true" />
          {saving ? 'Saving…' : 'Save Next Visit Offer'}
        </button>
      </div>
    </div>
  );
}
