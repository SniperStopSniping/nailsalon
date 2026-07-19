'use client';

import { useUser } from '@clerk/nextjs';
import { Check, ExternalLink, MailCheck, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { getStarterTemplates } from '@/libs/serviceTemplateCatalog';

type DayName = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
type StarterReviewRow = {
  templateKey: string;
  name: string;
  priceDisplayText: string | null;
  price: string;
  duration: string;
  enabled: boolean;
};
const DAYS: DayName[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function buildStarterReviewRows(): StarterReviewRow[] {
  return getStarterTemplates()
    .filter(template => template.serviceType !== 'addon')
    .map(template => ({
      templateKey: template.systemKey,
      name: template.name,
      priceDisplayText: template.priceDisplayText,
      price: (template.defaultPriceCents / 100).toString(),
      duration: String(template.defaultDurationMinutes),
      enabled: true,
    }));
}

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
  const [starterServices, setStarterServices] = useState<StarterReviewRow[]>(buildStarterReviewRows);
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
          serviceOverrides: starterServices.map(service => ({
            templateKey: service.templateKey,
            priceCents: Math.round(Number(service.price) * 100),
            durationMinutes: Number(service.duration),
            enabled: service.enabled,
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
            <div>
              <h2 className="text-lg font-semibold text-stone-900">4. Your starter menu</h2>
              <p className="mt-1 text-sm text-stone-500">
                We pre-filled the most popular services (plus common add-ons behind the scenes).
                Adjust any price or duration, or turn off anything you don’t offer — everything
                stays editable from your dashboard.
              </p>
            </div>
            <div className="mt-4 space-y-3">
              {starterServices.map((service, index) => (
                <div key={service.templateKey} data-testid={`starter-review-${service.templateKey}`} className={`grid gap-3 rounded-2xl p-3 sm:grid-cols-[2fr_1fr_1fr_auto] ${service.enabled ? 'bg-stone-50' : 'bg-stone-100 opacity-60'}`}>
                  <div className="text-xs font-medium text-stone-600">
                    Service
                    <div className="mt-1 rounded-xl px-1 py-2 text-sm font-semibold text-stone-900">{service.name}</div>
                  </div>
                  <label className="text-xs font-medium text-stone-600">
                    {service.priceDisplayText ? `Price (from, CAD $)` : 'Price (CAD $)'}
                    <input aria-label={`Price for ${service.name}`} type="number" min="0" step="0.01" inputMode="decimal" className={inputClass} value={service.price} disabled={!service.enabled} onChange={event => setStarterServices(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, price: event.target.value } : item))} />
                  </label>
                  <label className="text-xs font-medium text-stone-600">
                    Duration (minutes)
                    <input aria-label={`Duration for ${service.name}`} type="number" min="15" max="480" step="5" inputMode="numeric" className={inputClass} value={service.duration} disabled={!service.enabled} onChange={event => setStarterServices(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, duration: event.target.value } : item))} />
                  </label>
                  <label className="mt-1 flex items-center gap-2 self-center text-xs font-medium text-stone-600">
                    <input aria-label={`Offer ${service.name}`} type="checkbox" className="size-4" checked={service.enabled} onChange={event => setStarterServices(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item))} />
                    Offer
                  </label>
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
