'use client';

/**
 * SettingsModal Component
 *
 * iOS Settings-style experience: a grouped index of settings categories, each
 * opening a focused editing view. Every field, validation rule, permission
 * gate, and save action predates this structure and is preserved unchanged —
 * only the navigation around them is new.
 *
 * Save models (unchanged):
 * - Explicit save: Locations, Booking rules, Notifications, Owner profile
 * - Autosave toggles: Modules, Programs, Staff visibility, Booking flow
 * - Self-contained editors: Branding (PageThemesSettings), Booking flow editor
 */

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  BarChart3,
  Bell,
  Boxes,
  CalendarClock,
  Check,
  ChevronRight,
  CreditCard,
  Eye,
  Flag,
  Gift,
  ListOrdered,
  MapPin,
  MessageSquare,
  Palette,
  Plug,
  Save,
  Shield,
  User,
  Users,
  X,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import type { BookingStep } from '@/libs/bookingFlow';
import type { ResolvedLoyaltyPoints } from '@/libs/loyalty';
import { useSalon } from '@/providers/SalonProvider';
import type {
  ModuleKey,
  ResolvedModules,
  SalonVisibilityPolicy,
} from '@/types/salonPolicy';

import { BackButton, ModalHeader } from './AppModal';
import { BookingFlowEditor } from './BookingFlowEditor';
import { PageThemesSettings } from './PageThemesSettings';

/**
 * Formats a Canadian postal code readably (`m5h2m9` → `M5H 2M9`). Values that
 * do not look like a Canadian postal code are returned untouched, so US ZIPs
 * and free-form entries are never corrupted. Applied only when the user edits
 * the field — stored values are never rewritten just by opening settings.
 */
export function formatCanadianPostalCode(value: string): string {
  const compact = value.trim().toUpperCase().replace(/\s+/g, '');
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)) {
    return `${compact.slice(0, 3)} ${compact.slice(3)}`;
  }
  return value;
}

/**
 * Section Container
 */
type SectionProps = {
  title?: string;
  footer?: string;
  children: ReactNode;
};

/**
 * IANA timezones for the salon-timezone picker, America/* first (this
 * product's audience), always including the currently stored value so a
 * legacy/nonstandard setting is never silently changed by opening settings.
 */
