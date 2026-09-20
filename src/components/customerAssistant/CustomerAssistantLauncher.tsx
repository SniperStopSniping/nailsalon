'use client';

import { Send, X } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DialogShell } from '@/components/ui/dialog-shell';
import { useBookingState } from '@/hooks/useBookingState';
import { useCustomerViewport } from '@/hooks/useCustomerViewport';
import { buildBookingUrl } from '@/libs/bookingParams';
import type { CustomerBookingOperationReference, CustomerBookingStatus } from '@/libs/customerAssistant/bookingOperationContracts';
import type { CustomerAssistantHandoffResponse, CustomerAssistantLocale, CustomerAssistantResponse, CustomerAssistantResult } from '@/libs/customerAssistant/contracts';
import { canStartAnotherBooking, startAnotherBooking } from '@/libs/customerAssistant/newBooking.client';
import { adoptNormalBookingOperation } from '@/libs/customerAssistant/normalBooking.client';
import { readNormalConfirmHandoff, writeNormalConfirmHandoff } from '@/libs/customerAssistant/normalConfirmHandoff.client';
import { customerBookingRecoveryUrl } from '@/libs/customerAssistant/recoveryUrl';
import { formatMoney } from '@/libs/formatMoney';
import { formatDuration } from '@/utils/Helpers';

import { customerAssistantCopy } from './copy';
import { AcceptSelection } from './ScheduleCards';

type CustomerAssistantLauncherProps = { salonSlug: string; salonId?: string; locale: CustomerAssistantLocale; campaignToken?: string | null };
type CustomerAssistantPanelProps = CustomerAssistantLauncherProps & { onClose: () => void; visibleHeight?: number };
type DisplayMessage = { id: number; role: 'assistant' | 'user'; message: string; kind?: 'quick_reply' };
type StoredConversation = { version: 2; conversation: string; messages: DisplayMessage[]; result: CustomerAssistantResult | null; welcomeQuickReplies?: string[]; campaignBinding?: string };
type StoredOperation = CustomerBookingOperationReference & { version: 1; salonId: string };
type StorageScope = { binding: string | null; persist: boolean };

const MAX_DISPLAY_MESSAGES = 12;
const storageKey = (salonSlug: string) => `luster.customer-assistant.conversation.${salonSlug}`;
const operationStorageKey = (salonId: string) => `luster.customer-booking.operation.${salonId}`;
const endpoint = (salonSlug: string) => `/api/public/customer-assistant/${encodeURIComponent(salonSlug)}`;

async function campaignStorageBinding(token: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

function readStoredOperation(salonId: string): StoredOperation | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(operationStorageKey(salonId)) ?? 'null');
    if (!value || typeof value !== 'object') {
      return null;
    }
    const item = value as Partial<StoredOperation>;
    return item.version === 1 && item.salonId === salonId && typeof item.capability === 'string'
      && typeof item.revision === 'number' && typeof item.fingerprint === 'string' && typeof item.expiresAt === 'string'
      ? item as StoredOperation
      : null;
  } catch {
    return null;
  }
}

