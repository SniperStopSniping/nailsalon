'use client';

/**
 * Canonical business information and public-photo editors used by the
 * Booking Page and Settings hubs.
 *
 * Four accordions — Business identity, Location, Contact, Hours — each showing
 * the ACTUAL saved value, an editor that writes to the canonical authority, and
 * (on Quick Book) the visibility switch that hides the value publicly without
 * deleting it. Every write reuses an existing writer or the small owner-only
 * `/api/admin/salon/information` route; nothing here keeps a dashboard copy.
 *
 *   - business name, logo, phone, email, Instagram, contact permissions,
 *     weekly hours       → PATCH /api/admin/salon/information
 *   - nail-tech name     → PUT  /api/admin/technicians/[id]   (never /api/admin/profile,
 *                          which is the signed-in owner's PRIVATE account)
 *   - profile photo      → POST /api/admin/technicians/[id]/avatar (existing upload path)
 *   - direct logo upload → POST /api/admin/salon/information
 *   - logo picker        → GET  /api/admin/portfolio (optional existing-image reuse)
 *   - street address     → PATCH /api/admin/location
 *   - address privacy    → booking-page content draft (`locationDisplayMode`), published later
 *   - timezone           → PATCH /api/admin/salon/settings (`bookingConfig.timezone`)
 *
 * Business hours write the salon row and the primary location only; staff
 * schedules stay in the Staff app.
 */

import { ExternalLink } from 'lucide-react';
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';

import type { BookingPageConfigSide } from '@/libs/bookingPageConfig';
import type { LocationDisplayMode } from '@/libs/bookingPageContent';
import {
  formatInstagramHandle,
  INSTAGRAM_FIELD_HELPER,
  INSTAGRAM_FIELD_LABEL,
  toInstagramHandle,
} from '@/libs/instagramHandle';

import {
  QUICK_BOOK_VISIBILITY_GROUPS,
  QUICK_BOOK_VISIBILITY_OPTIONS,
  type QuickBookProfileConfigPatch,
  QuickBookVisibilitySwitch,
} from './QuickBookProfileVisibilityCard';

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
type Weekday = (typeof WEEKDAYS)[number];
export type BusinessHoursValue = Record<Weekday, { open: string; close: string } | null>;

export const ADDRESS_PRIVACY_OPTIONS: ReadonlyArray<{
  description: string;
  label: string;
  note: string;
  value: LocationDisplayMode;
}> = [
  {
    description: 'Clients see your city while your street address, postal code and phone stay private.',
    label: 'Show only my city',
    note: 'Most private',
    value: 'city_only',
  },
  {
    description: 'Clients can see your complete address and use it for directions.',
    label: 'Always show my full address',
    note: 'Most visible',
    value: 'full_address',
  },
  {
    description: 'Clients see only your city while browsing. Your full address appears on their private appointment link after a confirmed booking.',
    label: 'Show my full address after they book',
    note: 'Balanced privacy',
    value: 'after_booking',
  },
];

export type SalonInformation = {
  salon: {
    id: string;
    slug: string;
    name: string;
    publicationStatus: string;
    slugLocked: boolean;
    customDomain: string | null;
    publicUrl: string;
    logoUrl: string | null;
    phone: string | null;
    email: string | null;
  };
  technician: { id: string; name: string; avatarUrl: string | null } | null;
  technicianCount: number;
  /** Canonical stored profile URL. */
  instagram: string | null;
  /** The same value as the bare handle — what this editor shows and sends. */
  instagramHandle?: string | null;
  location: { id: string; name: string; address: string | null; city: string | null; state: string | null; zipCode: string | null } | null;
  addressPrivacy: { draft: LocationDisplayMode; live: LocationDisplayMode };
  contactPreferences: { bookingOnlyContact: boolean | null; callEnabled: boolean | null; textEnabled: boolean | null; textNumber: string | null };
  businessHours: BusinessHoursValue | null;
  /**
   * Weekdays at least one active staff member currently works. Opening a day
   * in these hours does not create staff availability (staff schedules live in
   * Staff and this editor never writes them), so the days missing from here
   * are the ones that would go public with no bookable times.
   */
  staffedDays: Weekday[];
  timezone: string;
};

/** "Sunday", "Sunday and Monday", "Sunday, Monday and Tuesday". */
function formatWeekdayList(days: readonly Weekday[]): string {
  const labels = days.map(day => `${day[0]!.toUpperCase()}${day.slice(1)}`);
  if (labels.length <= 1) {
    return labels[0] ?? '';
  }
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

type SectionStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message ?? (typeof payload?.error === 'string' ? payload.error : null) ?? payload?.message;
    const error = new Error(message || `Request failed (${response.status})`);
    (error as Error & { status?: number; code?: string }).status = response.status;
    (error as Error & { status?: number; code?: string }).code = payload?.error?.code;
    throw error;
  }
  return payload as T;
}

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
  const ordered = [...zones.filter(zone => zone.startsWith('America/')), ...zones.filter(zone => !zone.startsWith('America/'))];
  if (currentValue && !ordered.includes(currentValue)) {
    ordered.unshift(currentValue);
  }
  return ordered;
}

function emptyHours(): BusinessHoursValue {
  return { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null };
}

const fieldClass = 'mt-1 w-full min-h-11 rounded-xl border border-[var(--owner-line-strong)] px-3 py-2 text-base text-[var(--owner-ink)]';
const labelClass = 'block text-sm font-medium text-[var(--owner-ink)]';
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--owner-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--owner-line-strong)] bg-[var(--owner-surface)] px-4 py-2 text-sm font-semibold text-[var(--owner-ink)] disabled:opacity-50';

/**
 * Publish semantics per accordion. Three of the four write the canonical
 * business record and are public the moment they save; address privacy is the
 * single drafted field on this panel. The badge says which, because the panel
 * header alone used to claim everything was drafted (AG-w2-information-parity-06).
 */
const PUBLISH_BADGES = {
  'live': { label: 'Live', title: 'Saves here are public immediately.' },
  'live-with-draft': { label: 'Live · 1 drafted setting', title: 'Saves here are public immediately, except Address privacy, which waits for you to publish.' },
} as const;