function getTimeZoneOptions(currentValue: string): string[] {
  let zones: string[] = [];
  try {
    zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) {
    zones = ['America/Toronto', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Vancouver'];
  }
  const ordered = [
    ...zones.filter(zone => zone.startsWith('America/')),
    ...zones.filter(zone => !zone.startsWith('America/')),
  ];
  if (currentValue && !ordered.includes(currentValue)) {
    ordered.unshift(currentValue);
  }
  return ordered;
}

function Section({ title, footer, children }: SectionProps) {
  return (
    <div className="mb-6">
      {title && (
        <div className="mb-2 px-4 text-[13px] uppercase tracking-wide text-gray-500">
          {title}
        </div>
      )}
      <div className="mx-4 overflow-visible rounded-[10px] border border-gray-200/50 bg-white shadow-sm">
        {children}
      </div>
      {footer && (
        <div className="mt-2 px-8 text-[12px] leading-snug text-gray-500">
          {footer}
        </div>
      )}
    </div>
  );
}

/**
 * Settings Row
 */
type RowProps = {
  icon?: LucideIcon;
  iconColor?: string;
  label: string;
  value?: string;
  type?: 'link' | 'toggle' | 'display';
  isLast?: boolean;
  defaultOn?: boolean;
  onToggle?: (value: boolean) => void;
  onClick?: () => void;
};

function Row({
  icon: Icon,
  iconColor = 'bg-gray-500',
  label,
  value,
  type = 'link',
  isLast = false,
  defaultOn = true,
  onToggle,
  onClick,
}: RowProps) {
  const [isOn, setIsOn] = useState(defaultOn);

  const handleToggle = () => {
    const newValue = !isOn;
    setIsOn(newValue);
    onToggle?.(newValue);
  };

  return (
    <div
      className={`flex min-h-[48px] items-center pl-4 transition-colors ${type === 'display' ? '' : 'cursor-pointer active:bg-gray-50'}`}
      onClick={type === 'link' ? onClick : undefined}
      onKeyDown={
        type === 'link' && onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={type === 'link' && onClick ? 'button' : undefined}
      tabIndex={type === 'link' && onClick ? 0 : undefined}
    >
      {/* Icon */}
      {Icon && (
        <div
          className={`mr-3 flex size-7 items-center justify-center rounded-[6px] text-white shadow-sm ${iconColor}`}
        >
          <Icon className="size-4" />
        </div>
      )}

      {/* Content */}
      <div
        className={`flex flex-1 items-center justify-between py-3 pr-4 ${
          !isLast ? 'border-b border-gray-100' : ''
        }`}
      >
        <span className="text-[16px] tracking-tight text-black">{label}</span>

        <div className="flex items-center gap-2">
          {value && <span className="text-[16px] text-[#8E8E93]">{value}</span>}

          {type === 'link' && (
            <ChevronRight className="size-4 text-[#C7C7CC]" />
          )}

          {type === 'toggle' && (
            <button
              type="button"
              onClick={handleToggle}
              aria-label={`Toggle ${label}`}
              className={`
                relative h-[31px] w-[51px] rounded-full p-0.5 transition-colors duration-300
                ${isOn ? 'bg-rose-800' : 'bg-[#E9E9EA]'}
              `}
            >
              <motion.div
                animate={{ x: isOn ? 20 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="size-[27px] rounded-full bg-white shadow-md"
              />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Module Row (Step 16.3)
 * Entitlement-aware toggle row for modules
 */
type ModuleRowProps = {
  icon?: LucideIcon;
  iconColor?: string;
  label: string;
  moduleKey: ModuleKey;
  enabled: boolean;
  entitled: boolean;
  isLast?: boolean;
  onToggle: (moduleKey: ModuleKey, value: boolean) => void;
};

function ModuleRow({
  icon: Icon,
  iconColor = 'bg-gray-500',
  label,
  moduleKey,
  enabled,
  entitled,
  isLast = false,
  onToggle,
}: ModuleRowProps) {
  const handleToggle = () => {
    if (!entitled) {
      return;
    }
    onToggle(moduleKey, !enabled);
  };

  return (
    <div
      className={`flex min-h-[48px] items-center pl-4 ${entitled ? '' : 'opacity-60'}`}
    >
      {/* Icon */}
      {Icon && (
        <div
          className={`mr-3 flex size-7 items-center justify-center rounded-[6px] text-white shadow-sm ${iconColor}`}
        >
          <Icon className="size-4" />
        </div>
      )}

      {/* Content */}
      <div
        className={`flex flex-1 items-center justify-between py-3 pr-4 ${
          !isLast ? 'border-b border-gray-100' : ''
        }`}
      >
        <div className="flex flex-col">
          <span className="text-[16px] tracking-tight text-black">{label}</span>
          {!entitled && (
            <span className="text-[11px] text-amber-600">Upgrade required</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggle}
            disabled={!entitled}
            aria-label={`Toggle ${label}`}
            className={`
              relative h-[31px] w-[51px] rounded-full p-0.5 transition-colors duration-300
              ${!entitled ? 'cursor-not-allowed' : 'cursor-pointer'}
              ${enabled && entitled ? 'bg-rose-800' : 'bg-[#E9E9EA]'}
            `}
          >
            <motion.div
              animate={{ x: enabled && entitled ? 20 : 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="size-[27px] rounded-full bg-white shadow-md"
            />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Profile Card
 */
type ProfileCardProps = {
  name: string;
  subtitle?: string;
  initials?: string;
  onClick?: () => void;
};

function ProfileCard({
  name,
  subtitle = 'Salon admin account',
  initials,
  onClick,
}: ProfileCardProps) {
  const displayInitials
    = initials
    || name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase();

  return (
    <button
      type="button"
      className="mb-8 flex w-full cursor-pointer items-center gap-3 px-4 text-left transition-opacity active:opacity-70"
      onClick={onClick}
      data-testid="settings-profile-card"
    >
      <div className="size-[60px] overflow-hidden rounded-full border border-white/50 shadow-sm">
        <div className="flex size-full items-center justify-center bg-gradient-to-br from-gray-200 to-gray-400 text-xl font-bold text-white">
          {displayInitials}
        </div>
      </div>
      <div className="flex-1">
        <div className="text-[20px] font-normal text-[#1C1C1E]">{name}</div>
        <div className="text-[13px] text-gray-500">{subtitle}</div>
      </div>
      <ChevronRight className="size-5 text-[#C7C7CC]" />
    </button>
  );
}

type DirectionsLocationFormState = {
  id: string | null;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
};

function DirectionsLocationSection({
  salonSlug,
  onDirtyChange,
}: {
  salonSlug: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [locationCount, setLocationCount] = useState(0);
  const [isPrimaryFallback, setIsPrimaryFallback] = useState(false);
  const [form, setForm] = useState<DirectionsLocationFormState>({
    id: null,
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
  });

  const markDirty = useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirtyChange?.(value);
    },
    [onDirtyChange],
  );

  const fetchLocation = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/admin/location?salonSlug=${encodeURIComponent(salonSlug)}`,
      );
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          body?.error?.message || 'Failed to load location settings',
        );
      }

      const location = body?.data?.location;
      const salonName = body?.data?.salon?.name || '';

      setLocationCount(body?.data?.salon?.locationCount || 0);
      setIsPrimaryFallback(Boolean(body?.data?.isPrimaryFallback));
      setForm({
        id: location?.id ?? null,
        name: location?.name ?? salonName,
        address: location?.address ?? '',
        city: location?.city ?? '',
        state: location?.state ?? '',
        zipCode: location?.zipCode ?? '',
      });
      markDirty(false);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : 'Failed to load location settings',
      );
    } finally {
      setLoading(false);
    }
  }, [salonSlug, markDirty]);

  useEffect(() => {
    fetchLocation();
  }, [fetchLocation]);

  useEffect(() => {
    if (!saved) {
      return undefined;
    }

    const timer = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const handleChange = (
    field: keyof DirectionsLocationFormState,
    value: string,
  ) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setSaved(false);
    markDirty(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || saving) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/admin/location?salonSlug=${encodeURIComponent(salonSlug)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name,
            address: form.address,
            city: form.city,
            state: form.state,
            zipCode: form.zipCode,
          }),
        },
      );

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          body?.error?.message || 'Failed to save location settings',
        );
      }

      const location = body?.data?.location;
      setLocationCount(body?.data?.locationCount || locationCount);
      setIsPrimaryFallback(false);
      setForm(prev => ({
        ...prev,
        id: location?.id ?? prev.id,
        name: location?.name ?? prev.name,
        address: location?.address ?? '',
        city: location?.city ?? '',
        state: location?.state ?? '',
        zipCode: location?.zipCode ?? '',
      }));
      setSaved(true);
      markDirty(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to save location settings',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Directions Location"
      footer={
        locationCount > 1
          ? 'This edits the primary location used as the default customer directions target. Other locations remain unchanged.'
          : 'This address is used for customer directions and the default booking location when a visit does not specify another location.'
      }
    >
      {loading
        ? (
            <div className="flex items-center justify-center py-8">
              <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
            </div>
          )
        : (
            <div className="space-y-4 p-4">
              {isPrimaryFallback && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                  No primary location was set. Saving here will promote the current
                  default location for customer directions.
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Location name
                  </span>
                  <input
                    type="text"
                    value={form.name}
                    onChange={event => handleChange('name', event.target.value)}
                    className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                    placeholder="Main salon"
                  />
                </label>

                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Street address
                  </span>
                  <input
                    type="text"
                    value={form.address}
                    onChange={event =>
                      handleChange('address', event.target.value)}
                    className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                    placeholder="123 Main St"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    City
                  </span>
                  <input
                    type="text"
                    value={form.city}
                    onChange={event => handleChange('city', event.target.value)}
                    className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                    placeholder="Toronto"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      State
                    </span>
                    <input
                      type="text"
                      value={form.state}
                      onChange={event =>
                        handleChange('state', event.target.value)}
                      className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                      placeholder="ON"
                    />
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      ZIP / postal
                    </span>
                    <input
                      type="text"
                      value={form.zipCode}
                      onChange={event =>
                        handleChange('zipCode', event.target.value)}
                      onBlur={(event) => {
                        // Readable Canadian format on edit; never rewrites an
                        // untouched stored value.
                        const formatted = formatCanadianPostalCode(
                          event.target.value,
                        );
                        if (formatted !== event.target.value) {
                          handleChange('zipCode', formatted);
                        }
                      }}
                      className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                      placeholder="M5H 2M9"
                    />
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <MapPin className="size-4 text-rose-800" />
                  <span>
                    {form.id
                      ? 'Editing current default location'
                      : 'Create the first customer-facing location'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!form.name.trim() || saving || !dirty}
                  className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="size-4" />
                  <span>{saving ? 'Saving...' : 'Save location'}</span>
                </button>
              </div>

              {saved && !error && (
                <div className="text-right text-xs font-medium text-green-600">
                  Location saved.
                </div>
              )}
            </div>
          )}
    </Section>
  );
}

/**
 * Parking & entry instructions — the single editing surface for the
 * directions text used in customer messages. Stored in retention settings
 * (its long-standing home); the Marketing screen no longer duplicates it.
 */
function ParkingInstructionsCard({
  salonSlug,
  onDirtyChange,
}: {
  salonSlug: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [dirty, setDirty] = useState(false);

  const markDirty = useCallback(
    (next: boolean) => {
      setDirty(next);
      onDirtyChange?.(next);
    },
    [onDirtyChange],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/admin/retention/settings?salonSlug=${encodeURIComponent(salonSlug)}`,
          { cache: 'no-store' },
        );
        const body = await response.json().catch(() => null);
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          throw new Error(body?.error?.message || 'Failed to load parking instructions');
        }
        setValue(body?.data?.settings?.parkingInstructions ?? '');
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load parking instructions',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [salonSlug]);

  useEffect(() => {
    if (!saved) {
      return undefined;
    }
    const timer = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const handleSave = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/retention/settings?salonSlug=${encodeURIComponent(salonSlug)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parkingInstructions: value.trim() || null }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message || 'Failed to save parking instructions');
      }
      setValue(body?.data?.settings?.parkingInstructions ?? value.trim());
      setSaved(true);
      markDirty(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to save parking instructions',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Parking & entry"
      footer="Added to the editable Directions text alongside the salon address and Maps link when you text a client directions."
    >
      {loading
        ? (
            <div className="flex items-center justify-center py-8">
              <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
            </div>
          )
        : (
            <div className="space-y-3 p-4">
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <label htmlFor="settings-parking-instructions" className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Parking & entry instructions
                </span>
                <textarea
                  id="settings-parking-instructions"
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setSaved(false);
                    markDirty(true);
                  }}
                  rows={3}
                  maxLength={2000}
                  className="mt-2 w-full resize-y rounded-[10px] border border-gray-200 p-3 text-[15px] leading-relaxed text-black outline-none transition-colors focus:border-[#007AFF]"
                  placeholder="Free parking behind the salon. Enter from Queen Street."
                />
              </label>
              <div className="flex items-center justify-end gap-3">
                {saved && !error && (
                  <span className="text-xs font-medium text-green-600">
                    Parking instructions saved.
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || !dirty}
                  className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="size-4" />
                  <span>{saving ? 'Saving...' : 'Save parking info'}</span>
                </button>
              </div>
            </div>
          )}
    </Section>
  );
}

/**
 * Compare Plans Modal
 * Shows Starter/Pro/Elite plan comparison
 */
type ComparePlansModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

type BookingConfigFormState = {
  bufferMinutes: number;
  slotIntervalMinutes: 5 | 10 | 15 | 30;
  currency: 'CAD' | 'USD';
  timezone: string;
  introPriceDefaultLabel: string;
  firstVisitDiscountEnabled: boolean;
  clientChangeCutoffHours: number;
};

type BookingNotificationChannel = 'sms' | 'email' | 'both';
type BookingNotificationEventKey = 'newBooking' | 'appointmentCancelled';

type BookingNotificationEventFormState = {
  technicianEnabled: boolean;
  ownerEnabled: boolean;
  technicianChannel: BookingNotificationChannel;
  ownerChannel: BookingNotificationChannel;
};

type BookingNotificationFormState = Record<
  BookingNotificationEventKey,
  BookingNotificationEventFormState
>;

type BookingNotificationCapabilitiesState = {
  ownerPhonePresent: boolean;
  ownerEmailPresent: boolean;
  smsChannelAvailable: boolean;
  emailChannelAvailable: boolean;
};

const SLOT_INTERVAL_OPTIONS: Array<
  BookingConfigFormState['slotIntervalMinutes']
> = [5, 10, 15, 30];
const CURRENCY_OPTIONS: Array<BookingConfigFormState['currency']> = [
  'CAD',
  'USD',
];
const BOOKING_NOTIFICATION_CHANNEL_OPTIONS: Array<{
  value: BookingNotificationChannel;
  label: string;
}> = [
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
  { value: 'both', label: 'Both' },
];

const DEFAULT_BOOKING_NOTIFICATION_EVENT_FORM_STATE: BookingNotificationEventFormState
  = {
    technicianEnabled: true,
    ownerEnabled: false,
    technicianChannel: 'sms',
    ownerChannel: 'both',
  };

const PLAN_FEATURES = {
  starter: {
    name: 'Starter',
    price: 'Free',
    description: 'Essential tools for small salons',
    popular: false,
    features: [
      { name: 'Online Booking', included: true },
      { name: 'Staff Dashboard', included: true },
      { name: 'Photo Uploads', included: true },
      { name: 'Client Profiles', included: true },
      { name: 'SMS Reminders', included: false },
      { name: 'Referrals Program', included: false },
      { name: 'Rewards Program', included: false },
      { name: 'Schedule Overrides', included: false },
      { name: 'Staff Earnings', included: false },
      { name: 'Client Flags', included: false },
      { name: 'Analytics Dashboard', included: false },
      { name: 'Multi-Location', included: false },
    ],
    limits: { staff: 1, locations: 1 },
  },
  pro: {
    name: 'Pro',
    price: '$49/mo',
    description: 'Marketing & client management',
    popular: true,
    features: [
      { name: 'Online Booking', included: true },
      { name: 'Staff Dashboard', included: true },
      { name: 'Photo Uploads', included: true },
      { name: 'Client Profiles', included: true },
      { name: 'SMS Reminders', included: true },
      { name: 'Referrals Program', included: true },
      { name: 'Rewards Program', included: true },
      { name: 'Schedule Overrides', included: true },
      { name: 'Staff Earnings', included: true },
      { name: 'Client Flags', included: true },
      { name: 'Analytics Dashboard', included: true },
      { name: 'Multi-Location', included: false },
    ],
    limits: { staff: 10, locations: 1 },
  },
  elite: {
    name: 'Elite',
    price: '$99/mo',
    description: 'Advanced analytics & multi-location',
    popular: false,
    features: [
      { name: 'Online Booking', included: true },
      { name: 'Staff Dashboard', included: true },
      { name: 'Photo Uploads', included: true },
      { name: 'Client Profiles', included: true },
      { name: 'SMS Reminders', included: true },
      { name: 'Referrals Program', included: true },
      { name: 'Rewards Program', included: true },
      { name: 'Schedule Overrides', included: true },
      { name: 'Staff Earnings', included: true },
      { name: 'Client Flags', included: true },
      { name: 'Analytics Dashboard', included: true },
      { name: 'Multi-Location', included: true },
    ],
    limits: { staff: 50, locations: 10 },
  },
};

function ComparePlansModal({ isOpen, onClose }: ComparePlansModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <motion.div
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 100 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-t-[20px] bg-white shadow-xl sm:rounded-[20px]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Compare Plans</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close compare plans modal"
            className="flex size-8 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
          >
            <X className="size-4 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[calc(90vh-120px)] overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {Object.entries(PLAN_FEATURES).map(([key, plan]) => (
              <div
                key={key}
                className={`relative rounded-xl border-2 p-4 ${
                  plan.popular
                    ? 'border-purple-500 bg-purple-50/50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-purple-500 px-3 py-0.5 text-xs font-medium text-white">
                    Most Popular
                  </div>
                )}
                <div className="mb-3 text-center">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {plan.name}
                  </h3>
                  <div className="mt-1 text-2xl font-bold text-gray-900">
                    {plan.price}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {plan.description}
                  </p>
                </div>

                <div className="mb-3 rounded-lg bg-gray-50 p-2 text-center text-xs text-gray-600">
                  <span className="font-medium">{plan.limits.staff}</span>
                  {' '}
                  staff
                  {' · '}
                  <span className="font-medium">
                    {plan.limits.locations}
                  </span>
                  {' '}
                  location
                  {plan.limits.locations > 1 ? 's' : ''}
                </div>

                <ul className="space-y-2">
                  {plan.features.map(feature => (
                    <li
                      key={feature.name}
                      className="flex items-center gap-2 text-sm"
                    >
                      {feature.included
                        ? (
                            <Check className="size-4 shrink-0 text-green-500" />
                          )
                        : (
                            <X className="size-4 shrink-0 text-gray-300" />
                          )}
                      <span
                        className={
                          feature.included ? 'text-gray-700' : 'text-gray-400'
                        }
                      >
                        {feature.name}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="mt-6 text-center text-xs text-gray-500">
            To change plans, contact Luster at support@islanailsalon.com
          </p>
        </div>
      </motion.div>
    </div>
  );
}

type SettingsView
  = | 'index'
  | 'account'
  | 'location'
  | 'branding'
  | 'booking'
  | 'booking-flow'
  | 'payments'
  | 'notifications'
  | 'features'
  | 'visibility';

const VIEW_TITLES: Record<SettingsView, string> = {
  'index': 'Settings',
  'account': 'Account',
  'location': 'Locations',
  'branding': 'Branding',
  'booking': 'Booking rules',
  'booking-flow': 'Booking flow',
  'payments': 'Payments & taxes',
  'notifications': 'Notifications',
  'features': 'Features',
  'visibility': 'Staff visibility',
};

type PaymentsFormState = {
  taxEnabled: boolean;
  taxName: string;
  /** Kept as the typed string; converted to basis points on save. */
  taxRatePercent: string;
  pricesIncludeTax: boolean;
  taxServicesByDefault: boolean;
  taxAddOnsByDefault: boolean;
  taxCustomByDefault: boolean;
  scheduledRatePercent: string;
  scheduledEffectiveFrom: string;
  etransferEnabled: boolean;
  etransferRecipient: string;
  etransferRecipientName: string;
  etransferAutodeposit: boolean;
  etransferInstructions: string;
  etransferRequireReference: boolean;
  etransferQrEnabled: boolean;
};

const DEFAULT_PAYMENTS_FORM: PaymentsFormState = {
  taxEnabled: false,
  taxName: '',
  taxRatePercent: '',
  pricesIncludeTax: false,
  taxServicesByDefault: true,
  taxAddOnsByDefault: true,
  taxCustomByDefault: true,
  scheduledRatePercent: '',
  scheduledEffectiveFrom: '',
  etransferEnabled: false,
  etransferRecipient: '',
  etransferRecipientName: '',
  etransferAutodeposit: false,
  etransferInstructions: '',
  etransferRequireReference: true,
  etransferQrEnabled: false,
};

function bpsToPercentString(bps: number | undefined): string {
  return bps === undefined || bps === null ? '' : String(bps / 100);
}

function percentStringToBps(value: string): number {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }
  return Math.min(30000, Math.round(parsed * 100));
}

type SettingsModalProps = {
  onClose: () => void;
  salonSlug?: string | null;
  salonId?: string | null;
  isFreeSolo?: boolean;
  userName?: string;
  userInitials?: string;
  /** Hop to another workspace app (e.g. Integrations, Staff). */
  onOpenApp?: (appId: string) => void;
};

export function SettingsModal({
  onClose,
  salonSlug: explicitSalonSlug,
  salonId = null,
  isFreeSolo = false,
  userName = 'Salon owner',
  userInitials,
  onOpenApp,
}: SettingsModalProps) {
  const { salonSlug: providerSalonSlug } = useSalon();
  const salonSlug = explicitSalonSlug ?? providerSalonSlug ?? null;
  const router = useRouter();
  const params = useParams();
  const locale = String(params?.locale || 'en');

  // View navigation state (index + focused editing views)
  const [view, setView] = useState<SettingsView>('index');
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  // Per-view unsaved-edit tracking (explicit-save views only; autosave views
  // never hold unsaved state)
  const [locationDirty, setLocationDirty] = useState(false);
  const [parkingDirty, setParkingDirty] = useState(false);
  const [bookingConfigDirty, setBookingConfigDirty] = useState(false);
  const [notificationsDirty, setNotificationsDirty] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [paymentsDirty, setPaymentsDirty] = useState(false);

  // Payments & taxes state (explicit-save)
  const [paymentsSaving, setPaymentsSaving] = useState(false);
  const [paymentsSaved, setPaymentsSaved] = useState(false);
  const [paymentsForm, setPaymentsForm] = useState<PaymentsFormState>(DEFAULT_PAYMENTS_FORM);

  // Booking flow state
  const [bookingFlowEnabled, setBookingFlowEnabled] = useState(false);
  const [bookingFlow, setBookingFlow] = useState<BookingStep[] | null>(null);
  const [bookingFlowLoading, setBookingFlowLoading] = useState(true);

  // Modules state (Step 16.3)
  const [modulesLoading, setModulesLoading] = useState(true);
  const [modulesSaving, setModulesSaving] = useState(false);
  const [modules, setModules] = useState<ResolvedModules>({
    smsReminders: true,
    referrals: true,
    rewards: true,
    scheduleOverrides: true,
    staffEarnings: true,
    clientFlags: true,
    clientBlocking: true,
    analyticsDashboard: true,
    utilization: true,
  });
  const [entitledModules, setEntitledModules] = useState<
    Record<ModuleKey, boolean>
  >({
    smsReminders: false,
    referrals: false,
    rewards: false,
    scheduleOverrides: false,
    staffEarnings: false,
    clientFlags: false,
    clientBlocking: false,
    analyticsDashboard: false,
    utilization: false,
  });

  // Visibility settings state (Step 16.1)
  const [visibilityLoading, setVisibilityLoading] = useState(true);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [visibilityEntitled, setVisibilityEntitled] = useState(false);

  // Compare Plans modal state (Step 19)
  const [showComparePlans, setShowComparePlans] = useState(false);

  // Owner profile state (Account view)
  const [profileName, setProfileName] = useState(userName);
  const [profileEmail, setProfileEmail] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Billing portal state (Account view)
  const [portalOpening, setPortalOpening] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  // Programs state (Step 21E)
  const [programsLoading, setProgramsLoading] = useState(true);
  const [programsSaving, setProgramsSaving] = useState(false);
  const [reviewsEnabled, setReviewsEnabled] = useState(true);
  const [rewardsEnabledProgram, setRewardsEnabledProgram] = useState(true);
  const [_effectivePoints, setEffectivePoints]
    = useState<ResolvedLoyaltyPoints | null>(null);
  const [_defaultPoints, setDefaultPoints]
    = useState<ResolvedLoyaltyPoints | null>(null);
  const [billingMode, setBillingMode] = useState<'NONE' | 'STRIPE'>('NONE');
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(
    null,
  );
  const [bookingConfigLoading, setBookingConfigLoading] = useState(true);
  const [bookingConfigSaving, setBookingConfigSaving] = useState(false);
  const [bookingConfigSaved, setBookingConfigSaved] = useState(false);
  const [bookingConfigForm, setBookingConfigForm]
    = useState<BookingConfigFormState>({
      bufferMinutes: 10,
      slotIntervalMinutes: 15,
      currency: 'CAD',
      timezone: 'America/Toronto',
      introPriceDefaultLabel: '',
      firstVisitDiscountEnabled: false,
      clientChangeCutoffHours: 24,
    });
  const [featureLusterManicure, setFeatureLusterManicure] = useState(true);
  const [bookingNotificationsSaving, setBookingNotificationsSaving]
    = useState(false);
  const [bookingNotificationsSaved, setBookingNotificationsSaved]
    = useState(false);
  const [bookingNotificationsForm, setBookingNotificationsForm]
    = useState<BookingNotificationFormState>({
      newBooking: DEFAULT_BOOKING_NOTIFICATION_EVENT_FORM_STATE,
      appointmentCancelled: DEFAULT_BOOKING_NOTIFICATION_EVENT_FORM_STATE,
    });
  const [bookingNotificationCapabilities, setBookingNotificationCapabilities]
    = useState<BookingNotificationCapabilitiesState>({
      ownerPhonePresent: false,
      ownerEmailPresent: false,
      smsChannelAvailable: false,
      emailChannelAvailable: false,
    });

  const [visibility, setVisibility] = useState<SalonVisibilityPolicy>({
    staff: {
      showClientPhone: true,
      showClientEmail: false,
      showClientFullName: true,
      showAppointmentPrice: true,
      showClientHistory: false,
      showClientNotes: true,
      showOtherTechAppointments: false,
    },
  });

  /** Field edits mark the booking view dirty so Back can warn about them. */
  const updateBookingConfigForm = (
    updater: (prev: BookingConfigFormState) => BookingConfigFormState,
  ) => {
    setBookingConfigForm(updater);
    setBookingConfigDirty(true);
    setBookingConfigSaved(false);
  };

  // Fetch modules settings (Step 16.3)
  const fetchModules = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setModulesLoading(true);
      const response = await fetch(
        `/api/admin/settings/modules?salonSlug=${salonSlug}`,
      );
      if (response.ok) {
        const data = await response.json();
        if (data.data.modules) {
          setModules(data.data.modules);
        }
        if (data.data.entitledModules) {
          setEntitledModules(data.data.entitledModules);
        }
      }
    } catch (error) {
      console.error('Failed to fetch module settings:', error);
    } finally {
      setModulesLoading(false);
    }
  }, [salonSlug]);

  // Save module toggle (Step 16.3)
  const saveModuleToggle = useCallback(
    async (moduleKey: ModuleKey, value: boolean) => {
      if (!salonSlug) {
        return;
      }

      try {
        setModulesSaving(true);
        const response = await fetch('/api/admin/settings/modules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salonSlug,
            modules: { [moduleKey]: value },
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.data.modules) {
            setModules(data.data.modules);
          }
          router.refresh();
        }
      } catch (error) {
        console.error('Failed to save module setting:', error);
      } finally {
        setModulesSaving(false);
      }
    },
    [salonSlug, router],
  );

  // Handle module toggle
  const handleModuleToggle = (moduleKey: ModuleKey, value: boolean) => {
    // Optimistically update UI
    setModules(prev => ({ ...prev, [moduleKey]: value }));
    // Save to server
    saveModuleToggle(moduleKey, value);
  };

  // Fetch programs settings (Step 21E)
  const fetchPrograms = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setProgramsLoading(true);
      setBookingConfigLoading(true);
      const response = await fetch(
        `/api/admin/salon/settings?salonSlug=${salonSlug}`,
      );
      if (response.ok) {
        const data = await response.json();
        setReviewsEnabled(data.reviewsEnabled ?? true);
        setRewardsEnabledProgram(data.rewardsEnabled ?? true);
        setEffectivePoints(data.effectivePoints ?? null);
        setDefaultPoints(data.defaults ?? null);
        setBillingMode(data.billingMode ?? 'NONE');
        setSubscriptionStatus(data.subscriptionStatus ?? null);
        setBookingConfigForm({
          bufferMinutes: data.bookingConfig?.bufferMinutes ?? 10,
          slotIntervalMinutes: data.bookingConfig?.slotIntervalMinutes ?? 15,
          currency: data.bookingConfig?.currency ?? 'CAD',
          timezone: data.bookingConfig?.timezone ?? 'America/Toronto',
          introPriceDefaultLabel:
            data.bookingConfig?.introPriceDefaultLabel ?? '',
          firstVisitDiscountEnabled:
            data.bookingConfig?.firstVisitDiscountEnabled ?? false,
          clientChangeCutoffHours:
            data.bookingConfig?.clientChangeCutoffHours ?? 24,
        });
        setFeatureLusterManicure(
          data.merchandising?.featureLusterManicure ?? true,
        );
        setBookingConfigDirty(false);
        setBookingNotificationsForm({
          newBooking: {
            technicianEnabled:
              data.bookingNotifications?.newBooking?.technicianEnabled ?? true,
            ownerEnabled:
              data.bookingNotifications?.newBooking?.ownerEnabled ?? false,
            technicianChannel:
              data.bookingNotifications?.newBooking?.technicianChannel ?? 'sms',
            ownerChannel:
              data.bookingNotifications?.newBooking?.ownerChannel ?? 'both',
          },
          appointmentCancelled: {
            technicianEnabled:
              data.bookingNotifications?.appointmentCancelled
                ?.technicianEnabled ?? true,
            ownerEnabled:
              data.bookingNotifications?.appointmentCancelled?.ownerEnabled
              ?? false,
            technicianChannel:
              data.bookingNotifications?.appointmentCancelled
                ?.technicianChannel ?? 'sms',
            ownerChannel:
              data.bookingNotifications?.appointmentCancelled?.ownerChannel
              ?? 'both',
          },
        });
        setNotificationsDirty(false);
        setBookingNotificationCapabilities({
          ownerPhonePresent: data.ownerPhonePresent ?? false,
          ownerEmailPresent: data.ownerEmailPresent ?? false,
          smsChannelAvailable: data.smsChannelAvailable ?? false,
          emailChannelAvailable: data.emailChannelAvailable ?? false,
        });
        setPaymentsForm({
          taxEnabled: data.payments?.tax?.enabled ?? false,
          taxName: data.payments?.tax?.name ?? '',
          taxRatePercent: bpsToPercentString(data.payments?.tax?.rateBps),
          pricesIncludeTax: data.payments?.tax?.pricesIncludeTax ?? false,
          taxServicesByDefault: data.payments?.tax?.taxServicesByDefault ?? true,
          taxAddOnsByDefault: data.payments?.tax?.taxAddOnsByDefault ?? true,
          taxCustomByDefault: data.payments?.tax?.taxCustomByDefault ?? true,
          scheduledRatePercent: bpsToPercentString(
            data.payments?.tax?.scheduledChange?.rateBps,
          ),
          scheduledEffectiveFrom:
            data.payments?.tax?.scheduledChange?.effectiveFrom?.slice(0, 10) ?? '',
          etransferEnabled: data.payments?.etransfer?.enabled ?? false,
          etransferRecipient: data.payments?.etransfer?.recipient ?? '',
          etransferRecipientName: data.payments?.etransfer?.recipientName ?? '',
          etransferAutodeposit: data.payments?.etransfer?.autodepositEnabled ?? false,
          etransferInstructions: data.payments?.etransfer?.instructions ?? '',
          etransferRequireReference:
            data.payments?.etransfer?.requireReference ?? true,
          etransferQrEnabled: data.payments?.etransfer?.qrPageEnabled ?? false,
        });
        setPaymentsDirty(false);
      }
    } catch (error) {
      console.error('Failed to fetch programs settings:', error);
    } finally {
      setProgramsLoading(false);
      setBookingConfigLoading(false);
    }
  }, [salonSlug]);

  // Save programs toggle (Step 21E)
  const saveProgramToggle = useCallback(
    async (field: 'reviewsEnabled' | 'rewardsEnabled', value: boolean) => {
      if (!salonSlug) {
        return;
      }

      try {
        setProgramsSaving(true);
        const response = await fetch(
          `/api/admin/salon/settings?salonSlug=${salonSlug}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [field]: value }),
          },
        );

        if (response.ok) {
          router.refresh();
        }
      } catch (error) {
        console.error('Failed to save program setting:', error);
      } finally {
        setProgramsSaving(false);
      }
    },
    [salonSlug, router],
  );

  const saveBookingConfig = useCallback(async () => {
    if (!salonSlug || bookingConfigSaving) {
      return;
    }

    try {
      setBookingConfigSaving(true);
      setBookingConfigSaved(false);
      const response = await fetch(
        `/api/admin/salon/settings?salonSlug=${salonSlug}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingConfig: {
              bufferMinutes: bookingConfigForm.bufferMinutes,
              slotIntervalMinutes: bookingConfigForm.slotIntervalMinutes,
              currency: bookingConfigForm.currency,
              timezone: bookingConfigForm.timezone.trim(),
              introPriceDefaultLabel:
                bookingConfigForm.introPriceDefaultLabel.trim() || null,
              firstVisitDiscountEnabled:
                bookingConfigForm.firstVisitDiscountEnabled,
              clientChangeCutoffHours:
                bookingConfigForm.clientChangeCutoffHours,
            },
            merchandising: {
              featureLusterManicure,
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error('Failed to save booking configuration');
      }

      const data = await response.json();
      setBookingConfigForm({
        bufferMinutes:
          data.bookingConfig?.bufferMinutes ?? bookingConfigForm.bufferMinutes,
        slotIntervalMinutes:
          data.bookingConfig?.slotIntervalMinutes
          ?? bookingConfigForm.slotIntervalMinutes,
        currency: data.bookingConfig?.currency ?? bookingConfigForm.currency,
        timezone: data.bookingConfig?.timezone ?? bookingConfigForm.timezone,
        introPriceDefaultLabel:
          data.bookingConfig?.introPriceDefaultLabel ?? '',
        firstVisitDiscountEnabled:
          data.bookingConfig?.firstVisitDiscountEnabled
          ?? bookingConfigForm.firstVisitDiscountEnabled,
        clientChangeCutoffHours:
          data.bookingConfig?.clientChangeCutoffHours
          ?? bookingConfigForm.clientChangeCutoffHours,
      });
      setFeatureLusterManicure(
        data.merchandising?.featureLusterManicure ?? featureLusterManicure,
      );
      setBookingConfigSaved(true);
      setBookingConfigDirty(false);
      router.refresh();
    } catch (error) {
      console.error('Failed to save booking config:', error);
    } finally {
      setBookingConfigSaving(false);
    }
  }, [bookingConfigForm, bookingConfigSaving, featureLusterManicure, router, salonSlug]);

  /** Field edits mark the payments view dirty so Back can warn about them. */
  const updatePaymentsForm = (
    updater: (prev: PaymentsFormState) => PaymentsFormState,
  ) => {
    setPaymentsForm(updater);
    setPaymentsDirty(true);
    setPaymentsSaved(false);
  };

  const savePayments = useCallback(async () => {
    if (!salonSlug || paymentsSaving) {
      return;
    }

    try {
      setPaymentsSaving(true);
      setPaymentsSaved(false);
      const scheduledBps = percentStringToBps(paymentsForm.scheduledRatePercent);
      const hasScheduledChange
        = paymentsForm.scheduledRatePercent.trim() !== ''
        && paymentsForm.scheduledEffectiveFrom.trim() !== '';
      const response = await fetch(
        `/api/admin/salon/settings?salonSlug=${salonSlug}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            payments: {
              tax: {
                enabled: paymentsForm.taxEnabled,
                name: paymentsForm.taxName.trim(),
                rateBps: percentStringToBps(paymentsForm.taxRatePercent),
                pricesIncludeTax: paymentsForm.pricesIncludeTax,
                taxServicesByDefault: paymentsForm.taxServicesByDefault,
                taxAddOnsByDefault: paymentsForm.taxAddOnsByDefault,
                taxCustomByDefault: paymentsForm.taxCustomByDefault,
                scheduledChange: hasScheduledChange
                  ? {
                      rateBps: scheduledBps,
                      effectiveFrom: `${paymentsForm.scheduledEffectiveFrom}T00:00:00`,
                    }
                  : null,
              },
              etransfer: {
                enabled: paymentsForm.etransferEnabled,
                recipient: paymentsForm.etransferRecipient.trim(),
                recipientName: paymentsForm.etransferRecipientName.trim(),
                autodepositEnabled: paymentsForm.etransferAutodeposit,
                instructions: paymentsForm.etransferInstructions.trim(),
                requireReference: paymentsForm.etransferRequireReference,
                qrPageEnabled: paymentsForm.etransferQrEnabled,
              },
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error('Failed to save payments settings');
      }

      setPaymentsSaved(true);
      setPaymentsDirty(false);
      router.refresh();
    } catch (error) {
      console.error('Failed to save payments settings:', error);
    } finally {
      setPaymentsSaving(false);
    }
  }, [paymentsForm, paymentsSaving, router, salonSlug]);

  const saveBookingNotifications = useCallback(async () => {
    if (!salonSlug || bookingNotificationsSaving) {
      return;
    }

    try {
      setBookingNotificationsSaving(true);
      setBookingNotificationsSaved(false);
      const response = await fetch(
        `/api/admin/salon/settings?salonSlug=${salonSlug}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingNotifications: {
              newBooking: {
                technicianEnabled:
                  bookingNotificationsForm.newBooking.technicianEnabled,
                ownerEnabled: bookingNotificationsForm.newBooking.ownerEnabled,
                technicianChannel:
                  bookingNotificationsForm.newBooking.technicianChannel,
                ownerChannel: bookingNotificationsForm.newBooking.ownerChannel,
              },
              appointmentCancelled: {
                technicianEnabled:
                  bookingNotificationsForm.appointmentCancelled
                    .technicianEnabled,
                ownerEnabled:
                  bookingNotificationsForm.appointmentCancelled.ownerEnabled,
                technicianChannel:
                  bookingNotificationsForm.appointmentCancelled
                    .technicianChannel,
                ownerChannel:
                  bookingNotificationsForm.appointmentCancelled.ownerChannel,
              },
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error('Failed to save booking notification settings');
      }

      const data = await response.json();
      setBookingNotificationsForm({
        newBooking: {
          technicianEnabled:
            data.bookingNotifications?.newBooking?.technicianEnabled
            ?? bookingNotificationsForm.newBooking.technicianEnabled,
          ownerEnabled:
            data.bookingNotifications?.newBooking?.ownerEnabled
            ?? bookingNotificationsForm.newBooking.ownerEnabled,
          technicianChannel:
            data.bookingNotifications?.newBooking?.technicianChannel
            ?? bookingNotificationsForm.newBooking.technicianChannel,
          ownerChannel:
            data.bookingNotifications?.newBooking?.ownerChannel
            ?? bookingNotificationsForm.newBooking.ownerChannel,
        },
        appointmentCancelled: {
          technicianEnabled:
            data.bookingNotifications?.appointmentCancelled
              ?.technicianEnabled
              ?? bookingNotificationsForm.appointmentCancelled.technicianEnabled,
          ownerEnabled:
            data.bookingNotifications?.appointmentCancelled?.ownerEnabled
            ?? bookingNotificationsForm.appointmentCancelled.ownerEnabled,
          technicianChannel:
            data.bookingNotifications?.appointmentCancelled
              ?.technicianChannel
              ?? bookingNotificationsForm.appointmentCancelled.technicianChannel,
          ownerChannel:
            data.bookingNotifications?.appointmentCancelled?.ownerChannel
            ?? bookingNotificationsForm.appointmentCancelled.ownerChannel,
        },
      });
      setBookingNotificationCapabilities({
        ownerPhonePresent:
          data.ownerPhonePresent
          ?? bookingNotificationCapabilities.ownerPhonePresent,
        ownerEmailPresent:
          data.ownerEmailPresent
          ?? bookingNotificationCapabilities.ownerEmailPresent,
        smsChannelAvailable:
          data.smsChannelAvailable
          ?? bookingNotificationCapabilities.smsChannelAvailable,
        emailChannelAvailable:
          data.emailChannelAvailable
          ?? bookingNotificationCapabilities.emailChannelAvailable,
      });
      setBookingNotificationsSaved(true);
      setNotificationsDirty(false);
      router.refresh();
    } catch (error) {
      console.error('Failed to save booking notifications:', error);
    } finally {
      setBookingNotificationsSaving(false);
    }
  }, [
    bookingNotificationCapabilities,
    bookingNotificationsForm,
    bookingNotificationsSaving,
    router,
    salonSlug,
  ]);

  const updateBookingNotificationEvent = useCallback(
    (
      eventKey: BookingNotificationEventKey,
      updates: Partial<BookingNotificationEventFormState>,
    ) => {
      setBookingNotificationsForm(prev => ({
        ...prev,
        [eventKey]: {
          ...prev[eventKey],
          ...updates,
        },
      }));
      setBookingNotificationsSaved(false);
      setNotificationsDirty(true);
    },
    [],
  );

  // Fetch visibility settings
  const fetchVisibility = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setVisibilityLoading(true);
      const response = await fetch(
        `/api/admin/settings/visibility?salonSlug=${salonSlug}`,
      );
      if (response.ok) {
        const data = await response.json();
        if (data.data.visibility) {
          setVisibility(data.data.visibility);
        }
        // Check entitlement
        setVisibilityEntitled(data.data.entitled ?? false);
      }
    } catch (error) {
      console.error('Failed to fetch visibility settings:', error);
    } finally {
      setVisibilityLoading(false);
    }
  }, [salonSlug]);

  // Save visibility settings
  const saveVisibility = useCallback(
    async (newVisibility: SalonVisibilityPolicy) => {
      if (!salonSlug) {
        return;
      }

      try {
        setVisibilitySaving(true);
        const response = await fetch('/api/admin/settings/visibility', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salonSlug,
            visibility: newVisibility,
          }),
        });

        if (response.ok) {
          router.refresh();
        }
      } catch (error) {
        console.error('Failed to save visibility settings:', error);
      } finally {
        setVisibilitySaving(false);
      }
    },
    [salonSlug, router],
  );

  // Handle visibility toggle
  const handleVisibilityToggle = (
    key: keyof NonNullable<SalonVisibilityPolicy['staff']>,
    value: boolean,
  ) => {
    const newVisibility: SalonVisibilityPolicy = {
      ...visibility,
      staff: {
        ...visibility.staff,
        [key]: value,
      },
    };
    setVisibility(newVisibility);
    saveVisibility(newVisibility);
  };

  // Fetch booking flow settings
  const fetchBookingFlow = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setBookingFlowLoading(true);
      const response = await fetch(
        `/api/admin/settings/booking-flow?salonSlug=${salonSlug}`,
      );
      if (response.ok) {
        const data = await response.json();
        setBookingFlowEnabled(data.data.bookingFlowCustomizationEnabled);
        setBookingFlow(data.data.bookingFlow);
      }
    } catch (error) {
      console.error('Failed to fetch booking flow settings:', error);
    } finally {
      setBookingFlowLoading(false);
    }
  }, [salonSlug]);

  useEffect(() => {
    fetchBookingFlow();
    fetchVisibility();
    fetchModules();
    fetchPrograms();
  }, [fetchBookingFlow, fetchVisibility, fetchModules, fetchPrograms]);

  useEffect(() => {
    if (!bookingConfigSaved) {
      return undefined;
    }

    const timer = window.setTimeout(() => setBookingConfigSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [bookingConfigSaved]);

  useEffect(() => {
    if (!bookingNotificationsSaved) {
      return undefined;
    }

    const timer = window.setTimeout(
      () => setBookingNotificationsSaved(false),
      2500,
    );
    return () => window.clearTimeout(timer);
  }, [bookingNotificationsSaved]);

  useEffect(() => {
    if (!profileSaved) {
      return undefined;
    }
    const timer = window.setTimeout(() => setProfileSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [profileSaved]);

  // Handle booking flow save (called by BookingFlowEditor's auto-save)
  const handleBookingFlowSave = async (flow: BookingStep[]) => {
    if (!salonSlug) {
      return;
    }

    const response = await fetch('/api/admin/settings/booking-flow', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug,
        bookingFlow: flow,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to save booking flow');
    }

    const data = await response.json();
    setBookingFlow(data.data.bookingFlow);
  };

  // Save owner profile (Account view) — existing /api/admin/profile contract
  const saveProfile = async () => {
    if (profileSaving) {
      return;
    }
    setProfileSaving(true);
    setProfileError(null);
    try {
      const response = await fetch('/api/admin/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: profileName.trim(),
          email: profileEmail.trim(),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof body?.error === 'string'
            ? body.error
            : 'Failed to save profile',
        );
      }
      setProfileSaved(true);
      setProfileDirty(false);
      router.refresh();
    } catch (error) {
      setProfileError(
        error instanceof Error ? error.message : 'Failed to save profile',
      );
    } finally {
      setProfileSaving(false);
    }
  };

  // Open the Stripe billing portal (Account view; STRIPE-mode salons only)
  const openBillingPortal = async () => {
    if (!salonId || portalOpening) {
      return;
    }
    setPortalOpening(true);
    setPortalError(null);
    try {
      const response = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.url) {
        throw new Error(
          body?.error?.message || 'The billing portal could not be opened.',
        );
      }
      window.location.assign(body.url);
    } catch (error) {
      setPortalError(
        error instanceof Error
          ? error.message
          : 'The billing portal could not be opened.',
      );
      setPortalOpening(false);
    }
  };

  const hasEntitledModules = Object.values(entitledModules).some(Boolean);
  const hasClientPrograms
    = entitledModules.rewards || entitledModules.referrals;
  const staffToolsAvailable
    = !isFreeSolo
    || entitledModules.scheduleOverrides
    || entitledModules.staffEarnings;

  const viewDirty: Partial<Record<SettingsView, boolean>> = {
    location: locationDirty || parkingDirty,
    booking: bookingConfigDirty,
    payments: paymentsDirty,
    notifications: notificationsDirty,
    account: profileDirty,
  };
  const currentViewDirty = viewDirty[view] === true;

  const goToIndex = () => {
    setConfirmingLeave(false);
    setLocationDirty(false);
    setParkingDirty(false);
    setView('index');
  };

  /** Back from a focused view; warns when the view holds unsaved edits. */
  const handleBack = () => {
    if (view === 'index') {
      onClose();
      return;
    }
    if (currentViewDirty && !confirmingLeave) {
      setConfirmingLeave(true);
      return;
    }
    goToIndex();
  };

  const openView = (next: SettingsView) => {
    setConfirmingLeave(false);
    setView(next);
  };

  return (
    <div
      className="flex min-h-full w-full flex-col bg-[#FFF8F5] font-sans text-black"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#FFF8F5]/90 backdrop-blur-md">
        <ModalHeader
          title={VIEW_TITLES[view]}
          leftAction={(
            <BackButton
              onClick={handleBack}
              label={view === 'index' ? 'Dashboard' : 'Settings'}
            />
          )}
          transparent
        />

        {/* Large Title */}
        <div className="px-4 pb-2">
          <h1 className="text-[34px] font-bold text-[#1C1C1E]">
            {VIEW_TITLES[view]}
          </h1>
        </div>
      </div>

      {/* Unsaved-change guard */}
      {confirmingLeave && (
        <div
          className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3"
          role="alertdialog"
          aria-label="Unsaved changes"
        >
          <span className="text-sm text-amber-900">
            You have unsaved changes. Leave without saving?
          </span>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setConfirmingLeave(false)}
              className="rounded-full border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-900"
            >
              Keep editing
            </button>
            <button
              type="button"
              onClick={goToIndex}
              className="rounded-full bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Scrollable Content */}
      <div className="overflow-y-auto pb-10">
        {view === 'index' && (
          <>
            {/* Profile Card → Account */}
            <ProfileCard
              name={userName}
              initials={userInitials}
              onClick={() => openView('account')}
            />

            <Section title="Business">
              <Row
                icon={MapPin}
                iconColor="bg-rose-800"
                label="Locations & directions"
                onClick={() => openView('location')}
              />
              <Row
                icon={Palette}
                iconColor="bg-pink-500"
                label="Branding & appearance"
                onClick={() => openView('branding')}
                isLast
              />
            </Section>

            <Section title="Booking">
              <Row
                icon={CalendarClock}
                iconColor="bg-rose-600"
                label="Booking rules"
                value={
                  bookingConfigLoading
                    ? undefined
                    : `${bookingConfigForm.slotIntervalMinutes} min · ${bookingConfigForm.currency}`
                }
                onClick={() => openView('booking')}
                isLast={isFreeSolo}
              />
              {!isFreeSolo && (
                <Row
                  icon={ListOrdered}
                  iconColor="bg-amber-500"
                  label="Booking flow"
                  onClick={() => openView('booking-flow')}
                  isLast
                />
              )}
            </Section>

            <Section title="Payments">
              <Row
                icon={CreditCard}
                iconColor="bg-emerald-600"
                label="Payments & taxes"
                value={
                  programsLoading
                    ? undefined
                    : paymentsForm.taxEnabled
                      ? `${paymentsForm.taxName.trim() || 'Tax'} ${paymentsForm.taxRatePercent || '0'}%`
                      : 'Tax off'
                }
                onClick={() => openView('payments')}
                isLast
              />
            </Section>

            {(hasEntitledModules || (onOpenApp && staffToolsAvailable)) && (
              <Section title="Team">
                {onOpenApp && staffToolsAvailable && (
                  <Row
                    icon={Users}
                    iconColor="bg-stone-600"
                    label="Staff & schedules"
                    onClick={() => onOpenApp('staff')}
                    isLast={!(hasEntitledModules && visibilityEntitled)}
                  />
                )}
                {hasEntitledModules && visibilityEntitled && (
                  <Row
                    icon={Eye}
                    iconColor="bg-indigo-500"
                    label="Staff visibility"
                    onClick={() => openView('visibility')}
                    isLast
                  />
                )}
              </Section>
            )}

            <Section title="Notifications">
              <Row
                icon={Bell}
                iconColor="bg-red-500"
                label="Booking & cancellation alerts"
                onClick={() => openView('notifications')}
                isLast
              />
            </Section>

            {hasEntitledModules && (
              <Section title="Features">
                <Row
                  icon={Boxes}
                  iconColor="bg-purple-500"
                  label="Modules & programs"
                  onClick={() => openView('features')}
                  isLast
                />
              </Section>
            )}

            {onOpenApp && (
              <Section
                title="Integrations"
                footer="Google Calendar, text messaging, and email are managed in the Integrations app."
              >
                <Row
                  icon={Plug}
                  iconColor="bg-rose-700"
                  label="Manage integrations"
                  value="Calendar, text, email"
                  onClick={() => onOpenApp('integrations')}
                  isLast
                />
              </Section>
            )}

            {/* Section: About */}
            <Section title="About">
              <Row label="Version" value="1.0.0" type="display" />
              <Row
                label="Terms of Service"
                onClick={() => router.push(`/${locale}/terms`)}
              />
              <Row
                label="Privacy Policy"
                onClick={() => router.push(`/${locale}/privacy`)}
                isLast
              />
            </Section>
          </>
        )}

        {view === 'location' && salonSlug && (
          <>
            <DirectionsLocationSection
              salonSlug={salonSlug}
              onDirtyChange={setLocationDirty}
            />
            <ParkingInstructionsCard
              salonSlug={salonSlug}
              onDirtyChange={setParkingDirty}
            />
          </>
        )}

        {view === 'branding' && (
          <Section title="Branding & appearance">
            <PageThemesSettings className="overflow-visible rounded-[10px] bg-white" />
          </Section>
        )}

        {view === 'booking' && (
          <Section
            title="Booking Configuration"
            footer="These settings control slot spacing, internal booking buffer, and intro pricing defaults for this salon."
          >
            {bookingConfigLoading
              ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
                  </div>
                )
              : (
                  <div className="space-y-4 p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Buffer minutes
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={60}
                          step={5}
                          value={bookingConfigForm.bufferMinutes}
                          onChange={event =>
                            updateBookingConfigForm(prev => ({
                              ...prev,
                              bufferMinutes: Math.max(
                                0,
                                Math.min(
                                  60,
                                  Number.parseInt(event.target.value || '0', 10) || 0,
                                ),
                              ),
                            }))}
                          className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Slot interval
                        </span>
                        <select
                          value={bookingConfigForm.slotIntervalMinutes}
                          onChange={event =>
                            updateBookingConfigForm(prev => ({
                              ...prev,
                              slotIntervalMinutes: Number.parseInt(
                                event.target.value,
                                10,
                              ) as BookingConfigFormState['slotIntervalMinutes'],
                            }))}
                          className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                        >
                          {SLOT_INTERVAL_OPTIONS.map(option => (
                            <option key={option} value={option}>
                              {option}
                              {' '}
                              minutes
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Currency
                        </span>
                        <select
                          value={bookingConfigForm.currency}
                          onChange={event =>
                            updateBookingConfigForm(prev => ({
                              ...prev,
                              currency: event.target
                                .value as BookingConfigFormState['currency'],
                            }))}
                          className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                        >
                          {CURRENCY_OPTIONS.map(option => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Client change cutoff
                        </span>
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            max={168}
                            step={1}
                            value={bookingConfigForm.clientChangeCutoffHours}
                            onChange={event =>
                              updateBookingConfigForm(prev => ({
                                ...prev,
                                clientChangeCutoffHours: Math.max(
                                  0,
                                  Math.min(
                                    168,
                                    Number.parseInt(event.target.value || '0', 10)
                                    || 0,
                                  ),
                                ),
                              }))}
                            className="h-11 w-full rounded-[10px] border border-gray-200 px-3 pr-16 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-gray-500">
                            hours
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          Clients contact you inside this window. Use 0 to allow
                          changes anytime.
                        </span>
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Timezone
                        </span>
                        {/* A typo here silently shifts every booking slot, so the
                            value is picked from the IANA list instead of typed. */}
                        <select
                          value={bookingConfigForm.timezone}
                          onChange={event =>
                            updateBookingConfigForm(prev => ({
                              ...prev,
                              timezone: event.target.value,
                            }))}
                          className="h-11 rounded-[10px] border border-gray-200 bg-white px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                        >
                          {getTimeZoneOptions(bookingConfigForm.timezone).map(zone => (
                            <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>
                          ))}
                        </select>
                      </label>

                      <label className="flex flex-col gap-1 sm:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Default intro label
                        </span>
                        <input
                          type="text"
                          value={bookingConfigForm.introPriceDefaultLabel}
                          onChange={event =>
                            updateBookingConfigForm(prev => ({
                              ...prev,
                              introPriceDefaultLabel: event.target.value,
                            }))}
                          className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                          placeholder="Founding Client Price"
                        />
                      </label>

                      <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3 sm:col-span-2">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            First-visit offer
                          </span>
                          <p className="text-sm text-gray-700">
                            Offer 25% off for first-time clients automatically during
                            booking.
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          checked={bookingConfigForm.firstVisitDiscountEnabled}
                          onChange={event =>
                            updateBookingConfigForm(prev => ({
                              ...prev,
                              firstVisitDiscountEnabled: event.target.checked,
                            }))}
                          className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                        />
                      </label>

                      <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3 sm:col-span-2">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Feature Luster Manicure
                          </span>
                          <p className="text-sm text-gray-700">
                            Show your active Luster Manicure first in Featured
                            Services.
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          data-testid="feature-luster-manicure-toggle"
                          checked={featureLusterManicure}
                          onChange={(event) => {
                            setFeatureLusterManicure(event.target.checked);
                            setBookingConfigDirty(true);
                            setBookingConfigSaved(false);
                          }}
                          className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                        />
                      </label>
                    </div>

                    <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                      <div className="text-xs text-gray-500">
                        Applies to slot generation and intro badges when a service
                        does not define its own label.
                      </div>
                      <button
                        type="button"
                        onClick={() => void saveBookingConfig()}
                        disabled={bookingConfigSaving || !bookingConfigDirty}
                        className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Save className="size-4" />
                        <span>
                          {bookingConfigSaving ? 'Saving...' : 'Save booking config'}
                        </span>
                      </button>
                    </div>

                    {bookingConfigSaved && (
                      <div className="text-right text-xs font-medium text-green-600">
                        Booking configuration saved.
                      </div>
                    )}
                  </div>
                )}
          </Section>
        )}

        {view === 'booking-flow' && !isFreeSolo && (
          <Section
            title="Booking Flow"
            footer="Customize the order of steps in your online booking flow."
          >
            {bookingFlowLoading
              ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
                  </div>
                )
              : (
                  <BookingFlowEditor
                    bookingFlowCustomizationEnabled={bookingFlowEnabled}
                    bookingFlow={bookingFlow}
                    onSave={handleBookingFlowSave}
                  />
                )}
          </Section>
        )}

        {view === 'payments' && (
          <>
            <Section
              title="Sales tax"
              footer="Tax stays off until you turn it on — it is never assumed from your address. Completed appointments keep the tax that was in effect when they were checked out."
            >
              {programsLoading
                ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
                    </div>
                  )
                : (
                    <div className="space-y-4 p-4">
                      <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Charge tax
                          </span>
                          <p className="text-sm text-gray-700">
                            Add tax at checkout when completing appointments.
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          data-testid="payments-tax-enabled"
                          checked={paymentsForm.taxEnabled}
                          onChange={event =>
                            updatePaymentsForm(prev => ({
                              ...prev,
                              taxEnabled: event.target.checked,
                            }))}
                          className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                        />
                      </label>

                      {paymentsForm.taxEnabled && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Tax name
                            </span>
                            <input
                              type="text"
                              data-testid="payments-tax-name"
                              value={paymentsForm.taxName}
                              onChange={event =>
                                updatePaymentsForm(prev => ({
                                  ...prev,
                                  taxName: event.target.value,
                                }))}
                              placeholder="HST"
                              maxLength={40}
                              className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                            />
                          </label>

                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Tax rate
                            </span>
                            <div className="relative">
                              <input
                                type="text"
                                inputMode="decimal"
                                data-testid="payments-tax-rate"
                                value={paymentsForm.taxRatePercent}
                                onChange={event =>
                                  updatePaymentsForm(prev => ({
                                    ...prev,
                                    taxRatePercent: event.target.value.replace(/[^0-9.]/g, ''),
                                  }))}
                                placeholder="13"
                                className="h-11 w-full rounded-[10px] border border-gray-200 px-3 pr-10 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                              />
                              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-gray-500">
                                %
                              </span>
                            </div>
                          </label>

                          <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3 sm:col-span-2">
                            <div className="space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Prices include tax
                              </span>
                              <p className="text-sm text-gray-700">
                                On: your listed prices already include tax. Off: tax is
                                added at checkout.
                              </p>
                            </div>
                            <input
                              type="checkbox"
                              data-testid="payments-tax-inclusive"
                              checked={paymentsForm.pricesIncludeTax}
                              onChange={event =>
                                updatePaymentsForm(prev => ({
                                  ...prev,
                                  pricesIncludeTax: event.target.checked,
                                }))}
                              className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                            />
                          </label>

                          <div className="rounded-[10px] border border-gray-200 p-3 sm:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Taxable by default
                            </span>
                            <div className="mt-2 space-y-2">
                              {([
                                ['taxServicesByDefault', 'Services'],
                                ['taxAddOnsByDefault', 'Add-ons'],
                                ['taxCustomByDefault', 'Custom items'],
                              ] as const).map(([key, label]) => (
                                <label key={key} className="flex items-center justify-between gap-3">
                                  <span className="text-sm text-gray-700">{label}</span>
                                  <input
                                    type="checkbox"
                                    checked={paymentsForm[key]}
                                    onChange={event =>
                                      updatePaymentsForm(prev => ({
                                        ...prev,
                                        [key]: event.target.checked,
                                      }))}
                                    className="size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                                  />
                                </label>
                              ))}
                            </div>
                            <p className="mt-2 text-xs text-gray-500">
                              You can still change tax on individual items at checkout.
                            </p>
                          </div>

                          <div className="rounded-[10px] border border-gray-200 p-3 sm:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Scheduled rate change
                            </span>
                            <div className="mt-2 grid gap-3 sm:grid-cols-2">
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-gray-500">New rate</span>
                                <div className="relative">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    data-testid="payments-tax-scheduled-rate"
                                    value={paymentsForm.scheduledRatePercent}
                                    onChange={event =>
                                      updatePaymentsForm(prev => ({
                                        ...prev,
                                        scheduledRatePercent: event.target.value.replace(/[^0-9.]/g, ''),
                                      }))}
                                    placeholder="15"
                                    className="h-11 w-full rounded-[10px] border border-gray-200 px-3 pr-10 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                                  />
                                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-gray-500">
                                    %
                                  </span>
                                </div>
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-gray-500">Effective from</span>
                                <input
                                  type="date"
                                  data-testid="payments-tax-scheduled-date"
                                  value={paymentsForm.scheduledEffectiveFrom}
                                  onChange={event =>
                                    updatePaymentsForm(prev => ({
                                      ...prev,
                                      scheduledEffectiveFrom: event.target.value,
                                    }))}
                                  className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                                />
                              </label>
                            </div>
                            <p className="mt-2 text-xs text-gray-500">
                              Checkouts on or after this date use the new rate.
                              Appointments completed earlier keep the old rate. Leave
                              blank to cancel a scheduled change.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
            </Section>

            <Section
              title="Interac e-Transfer"
              footer="Manual instructions only — payments are confirmed by you when the transfer arrives. Luster never asks for or stores banking passwords, and cannot verify bank deposits."
            >
              {programsLoading
                ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
                    </div>
                  )
                : (
                    <div className="space-y-4 p-4">
                      <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3">
                        <div className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Accept e-Transfer
                          </span>
                          <p className="text-sm text-gray-700">
                            Show e-Transfer instructions at checkout.
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          data-testid="payments-etransfer-enabled"
                          checked={paymentsForm.etransferEnabled}
                          onChange={event =>
                            updatePaymentsForm(prev => ({
                              ...prev,
                              etransferEnabled: event.target.checked,
                            }))}
                          className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                        />
                      </label>

                      {paymentsForm.etransferEnabled && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Recipient email or mobile
                            </span>
                            <input
                              type="text"
                              data-testid="payments-etransfer-recipient"
                              value={paymentsForm.etransferRecipient}
                              onChange={event =>
                                updatePaymentsForm(prev => ({
                                  ...prev,
                                  etransferRecipient: event.target.value,
                                }))}
                              placeholder="pay@yoursalon.ca"
                              maxLength={200}
                              className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                            />
                          </label>

                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Display name
                            </span>
                            <input
                              type="text"
                              value={paymentsForm.etransferRecipientName}
                              onChange={event =>
                                updatePaymentsForm(prev => ({
                                  ...prev,
                                  etransferRecipientName: event.target.value,
                                }))}
                              placeholder="Your salon name"
                              maxLength={120}
                              className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                            />
                          </label>

                          <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3 sm:col-span-2">
                            <div className="space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Autodeposit is on
                              </span>
                              <p className="text-sm text-gray-700">
                                Informational only — shown to clients so they know no
                                security question is needed.
                              </p>
                            </div>
                            <input
                              type="checkbox"
                              checked={paymentsForm.etransferAutodeposit}
                              onChange={event =>
                                updatePaymentsForm(prev => ({
                                  ...prev,
                                  etransferAutodeposit: event.target.checked,
                                }))}
                              className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                            />
                          </label>

                          <label className="flex flex-col gap-1 sm:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Instructions
                            </span>
                            <textarea
                              value={paymentsForm.etransferInstructions}
                              onChange={event =>
                                updatePaymentsForm(prev => ({
                                  ...prev,
                                  etransferInstructions: event.target.value,
                                }))}
                              rows={3}
                              maxLength={1000}
                              placeholder="Please include the appointment reference in the message field."
                              className="rounded-[10px] border border-gray-200 px-3 py-2 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                            />
                          </label>

                          <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3">
                            <div className="space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Require reference
                              </span>
                              <p className="text-sm text-gray-700">
                                Ask clients to include the appointment reference.
                              </p>
                            </div>
                            <input
                              type="checkbox"
                              checked={paymentsForm.etransferRequireReference}
                              onChange={event =>
                                updatePaymentsForm(prev => ({
                                  ...prev,
                                  etransferRequireReference: event.target.checked,
                                }))}
                              className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                            />
                          </label>

                          <label className="flex items-start justify-between gap-3 rounded-[10px] border border-gray-200 p-3">
                            <div className="space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Payment QR page
                              </span>
                              <p className="text-sm text-gray-700">
                                Let clients scan a QR code that opens payment
                                instructions.
                              </p>
                            </div>
                            <input
                              type="checkbox"
                              data-testid="payments-etransfer-qr"
                              checked={paymentsForm.etransferQrEnabled}
                              onChange={event =>
                                updatePaymentsForm(prev => ({
                                  ...prev,
                                  etransferQrEnabled: event.target.checked,
                                }))}
                              className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                            />
                          </label>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                        <div className="text-xs text-gray-500">
                          Applies to new checkouts only — completed appointments are
                          never recalculated.
                        </div>
                        <button
                          type="button"
                          data-testid="payments-save"
                          onClick={() => void savePayments()}
                          disabled={paymentsSaving || !paymentsDirty}
                          className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Save className="size-4" />
                          <span>
                            {paymentsSaving ? 'Saving...' : 'Save payments & taxes'}
                          </span>
                        </button>
                      </div>

                      {paymentsSaved && (
                        <div className="text-right text-xs font-medium text-green-600">
                          Payments & taxes saved.
                        </div>
                      )}
                    </div>
                  )}
            </Section>
          </>
        )}

        {view === 'notifications' && (
          <Section
            title="Notifications"
            footer="Control who gets notified when bookings are created or cancelled. Client confirmations still send separately."
          >
            {programsLoading
              ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
                  </div>
                )
              : (
                  <div className="space-y-4 p-4">
                    {(
                      [
                        {
                          key: 'newBooking',
                          title: 'New booking alerts',
                          subtitle:
                        'Notify your team when a client books successfully.',
                          technicianDescription:
                        'Send a new-booking alert to the artist assigned to the appointment.',
                        },
                        {
                          key: 'appointmentCancelled',
                          title: 'Cancellation alerts',
                          subtitle:
                        'Notify your team when an appointment is cancelled or marked as no-show.',
                          technicianDescription:
                        'Send a cancellation alert to the artist assigned to the appointment.',
                        },
                      ] as const
                    ).map((notificationEvent) => {
                      const eventForm
                    = bookingNotificationsForm[notificationEvent.key];

                      return (
                        <div
                          key={notificationEvent.key}
                          className="space-y-3 rounded-[14px] border border-gray-200 bg-gray-50/70 p-3"
                        >
                          <div className="space-y-1 px-1">
                            <div className="text-sm font-semibold text-[#1C1C1E]">
                              {notificationEvent.title}
                            </div>
                            <p className="text-xs text-gray-500">
                              {notificationEvent.subtitle}
                            </p>
                          </div>

                          <div className="rounded-[12px] border border-gray-200 bg-white/80 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <Bell className="size-4 text-[#FF3B30]" />
                                  <span className="text-sm font-semibold text-[#1C1C1E]">
                                    Notify assigned technician
                                  </span>
                                </div>
                                <p className="text-sm text-gray-600">
                                  {notificationEvent.technicianDescription}
                                </p>
                              </div>
                              <input
                                type="checkbox"
                                checked={eventForm.technicianEnabled}
                                onChange={event =>
                                  updateBookingNotificationEvent(
                                    notificationEvent.key,
                                    {
                                      technicianEnabled: event.target.checked,
                                    },
                                  )}
                                className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                                aria-label={`Notify assigned technician for ${notificationEvent.title.toLowerCase()}`}
                              />
                            </div>

                            <label className="mt-3 flex flex-col gap-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Channel
                              </span>
                              <select
                                value={eventForm.technicianChannel}
                                onChange={event =>
                                  updateBookingNotificationEvent(
                                    notificationEvent.key,
                                    {
                                      technicianChannel: event.target
                                        .value as BookingNotificationChannel,
                                    },
                                  )}
                                disabled={!eventForm.technicianEnabled}
                                className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF] disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
                                aria-label={`Technician notification channel for ${notificationEvent.title.toLowerCase()}`}
                              >
                                {BOOKING_NOTIFICATION_CHANNEL_OPTIONS.map(
                                  (option) => {
                                    const smsUnavailable
                                  = option.value === 'sms'
                                  || option.value === 'both'
                                    ? !bookingNotificationCapabilities.smsChannelAvailable
                                    : false;
                                    const emailUnavailable
                                  = option.value === 'email'
                                  || option.value === 'both'
                                    ? !bookingNotificationCapabilities.emailChannelAvailable
                                    : false;
                                    const disabled
                                  = smsUnavailable || emailUnavailable;

                                    return (
                                      <option
                                        key={option.value}
                                        value={option.value}
                                        disabled={disabled}
                                      >
                                        {option.label}
                                        {disabled ? ' (Unavailable)' : ''}
                                      </option>
                                    );
                                  },
                                )}
                              </select>
                            </label>

                            <p className="mt-2 text-xs text-gray-500">
                              Technician email alerts require an email on each
                              technician profile.
                            </p>
                          </div>

                          <div className="rounded-[12px] border border-gray-200 bg-white/80 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <User className="size-4 text-rose-800" />
                                  <span className="text-sm font-semibold text-[#1C1C1E]">
                                    Notify salon owner
                                  </span>
                                </div>
                                <p className="text-sm text-gray-600">
                                  Use the owner phone and email saved on the salon
                                  record.
                                </p>
                              </div>
                              <input
                                type="checkbox"
                                checked={eventForm.ownerEnabled}
                                onChange={event =>
                                  updateBookingNotificationEvent(
                                    notificationEvent.key,
                                    {
                                      ownerEnabled: event.target.checked,
                                    },
                                  )}
                                className="mt-1 size-4 rounded border-gray-300 text-rose-800 focus:ring-rose-700"
                                aria-label={`Notify salon owner for ${notificationEvent.title.toLowerCase()}`}
                              />
                            </div>

                            <label className="mt-3 flex flex-col gap-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Channel
                              </span>
                              <select
                                value={eventForm.ownerChannel}
                                onChange={event =>
                                  updateBookingNotificationEvent(
                                    notificationEvent.key,
                                    {
                                      ownerChannel: event.target
                                        .value as BookingNotificationChannel,
                                    },
                                  )}
                                disabled={!eventForm.ownerEnabled}
                                className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF] disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
                                aria-label={`Owner notification channel for ${notificationEvent.title.toLowerCase()}`}
                              >
                                {BOOKING_NOTIFICATION_CHANNEL_OPTIONS.map(
                                  (option) => {
                                    const smsUnavailable
                                  = option.value === 'sms'
                                  || option.value === 'both'
                                    ? !bookingNotificationCapabilities.smsChannelAvailable
                                    || !bookingNotificationCapabilities.ownerPhonePresent
                                    : false;
                                    const emailUnavailable
                                  = option.value === 'email'
                                  || option.value === 'both'
                                    ? !bookingNotificationCapabilities.emailChannelAvailable
                                    || !bookingNotificationCapabilities.ownerEmailPresent
                                    : false;
                                    const disabled
                                  = smsUnavailable || emailUnavailable;

                                    return (
                                      <option
                                        key={option.value}
                                        value={option.value}
                                        disabled={disabled}
                                      >
                                        {option.label}
                                        {disabled ? ' (Unavailable)' : ''}
                                      </option>
                                    );
                                  },
                                )}
                              </select>
                            </label>
                          </div>
                        </div>
                      );
                    })}

                    {(!bookingNotificationCapabilities.ownerPhonePresent
                      || !bookingNotificationCapabilities.ownerEmailPresent) && (
                      <div className="flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        <AlertCircle className="mt-0.5 size-4 shrink-0" />
                        <div>
                          Owner alerts use the salon owner contact on the salon
                          record.
                          {!bookingNotificationCapabilities.ownerPhonePresent
                          && ' Phone is missing.'}
                          {!bookingNotificationCapabilities.ownerEmailPresent
                          && ' Email is missing.'}
                        </div>
                      </div>
                    )}

                    {(!bookingNotificationCapabilities.smsChannelAvailable
                      || !bookingNotificationCapabilities.emailChannelAvailable) && (
                      <div className="rounded-[10px] border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                        {!bookingNotificationCapabilities.smsChannelAvailable && (
                          <div>
                            SMS alerts are unavailable until SMS reminders are enabled
                            for the salon and Twilio is configured.
                          </div>
                        )}
                        {!bookingNotificationCapabilities.emailChannelAvailable && (
                          <div>
                            Email alerts are unavailable until Resend is configured.
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                      <div className="text-xs text-gray-500">
                        Duplicate owner and technician destinations are deduplicated
                        automatically per channel.
                      </div>
                      <button
                        type="button"
                        onClick={() => void saveBookingNotifications()}
                        disabled={bookingNotificationsSaving || !notificationsDirty}
                        className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Save className="size-4" />
                        <span>
                          {bookingNotificationsSaving ? 'Saving...' : 'Save alerts'}
                        </span>
                      </button>
                    </div>

                    {bookingNotificationsSaved && (
                      <div className="text-right text-xs font-medium text-green-600">
                        Notification settings saved.
                      </div>
                    )}
                  </div>
                )}
          </Section>
        )}

        {view === 'features' && hasEntitledModules && (
          <>
            {/* Modules (Step 16.3) */}
            <Section
              title="Modules"
              footer="Enable or disable features for your salon. Disabled modules won't be available to staff."
            >
              {modulesLoading
                ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
                    </div>
                  )
                : (
                    <>
                      {/* Marketing Group */}
                      <div className="border-b border-gray-100 px-4 py-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Marketing
                        </span>
                      </div>
                      {entitledModules.smsReminders && (
                        <ModuleRow
                          icon={MessageSquare}
                          iconColor="bg-green-500"
                          label="SMS Reminders"
                          moduleKey="smsReminders"
                          enabled={modules.smsReminders}
                          entitled={entitledModules.smsReminders}
                          onToggle={handleModuleToggle}
                        />
                      )}
                      {entitledModules.referrals && (
                        <ModuleRow
                          icon={Users}
                          iconColor="bg-blue-500"
                          label="Referrals"
                          moduleKey="referrals"
                          enabled={modules.referrals}
                          entitled={entitledModules.referrals}
                          onToggle={handleModuleToggle}
                        />
                      )}
                      {entitledModules.rewards && (
                        <ModuleRow
                          icon={Gift}
                          iconColor="bg-purple-500"
                          label="Rewards"
                          moduleKey="rewards"
                          enabled={modules.rewards}
                          entitled={entitledModules.rewards}
                          onToggle={handleModuleToggle}
                        />
                      )}

                      {/* Staff Group */}
                      <div className="border-b border-gray-100 px-4 py-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Staff
                        </span>
                      </div>
                      {entitledModules.scheduleOverrides && (
                        <ModuleRow
                          icon={User}
                          iconColor="bg-orange-500"
                          label="Schedule Overrides"
                          moduleKey="scheduleOverrides"
                          enabled={modules.scheduleOverrides}
                          entitled={entitledModules.scheduleOverrides}
                          onToggle={handleModuleToggle}
                        />
                      )}
                      {entitledModules.staffEarnings && (
                        <ModuleRow
                          icon={BarChart3}
                          iconColor="bg-teal-500"
                          label="Staff Earnings"
                          moduleKey="staffEarnings"
                          enabled={modules.staffEarnings}
                          entitled={entitledModules.staffEarnings}
                          onToggle={handleModuleToggle}
                        />
                      )}

                      {/* Controls Group */}
                      <div className="border-b border-gray-100 px-4 py-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Controls
                        </span>
                      </div>
                      {entitledModules.clientFlags && (
                        <ModuleRow
                          icon={Flag}
                          iconColor="bg-amber-500"
                          label="Client Flags"
                          moduleKey="clientFlags"
                          enabled={modules.clientFlags}
                          entitled={entitledModules.clientFlags}
                          onToggle={handleModuleToggle}
                        />
                      )}
                      {entitledModules.clientBlocking && (
                        <ModuleRow
                          icon={Shield}
                          iconColor="bg-red-500"
                          label="Client Blocking"
                          moduleKey="clientBlocking"
                          enabled={modules.clientBlocking}
                          entitled={entitledModules.clientBlocking}
                          onToggle={handleModuleToggle}
                        />
                      )}

                      {/* Analytics Group */}
                      <div className="border-b border-gray-100 px-4 py-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Analytics
                        </span>
                      </div>
                      {entitledModules.analyticsDashboard && (
                        <ModuleRow
                          icon={BarChart3}
                          iconColor="bg-indigo-500"
                          label="Analytics Dashboard"
                          moduleKey="analyticsDashboard"
                          enabled={modules.analyticsDashboard}
                          entitled={entitledModules.analyticsDashboard}
                          onToggle={handleModuleToggle}
                        />
                      )}
                      {entitledModules.utilization && (
                        <ModuleRow
                          icon={BarChart3}
                          iconColor="bg-cyan-500"
                          label="Utilization Reports"
                          moduleKey="utilization"
                          enabled={modules.utilization}
                          entitled={entitledModules.utilization}
                          onToggle={handleModuleToggle}
                          isLast
                        />
                      )}

                      {modulesSaving && (
                        <div className="flex items-center justify-center py-2 text-xs text-gray-500">
                          Saving...
                        </div>
                      )}
                    </>
                  )}
            </Section>

            {/* Programs (Step 21E) */}
            {hasClientPrograms && (
              <Section
                title="Programs"
                footer="Control reviews and rewards programs. Referral and review rewards are fixed platform offers; visit-earned points stay active."
              >
                {programsLoading
                  ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
                      </div>
                    )
                  : (
                      <>
                        {/* Program Toggles */}
                        <Row
                          icon={MessageSquare}
                          iconColor="bg-purple-500"
                          label="Reviews"
                          type="toggle"
                          defaultOn={reviewsEnabled}
                          onToggle={(value) => {
                            setReviewsEnabled(value);
                            saveProgramToggle('reviewsEnabled', value);
                          }}
                        />
                        <Row
                          icon={Gift}
                          iconColor="bg-green-500"
                          label="Rewards Program"
                          type="toggle"
                          defaultOn={rewardsEnabledProgram}
                          onToggle={(value) => {
                            setRewardsEnabledProgram(value);
                            saveProgramToggle('rewardsEnabled', value);
                          }}
                          isLast
                        />

                        <div className="border-t border-gray-100 px-4 py-3">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                            Active Offers
                          </div>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-600">Referral reward</span>
                              <span className="font-medium text-gray-900">
                                $10 for the referrer
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Friend offer</span>
                              <span className="font-medium text-gray-900">
                                $10 off first appointment
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">
                                Google review reward
                              </span>
                              <span className="font-medium text-gray-900">
                                $10 off (manual grant)
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Visit earning</span>
                              <span className="font-medium text-gray-900">
                                20 points per $1 spent
                              </span>
                            </div>
                          </div>
                        </div>

                        {programsSaving && (
                          <div className="flex items-center justify-center py-2 text-xs text-gray-500">
                            Saving...
                          </div>
                        )}
                      </>
                    )}
              </Section>
            )}
          </>
        )}

        {view === 'visibility' && hasEntitledModules && visibilityEntitled && (
          <Section
            title="Staff Visibility"
            footer="Control what information staff can see in their dashboard. Changes take effect immediately."
          >
            {visibilityLoading
              ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent" />
                  </div>
                )
              : (
                  <>
                    <Row
                      icon={Eye}
                      iconColor="bg-rose-800"
                      label="Client Phone"
                      type="toggle"
                      defaultOn={visibility.staff?.showClientPhone ?? true}
                      onToggle={value =>
                        handleVisibilityToggle('showClientPhone', value)}
                    />
                    <Row
                      label="Client Full Name"
                      type="toggle"
                      defaultOn={visibility.staff?.showClientFullName ?? true}
                      onToggle={value =>
                        handleVisibilityToggle('showClientFullName', value)}
                    />
                    <Row
                      label="Client Email"
                      type="toggle"
                      defaultOn={visibility.staff?.showClientEmail ?? false}
                      onToggle={value =>
                        handleVisibilityToggle('showClientEmail', value)}
                    />
                    <Row
                      label="Appointment Price"
                      type="toggle"
                      defaultOn={visibility.staff?.showAppointmentPrice ?? true}
                      onToggle={value =>
                        handleVisibilityToggle('showAppointmentPrice', value)}
                    />
                    <Row
                      label="Client History"
                      type="toggle"
                      defaultOn={visibility.staff?.showClientHistory ?? false}
                      onToggle={value =>
                        handleVisibilityToggle('showClientHistory', value)}
                    />
                    <Row
                      label="Client Notes"
                      type="toggle"
                      defaultOn={visibility.staff?.showClientNotes ?? true}
                      onToggle={value =>
                        handleVisibilityToggle('showClientNotes', value)}
                    />
                    <Row
                      label="Other Tech Appointments"
                      type="toggle"
                      defaultOn={
                        visibility.staff?.showOtherTechAppointments ?? false
                      }
                      onToggle={value =>
                        handleVisibilityToggle(
                          'showOtherTechAppointments',
                          value,
                        )}
                      isLast
                    />
                    {visibilitySaving && (
                      <div className="flex items-center justify-center py-2 text-xs text-gray-500">
                        Saving...
                      </div>
                    )}
                  </>
                )}
          </Section>
        )}

        {view === 'account' && (
          <>
            <Section
              title="Owner profile"
              footer="Your name appears in the workspace header and on decision logs. Email is used for account matching and owner alerts."
            >
              <div className="space-y-3 p-4">
                {profileError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{profileError}</span>
                  </div>
                )}
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Name
                  </span>
                  <input
                    type="text"
                    value={profileName}
                    maxLength={100}
                    onChange={(event) => {
                      setProfileName(event.target.value);
                      setProfileDirty(true);
                      setProfileSaved(false);
                    }}
                    className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Email
                  </span>
                  <input
                    type="email"
                    value={profileEmail}
                    onChange={(event) => {
                      setProfileEmail(event.target.value);
                      setProfileDirty(true);
                      setProfileSaved(false);
                    }}
                    className="h-11 rounded-[10px] border border-gray-200 px-3 text-[15px] text-black outline-none transition-colors focus:border-[#007AFF]"
                    placeholder="you@example.com"
                  />
                  <span className="text-xs text-gray-500">
                    Both fields save together. Email must be entered to save.
                  </span>
                </label>
                <div className="flex items-center justify-end gap-3">
                  {profileSaved && !profileError && (
                    <span className="text-xs font-medium text-green-600">
                      Profile saved.
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void saveProfile()}
                    disabled={
                      profileSaving
                      || !profileDirty
                      || !profileName.trim()
                      || !profileEmail.includes('@')
                    }
                    className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Save className="size-4" />
                    <span>{profileSaving ? 'Saving...' : 'Save profile'}</span>
                  </button>
                </div>
              </div>
            </Section>

            <Section
              title="Plan & billing"
              footer={
                billingMode === 'STRIPE'
                  ? 'Manage billing opens the secure Stripe portal to update payment details, view invoices, or cancel.'
                  : 'This salon is billed offline. Contact Luster to change plans.'
              }
            >
              <div className="space-y-3 p-4">
                {/* Billing status (read-only, moved from Programs) */}
                {billingMode === 'STRIPE'
                  ? (
                      <div className="flex items-center gap-2">
                        <div
                          className={`size-2 rounded-full ${subscriptionStatus === 'active' ? 'bg-green-500' : 'bg-amber-500'}`}
                        />
                        <span className="text-sm text-gray-900">
                          Stripe Billing
                          {subscriptionStatus
                            ? ` (${subscriptionStatus})`
                            : ''}
                        </span>
                      </div>
                    )
                  : (
                      <div className="flex items-center gap-2">
                        <div className="size-2 rounded-full bg-gray-400" />
                        <span className="text-sm text-gray-600">
                          Cash / Offline billing enabled
                        </span>
                      </div>
                    )}

                {portalError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{portalError}</span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {billingMode === 'STRIPE' && salonId && (
                    <button
                      type="button"
                      onClick={() => void openBillingPortal()}
                      disabled={portalOpening}
                      data-testid="manage-billing-button"
                      className="inline-flex items-center gap-2 rounded-[10px] bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CreditCard className="size-4" />
                      <span>{portalOpening ? 'Opening…' : 'Manage billing'}</span>
                    </button>
                  )}
                  {!isFreeSolo && (
                    <button
                      type="button"
                      onClick={() => setShowComparePlans(true)}
                      className="rounded-[10px] bg-gradient-to-r from-purple-500 to-indigo-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
                    >
                      Compare Plans
                    </button>
                  )}
                </div>
              </div>
            </Section>
          </>
        )}
      </div>

      {/* Compare Plans Modal (Step 19) */}
      <ComparePlansModal
        isOpen={showComparePlans}
        onClose={() => setShowComparePlans(false)}
      />
    </div>
  );
}

// Export sub-components for reuse
export { DirectionsLocationSection, ParkingInstructionsCard, ProfileCard, Row, Section };