export function BookingStatusCard({ status, locale, onResume, onManage }: { status: CustomerBookingStatus; locale: CustomerAssistantLocale; onResume?: () => void; onManage?: () => void }) {
  const messages: Record<CustomerBookingStatus['status'], Record<CustomerAssistantLocale, string>> = {
    not_created: { en: 'We are still checking this booking. Please do not create another booking yet.', fr: 'Nous vérifions toujours cette réservation. Ne créez pas une autre réservation pour le moment.' },
    payment_processing: { en: 'We are checking your payment status.', fr: 'Nous vérifions l’état de votre paiement.' },
    payment_required: { en: 'Payment is required to complete this booking.', fr: 'Un paiement est requis pour terminer cette réservation.' },
    awaiting_approval: { en: 'Your booking request is awaiting salon approval.', fr: 'Votre demande de réservation attend l’approbation du salon.' },
    confirmed: { en: 'Your appointment is confirmed.', fr: 'Votre rendez-vous est confirmé.' },
    in_progress: { en: 'Your appointment is in progress.', fr: 'Votre rendez-vous est en cours.' },
    completed: { en: 'This appointment is complete.', fr: 'Ce rendez-vous est terminé.' },
    cancelled: { en: 'This appointment was cancelled.', fr: 'Ce rendez-vous a été annulé.' },
    expired: { en: 'This booking has expired.', fr: 'Cette réservation a expiré.' },
    unavailable: { en: 'This booking is unavailable.', fr: 'Cette réservation n’est pas disponible.' },
  };
  return (
    <section aria-live="polite" aria-label={locale === 'fr' ? 'Statut de réservation' : 'Booking status'} className="rounded-2xl border border-black/10 bg-white p-4">
      <h3 className="font-semibold text-neutral-950">{locale === 'fr' ? 'Statut de réservation' : 'Booking status'}</h3>
      <p className="mt-2 text-sm text-neutral-700">{messages[status.status][locale]}</p>
      {status.payment && (
        <p className="mt-2 text-sm font-medium text-neutral-950">
          {formatMoney(status.payment.amountCents, status.payment.currency, locale === 'fr' ? 'fr-CA' : 'en-CA')}
          {' '}
          {locale === 'fr' ? 'à payer' : 'due'}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {status.status === 'payment_required' && status.payment?.canResume && onResume && <button type="button" onClick={onResume} className="min-h-11 rounded-xl bg-neutral-950 px-4 py-2 text-sm font-semibold text-white">{locale === 'fr' ? 'Reprendre le paiement' : 'Resume payment'}</button>}
        {status.appointment && onManage && <button type="button" onClick={onManage} className="min-h-11 rounded-xl border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-950">{locale === 'fr' ? 'Gérer la réservation' : 'Manage booking'}</button>}
      </div>
    </section>
  );
}

/** Legacy durable-operation recovery is intentionally available without the assistant feature. */
export function CustomerBookingRecovery({ salonId, locale }: { salonId: string; locale: CustomerAssistantLocale }) {
  const [status, setStatus] = useState<CustomerBookingStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const refreshStatus = useCallback(async () => {
    const operation = readStoredOperation(salonId);
    if (!operation) {
      return;
    }
    setUnavailable(false);
    try {
      const response = await fetch(`/api/public/customer-booking/${encodeURIComponent(salonId)}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capability: operation.capability }) });
      if (!response.ok) {
        throw new Error('status failed');
      }
      setStatus(await response.json() as CustomerBookingStatus);
    } catch {
      setUnavailable(true);
    }
  }, [salonId]);
  const runAction = async (action: 'resume' | 'manage') => {
    const operation = readStoredOperation(salonId);
    if (!operation) {
      return;
    }
    try {
      const response = await fetch(`/api/public/customer-booking/${encodeURIComponent(salonId)}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capability: operation.capability }) });
      const data = await response.json().catch(() => null) as { url?: unknown } | null;
      if (action === 'resume' && response.status === 409) {
        const refreshed = await fetch(`/api/public/customer-booking/${encodeURIComponent(salonId)}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capability: operation.capability }) });
        if (refreshed.ok) {
          setStatus(await refreshed.json() as CustomerBookingStatus);
        } else {
          setUnavailable(true);
        }
        return;
      }
      if (typeof data?.url !== 'string') {
        throw new TypeError('missing action url');
      }
      const url = customerBookingRecoveryUrl(data.url, action);
      if (!url) {
        throw new Error('untrusted action url');
      }
      window.location.assign(url);
    } catch {
      setUnavailable(true);
    }
  };
  useEffect(() => {
    const operation = readStoredOperation(salonId);
    if (!operation) {
      return;
    }
    void refreshStatus();
  }, [refreshStatus, salonId]);
  if (!status && !unavailable) {
    return null;
  }
  return status
    ? <div className="mx-auto max-w-xl px-4 pt-4"><BookingStatusCard status={status} locale={locale} onResume={() => void runAction('resume')} onManage={() => void runAction('manage')} /></div>
    : (
        <div role="status" className="mx-auto max-w-xl px-4 pt-4 text-sm text-neutral-700">
          <p>{locale === 'fr' ? 'Nous ne pouvons pas vérifier cette réservation pour le moment.' : 'We could not check this booking yet. Please try again.'}</p>
          <button type="button" onClick={() => void refreshStatus()} className="mt-2 min-h-11 font-medium underline underline-offset-4">{locale === 'fr' ? 'Réessayer' : 'Try again'}</button>
        </div>
      );
}

function readStoredConversation(salonSlug: string, scope: StorageScope): StoredConversation | null {
  if (!scope.persist) {
    return null;
  }
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(storageKey(salonSlug));
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'string') {
      if (scope.binding !== null) {
        return null;
      }
      return { version: 2, conversation: parsed, messages: [], result: null };
    }
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const value = parsed as Partial<StoredConversation>;
    if (value.version !== 2 || typeof value.conversation !== 'string' || !Array.isArray(value.messages)
      || (scope.binding === null ? Boolean(value.campaignBinding) : value.campaignBinding !== scope.binding)) {
      return null;
    }
    const messages = value.messages.filter((message): message is DisplayMessage => typeof message === 'object' && message !== null && typeof (message as DisplayMessage).id === 'number' && ((message as DisplayMessage).role === 'assistant' || (message as DisplayMessage).role === 'user') && typeof (message as DisplayMessage).message === 'string').slice(-MAX_DISPLAY_MESSAGES);
    const welcomeQuickReplies = Array.isArray(value.welcomeQuickReplies)
      ? value.welcomeQuickReplies.filter((reply): reply is string => typeof reply === 'string' && reply.length > 0 && reply.length <= 160).slice(0, 3)
      : undefined;
    return { version: 2, conversation: value.conversation, messages, result: value.result ?? null, ...(welcomeQuickReplies?.length ? { welcomeQuickReplies } : {}) };
  } catch {
    const legacy = raw.trim();
    return scope.binding === null && legacy && !legacy.startsWith('{') && legacy.length <= 24_576
      ? { version: 2, conversation: legacy, messages: [], result: null }
      : null;
  }
}
function storeConversation(salonSlug: string, stored: StoredConversation, scope: StorageScope): void {
  if (!scope.persist) {
    return;
  }
  try {
    sessionStorage.setItem(storageKey(salonSlug), JSON.stringify({ ...stored, messages: stored.messages.slice(-MAX_DISPLAY_MESSAGES), ...(scope.binding ? { campaignBinding: scope.binding } : {}) }));
  } catch { /* Session remains in memory. */ }
}
function clearStoredConversation(salonSlug: string, scope: StorageScope): void {
  if (!scope.persist) {
    return;
  }
  try {
    const stored = readStoredConversation(salonSlug, scope);
    if (stored) {
      sessionStorage.removeItem(storageKey(salonSlug));
    }
  } catch { /* State is cleared by caller. */ }
}
function isConversationError(result: CustomerAssistantResult): boolean {
  return result.kind === 'unavailable' && ['conversation_used', 'invalid_conversation', 'conversation_expired', 'session_limit'].includes(result.reason);
}

function assistantMessage(result: CustomerAssistantResult, locale: CustomerAssistantLocale): string | null {
  const copy = customerAssistantCopy[locale];
  if (result.kind === 'answer') {
    return result.message ?? null;
  }
  if (result.kind === 'clarification') {
    return result.message ?? copy.questions[result.question] ?? null;
  }
  if (result.kind === 'unavailable') {
    return result.message ?? copy.unavailable[result.reason] ?? copy.unavailable.unavailable ?? null;
  }
  if (result.kind === 'date_prompt') {
    return result.message ?? copy.questions.date ?? null;
  }
  if (result.kind === 'slots') {
    return result.message ?? (result.slots.length > 0 ? `${copy.availability}: ${result.slots.map(slot => slot.time).join(', ')}.` : copy.unavailable.no_availability ?? null);
  }
  if (result.kind === 'slot_selected') {
    return result.message ?? `${copy.availability}: ${result.slot.time}.`;
  }
  return result.message ?? null;
}

function formatAvailabilitySlot(startTime: string, fallbackTime: string, timeZone: string, locale: CustomerAssistantLocale): string {
  const instant = new Date(startTime);
  if (Number.isNaN(instant.getTime())) {
    return `${fallbackTime} (${timeZone})`;
  }
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(instant);
}

function ProposalCard({ result, locale }: { result: Extract<CustomerAssistantResult, { kind: 'proposal' }>; locale: CustomerAssistantLocale }) {
  const copy = customerAssistantCopy[locale];
  const { proposal } = result;
  const configuration = proposal.configuration ?? [];
  return (
    <section aria-label={copy.proposal} data-testid="customer-assistant-proposal" className="min-w-0 overflow-hidden rounded-2xl border border-black/10 bg-white p-[12px] shadow-sm">
      <h3 className="text-base font-semibold text-neutral-950">{copy.proposal}</h3>
      <dl className="mt-[10px] min-w-0 space-y-[10px] text-sm text-neutral-700">
        <div className="flex min-w-0 items-start justify-between gap-[8px]">
          <dt className="min-w-0 shrink">{copy.services}</dt>
          <dd className="min-w-0 max-w-[62%] break-words text-right font-medium text-neutral-950">
            {proposal.service.name}
            <span className="block text-xs font-normal text-neutral-600">{formatMoney(proposal.service.priceCents, proposal.currency, locale === 'fr' ? 'fr-CA' : 'en-CA')}</span>
          </dd>
        </div>
        {proposal.addOns.length > 0 && (
          <div className="flex min-w-0 items-start justify-between gap-[8px]">
            <dt className="min-w-0 shrink">{copy.addOns}</dt>
            <dd className="min-w-0 max-w-[62%] space-y-1 break-words text-right font-medium text-neutral-950">
              {proposal.addOns.map(addOn => (
                <div key={addOn.id}>
                  {addOn.quantity > 1 ? `${addOn.quantity} × ` : ''}
                  <span>{addOn.name}</span>
                  <span className="block text-xs font-normal text-neutral-600">
                    {addOn.priceCents === 0
                      ? copy.included
                      : (
                          <>
                            {addOn.quantity > 1 && addOn.unitPriceCents !== undefined && `${formatMoney(addOn.unitPriceCents, proposal.currency, locale === 'fr' ? 'fr-CA' : 'en-CA')} ${copy.each} · `}
                            {formatMoney(addOn.priceCents, proposal.currency, locale === 'fr' ? 'fr-CA' : 'en-CA')}
                            {addOn.quantity > 1 && ` ${copy.lineTotal}`}
                          </>
                        )}
                  </span>
                </div>
              ))}
            </dd>
          </div>
        )}
        {configuration.length > 0 && (
          <div className="flex min-w-0 items-start justify-between gap-[8px]">
            <dt className="min-w-0 shrink">{copy.configuration}</dt>
            <dd className="min-w-0 max-w-[62%] space-y-1 break-words text-right font-medium text-neutral-950">
              {configuration.map(item => <div key={item}>{item}</div>)}
            </dd>
          </div>
        )}
        <div className="flex min-w-0 items-center justify-between gap-[8px]">
          <dt className="min-w-0 shrink">{copy.duration}</dt>
          <dd className="shrink-0 text-right font-medium text-neutral-950">{formatDuration(proposal.durationMinutes)}</dd>
        </div>
        <div className="border-t border-black/10 pt-[10px]">
          <div className="flex min-w-0 items-center justify-between gap-[8px] text-base font-semibold text-neutral-950">
            <dt className="min-w-0 shrink break-words">{copy.subtotal}</dt>
            <dd className="shrink-0 whitespace-nowrap">{formatMoney(proposal.subtotalCents, proposal.currency, locale === 'fr' ? 'fr-CA' : 'en-CA')}</dd>
          </div>
          <p className="mt-[4px] text-xs text-neutral-500">{copy.subtotalNote}</p>
        </div>
      </dl>
    </section>
  );
}

function ConsultationChoiceButton({ choice, locale, disabled, onChoose }: {
  choice: { label: string; message: string; subtotalCents?: number; durationMinutes?: number; deltaCents?: number; currency?: string };
  locale: CustomerAssistantLocale;
  disabled: boolean;
  onChoose: (message: string) => void;
}) {
  const currency = choice.currency ?? 'CAD';
  const price = choice.deltaCents === 0
    ? customerAssistantCopy[locale].noExtraCharge
    : choice.deltaCents === undefined
      ? choice.subtotalCents === undefined ? null : formatMoney(choice.subtotalCents, currency, locale === 'fr' ? 'fr-CA' : 'en-CA')
      : `${choice.deltaCents > 0 ? '+' : choice.deltaCents < 0 ? '−' : ''}${formatMoney(Math.abs(choice.deltaCents), currency, locale === 'fr' ? 'fr-CA' : 'en-CA')}`;
  const subtotal = choice.deltaCents !== undefined && choice.subtotalCents !== undefined ? `${customerAssistantCopy[locale].subtotal} ${formatMoney(choice.subtotalCents, currency, locale === 'fr' ? 'fr-CA' : 'en-CA')}` : null;
  const duration = choice.durationMinutes === undefined ? null : formatDuration(choice.durationMinutes);
  return (
    <button type="button" disabled={disabled} onClick={() => onChoose(choice.message)} className="min-h-11 rounded-2xl border border-neutral-300 bg-white px-4 py-2 text-left text-sm font-medium text-neutral-900 disabled:opacity-50">
      <span className="block">{choice.label}</span>
      {(price || duration) && <span className="mt-0.5 block text-xs font-normal text-neutral-600">{[price, subtotal, duration].filter(Boolean).join(' · ')}</span>}
    </button>
  );
}

function AssistantResult({ result, locale, loading, onOption, onHandoff }: { result: CustomerAssistantResult; locale: CustomerAssistantLocale; loading: boolean; onOption: (option: string) => void; onHandoff: (fingerprint: string) => void }) {
  const copy = customerAssistantCopy[locale];
  if (result.kind === 'proposal') {
    return (
      <div>
        <ProposalCard result={result} locale={locale} />
        <AcceptSelection fingerprint={result.proposal.fingerprint} locale={locale} disabled={loading} onAction={() => onHandoff(result.proposal.fingerprint)} />
      </div>
    );
  }
  if (result.kind === 'slots') {
    return (
      <div className="space-y-4">
        <section aria-label={copy.availability} className="rounded-2xl border border-black/10 bg-white p-4">
          <h3 className="font-semibold text-neutral-950">{copy.availability}</h3>
          <ul className="mt-2 space-y-1 text-sm text-neutral-700">{result.slots.map(slot => <li key={slot.startTime}>{formatAvailabilitySlot(slot.startTime, slot.time, result.timeZone, locale)}</li>)}</ul>
        </section>
        <ProposalCard result={{ kind: 'proposal', proposal: result.proposal }} locale={locale} />
        <AcceptSelection fingerprint={result.proposal.fingerprint} locale={locale} disabled={loading} onAction={() => onHandoff(result.proposal.fingerprint)} />
      </div>
    );
  }
  if (result.kind === 'date_prompt' || result.kind === 'slot_selected') {
    return (
      <div>
        <ProposalCard result={{ kind: 'proposal', proposal: result.proposal }} locale={locale} />
        <AcceptSelection fingerprint={result.proposal.fingerprint} locale={locale} disabled={loading} onAction={() => onHandoff(result.proposal.fingerprint)} />
      </div>
    );
  }
  if (result.kind === 'answer') {
    return (
      <section aria-live="polite" className="space-y-3">
        {result.options.length > 0 && <div className="flex flex-wrap gap-2">{result.options.map(option => <button key={option} type="button" disabled={loading} onClick={() => onOption(option)} className="min-h-11 rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50">{option}</button>)}</div>}
      </section>
    );
  }
  if (result.kind === 'clarification') {
    const choices = result.choices?.length
      ? result.choices
      : result.options.map(option => ({ label: option, message: option }));
    return (
      <section aria-live="polite">
        <div className="mt-3 flex flex-wrap gap-2">{choices.map(choice => <ConsultationChoiceButton key={`${choice.label}:${choice.message}`} choice={choice} locale={locale} disabled={loading} onChoose={onOption} />)}</div>
      </section>
    );
  }
  if (result.kind === 'unavailable') {
    return null;
  }
  return null;
}

export function CustomerAssistantPanel({ salonSlug, salonId, locale, campaignToken, onClose, visibleHeight }: CustomerAssistantPanelProps) {
  const router = useRouter();
  const params = useParams();
  const routeSalonSlug = typeof params?.slug === 'string' ? params.slug : null;
  const { applyAssistantHandoff, clearBookingState } = useBookingState(salonSlug);
  const copy = customerAssistantCopy[locale];
  const [conversation, setConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [welcomeQuickReplies, setWelcomeQuickReplies] = useState<string[]>([]);
  const [result, setResult] = useState<CustomerAssistantResult | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'network' | 'token' | 'stale' | null>(null);
  const [storageScope, setStorageScope] = useState<StorageScope | null>(null);
  const retryMessage = useRef<string | null>(null);
  const [legacyStatus, setLegacyStatus] = useState<CustomerBookingStatus | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const restoreComposerFocus = useRef(false);
  const storageScopeRef = useRef<StorageScope | null>(null);
  const scopeGenerationRef = useRef(0);
  const createSession = async (generation = scopeGenerationRef.current) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint(salonSlug)}/session`, campaignToken
        ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ campaignToken }) }
        : { method: 'POST' });
      const data = await response.json() as { conversation?: unknown; salon?: { name?: unknown } };
      if (!response.ok || typeof data.conversation !== 'string' || data.conversation.length === 0) {
        throw new Error('invalid session response');
      }
      if (generation !== scopeGenerationRef.current) {
        return;
      }
      setConversation(data.conversation);
      if (typeof data.salon?.name === 'string' && data.salon.name.trim()) {
        setMessages([{ id: Date.now(), role: 'assistant', message: copy.welcome(data.salon.name.trim()) }]);
        setWelcomeQuickReplies([...copy.welcomeQuickReplies]);
      }
    } catch {
      if (generation === scopeGenerationRef.current) {
        setError('network');
      }
    } finally {
      if (generation === scopeGenerationRef.current) {
        setLoading(false);
      }
    }
  };
  useEffect(() => {
    let cancelled = false;
    const generation = scopeGenerationRef.current + 1;
    scopeGenerationRef.current = generation;
    storageScopeRef.current = null;
    inFlight.current = false;
    setStorageScope(null);
    setConversation(null);
    setMessages([]);
    setWelcomeQuickReplies([]);
    setResult(null);
    setError(null);
    setLoading(false);
    void (async () => {
      const binding = campaignToken ? await campaignStorageBinding(campaignToken) : null;
      const scope: StorageScope = campaignToken
        ? binding ? { binding, persist: true } : { binding: null, persist: false }
        : { binding: null, persist: true };
      if (cancelled) {
        return;
      }
      storageScopeRef.current = scope;
      setStorageScope(scope);
      const stored = readStoredConversation(salonSlug, scope);
      if (stored) {
        setConversation(stored.conversation);
        setMessages(stored.messages);
        setResult(stored.result);
        setWelcomeQuickReplies(stored.welcomeQuickReplies ?? []);
      } else {
        void createSession(generation);
      }
    })();
    return () => {
      cancelled = true;
      scopeGenerationRef.current += 1;
      inFlight.current = false;
    };
  // A campaign session is persisted only against its non-bearer digest. The
  // raw token never reaches browser storage, signed state, or the model.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignToken, salonSlug]);
  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) {
      transcript.scrollTop = transcript.scrollHeight;
    }
  }, [messages, result, loading, error]);
  useEffect(() => {
    if (conversation && storageScope && storageScopeRef.current === storageScope) {
      storeConversation(salonSlug, { version: 2, conversation, messages, result, ...(welcomeQuickReplies.length ? { welcomeQuickReplies } : {}) }, storageScope);
    }
  }, [conversation, messages, result, salonSlug, storageScope, welcomeQuickReplies]);
  useEffect(() => {
    if (!loading && restoreComposerFocus.current) {
      restoreComposerFocus.current = false;
      const input = inputRef.current;
      // React must first commit disabled=false. Do not steal focus if the
      // customer moved to another control while waiting for the response.
      if (input && !input.disabled && (document.activeElement === document.body || document.activeElement === input)) {
        input.focus();
      }
    }
  }, [loading, error]);
  const restart = () => {
    const generation = scopeGenerationRef.current + 1;
    scopeGenerationRef.current = generation;
    inFlight.current = false;
    retryMessage.current = null;
    if (storageScope) {
      clearStoredConversation(salonSlug, storageScope);
    }
    setConversation(null);
    setMessages([]);
    setWelcomeQuickReplies([]);
    setResult(null);
    void createSession(generation);
  };
  const send = async (message: string, kind?: 'quick_reply') => {
    const trimmed = message.trim();
    if (!trimmed || loading || inFlight.current || !conversation || error === 'token') {
      return;
    }
    const wasTyping = document.activeElement === inputRef.current;
    const generation = scopeGenerationRef.current;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    setInput('');
    retryMessage.current = trimmed;
    setMessages(current => [...current, { id: Date.now(), role: 'user' as const, message: trimmed, ...(kind ? { kind } : {}) }].slice(-MAX_DISPLAY_MESSAGES));
    setWelcomeQuickReplies([]);
    try {
      const response = await fetch(`${endpoint(salonSlug)}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversation, message: trimmed, locale }) });
      const data = await response.json() as CustomerAssistantResponse;
      if (!response.ok || !data.conversation || !data.result) {
        throw new Error('invalid chat response');
      }
      if (generation !== scopeGenerationRef.current) {
        return;
      }
      setConversation(data.conversation);
      setResult(data.result);
      retryMessage.current = null;
      const reply = assistantMessage(data.result, locale);
      if (reply) {
        setMessages(current => [...current, { id: Date.now() + 1, role: 'assistant' as const, message: reply }].slice(-MAX_DISPLAY_MESSAGES));
      }
      if (isConversationError(data.result)) {
        setError('token');
      } else if (data.result.kind === 'unavailable' && data.result.reason === 'stale_conversation') {
        retryMessage.current = trimmed;
        setError('stale');
      }
    } catch {
      if (generation === scopeGenerationRef.current) {
        setInput(trimmed);
        setError('network');
      }
    } finally {
      if (generation === scopeGenerationRef.current) {
        inFlight.current = false;
        setLoading(false);
        restoreComposerFocus.current = wasTyping;
      }
    }
  };
  const handoffToNormalBooking = async (fingerprint: string) => {
    if (loading || inFlight.current || !conversation || !salonId) {
      return;
    }
    const generation = scopeGenerationRef.current;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const legacy = readStoredOperation(salonId);
      if (!legacy && localStorage.getItem(operationStorageKey(salonId)) !== null) {
        throw new Error('legacy recovery state damaged');
      }
      if (legacy) {
        const recovered = await fetch(`/api/public/customer-booking/${encodeURIComponent(salonId)}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capability: legacy.capability }) });
        if (!recovered.ok) {
          throw new Error('legacy operation unavailable');
        }
        const status = await recovered.json() as CustomerBookingStatus;
        if (generation !== scopeGenerationRef.current) {
          return;
        }
        if (status.status !== 'not_created') {
          setLegacyStatus(status);
          return;
        }
        const existingFlow = readNormalConfirmHandoff(salonId);
        const response = await fetch(`${endpoint(salonSlug)}/handoff`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversation, fingerprint, locale, operationCapability: legacy.capability, ...(existingFlow ? { flowToken: existingFlow.flowToken } : {}) }) });
        const data = await response.json() as CustomerAssistantHandoffResponse;
        if (!response.ok || !data.conversation) {
          throw new Error('invalid legacy handoff response');
        }
        if (generation !== scopeGenerationRef.current) {
          return;
        }
        setConversation(data.conversation);
        if (data.result.kind !== 'handoff') {
          setResult(data.result);
          return;
        }
        if (!data.result.handoff.operation) {
          throw new Error('missing legacy handoff operation');
        }
        writeNormalConfirmHandoff(salonId, data.result.handoff.flow);
        adoptNormalBookingOperation(salonId, data.result.handoff.flow.flowToken, data.result.handoff.operation);
        if (applyAssistantHandoff(data.result.handoff.selection) === false) {
          throw new Error('booking state storage unavailable');
        }
        onClose();
        router.push(buildBookingUrl(`/${locale}/book/time`, { salonSlug, baseServiceId: data.result.handoff.selection.baseServiceId, selectedAddOns: data.result.handoff.selection.selectedAddOns, techId: null, date: data.result.handoff.datePreference?.date ?? null, campaignToken, bookingFlow: 'assistant' }, { routeSalonSlug, locale }));
        return;
      }
      const existingFlow = readNormalConfirmHandoff(salonId);
      const response = await fetch(`${endpoint(salonSlug)}/handoff`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversation, fingerprint, locale, ...(existingFlow ? { flowToken: existingFlow.flowToken } : {}) }) });
      const data = await response.json() as CustomerAssistantHandoffResponse;
      if (!response.ok || !data.conversation || !data.result) {
        throw new Error('invalid handoff response');
      }
      if (generation !== scopeGenerationRef.current) {
        return;
      }
      setConversation(data.conversation);
      if (data.result.kind !== 'handoff') {
        setResult(data.result);
        return;
      }
      writeNormalConfirmHandoff(salonId, data.result.handoff.flow);
      if (data.result.handoff.operation) {
        adoptNormalBookingOperation(salonId, data.result.handoff.flow.flowToken, data.result.handoff.operation);
      }
      if (applyAssistantHandoff(data.result.handoff.selection) === false) {
        throw new Error('booking state storage unavailable');
      }
      onClose();
      router.push(buildBookingUrl(`/${locale}/book/time`, { salonSlug, baseServiceId: data.result.handoff.selection.baseServiceId, selectedAddOns: data.result.handoff.selection.selectedAddOns, techId: null, date: data.result.handoff.datePreference?.date ?? null, campaignToken, bookingFlow: 'assistant' }, { routeSalonSlug, locale }));
    } catch {
      if (generation === scopeGenerationRef.current) {
        setError('network');
      }
    } finally {
      if (generation === scopeGenerationRef.current) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send(input);
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={copy.title} style={visibleHeight ? { height: `min(42rem, calc(${visibleHeight}px - 2rem))`, maxHeight: `calc(${visibleHeight}px - 2rem)` } : undefined} className="flex h-[min(42rem,calc(100dvh-1rem))] flex-col sm:max-h-[calc(100dvh-2rem)]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-[12px] border-b border-black/10 px-[16px] py-[12px] sm:px-5">
        <h2 className="min-w-0 flex-[1_1_12rem] text-lg font-semibold text-neutral-950">{copy.title}</h2>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" aria-label={locale === 'fr' ? 'Commencer une nouvelle conversation' : 'Start a new conversation'} onClick={restart} disabled={loading} className="min-h-11 whitespace-nowrap px-2 text-sm font-medium text-neutral-700 underline underline-offset-4 disabled:opacity-50">{copy.restart}</button>
          <button type="button" onClick={onClose} aria-label={copy.close} className="grid size-11 shrink-0 place-items-center rounded-full text-neutral-700 hover:bg-neutral-100"><X className="size-5" /></button>
        </div>
      </div>
      <div ref={transcriptRef} data-testid="customer-assistant-transcript" className="min-h-0 flex-1 space-y-[12px] overflow-y-auto overscroll-contain px-[16px] py-[12px] sm:px-5">
        {messages.map(message => message.role === 'user' && message.kind === 'quick_reply'
          ? (
              <p key={message.id} aria-label={`${copy.selectedAnswer}: ${message.message}`} className="ml-auto w-fit max-w-[85%] rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950">
                <span className="mb-0.5 block text-xs text-neutral-500">{copy.selectedAnswer}</span>
                {message.message}
              </p>
            )
          : <p key={message.id} aria-label={message.role === 'assistant' ? 'Assistant' : 'You'} className={message.role === 'user' ? 'ml-auto max-w-[85%] rounded-2xl bg-neutral-950 px-4 py-3 text-sm leading-6 text-white' : 'max-w-[85%] rounded-2xl bg-neutral-100 px-4 py-3 text-sm leading-6 text-neutral-800'}>{message.message}</p>)}
        {welcomeQuickReplies.length > 0 && messages.length === 1 && messages[0]?.role === 'assistant' && (
          <div aria-label={locale === 'fr' ? 'Réponses rapides' : 'Quick replies'} className="flex flex-wrap gap-2">
            {welcomeQuickReplies.map(reply => <button key={reply} type="button" disabled={loading} onClick={() => void send(reply, 'quick_reply')} className="min-h-11 rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50">{reply}</button>)}
          </div>
        )}
        {loading && <p role="status" className="text-sm text-neutral-600">{copy.loading}</p>}
        {error === 'network' && (
          <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
            <p>{copy.networkError}</p>
            <button type="button" onClick={() => conversation && retryMessage.current ? void send(retryMessage.current) : conversation ? inputRef.current?.focus() : void createSession()} className="mt-2 min-h-11 font-medium underline underline-offset-4">{copy.retry}</button>
          </div>
        )}
        {error === 'token' && (
          <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
            <p>{copy.tokenError}</p>
            <button type="button" onClick={restart} className="mt-2 min-h-11 font-medium underline underline-offset-4">{copy.restart}</button>
          </div>
        )}
        {error === 'stale' && retryMessage.current && (
          <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
            <p>{assistantMessage(result!, locale)}</p>
            <button type="button" onClick={() => void send(retryMessage.current!)} className="mt-2 min-h-11 font-medium underline underline-offset-4">{copy.retry}</button>
            <button type="button" onClick={restart} className="ml-4 mt-2 min-h-11 font-medium underline underline-offset-4">{copy.restart}</button>
          </div>
        )}
        {legacyStatus && (
          <div>
            <BookingStatusCard status={legacyStatus} locale={locale} />
            {salonId && canStartAnotherBooking(legacyStatus.status) && (
              <button
                type="button"
                className="mt-3 min-h-11 underline"
                onClick={() => {
                  try {
                    startAnotherBooking(salonId, salonSlug, legacyStatus.status);
                    clearBookingState();
                    setLegacyStatus(null);
                    restart();
                  } catch {
                    setError('network');
                  }
                }}
              >
                {locale === 'fr' ? 'Commencer une autre réservation' : 'Start another booking'}
              </button>
            )}
          </div>
        )}
        {result && <AssistantResult result={result} locale={locale} loading={loading} onOption={option => void send(option, 'quick_reply')} onHandoff={fingerprint => void handoffToNormalBooking(fingerprint)} />}
      </div>
      <form onSubmit={handleSubmit} className="shrink-0 border-t border-black/10 px-[16px] pb-[max(12px,env(safe-area-inset-bottom))] pt-[12px] sm:px-5">
        <label htmlFor="customer-assistant-message" className="sr-only">{copy.placeholder}</label>
        <div className="flex items-center gap-2">
          <input ref={inputRef} id="customer-assistant-message" value={input} onChange={event => setInput(event.target.value)} disabled={loading || !conversation || error === 'token' || error === 'stale'} maxLength={600} placeholder={result?.kind === 'clarification' ? copy.answerPlaceholder : messages.length ? copy.changePlaceholder : copy.placeholder} className="min-h-11 min-w-0 flex-1 rounded-xl border border-neutral-300 bg-white px-3 text-base text-neutral-950 placeholder:text-neutral-500 focus:border-neutral-950 focus:outline-none disabled:bg-neutral-100" />
          <button type="submit" disabled={loading || !conversation || !input.trim() || error === 'token'} className="grid size-11 shrink-0 place-items-center rounded-xl bg-neutral-950 text-white disabled:cursor-not-allowed disabled:opacity-45" aria-label={copy.send}><Send className="size-4" /></button>
        </div>
        <button type="button" onClick={onClose} className="mt-[12px] min-h-11 text-sm font-medium text-neutral-700 underline underline-offset-4">{copy.continueManually}</button>
      </form>
    </div>
  );
}