function Accordion({ title, testId, subtitle, publishes, defaultOpen = false, children }: {
  title: string;
  testId: string;
  subtitle: string;
  publishes?: keyof typeof PUBLISH_BADGES;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const badge = publishes ? PUBLISH_BADGES[publishes] : null;
  return (
    <details className="group py-2" data-testid={testId} open={defaultOpen}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3">
        <span className="min-w-0">
          <span className="block font-semibold">{title}</span>
          <span className="block text-xs text-[var(--owner-muted)]">{subtitle}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {badge && (
            <span className="rounded-full bg-[var(--owner-ground)] px-2 py-0.5 text-[11px] font-semibold text-[var(--owner-muted)]" data-testid={`${testId}-publish-badge`} title={badge.title}>
              {badge.label}
            </span>
          )}
          <span aria-hidden="true" className="text-[var(--owner-line-strong)] transition-transform group-open:rotate-180">⌄</span>
        </span>
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  );
}

function StatusLine({ status, error, savedText = 'Saved' }: { status: SectionStatus; error: string | null; savedText?: string }) {
  return (
    <p aria-live="polite" className="mt-2 min-h-5 text-xs text-[var(--owner-muted)]" role="status">
      {status === 'saving' && 'Saving…'}
      {status === 'dirty' && 'Unsaved changes'}
      {status === 'saved' && savedText}
      {status === 'error' && <span className="text-red-700">{error ?? 'Could not save — your edits are kept, please retry.'}</span>}
    </p>
  );
}

/**
 * A small explicit-save form. Edits are retained on failure (status becomes
 * `error`, values untouched) so the owner can fix and retry; `flush` lets the
 * guided review save it before navigating.
 */
function useSectionForm<T extends object>(save: (values: T) => Promise<void>) {
  const [values, setValuesState] = useState<T | null>(null);
  const [status, setStatus] = useState<SectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const valuesRef = useRef<T | null>(null);
  const statusRef = useRef<SectionStatus>('idle');
  valuesRef.current = values;
  statusRef.current = status;

  const reset = useCallback((next: T) => {
    if (statusRef.current === 'dirty' || statusRef.current === 'error') {
      return;
    }
    setValuesState(next);
  }, []);
  const update = useCallback((patch: Partial<T>) => {
    setValuesState(current => (current ? { ...current, ...patch } : current));
    setStatus('dirty');
    setError(null);
  }, []);
  const submit = useCallback(async (): Promise<boolean> => {
    const current = valuesRef.current;
    if (!current || statusRef.current === 'saving') {
      return statusRef.current !== 'error';
    }
    setStatus('saving');
    setError(null);
    try {
      await save(current);
      setStatus('saved');
      return true;
    } catch (saveError) {
      setStatus('error');
      setError(saveError instanceof Error ? saveError.message : 'Could not save.');
      return false;
    }
  }, [save]);
  const flush = useCallback(async (): Promise<boolean> => {
    if (statusRef.current === 'dirty' || statusRef.current === 'error') {
      return submit();
    }
    return true;
  }, [submit]);

  return { values, status, error, reset, update, submit, flush };
}

export function BookingPageInformationEditor({
  locale,
  salonSlug,
  disabled,
  draft,
  onConfigPatch,
  addressPrivacy,
  liveAddressPrivacy,
  onAddressPrivacyChange,
  savedDetails,
  registerFlush,
  coverUrl = null,
  coverUsedByLayout,
  coverUpload,
  onUploadCover,
  onUseDefaultCover,
  mode = 'legacy',
}: {
  locale: string;
  salonSlug: string;
  disabled: boolean;
  draft: Pick<BookingPageConfigSide, 'layout' | 'quickBookProfile'>;
  onConfigPatch: (patch: QuickBookProfileConfigPatch) => void;
  addressPrivacy: LocationDisplayMode;
  liveAddressPrivacy: LocationDisplayMode;
  onAddressPrivacyChange: (mode: LocationDisplayMode) => void;
  /** Read-only fallback for admins who are not the owner. */
  savedDetails?: Record<string, string[]>;
  /** The guided review calls this before navigating; false keeps the owner here. */
  registerFlush?: (flush: (() => Promise<boolean>) | null) => void;
  /**
   * Cover photo — the third image role. Lives on the booking-page DRAFT
   * (`bookingPageContent.draft.heroImageUrl`), so unlike the logo and the
   * nail-tech photo it waits for a publish. Optional: an omitted handler
   * hides the control (older call sites).
   */
  coverUrl?: string | null;
  coverUsedByLayout?: boolean;
  coverUpload?: { status: 'idle' | 'uploading' | 'error'; error: string | null; note: string | null };
  onUploadCover?: (file: File) => void;
  onUseDefaultCover?: () => void;
  /** Booking Page owns display choices and public photos; Settings owns the editable business record. */
  mode?: 'booking' | 'business' | 'gallery' | 'legacy';
}) {
  const [info, setInfo] = useState<SalonInformation | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [logoPicker, setLogoPicker] = useState<{ open: boolean; photos: Array<{ id: string; imageUrl: string; altText: string | null }>; loading: boolean; error: string | null }>({ open: false, photos: [], loading: false, error: null });
  const [mediaStatus, setMediaStatus] = useState<{ status: SectionStatus; error: string | null }>({ status: 'idle', error: null });
  /**
   * The logo an onboarding-built salon arrives with lives in the onboarding
   * media store, which the Portfolio picker cannot see
   * (AG-w2-information-parity-04). Keeping the removed URL here makes "Remove
   * logo" reversible instead of a one-way door out of that asset.
   */
  const [removedLogoUrl, setRemovedLogoUrl] = useState<string | null>(null);
  // Optimistic selection: the radio reflects the tap at once while the draft
  // save is in flight, then follows the canonical draft value when it lands.
  const [selectedAddressPrivacy, setSelectedAddressPrivacy] = useState<LocationDisplayMode>(addressPrivacy);
  useEffect(() => {
    setSelectedAddressPrivacy(addressPrivacy);
  }, [addressPrivacy]);
  const query = `salonSlug=${encodeURIComponent(salonSlug)}`;
  const workspace = `/${locale}/admin?salon=${encodeURIComponent(salonSlug)}`;
  const showSwitches = mode !== 'business' && mode !== 'gallery' && draft.layout === 'quick_book';
  const showEditors = mode !== 'booking' && mode !== 'gallery';

  const loadInformation = useCallback(async () => {
    try {
      const payload = await requestJson<{ data: SalonInformation }>(`/api/admin/salon/information?${query}`);
      setInfo(payload.data);
      setLoadState('ready');
      return payload.data;
    } catch (loadError) {
      const status = (loadError as Error & { status?: number }).status;
      setLoadState(status === 403 ? 'forbidden' : 'error');
      return null;
    }
  }, [query]);

  useEffect(() => {
    void loadInformation();
  }, [loadInformation]);

  const patchInformation = useCallback(async (body: Record<string, unknown>) => {
    const payload = await requestJson<{ data: SalonInformation }>(`/api/admin/salon/information?${query}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setInfo(payload.data);
    return payload.data;
  }, [query]);

  const identity = useSectionForm<{ name: string; technicianName: string }>(useCallback(async (values) => {
    const name = values.name.trim();
    if (!name) {
      throw new Error('Business name is required.');
    }
    if (name !== info?.salon.name) {
      await patchInformation({ name });
    }
    const technicianName = values.technicianName.trim();
    if (info?.technician && technicianName && technicianName !== info.technician.name) {
      await requestJson(`/api/admin/technicians/${encodeURIComponent(info.technician.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonSlug, name: technicianName }),
      });
      setInfo(current => (current && current.technician ? { ...current, technician: { ...current.technician, name: technicianName } } : current));
    }
  }, [info?.salon.name, info?.technician, patchInformation, salonSlug]));

  const location = useSectionForm<{ name: string; address: string; city: string; state: string; zipCode: string }>(useCallback(async (values) => {
    if (!values.name.trim()) {
      throw new Error('Location name is required.');
    }
    const payload = await requestJson<{ data: { location: SalonInformation['location'] } }>(`/api/admin/location?${query}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    setInfo(current => (current ? { ...current, location: payload.data.location } : current));
  }, [query]));

  const contact = useSectionForm<{ phone: string; email: string; instagram: string; bookingOnlyContact: boolean; callEnabled: boolean; textEnabled: boolean; textNumber: string }>(useCallback(async (values) => {
    await patchInformation({
      phone: values.phone,
      email: values.email,
      instagram: values.instagram,
      contactPreferences: {
        bookingOnlyContact: values.bookingOnlyContact,
        callEnabled: values.callEnabled,
        textEnabled: values.textEnabled,
        textNumber: values.textNumber,
      },
    });
  }, [patchInformation]));

  const hours = useSectionForm<{ businessHours: BusinessHoursValue; timezone: string }>(useCallback(async (values) => {
    for (const day of WEEKDAYS) {
      const value = values.businessHours[day];
      if (value && (!value.open || !value.close || value.close <= value.open)) {
        throw new Error(`${day[0]!.toUpperCase()}${day.slice(1)} needs a closing time after its opening time.`);
      }
    }
    if (values.timezone !== info?.timezone) {
      await requestJson(`/api/admin/salon/settings?${query}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingConfig: { timezone: values.timezone } }),
      });
    }
    await patchInformation({ businessHours: values.businessHours });
  }, [info?.timezone, patchInformation, query]));

  // Saved hours are the salon's PUBLIC promise; bookable times are the
  // intersection of those hours and the staff schedules this editor never
  // writes. A day opened here with nobody working it goes live reading
  // "Opens Sunday 11:00 AM" while the booking calendar shows nothing, so the
  // owner is told before the customer finds out. `info` is the response of the
  // save itself, so both halves are the freshly-saved truth.
  const openDaysWithoutStaff = info && hours.status === 'saved'
    ? WEEKDAYS.filter(day => Boolean(info.businessHours?.[day]) && !info.staffedDays.includes(day))
    : [];

  useEffect(() => {
    if (!info) {
      return;
    }
    identity.reset({ name: info.salon.name, technicianName: info.technician?.name ?? '' });
    location.reset({
      name: info.location?.name ?? info.salon.name,
      address: info.location?.address ?? '',
      city: info.location?.city ?? '',
      state: info.location?.state ?? '',
      zipCode: info.location?.zipCode ?? '',
    });
    contact.reset({
      phone: info.salon.phone ?? '',
      email: info.salon.email ?? '',
      instagram: toInstagramHandle(info.instagramHandle ?? info.instagram),
      bookingOnlyContact: info.contactPreferences.bookingOnlyContact ?? false,
      callEnabled: info.contactPreferences.callEnabled ?? true,
      textEnabled: info.contactPreferences.textEnabled ?? false,
      textNumber: info.contactPreferences.textNumber ?? '',
    });
    hours.reset({ businessHours: info.businessHours ?? emptyHours(), timezone: info.timezone });
  }, [info, identity.reset, location.reset, contact.reset, hours.reset]); // eslint-disable-line react-hooks/exhaustive-deps

  const { flush: flushIdentity } = identity;
  const { flush: flushLocation } = location;
  const { flush: flushContact } = contact;
  const { flush: flushHours } = hours;
  const flushAll = useCallback(async () => {
    const results = await Promise.all([flushIdentity(), flushLocation(), flushContact(), flushHours()]);
    return results.every(Boolean);
  }, [flushIdentity, flushLocation, flushContact, flushHours]);

  useEffect(() => {
    registerFlush?.(flushAll);
    return () => registerFlush?.(null);
  }, [flushAll, registerFlush]);

  const openLogoPicker = async () => {
    setLogoPicker(current => ({ ...current, open: true, loading: true, error: null }));
    try {
      const payload = await requestJson<{ photos: Array<{ id: string; imageUrl: string; altText: string | null }> }>(`/api/admin/portfolio?${query}`);
      setLogoPicker({ open: true, photos: payload.photos, loading: false, error: null });
    } catch (pickerError) {
      // A failed portfolio read must not hide the images the owner already
      // has (the current and just-removed logo are added by the renderer).
      setLogoPicker({ open: true, photos: [], loading: false, error: pickerError instanceof Error ? pickerError.message : 'Could not load your portfolio.' });
    }
  };

  const saveLogo = async (logoUrl: string | null) => {
    const previousLogoUrl = info?.salon.logoUrl ?? null;
    setMediaStatus({ status: 'saving', error: null });
    try {
      await patchInformation({ logoUrl });
      setLogoPicker(current => ({ ...current, open: false }));
      setRemovedLogoUrl(logoUrl === null ? previousLogoUrl : null);
      setMediaStatus({ status: 'saved', error: null });
    } catch (saveError) {
      setMediaStatus({ status: 'error', error: saveError instanceof Error ? saveError.message : 'Could not save the logo.' });
    }
  };

  const uploadLogo = async (file: File | null) => {
    if (!file || !info) {
      return;
    }
    setMediaStatus({ status: 'saving', error: null });
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('baselineLogoUrl', info.salon.logoUrl ?? '');
      const payload = await requestJson<{ data: { logoUrl: string } }>(`/api/admin/salon/information?${query}`, { method: 'POST', body });
      setInfo(current => (current ? { ...current, salon: { ...current.salon, logoUrl: payload.data.logoUrl } } : current));
      setRemovedLogoUrl(null);
      setMediaStatus({ status: 'saved', error: null });
    } catch (uploadError) {
      const error = uploadError instanceof Error ? uploadError.message : 'Could not upload the logo.';
      // A stale-baseline conflict means another surface saved a newer logo
      // while this upload was in flight. Refresh before allowing a retry so
      // the next upload is based on the latest canonical value.
      await loadInformation();
      setMediaStatus({ status: 'error', error });
    }
  };

  const chooseCoverFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file && onUploadCover) {
      onUploadCover(file);
    }
  };

  const uploadProfilePhoto = async (file: File | null) => {
    if (!file || !info?.technician) {
      return;
    }
    setMediaStatus({ status: 'saving', error: null });
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('salonSlug', salonSlug);
      const payload = await requestJson<{ data?: { avatarUrl?: string | null } }>(`/api/admin/technicians/${encodeURIComponent(info.technician.id)}/avatar`, { method: 'POST', body });
      const avatarUrl = payload.data?.avatarUrl ?? null;
      setInfo(current => (current && current.technician ? { ...current, technician: { ...current.technician, avatarUrl } } : current));
      setMediaStatus({ status: 'saved', error: null });
    } catch (uploadError) {
      setMediaStatus({ status: 'error', error: uploadError instanceof Error ? uploadError.message : 'Could not upload the photo.' });
    }
  };

  const renderSwitches = (groupTitle: string) => {
    if (!showSwitches) {
      return null;
    }
    const group = QUICK_BOOK_VISIBILITY_GROUPS.find(item => item.title === groupTitle);
    if (!group) {
      return null;
    }
    return (
      <fieldset className="mt-4 divide-y divide-stone-100 border-t border-[var(--owner-line)]" disabled={disabled}>
        <legend className="pt-3 text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">Public visibility on Quick Book · saved to your draft</legend>
        {QUICK_BOOK_VISIBILITY_OPTIONS.filter(option => group.keys.includes(option.key)).map(option => (
          <QuickBookVisibilitySwitch checked={draft.quickBookProfile[option.key]} key={option.key} onConfigPatch={onConfigPatch} option={option} />
        ))}
      </fieldset>
    );
  };

  const renderFallback = (groupTitle: string) => (
    <>
      {[...new Set(savedDetails?.[groupTitle] ?? [])].map(detail => <p className="mb-2 break-words text-sm text-[var(--owner-muted)]" key={detail}>{detail}</p>)}
      {loadState === 'forbidden' && <p className="text-sm text-[var(--owner-muted)]">Only the salon owner can change these details.</p>}
      {loadState === 'error' && <p className="text-sm text-red-700">Current details could not be loaded. Reload to try again.</p>}
      {loadState === 'loading' && <p className="text-sm text-[var(--owner-muted)]">Loading current details…</p>}
    </>
  );

  const editable = loadState === 'ready' && info !== null;
  const draftPrivacyLabel = ADDRESS_PRIVACY_OPTIONS.find(option => option.value === liveAddressPrivacy)?.label;
  // The public page renders `@handle`; showing it beside the field is how the
  // owner sees what customers see without the stored URL leaking into the input.
  const instagramPreview = formatInstagramHandle(contact.values?.instagram ?? null);
  /**
   * The picker must never be an empty library: an onboarding-built salon keeps
   * its logo in a store Portfolio cannot see, so the currently saved logo (and
   * the one just removed) are always offered alongside the portfolio photos.
   */
  const logoChoices: Array<{ id: string; imageUrl: string; altText: string }> = (() => {
    const seen = new Set<string>();
    const choices: Array<{ id: string; imageUrl: string; altText: string }> = [];
    const push = (id: string, imageUrl: string | null, altText: string) => {
      if (!imageUrl || seen.has(imageUrl)) {
        return;
      }
      seen.add(imageUrl);
      choices.push({ id, imageUrl, altText });
    };
    push('current', info?.salon.logoUrl ?? null, 'Current business logo');
    push('previous', info?.salon.logoUrl ? null : removedLogoUrl, 'Logo you just removed');
    for (const photo of logoPicker.photos) {
      push(photo.id, photo.imageUrl, photo.altText ?? 'Portfolio photo');
    }
    return choices;
  })();

  const mediaControls = editable && info
    ? (
        <>
          <div className="grid gap-5 sm:grid-cols-2" data-testid="photos-gallery-media-controls">
            <div>
              <span className={labelClass}>Business logo</span>
              {info.salon.logoUrl
                ? <img alt="Current business logo" className="mt-2 size-24 rounded-xl border border-[var(--owner-line)] object-contain" src={info.salon.logoUrl} />
                : <p className="mt-1 text-sm text-[var(--owner-muted)]">No logo saved.</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <label className={`${secondaryButtonClass} cursor-pointer`}>
                  {mediaStatus.status === 'saving' ? 'Uploading…' : info.salon.logoUrl ? 'Replace logo' : 'Upload logo'}
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    data-testid="information-logo-upload"
                    disabled={disabled || mediaStatus.status === 'saving'}
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      event.target.value = '';
                      void uploadLogo(file);
                    }}
                    type="file"
                  />
                </label>
                <button className={secondaryButtonClass} data-testid="information-logo-choose" disabled={disabled || mediaStatus.status === 'saving'} onClick={() => void openLogoPicker()} type="button">Choose existing image</button>
                {info.salon.logoUrl && <button className={secondaryButtonClass} data-testid="information-logo-remove" disabled={disabled || mediaStatus.status === 'saving'} onClick={() => void saveLogo(null)} type="button">Remove logo</button>}
                {!info.salon.logoUrl && removedLogoUrl && (
                  <button className={secondaryButtonClass} data-testid="information-logo-undo" disabled={disabled || mediaStatus.status === 'saving'} onClick={() => void saveLogo(removedLogoUrl)} type="button">Undo remove</button>
                )}
              </div>
              <p className="mt-1 text-xs text-[var(--owner-muted)]">Upload a logo directly here, or reuse one of your existing images. A direct logo upload is not added to your nail-work Portfolio.</p>
              {logoPicker.open && (
                <div className="mt-2 rounded-xl border border-[var(--owner-line)] p-2" role="group" aria-label="Choose an existing logo image">
                  {logoPicker.loading && <p className="text-sm text-[var(--owner-muted)]">Loading your images…</p>}
                  {logoPicker.error && <p className="text-sm text-red-700">{logoPicker.error}</p>}
                  {!logoPicker.loading && logoChoices.length === 0 && <p className="text-sm text-[var(--owner-muted)]">No existing images to choose from. Upload a logo above instead.</p>}
                  <div className="grid grid-cols-3 gap-2">
                    {logoChoices.map(choice => (
                      <button className={`aspect-square min-h-11 overflow-hidden rounded-lg border ${choice.imageUrl === info.salon.logoUrl ? 'border-[var(--owner-accent)]' : 'border-[var(--owner-line)]'}`} data-testid={`information-logo-option-${choice.id}`} key={choice.id} onClick={() => void saveLogo(choice.imageUrl)} type="button">
                        <img alt={choice.altText} className="size-full object-cover" src={choice.imageUrl} />
                      </button>
                    ))}
                  </div>
                  <button className={`${secondaryButtonClass} mt-2`} onClick={() => setLogoPicker(current => ({ ...current, open: false }))} type="button">Close</button>
                </div>
              )}
            </div>

            <div>
              <span className={labelClass}>Nail-tech profile photo</span>
              {info.technician?.avatarUrl
                ? <img alt="Current nail tech" className="mt-2 size-24 rounded-full border border-[var(--owner-line)] object-cover" src={info.technician.avatarUrl} />
                : <p className="mt-1 text-sm text-[var(--owner-muted)]">{info.technician ? 'No profile photo saved.' : 'Team photos are managed per nail tech in Team.'}</p>}
              {info.technician && (
                <label className={`${secondaryButtonClass} mt-2 cursor-pointer`}>
                  {info.technician.avatarUrl ? 'Replace profile photo' : 'Upload profile photo'}
                  <input accept="image/jpeg,image/png,image/webp" className="sr-only" data-testid="information-tech-photo" disabled={disabled || mediaStatus.status === 'saving'} onChange={event => void uploadProfilePhoto(event.target.files?.[0] ?? null)} type="file" />
                </label>
              )}
              <p className="mt-1 text-xs text-[var(--owner-muted)]">This is the same photo used by your Team profile. Profile-led website layouts can show it; it is never used as your logo.</p>
            </div>

            {onUploadCover && (
              <div className="sm:col-span-2" data-testid="information-cover">
                <span className={labelClass}>Cover photo · optional</span>
                <p className="mt-0.5 text-xs text-[var(--owner-muted)]">A large photo of your work or studio, used in selected layouts.</p>
                {coverUrl
                  ? <img alt="Current cover" className="mt-2 h-28 w-48 rounded-xl border border-[var(--owner-line)] object-cover" src={coverUrl} />
                  : (
                      <p className="mt-1 text-sm text-[var(--owner-muted)]" data-testid="information-cover-default-note">
                        Using a default cover. It appears in cover-photo layouts until you replace it.
                      </p>
                    )}
                {coverUrl && coverUsedByLayout === false && <p className="mt-1 text-xs text-[var(--owner-muted)]">Your cover is saved. Your current layout does not display it.</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <label className={`${secondaryButtonClass} cursor-pointer`}>
                    {coverUpload?.status === 'uploading' ? 'Uploading…' : coverUrl ? 'Replace cover' : 'Upload cover'}
                    <input
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      data-testid="information-cover-upload"
                      disabled={disabled || coverUpload?.status === 'uploading'}
                      onChange={chooseCoverFile}
                      type="file"
                    />
                  </label>
                  {coverUrl && onUseDefaultCover && <button className={secondaryButtonClass} data-testid="information-cover-use-default" disabled={disabled} onClick={onUseDefaultCover} type="button">Use default cover</button>}
                </div>
                {coverUpload?.status === 'error' && coverUpload.error && <p className="mt-1 text-sm text-red-700" role="alert">{coverUpload.error}</p>}
                {coverUpload?.note && <p className="mt-1 text-xs text-[var(--owner-muted)]">{coverUpload.note}</p>}
                <p className="mt-1 text-xs text-[var(--owner-muted)]">Cover changes stay in your booking-page draft and go live when you publish. Reposition the image and edit cover writing in Layout.</p>
              </div>
            )}
          </div>
          <StatusLine error={mediaStatus.error} savedText="Image saved" status={mediaStatus.status} />
        </>
      )
    : renderFallback('Business identity');

  if (mode === 'gallery') {
    return (
      <section className="rounded-3xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-5 shadow-sm" data-testid="booking-page-information-editor">
        <h2 className="text-lg font-semibold text-[var(--owner-ink)]">Photos &amp; Gallery</h2>
        <p className="mt-1 text-sm text-[var(--owner-muted)]" data-testid="information-publish-summary">Your logo and profile photo update everywhere as soon as they save. Your cover stays in the website draft until you publish.</p>
        <div className="mt-5">{mediaControls}</div>
        <div className="mt-6 rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-ground)] p-4" data-testid="photos-gallery-portfolio">
          <h3 className="font-semibold text-[var(--owner-ink)]">Nail-work Portfolio</h3>
          <p className="mt-1 text-sm text-[var(--owner-muted)]">Upload and organize reusable photos of your nail work for your profile and Luster Discover.</p>
          <a className={`${secondaryButtonClass} mt-3`} href={`${workspace}&app=portfolio`}>Manage Portfolio</a>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-5 shadow-sm" data-testid="booking-page-information-editor">
      <h2 className="text-lg font-semibold text-[var(--owner-ink)]">
        {mode === 'booking' ? 'Business Info Display' : mode === 'business' ? 'Business Profile' : 'Your Information'}
      </h2>
      <p className="mt-1 text-sm text-[var(--owner-muted)]" data-testid="information-publish-summary">
        {mode === 'booking'
          ? 'These are the current business values customers may see. Change what appears here; edit the actual business record in Settings. Display choices wait in your website draft until you publish.'
          : mode === 'business'
            ? 'This is the actual business record used by your live site and bookings. Name, contact, address and hours take effect as soon as each section is saved.'
            : 'These are the details you saved during setup. Editing changes the same business record your live site and bookings use, so name, contact and hours go public as soon as you save them. Address privacy is the one setting here that waits in your draft until you publish; hiding a detail keeps it saved.'}
      </p>

      <div className="mt-4 divide-y divide-stone-200">
        <Accordion defaultOpen publishes="live" subtitle="Name, website address, nail tech, logo and photo" testId="information-identity" title="Business identity">
          {editable && identity.values && showEditors
            ? (
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void identity.submit();
                  }}
                >
                  <label className={labelClass}>
                    Business name
                    <input className={fieldClass} data-testid="information-business-name" disabled={disabled} onChange={event => identity.update({ name: event.target.value })} type="text" value={identity.values.name} />
                  </label>
                  <div>
                    <span className={labelClass}>Website address</span>
                    <p className="mt-1 break-all text-sm text-[var(--owner-muted)]" data-testid="information-public-url">{info.salon.publicUrl}</p>
                    <p className="text-xs text-[var(--owner-muted)]">
                      {info.salon.slugLocked
                        ? 'Your link is locked now that your site is published, so bookmarks and printed links keep working.'
                        : 'Your link is set when you publish. Use “Review saved setup” on the Booking Page screen to change it before then.'}
                    </p>
                  </div>
                  {info.technician
                    ? (
                        <label className={labelClass}>
                          Nail tech name (shown to clients)
                          <input className={fieldClass} data-testid="information-tech-name" disabled={disabled} onChange={event => identity.update({ technicianName: event.target.value })} type="text" value={identity.values.technicianName} />
                          <span className="mt-1 block text-xs font-normal text-[var(--owner-muted)]">This is your public Staff profile, not your private account name.</span>
                        </label>
                      )
                    : (
                        <p className="text-sm text-[var(--owner-muted)]">
                          {info.technicianCount > 1 ? `Your team has ${info.technicianCount} nail techs. ` : 'No active nail tech yet. '}
                          <a className="font-semibold text-[var(--owner-accent)] underline" href={`${workspace}&app=staff`}>Manage names and photos in Staff</a>
                        </p>
                      )}
                  <div className="flex flex-wrap items-center gap-3">
                    <button className={primaryButtonClass} data-testid="information-save-identity" disabled={disabled || identity.status === 'saving' || identity.status === 'idle' || identity.status === 'saved'} type="submit">Save identity</button>
                  </div>
                  <StatusLine error={identity.error} status={identity.status} />

                  <div className="border-t border-[var(--owner-line)] pt-4" data-testid="business-profile-photo-summary">
                    <p className="text-sm font-semibold text-[var(--owner-ink)]">Public photos</p>
                    <div className="mt-2 flex items-center gap-3">
                      {info.salon.logoUrl
                        ? <img alt="Current business logo" className="size-16 rounded-xl border border-[var(--owner-line)] object-contain" src={info.salon.logoUrl} />
                        : <span className="flex size-16 items-center justify-center rounded-xl border border-dashed border-[var(--owner-line)] text-center text-xs text-[var(--owner-muted)]">No logo</span>}
                      {info.technician?.avatarUrl
                        ? <img alt="Current nail tech" className="size-16 rounded-full border border-[var(--owner-line)] object-cover" src={info.technician.avatarUrl} />
                        : <span className="flex size-16 items-center justify-center rounded-full border border-dashed border-[var(--owner-line)] text-center text-xs text-[var(--owner-muted)]">No profile photo</span>}
                    </div>
                    <p className="mt-2 text-xs text-[var(--owner-muted)]">Logo, profile and cover photos are managed together on your Booking Page.</p>
                    <a className="mt-2 inline-flex min-h-11 items-center font-semibold text-[var(--owner-accent)] underline" href={`/${locale}/admin/booking-page?salon=${encodeURIComponent(salonSlug)}&panel=gallery`}>Manage photos →</a>
                  </div>
                  {renderSwitches('Business identity')}
                </form>
              )
            : editable && info
              ? (
                  <>
                    <dl className="grid gap-2 text-sm">
                      <div>
                        <dt className="font-medium text-[var(--owner-muted)]">Business name</dt>
                        <dd className="text-[var(--owner-ink)]">{info.salon.name}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-[var(--owner-muted)]">Nail-tech name</dt>
                        <dd className="text-[var(--owner-ink)]">{info.technician?.name ?? 'Managed in Team'}</dd>
                      </div>
                    </dl>
                    <a className="mt-3 inline-flex min-h-11 items-center font-semibold text-[var(--owner-accent)] underline" href={`${workspace}&app=settings&view=business-profile`}>Edit business profile →</a>
                    {renderSwitches('Business identity')}
                  </>
                )
              : (
                  <>
                    {renderFallback('Business identity')}
                    {renderSwitches('Business identity')}
                  </>
                )}
        </Accordion>

        <Accordion publishes="live-with-draft" subtitle="Address, city and how much of it clients can see" testId="information-location" title="Location">
          <>
            {editable && location.values && showEditors
              ? (
                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void location.submit();
                    }}
                  >
                    <label className={labelClass}>
                      Location name
                      <input className={fieldClass} data-testid="information-location-name" disabled={disabled} onChange={event => location.update({ name: event.target.value })} type="text" value={location.values.name} />
                    </label>
                    <label className={labelClass}>
                      Street address (kept private unless you choose to show it)
                      <input autoComplete="street-address" className={fieldClass} data-testid="information-address-street" disabled={disabled} onChange={event => location.update({ address: event.target.value })} type="text" value={location.values.address} />
                    </label>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <label className={labelClass}>
                        City
                        <input autoComplete="address-level2" className={fieldClass} data-testid="information-address-city" disabled={disabled} onChange={event => location.update({ city: event.target.value })} type="text" value={location.values.city} />
                      </label>
                      <label className={labelClass}>
                        Province / State
                        <input autoComplete="address-level1" className={fieldClass} disabled={disabled} onChange={event => location.update({ state: event.target.value })} type="text" value={location.values.state} />
                      </label>
                      <label className={labelClass}>
                        Postal code
                        <input autoComplete="postal-code" className={fieldClass} disabled={disabled} onChange={event => location.update({ zipCode: event.target.value })} type="text" value={location.values.zipCode} />
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button className={primaryButtonClass} data-testid="information-save-location" disabled={disabled || location.status === 'saving' || location.status === 'idle' || location.status === 'saved'} type="submit">Save address</button>
                      <a className="text-sm font-semibold text-[var(--owner-accent)] underline" href={`${workspace}&app=settings&view=location`}>Parking &amp; arrival instructions</a>
                    </div>
                    <StatusLine error={location.error} savedText="Address saved. It affects directions and bookings immediately." status={location.status} />
                  </form>
                )
              : editable && info
                ? (
                    <>
                      <p className="text-sm text-[var(--owner-ink)]">{[info.location?.address, info.location?.city, info.location?.state, info.location?.zipCode].filter(Boolean).join(', ') || 'No salon address saved.'}</p>
                      <a className="mt-3 inline-flex min-h-11 items-center font-semibold text-[var(--owner-accent)] underline" href={`${workspace}&app=settings&view=location`}>Edit salon address →</a>
                    </>
                  )
                : renderFallback('Location')}

            {mode !== 'business' && (
              <fieldset className="mt-4 border-t border-[var(--owner-line)] pt-3" disabled={disabled}>
                <legend className="text-sm font-semibold text-[var(--owner-ink)]">Address privacy</legend>
                <p className="mb-2 text-xs text-[var(--owner-muted)]">Your exact address stays saved for bookings and directions either way. This choice applies to your website draft until you publish.</p>
                <div role="radiogroup" aria-label="Address privacy">
                  {ADDRESS_PRIVACY_OPTIONS.map(option => (
                    <label className={`mb-2 flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 ${selectedAddressPrivacy === option.value ? 'border-[var(--owner-accent)] bg-[var(--owner-blush)]' : 'border-[var(--owner-line)]'}`} key={option.value}>
                      <input
                        checked={selectedAddressPrivacy === option.value}
                        className="mt-1 size-5 shrink-0 accent-[var(--owner-accent)]"
                        data-testid={`address-privacy-${option.value}`}
                        name="address-privacy"
                        onChange={() => {
                          setSelectedAddressPrivacy(option.value);
                          onAddressPrivacyChange(option.value);
                        }}
                        type="radio"
                        value={option.value}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-[var(--owner-ink)]">{option.label}</span>
                        <span className="block text-xs text-[var(--owner-muted)]">{option.description}</span>
                        <span className="mt-1 block text-[11px] uppercase tracking-wide text-[var(--owner-line-strong)]">{option.note}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {liveAddressPrivacy !== addressPrivacy && (
                  <p className="text-xs text-amber-800" data-testid="address-privacy-unpublished">
                    {`Your live site still uses “${draftPrivacyLabel}” until you publish.`}
                  </p>
                )}
              </fieldset>
            )}
            {renderSwitches('Location')}
          </>
        </Accordion>

        <Accordion publishes="live" subtitle="Phone, email, Instagram and how clients may reach you" testId="information-contact" title="Contact">
          {editable && contact.values && showEditors
            ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void contact.submit();
                  }}
                >
                  <label className={labelClass}>
                    Business phone
                    <input autoComplete="tel" className={fieldClass} data-testid="information-phone" disabled={disabled} inputMode="tel" onChange={event => contact.update({ phone: event.target.value })} type="tel" value={contact.values.phone} />
                  </label>
                  <label className={labelClass}>
                    Business email
                    <input autoComplete="email" className={fieldClass} data-testid="information-email" disabled={disabled} inputMode="email" onChange={event => contact.update({ email: event.target.value })} type="email" value={contact.values.email} />
                  </label>
                  <label className={labelClass}>
                    {INSTAGRAM_FIELD_LABEL}
                    {/* The helper sits inside the label, so name the field explicitly. */}
                    <input aria-describedby="information-instagram-helper" aria-label={INSTAGRAM_FIELD_LABEL} className={fieldClass} data-testid="information-instagram" disabled={disabled} onChange={event => contact.update({ instagram: event.target.value })} placeholder="yourstudio" type="text" value={contact.values.instagram} />
                    <span className="mt-1 block text-xs font-normal text-[var(--owner-muted)]" data-testid="information-instagram-helper" id="information-instagram-helper">
                      {INSTAGRAM_FIELD_HELPER}
                      {instagramPreview ? ` — clients see ${instagramPreview}` : ''}
                    </span>
                  </label>
                  <fieldset className="space-y-1" disabled={disabled}>
                    <legend className="text-sm font-medium text-[var(--owner-ink)]">How clients may contact you</legend>
                    <label className="flex min-h-11 items-center gap-3 text-sm text-[var(--owner-ink)]">
                      <input checked={contact.values.bookingOnlyContact} className="size-5 accent-[var(--owner-accent)]" data-testid="information-booking-only-contact" onChange={event => contact.update({ bookingOnlyContact: event.target.checked })} type="checkbox" />
                      Only through bookings (never publish my phone)
                    </label>
                    <label className="flex min-h-11 items-center gap-3 text-sm text-[var(--owner-ink)]">
                      <input checked={contact.values.callEnabled} className="size-5 accent-[var(--owner-accent)]" onChange={event => contact.update({ callEnabled: event.target.checked })} type="checkbox" />
                      Clients can call
                    </label>
                    <label className="flex min-h-11 items-center gap-3 text-sm text-[var(--owner-ink)]">
                      <input checked={contact.values.textEnabled} className="size-5 accent-[var(--owner-accent)]" onChange={event => contact.update({ textEnabled: event.target.checked })} type="checkbox" />
                      Clients can text
                    </label>
                    <label className={labelClass}>
                      Text number (leave blank to use the business phone)
                      <input autoComplete="tel" className={fieldClass} disabled={!contact.values.textEnabled} inputMode="tel" onChange={event => contact.update({ textNumber: event.target.value })} type="tel" value={contact.values.textNumber} />
                    </label>
                  </fieldset>
                  <button className={primaryButtonClass} data-testid="information-save-contact" disabled={disabled || contact.status === 'saving' || contact.status === 'idle' || contact.status === 'saved'} type="submit">Save contact</button>
                  <StatusLine error={contact.error} savedText="Contact saved. Bookings use it immediately." status={contact.status} />
                  {renderSwitches('Contact')}
                </form>
              )
            : editable && info
              ? (
                  <>
                    <dl className="grid gap-2 text-sm">
                      <div>
                        <dt className="font-medium text-[var(--owner-muted)]">Phone</dt>
                        <dd>{info.salon.phone || 'Not saved'}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-[var(--owner-muted)]">Email</dt>
                        <dd>{info.salon.email || 'Not saved'}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-[var(--owner-muted)]">Instagram</dt>
                        <dd>{formatInstagramHandle(info.instagramHandle ?? info.instagram) || 'Not saved'}</dd>
                      </div>
                    </dl>
                    <a className="mt-3 inline-flex min-h-11 items-center font-semibold text-[var(--owner-accent)] underline" href={`${workspace}&app=settings&view=business-profile`}>Edit contact details →</a>
                    {renderSwitches('Contact')}
                  </>
                )
              : (
                  <>
                    {renderFallback('Contact')}
                    {renderSwitches('Contact')}
                  </>
                )}
        </Accordion>

        <Accordion publishes="live" subtitle="Weekly public hours and timezone" testId="information-hours" title="Hours">
          {editable && hours.values && showEditors
            ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void hours.submit();
                  }}
                >
                  <p className="text-xs text-[var(--owner-muted)]">These are your public hours and your primary location’s booking hours. They take effect immediately. Individual staff schedules are managed in Staff and are not changed here.</p>
                  <div className="space-y-2">
                    {WEEKDAYS.map((day) => {
                      const value = hours.values!.businessHours[day];
                      const label = `${day[0]!.toUpperCase()}${day.slice(1)}`;
                      return (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center" key={day}>
                          <label className="col-span-2 flex min-h-11 items-center gap-2 text-sm text-[var(--owner-ink)] sm:col-span-1">
                            <input
                              checked={value !== null}
                              className="size-5 accent-[var(--owner-accent)]"
                              data-testid={`information-hours-${day}-open-toggle`}
                              onChange={event => hours.update({ businessHours: { ...hours.values!.businessHours, [day]: event.target.checked ? { open: value?.open || '10:00', close: value?.close || '18:00' } : null } })}
                              type="checkbox"
                            />
                            {label}
                          </label>
                          <input aria-label={`${label} opening time`} className={`${fieldClass} mt-0 min-w-0 sm:w-28`} data-testid={`information-hours-${day}-open`} disabled={value === null} onChange={event => hours.update({ businessHours: { ...hours.values!.businessHours, [day]: { open: event.target.value, close: value?.close ?? '' } } })} type="time" value={value?.open ?? ''} />
                          <input aria-label={`${label} closing time`} className={`${fieldClass} mt-0 min-w-0 sm:w-28`} data-testid={`information-hours-${day}-close`} disabled={value === null} onChange={event => hours.update({ businessHours: { ...hours.values!.businessHours, [day]: { open: value?.open ?? '', close: event.target.value } } })} type="time" value={value?.close ?? ''} />
                        </div>
                      );
                    })}
                  </div>
                  <label className={labelClass}>
                    Salon timezone
                    <select className={fieldClass} data-testid="information-timezone" disabled={disabled} onChange={event => hours.update({ timezone: event.target.value })} value={hours.values.timezone}>
                      {getTimeZoneOptions(hours.values.timezone).map(zone => <option key={zone} value={zone}>{zone}</option>)}
                    </select>
                  </label>
                  <button className={primaryButtonClass} data-testid="information-save-hours" disabled={disabled || hours.status === 'saving' || hours.status === 'idle' || hours.status === 'saved'} type="submit">Save hours</button>
                  <StatusLine error={hours.error} savedText="Hours saved. Bookable times still follow each staff member’s schedule." status={hours.status} />
                  {openDaysWithoutStaff.length > 0 && (
                    <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900" data-testid="information-hours-staff-gap" role="status">
                      {`No staff member works ${formatWeekdayList(openDaysWithoutStaff)} yet — add a shift or clients will see no times. `}
                      <a className="font-semibold underline" href={`${workspace}&app=staff`}>Add a shift in Staff</a>
                    </p>
                  )}
                  {renderSwitches('Hours')}
                </form>
              )
            : editable && info
              ? (
                  <>
                    <div className="space-y-1 text-sm">
                      {WEEKDAYS.map(day => (
                        <p className="flex justify-between gap-4" key={day}>
                          <span className="capitalize text-[var(--owner-muted)]">{day}</span>
                          <span>{info.businessHours?.[day] ? `${info.businessHours[day]!.open}–${info.businessHours[day]!.close}` : 'Closed'}</span>
                        </p>
                      ))}
                      <p className="flex justify-between gap-4 border-t border-[var(--owner-line)] pt-2">
                        <span className="text-[var(--owner-muted)]">Timezone</span>
                        <span>{info.timezone}</span>
                      </p>
                    </div>
                    <a className="mt-3 inline-flex min-h-11 items-center font-semibold text-[var(--owner-accent)] underline" href={`${workspace}&app=settings&view=business-profile`}>Edit business hours →</a>
                    {renderSwitches('Hours')}
                  </>
                )
              : (
                  <>
                    {renderFallback('Hours')}
                    {renderSwitches('Hours')}
                  </>
                )}
        </Accordion>

        {showSwitches && (
          <Accordion subtitle="Policies and reviews on Quick Book" testId="information-other" title="Other public content">
            {renderSwitches('Other public content')}
          </Accordion>
        )}
      </div>
      <p className="mt-3 text-xs text-[var(--owner-muted)]">
        <a className="inline-flex min-h-11 items-center gap-1 font-semibold text-[var(--owner-accent)] underline" href={mode === 'business' ? `${workspace}&app=team` : `${workspace}&app=settings${mode === 'booking' ? '&view=business' : ''}`}>
          {mode === 'business' ? 'Manage team profiles' : 'Open all business settings'}
          <ExternalLink aria-hidden="true" size={14} />
        </a>
      </p>
    </section>
  );
}
