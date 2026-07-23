'use client';

import {
  BellRing,
  Check,
  Gift,
  Loader2,
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

import { buildClientSmsMessage, buildNativeSmsUrl, detectNativeSmsPlatform } from '@/libs/clientSmsComposer';
import { formatMoney } from '@/libs/formatMoney';
import { firstNameForMessage, formatPromotionOffer, renderPromotionMessage } from '@/libs/promotionMessage';
import { isNativeSmsCapableDevice, type ModuleReason, resolveAutomaticTextStatus, type TextingHealth } from '@/libs/textingStatus';
import { useSalon } from '@/providers/SalonProvider';
import type {
  RetentionPromotionSettings,
  RetentionSettings,
  RetentionStage,
} from '@/types/retention';

import { BackButton, ModalHeader } from './AppModal';

type MarketingModalProps = {
  onClose: () => void;
  salonName?: string;
  /** Hop to another workspace app (e.g. Integrations). */
  onOpenApp?: (appId: string) => void;
  /** Open a client's profile in the Clients app. */
  onOpenClient?: (clientId: string) => void;
  /** Overridable for tests; defaults to window.location.assign. */
  onOpenNativeUrl?: (href: string) => void;
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

// =============================================================================
// Marketing workspace — Home / Follow-ups / Campaigns / Results / Reviews.
// Everything here is honest: manual texting is a native-Messages draft the
// technician reviews and sends themselves (opening the composer is never
// recorded as sent or delivered); automatic texting status comes from the same
// shared resolver as the Integrations app; Results show only measurable facts.
// =============================================================================

type MarketingView = 'home' | 'followups' | 'campaigns' | 'results' | 'reviews';

const VIEW_TITLES: Record<MarketingView, string> = {
  home: 'Marketing',
  followups: 'Follow-ups',
  campaigns: 'Campaigns',
  results: 'Results',
  reviews: 'Reviews',
};

type FollowupItem = {
  clientId: string;
  clientName: string | null;
  phone: string;
  stage: RetentionStage;
  dueAt: string;
  lastVisitAt: string;
  lastServiceName: string | null;
  hasUpcomingAppointment: boolean;
  smsConsent: boolean;
};

type MarketingOverview = {
  followups: {
    groups: Array<{ id: string; title: string; items: FollowupItem[] }>;
    reminders: Array<{ clientId: string; clientName: string | null; appointmentId: string; startTime: string }>;
  };
  results: {
    windowDays: number;
    outreach: Array<{ kind: string; status: string; count: number }>;
    campaigns: Array<{
      stage: string;
      minted: number;
      redeemed: number;
      discountGivenCents: number;
      completedCount: number;
      completedRevenueCents: number;
      completedTaxCents: number;
    }>;
    automatic: Array<{ channel: string; status: string; count: number }>;
  };
};

type TodayLinks = { bookingUrl: string | null; timeZone: string | null };

type PreviewState = {
  item: FollowupItem;
  kind: 'rebook' | 'promo_6w' | 'promo_8w';
  label: string;
  body: string;
  insertions: Array<{ label: string; value: string }>;
};

const STAGE_REASONS: Record<RetentionStage, string> = {
  rebook: 'Due to return',
  promo_6w: 'No visit in 6+ weeks',
  promo_8w: 'No visit in 8+ weeks',
};

const STAGE_KIND_LABEL: Record<RetentionStage, string> = {
  rebook: 'rebook message',
  promo_6w: 'six-week offer',
  promo_8w: 'eight-week offer',
};

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

export function MarketingModal({
  onClose,
  initialPromotionStage = null,
  salonName = 'your salon',
  onOpenApp,
  onOpenClient,
  onOpenNativeUrl,
}: MarketingModalProps) {
  const { salonSlug } = useSalon();
  const sixWeekPromotionRef = useRef<HTMLElement>(null);
  const eightWeekPromotionRef = useRef<HTMLElement>(null);
  const focusedPromotionStageRef = useRef<MarketingModalProps['initialPromotionStage']>(null);
  const [view, setView] = useState<MarketingView>(initialPromotionStage ? 'campaigns' : 'home');
  const [settings, setSettings] = useState<RetentionSettings | null>(null);
  const [savedSettings, setSavedSettings] = useState<RetentionSettings | null>(null);
  const [services, setServices] = useState<AvailableService[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});

  const [overview, setOverview] = useState<MarketingOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [links, setLinks] = useState<TodayLinks>({ bookingUrl: null, timeZone: null });
  const [textingHealth, setTextingHealth] = useState<TextingHealth | null>(null);
  const [smsModuleReason, setSmsModuleReason] = useState<ModuleReason | null>(null);
  const [smsCapableDevice, setSmsCapableDevice] = useState(true);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [pendingAsk, setPendingAsk] = useState<{ item: FollowupItem; label: string; body: string } | null>(null);
  const [recordingStatus, setRecordingStatus] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const openNative = onOpenNativeUrl ?? ((href: string) => window.location.assign(href));

  useEffect(() => {
    setSmsCapableDevice(isNativeSmsCapableDevice(navigator.userAgent ?? ''));
  }, []);

  const loadSettings = useCallback(async () => {
    if (!salonSlug) {
      setLoadError('Choose a salon before editing marketing settings.');
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
        throw new Error(getErrorMessage(payload, 'Could not load marketing settings.'));
      }
      setSettings(nextSettings);
      setSavedSettings(nextSettings);
      setServices(payload?.data?.availableServices || []);
      setValidationErrors({});
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load marketing settings.');
    } finally {
      setLoading(false);
    }
  }, [salonSlug]);

  const loadOverview = useCallback(async () => {
    if (!salonSlug) {
      return;
    }
    try {
      setOverviewError(null);
      const [overviewRes, todayRes, healthRes, modulesRes] = await Promise.all([
        fetch(`/api/admin/marketing?salonSlug=${encodeURIComponent(salonSlug)}`),
        fetch(`/api/admin/today?salonSlug=${encodeURIComponent(salonSlug)}`),
        fetch(`/api/integrations/health?salonSlug=${encodeURIComponent(salonSlug)}`),
        fetch(`/api/admin/settings/modules?salonSlug=${encodeURIComponent(salonSlug)}`),
      ]);
      const overviewPayload = await overviewRes.json().catch(() => null);
      if (!overviewRes.ok || !overviewPayload?.data) {
        throw new Error(overviewPayload?.error?.message ?? 'Could not load follow-ups.');
      }
      setOverview(overviewPayload.data);
      const todayPayload = await todayRes.json().catch(() => null);
      setLinks({
        bookingUrl: todayPayload?.data?.links?.bookingUrl ?? null,
        timeZone: todayPayload?.data?.timeZone ?? null,
      });
      const healthPayload = await healthRes.json().catch(() => null);
      setTextingHealth(healthPayload?.data ?? null);
      const modulesPayload = await modulesRes.json().catch(() => null);
      setSmsModuleReason(modulesPayload?.data?.moduleReasons?.smsReminders ?? null);
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : 'Could not load follow-ups.');
    }
  }, [salonSlug]);

  useEffect(() => {
    void loadSettings();
    void loadOverview();
  }, [loadSettings, loadOverview]);

  useEffect(() => {
    if (!initialPromotionStage) {
      focusedPromotionStageRef.current = null;
      return;
    }
    if (!settings || focusedPromotionStageRef.current === initialPromotionStage) {
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
        throw new Error(getErrorMessage(payload, 'Could not save marketing settings.'));
      }
      setSettings(nextSettings);
      setSavedSettings(nextSettings);
      setServices(payload?.data?.availableServices || services);
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save marketing settings.');
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Follow-up outreach: prepare → preview (editable) → open Messages →
  // "Did you send?" → marked_sent / not_sent. Opening is never recorded as
  // sent; the technician confirms the outcome themselves.
  // ---------------------------------------------------------------------------

  const recordOutreach = useCallback(async (args: {
    clientId: string;
    kind: string;
    status: 'prepared' | 'marked_sent' | 'not_sent' | 'snoozed' | 'dismissed';
    messageSnapshot?: string;
  }): Promise<string | null> => {
    if (!salonSlug) {
      return null;
    }
    const response = await fetch(`/api/admin/retention?salonSlug=${encodeURIComponent(salonSlug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        salonSlug,
        clientId: args.clientId,
        kind: args.kind,
        status: args.status,
        ...(args.messageSnapshot ? { messageSnapshot: args.messageSnapshot } : {}),
        ...(args.status === 'snoozed' ? { snoozeDays: 7 } : {}),
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? 'Could not update the follow-up.');
    }
    return payload?.data?.communication?.id ?? null;
  }, [salonSlug]);

  const startFollowup = useCallback(async (item: FollowupItem) => {
    if (!salonSlug || preparing) {
      return;
    }
    setPreparing(item.clientId);
    setActionError(null);
    try {
      const firstName = firstNameForMessage(item.clientName);
      if (item.stage === 'rebook') {
        const body = buildClientSmsMessage('rebook', {
          client: { name: item.clientName, phone: item.phone },
          salon: { name: salonName, bookingUrl: links.bookingUrl },
          appointment: item.lastServiceName
            ? { serviceNames: [item.lastServiceName] }
            : null,
        });
        if (!body) {
          throw new Error('Could not compose the message.');
        }
        setPreview({
          item,
          kind: 'rebook',
          label: STAGE_KIND_LABEL.rebook,
          body,
          insertions: [
            { label: 'Client first name', value: firstName },
            { label: 'Salon name', value: salonName },
            ...(links.bookingUrl ? [{ label: 'Booking link', value: links.bookingUrl }] : []),
          ],
        });
        return;
      }

      // Win-back stages: the offer must be configured before anything opens.
      const promotion = item.stage === 'promo_6w' ? settings?.sixWeekPromotion : settings?.eightWeekPromotion;
      if (!promotion?.enabled || promotion.value <= 0) {
        setView('campaigns');
        setActionError('Set up this win-back offer before texting it.');
        return;
      }
      const communicationId = await recordOutreach({ clientId: item.clientId, kind: item.stage, status: 'prepared' });
      const campaignResponse = await fetch(`/api/admin/retention/campaigns?salonSlug=${encodeURIComponent(salonSlug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          clientId: item.clientId,
          stage: item.stage,
          ...(communicationId ? { communicationId } : {}),
        }),
      });
      const campaignPayload = await campaignResponse.json().catch(() => null);
      if (!campaignResponse.ok || !campaignPayload?.data?.campaign) {
        throw new Error(campaignPayload?.error?.message ?? 'Could not prepare the offer link.');
      }
      const campaign = campaignPayload.data.campaign as { bookingUrl: string; expiresAt: string };
      const body = renderPromotionMessage({
        promotion,
        firstName,
        salonName,
        bookingUrl: campaign.bookingUrl,
        expiresAt: campaign.expiresAt,
        timeZone: links.timeZone,
      });
      setPreview({
        item,
        kind: item.stage,
        label: STAGE_KIND_LABEL[item.stage],
        body,
        insertions: [
          { label: 'Client first name', value: firstName },
          { label: 'Salon name', value: salonName },
          { label: 'Offer', value: formatPromotionOffer(promotion) },
          {
            label: 'Expiry date',
            value: new Date(campaign.expiresAt).toLocaleDateString('en-CA', { month: 'long', day: 'numeric' }),
          },
          { label: 'Booking link', value: campaign.bookingUrl },
        ],
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not prepare the message.');
    } finally {
      setPreparing(null);
    }
  }, [salonSlug, preparing, salonName, links, settings, recordOutreach]);

  const openPreviewMessage = useCallback(async (editedBody: string) => {
    if (!preview) {
      return;
    }
    const href = buildNativeSmsUrl({
      phone: preview.item.phone,
      body: editedBody,
      platform: detectNativeSmsPlatform(navigator.userAgent),
    });
    if (!href) {
      setActionError('This client does not have a valid mobile number.');
      return;
    }
    try {
      // Recorded as PREPARED only — opening the composer proves nothing about
      // sending or delivery. The follow-up question below records the outcome.
      await recordOutreach({
        clientId: preview.item.clientId,
        kind: preview.kind,
        status: 'prepared',
        messageSnapshot: editedBody,
      });
    } catch {
      // Fire-and-forget: the app switch to Messages may interrupt this write.
    }
    setPendingAsk({ item: preview.item, label: preview.label, body: editedBody });
    setPreview(null);
    openNative(href);
  }, [preview, recordOutreach, openNative]);

  const finishPendingAsk = useCallback(async (status: 'marked_sent' | 'not_sent') => {
    if (!pendingAsk || recordingStatus) {
      return;
    }
    setRecordingStatus(true);
    try {
      await recordOutreach({
        clientId: pendingAsk.item.clientId,
        kind: pendingAsk.item.stage,
        status,
        messageSnapshot: pendingAsk.body,
      });
      setPendingAsk(null);
      void loadOverview();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not record the outcome.');
    } finally {
      setRecordingStatus(false);
    }
  }, [pendingAsk, recordingStatus, recordOutreach, loadOverview]);

  const snoozeOrDismiss = useCallback(async (item: FollowupItem, status: 'snoozed' | 'dismissed') => {
    try {
      setActionError(null);
      await recordOutreach({ clientId: item.clientId, kind: item.stage, status });
      void loadOverview();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update the follow-up.');
    }
  }, [recordOutreach, loadOverview]);

  const copyText = useCallback(async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(current => (current === label ? null : current)), 2000);
    } catch {
      setActionError('Could not copy to the clipboard.');
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const followupCount = overview
    ? overview.followups.groups.reduce((sum, group) => sum + group.items.length, 0)
    : null;
  const automaticStatus = resolveAutomaticTextStatus(textingHealth, smsModuleReason);
  const winbackConfigured = Boolean(
    settings?.sixWeekPromotion.enabled || settings?.eightWeekPromotion.enabled,
  );
  const markedSent30d = overview
    ? overview.results.outreach
      .filter(row => row.status === 'marked_sent')
      .reduce((sum, row) => sum + row.count, 0)
    : null;
  const redeemedTotal = overview
    ? overview.results.campaigns.reduce((sum, row) => sum + row.redeemed, 0)
    : null;

  const card = 'rounded-[20px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]';

  const homeRow = (args: {
    testId: string;
    title: string;
    detail: string;
    status?: string;
    onClick: () => void;
  }) => (
    <button
      type="button"
      data-testid={args.testId}
      onClick={args.onClick}
      className="flex w-full items-center justify-between gap-3 rounded-[16px] bg-white p-4 text-left shadow-[0_4px_20px_rgba(0,0,0,0.04)]"
    >
      <div className="min-w-0">
        <div className="text-[16px] font-semibold text-[#1C1C1E]">{args.title}</div>
        <div className="mt-0.5 text-[13px] leading-relaxed text-[#8E8E93]">{args.detail}</div>
      </div>
      {args.status && (
        <span className="shrink-0 rounded-full bg-[#F2F2F7] px-2.5 py-1 text-[12px] font-medium text-[#636366]">
          {args.status}
        </span>
      )}
    </button>
  );

  return (
    <div className="relative flex min-h-full w-full flex-col bg-[#F2F2F7] font-sans text-black">
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/85 backdrop-blur-md">
        <ModalHeader
          title={VIEW_TITLES[view]}
          leftAction={(
            <BackButton
              onClick={view === 'home' ? onClose : () => setView('home')}
              label={view === 'home' ? 'Back' : 'Marketing'}
            />
          )}
        />
      </div>

      {loading
        ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center" role="status">
              <Loader2 className="size-8 animate-spin text-[#007AFF]" />
              <p className="text-[15px] text-[#636366]">Loading marketing…</p>
            </div>
          )
        : loadError
          ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-[#FF3B30]/10">
                  <RefreshCw className="size-6 text-[#D70015]" />
                </div>
                <h2 className="mt-4 text-[20px] font-semibold text-[#1C1C1E]">Marketing unavailable</h2>
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
                  <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-32 pt-1">
                    {actionError && (
                      <div role="alert" className="rounded-[14px] border border-[#FF3B30]/30 bg-[#FF3B30]/10 p-3 text-[13px] text-[#D70015]">
                        {actionError}
                      </div>
                    )}

                    {view === 'home' && (
                      <div className="space-y-3" data-testid="marketing-home">
                        <div className="rounded-[18px] bg-gradient-to-br from-[#007AFF] to-[#5856D6] p-4 text-white shadow-sm">
                          <h2 className="text-[18px] font-semibold">Grow your bookings</h2>
                          <p className="mt-1 text-[13px] leading-relaxed text-white/85">
                            Follow up with clients, fill open time and promote your services.
                          </p>
                        </div>

                        {homeRow({
                          testId: 'marketing-home-followups',
                          title: 'Follow-ups',
                          detail: 'Clients worth a personal text today.',
                          status: followupCount === null ? '…' : `${followupCount} due`,
                          onClick: () => setView('followups'),
                        })}
                        {homeRow({
                          testId: 'marketing-home-campaigns',
                          title: 'Campaigns',
                          detail: 'Win-back offers and follow-up timing.',
                          status: winbackConfigured ? 'Win-back on' : 'Not set up',
                          onClick: () => setView('campaigns'),
                        })}
                        {homeRow({
                          testId: 'marketing-home-results',
                          title: 'Results',
                          detail: 'What you sent and what it earned — measured only.',
                          status: markedSent30d === null ? '…' : `${markedSent30d} sent · ${redeemedTotal} redeemed`,
                          onClick: () => setView('results'),
                        })}
                        {homeRow({
                          testId: 'marketing-home-reviews',
                          title: 'Reviews',
                          detail: 'Google review link and manual requests.',
                          status: settings.googleReviewUrl ? 'Link set' : 'Add link',
                          onClick: () => setView('reviews'),
                        })}

                        <div className={card} data-testid="marketing-home-channels">
                          <h3 className="text-[15px] font-semibold text-[#1C1C1E]">Channels</h3>
                          <div className="mt-2 space-y-2 text-[13px]">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[#636366]">Manual texting</span>
                              <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${smsCapableDevice ? 'bg-emerald-50 text-emerald-700' : 'bg-[#F2F2F7] text-[#8E8E93]'}`}>
                                {smsCapableDevice ? 'Ready' : 'Use your phone'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[#636366]">Automatic texting</span>
                              <span
                                data-testid="marketing-automatic-status"
                                className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${automaticStatus.tone === 'good' ? 'bg-emerald-50 text-emerald-700' : automaticStatus.tone === 'error' ? 'bg-red-50 text-red-700' : automaticStatus.tone === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-[#F2F2F7] text-[#8E8E93]'}`}
                              >
                                {automaticStatus.label}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[#636366]">Marketing email</span>
                              <span className="rounded-full bg-[#F2F2F7] px-2.5 py-1 text-[12px] font-medium text-[#8E8E93]">
                                Not available yet
                              </span>
                            </div>
                          </div>
                          {(automaticStatus.label !== 'Ready' && automaticStatus.label !== 'Not available yet') && onOpenApp && (
                            <button
                              type="button"
                              data-testid="marketing-open-integrations"
                              onClick={() => onOpenApp('integrations')}
                              className="mt-3 w-full rounded-[12px] border border-[#D1D1D6] p-2.5 text-[13px] font-semibold text-[#1C1C1E]"
                            >
                              Finish texting setup in Integrations
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {view === 'followups' && (
                      <div className="space-y-4" data-testid="marketing-followups">
                        <p className="px-1 text-[13px] leading-relaxed text-[#8E8E93]">
                          Your phone’s Messages app will open with the message ready to
                          review. Nothing sends until you press send yourself.
                        </p>
                        {overviewError && (
                          <div role="alert" className="rounded-[14px] border border-[#FF3B30]/30 bg-[#FF3B30]/10 p-3 text-[13px] text-[#D70015]">
                            {overviewError}
                          </div>
                        )}
                        {overview?.followups.groups.map(group => (
                          <section key={group.id} className={card}>
                            <h3 className="text-[15px] font-semibold text-[#1C1C1E]">
                              {group.title}
                              {group.id !== 'rebook' && (
                                <span className="ml-2 text-[12px] font-normal text-[#8E8E93]">
                                  {group.id === 'promo_6w'
                                    ? 'After 42 days without a visit'
                                    : 'After 56 days if the client still has not booked'}
                                </span>
                              )}
                            </h3>
                            {group.items.length === 0
                              ? (
                                  <p className="mt-2 text-[13px] text-[#8E8E93]">No one right now.</p>
                                )
                              : (
                                  <div className="mt-2 divide-y divide-[#F2F2F7]">
                                    {group.items.map(item => (
                                      <div key={`${group.id}-${item.clientId}`} className="py-3" data-testid={`followup-row-${item.clientId}`}>
                                        <div className="flex items-start justify-between gap-3">
                                          <div className="min-w-0">
                                            <div className="text-[15px] font-semibold text-[#1C1C1E]">
                                              {item.clientName || 'Client'}
                                            </div>
                                            <div className="mt-0.5 text-[12px] leading-relaxed text-[#8E8E93]">
                                              {STAGE_REASONS[item.stage]}
                                              {' · due '}
                                              {formatDay(item.dueAt)}
                                              {item.lastServiceName ? ` · last: ${item.lastServiceName}` : ''}
                                              {' · no upcoming visit'}
                                            </div>
                                            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                                              <span className="rounded-full bg-[#F2F2F7] px-2 py-0.5 font-medium text-[#636366]">
                                                Text (manual)
                                              </span>
                                              <span className={`rounded-full px-2 py-0.5 font-medium ${item.smsConsent ? 'bg-emerald-50 text-emerald-700' : 'bg-[#F2F2F7] text-[#8E8E93]'}`}>
                                                {item.smsConsent ? 'Text consent on file' : 'No text consent recorded'}
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          <button
                                            type="button"
                                            data-testid={`followup-review-text-${item.clientId}`}
                                            disabled={preparing === item.clientId}
                                            onClick={() => void startFollowup(item)}
                                            className="min-h-9 rounded-full bg-[#007AFF] px-3.5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
                                          >
                                            {preparing === item.clientId ? 'Preparing…' : 'Review and text'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => void snoozeOrDismiss(item, 'snoozed')}
                                            className="min-h-9 rounded-full border border-[#D1D1D6] px-3.5 py-1.5 text-[13px] font-medium text-[#636366]"
                                          >
                                            Snooze 7d
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => void snoozeOrDismiss(item, 'dismissed')}
                                            className="min-h-9 rounded-full border border-[#D1D1D6] px-3.5 py-1.5 text-[13px] font-medium text-[#636366]"
                                          >
                                            Dismiss
                                          </button>
                                          {onOpenClient && (
                                            <button
                                              type="button"
                                              data-testid={`followup-open-client-${item.clientId}`}
                                              onClick={() => onOpenClient(item.clientId)}
                                              className="min-h-9 rounded-full border border-[#D1D1D6] px-3.5 py-1.5 text-[13px] font-medium text-[#636366]"
                                            >
                                              Open client
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                          </section>
                        ))}
                        {overview && overview.followups.reminders.length > 0 && (
                          <section className={card}>
                            <h3 className="text-[15px] font-semibold text-[#1C1C1E]">Reminders due</h3>
                            <p className="mt-1 text-[12px] text-[#8E8E93]">
                              Open the client to review and send their reminder with the
                              secure manage link included.
                            </p>
                            <div className="mt-2 divide-y divide-[#F2F2F7]">
                              {overview.followups.reminders.map(reminder => (
                                <div key={reminder.appointmentId} className="flex items-center justify-between gap-3 py-2.5">
                                  <div className="min-w-0 text-[14px] font-medium text-[#1C1C1E]">
                                    {reminder.clientName || 'Client'}
                                    <span className="ml-2 text-[12px] font-normal text-[#8E8E93]">
                                      {new Date(reminder.startTime).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                    </span>
                                  </div>
                                  {onOpenClient && (
                                    <button
                                      type="button"
                                      onClick={() => onOpenClient(reminder.clientId)}
                                      className="min-h-9 shrink-0 rounded-full border border-[#D1D1D6] px-3.5 py-1.5 text-[13px] font-medium text-[#636366]"
                                    >
                                      Open client
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </section>
                        )}
                      </div>
                    )}

                    {view === 'campaigns' && (
                      <div className="space-y-4" data-testid="marketing-campaigns">
                        <section className={`${card}`}>
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

                        <div className="rounded-[18px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
                          <div className="flex items-center gap-2">
                            <Gift className="size-5 text-[#AF52DE]" />
                            <h2 className="text-[18px] font-semibold text-[#1C1C1E]">Win-back sequence</h2>
                          </div>
                          <p className="mt-1 text-[13px] leading-relaxed text-[#8E8E93]">
                            Two staged offers. Clients appear in Follow-ups at each stage;
                            you review and text every message yourself.
                          </p>
                        </div>

                        <PromotionEditor
                          stage="six-week"
                          title="Six-week win-back"
                          description="Stage 1 — after 42 days without a visit. Offer clients an incentive to return."
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
                          description="Stage 2 — after 56 days if the client still has not booked. This replaces the stage-1 alert."
                          promotion={settings.eightWeekPromotion}
                          services={services}
                          error={validationErrors.eightWeekPromotion}
                          highlighted={initialPromotionStage === 'promo_8w'}
                          sectionRef={eightWeekPromotionRef}
                          onChange={promotion => updateSetting('eightWeekPromotion', promotion)}
                        />
                      </div>
                    )}

                    {view === 'results' && (
                      <div className="space-y-4" data-testid="marketing-results">
                        <p className="px-1 text-[13px] leading-relaxed text-[#8E8E93]">
                          Only measured outcomes appear here. Manual texts are counted when
                          you mark them sent — Luster cannot see Messages deliveries, and
                          link opens are not tracked.
                        </p>
                        <section className={card}>
                          <h3 className="text-[15px] font-semibold text-[#1C1C1E]">
                            Manual outreach · last
                            {' '}
                            {overview?.results.windowDays ?? 30}
                            {' '}
                            days
                          </h3>
                          <div className="mt-2 space-y-1.5 text-[13px] text-[#636366]" data-testid="marketing-results-outreach">
                            {(['prepared', 'marked_sent', 'not_sent', 'converted'] as const).map((status) => {
                              const count = overview?.results.outreach
                                .filter(row => row.status === status)
                                .reduce((sum, row) => sum + row.count, 0) ?? 0;
                              const label = status === 'prepared'
                                ? 'Opened for sending'
                                : status === 'marked_sent'
                                  ? 'Marked sent'
                                  : status === 'not_sent'
                                    ? 'Not sent'
                                    : 'Booking linked';
                              return (
                                <div key={status} className="flex items-center justify-between">
                                  <span>{label}</span>
                                  <span className="font-semibold text-[#1C1C1E]">{count}</span>
                                </div>
                              );
                            })}
                          </div>
                        </section>

                        <section className={card} data-testid="marketing-results-campaigns">
                          <h3 className="text-[15px] font-semibold text-[#1C1C1E]">Win-back campaigns · all time</h3>
                          {(overview?.results.campaigns.length ?? 0) === 0
                            ? <p className="mt-2 text-[13px] text-[#8E8E93]">No offers have been prepared yet.</p>
                            : overview?.results.campaigns.map(row => (
                              <div key={row.stage} className="mt-3 rounded-[14px] bg-[#F8F8FA] p-3 text-[13px] text-[#636366]">
                                <div className="font-semibold text-[#1C1C1E]">
                                  {row.stage === 'promo_6w' ? 'Stage 1 (42 days)' : 'Stage 2 (56 days)'}
                                </div>
                                <div className="mt-1.5 space-y-1">
                                  <div className="flex justify-between">
                                    <span>Offers prepared</span>
                                    <span className="font-medium text-[#1C1C1E]">{row.minted}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Promotion redeemed</span>
                                    <span className="font-medium text-[#1C1C1E]">{row.redeemed}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Completed visits</span>
                                    <span className="font-medium text-[#1C1C1E]">{row.completedCount}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Completed revenue (before tax)</span>
                                    <span className="font-medium text-[#1C1C1E]" data-testid={`campaign-revenue-${row.stage}`}>
                                      {formatMoney(row.completedRevenueCents)}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Tax collected (not revenue)</span>
                                    <span className="font-medium text-[#1C1C1E]">{formatMoney(row.completedTaxCents)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Discounts given</span>
                                    <span className="font-medium text-[#1C1C1E]">{formatMoney(row.discountGivenCents)}</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                        </section>

                        <section className={card} data-testid="marketing-results-automatic">
                          <h3 className="text-[15px] font-semibold text-[#1C1C1E]">
                            Automatic appointment messages · last
                            {' '}
                            {overview?.results.windowDays ?? 30}
                            {' '}
                            days
                          </h3>
                          <p className="mt-1 text-[12px] text-[#8E8E93]">
                            Confirmations, reminders and cancellations — not marketing.
                          </p>
                          <div className="mt-2 space-y-1.5 text-[13px] text-[#636366]">
                            {(overview?.results.automatic.length ?? 0) === 0
                              ? <p className="text-[13px] text-[#8E8E93]">None in this window.</p>
                              : overview?.results.automatic.map(row => (
                                <div key={`${row.channel}-${row.status}`} className="flex items-center justify-between">
                                  <span className="capitalize">
                                    {row.channel}
                                    {' · '}
                                    {row.status}
                                  </span>
                                  <span className="font-semibold text-[#1C1C1E]">{row.count}</span>
                                </div>
                              ))}
                          </div>
                        </section>
                      </div>
                    )}

                    {view === 'reviews' && (
                      <div className="space-y-4" data-testid="marketing-reviews">
                        <section className={card}>
                          <div className="mb-4 flex items-center gap-2">
                            <Star className="size-5 text-[#FF9500]" />
                            <h2 className="text-[18px] font-semibold text-[#1C1C1E]">Reviews</h2>
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

                            <p className="text-[12px] leading-relaxed text-[#8E8E93]">
                              Review requests are texts you review and send yourself from a
                              client’s profile. Opening the composer is never counted as a
                              sent request, and Luster never claims a Google review was
                              posted — clients can tell you, and you record it on their
                              profile.
                            </p>
                            <p className="text-[12px] leading-relaxed text-[#8E8E93]">
                              Parking &amp; entry instructions live in Settings → Locations, so
                              directions stay in one place.
                            </p>
                          </div>
                        </section>
                      </div>
                    )}
                  </div>

                  {(view === 'campaigns' || view === 'reviews') && (
                    <div className="absolute inset-x-0 bottom-0 z-20 border-t border-[#D1D1D6] bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md">
                      {(saveError || saved) && (
                        <div className={`mb-2 flex items-center justify-center gap-2 text-center text-[13px] font-medium ${saved ? 'text-[#248A3D]' : 'text-[#D70015]'}`} role={saveError ? 'alert' : 'status'}>
                          {saved && <Check className="size-4" />}
                          {saved ? 'Marketing settings saved.' : saveError}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => void saveSettings()}
                        disabled={saving || !isDirty}
                        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-[#007AFF] px-4 py-3 text-[17px] font-semibold text-white transition-opacity active:opacity-75 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {saving ? <Loader2 className="size-5 animate-spin" /> : <Save className="size-5" />}
                        {saving ? 'Saving…' : 'Save marketing settings'}
                      </button>
                    </div>
                  )}
                </>
              )
            : null}

      {/* Message preview — editable draft with friendly insertion chips */}
      {preview && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-md touch-pan-y overflow-y-auto overscroll-contain rounded-t-2xl bg-white p-4 supports-[height:100dvh]:max-h-[90dvh] sm:rounded-2xl" data-testid="marketing-message-preview">
            <h3 className="text-[17px] font-semibold text-[#1C1C1E]">
              Review and text
            </h3>
            <p className="mt-0.5 text-[13px] text-[#8E8E93]">
              {preview.item.clientName || 'Client'}
              {' · '}
              {preview.item.phone}
            </p>
            <textarea
              value={preview.body}
              data-testid="marketing-preview-message"
              onChange={event => setPreview(current => current ? { ...current, body: event.target.value } : current)}
              rows={6}
              className="mt-3 w-full rounded-[12px] border border-[#D1D1D6] p-3 text-[15px] leading-relaxed text-[#1C1C1E]"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {preview.insertions.map(insertion => (
                <button
                  key={insertion.label}
                  type="button"
                  data-testid={`marketing-insert-${insertion.label.toLowerCase().replaceAll(' ', '-')}`}
                  onClick={() => setPreview(current => current
                    ? { ...current, body: `${current.body.replace(/\s+$/, '')} ${insertion.value}` }
                    : current)}
                  className="rounded-full bg-[#F2F2F7] px-2.5 py-1 text-[12px] font-medium text-[#636366]"
                >
                  +
                  {' '}
                  {insertion.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-[#8E8E93]">
              Your phone’s Messages app will open with this message ready to
              review. Nothing sends until you press send.
            </p>
            {!smsCapableDevice && (
              <div className="mt-3 rounded-[12px] bg-[#F8F8FA] p-3" data-testid="marketing-desktop-fallback">
                <p className="text-[12px] text-[#8E8E93]">
                  This browser can’t open a Messages app. Copy the details below or
                  open Luster on your phone.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    data-testid="marketing-copy-phone"
                    onClick={() => void copyText('phone', preview.item.phone)}
                    className="flex-1 rounded-[10px] border border-[#D1D1D6] p-2 text-[13px] font-medium text-[#1C1C1E]"
                  >
                    {copied === 'phone' ? 'Copied' : 'Copy phone'}
                  </button>
                  <button
                    type="button"
                    data-testid="marketing-copy-message"
                    onClick={() => void copyText('message', preview.body)}
                    className="flex-1 rounded-[10px] border border-[#D1D1D6] p-2 text-[13px] font-medium text-[#1C1C1E]"
                  >
                    {copied === 'message' ? 'Copied' : 'Copy message'}
                  </button>
                </div>
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                data-testid="marketing-preview-cancel"
                onClick={() => setPreview(null)}
                className="flex-1 rounded-[12px] border border-[#D1D1D6] p-3 text-[15px] font-medium text-[#636366]"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="marketing-preview-open"
                onClick={() => void openPreviewMessage(preview.body)}
                className="flex-[1.4] rounded-[12px] bg-[#007AFF] p-3 text-[15px] font-semibold text-white"
              >
                Open text message
              </button>
            </div>
          </div>
        </div>
      )}

      {/* "Did you send?" — opening the composer is a decision point, not proof */}
      {pendingAsk && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true">
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-md touch-pan-y overflow-y-auto overscroll-contain rounded-t-2xl bg-white p-4 supports-[height:100dvh]:max-h-[calc(100dvh-2rem)] sm:rounded-2xl" data-testid="marketing-did-you-send">
            <h3 className="text-[17px] font-semibold text-[#1C1C1E]">
              Did you send the
              {' '}
              {pendingAsk.label}
              ?
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-[#8E8E93]">
              Messages can’t report back to Luster, so tell us what happened to
              keep this client’s follow-ups accurate.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                data-testid="marketing-mark-sent"
                disabled={recordingStatus}
                onClick={() => void finishPendingAsk('marked_sent')}
                className="rounded-[12px] bg-[#007AFF] p-3 text-[15px] font-semibold text-white disabled:opacity-50"
              >
                Mark as sent
              </button>
              <button
                type="button"
                data-testid="marketing-not-sent"
                disabled={recordingStatus}
                onClick={() => void finishPendingAsk('not_sent')}
                className="rounded-[12px] border border-[#D1D1D6] p-3 text-[15px] font-medium text-[#636366] disabled:opacity-50"
              >
                I didn’t send it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
