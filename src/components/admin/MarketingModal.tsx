'use client';

import {
  BellRing,
  Check,
  Gift,
  Loader2,
  MapPin,
  RefreshCw,
  Save,
  Star,
} from 'lucide-react';
import {
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useSalon } from '@/providers/SalonProvider';
import type {
  RetentionPromotionSettings,
  RetentionSettings,
  RetentionStage,
} from '@/types/retention';

import { BackButton, ModalHeader } from './AppModal';

type MarketingModalProps = {
  onClose: () => void;
  initialPromotionStage?: Extract<
    RetentionStage,
    'promo_6w' | 'promo_8w'
  > | null;
};

type AvailableService = {
  id: string;
  name: string;
};

type SettingsResponse = {
  data?: {
    settings?: RetentionSettings;
    availableServices?: AvailableService[];
  };
  error?: string | { message?: string };
  message?: string;
};

type ValidationErrors = Partial<Record<
  | 'defaultRebookDays'
  | 'reminderLeadHours'
  | 'googleReviewUrl'
  | 'sixWeekPromotion'
  | 'eightWeekPromotion',
  string
>>;

const PROMOTION_PLACEHOLDERS = [
  '{firstName}',
  '{salonName}',
  '{offer}',
  '{expiry}',
  '{bookingLink}',
];

function getErrorMessage(payload: SettingsResponse | null, fallback: string) {
  if (typeof payload?.error === 'string') {
    return payload.error;
  }
  return payload?.error?.message || payload?.message || fallback;
}

function isHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validatePromotion(
  promotion: RetentionPromotionSettings,
  label: string,
) {
  if (!promotion.enabled) {
    return null;
  }
  if (!promotion.name.trim()) {
    return `${label} needs a promotion name.`;
  }
  if (promotion.value <= 0) {
    return `${label} needs a discount greater than zero.`;
  }
  if (promotion.discountType === 'percent' && promotion.value > 100) {
    return `${label} percentage cannot exceed 100%.`;
  }
  if (promotion.expiryDays < 1 || promotion.expiryDays > 365) {
    return `${label} expiry must be between 1 and 365 days.`;
  }
  if (!promotion.messageTemplate.trim()) {
    return `${label} needs a message template.`;
  }
  if (!promotion.messageTemplate.includes('{bookingLink}')) {
    return `${label} message must include {bookingLink}.`;
  }
  return null;
}

function validateRetentionSettings(settings: RetentionSettings) {
  const errors: ValidationErrors = {};

  if (settings.defaultRebookDays < 1 || settings.defaultRebookDays > 365) {
    errors.defaultRebookDays = 'Rebooking interval must be between 1 and 365 days.';
  }
  if (settings.reminderLeadHours < 1 || settings.reminderLeadHours > 168) {
    errors.reminderLeadHours = 'Reminder timing must be between 1 and 168 hours.';
  }
  if (settings.googleReviewUrl && !isHttpsUrl(settings.googleReviewUrl)) {
    errors.googleReviewUrl = 'Enter a complete review link beginning with https://.';
  }

  const sixWeekError = validatePromotion(settings.sixWeekPromotion, 'Six-week promotion');
  if (sixWeekError) {
    errors.sixWeekPromotion = sixWeekError;
  }

  const eightWeekError = validatePromotion(settings.eightWeekPromotion, 'Eight-week promotion');
  if (eightWeekError) {
    errors.eightWeekPromotion = eightWeekError;
  }

  if (settings.sixWeekPromotion.enabled && settings.eightWeekPromotion.enabled) {
    if (settings.sixWeekPromotion.discountType !== settings.eightWeekPromotion.discountType) {
      errors.eightWeekPromotion = 'Use the same discount type for both offers so their value can be compared.';
    } else if (settings.eightWeekPromotion.value < settings.sixWeekPromotion.value) {
      errors.eightWeekPromotion = 'The eight-week offer must be at least as large as the six-week offer.';
    }
  }

  return errors;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) {
    return null;
  }
  return (
    <p id={id} role="alert" className="mt-2 text-[13px] font-medium text-[#D70015]">
      {message}
    </p>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  suffix,
  hint,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  hint: string;
  error?: string;
  onChange: (value: number) => void;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <label htmlFor={id} className="block">
      <span className="text-[15px] font-semibold text-[#1C1C1E]">{label}</span>
      <span className="mt-2 flex items-center overflow-hidden rounded-[12px] border border-[#D1D1D6] bg-white focus-within:border-[#007AFF] focus-within:ring-2 focus-within:ring-[#007AFF]/15">
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          inputMode="numeric"
          value={value}
          aria-label={label}
          aria-invalid={Boolean(error)}
          aria-describedby={`${hintId}${error ? ` ${errorId}` : ''}`}
          onChange={event => onChange(Number(event.target.value))}
          className="min-w-0 flex-1 bg-transparent p-3 text-[17px] text-[#1C1C1E] outline-none"
        />
        <span className="pr-3 text-[15px] text-[#8E8E93]">{suffix}</span>
      </span>
      <span id={hintId} className="mt-1.5 block text-[12px] leading-relaxed text-[#8E8E93]">
        {hint}
      </span>
      <FieldError id={errorId} message={error} />
    </label>
  );
}

