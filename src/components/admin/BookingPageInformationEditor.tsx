'use client';

/**
 * Your Information (Booking Page hub → focused editor, `panel=information`).
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
 *   - logo picker        → GET  /api/admin/portfolio (existing media library)
 *   - street address     → PATCH /api/admin/location
 *   - address privacy    → booking-page content draft (`locationDisplayMode`), published later
 *   - timezone           → PATCH /api/admin/salon/settings (`bookingConfig.timezone`)
 *
 * Business hours write the salon row and the primary location only; staff
 * schedules stay in the Staff app.
 */

import { ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { BookingPageConfigSide } from '@/libs/bookingPageConfig';
import type { LocationDisplayMode } from '@/libs/bookingPageContent';

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
  instagram: string | null;
  location: { id: string; name: string; address: string | null; city: string | null; state: string | null; zipCode: string | null } | null;
  addressPrivacy: { draft: LocationDisplayMode; live: LocationDisplayMode };
  contactPreferences: { bookingOnlyContact: boolean | null; callEnabled: boolean | null; textEnabled: boolean | null; textNumber: string | null };
  businessHours: BusinessHoursValue | null;
  timezone: string;
};

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

const fieldClass = 'mt-1 w-full min-h-11 rounded-xl border border-stone-300 px-3 py-2 text-base text-stone-900';
const labelClass = 'block text-sm font-medium text-stone-800';
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-rose-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 disabled:opacity-50';

