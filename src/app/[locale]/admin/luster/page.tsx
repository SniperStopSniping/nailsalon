'use client';

import { ArrowLeft, BookOpen, CalendarDays, ExternalLink, MessageSquareText, ShoppingBag, Sparkles } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

type Health = { availability: { google: boolean; twilio: boolean; email: boolean; photos: boolean }; google: { status: string; email?: string; lastError?: string; inboundSyncEnabled?: boolean; inboundSyncedAt?: string | null; inboundSyncError?: string | null }; twilio: { status: string; phoneNumber?: string; lastError?: string; latestDeliveryError?: { errorCode?: string; errorMessage?: string; createdAt: string } | null } };
type CalendarOption = { id: string; summary: string; primary: boolean; accessRole: string };
const RESOURCES = [
  { id: 'builder-gel-foundations', title: 'Builder Gel Foundations', description: 'Prep, structure, apex placement, and removal fundamentals.', url: process.env.NEXT_PUBLIC_LUSTER_BUILDER_GEL_EDUCATION_URL || 'https://luster.com/pages/builder-gel-education', icon: BookOpen },
  { id: 'technique-guides', title: 'Technique Guides', description: 'Practical service guides designed for working nail techs.', url: process.env.NEXT_PUBLIC_LUSTER_TECHNIQUE_GUIDES_URL || 'https://luster.com/pages/education', icon: Sparkles },
  { id: 'wholesale-builder-gel', title: 'Shop Builder Gel', description: 'See Luster professional products and wholesale offers.', url: process.env.NEXT_PUBLIC_LUSTER_BUILDER_GEL_SHOP_URL || 'https://luster.com/collections/builder-gel', icon: ShoppingBag },
];

