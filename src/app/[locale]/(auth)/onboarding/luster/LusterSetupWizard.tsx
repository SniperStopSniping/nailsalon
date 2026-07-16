'use client';

import { useUser } from '@clerk/nextjs';
import { Check, ExternalLink, MailCheck, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type DayName = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
type ServiceDraft = { id: string; name: string; price: string; duration: string; category: 'manicure' | 'builder_gel' | 'extensions' | 'pedicure' | 'combo' };
const DAYS: DayName[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const defaultHours = Object.fromEntries(DAYS.map(day => [day, ['saturday', 'sunday'].includes(day) ? null : { open: '09:00', close: '17:00' }])) as Record<DayName, { open: string; close: string } | null>;

export function LusterSetupWizard({ inviteToken }: { inviteToken: string; locale: string }) {
  const { isLoaded: clerkLoaded, user } = useUser();
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
  const [result, setResult] = useState<{
    publicUrl: string;
    bookingUrl: string;
    dashboardUrl: string;
  } | null>(null);
  const [inviteIntent, setInviteIntent] = useState<'create_salon' | 'claim_existing'>('create_salon');
  const [loadingInvite, setLoadingInvite] = useState(Boolean(inviteToken));
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationCodeSent, setVerificationCodeSent] = useState(false);
  const [verificationBusy, setVerificationBusy] = useState<'send' | 'verify' | 'refresh' | null>(null);
  const [verificationMessage, setVerificationMessage] = useState('');

  const primaryEmail = user?.primaryEmailAddress;
  const emailVerified = primaryEmail?.verification.status === 'verified';

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

  useEffect(() => {
    if (!user) {
      return;
    }
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void user.reload();
      }
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [user]);

  const suggestedSlug = useMemo(() => salonName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 47), [salonName]);
  const shownSlug = slug || suggestedSlug;

  function addService() {
    setServices(items => [...items, { id: crypto.randomUUID(), name: '', price: '', duration: '60', category: 'manicure' }]);
  }

  function clerkErrorMessage(cause: unknown, fallback: string) {
    if (cause && typeof cause === 'object' && 'errors' in cause) {
      const errors = (cause as { errors?: Array<{ longMessage?: string; message?: string }> }).errors;
      return errors?.[0]?.longMessage || errors?.[0]?.message || fallback;
    }
    return cause instanceof Error ? cause.message : fallback;
  }

  async function sendVerificationCode() {
    if (!primaryEmail) {
      setVerificationMessage('Your account email could not be loaded. Refresh the page and try again.');
      return;
    }
    setVerificationBusy('send');
    setVerificationMessage('');
    try {
      await primaryEmail.prepareVerification({ strategy: 'email_code' });
      setVerificationCodeSent(true);
      setVerificationMessage(`A verification code was sent to ${primaryEmail.emailAddress}.`);
    } catch (cause) {
      setVerificationMessage(clerkErrorMessage(cause, 'The verification code could not be sent. Please try again.'));
    } finally {
      setVerificationBusy(null);
    }
  }

  async function verifyEmailCode() {
    if (!primaryEmail || verificationCode.trim().length < 6) {
      setVerificationMessage('Enter the verification code from your email.');
      return;
    }
    setVerificationBusy('verify');
    setVerificationMessage('');
    try {
      const updatedEmail = await primaryEmail.attemptVerification({ code: verificationCode.trim() });
      await user?.reload();
      if (updatedEmail.verification.status !== 'verified') {
        throw new Error('That code was not accepted. Request a new code and try again.');
      }
      setVerificationCode('');
      setVerificationMessage('Email verified. You can publish your booking page now.');
    } catch (cause) {
      setVerificationMessage(clerkErrorMessage(cause, 'That code is incorrect or expired. Request a new code and try again.'));
    } finally {
      setVerificationBusy(null);
    }
  }

  async function refreshEmailVerification() {
    if (!user) {
      return;
    }
    setVerificationBusy('refresh');
    setVerificationMessage('');
    try {
      await user.reload();
      setVerificationMessage(
        user.primaryEmailAddress?.verification.status === 'verified'
          ? 'Email verified. You can publish your booking page now.'
          : 'Your email is still waiting for verification. Send a new code below.',
      );
    } catch {
      setVerificationMessage('Verification status could not be refreshed. Please try again.');
    } finally {
      setVerificationBusy(null);
    }
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
            <a className="inline-flex items-center justify-center gap-2 rounded-full bg-stone-900 px-5 py-3 text-sm font-medium text-white" href={result.dashboardUrl}>
              Open owner dashboard
            </a>
            <a className="inline-flex items-center justify-center gap-2 rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-800" href={result.bookingUrl} target="_blank" rel="noreferrer">
              View booking page
              <ExternalLink size={16} />
            </a>
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
                  <label className="text-xs font-medium text-stone-600">
                    Service name
                    <input aria-label="Service name" placeholder="Builder Gel Overlay" className={inputClass} value={service.name} onChange={event => setServices(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
                  </label>
                  <label className="text-xs font-medium text-stone-600">
                    Price (CAD $)
                    <input aria-label="Price (CAD dollars)" type="number" min="0" step="0.01" placeholder="65" inputMode="decimal" className={inputClass} value={service.price} onChange={event => setServices(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, price: event.target.value } : item))} />
                  </label>
                  <label className="text-xs font-medium text-stone-600">
                    Duration (minutes)
                    <input aria-label="Duration (minutes)" type="number" min="15" max="480" step="5" placeholder="90" inputMode="numeric" className={inputClass} value={service.duration} onChange={event => setServices(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, duration: event.target.value } : item))} />
                  </label>
                  <label className="text-xs font-medium text-stone-600">
                    Category
                    <select aria-label="Category" className={inputClass} value={service.category} onChange={event => setServices(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value as ServiceDraft['category'] } : item))}>
                      <option value="builder_gel">Builder gel</option>
                      <option value="manicure">Manicure</option>
                      <option value="extensions">Extensions</option>
                      <option value="pedicure">Pedicure</option>
                      <option value="combo">Combo</option>
                    </select>
                  </label>
                  <button type="button" aria-label="Remove service" disabled={services.length === 1} onClick={() => setServices(items => items.filter((_, itemIndex) => itemIndex !== index))} className="mt-1 self-center rounded-full p-2 text-stone-500 disabled:opacity-30"><Trash2 size={18} /></button>
                </div>
              ))}
            </div>
          </section>
        </div>
        {clerkLoaded && !emailVerified && (
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
            <div className="flex items-start gap-3">
              <MailCheck className="mt-0.5 size-5 shrink-0 text-amber-700" />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">Verify your owner email</h2>
                <p className="mt-1 text-sm text-amber-900">
                  Verify
                  {' '}
                  {primaryEmail?.emailAddress || 'your invited email'}
                  {' '}
                  before publishing. You can use a code here even if the link in your email did not finish verification.
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                  {verificationCodeSent && (
                    <label className="min-w-0 flex-1 text-xs font-medium text-amber-900">
                      Verification code
                      <input aria-label="Email verification code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} className="mt-1 w-full rounded-xl border border-amber-300 bg-white px-3 py-2.5 text-sm text-stone-900" value={verificationCode} onChange={event => setVerificationCode(event.target.value.replace(/\s/g, ''))} />
                    </label>
                  )}
                  <button type="button" disabled={verificationBusy !== null} onClick={verificationCodeSent ? verifyEmailCode : sendVerificationCode} className="rounded-full bg-amber-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                    {verificationBusy === 'send' ? 'Sending…' : verificationBusy === 'verify' ? 'Checking code…' : verificationCodeSent ? 'Verify code' : 'Send verification code'}
                  </button>
                  <button type="button" disabled={verificationBusy !== null} onClick={refreshEmailVerification} className="inline-flex items-center justify-center gap-2 rounded-full border border-amber-400 px-5 py-2.5 text-sm font-semibold disabled:opacity-50">
                    <RefreshCw className={`size-4 ${verificationBusy === 'refresh' ? 'animate-spin' : ''}`} />
                    I already verified
                  </button>
                </div>
                {verificationCodeSent && <button type="button" disabled={verificationBusy !== null} onClick={sendVerificationCode} className="mt-3 text-xs font-semibold underline">Send a new code</button>}
                {verificationMessage && <p className="mt-3 text-sm" role="status">{verificationMessage}</p>}
              </div>
            </div>
          </section>
        )}
        {emailVerified && (
          <div className="mt-6 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
            <Check className="size-4" />
            Owner email verified
          </div>
        )}
        {error && <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
        <div className="mt-8 flex justify-end"><button type="button" disabled={submitting || loadingInvite || !inviteToken || !clerkLoaded || !emailVerified} onClick={submit} className="rounded-full bg-rose-700 px-7 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-50">{submitting ? 'Creating your salon…' : inviteIntent === 'claim_existing' ? 'Finish and publish my salon' : 'Publish my free booking page'}</button></div>
      </div>
    </main>
  );
}