function Accordion({ title, testId, subtitle, defaultOpen = false, children }: {
  title: string;
  testId: string;
  subtitle: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="group py-2" data-testid={testId} open={defaultOpen}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3">
        <span className="min-w-0">
          <span className="block font-semibold">{title}</span>
          <span className="block text-xs text-stone-500">{subtitle}</span>
        </span>
        <span aria-hidden="true" className="text-stone-400 transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  );
}

function StatusLine({ status, error, savedText = 'Saved' }: { status: SectionStatus; error: string | null; savedText?: string }) {
  return (
    <p aria-live="polite" className="mt-2 min-h-5 text-xs text-stone-600" role="status">
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
}) {
  const [info, setInfo] = useState<SalonInformation | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [logoPicker, setLogoPicker] = useState<{ open: boolean; photos: Array<{ id: string; imageUrl: string; altText: string | null }>; loading: boolean; error: string | null }>({ open: false, photos: [], loading: false, error: null });
  const [mediaStatus, setMediaStatus] = useState<{ status: SectionStatus; error: string | null }>({ status: 'idle', error: null });
  // Optimistic selection: the radio reflects the tap at once while the draft
  // save is in flight, then follows the canonical draft value when it lands.
  const [selectedAddressPrivacy, setSelectedAddressPrivacy] = useState<LocationDisplayMode>(addressPrivacy);
  useEffect(() => {
    setSelectedAddressPrivacy(addressPrivacy);
  }, [addressPrivacy]);
  const query = `salonSlug=${encodeURIComponent(salonSlug)}`;
  const workspace = `/${locale}/admin?salon=${encodeURIComponent(salonSlug)}`;
  const showSwitches = draft.layout === 'quick_book';

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
      instagram: info.instagram ?? '',
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
      setLogoPicker({ open: true, photos: [], loading: false, error: pickerError instanceof Error ? pickerError.message : 'Could not load your portfolio.' });
    }
  };

  const saveLogo = async (logoUrl: string | null) => {
    setMediaStatus({ status: 'saving', error: null });
    try {
      await patchInformation({ logoUrl });
      setLogoPicker(current => ({ ...current, open: false }));
      setMediaStatus({ status: 'saved', error: null });
    } catch (saveError) {
      setMediaStatus({ status: 'error', error: saveError instanceof Error ? saveError.message : 'Could not save the logo.' });
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
      <fieldset className="mt-4 divide-y divide-stone-100 border-t border-stone-200" disabled={disabled}>
        <legend className="pt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">Public visibility on Quick Book</legend>
        {QUICK_BOOK_VISIBILITY_OPTIONS.filter(option => group.keys.includes(option.key)).map(option => (
          <QuickBookVisibilitySwitch checked={draft.quickBookProfile[option.key]} key={option.key} onConfigPatch={onConfigPatch} option={option} />
        ))}
      </fieldset>
    );
  };

  const renderFallback = (groupTitle: string) => (
    <>
      {[...new Set(savedDetails?.[groupTitle] ?? [])].map(detail => <p className="mb-2 break-words text-sm text-stone-700" key={detail}>{detail}</p>)}
      {loadState === 'forbidden' && <p className="text-sm text-stone-600">Only the salon owner can change these details.</p>}
      {loadState === 'error' && <p className="text-sm text-red-700">Current details could not be loaded. Reload to try again.</p>}
      {loadState === 'loading' && <p className="text-sm text-stone-500">Loading current details…</p>}
    </>
  );

  const editable = loadState === 'ready' && info !== null;
  const draftPrivacyLabel = ADDRESS_PRIVACY_OPTIONS.find(option => option.value === liveAddressPrivacy)?.label;

  return (
    <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm" data-testid="booking-page-information-editor">
      <h2 className="text-lg font-semibold text-stone-950">Your Information</h2>
      <p className="mt-1 text-sm text-stone-500">
        These are the details you saved during setup. Editing changes the same business record your live site and bookings use; hiding a detail keeps it saved.
      </p>

      <div className="mt-4 divide-y divide-stone-200">
        <Accordion defaultOpen subtitle="Name, website address, nail tech, logo and photo" testId="information-identity" title="Business identity">
          {editable && identity.values
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
                    <p className="mt-1 break-all text-sm text-stone-700" data-testid="information-public-url">{info.salon.publicUrl}</p>
                    <p className="text-xs text-stone-500">
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
                          <span className="mt-1 block text-xs font-normal text-stone-500">This is your public Staff profile, not your private account name.</span>
                        </label>
                      )
                    : (
                        <p className="text-sm text-stone-600">
                          {info.technicianCount > 1 ? `Your team has ${info.technicianCount} nail techs. ` : 'No active nail tech yet. '}
                          <a className="font-semibold text-rose-800 underline" href={`${workspace}&app=staff`}>Manage names and photos in Staff</a>
                        </p>
                      )}
                  <div className="flex flex-wrap items-center gap-3">
                    <button className={primaryButtonClass} data-testid="information-save-identity" disabled={disabled || identity.status === 'saving' || identity.status === 'idle' || identity.status === 'saved'} type="submit">Save identity</button>
                  </div>
                  <StatusLine error={identity.error} status={identity.status} />

                  <div className="grid gap-4 border-t border-stone-200 pt-4 sm:grid-cols-2">
                    <div>
                      <span className={labelClass}>Business logo</span>
                      {info.salon.logoUrl
                        ? <img alt="Current business logo" className="mt-2 size-20 rounded-xl border border-stone-200 object-contain" src={info.salon.logoUrl} />
                        : <p className="mt-1 text-sm text-stone-500">No logo saved.</p>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button className={secondaryButtonClass} disabled={disabled} onClick={() => void openLogoPicker()} type="button">Choose from Portfolio</button>
                        {info.salon.logoUrl && <button className={secondaryButtonClass} disabled={disabled} onClick={() => void saveLogo(null)} type="button">Remove logo</button>}
                      </div>
                      <p className="mt-1 text-xs text-stone-500">Upload new images in Photos &amp; Gallery, then pick one here. The logo is never swapped with the nail tech photo.</p>
                      {logoPicker.open && (
                        <div className="mt-2 rounded-xl border border-stone-200 p-2" role="group" aria-label="Choose a logo from your portfolio">
                          {logoPicker.loading && <p className="text-sm text-stone-500">Loading portfolio…</p>}
                          {logoPicker.error && <p className="text-sm text-red-700">{logoPicker.error}</p>}
                          {!logoPicker.loading && !logoPicker.error && logoPicker.photos.length === 0 && <p className="text-sm text-stone-500">Your portfolio has no photos yet.</p>}
                          <div className="grid grid-cols-3 gap-2">
                            {logoPicker.photos.map(photo => (
                              <button className="aspect-square min-h-11 overflow-hidden rounded-lg border border-stone-200" key={photo.id} onClick={() => void saveLogo(photo.imageUrl)} type="button">
                                <img alt={photo.altText ?? 'Portfolio photo'} className="size-full object-cover" src={photo.imageUrl} />
                              </button>
                            ))}
                          </div>
                          <button className={`${secondaryButtonClass} mt-2`} onClick={() => setLogoPicker(current => ({ ...current, open: false }))} type="button">Close</button>
                        </div>
                      )}
                    </div>
                    <div>
                      <span className={labelClass}>Nail tech photo</span>
                      {info.technician?.avatarUrl
                        ? <img alt="Current nail tech" className="mt-2 size-20 rounded-full border border-stone-200 object-cover" src={info.technician.avatarUrl} />
                        : <p className="mt-1 text-sm text-stone-500">{info.technician ? 'No photo saved.' : 'Managed per nail tech in Staff.'}</p>}
                      {info.technician && (
                        <label className={`${secondaryButtonClass} mt-2 cursor-pointer`}>
                          Upload photo
                          <input accept="image/jpeg,image/png,image/webp" className="sr-only" data-testid="information-tech-photo" disabled={disabled} onChange={event => void uploadProfilePhoto(event.target.files?.[0] ?? null)} type="file" />
                        </label>
                      )}
                      <p className="mt-1 text-xs text-stone-500">Uses the same Staff photo upload. It is never used as the logo.</p>
                    </div>
                  </div>
                  <StatusLine error={mediaStatus.error} savedText="Image saved" status={mediaStatus.status} />
                  {renderSwitches('Business identity')}
                </form>
              )
            : (
                <>
                  {renderFallback('Business identity')}
                  {renderSwitches('Business identity')}
                </>
              )}
        </Accordion>

        <Accordion subtitle="Address, city and how much of it clients can see" testId="information-location" title="Location">
          <>
            {editable && location.values
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
                      <a className="text-sm font-semibold text-rose-800 underline" href={`${workspace}&app=settings&view=location`}>Parking &amp; arrival instructions</a>
                    </div>
                    <StatusLine error={location.error} savedText="Address saved. It affects directions and bookings immediately." status={location.status} />
                  </form>
                )
              : renderFallback('Location')}

            <fieldset className="mt-4 border-t border-stone-200 pt-3" disabled={disabled}>
              <legend className="text-sm font-semibold text-stone-900">Address privacy</legend>
              <p className="mb-2 text-xs text-stone-500">Your exact address stays saved for bookings and directions either way. This choice applies to your website draft until you publish.</p>
              <div role="radiogroup" aria-label="Address privacy">
                {ADDRESS_PRIVACY_OPTIONS.map(option => (
                  <label className={`mb-2 flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 ${selectedAddressPrivacy === option.value ? 'border-rose-800 bg-rose-50' : 'border-stone-200'}`} key={option.value}>
                    <input
                      checked={selectedAddressPrivacy === option.value}
                      className="mt-1 size-5 shrink-0 accent-rose-700"
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
                      <span className="block text-sm font-semibold text-stone-900">{option.label}</span>
                      <span className="block text-xs text-stone-600">{option.description}</span>
                      <span className="mt-1 block text-[11px] uppercase tracking-wide text-stone-400">{option.note}</span>
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
            {renderSwitches('Location')}
          </>
        </Accordion>

        <Accordion subtitle="Phone, email, Instagram and how clients may reach you" testId="information-contact" title="Contact">
          {editable && contact.values
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
                    Instagram username
                    <input className={fieldClass} data-testid="information-instagram" disabled={disabled} onChange={event => contact.update({ instagram: event.target.value })} placeholder="yourstudio" type="text" value={contact.values.instagram} />
                  </label>
                  <fieldset className="space-y-1" disabled={disabled}>
                    <legend className="text-sm font-medium text-stone-800">How clients may contact you</legend>
                    <label className="flex min-h-11 items-center gap-3 text-sm text-stone-800">
                      <input checked={contact.values.bookingOnlyContact} className="size-5 accent-rose-700" data-testid="information-booking-only-contact" onChange={event => contact.update({ bookingOnlyContact: event.target.checked })} type="checkbox" />
                      Only through bookings (never publish my phone)
                    </label>
                    <label className="flex min-h-11 items-center gap-3 text-sm text-stone-800">
                      <input checked={contact.values.callEnabled} className="size-5 accent-rose-700" onChange={event => contact.update({ callEnabled: event.target.checked })} type="checkbox" />
                      Clients can call
                    </label>
                    <label className="flex min-h-11 items-center gap-3 text-sm text-stone-800">
                      <input checked={contact.values.textEnabled} className="size-5 accent-rose-700" onChange={event => contact.update({ textEnabled: event.target.checked })} type="checkbox" />
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
            : (
                <>
                  {renderFallback('Contact')}
                  {renderSwitches('Contact')}
                </>
              )}
        </Accordion>

        <Accordion subtitle="Weekly public hours and timezone" testId="information-hours" title="Hours">
          {editable && hours.values
            ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void hours.submit();
                  }}
                >
                  <p className="text-xs text-stone-500">These are your public hours and your primary location’s booking hours. They take effect immediately. Individual staff schedules are managed in Staff and are not changed here.</p>
                  <div className="space-y-2">
                    {WEEKDAYS.map((day) => {
                      const value = hours.values!.businessHours[day];
                      const label = `${day[0]!.toUpperCase()}${day.slice(1)}`;
                      return (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center" key={day}>
                          <label className="col-span-2 flex min-h-11 items-center gap-2 text-sm text-stone-800 sm:col-span-1">
                            <input
                              checked={value !== null}
                              className="size-5 accent-rose-700"
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
                  <StatusLine error={hours.error} savedText="Hours saved. Booking availability uses them immediately." status={hours.status} />
                  {renderSwitches('Hours')}
                </form>
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
      <p className="mt-3 text-xs text-stone-500">
        <a className="inline-flex min-h-11 items-center gap-1 font-semibold text-rose-800 underline" href={`${workspace}&app=settings`}>
          Open all business settings
          <ExternalLink aria-hidden="true" size={14} />
        </a>
      </p>
    </section>
  );
}