export function CustomerAssistantLauncher({ salonSlug, salonId, locale, campaignToken }: CustomerAssistantLauncherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const copy = customerAssistantCopy[locale];
  const viewport = useCustomerViewport();
  const viewportStyle = viewport.height > 0 ? { top: viewport.top, height: viewport.height } : undefined;
  return (
    <>
      <div aria-hidden="true" data-testid="customer-assistant-launcher-clearance" style={{ height: 'calc(var(--service-sticky-footer-clearance, env(safe-area-inset-bottom, 0px)) + 6rem + 24px)' }} />
      {!viewport.keyboardOpen && <button type="button" aria-label={locale === 'fr' ? 'M’aider à choisir et réserver' : 'Help me choose & book'} onClick={() => setIsOpen(true)} style={{ bottom: 'calc(var(--service-sticky-footer-clearance, env(safe-area-inset-bottom, 0px)) + 12px)' }} className="fixed right-4 z-40 min-h-11 max-w-[calc(100vw-2rem)] rounded-xl border border-neutral-900 bg-white px-4 py-2 text-sm font-semibold text-neutral-950 shadow-lg transition hover:bg-neutral-50">{copy.launcher}</button>}
      <DialogShell isOpen={isOpen} onClose={() => setIsOpen(false)} maxWidthClassName="max-w-xl" alignClassName="items-end p-0 sm:items-center sm:p-4" contentClassName="max-h-[calc(100dvh-0.5rem)] touch-pan-y overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl" overlayStyle={viewportStyle}>{isOpen && <CustomerAssistantPanel salonId={salonId} salonSlug={salonSlug} locale={locale} campaignToken={campaignToken} onClose={() => setIsOpen(false)} visibleHeight={viewport.height || undefined} />}</DialogShell>
    </>
  );
}