function PromotionEditor({
  stage,
  title,
  description,
  promotion,
  services,
  error,
  highlighted = false,
  sectionRef,
  onChange,
}: {
  stage: 'six-week' | 'eight-week';
  title: string;
  description: string;
  promotion: RetentionPromotionSettings;
  services: AvailableService[];
  error?: string;
  highlighted?: boolean;
  sectionRef?: Ref<HTMLElement>;
  onChange: (promotion: RetentionPromotionSettings) => void;
}) {
  const update = <Key extends keyof RetentionPromotionSettings>(
    key: Key,
    value: RetentionPromotionSettings[Key],
  ) => onChange({ ...promotion, [key]: value });
  const idPrefix = `${stage}-promotion`;
  const displayValue = promotion.discountType === 'fixed'
    ? promotion.value / 100
    : promotion.value;

  const toggleService = (serviceId: string) => {
    const selected = promotion.eligibleServiceIds.includes(serviceId);
    update(
      'eligibleServiceIds',
      selected
        ? promotion.eligibleServiceIds.filter(id => id !== serviceId)
        : [...promotion.eligibleServiceIds, serviceId],
    );
  };

  const changeDiscountType = (discountType: RetentionPromotionSettings['discountType']) => {
    if (discountType === promotion.discountType) {
      return;
    }
    const value = discountType === 'fixed'
      ? Math.round(promotion.value * 100)
      : Math.min(100, Number((promotion.value / 100).toFixed(2)));
    onChange({ ...promotion, discountType, value });
  };

  return (
    <section
      ref={sectionRef}
      id={idPrefix}
      tabIndex={-1}
      aria-label={`${title} promotion settings`}
      data-highlighted={highlighted ? 'true' : undefined}
      className={`scroll-mt-24 overflow-hidden rounded-[20px] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)] outline-none transition-shadow ${highlighted ? 'ring-2 ring-[#007AFF] ring-offset-2' : ''}`}
    >
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Gift className={`size-5 ${stage === 'eight-week' ? 'text-[#AF52DE]' : 'text-[#FF9500]'}`} />
            <h2 className="text-[18px] font-semibold text-[#1C1C1E]">{title}</h2>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-[#8E8E93]">{description}</p>
        </div>
        <label className="relative mt-1 inline-flex shrink-0 cursor-pointer items-center">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={promotion.enabled}
            aria-label={`Enable ${title}`}
            onChange={event => update('enabled', event.target.checked)}
          />
          <span className="h-[31px] w-[51px] rounded-full bg-[#E5E5EA] transition-colors after:absolute after:left-[2px] after:top-[2px] after:size-[27px] after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-[#34C759] peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-[#007AFF] peer-focus-visible:ring-offset-2" />
        </label>
      </div>

      {promotion.enabled && (
        <div className="space-y-5 border-t border-[#E5E5EA] p-4">
          <label htmlFor={`${idPrefix}-name`} className="block">
            <span className="text-[13px] font-medium uppercase tracking-wide text-[#8E8E93]">Promotion name</span>
            <input
              id={`${idPrefix}-name`}
              type="text"
              value={promotion.name}
              onChange={event => update('name', event.target.value)}
              className="mt-2 w-full rounded-[12px] border border-[#D1D1D6] p-3 text-[16px] text-[#1C1C1E] outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/15"
              placeholder="We miss you"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label htmlFor={`${idPrefix}-type`} className="block">
              <span className="text-[13px] font-medium uppercase tracking-wide text-[#8E8E93]">Discount type</span>
              <select
                id={`${idPrefix}-type`}
                aria-label={`${title} discount type`}
                value={promotion.discountType}
                onChange={event => changeDiscountType(event.target.value as RetentionPromotionSettings['discountType'])}
                className="mt-2 w-full rounded-[12px] border border-[#D1D1D6] bg-white p-3 text-[16px] text-[#1C1C1E] outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/15"
              >
                <option value="percent">Percentage</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </label>

            <label htmlFor={`${idPrefix}-value`} className="block">
              <span className="text-[13px] font-medium uppercase tracking-wide text-[#8E8E93]">Discount</span>
              <span className="mt-2 flex items-center rounded-[12px] border border-[#D1D1D6] focus-within:border-[#007AFF] focus-within:ring-2 focus-within:ring-[#007AFF]/15">
                {promotion.discountType === 'fixed' && <span className="pl-3 text-[16px] text-[#8E8E93]">$</span>}
                <input
                  id={`${idPrefix}-value`}
                  aria-label={`${title} discount`}
                  type="number"
                  min="0"
                  max={promotion.discountType === 'percent' ? 100 : undefined}
                  step={promotion.discountType === 'fixed' ? '0.01' : '1'}
                  inputMode="decimal"
                  value={displayValue}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    update('value', promotion.discountType === 'fixed' ? Math.round(next * 100) : next);
                  }}
                  className="min-w-0 flex-1 bg-transparent p-3 text-[16px] text-[#1C1C1E] outline-none"
                />
                {promotion.discountType === 'percent' && <span className="pr-3 text-[16px] text-[#8E8E93]">%</span>}
              </span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label htmlFor={`${idPrefix}-expiry`} className="block">
              <span className="text-[13px] font-medium uppercase tracking-wide text-[#8E8E93]">Expires after</span>
              <span className="mt-2 flex items-center rounded-[12px] border border-[#D1D1D6] focus-within:border-[#007AFF] focus-within:ring-2 focus-within:ring-[#007AFF]/15">
                <input
                  id={`${idPrefix}-expiry`}
                  type="number"
                  min="1"
                  max="365"
                  inputMode="numeric"
                  value={promotion.expiryDays}
                  onChange={event => update('expiryDays', Number(event.target.value))}
                  className="min-w-0 flex-1 bg-transparent p-3 text-[16px] text-[#1C1C1E] outline-none"
                />
                <span className="pr-3 text-[14px] text-[#8E8E93]">days</span>
              </span>
            </label>

            <label htmlFor={`${idPrefix}-code`} className="block">
              <span className="text-[13px] font-medium uppercase tracking-wide text-[#8E8E93]">Code (optional)</span>
              <input
                id={`${idPrefix}-code`}
                type="text"
                value={promotion.code || ''}
                maxLength={40}
                onChange={event => update('code', event.target.value.toUpperCase() || null)}
                className="mt-2 w-full rounded-[12px] border border-[#D1D1D6] p-3 text-[16px] uppercase text-[#1C1C1E] outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/15"
                placeholder="WELCOME20"
              />
            </label>
          </div>

          <fieldset>
            <legend className="text-[13px] font-medium uppercase tracking-wide text-[#8E8E93]">Eligible services</legend>
            <p className="mt-1 text-[12px] text-[#8E8E93]">Leave every service unchecked to allow the offer on all services.</p>
            {services.length > 0
              ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {services.map(service => (
                      <label key={service.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] bg-[#F2F2F7] px-3 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`${title}: ${service.name}`}
                          checked={promotion.eligibleServiceIds.includes(service.id)}
                          onChange={() => toggleService(service.id)}
                          className="size-5 rounded border-[#C7C7CC] text-[#007AFF] focus:ring-[#007AFF]"
                        />
                        <span className="text-[15px] text-[#1C1C1E]">{service.name}</span>
                      </label>
                    ))}
                  </div>
                )
              : (
                  <p className="mt-3 rounded-[12px] bg-[#F2F2F7] p-3 text-[13px] text-[#636366]">
                    No active services are available. This offer will apply to all services.
                  </p>
                )}
          </fieldset>

          <label htmlFor={`${idPrefix}-message`} className="block">
            <span className="text-[13px] font-medium uppercase tracking-wide text-[#8E8E93]">Message template</span>
            <textarea
              id={`${idPrefix}-message`}
              value={promotion.messageTemplate}
              onChange={event => update('messageTemplate', event.target.value)}
              rows={5}
              className="mt-2 w-full resize-y rounded-[12px] border border-[#D1D1D6] p-3 text-[15px] leading-relaxed text-[#1C1C1E] outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/15"
            />
            <span className="mt-2 block text-[12px] leading-relaxed text-[#8E8E93]">
              Available:
              {' '}
              {PROMOTION_PLACEHOLDERS.join(', ')}
              . Include
              {' '}
              {'{bookingLink}'}
              {' '}
              so clients can book.
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-[12px] bg-[#F2F2F7] p-3">
            <input
              type="checkbox"
              checked={promotion.singleUse}
              onChange={event => update('singleUse', event.target.checked)}
              className="mt-0.5 size-5 rounded border-[#C7C7CC] text-[#007AFF] focus:ring-[#007AFF]"
            />
            <span>
              <span className="block text-[15px] font-medium text-[#1C1C1E]">Single-use promotion</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-[#8E8E93]">Each eligible client can redeem this campaign once.</span>
            </span>
          </label>

          <FieldError id={`${idPrefix}-error`} message={error} />
        </div>
      )}
    </section>
  );
}

export function MarketingModal({
  onClose,
  initialPromotionStage = null,
}: MarketingModalProps) {
  const { salonSlug } = useSalon();
  const sixWeekPromotionRef = useRef<HTMLElement>(null);
  const eightWeekPromotionRef = useRef<HTMLElement>(null);
  const focusedPromotionStageRef = useRef<MarketingModalProps['initialPromotionStage']>(null);
  const [settings, setSettings] = useState<RetentionSettings | null>(null);
  const [savedSettings, setSavedSettings] = useState<RetentionSettings | null>(null);
  const [services, setServices] = useState<AvailableService[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});

  const loadSettings = useCallback(async () => {
    if (!salonSlug) {
      setLoadError('Choose a salon before editing retention settings.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/admin/retention/settings?salonSlug=${encodeURIComponent(salonSlug)}`);
      const payload = await response.json().catch(() => null) as SettingsResponse | null;
      const nextSettings = payload?.data?.settings;
      if (!response.ok || !nextSettings) {
        throw new Error(getErrorMessage(payload, 'Could not load retention settings.'));
      }
      setSettings(nextSettings);
      setSavedSettings(nextSettings);
      setServices(payload?.data?.availableServices || []);
      setValidationErrors({});
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load retention settings.');
    } finally {
      setLoading(false);
    }
  }, [salonSlug]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!initialPromotionStage) {
      focusedPromotionStageRef.current = null;
      return;
    }
    if (
      !settings
      || focusedPromotionStageRef.current === initialPromotionStage
    ) {
      return;
    }

    const target = initialPromotionStage === 'promo_6w'
      ? sixWeekPromotionRef.current
      : eightWeekPromotionRef.current;
    focusedPromotionStageRef.current = initialPromotionStage;
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    target?.focus({ preventScroll: true });
  }, [initialPromotionStage, settings]);

  const isDirty = useMemo(
    () => Boolean(settings && savedSettings && JSON.stringify(settings) !== JSON.stringify(savedSettings)),
    [savedSettings, settings],
  );

  const updateSetting = <Key extends keyof RetentionSettings>(
    key: Key,
    value: RetentionSettings[Key],
  ) => {
    setSettings(current => current ? { ...current, [key]: value } : current);
    setSaved(false);
    setSaveError(null);
    setValidationErrors(current => ({ ...current, [key]: undefined }));
  };

  const saveSettings = async () => {
    if (!settings || !salonSlug || saving) {
      return;
    }

    const errors = validateRetentionSettings(settings);
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSaved(false);
      setSaveError('Review the highlighted settings before saving.');
      return;
    }

    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const response = await fetch(`/api/admin/retention/settings?salonSlug=${encodeURIComponent(salonSlug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const payload = await response.json().catch(() => null) as SettingsResponse | null;
      const nextSettings = payload?.data?.settings;
      if (!response.ok || !nextSettings) {
        throw new Error(getErrorMessage(payload, 'Could not save retention settings.'));
      }
      setSettings(nextSettings);
      setSavedSettings(nextSettings);
      setServices(payload?.data?.availableServices || services);
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save retention settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative flex min-h-full w-full flex-col bg-[#F2F2F7] font-sans text-black">
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/85 backdrop-blur-md">
        <ModalHeader
          title="Retention"
          subtitle="Client follow-up settings"
          leftAction={<BackButton onClick={onClose} label="Back" />}
        />
      </div>

      {loading
        ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center" role="status">
              <Loader2 className="size-8 animate-spin text-[#007AFF]" />
              <p className="text-[15px] text-[#636366]">Loading retention settings…</p>
            </div>
          )
        : loadError
          ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-[#FF3B30]/10">
                  <RefreshCw className="size-6 text-[#D70015]" />
                </div>
                <h2 className="mt-4 text-[20px] font-semibold text-[#1C1C1E]">Settings unavailable</h2>
                <p role="alert" className="mt-2 max-w-sm text-[15px] leading-relaxed text-[#636366]">{loadError}</p>
                <button
                  type="button"
                  onClick={() => void loadSettings()}
                  className="mt-5 min-h-11 rounded-[12px] bg-[#007AFF] px-5 py-2.5 text-[16px] font-semibold text-white active:opacity-75"
                >
                  Try again
                </button>
              </div>
            )
          : settings
            ? (
                <>
                  <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-32">
                    <div className="rounded-[18px] bg-gradient-to-br from-[#007AFF] to-[#5856D6] p-4 text-white shadow-sm">
                      <div className="flex items-start gap-3">
                        <BellRing className="mt-0.5 size-6 shrink-0" />
                        <div>
                          <h2 className="text-[18px] font-semibold">Automatic timing, personal messages</h2>
                          <p className="mt-1 text-[13px] leading-relaxed text-white/85">
                            Luster surfaces the right follow-up. Messages still open as editable drafts and only count as sent after the tech confirms it.
                          </p>
                        </div>
                      </div>
                    </div>

                    <section className="rounded-[20px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
                      <div className="mb-4 flex items-center gap-2">
                        <BellRing className="size-5 text-[#007AFF]" />
                        <h2 className="text-[18px] font-semibold text-[#1C1C1E]">Follow-up timing</h2>
                      </div>
                      <div className="grid gap-5 sm:grid-cols-2">
                        <NumberField
                          id="default-rebook-days"
                          label="Rebook clients after"
                          value={settings.defaultRebookDays}
                          min={1}
                          max={365}
                          suffix="days"
                          hint="Used unless a client has their own rebooking interval."
                          error={validationErrors.defaultRebookDays}
                          onChange={value => updateSetting('defaultRebookDays', value)}
                        />
                        <NumberField
                          id="reminder-lead-hours"
                          label="Appointment reminder"
                          value={settings.reminderLeadHours}
                          min={1}
                          max={168}
                          suffix="hours before"
                          hint="Upcoming appointments appear in the reminder queue at this time."
                          error={validationErrors.reminderLeadHours}
                          onChange={value => updateSetting('reminderLeadHours', value)}
                        />
                      </div>
                    </section>

                    <section className="rounded-[20px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
                      <div className="mb-4 flex items-center gap-2">
                        <Star className="size-5 text-[#FF9500]" />
                        <h2 className="text-[18px] font-semibold text-[#1C1C1E]">Reviews & directions</h2>
                      </div>
                      <div className="space-y-5">
                        <label htmlFor="google-review-url" className="block">
                          <span className="flex items-center gap-2 text-[15px] font-semibold text-[#1C1C1E]">
                            <Star className="size-4 text-[#FF9500]" />
                            Direct Google review link
                          </span>
                          <input
                            id="google-review-url"
                            type="url"
                            inputMode="url"
                            autoCapitalize="none"
                            autoCorrect="off"
                            value={settings.googleReviewUrl || ''}
                            aria-label="Direct Google review link"
                            aria-invalid={Boolean(validationErrors.googleReviewUrl)}
                            aria-describedby={validationErrors.googleReviewUrl ? 'google-review-url-error' : 'google-review-url-hint'}
                            onChange={event => updateSetting('googleReviewUrl', event.target.value.trim() || null)}
                            className="mt-2 w-full rounded-[12px] border border-[#D1D1D6] p-3 text-[16px] text-[#1C1C1E] outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/15"
                            placeholder="https://g.page/r/…/review"
                          />
                          <span id="google-review-url-hint" className="mt-1.5 block text-[12px] leading-relaxed text-[#8E8E93]">
                            The Google review button remains disabled until this link is configured.
                          </span>
                          <FieldError id="google-review-url-error" message={validationErrors.googleReviewUrl} />
                        </label>

                        <label htmlFor="parking-instructions" className="block">
                          <span className="flex items-center gap-2 text-[15px] font-semibold text-[#1C1C1E]">
                            <MapPin className="size-4 text-[#34C759]" />
                            Parking & directions instructions
                          </span>
                          <textarea
                            id="parking-instructions"
                            value={settings.parkingInstructions || ''}
                            onChange={event => updateSetting('parkingInstructions', event.target.value || null)}
                            rows={3}
                            maxLength={2000}
                            className="mt-2 w-full resize-y rounded-[12px] border border-[#D1D1D6] p-3 text-[15px] leading-relaxed text-[#1C1C1E] outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/15"
                            placeholder="Free parking behind the salon. Enter from Queen Street."
                          />
                          <span className="mt-1.5 block text-[12px] leading-relaxed text-[#8E8E93]">
                            Added to the editable Directions text alongside the salon address and Maps link.
                          </span>
                        </label>
                      </div>
                    </section>

                    <PromotionEditor
                      stage="six-week"
                      title="Six-week win-back"
                      description="Offer clients an incentive after 42 days without a completed visit."
                      promotion={settings.sixWeekPromotion}
                      services={services}
                      error={validationErrors.sixWeekPromotion}
                      highlighted={initialPromotionStage === 'promo_6w'}
                      sectionRef={sixWeekPromotionRef}
                      onChange={promotion => updateSetting('sixWeekPromotion', promotion)}
                    />

                    <PromotionEditor
                      stage="eight-week"
                      title="Eight-week win-back"
                      description="Escalate to a larger offer after 56 days. This replaces the six-week alert."
                      promotion={settings.eightWeekPromotion}
                      services={services}
                      error={validationErrors.eightWeekPromotion}
                      highlighted={initialPromotionStage === 'promo_8w'}
                      sectionRef={eightWeekPromotionRef}
                      onChange={promotion => updateSetting('eightWeekPromotion', promotion)}
                    />
                  </div>

                  <div className="absolute inset-x-0 bottom-0 z-20 border-t border-[#D1D1D6] bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md">
                    {(saveError || saved) && (
                      <div className={`mb-2 flex items-center justify-center gap-2 text-center text-[13px] font-medium ${saved ? 'text-[#248A3D]' : 'text-[#D70015]'}`} role={saveError ? 'alert' : 'status'}>
                        {saved && <Check className="size-4" />}
                        {saved ? 'Retention settings saved.' : saveError}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void saveSettings()}
                      disabled={saving || !isDirty}
                      className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-[#007AFF] px-4 py-3 text-[17px] font-semibold text-white transition-opacity active:opacity-75 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {saving ? <Loader2 className="size-5 animate-spin" /> : <Save className="size-5" />}
                      {saving ? 'Saving…' : 'Save retention settings'}
                    </button>
                  </div>
                </>
              )
            : null}
    </div>
  );
}
