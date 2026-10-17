'use client';
import './setup.css';

import { useEffect, useRef, useState } from 'react';

import { designBriefSchema } from '@/features/custom-sites/contracts';
import { CustomDesignStudio } from '@/features/custom-sites/CustomDesignStudio';
import type { DesignAsset } from '@/features/custom-sites/WebsitePhotoLibrary';

import { ChatAttachments } from './ChatAttachments';
import type { SetupDocument, SetupOperation, SetupReview, SetupService } from './contracts';
import { missingDesignDetails, WEEKDAYS } from './contracts';
import { StartOverDesign } from './StartOverDesign';
import { WebsiteDetailsEditor } from './WebsiteDetailsEditor';

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
type MessageRequest = { message: string; operationId: string; expectedRevision: number; scope: string; referenceIds: string[] };
type Submission = { request: MessageRequest; status: 'sending' | 'checking' | 'failed'; startedAt: number; error?: string };
type UploadReview = { id: string; operations: SetupOperation[]; notes: string; expectedRevision: number };
function uploadReviewCurrency(upload: UploadReview, fallback: string) {
  const proposed = upload.operations.find(operation => operation.type === 'booking' && operation.values.currency);
  return proposed?.type === 'booking' ? proposed.values.currency : fallback;
}
const INTRO = 'Tell me about your business and the website you have in mind. Or attach a design — if it already has your details, I can read them for you. We’ll fill in anything missing together.';
const LABELS: Record<string, string> = {
  'designBrief': 'Design matching and chosen images',
  'designBrief.fidelity': 'How closely to match your design',
  'designBrief.referenceIds': 'Design references',
  'designBrief.ownedReferenceIds': 'Your own design artwork',
  'designBrief.websiteAssetIds': 'Website photos and logo',
  'business.name': 'Business name',
  'business.city': 'City or area',
  'business.exactAddress': 'Service address',
  'business.homeBased': 'Home-based business',
  'business.workMode': 'Solo or team',
  'business.locationDisplayMode': 'Public address visibility',
  'services': 'Service menu',
  'website.content.websiteDetails': 'Public contact details, directions and website policies',
  'website.config.customFrontendId': 'Website design (see Preview)',
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
function designReviewValue(value: unknown): string {
  const parsed = designBriefSchema.safeParse(value);
  if (parsed.success) {
    const brief = parsed.data;
    return `${brief.fidelity === 'match' ? 'Match my design closely' : 'Use it as inspiration'} · ${brief.referenceIds.length} design reference(s) · ${brief.ownedReferenceIds.length} confirmed as your own · ${brief.websiteAssetIds.length} website photo(s) or logo(s). Review the selected images in Preview.`;
  }
  if (Array.isArray(value)) {
    return `${value.length} selected image(s), shown in Preview`;
  }
  return value === 'match' ? 'Match my design closely' : value === 'inspiration' ? 'Use it as inspiration' : reviewValue(value);
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
  const [tab, setTab] = useState<'chat' | 'website' | 'setup' | 'review'>('chat');
  const [ownBusy, setBusy] = useState(false);
  const [studioBusy, setStudioBusy] = useState(false);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const submissionRef = useRef<Submission | null>(null);
  const sessionStart = useRef(1);
  const sendLock = useRef<string | null>(null);
  const restoreAttempt = useRef<{ operationId: string; expectedRevision: number } | null>(null);
  const messageConnection = useRef<AbortController | null>(null);
  const busy = ownBusy || studioBusy || Boolean(submission && submission.status !== 'failed') || messages.some(m => m.status === 'pending');
  function saveSubmission(value: Submission | null) {
    submissionRef.current = value;
    setSubmission(value);
    try {
      if (value) {
        sessionStorage.setItem(`luster-message:${salonSlug}`, JSON.stringify(value));
      } else {
        sessionStorage.removeItem(`luster-message:${salonSlug}`);
      }
    } catch { /* Recovery still works from the server when storage is unavailable. */ }
  }
  const [error, setError] = useState('');
  const [review, setReview] = useState<SetupReview | null>(null);
  const [published, setPublished] = useState(false);
  const [includeBusiness, setIncludeBusiness] = useState(!existingSalon);
  const [selectedDesignAssets, setSelectedDesignAssets] = useState<string[]>([]);
  const [assets, setAssets] = useState<DesignAsset[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const feed = useRef<HTMLDivElement>(null);
  const [uploadReviews, setUploadReviews] = useState<UploadReview[]>([]);
  const [activity, setActivity] = useState('');
  const customFrontendId = head?.revision.document.website.config.customFrontendId;
  useEffect(() => {
    if (customFrontendId && existingSalon) {
      setIncludeBusiness(false);
    }
  }, [customFrontendId, existingSalon]);
  async function call<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const response = await fetch('/api/admin/business-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ salonSlug, ...body }), signal });
    const payload = await response.json().catch(() => null) as {
      data?: T;
      error?: {
        message?: string;
        code?: string;
      };
    } | null;
    if (!response.ok || !payload || !('data' in payload)) {
      throw Object.assign(new Error(payload?.error?.message ?? 'We could not save this step. Please try again.'), { status: response.status, code: payload?.error?.code });
    }
    return payload.data as T;
  }
  async function refresh(): Promise<Head & { messages: Message[]; uploadReviews?: UploadReview[] }> {
    const response = await fetch(`/api/admin/business-setup?salonSlug=${encodeURIComponent(salonSlug)}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Your saved setup could not be loaded. Please refresh.');
    }
    const { data } = await response.json() as {
      data: Head & {
        messages: Message[];
        uploadReviews?: UploadReview[];
      };
    };
    if (data.revision.revision < sessionStart.current) {
      return refresh();
    }
    const newSession = data.revision.document.sessionStartRevision ?? 1;
    if (newSession > sessionStart.current) {
      setText('');
      setReview(null);
      setSelectedDesignAssets([]);
      setAttachOpen(false);
      setTab('chat');
    }
    sessionStart.current = newSession;
    setHead(current => current && current.revision.revision > data.revision.revision ? current : data);
    setMessages(current => data.messages.map(message => message.status === 'completed' ? message : current.find(old => old.id === message.id && old.status === 'completed') ?? message));
    const current = submissionRef.current;
    if (current) {
      const saved = data.messages.find(m => m.id === current.request.operationId);
      if (current.request.expectedRevision < newSession || saved?.status === 'completed') {
        messageConnection.current?.abort();
        sendLock.current = null;
        saveSubmission(null);
        setPendingMessage(null);
        setActivity('');
        setError('');
      } else if (saved && ['failed', 'interrupted'].includes(saved.status)) {
        saveSubmission({ ...current, status: 'failed', error: saved.reply || 'This attempt stopped. Your saved changes are safe.' });
        setPendingMessage(null);
        setActivity('');
      } else if (!saved && current.status === 'checking' && Date.now() - current.startedAt > 30000) {
        saveSubmission({ ...current, status: 'failed', error: 'We could not confirm delivery. Retry checks the same request safely.' });
        setActivity('');
      }
    }
    setUploadReviews(data.uploadReviews ?? []);
    setPublished(data.workspace.status === 'published');
    if (data.workspace.status === 'published') {
      setTab('chat');
      setReview(null);
    }
    return data;
  }
  useEffect(() => {
    let active = true;
    try {
      const stored = JSON.parse(sessionStorage.getItem(`luster-message:${salonSlug}`) ?? 'null');
      if (stored?.request && typeof stored.request.operationId === 'string' && typeof stored.request.message === 'string' && Date.now() - stored.startedAt < 86400000) {
        saveSubmission({ ...stored, status: 'checking' });
        setPendingMessage(stored.request.message);
        setActivity('Checking your saved changes…');
      }
    } catch { /* Ignore unavailable or outdated browser storage. */ }
    call<Head>({ action: 'open' }).then(async (data) => {
      if (active) {
        // Adopt the saved conversation before enabling navigation. The history
        // request can be slower: initial hydration must not look like a reset
        // on another device and send an owner's Preview click back to chat.
        sessionStart.current = data.revision.document.sessionStartRevision ?? 1;
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
  async function run(work: () => Promise<unknown>) {
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
  async function replaceSession(action: 'reset' | 'restore_previous', operationId: string, upload = false, expectedRevision = head?.revision.revision) {
    if (!head) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await call<Head>({ action, input: { expectedRevision, operationId } });
      sessionStart.current = result.revision.document.sessionStartRevision ?? 1;
      messageConnection.current?.abort();
      sendLock.current = null;
      saveSubmission(null);
      setPendingMessage(null);
      setActivity('');
      setHead(result);
      setMessages([]);
      setText('');
      setReview(null);
      setUploadReviews([]);
      setSelectedDesignAssets([]);
      setStudioBusy(false);
      setIncludeBusiness(!existingSalon);
      setPublished(false);
      setTab('chat');
      await refresh();
      restoreAttempt.current = null;
      setAttachOpen(upload);
      feed.current?.scrollTo?.({ top: 0 });
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
  const missing = draft ? missingDesignDetails(draft) : [];
  const requestAssets = draft?.designBrief ? [...draft.designBrief.referenceIds, ...draft.designBrief.websiteAssetIds] : selectedDesignAssets;
  const canSendImage = !customFrontendId && messages.length === 0 && Boolean(draft?.designBrief?.referenceIds.length);
  const hasPendingMessage = messages.some(message => message.status === 'pending');
  const lastReply = messages.at(-1)?.reply;
  useEffect(() => {
    // Scroll this conversation, never the whole page or the mobile keyboard.
    const element = feed.current;
    if (element && tab === 'chat') {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages.length, lastReply, uploadReviews.length, pendingMessage, activity, tab]);
  useEffect(() => {
    if (!ownBusy && !hasPendingMessage && (!submission || submission.status === 'failed')) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh().catch(() => {});
    }, 4000);
    return () => window.clearInterval(timer);
  }, [ownBusy, hasPendingMessage, submission?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  async function submitRequest(request: MessageRequest) {
    if (sendLock.current) {
      return;
    }
    sendLock.current = request.operationId;
    const connection = new AbortController();
    messageConnection.current = connection;
    saveSubmission({ request, status: 'sending', startedAt: Date.now() });
    setPendingMessage(request.message);
    setActivity('Working on your changes…');
    setError('');
    try {
      const result = await call<{ head: Head; reply: string }>({ action: 'message', message: request }, connection.signal);
      if (request.expectedRevision < sessionStart.current) {
        await refresh();
        return;
      }
      setHead(current => current && current.revision.revision > result.head.revision.revision ? current : result.head);
      setReview(null);
      if (!customFrontendId && result.head.revision.document.website.config.customFrontendId) {
        setTab('website');
      }
      // The response proves completion even if the subsequent history GET fails.
      setMessages(current => [...current.filter(m => m.id !== request.operationId), { id: request.operationId, message: request.message, reply: result.reply, status: 'completed' }]);
      saveSubmission(null);
      setPendingMessage(null);
      setActivity('');
      await refresh().catch(() => {});
    } catch (error) {
      // A lost HTTP response does not prove the operation failed. Reconcile by ID.
      if (submissionRef.current?.request.operationId === request.operationId) {
        saveSubmission({ ...submissionRef.current, status: 'checking' });
        setActivity('Checking your saved changes…');
        const latest = await refresh().catch(() => null);
        if (submissionRef.current && latest && !latest.messages.some(m => m.id === request.operationId) && error instanceof Error && 'status' in error && Number(error.status) >= 400 && Number(error.status) < 500) {
          saveSubmission({ request: { ...request, expectedRevision: latest.revision.revision }, startedAt: Date.now(), status: 'failed', error: error.message });
          setActivity('');
        }
      }
    } finally {
      if (sendLock.current === request.operationId) {
        sendLock.current = null;
      }
    }
  }
  async function sendMessage() {
    const message = text.trim() || (canSendImage ? 'Create my website from this design.' : '');
    if (!head || busy || sendLock.current || published || !message) {
      return;
    }
    const request: MessageRequest = { message, operationId: crypto.randomUUID(), expectedRevision: head.revision.revision, scope: includeBusiness ? 'business_and_website' : 'website', referenceIds: requestAssets };
    setText('');
    await submitRequest(request);
  }
  async function retryMessage() {
    const failed = submissionRef.current;
    if (!failed || failed.status !== 'failed' || sendLock.current) {
      return;
    }
    try {
      const latest = await refresh();
      const saved = latest.messages.find(m => m.id === failed.request.operationId);
      if (saved?.status === 'completed' || saved?.status === 'pending') {
        return;
      }
      // An explicit retry of a terminal failure is a fresh AI attempt. Unknown
      // delivery and saved generated work always retain the original identity.
      const request = saved && ['failed', 'interrupted'].includes(saved.status)
        ? { ...failed.request, operationId: crypto.randomUUID(), expectedRevision: latest.revision.revision }
        : failed.request;
      await submitRequest(request);
    } catch {
      setError('Still unable to connect. Your message is saved here; try again when you’re online.');
    }
  }
  return (
    <main className="luster-setup setup-chat-first" data-view={tab}>
      <header className="setup-heading">
        <div className="setup-topbar">
          <a href={`/${locale}/admin/website?salon=${encodeURIComponent(salonSlug)}`} aria-label="Back to website settings">←</a>
          <div className="setup-brand">
            <span className="setup-wordmark">✦ LUSTER</span>
            <span className="setup-save-status" role="status">{busy ? 'Working…' : published ? 'Published' : head ? 'Saved as draft' : 'Opening your saved work…'}</span>
          </div>
          <nav className="setup-tools" aria-label="Website tools">
            <button type="button" disabled={!head} aria-pressed={tab === 'website'} onClick={() => setTab(tab === 'website' ? 'chat' : 'website')}>Preview</button>
            <button type="button" disabled={!head} aria-pressed={tab === 'setup'} onClick={() => setTab(tab === 'setup' ? 'chat' : 'setup')}>Details</button>
            {!published && head && head.revision.revision > 1 && (
              <button
                type="button"
                disabled={busy}
                aria-pressed={tab === 'review'}
                onClick={() => void run(async () => {
                  setReview(await call<SetupReview>({ action: 'review' }));
                  setTab('review');
                })}
              >
                Review
              </button>
            )}
          </nav>
        </div>
      </header>
      {error && (
        <div className="setup-error" role="alert">
          {error}
          <button type="button" onClick={() => void run(refresh)}>Reload saved changes</button>
        </div>
      )}
      <div className="setup-columns" data-tab={tab}>
        <section className="setup-chat" aria-label="Conversation" hidden={tab === 'setup' || tab === 'review'}>
          <div className="setup-feed" ref={feed}>
            {messages.length === 0 && !pendingMessage && (
              <div className="setup-chat-welcome">
                <span aria-hidden="true">✦</span>
                <h1>{customFrontendId ? 'What would you like to change?' : 'Let’s create your website.'}</h1>
                <p>{customFrontendId ? 'Your ideas. A website that feels like you.' : 'A design you love. Your business, ready to book.'}</p>
              </div>
            )}
            {draft?.previousDraftRevision && (
              <p className="setup-reset-recovery">
                Your earlier draft is saved.
                {' '}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(async () => {
                    restoreAttempt.current ??= { operationId: crypto.randomUUID(), expectedRevision: head!.revision.revision };
                    await replaceSession('restore_previous', restoreAttempt.current.operationId, false, restoreAttempt.current.expectedRevision);
                  })}
                >
                  Restore earlier draft
                </button>
              </p>
            )}
            {!aiEnabled && <p role="status">AI is unavailable. You can still edit, review, and publish your saved setup using Details.</p>}
            <div className="setup-messages" role="log" aria-label="Messages" aria-live="polite">
              <p className="setup-assistant">{draft?.sessionStartRevision && !customFrontendId ? 'You’re starting fresh. Upload your new design or describe your idea. If your image includes your business details, I can read them for you.' : existingSalon || customFrontendId ? 'I’ve loaded your saved website and business details. What would you like to change?' : draft && !['Untitled business', 'My test business'].includes(draft.business.name) ? `I have your saved details for ${draft.business.name}${draft.business.city ? ` in ${draft.business.city}` : ''}.${missing.length ? ` Next, tell me ${missing.slice(0, 2).join(' and ')}. Or attach a design that includes them.` : ' Tell me how you’d like your website to look, or attach a design you love.'}` : INTRO}</p>
              {messages.map(message => (
                <div key={message.id}>
                  <p className="setup-owner">{message.message}</p>
                  {message.reply && !['failed', 'interrupted'].includes(message.status) && <p className="setup-assistant">{message.reply.replace(/\*\*([^*]+)\*\*/gu, '$1').replaceAll('not_shown', 'unclear')}</p>}
                  {message.status === 'pending' && (
                    <p role="status" className="setup-thinking">
                      <span aria-hidden="true">✦</span>
                      {' '}
                      Working on your changes…
                    </p>
                  )}
                  {['failed', 'interrupted'].includes(message.status) && (
                    <div>
                      {submission?.request.operationId !== message.id && <p>{message.reply || 'This request stopped. Your saved changes are safe.'}</p>}
                      {submission?.request.operationId !== message.id && (
                        <button
                          type="button"
                          disabled={busy || published}
                          onClick={() => void run(async () => {
                            const latest = await refresh();
                            const saved = latest.messages.find(m => m.id === message.id);
                            if (!saved || !['failed', 'interrupted'].includes(saved.status)) {
                              return;
                            }
                            await submitRequest({ message: saved.message, operationId: crypto.randomUUID(), expectedRevision: latest.revision.revision, scope: includeBusiness ? 'business_and_website' : 'website', referenceIds: requestAssets });
                          })}
                        >
                          Retry message
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {pendingMessage && !messages.some(message => message.id === submission?.request.operationId) && <p className="setup-owner">{pendingMessage}</p>}
              {submission?.status === 'failed' && (
                <div role="alert">
                  <p>{submission.error}</p>
                  <button type="button" disabled={busy} onClick={() => void retryMessage()}>Retry message</button>
                </div>
              )}
              {busy && !hasPendingMessage && (
                <p className="setup-thinking" role="status">
                  <span aria-hidden="true">✦</span>
                  {' '}
                  {activity || 'Saving your changes…'}
                </p>
              )}
            </div>
            {messages.length === 0 && !pendingMessage && !customFrontendId && (
              <div className="setup-starters">
                <button type="button" disabled={!head || busy || published} onClick={() => setAttachOpen(true)}>＋ Upload a design</button>
                <button type="button" onClick={() => document.getElementById('setup-message')?.focus()}>Describe my idea ↗</button>
              </div>
            )}
            {customFrontendId && (
              <button type="button" className="setup-design-card" onClick={() => setTab('website')}>
                <span aria-hidden="true">▧</span>
                <span>
                  <strong>Your website draft</strong>
                  <small>Open preview · keep refining in chat</small>
                </span>
                <span aria-hidden="true">↗</span>
              </button>
            )}
            {uploadReviews.map(upload => (
              <section key={upload.id} className="setup-upload-review" aria-label="Details found in your upload">
                <span className="setup-eyebrow">READ FROM YOUR UPLOAD</span>
                <h3>Does this look right?</h3>
                <p>Check what Luster found. Nothing has been added to your business details yet.</p>
                <dl>
                  {upload.operations.flatMap((operation) => {
                    if (operation.type === 'business') {
                      return Object.entries(operation.values).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key === 'exactAddress' ? 'Private service address' : key === 'name' ? 'Business name' : key === 'homeBased' ? 'Home-based salon' : key === 'locationDisplayMode' ? 'Address visibility' : 'City or area'}</dt>
                          <dd>{reviewValue(value)}</dd>
                        </div>
                      ));
                    }
                    if (operation.type === 'service') {
                      return (
                        <div key={operation.values.id}>
                          <dt>{operation.values.name}</dt>
                          <dd>
                            {operation.values.priceCents === null ? 'Price needed' : `${uploadReviewCurrency(upload, draft?.booking.currency ?? '')} ${(operation.values.priceCents / 100).toFixed(2)}`}
                            {' '}
                            ·
                            {' '}
                            {operation.values.durationMinutes === null ? 'Appointment length needed' : `${operation.values.durationMinutes} min`}
                          </dd>
                        </div>
                      );
                    }
                    if (operation.type === 'hours') {
                      return (
                        <div key={operation.type}>
                          <dt>Opening hours · unlisted days keep saved hours</dt>
                          <dd>{Object.entries(operation.values).map(([day, hours]) => `${day}: ${hours ? `${hours.open}–${hours.close}` : 'closed'}`).join(' · ')}</dd>
                        </div>
                      );
                    }
                    return (
                      <div key={operation.type}>
                        <dt>Booking details</dt>
                        <dd>{'values' in operation ? reviewValue(operation.values) : ''}</dd>
                      </div>
                    );
                  })}
                </dl>
                {upload.notes && <p className="setup-reading-notes">{upload.notes}</p>}
                {upload.expectedRevision !== head?.revision.revision && <p>Your details changed since this image was read. Read it again to compare with your latest details.</p>}
                <button
                  type="button"
                  disabled={busy || published || !upload.operations.length || upload.expectedRevision !== head?.revision.revision}
                  onClick={() => void run(async () => {
                    await call({ action: 'apply_upload', operationId: upload.id });
                    await refresh();
                    setReview(null);
                    setTab('chat');
                  })}
                >
                  Use these details
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(async () => {
                    await call({ action: 'dismiss_upload', operationId: upload.id });
                    await refresh();
                  })}
                >
                  Skip these details
                </button>
                <small>Prices and appointment lengths still need your review. A new address from an image is kept private. You can choose what customers see in Business setup.</small>
              </section>
            ))}
            {published && (
              <section className="setup-published-card">
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
                <a href={`/${locale}/${encodeURIComponent(salonSlug)}/book/service?publishedWebsite=1`}>Open your booking website</a>
              </section>
            )}
          </div>
          <div className="setup-compose-area">
            {head && (
              <ChatAttachments
                key={draft?.sessionStartRevision ?? 1}
                salonSlug={salonSlug}
                revision={head.revision.revision}
                brief={draft?.designBrief}
                assets={assets}
                selected={selectedDesignAssets}
                initialPurpose={draft?.sessionStartRevision ? 'own' : undefined}
                open={attachOpen}
                onClose={() => setAttachOpen(false)}
                disabled={busy || published}
                onBusyChange={setBusy}
                onSaved={async () => {
                  setReview(null);
                  await refresh();
                }}
              />
            )}
            <form
              className="setup-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage();
              }}
            >
              <label className="setup-sr-only" htmlFor="setup-message">Message Luster</label>
              <textarea
                id="setup-message"
                value={text}
                onChange={event => setText(event.target.value)}
                maxLength={4000}
                placeholder={customFrontendId ? 'Ask Luster to change anything…' : canSendImage ? 'Send your image, or add a message…' : 'Describe your idea, or ask anything…'}
                rows={2}
                disabled={published}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !window.matchMedia('(pointer: coarse)').matches) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <div className="setup-compose-tools">
                <button type="button" id="setup-attach-button" className="setup-attach" aria-label="Attach images or a PDF" disabled={!head || busy || published} onClick={() => setAttachOpen(true)}>＋</button>
                {(existingSalon || customFrontendId) && (
                  <label className="setup-scope">
                    <span className="setup-sr-only">What can Luster change?</span>
                    <select aria-label="What can Luster change?" value={includeBusiness ? 'all' : 'website'} onChange={event => setIncludeBusiness(event.target.value === 'all')} disabled={busy}>
                      <option value="website">Website</option>
                      <option value="all">Website + business</option>
                    </select>
                  </label>
                )}
                <button type="submit" aria-label="Send message" disabled={!aiEnabled || busy || !head || published || (!text.trim() && !canSendImage)}>↑</button>
              </div>
            </form>
            <div className="setup-compose-footer">
              <p className="setup-compose-note">Only you can approve and publish changes.</p>
              {head && draft && (
                <StartOverDesign
                  revision={head.revision.revision}
                  disabled={busy}
                  onReset={(upload, operationId, expectedRevision) => replaceSession('reset', operationId, upload, expectedRevision)}
                />
              )}
            </div>
          </div>
        </section>
        <section className="setup-preview" aria-label="Website preview" hidden={tab !== 'website'}>
          <button type="button" className="setup-back-chat" onClick={() => setTab('chat')}>← Back to chat</button>
          <div className="setup-panel-heading">
            <div>
              <span className="setup-eyebrow">YOUR VISION, TAKING SHAPE</span>
              <h2>{customFrontendId ? 'Your website draft' : 'From inspiration to your website'}</h2>
              <p>Private preview. Booking is disabled here.</p>
              {draft && (draft.hoursOrigin === 'suggested' || draft.services.some(service => service.origin === 'assistant' && !service.confirmed)) && <p role="status">This first look includes suggested booking details. Change them in chat or Details, then review them before publishing.</p>}
            </div>
          </div>
          {head && (
            <CustomDesignStudio
              key={draft?.sessionStartRevision ?? 1}
              salonSlug={salonSlug}
              revision={head.revision.revision}
              artifactId={head.revision.document.website.config.customFrontendId}
              disabled={published || ownBusy}
              onBusyChange={setStudioBusy}
              aiEnabled={aiEnabled}
              compact
              onAssetsChange={setAssets}
              selected={selectedDesignAssets}
              setSelected={setSelectedDesignAssets}
              missingDetails={missingDesignDetails(head.revision.document)}
              onContinueConversation={() => {
                setTab('chat');
                window.requestAnimationFrame(() => document.getElementById('setup-message')?.focus());
              }}
              onSaved={async () => {
                setReview(null);
                await refresh();
              }}
            />
          )}
          {head && !customFrontendId && missing.length === 0 && (
            <details>
              <summary>Preview your current booking details</summary>
              <iframe title="Your website draft" sandbox="" src={`/${locale}/admin/business-setup/preview/${encodeURIComponent(salonSlug)}?revision=${head.revision.revision}`} />
            </details>
          )}
        </section>
        <section className="setup-details" aria-label="Business setup" hidden={tab !== 'setup'}>
          <button type="button" className="setup-back-chat" onClick={() => setTab('chat')}>← Back to chat</button>
          <h2>Your business setup</h2>
          <p>Everything we’ve put together so far. Make a correction here or tell Luster in the conversation.</p>
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
              <WebsiteDetailsEditor value={draft.website.content.websiteDetails} disabled={busy || published} onSave={values => void run(() => edit([{ type: 'website_details', values }]))} />
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
              {draft.hoursOrigin === 'suggested' && (
                <div className="setup-notice">
                  <p>These hours are suggestions for your first preview. Adjust them below, or accept them when you are ready.</p>
                  <button type="button" disabled={busy || published} onClick={() => void run(() => edit([{ type: 'confirm_hours' }]))}>Use these hours</button>
                </div>
              )}
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
                  <p>Check the prices and appointment lengths below before accepting them. Details read from uploads may be incomplete.</p>
                  {pending.some(service => service.origin === 'assistant') && <p>AI recommendations are illustrative starting points, not researched local market rates.</p>}
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
                    {service.confirmed ? 'Reviewed' : service.origin === 'upload' ? 'Read from your upload · needs review' : service.origin === 'assistant' ? 'AI proposal · needs review' : 'Needs your review'}
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
        {review && tab === 'review' && (
          <section className="setup-review" aria-labelledby="setup-review-title">
            <button type="button" className="setup-back-chat" onClick={() => setTab('chat')}>← Back to chat</button>
            <h2 id="setup-review-title">Review your changes</h2>
            {draft && (
              <p>
                {`Bookings use ${draft.booking.currency}, ${draft.booking.timezone}, ${draft.booking.minimumNoticeMinutes} minutes minimum notice, and a ${draft.booking.bufferMinutes} minute booking buffer.`}
              </p>
            )}
            {draft?.bookingPolicy?.enabled && (
              <div>
                <h3>Booking policy shown to customers</h3>
                <p>{draft.bookingPolicy.title}</p>
                <p>{draft.bookingPolicy.text}</p>
                {draft.bookingPolicy.acknowledgment?.required && (
                  <p>
                    {`Customers must agree: ${draft.bookingPolicy.acknowledgment?.text}`}
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
                  {change.path === 'website.config.customFrontendId' ? change.before ? 'Your current website design' : 'No custom website design' : change.path.startsWith('designBrief') ? designReviewValue(change.before) : reviewValue(change.before)}
                </p>
                <p>
                  <strong>After:</strong>
                  {' '}
                  {change.path === 'website.config.customFrontendId' ? 'The saved design shown in your preview' : change.path.startsWith('designBrief') ? designReviewValue(change.after) : reviewValue(change.after)}
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
                setTab('chat');
                setReview(null);
                await refresh();
              })}
            >
              Approve and publish
            </button>
          </section>
        )}

      </div>
    </main>
  );
}
