'use client';

import { Check, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type DayName = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
type ServiceDraft = { id: string; name: string; price: string; duration: string; category: 'manicure' | 'builder_gel' | 'extensions' | 'pedicure' | 'combo' };
const DAYS: DayName[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const defaultHours = Object.fromEntries(DAYS.map(day => [day, ['saturday', 'sunday'].includes(day) ? null : { open: '09:00', close: '17:00' }])) as Record<DayName, { open: string; close: string } | null>;

export function LusterSetupWizard({ inviteToken, locale }: { inviteToken: string; locale: string }) {
  const [salonName, setSalonName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [slug, setSlug] = useState('');
  const [timezone, setTimezone] = useState('America/Toronto');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('Ontario');
  const [postalCode, setPostalCode] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [hours, setHours] = useState(defaultHours);
  const [services, setServices] = useState<ServiceDraft[]>([
    { id: 'starter-builder-gel', name: 'Builder Gel Overlay', price: '65', duration: '90', category: 'builder_gel' },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ publicUrl: string } | null>(null);
  const [inviteIntent, setInviteIntent] = useState<'create_salon' | 'claim_existing'>('create_salon');
  const [loadingInvite, setLoadingInvite] = useState(Boolean(inviteToken));

  useEffect(() => {
    if (!inviteToken) {
      setLoadingInvite(false);
      return;
    }
    let cancelled = false;
    void fetch(`/api/onboarding/invitations/${encodeURIComponent(inviteToken)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error?.message ?? 'This invitation is no longer available.');
        }
        if (cancelled) {
          return;
        }
        setInviteIntent(payload.data.intent);
        if (payload.data.intent === 'claim_existing') {
          setSalonName(payload.data.salonName ?? '');
          setSlug(payload.data.salonSlug ?? '');
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'This invitation is no longer available.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingInvite(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  const suggestedSlug = useMemo(() => salonName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 47), [salonName]);
  const shownSlug = slug || suggestedSlug;

  function addService() {
    setServices(items => [...items, { id: crypto.randomUUID(), name: '', price: '', duration: '60', category: 'manicure' }]);
  }

  async function submit() {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/onboarding/luster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inviteToken,
          salonName,
          ownerName,
          ownerPhone,
          slug: shownSlug,
          timezone,
          address,
          city,
          province,
          postalCode,
          logoUrl,
          businessHours: hours,
          services: services.map(service => ({
            name: service.name,
            priceCents: Math.round(Number(service.price) * 100),
            durationMinutes: Number(service.duration),
            category: service.category,
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message || 'Setup could not be completed.');
      }
      setResult(payload.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Setup could not be completed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <main className="min-h-screen bg-stone-50 px-4 py-16">
        <div className="mx-auto max-w-xl rounded-[2rem] border border-emerald-200 bg-white p-8 text-center shadow-sm">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check /></span>
          <h1 className="mt-5 text-3xl font-semibold text-stone-900">Your booking page is live</h1>
          <p className="mt-3 text-stone-600">Calendar and text reminders are optional. You can connect them from your owner dashboard.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <a className="inline-flex items-center justify-center gap-2 rounded-full bg-stone-900 px-5 py-3 text-sm font-medium text-white" href={result.publicUrl}>
              View booking page
              <ExternalLink size={16} />
            </a>
            <a className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-800" href={`/${locale}/admin`}>Open owner dashboard</a>
          </div>
        </div>
      </main>
    );
  }

  const inputClass = 'mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100';
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Luster Free Booking</p>
          <h1 className="mt-2 text-3xl font-semibold text-stone-900">
            {inviteIntent === 'claim_existing' ? `Finish setting up ${salonName || 'your salon'}` : 'Set up your salon'}
          </h1>
          <p className="mt-2 text-stone-600">Everything here stays editable except your public link after publishing.</p>
        </div>
        {!inviteToken && <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Open your original invitation link to continue.</div>}
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-stone-900">1. Salon and owner</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-stone-700">
                Salon name
                <input className={inputClass} value={salonName} readOnly={inviteIntent === 'claim_existing'} onChange={event => setSalonName(event.target.value)} />
              </label>
              <label className="text-sm text-stone-700">
                Your name
                <input className={inputClass} value={ownerName} onChange={event => setOwnerName(event.target.value)} />
              </label>
              <label className="text-sm text-stone-700">
                Phone
                <input className={inputClass} inputMode="tel" value={ownerPhone} onChange={event => setOwnerPhone(event.target.value)} />
              </label>
              <label className="text-sm text-stone-700">
                Timezone
                <select className={inputClass} value={timezone} onChange={event => setTimezone(event.target.value)}>
                  <option>America/Toronto</option>
                  <option>America/Vancouver</option>
                  <option>America/Edmonton</option>
                  <option>America/Winnipeg</option>
                  <option>America/Halifax</option>
                </select>
              </label>
            </div>
            <label className="mt-4 block text-sm text-stone-700">
              Your permanent Luster link
              <input className={inputClass} value={shownSlug} readOnly={inviteIntent === 'claim_existing'} onChange={event => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
              <span className="mt-1 block text-xs text-stone-500">
                {inviteIntent === 'claim_existing'
                  ? 'Your existing salon link will be preserved.'
                  : 'Your permanent link will be confirmed after publishing.'}
              </span>
            </label>
            <label className="mt-4 block text-sm text-stone-700">
              Logo URL (optional)
              <input className={inputClass} value={logoUrl} onChange={event => setLogoUrl(event.target.value)} />
            </label>
          </section>

          <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-stone-900">2. Location or service area</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-stone-700 sm:col-span-2">
                Address or service-area note
                <input className={inputClass} value={address} onChange={event => setAddress(event.target.value)} />
              </label>
              <label className="text-sm text-stone-700">
                City
                <input className={inputClass} value={city} onChange={event => setCity(event.target.value)} />
              </label>
              <label className="text-sm text-stone-700">
                Province
                <input className={inputClass} value={province} onChange={event => setProvince(event.target.value)} />
              </label>
              <label className="text-sm text-stone-700">
                Postal code
                <input className={inputClass} value={postalCode} onChange={event => setPostalCode(event.target.value)} />
              </label>
            </div>
          </section>

          <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm lg:col-span-2">
            <h2 className="text-lg font-semibold text-stone-900">3. Weekly booking hours</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {DAYS.map(day => (
                <div key={day} className="rounded-2xl bg-stone-50 p-3">
                  <label className="flex items-center gap-2 text-sm font-medium capitalize text-stone-800">
                    <input type="checkbox" checked={Boolean(hours[day])} onChange={event => setHours(current => ({ ...current, [day]: event.target.checked ? { open: '09:00', close: '17:00' } : null }))} />
                    {day}
                  </label>
                  {hours[day] && (
                    <div className="mt-2 flex gap-2">
                      <input aria-label={`${day} open`} type="time" className="min-w-0 rounded-lg border border-stone-300 px-2 py-1 text-xs" value={hours[day]!.open} onChange={event => setHours(current => ({ ...current, [day]: { ...current[day]!, open: event.target.value } }))} />
                      <input aria-label={`${day} close`} type="time" className="min-w-0 rounded-lg border border-stone-300 px-2 py-1 text-xs" value={hours[day]!.close} onChange={event => setHours(current => ({ ...current, [day]: { ...current[day]!, close: event.target.value } }))} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-stone-900">4. Services and pricing</h2>
                <p className="mt-1 text-sm text-stone-500">The Builder Gel starter is generic and fully editable.</p>
              </div>
              <button type="button" onClick={addService} className="inline-flex items-center gap-1 rounded-full border border-stone-300 px-3 py-2 text-sm">
                <Plus size={15} />
                {' '}
                Add
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {services.map((service, index) => (
                <div key={service.id} className="grid gap-3 rounded-2xl bg-stone-50 p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                  <input aria-label="Service name" placeholder="Service name" className={inputClass} value={service.name} onChange={event => setServices(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
                  <input aria-label="Price" placeholder="Price $" inputMode="decimal" className={inputClass} value={service.price} onChange={event => setServices(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, price: event.target.value } : item))} />
                  <input aria-label="Duration" placeholder="Minutes" inputMode="numeric" className={inputClass} value={service.duration} onChange={event => setServices(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, duration: event.target.value } : item))} />
                  <select aria-label="Category" className={inputClass} value={service.category} onChange={event => setServices(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value as ServiceDraft['category'] } : item))}>
                    <option value="builder_gel">Builder gel</option>
                    <option value="manicure">Manicure</option>
                    <option value="extensions">Extensions</option>
                    <option value="pedicure">Pedicure</option>
                    <option value="combo">Combo</option>
                  </select>
                  <button type="button" aria-label="Remove service" disabled={services.length === 1} onClick={() => setServices(items => items.filter((_, itemIndex) => itemIndex !== index))} className="mt-1 self-center rounded-full p-2 text-stone-500 disabled:opacity-30"><Trash2 size={18} /></button>
                </div>
              ))}
            </div>
          </section>
        </div>
        {error && <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
        <div className="mt-8 flex justify-end"><button type="button" disabled={submitting || loadingInvite || !inviteToken} onClick={submit} className="rounded-full bg-rose-700 px-7 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-50">{submitting ? 'Creating your salon…' : inviteIntent === 'claim_existing' ? 'Finish and publish my salon' : 'Publish my free booking page'}</button></div>
      </div>
    </main>
  );
}