export default function LusterOwnerPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = String(params?.locale || 'en');
  const [salonSlug, setSalonSlug] = useState(searchParams.get('salon') || '');
  const [health, setHealth] = useState<Health | null>(null);
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [destinationCalendarId, setDestinationCalendarId] = useState('primary');
  const [busyCalendarIds, setBusyCalendarIds] = useState<string[]>(['primary']);
  const [calendarDirty, setCalendarDirty] = useState(false);
  const [areaCode, setAreaCode] = useState('416');
  const [twilioPreview, setTwilioPreview] = useState<{ number: { phone_number: string }; monthlyPrice: string | null; currency: string } | null>(null);
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState(() => {
    const googleResult = searchParams.get('google');
    if (googleResult === 'connected') {
      return 'Google Calendar connected. Choose which calendars Luster should use.';
    }
    if (googleResult === 'not_configured') {
      return 'Google Calendar setup is temporarily unavailable. Luster support has been notified; your bookings still work normally.';
    }
    if (googleResult === 'error') {
      return 'Google could not finish connecting. Return here and try again.';
    }
    if (googleResult === 'expired') {
      return 'That Google connection link expired for your security. Start a fresh connection below.';
    }
    return '';
  });
  const [marketingConsent, setMarketingConsent] = useState(false);

  useEffect(() => {
    async function bootstrap() {
      let slug = salonSlug;
      if (!slug) {
        const me = await fetch('/api/admin/auth/me', { cache: 'no-store' }).then(response => response.json());
        slug = me.user?.salons?.[0]?.slug || '';
        setSalonSlug(slug);
      }
      if (!slug) {
        return;
      }
      const [healthPayload, consentPayload] = await Promise.all([
        fetch(`/api/integrations/health?salonSlug=${encodeURIComponent(slug)}`, { cache: 'no-store' }).then(response => response.json()),
        fetch(`/api/admin/luster/marketing-consent?salonSlug=${encodeURIComponent(slug)}`, { cache: 'no-store' }).then(response => response.json()),
      ]);
      setHealth(healthPayload.data || null);
      setMarketingConsent(consentPayload.data?.consented === true);
      if (healthPayload.data?.google?.status === 'active') {
        const payload = await fetch(`/api/integrations/google/calendars?salonSlug=${encodeURIComponent(slug)}`).then(response => response.json());
        setCalendars(payload.data?.calendars || []);
        setDestinationCalendarId(payload.data?.selection?.destinationCalendarId || 'primary');
        setBusyCalendarIds(payload.data?.selection?.busyCalendarIds || ['primary']);
        setCalendarDirty(false);
      }
    }
    void bootstrap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveCalendars() {
    setWorking('calendar');
    const response = await fetch('/api/integrations/google/calendars', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ salonSlug, destinationCalendarId, busyCalendarIds }) });
    const payload = await response.json().catch(() => null);
    if (response.ok) {
      setDestinationCalendarId(payload.data?.selection?.destinationCalendarId || destinationCalendarId);
      setBusyCalendarIds(payload.data?.selection?.busyCalendarIds || busyCalendarIds);
      setCalendarDirty(false);
      setMessage('Calendars saved. Busy Google events now prevent double-booking.');
    } else {
      setMessage(payload?.error || 'Calendar choices could not be saved. Reconnect Google Calendar and try again.');
    }
    setWorking('');
  }
  async function previewTwilio() {
    setWorking('twilio-preview');
    const response = await fetch(`/api/integrations/twilio/provision?salonSlug=${encodeURIComponent(salonSlug)}&areaCode=${encodeURIComponent(areaCode)}`);
    const payload = await response.json();
    if (response.ok) {
      setTwilioPreview(payload.data);
    } else {
      setMessage(payload.error || 'No number is available.');
    }
    setWorking('');
  }
  async function provisionTwilio() {
    setWorking('twilio-provision');
    const response = await fetch('/api/integrations/twilio/provision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ salonSlug, areaCode, confirmedMonthlyPrice: twilioPreview?.monthlyPrice || null }) });
    const payload = await response.json();
    setMessage(response.ok ? `Text reminders are active from ${payload.data.phoneNumber}.` : payload.error || 'Twilio setup failed.');
    if (response.ok) {
      setHealth(current => current ? { ...current, twilio: { status: 'active', phoneNumber: payload.data.phoneNumber } } : current);
    }
    setWorking('');
  }
  async function trackResource(resourceId: string, url: string) {
    navigator.sendBeacon?.('/api/admin/luster/resource-click', new Blob([JSON.stringify({ salonSlug, resourceId, url })], { type: 'application/json' }));
  }
  async function updateMarketingConsent(consented: boolean) {
    setMarketingConsent(consented);
    await fetch('/api/admin/luster/marketing-consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ salonSlug, consented }) });
  }

  const card = 'rounded-3xl border border-stone-200 bg-white p-6 shadow-sm';
  return (
    <main className="min-h-screen bg-[#F8F3F0] px-4 py-8 text-stone-900">
      <div className="mx-auto max-w-5xl">
        <button type="button" onClick={() => router.push(`/${locale}/admin${salonSlug ? `?salon=${encodeURIComponent(salonSlug)}` : ''}`)} className="inline-flex items-center gap-2 text-sm text-stone-600">
          <ArrowLeft size={16} />
          {' '}
          Dashboard
        </button>
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Luster for nail techs</p>
          <h1 className="mt-2 text-3xl font-semibold">Booking tools and Builder Gel resources</h1>
          <p className="mt-2 text-stone-600">Your booking app stays free. Google is optional; Twilio bills your connected account directly.</p>
        </div>
        {message && <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-950" role="status">{message}</div>}
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section className={card}>
            <div className="flex items-start justify-between">
              <div>
                <CalendarDays className="text-rose-700" />
                <h2 className="mt-3 text-xl font-semibold">Google Calendar</h2>
                <p className="mt-1 text-sm text-stone-600">Busy events block availability. Luster appointments sync both ways when their Google event is moved, resized, or deleted.</p>
              </div>
              <span className="rounded-full bg-stone-100 px-3 py-1 text-xs capitalize">{health?.google.status || 'loading'}</span>
            </div>
            {health?.availability.google === false
              ? (
                  <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    Google Calendar is temporarily unavailable. Your Luster booking page and email confirmations still work normally.
                  </div>
                )
              : health?.google.status === 'active'
                ? (
                    <div className="mt-5 space-y-4">
                      <label className="block text-sm">
                        Appointment calendar
                        <select
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
                          value={destinationCalendarId}
                          onChange={(event) => {
                            setDestinationCalendarId(event.target.value);
                            setCalendarDirty(true);
                          }}
                        >
                          {calendars.filter(calendar => ['owner', 'writer'].includes(calendar.accessRole)).map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}
                        </select>
                      </label>
                      <fieldset>
                        <legend className="text-sm font-medium">Calendars that prevent double-booking</legend>
                        <div className="mt-2 space-y-2">
                          {calendars.map(calendar => (
                            <label key={calendar.id} className="flex gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={busyCalendarIds.includes(calendar.id)}
                                onChange={(event) => {
                                  setBusyCalendarIds(current => event.target.checked ? [...new Set([...current, calendar.id])] : current.filter(id => id !== calendar.id));
                                  setCalendarDirty(true);
                                }}
                              />
                              {calendar.summary}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <button type="button" disabled={working === 'calendar' || !busyCalendarIds.length || !calendarDirty} onClick={saveCalendars} className="rounded-full bg-rose-800 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{working === 'calendar' ? 'Saving…' : calendarDirty ? 'Save blocking calendars' : 'Calendars saved'}</button>
                      <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-950">
                        <p className="font-semibold">
                          Two-way appointment sync is
                          {' '}
                          {health.google.inboundSyncEnabled === false ? 'off' : 'on'}
                        </p>
                        <p className="mt-1 text-xs">Changes made in Google can take up to five minutes to appear in Luster. New personal Google events are treated as busy time, not client appointments.</p>
                        {health.google.inboundSyncedAt && (
                          <p className="mt-2 text-xs">
                            Last checked:
                            {' '}
                            {new Date(health.google.inboundSyncedAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                : <a className="mt-5 inline-flex rounded-full bg-rose-800 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-rose-900" href={`/api/integrations/google/connect?salonSlug=${encodeURIComponent(salonSlug)}`}>Connect Google Calendar</a>}
            {health?.google.lastError && <p className="mt-3 text-xs text-red-700">{health.google.lastError}</p>}
            {health?.google.inboundSyncError && (
              <p className="mt-3 text-xs text-red-700">
                Two-way sync:
                {health.google.inboundSyncError}
              </p>
            )}
          </section>

          <section className={card}>
            <div className="flex items-start justify-between">
              <div>
                <MessageSquareText className="text-red-600" />
                <h2 className="mt-3 text-xl font-semibold">Twilio text reminders</h2>
                <p className="mt-1 text-sm text-stone-600">A dedicated number in your Twilio subaccount. Bookings still succeed if texting fails.</p>
              </div>
              <span className="rounded-full bg-stone-100 px-3 py-1 text-xs capitalize">{health?.twilio.status || 'loading'}</span>
            </div>
            {health?.availability.twilio === false
              ? (
                  <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
                    Optional text reminders are not available yet. Luster will continue using email for confirmations and booking management.
                  </div>
                )
              : health?.twilio.status === 'active'
                ? (
                    <p className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">
                      Active sender:
                      {health.twilio.phoneNumber}
                    </p>
                  )
                : health?.twilio.status === 'pending' || searchParams.get('twilio') === 'authorized'
                  ? (
                      <div className="mt-5 space-y-3">
                        <label className="block text-sm">
                          Canadian area code
                          <input className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2" maxLength={3} value={areaCode} onChange={event => setAreaCode(event.target.value.replace(/\D/g, ''))} />
                        </label>
                        <button type="button" onClick={previewTwilio} disabled={working !== '' || areaCode.length !== 3} className="rounded-full border border-stone-300 px-5 py-2.5 text-sm font-semibold">Check number and charge</button>
                        {twilioPreview && (
                          <div className="rounded-2xl bg-amber-50 p-4 text-sm">
                            <p>
                              Available:
                              <strong>{twilioPreview.number.phone_number}</strong>
                            </p>
                            <p className="mt-1">
                              Twilio monthly number charge:
                              <strong>{twilioPreview.monthlyPrice ? `${twilioPreview.monthlyPrice} ${twilioPreview.currency}` : 'shown in your Twilio account'}</strong>
                              , plus message usage.
                            </p>
                            <button type="button" onClick={provisionTwilio} className="mt-3 rounded-full bg-red-600 px-5 py-2.5 font-semibold text-white">Confirm and provision</button>
                          </div>
                        )}
                      </div>
                    )
                  : <a className="mt-5 inline-flex rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white" href={`/api/integrations/twilio/connect?salonSlug=${encodeURIComponent(salonSlug)}`}>Authorize Twilio</a>}
            {health?.twilio.lastError && <p className="mt-3 text-xs text-red-700">{health.twilio.lastError}</p>}
            {health?.twilio.latestDeliveryError && (
              <p className="mt-3 text-xs text-red-700">
                Latest delivery error:
                {' '}
                {health.twilio.latestDeliveryError.errorMessage || health.twilio.latestDeliveryError.errorCode || 'Message delivery failed'}
              </p>
            )}
          </section>
        </div>

        <section className="mt-8">
          <h2 className="text-2xl font-semibold">Grow your Builder Gel services</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {RESOURCES.map((resource) => {
              const Icon = resource.icon;

              return (
                <a key={resource.id} href={`${resource.url}?utm_source=luster_booking&utm_medium=owner_dashboard&utm_campaign=free_booking`} target="_blank" rel="noreferrer" onClick={() => void trackResource(resource.id, resource.url)} className={card}>
                  <Icon className="text-rose-700" />
                  <h3 className="mt-4 font-semibold">{resource.title}</h3>
                  <p className="mt-2 text-sm text-stone-600">{resource.description}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-rose-700">
                    Open resource
                    <ExternalLink size={14} />
                  </span>
                </a>
              );
            })}
          </div>
        </section>
        <label className="mt-8 flex items-start gap-3 rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-600">
          <input type="checkbox" checked={marketingConsent} onChange={event => void updateMarketingConsent(event.target.checked)} className="mt-1" />
          <span>Email me Luster education, product updates, and wholesale offers. This owner consent is separate from every customer’s appointment consent.</span>
        </label>
      </div>
    </main>
  );
}
