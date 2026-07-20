'use client';

import { Save } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { formatMoney } from '@/libs/formatMoney';
import { calculateSmartFitDiscountCents } from '@/libs/smartFit';
import { SMART_FIT_LIMITS } from '@/libs/smartFitConfig';

/**
 * Owner-facing Smart Fit settings (Settings → Booking → Smart Fit discounts).
 *
 * Self-contained like ParkingInstructionsCard: loads its own data, saves ONLY
 * the `smartFit` subtree via the admin settings PATCH (single-key jsonb_set on
 * the server), and never touches other settings keys. All business rules live
 * in src/libs/smartFitConfig.ts — this surface only collects values inside the
 * shared SMART_FIT_LIMITS and shows display-only examples.
 */

type SmartFitFormState = {
  enabled: boolean;
  discountType: 'percent' | 'fixed';
  /** Typed string; percent = whole %, fixed = dollars, converted on save. */
  valueInput: string;
  maxGapInput: string;
  minImprovementInput: string;
  eligibleServiceIds: string[];
  eligibleTechnicianIds: string[];
};

type PickerOption = { id: string; name: string };

type FieldErrors = Partial<Record<'value' | 'maxGap' | 'minImprovement' | 'eligibleServices' | 'eligibleTechnicians', string>>;

/** Empty stored array = every active record; non-empty = only those listed. */
type EligibilityMode = 'all' | 'selected';

const DEFAULT_FORM: SmartFitFormState = {
  enabled: false,
  discountType: 'percent',
  valueInput: '10',
  maxGapInput: '10',
  minImprovementInput: '20',
  eligibleServiceIds: [],
  eligibleTechnicianIds: [],
};

const EXAMPLE_SERVICE_CENTS = 6500;

function parseWholeNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseCurrencyToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const cents = Math.round(Number.parseFloat(trimmed) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

type SmartFitSettingsCardProps = {
  salonSlug: string;
  onDirtyChange?: (dirty: boolean) => void;
  /** Jump to the Analytics app, where Smart Fit results live (P7.5). */
  onViewResults?: () => void;
};

export function SmartFitSettingsCard({
  salonSlug,
  onDirtyChange,
  onViewResults,
}: SmartFitSettingsCardProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState<SmartFitFormState>(DEFAULT_FORM);
  const [services, setServices] = useState<PickerOption[]>([]);
  const [technicians, setTechnicians] = useState<PickerOption[]>([]);
  const [currency, setCurrency] = useState('CAD');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Mode is derived from the persisted arrays (empty ⇒ all) but tracked
  // separately so "Only selected" can be chosen before ticking anything.
  const [serviceMode, setServiceMode] = useState<EligibilityMode>('all');
  const [technicianMode, setTechnicianMode] = useState<EligibilityMode>('all');
  const valueInputRef = useRef<HTMLInputElement>(null);
  const maxGapInputRef = useRef<HTMLInputElement>(null);
  const minImprovementInputRef = useRef<HTMLInputElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const markDirty = useCallback(
    (
      updater: (prev: SmartFitFormState) => SmartFitFormState,
      modes?: { serviceMode?: EligibilityMode; technicianMode?: EligibilityMode },
    ) => {
      setForm(updater);
      if (modes?.serviceMode) {
        setServiceMode(modes.serviceMode);
      }
      if (modes?.technicianMode) {
        setTechnicianMode(modes.technicianMode);
      }
      setDirty(true);
      setSaved(false);
      setSaveError(null);
      onDirtyChange?.(true);
    },
    [onDirtyChange],
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setLoadError(false);
        const [settingsResponse, servicesResponse, techniciansResponse]
          = await Promise.all([
            fetch(`/api/admin/salon/settings?salonSlug=${encodeURIComponent(salonSlug)}`),
            fetch(`/api/salon/services?salonSlug=${encodeURIComponent(salonSlug)}`),
            fetch(`/api/admin/technicians?salonSlug=${encodeURIComponent(salonSlug)}&status=active&limit=100`),
          ]);

        if (!settingsResponse.ok || !servicesResponse.ok || !techniciansResponse.ok) {
          throw new Error('Failed to load Smart Fit settings');
        }

        const settingsData = await settingsResponse.json();
        const servicesData = await servicesResponse.json();
        const techniciansData = await techniciansResponse.json();

        if (cancelled) {
          return;
        }

        const stored = settingsData.smartFit ?? {};
        const discountType: 'percent' | 'fixed'
          = stored.discountType === 'fixed' ? 'fixed' : 'percent';
        setForm({
          enabled: stored.enabled === true,
          discountType,
          valueInput:
            typeof stored.value === 'number' && stored.value > 0
              ? discountType === 'fixed'
                ? (stored.value / 100).toFixed(2)
                : String(stored.value)
              : DEFAULT_FORM.valueInput,
          maxGapInput:
            typeof stored.maxRemainingGapMinutes === 'number'
              ? String(stored.maxRemainingGapMinutes)
              : DEFAULT_FORM.maxGapInput,
          minImprovementInput:
            typeof stored.minImprovementMinutes === 'number'
              ? String(stored.minImprovementMinutes)
              : DEFAULT_FORM.minImprovementInput,
          eligibleServiceIds: Array.isArray(stored.eligibleServiceIds)
            ? [...new Set((stored.eligibleServiceIds as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0))]
            : [],
          eligibleTechnicianIds: Array.isArray(stored.eligibleTechnicianIds)
            ? [...new Set((stored.eligibleTechnicianIds as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0))]
            : [],
        });
        // Reconstruct the mode from what was persisted.
        setServiceMode(
          Array.isArray(stored.eligibleServiceIds) && stored.eligibleServiceIds.length > 0 ? 'selected' : 'all',
        );
        setTechnicianMode(
          Array.isArray(stored.eligibleTechnicianIds) && stored.eligibleTechnicianIds.length > 0 ? 'selected' : 'all',
        );
        setCurrency(settingsData.bookingConfig?.currency ?? 'CAD');
        setServices(
          (servicesData.data?.services ?? []).map(
            (service: { id: string; name: string }) => ({ id: service.id, name: service.name }),
          ),
        );
        setTechnicians(
          (techniciansData.data?.technicians ?? []).map(
            (technician: { id: string; name: string }) => ({ id: technician.id, name: technician.name }),
          ),
        );
        setDirty(false);
        onDirtyChange?.(false);
      } catch (error) {
        console.error('Failed to load Smart Fit settings:', error);
        if (!cancelled) {
          setLoadError(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [salonSlug, onDirtyChange]);

  const validate = useCallback((): { errors: FieldErrors; valueForSave: number | null } => {
    const errors: FieldErrors = {};
    let valueForSave: number | null = null;

    if (form.discountType === 'percent') {
      const percent = parseWholeNumber(form.valueInput);
      if (percent === null || percent <= 0) {
        errors.value = 'Enter a whole percentage greater than 0.';
      } else if (percent > SMART_FIT_LIMITS.percentMax) {
        errors.value = `Percentage cannot exceed ${SMART_FIT_LIMITS.percentMax}%.`;
      } else {
        valueForSave = percent;
      }
    } else {
      const cents = parseCurrencyToCents(form.valueInput);
      if (cents === null || cents <= 0) {
        errors.value = 'Enter an amount greater than 0, like 5 or 7.50.';
      } else if (cents > SMART_FIT_LIMITS.fixedCentsMax) {
        errors.value = 'Amount is too large.';
      } else {
        valueForSave = cents;
      }
    }

    const maxGap = parseWholeNumber(form.maxGapInput);
    if (maxGap === null || maxGap > SMART_FIT_LIMITS.maxRemainingGapMinutesMax) {
      errors.maxGap = `Enter whole minutes from 0 to ${SMART_FIT_LIMITS.maxRemainingGapMinutesMax}.`;
    }

    const minImprovement = parseWholeNumber(form.minImprovementInput);
    if (minImprovement === null || minImprovement > SMART_FIT_LIMITS.minImprovementMinutesMax) {
      errors.minImprovement = `Enter whole minutes from 0 to ${SMART_FIT_LIMITS.minImprovementMinutesMax}.`;
    }

    // "Only selected" with nothing ticked would persist an empty array, which
    // the backend reads as "all" — the exact opposite of the owner's intent.
    if (form.enabled && serviceMode === 'selected' && form.eligibleServiceIds.length === 0) {
      errors.eligibleServices = 'Select at least one service, or choose All active services.';
    }
    if (form.enabled && technicianMode === 'selected' && form.eligibleTechnicianIds.length === 0) {
      errors.eligibleTechnicians = 'Select at least one technician, or choose All active technicians.';
    }

    return { errors, valueForSave };
  }, [form, serviceMode, technicianMode]);

  /** Plain-language recap of exactly what will be saved. */
  const eligibilitySummary = (() => {
    if (!form.enabled) {
      return 'Smart Fit is currently turned off.';
    }
    const serviceText = serviceMode === 'all'
      ? 'all services'
      : `${form.eligibleServiceIds.length} selected ${form.eligibleServiceIds.length === 1 ? 'service' : 'services'}`;
    const selectedTechnicians = technicians.filter(technician => form.eligibleTechnicianIds.includes(technician.id));
    const technicianText = technicianMode === 'all'
      ? 'all technicians'
      : selectedTechnicians.length > 0 && selectedTechnicians.length <= 3
        ? selectedTechnicians.map(technician => technician.name).join(', ')
        : `${form.eligibleTechnicianIds.length} selected technicians`;
    return `Active for ${serviceText} and ${technicianText}.`;
  })();

  const focusFirstInvalid = (errors: FieldErrors) => {
    if (errors.value) {
      valueInputRef.current?.focus();
    } else if (errors.maxGap) {
      maxGapInputRef.current?.focus();
    } else if (errors.minImprovement) {
      minImprovementInputRef.current?.focus();
    }
  };

  const save = useCallback(async () => {
    if (saving) {
      return;
    }

    const { errors, valueForSave } = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || valueForSave === null) {
      focusFirstInvalid(errors);
      return;
    }

    try {
      setSaving(true);
      setSaved(false);
      setSaveError(null);
      const response = await fetch(
        `/api/admin/salon/settings?salonSlug=${encodeURIComponent(salonSlug)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            smartFit: {
              enabled: form.enabled,
              discountType: form.discountType,
              value: valueForSave,
              maxRemainingGapMinutes: parseWholeNumber(form.maxGapInput),
              minImprovementMinutes: parseWholeNumber(form.minImprovementInput),
              // Stale saved ids ride along untouched — pruning them here could
              // silently flip an emptied list to "all services eligible".
              eligibleServiceIds: form.eligibleServiceIds,
              eligibleTechnicianIds: form.eligibleTechnicianIds,
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error('Failed to save Smart Fit settings');
      }

      // Success is only claimed after the server confirms persistence.
      setSaved(true);
      setDirty(false);
      onDirtyChange?.(false);
    } catch (error) {
      console.error('Failed to save Smart Fit settings:', error);
      setSaveError('Could not save Smart Fit settings. Your changes are still here — please try again.');
    } finally {
      setSaving(false);
    }
  }, [form, onDirtyChange, salonSlug, saving, validate]);

  const activeServiceIds = new Set(services.map(service => service.id));
  const activeTechnicianIds = new Set(technicians.map(technician => technician.id));
  const staleServiceCount = form.eligibleServiceIds.filter(id => !activeServiceIds.has(id)).length;
  const staleTechnicianCount = form.eligibleTechnicianIds.filter(id => !activeTechnicianIds.has(id)).length;

  const exampleParsed = form.discountType === 'percent'
    ? parseWholeNumber(form.valueInput)
    : parseCurrencyToCents(form.valueInput);
  // Display-only preview via the shared calculator — never booking authority.
  const exampleDiscountCents = exampleParsed && exampleParsed > 0
    ? calculateSmartFitDiscountCents(
      { enabled: true, discountType: form.discountType, value: exampleParsed },
      EXAMPLE_SERVICE_CENTS,
    )
    : null;

  const toggleId = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter(existing => existing !== id) : [...list, id];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent motion-reduce:animate-none" />
        <span className="sr-only">Loading Smart Fit settings</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-4 text-sm text-red-600" role="alert">
        Could not load Smart Fit settings. Please close and reopen Settings.
      </div>
    );
  }

  const fieldsDisabled = !form.enabled;

  return (
    <div className="space-y-4 p-4">
      <p className="text-sm text-gray-700">
        Smart Fit can offer customers a discount for choosing times that reduce
        gaps in your schedule.
      </p>

      {onViewResults && (
        <div>
          <button
            type="button"
            data-testid="smart-fit-view-results"
            onClick={onViewResults}
            disabled={dirty}
            className="text-sm font-semibold text-rose-800 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline"
          >
            View Smart Fit results
          </button>
          {dirty && (
            <p data-testid="smart-fit-view-results-blocked" className="mt-1 text-xs text-gray-500">
              Save or discard your changes first — results open in the
              Analytics app and leaving now would drop unsaved settings.
            </p>
          )}
        </div>
      )}

      <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3">
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Smart Fit discounts
          </span>
          <p className="text-sm text-gray-700">
            Offer a discount on times that tighten your schedule.
          </p>
        </div>
        <input
          type="checkbox"
          role="switch"
          aria-checked={form.enabled}
          data-testid="smart-fit-enabled"
          checked={form.enabled}
          onChange={event =>
            markDirty(prev => ({ ...prev, enabled: event.target.checked }))}
          className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
        />
      </label>

      {fieldsDisabled && (
        <p
          data-testid="smart-fit-inactive-note"
          className="rounded-[10px] bg-gray-50 p-3 text-xs text-gray-600"
        >
          Smart Fit is off. The settings below are kept but inactive — no new
          Smart Fit offers are shown to customers. Existing bookings keep the
          discount they were booked with.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2" aria-disabled={fieldsDisabled}>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Discount type
          </span>
          <select
            data-testid="smart-fit-discount-type"
            value={form.discountType}
            disabled={fieldsDisabled}
            onChange={event =>
              markDirty(prev => ({
                ...prev,
                discountType: event.target.value === 'fixed' ? 'fixed' : 'percent',
                valueInput: '',
              }))}
            className="h-11 rounded-[10px] border border-gray-200 bg-white px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF] disabled:bg-gray-50 disabled:text-gray-500"
          >
            <option value="percent">Percentage</option>
            <option value="fixed">Fixed amount</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {form.discountType === 'percent' ? 'Discount percentage' : 'Discount amount'}
          </span>
          <div className="relative">
            <input
              ref={valueInputRef}
              type="text"
              inputMode="decimal"
              data-testid="smart-fit-value"
              aria-invalid={fieldErrors.value ? true : undefined}
              aria-describedby={fieldErrors.value ? 'smart-fit-value-error' : undefined}
              value={form.valueInput}
              disabled={fieldsDisabled}
              onChange={event =>
                markDirty(prev => ({
                  ...prev,
                  valueInput: event.target.value.replace(/[^0-9.]/g, ''),
                }))}
              placeholder={form.discountType === 'percent' ? '10' : '5.00'}
              className="h-11 w-full rounded-[10px] border border-gray-200 px-3 pr-10 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF] disabled:bg-gray-50 disabled:text-gray-500"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-gray-500">
              {form.discountType === 'percent' ? '%' : currency}
            </span>
          </div>
          {fieldErrors.value && (
            <p id="smart-fit-value-error" role="alert" className="text-xs text-red-600">
              {fieldErrors.value}
            </p>
          )}
        </label>

        <p className="text-xs text-gray-500 sm:col-span-2" data-testid="smart-fit-example">
          {exampleDiscountCents !== null
            ? `Example: A ${formatMoney(EXAMPLE_SERVICE_CENTS, currency)} service with this Smart Fit discount would be ${formatMoney(EXAMPLE_SERVICE_CENTS - exampleDiscountCents, currency)}.`
            : 'Enter a discount to see an example.'}
        </p>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Maximum remaining gap
          </span>
          <div className="relative">
            <input
              ref={maxGapInputRef}
              type="text"
              inputMode="numeric"
              data-testid="smart-fit-max-gap"
              aria-invalid={fieldErrors.maxGap ? true : undefined}
              aria-describedby={
                fieldErrors.maxGap
                  ? 'smart-fit-max-gap-error'
                  : 'smart-fit-max-gap-help'
              }
              value={form.maxGapInput}
              disabled={fieldsDisabled}
              onChange={event =>
                markDirty(prev => ({
                  ...prev,
                  maxGapInput: event.target.value.replace(/\D/g, ''),
                }))}
              className="h-11 w-full rounded-[10px] border border-gray-200 px-3 pr-12 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF] disabled:bg-gray-50 disabled:text-gray-500"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-gray-500">
              min
            </span>
          </div>
          <p id="smart-fit-max-gap-help" className="text-xs text-gray-500">
            The largest gap that may remain beside the appointment after
            applying Smart Fit.
          </p>
          {fieldErrors.maxGap && (
            <p id="smart-fit-max-gap-error" role="alert" className="text-xs text-red-600">
              {fieldErrors.maxGap}
            </p>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Minimum schedule improvement
          </span>
          <div className="relative">
            <input
              ref={minImprovementInputRef}
              type="text"
              inputMode="numeric"
              data-testid="smart-fit-min-improvement"
              aria-invalid={fieldErrors.minImprovement ? true : undefined}
              aria-describedby={
                fieldErrors.minImprovement
                  ? 'smart-fit-min-improvement-error'
                  : 'smart-fit-min-improvement-help'
              }
              value={form.minImprovementInput}
              disabled={fieldsDisabled}
              onChange={event =>
                markDirty(prev => ({
                  ...prev,
                  minImprovementInput: event.target.value.replace(/\D/g, ''),
                }))}
              className="h-11 w-full rounded-[10px] border border-gray-200 px-3 pr-12 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF] disabled:bg-gray-50 disabled:text-gray-500"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-gray-500">
              min
            </span>
          </div>
          <p id="smart-fit-min-improvement-help" className="text-xs text-gray-500">
            How many minutes the schedule must improve before Smart Fit can be
            offered.
          </p>
          {fieldErrors.minImprovement && (
            <p id="smart-fit-min-improvement-error" role="alert" className="text-xs text-red-600">
              {fieldErrors.minImprovement}
            </p>
          )}
        </label>
      </div>

      <fieldset disabled={fieldsDisabled} className="rounded-[10px] border border-gray-200 p-3 disabled:opacity-80">
        <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Eligible services
        </legend>
        {/* Explicit modes: an empty stored array means "all", which reads as
            "none" when the only control is a set of unchecked boxes. */}
        <div className="mt-2 grid grid-cols-2 gap-1 rounded-full bg-gray-100 p-1" role="radiogroup" aria-label="Smart Fit service eligibility">
          <button
            type="button"
            role="radio"
            aria-checked={serviceMode === 'all'}
            data-testid="smart-fit-services-mode-all"
            onClick={() => markDirty(prev => ({ ...prev, eligibleServiceIds: [] }), { serviceMode: 'all' })}
            className={`rounded-full px-3 py-2 text-[13px] font-semibold transition-all ${
              serviceMode === 'all' ? 'bg-white text-[#1C1C1E] shadow-sm' : 'text-[#8E8E93]'
            }`}
          >
            All active services
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={serviceMode === 'selected'}
            data-testid="smart-fit-services-mode-selected"
            onClick={() => markDirty(prev => ({
              ...prev,
              // Entering selected mode with nothing chosen must not silently
              // mean "all" — the save guard below requires a choice.
              eligibleServiceIds: prev.eligibleServiceIds,
            }), { serviceMode: 'selected' })}
            className={`rounded-full px-3 py-2 text-[13px] font-semibold transition-all ${
              serviceMode === 'selected' ? 'bg-white text-[#1C1C1E] shadow-sm' : 'text-[#8E8E93]'
            }`}
          >
            Only selected services
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {serviceMode === 'all'
            ? 'Smart Fit can apply to every active service, including ones you add later.'
            : 'Smart Fit applies only to the services you tick below.'}
        </p>
        {serviceMode === 'selected' && services.length > 0 && (
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              data-testid="smart-fit-services-select-all"
              onClick={() =>
                markDirty(prev => ({
                  ...prev,
                  eligibleServiceIds: [...new Set([
                    ...prev.eligibleServiceIds,
                    ...services.map(service => service.id),
                  ])],
                }), { serviceMode: 'selected' })}
              className="text-xs font-medium text-rose-800 underline"
            >
              Select every service
            </button>
            <button
              type="button"
              data-testid="smart-fit-services-clear"
              onClick={() =>
                markDirty(prev => ({ ...prev, eligibleServiceIds: [] }), { serviceMode: 'selected' })}
              className="text-xs font-medium text-rose-800 underline"
            >
              Remove all selected services
            </button>
          </div>
        )}
        {fieldErrors.eligibleServices && (
          <p data-testid="smart-fit-services-error" role="alert" className="mt-2 text-xs text-red-600">
            {fieldErrors.eligibleServices}
          </p>
        )}
        {serviceMode === 'selected' && services.length > 0
          ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {services.map(service => (
                  <label
                    key={service.id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] bg-gray-50 px-3 py-2.5"
                  >
                    <input
                      type="checkbox"
                      aria-label={`Smart Fit eligible service: ${service.name}`}
                      checked={form.eligibleServiceIds.includes(service.id)}
                      onChange={() =>
                        markDirty(prev => ({
                          ...prev,
                          eligibleServiceIds: toggleId(prev.eligibleServiceIds, service.id),
                        }))}
                      className="size-5 shrink-0 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                    />
                    <span className="min-w-0 break-words text-sm text-gray-800">{service.name}</span>
                  </label>
                ))}
              </div>
            )
          : (
              <p className="mt-3 rounded-[10px] bg-gray-50 p-3 text-xs text-gray-600">
                No active services found. With nothing selected, Smart Fit
                applies to all services.
              </p>
            )}
        {staleServiceCount > 0 && (
          <p data-testid="smart-fit-stale-services" className="mt-2 text-xs text-amber-700">
            {staleServiceCount}
            {' '}
            previously selected service
            {staleServiceCount === 1 ? ' is' : 's are'}
            {' '}
            no longer active. They stay saved but inactive services are never
            offered or re-activated by Smart Fit.
          </p>
        )}
      </fieldset>

      <fieldset disabled={fieldsDisabled} className="rounded-[10px] border border-gray-200 p-3 disabled:opacity-80">
        <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Eligible technicians
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-1 rounded-full bg-gray-100 p-1" role="radiogroup" aria-label="Smart Fit technician eligibility">
          <button
            type="button"
            role="radio"
            aria-checked={technicianMode === 'all'}
            data-testid="smart-fit-technicians-mode-all"
            onClick={() => markDirty(prev => ({ ...prev, eligibleTechnicianIds: [] }), { technicianMode: 'all' })}
            className={`rounded-full px-3 py-2 text-[13px] font-semibold transition-all ${
              technicianMode === 'all' ? 'bg-white text-[#1C1C1E] shadow-sm' : 'text-[#8E8E93]'
            }`}
          >
            All active technicians
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={technicianMode === 'selected'}
            data-testid="smart-fit-technicians-mode-selected"
            onClick={() => markDirty(prev => prev, { technicianMode: 'selected' })}
            className={`rounded-full px-3 py-2 text-[13px] font-semibold transition-all ${
              technicianMode === 'selected' ? 'bg-white text-[#1C1C1E] shadow-sm' : 'text-[#8E8E93]'
            }`}
          >
            Only selected technicians
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {technicianMode === 'all'
            ? 'Smart Fit can apply to every active technician, including ones you add later.'
            : 'Smart Fit applies only to the technicians you tick below.'}
        </p>
        {technicianMode === 'selected' && technicians.length > 0 && (
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              data-testid="smart-fit-technicians-select-all"
              onClick={() =>
                markDirty(prev => ({
                  ...prev,
                  eligibleTechnicianIds: [...new Set([
                    ...prev.eligibleTechnicianIds,
                    ...technicians.map(technician => technician.id),
                  ])],
                }), { technicianMode: 'selected' })}
              className="text-xs font-medium text-rose-800 underline"
            >
              Select every technician
            </button>
            <button
              type="button"
              data-testid="smart-fit-technicians-clear"
              onClick={() =>
                markDirty(prev => ({ ...prev, eligibleTechnicianIds: [] }), { technicianMode: 'selected' })}
              className="text-xs font-medium text-rose-800 underline"
            >
              Remove all selected technicians
            </button>
          </div>
        )}
        {fieldErrors.eligibleTechnicians && (
          <p data-testid="smart-fit-technicians-error" role="alert" className="mt-2 text-xs text-red-600">
            {fieldErrors.eligibleTechnicians}
          </p>
        )}
        {technicianMode === 'selected' && technicians.length > 0
          ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {technicians.map(technician => (
                  <label
                    key={technician.id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] bg-gray-50 px-3 py-2.5"
                  >
                    <input
                      type="checkbox"
                      aria-label={`Smart Fit eligible technician: ${technician.name}`}
                      checked={form.eligibleTechnicianIds.includes(technician.id)}
                      onChange={() =>
                        markDirty(prev => ({
                          ...prev,
                          eligibleTechnicianIds: toggleId(prev.eligibleTechnicianIds, technician.id),
                        }))}
                      className="size-5 shrink-0 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                    />
                    <span className="min-w-0 break-words text-sm text-gray-800">{technician.name}</span>
                  </label>
                ))}
              </div>
            )
          : (
              <p className="mt-3 rounded-[10px] bg-gray-50 p-3 text-xs text-gray-600">
                No active technicians found. With nothing selected, Smart Fit
                includes all technicians.
              </p>
            )}
        {staleTechnicianCount > 0 && (
          <p data-testid="smart-fit-stale-technicians" className="mt-2 text-xs text-amber-700">
            {staleTechnicianCount}
            {' '}
            previously selected technician
            {staleTechnicianCount === 1 ? ' is' : 's are'}
            {' '}
            no longer active. They stay saved but inactive technicians never
            receive Smart Fit offers.
          </p>
        )}
      </fieldset>

      <div className="rounded-[10px] bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">
        <p>How Smart Fit works:</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>The offer only appears when a time actually improves your schedule.</li>
          <li>Existing campaign, reward, and first-visit discounts take priority.</li>
          <li>Smart Fit never moves appointments — customers still choose and confirm their time.</li>
          <li>Turning Smart Fit off stops new offers without changing existing bookings.</li>
        </ul>
      </div>

      <div
        data-testid="smart-fit-summary"
        className="rounded-[10px] bg-gray-50 px-3 py-2 text-[13px] font-medium text-[#1C1C1E]"
      >
        {eligibilitySummary}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
        <div className="text-xs text-gray-500">
          Applies to new bookings only — booked discounts are never
          recalculated.
        </div>
        <button
          type="button"
          data-testid="smart-fit-save"
          onClick={() => void save()}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="size-4" />
          <span>{saving ? 'Saving...' : 'Save Smart Fit settings'}</span>
        </button>
      </div>

      <div ref={errorSummaryRef} aria-live="polite">
        {saved && (
          <div data-testid="smart-fit-saved" className="text-right text-xs font-medium text-green-600">
            Smart Fit settings saved.
          </div>
        )}
        {saveError && (
          <div data-testid="smart-fit-save-error" role="alert" className="text-right text-xs font-medium text-red-600">
            {saveError}
          </div>
        )}
      </div>
    </div>
  );
}
