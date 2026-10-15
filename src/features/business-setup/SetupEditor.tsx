'use client';
import './setup.css';

import { useEffect, useState } from 'react';

import { CustomDesignStudio } from '@/features/custom-sites/CustomDesignStudio';

import type { SetupDocument, SetupOperation, SetupReview, SetupService } from './contracts';
import { WEEKDAYS } from './contracts';

type Head = {
  workspace: {
    status: 'editing' | 'published';
  };
  revision: {
    revision: number;
    document: SetupDocument;
  };
};
type Message = {
  id: string;
  message: string;
  reply: string | null;
  status: string;
};
const INTRO = 'Let’s get your business ready for bookings. I’ll help prepare your services, booking setup, and website for your review. What’s your business called, where are you based, and do you work alone or with a team?';
const LABELS: Record<string, string> = {
  'business.name': 'Business name',
  'business.city': 'City or area',
  'business.exactAddress': 'Service address',
  'business.homeBased': 'Home-based business',
  'business.workMode': 'Solo or team',
  'business.locationDisplayMode': 'Public address visibility',
  'services': 'Service menu',
  'website.config.customFrontendId': 'Custom website design version (see the exact preview above)',
  'booking.currency': 'Currency',
  'booking.timezone': 'Time zone',
  'booking.minimumNoticeMinutes': 'Minimum booking notice (minutes)',
  'booking.bufferMinutes': 'Booking buffer (minutes)',
};
function reviewValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return 'Not set';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === 'object' && 'priceCents' in item) {
        const service = item as SetupService;
        return `${service.name}: ${service.priceCents === null ? 'price needed' : (service.priceCents / 100).toFixed(2)}, ${service.durationMinutes ?? '?'} minutes, ${service.preparationBufferMinutes} minutes preparation, ${service.cleanupBufferMinutes} minutes cleanup`;
      }
      return reviewValue(item);
    }).join('; ');
  }
  if (typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => `${key}: ${reviewValue(item)}`).join(', ');
  }
  return String(value).replaceAll('_', ' ');
}
export function SetupEditor({ salonSlug, locale, existingSalon, aiEnabled }: {
  salonSlug: string;
  locale: string;
  existingSalon: boolean;
  aiEnabled: boolean;
}) {
  const [head, setHead] = useState<Head | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [tab, setTab] = useState<'chat' | 'website' | 'setup'>('chat');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState<SetupReview | null>(null);
  const [published, setPublished] = useState(false);
  const [includeBusiness, setIncludeBusiness] = useState(!existingSalon);
  const customFrontendId = head?.revision.document.website.config.customFrontendId;
  useEffect(() => {
    if (customFrontendId) {
      setIncludeBusiness(false);
    }
  }, [customFrontendId]);
  async function call<T>(body: Record<string, unknown>): Promise<T> {
    const response = await fetch('/api/admin/business-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ salonSlug, ...body }) });
    const payload = await response.json().catch(() => null) as {
      data?: T;
      error?: {
        message?: string;
      };
    } | null;
    if (!response.ok || !payload || !('data' in payload)) {
      throw new Error(payload?.error?.message ?? 'We could not save this step. Please try again.');
    }
    return payload.data as T;
  }
  async function refresh() {
    const response = await fetch(`/api/admin/business-setup?salonSlug=${encodeURIComponent(salonSlug)}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Your saved setup could not be loaded. Please refresh.');
    }
    const { data } = await response.json() as {
      data: Head & {
        messages: Message[];
      };
    };
    setHead(data);
    setMessages(data.messages);
    setPublished(data.workspace.status === 'published');
  }
  useEffect(() => {
    let active = true;
    call<Head>({ action: 'open' }).then(async (data) => {
      if (active) {
        setHead(data);
        await refresh();
      }
    }).catch((e) => {
      if (active) {
        setError(e.message);
      }
    });
    return () => {
      active = false;
    };
    // Identity changes mount a fresh editor in its server page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salonSlug]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function edit(operations: SetupOperation[]) {
    if (!head) {
      return;
    }
    const result = await call<Head>({ action: 'edit', edit: { expectedRevision: head.revision.revision, operationId: crypto.randomUUID(), operations } });
    setHead(result);
    setReview(null);
  }
  const draft = head?.revision.document;
  const pending = draft?.services.filter(s => !s.confirmed) ?? [];
  return (
    <main className="luster-setup">
      <header className="setup-heading">
        <a href={`/${locale}/admin/website?salon=${encodeURIComponent(salonSlug)}`}>← Website</a>
        <span className="setup-wordmark">✦ LUSTER</span>
        <h1>{existingSalon ? 'Edit with AI' : 'Let’s build your business.'}</h1>
        <p>Business details → Services & bookings → Design → Review & publish</p>
        <div role="status">{busy ? 'Saving your changes…' : published ? 'Published' : head ? 'Saved as draft · Your live business is unchanged' : 'Loading your saved setup…'}</div>
      </header>
      {error && (
        <div role="alert" className="setup-error">
          {error}
          {' '}
          <button type="button" onClick={() => void run(refresh)}>Reload saved changes</button>
        </div>
      )}
      <nav className="setup-tabs" aria-label="Setup views">
        {(['chat', 'website', 'setup'] as const).map(item => <button key={item} type="button" aria-pressed={tab === item} onClick={() => setTab(item)}>{item === 'chat' ? 'Conversation' : item === 'website' ? 'Website' : 'Business setup'}</button>)}
      </nav>
      <div className="setup-columns" data-tab={tab}>
        <section className="setup-chat" aria-label="Conversation">
          {!aiEnabled && <p role="status">AI is unavailable. You can still edit, review, and publish your saved setup using Business setup.</p>}
          <div className="setup-messages" aria-live="polite">
            <p className="setup-assistant">{existingSalon ? 'I’ve loaded your saved website and business details. What would you like to change? Your live setup stays unchanged while we work.' : INTRO}</p>
            {messages.map(message => (
              <div key={message.id}>
                <p className="setup-owner">{message.message}</p>
                {message.reply && <p className="setup-assistant">{message.reply}</p>}
                {message.status === 'pending' && <p>Preparing your draft…</p>}
                {['failed', 'interrupted'].includes(message.status) && <p>This request did not finish. Your saved changes are safe. You can retry or check for a saved design in Website.</p>}
              </div>
            ))}
          </div>
          {(existingSalon || head?.revision.document.website.config.customFrontendId) && (
            <label className="setup-scope">
              <input type="checkbox" checked={includeBusiness} onChange={e => setIncludeBusiness(e.target.checked)} />
              {' '}
              Also allow changes to services and booking setup
            </label>
          )}
          <form onSubmit={(e) => {
            e.preventDefault();
            if (!head || !text.trim()) {
              return;
            }
            void run(async () => {
              if (head.revision.document.website.config.customFrontendId && !includeBusiness) {
                const response = await fetch(`/api/admin/custom-sites?salonSlug=${encodeURIComponent(salonSlug)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate', input: { expectedRevision: head.revision.revision, operationId: crypto.randomUUID(), message: text, referenceIds: [], startOver: false } }) });
                const result = await response.json();
                if (!response.ok) {
                  throw new Error(result.error ?? 'Your design could not be updated.');
                }
                setHead(result.head);
                setText('');
                setReview(null);
                await refresh();
                return;
              }
              const result = await call<{
                head: Head;
                reply: string;
              }>({ action: 'message', message: { message: text, operationId: crypto.randomUUID(), expectedRevision: head.revision.revision, scope: includeBusiness ? 'business_and_website' : 'website' } });
              setHead(result.head);
              setText('');
              setReview(null);
              await refresh();
            });
          }}
          >
            <label htmlFor="setup-message">Tell Luster what you have in mind</label>
            <textarea id="setup-message" value={text} onChange={e => setText(e.target.value)} maxLength={4000} placeholder="I work alone in Toronto. I offer gel manicures and BIAB…" rows={4} />
            <div className="setup-quick-replies">{['Help me choose prices and times', 'I already have a service menu', 'Cream and black, with a premium feel'].map(reply => <button type="button" key={reply} onClick={() => setText(reply)}>{reply}</button>)}</div>
            <button type="submit" disabled={!aiEnabled || busy || !head || published || !text.trim()}>Send to Luster</button>
          </form>
        </section>
        <section className="setup-preview" aria-label="Website preview">
          <h2>Your website draft</h2>
          <p>Private preview. Booking is disabled here.</p>
          {head && !head.revision.document.website.config.customFrontendId && <iframe title="Your website draft" sandbox="" src={`/${locale}/admin/business-setup/preview/${encodeURIComponent(salonSlug)}?revision=${head.revision.revision}`} />}
          {head && (
            <CustomDesignStudio
              salonSlug={salonSlug}
              revision={head.revision.revision}
              artifactId={head.revision.document.website.config.customFrontendId}
              disabled={published || busy}
              aiEnabled={aiEnabled}
              onSaved={async () => {
                setReview(null);
                await refresh();
              }}
            />
          )}
        </section>
        <section className="setup-details" aria-label="Business setup">
          <h2>Your business setup</h2>
          {draft && (
            <>
              <form
                key={`business-${head.revision.revision}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void run(() => edit([{ type: 'business', values: { name: String(form.get('name')), city: String(form.get('city')), exactAddress: String(form.get('address')), homeBased: form.get('home') === 'on', workMode: String(form.get('workMode')) as 'solo' | 'team' | 'unknown', locationDisplayMode: String(form.get('visibility')) as 'city_only' | 'after_booking' | 'full_address' } }]));
                }}
              >
                <label>
                  Business name
                  <input name="name" defaultValue={draft.business.name} required maxLength={120} />
                </label>
                <label>
                  City or area
                  <input name="city" defaultValue={draft.business.city} maxLength={120} />
                </label>
                <label>
                  Private service address
                  <input name="address" defaultValue={draft.business.exactAddress} maxLength={500} />
                </label>
                <label>
                  <input type="checkbox" name="home" defaultChecked={draft.business.homeBased} />
                  {' '}
                  I work from home
                </label>
                <label>
                  Do you work alone or with a team?
                  <select name="workMode" defaultValue={draft.business.workMode}>
                    <option value="unknown">Choose when you are ready</option>
                    <option value="solo">I work alone</option>
                    <option value="team">I have a team</option>
                  </select>
                </label>
                <label>
                  What customers see
                  <select name="visibility" defaultValue={draft.business.locationDisplayMode}>
                    <option value="city_only">City or area only</option>
                    <option value="after_booking">Exact address after a confirmed booking</option>
                    <option value="full_address">Full address publicly</option>
                  </select>
                </label>
                <button type="submit" disabled={busy || published}>Save business details</button>
              </form>
              <h3>Booking essentials</h3>
              <form
                key={`booking-${head.revision.revision}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void run(() => edit([{ type: 'booking', values: { currency: String(form.get('currency')) as 'CAD' | 'USD', timezone: String(form.get('timezone')), minimumNoticeMinutes: Number(form.get('notice')), bufferMinutes: Number(form.get('buffer')) } }]));
                }}
              >
                <label>
                  Currency
                  <select name="currency" defaultValue={draft.booking.currency}>
                    <option value="CAD">Canadian dollars (CAD)</option>
                    <option value="USD">US dollars (USD)</option>
                  </select>
                </label>
                <label>
                  Time zone
                  <input name="timezone" defaultValue={draft.booking.timezone} required />
                </label>
                <label>
                  Minimum booking notice (minutes)
                  <input name="notice" type="number" min="0" max="525600" defaultValue={draft.booking.minimumNoticeMinutes} required />
                </label>
                <label>
                  Extra booking buffer (minutes)
                  <input name="buffer" type="number" min="0" max="60" defaultValue={draft.booking.bufferMinutes} required />
                </label>
                <button type="submit" disabled={busy || published}>Save booking essentials</button>
              </form>
              <h3>Opening hours</h3>
              <form
                key={`hours-${head.revision.revision}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  const hours = { ...draft.hours };
                  for (const day of WEEKDAYS) {
                    hours[day] = form.get(`${day}-open`) ? { open: String(form.get(`${day}-start`)), close: String(form.get(`${day}-end`)) } : null;
                  }
                  void run(() => edit([{ type: 'hours', values: hours }]));
                }}
              >
                {WEEKDAYS.map(day => (
                  <div className="setup-hour" key={day}>
                    <label>
                      <input name={`${day}-open`} type="checkbox" defaultChecked={Boolean(draft.hours[day])} />
                      {' '}
                      {day}
                    </label>
                    <input aria-label={`${day} opens`} name={`${day}-start`} type="time" defaultValue={draft.hours[day]?.open ?? '09:00'} />
                    <input aria-label={`${day} closes`} name={`${day}-end`} type="time" defaultValue={draft.hours[day]?.close ?? '17:00'} />
                  </div>
                ))}
                <button type="submit" disabled={busy || published}>Save opening hours</button>
              </form>
              <h3>
                Services ·
                {draft.booking.currency}
              </h3>
              {pending.length > 0 && (
                <div className="setup-notice">
                  <p>Suggested prices and appointment times need your review. These are illustrative starting recommendations, not researched local market rates.</p>
                  <button type="button" disabled={busy || published} onClick={() => void run(() => edit([{ type: 'confirm_services', ids: pending.map(s => s.id) }]))}>Accept the displayed prices and times</button>
                </div>
              )}
              {draft.services.map(service => (
                <form
                  key={`${service.id}-${head.revision.revision}`}
                  className="setup-service"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    const { origin: _origin, confirmed: _confirmed, ...values } = service;
                    void run(() => edit([{ type: 'service', values: { ...values, name: String(form.get('name')), priceCents: Math.round(Number(form.get('price')) * 100), durationMinutes: Number(form.get('duration')) } }]));
                  }}
                >
                  <label>
                    Service
                    <input name="name" defaultValue={service.name} required />
                  </label>
                  <div className="setup-service-fields">
                    <label>
                      Price
                      <input name="price" type="number" min="0" step="0.01" defaultValue={service.priceCents === null ? '' : service.priceCents / 100} required />
                    </label>
                    <label>
                      Minutes
                      <input name="duration" type="number" min="5" max="480" defaultValue={service.durationMinutes ?? ''} required />
                    </label>
                  </div>
                  <small>
                    {service.confirmed ? 'Reviewed' : 'Needs your review'}
                    {' '}
                    ·
                    {' '}
                    {service.preparationBufferMinutes}
                    {' '}
                    min preparation ·
                    {' '}
                    {service.cleanupBufferMinutes}
                    {' '}
                    min cleanup
                  </small>
                  <button type="submit" disabled={busy || published}>Save service</button>
                </form>
              ))}
              <button type="button" disabled={busy || published} onClick={() => void run(() => edit([{ type: 'service', values: { id: `draft_${crypto.randomUUID()}`, name: 'New service', description: null, priceCents: null, durationMinutes: null, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, category: 'manicure', bookingCategory: 'manicure' } }]))}>Add a service</button>
              <h3>Design direction</h3>
              <div className="setup-quick-replies">{([{ label: 'Clean and minimal', style: 'minimal', palette: 'monochrome' }, { label: 'Soft and welcoming', style: 'soft', palette: 'blush_cocoa' }, { label: 'Dark and luxurious', style: 'luxury', palette: 'black_champagne' }] as const).map(choice => <button type="button" key={choice.label} disabled={busy || published} onClick={() => void run(() => edit([{ type: 'design', style: choice.style, palette: choice.palette, layout: 'editorial' }]))}>{choice.label}</button>)}</div>
            </>
          )}
        </section>
      </div>
      {!published && <footer className="setup-review-action"><button type="button" disabled={busy || !head} onClick={() => void run(async () => setReview(await call<SetupReview>({ action: 'review' })))}>Review before publishing</button></footer>}
      {review && (
        <section className="setup-review" aria-labelledby="setup-review-title">
          <h2 id="setup-review-title">Review your changes</h2>
          {draft && (
            <p>
              Bookings use
              {draft.booking.currency}
              ,
              {draft.booking.timezone}
              ,
              {draft.booking.minimumNoticeMinutes}
              {' '}
              minutes minimum notice, and a
              {draft.booking.bufferMinutes}
              {' '}
              minute booking buffer.
            </p>
          )}
          {draft?.bookingPolicy?.enabled && (
            <div>
              <h3>Booking policy shown to customers</h3>
              <p>{draft.bookingPolicy.title}</p>
              <p>{draft.bookingPolicy.text}</p>
              {draft.bookingPolicy.acknowledgment?.required && (
                <p>
                  Customers must agree:
                  {draft.bookingPolicy.acknowledgment?.text}
                </p>
              )}
            </div>
          )}
          <p>These are the exact changes that will become live. Existing appointments keep their saved prices and times.</p>
          {review.changes.map(change => (
            <div key={change.path}>
              <h3>{LABELS[change.path] ?? (change.path.startsWith('hours.') ? `Opening hours · ${change.path.split('.')[1]}` : change.path.startsWith('website.') ? 'Website appearance or content' : 'Booking setting')}</h3>
              <p>
                <strong>Before:</strong>
                {' '}
                {reviewValue(change.before)}
              </p>
              <p>
                <strong>After:</strong>
                {' '}
                {reviewValue(change.after)}
              </p>
            </div>
          ))}
          {review.blockers.length > 0 && (
            <div role="status">
              <h3>Before you publish</h3>
              <ul>{review.blockers.map(item => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          <button
            type="button"
            disabled={busy || review.blockers.length > 0}
            onClick={() => void run(async () => {
              const approval = await call<{
                id: string;
              }>({ action: 'approve', revision: review.revision, hash: review.hash });
              await call({ action: 'publish', approvalId: approval.id, revision: review.revision, operationId: crypto.randomUUID() });
              setPublished(true);
              setReview(null);
              await refresh();
            })}
          >
            Approve and publish
          </button>
        </section>
      )}
      {published && (
        <section className="setup-review">
          <h2>Your approved changes are published.</h2>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(async () => {
              const result = await call<Head>({ action: 'start_editing', expectedRevision: head!.revision.revision });
              setHead(result);
              setPublished(false);
              setReview(null);
              setIncludeBusiness(false);
            })}
          >
            Make more changes
          </button>
          <a href={`/${locale}/${encodeURIComponent(salonSlug)}/book/service`}>Open your booking website</a>
        </section>
      )}
    </main>
  );
}
