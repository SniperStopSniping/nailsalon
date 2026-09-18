'use client';

import { Send, X } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import { DialogShell } from '@/components/ui/dialog-shell';
import type { BookingSmsConsentInput, BookingSmsMode } from '@/libs/bookingSmsConsent';
import type { CustomerBookingOperationReference, CustomerBookingStatus } from '@/libs/customerAssistant/bookingOperationContracts';
import type { CustomerAssistantAction, CustomerAssistantLocale, CustomerAssistantResponse, CustomerAssistantResult } from '@/libs/customerAssistant/contracts';
import { customerBookingRecoveryUrl } from '@/libs/customerAssistant/recoveryUrl';
import type { CustomerReviewResponse } from '@/libs/customerAssistant/reviewContracts';
import { formatMoney } from '@/libs/formatMoney';
import { formatDuration } from '@/utils/Helpers';

import type { CustomerContactValues } from './ContactDetailsForm';
import { ContactDetailsForm } from './ContactDetailsForm';
import { customerAssistantCopy } from './copy';
import { CustomerBookingReviewCard } from './CustomerBookingReviewCard';
import { AcceptSelection, ScheduleCards } from './ScheduleCards';

type CustomerAssistantLauncherProps = {
  salonSlug: string;
  salonId?: string;
  smsMode?: BookingSmsMode;
  locale: CustomerAssistantLocale;
};

type CustomerAssistantPanelProps = CustomerAssistantLauncherProps & {
  onClose: () => void;
};

type DisplayMessage = { id: number; message: string };

const storageKey = (salonSlug: string) => `luster.customer-assistant.conversation.${salonSlug}`;
const operationStorageKey = (salonId: string) => `luster.customer-booking.operation.${salonId}`;
const endpoint = (salonSlug: string) => `/api/public/customer-assistant/${encodeURIComponent(salonSlug)}`;
const MAX_DISPLAY_MESSAGES = 12;

type StoredOperation = CustomerBookingOperationReference & { version: 1; salonId: string };

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

function storeOperation(salonId: string, operation: CustomerBookingOperationReference): void {
  const stored: StoredOperation = { version: 1, salonId, ...operation };
  localStorage.setItem(operationStorageKey(salonId), JSON.stringify(stored));
  const verified = readStoredOperation(salonId);
  if (!verified || verified.capability !== operation.capability || verified.revision !== operation.revision || verified.fingerprint !== operation.fingerprint || verified.expiresAt !== operation.expiresAt) {
    throw new Error('operation storage could not be verified');
  }
}

function BookingStatusCard({ status, locale, onResume, onManage }: { status: CustomerBookingStatus; locale: CustomerAssistantLocale; onResume?: () => void; onManage?: () => void }) {
  const message: Record<CustomerBookingStatus['status'], Record<CustomerAssistantLocale, string>> = {
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
      <p className="mt-2 text-sm text-neutral-700">{status.status === 'not_created' && status.lastFailure === 'existing_appointment' ? (locale === 'fr' ? 'Une réservation existante empêche une nouvelle réservation. Contactez le salon pour obtenir de l’aide.' : 'An existing booking prevents another booking. Contact the salon for help.') : status.status === 'not_created' && status.lastFailure === 'contact_conflict' ? (locale === 'fr' ? 'Ces coordonnées ne peuvent pas être utilisées ensemble. Vérifiez-les ou contactez le salon.' : 'These contact details cannot be used together. Check them or contact the salon.') : message[status.status][locale]}</p>
      {status.payment && (
        <p className="mt-2 text-sm font-medium text-neutral-950">
          {formatMoney(status.payment.amountCents, status.payment.currency, locale === 'fr' ? 'fr-CA' : 'en-CA')}
          {' '}
          {locale === 'fr' ? 'à payer' : 'due'}
        </p>
      )}
      {status.appointment && (
        <dl className="mt-2 space-y-1 text-sm text-neutral-700">
          <div className="flex justify-between gap-3">
            <dt>{locale === 'fr' ? 'Rendez-vous' : 'Appointment'}</dt>
            <dd className="text-right font-medium text-neutral-950">{new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: status.review.timeZone }).format(new Date(status.appointment.startTime))}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>{locale === 'fr' ? 'Durée' : 'Duration'}</dt>
            <dd className="font-medium text-neutral-950">{formatDuration(status.appointment.durationMinutes)}</dd>
          </div>
          {status.appointment.technicianName && (
            <div className="flex justify-between gap-3">
              <dt>{locale === 'fr' ? 'Technicienne' : 'Technician'}</dt>
              <dd className="text-right font-medium text-neutral-950">{status.appointment.technicianName}</dd>
            </div>
          )}
        </dl>
      )}
      {status.appointment && <p className="mt-2 text-sm text-neutral-700">{status.appointment.reminderState === 'enabled' ? (locale === 'fr' ? 'Rappels texto activés.' : 'Text reminders are on.') : status.appointment.reminderState === 'opted_out' ? (locale === 'fr' ? 'Les textos sont désactivés par STOP.' : 'Texts remain stopped.') : (locale === 'fr' ? 'Rappels texto désactivés.' : 'Text reminders are off.')}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {status.status === 'payment_required' && status.payment?.canResume && <button type="button" onClick={onResume} className="min-h-11 rounded-xl bg-neutral-950 px-4 py-2 text-sm font-semibold text-white">{locale === 'fr' ? 'Reprendre le paiement' : 'Resume payment'}</button>}
        {status.appointment && <button type="button" onClick={onManage} className="min-h-11 rounded-xl border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-950">{locale === 'fr' ? 'Gérer la réservation' : 'Manage booking'}</button>}
      </div>
    </section>
  );
}

export function CustomerBookingRecovery({ salonId, locale }: { salonId: string; locale: CustomerAssistantLocale }) {
  const [status, setStatus] = useState<CustomerBookingStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
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
        setUnavailable(true);
        return;
      }
      const url = customerBookingRecoveryUrl(data.url, action);
      if (url) {
        window.location.assign(url);
      } else {
        setUnavailable(true);
      }
    } catch {
      setUnavailable(true);
    }
  };
  useEffect(() => {
    const operation = readStoredOperation(salonId);
    if (!operation) {
      return;
    }
    void fetch(`/api/public/customer-booking/${encodeURIComponent(salonId)}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capability: operation.capability }) })
      .then(async response => response.ok ? response.json() as Promise<CustomerBookingStatus> : Promise.reject(new Error('status failed')))
      .then(setStatus).catch(() => setUnavailable(true));
  }, [salonId]);
  if (!status && !unavailable) {
    return null;
  }
  return status ? <div className="mx-auto max-w-xl px-4 pt-4"><BookingStatusCard status={status} locale={locale} onResume={() => void runAction('resume')} onManage={() => void runAction('manage')} /></div> : <div role="status" className="mx-auto max-w-xl px-4 pt-4 text-sm text-neutral-700">{locale === 'fr' ? 'Nous ne pouvons pas vérifier cette réservation pour le moment.' : 'We could not check this booking yet. Please try again.'}</div>;
}

function readStoredConversation(salonSlug: string): string | null {
  try {
    return sessionStorage.getItem(storageKey(salonSlug));
  } catch {
    return null;
  }
}

function storeConversation(salonSlug: string, conversation: string): void {
  try {
    sessionStorage.setItem(storageKey(salonSlug), conversation);
  } catch {
    // Storage can be disabled in a private or embedded browser. The panel keeps
    // the signed conversation in memory for this visit.
  }
}

function clearStoredConversation(salonSlug: string): void {
  try {
    sessionStorage.removeItem(storageKey(salonSlug));
  } catch {
    // The in-memory conversation is cleared by the caller.
  }
}

function isConversationError(result: CustomerReviewResponse['result']): boolean {
  return result.kind === 'unavailable'
    && (result.reason === 'conversation_used' || result.reason === 'invalid_conversation');
}

function ProposalCard({ result, locale }: { result: Extract<CustomerAssistantResult, { kind: 'proposal' }>; locale: CustomerAssistantLocale }) {
  const copy = customerAssistantCopy[locale];
  const { proposal } = result;

  return (
    <section aria-label={copy.proposal} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
      <h3 className="text-base font-semibold text-neutral-950">{copy.proposal}</h3>
      <dl className="mt-3 space-y-3 text-sm text-neutral-700">
        <div className="flex items-start justify-between gap-4">
          <dt>{copy.services}</dt>
          <dd className="text-right font-medium text-neutral-950">{proposal.service.name}</dd>
        </div>
        {proposal.addOns.length > 0 && (
          <div className="flex items-start justify-between gap-4">
            <dt>{copy.addOns}</dt>
            <dd className="space-y-1 text-right font-medium text-neutral-950">
              {proposal.addOns.map(addOn => (
                <div key={addOn.id}>
                  {addOn.quantity > 1 ? `${addOn.quantity} × ` : ''}
                  {addOn.name}
                </div>
              ))}
            </dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-4">
          <dt>{copy.duration}</dt>
          <dd className="font-medium text-neutral-950">{formatDuration(proposal.durationMinutes)}</dd>
        </div>
        <div className="border-t border-black/10 pt-3">
          <div className="flex items-center justify-between gap-4 text-base font-semibold text-neutral-950">
            <dt>{copy.subtotal}</dt>
            <dd>{formatMoney(proposal.subtotalCents, proposal.currency, locale === 'fr' ? 'fr-CA' : 'en-CA')}</dd>
          </div>
          <p className="mt-1 text-xs text-neutral-500">{copy.subtotalNote}</p>
        </div>
      </dl>
    </section>
  );
}

function AssistantResult({ result, locale, loading, onOption, onAction, contact, onContactChange, onReview, reviewDirty, smsMode, smsConsent, onSmsChange, onConfirm, status, onResume, onManage }: { result: CustomerReviewResponse['result']; locale: CustomerAssistantLocale; loading: boolean; onOption: (option: string) => void; onAction: (action: CustomerAssistantAction) => void; contact: CustomerContactValues; onContactChange: (contact: CustomerContactValues) => void; onReview: () => void; reviewDirty: boolean; smsMode: BookingSmsMode; smsConsent?: BookingSmsConsentInput; onSmsChange: (consent: BookingSmsConsentInput) => void; onConfirm: (policyAccepted: boolean) => void; status: CustomerBookingStatus | null; onResume: () => void; onManage: () => void }) {
  const copy = customerAssistantCopy[locale];
  if (status) {
    return <BookingStatusCard status={status} locale={locale} onResume={onResume} onManage={onManage} />;
  }
  if (result.kind === 'review_prepared' || result.kind === 'booking_review') {
    return (
      <div className="space-y-4">
        {reviewDirty ? <p role="status" className="text-sm text-amber-950">{copy.contactChanged}</p> : <CustomerBookingReviewCard review={result.review} locale={locale} />}
        <ContactDetailsForm smsMode={smsMode} smsConsent={smsConsent} onSmsChange={onSmsChange} locale={locale} contact={contact} disabled={loading} onChange={onContactChange} onReview={onReview} />
        {result.kind === 'booking_review' && !reviewDirty && (
          <BookingConfirmControl disabled={loading || Date.parse(result.review.expiresAt) <= Date.now()} policy={result.review.bookingPolicy} locale={locale} onConfirm={onConfirm} />
        )}
      </div>
    );
  }
  if (result.kind === 'proposal') {
    return (
      <div>
        <ProposalCard result={result} locale={locale} />
        <AcceptSelection fingerprint={result.proposal.fingerprint} locale={locale} disabled={loading} onAction={onAction} />
      </div>
    );
  }
  if (result.kind === 'date_prompt' || result.kind === 'slots' || result.kind === 'slot_selected') {
    return (
      <div className="space-y-4">
        <ScheduleCards result={result} locale={locale} disabled={loading} onAction={onAction} />
        {result.kind === 'slot_selected' && <ContactDetailsForm smsMode={smsMode} smsConsent={smsConsent} onSmsChange={onSmsChange} locale={locale} contact={contact} disabled={loading} onChange={onContactChange} onReview={onReview} />}
      </div>
    );
  }
  if (result.kind === 'clarification') {
    return (
      <section aria-live="polite">
        <p className="text-sm font-medium text-neutral-900">{copy.questions[result.question]}</p>
        <div className="mt-3 flex flex-wrap gap-2">{result.options.map(option => <button key={option} type="button" disabled={loading} onClick={() => onOption(option)} className="min-h-11 rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 transition hover:border-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50">{option}</button>)}</div>
      </section>
    );
  }
  return <p role="status" className="rounded-xl bg-neutral-100 p-3 text-sm text-neutral-700">{copy.unavailable[result.reason]}</p>;
}

function BookingConfirmControl({ disabled, policy, locale, onConfirm }: { disabled: boolean; policy: { required: boolean; acknowledgmentText?: string }; locale: CustomerAssistantLocale; onConfirm: (policyAccepted: boolean) => void }) {
  const [accepted, setAccepted] = useState(false);
  return (
    <section className="space-y-3 rounded-2xl border border-black/10 bg-white p-4">
      {policy.required && (
        <label className="flex min-h-11 items-center gap-3 text-sm text-neutral-950">
          <input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} disabled={disabled} className="size-4 accent-neutral-950" />
          {policy.acknowledgmentText}
        </label>
      )}
      <button type="button" onClick={() => onConfirm(accepted)} disabled={disabled || (policy.required && !accepted)} className="min-h-11 w-full rounded-xl bg-neutral-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{locale === 'fr' ? 'Confirmer la réservation' : 'Confirm booking'}</button>
    </section>
  );
}

export function CustomerAssistantPanel({ salonSlug, salonId, locale, onClose, smsMode = 'default_on' }: CustomerAssistantPanelProps) {
  const copy = customerAssistantCopy[locale];
  const [conversation, setConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [result, setResult] = useState<CustomerReviewResponse['result'] | null>(null);
  const [input, setInput] = useState('');
  const [contact, setContact] = useState<CustomerContactValues>({ name: '', email: '', phone: '' });
  const [smsConsent, setSmsConsent] = useState<BookingSmsConsentInput | undefined>(() => smsMode === 'disabled' ? undefined : { granted: smsMode === 'default_on', selection: smsMode, wordingVersion: 'booking-sms-reminders-v1' });
  const [operationRevision, setOperationRevision] = useState(0);
  const [bookingStatus, setBookingStatus] = useState<CustomerBookingStatus | null>(null);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'network' | 'token' | 'storage' | 'unresolved' | null>(null);
  const [confirmationUnresolved, setConfirmationUnresolved] = useState(false);
  const [lostSlotNotice, setLostSlotNotice] = useState(false);
  const [contactConflict, setContactConflict] = useState(false);
  const [recoveredOriginalOperation, setRecoveredOriginalOperation] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const confirmedPolicyAccepted = useRef(false);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) {
      const reviewCard = transcript.querySelector('[data-customer-review]');
      if (result?.kind === 'review_prepared' && reviewCard && !loading) {
        reviewCard.scrollIntoView?.({ block: 'start' });
      } else {
        transcript.scrollTop = transcript.scrollHeight;
      }
    }
  }, [messages, result, loading, error]);

  const createSession = async () => {
    if (confirmationUnresolved) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint(salonSlug)}/session`, { method: 'POST' });
      if (!response.ok) {
        throw new Error('session request failed');
      }
      const data = await response.json() as { conversation?: unknown };
      if (typeof data.conversation !== 'string' || data.conversation.length === 0) {
        throw new Error('invalid session response');
      }
      setConversation(data.conversation);
      storeConversation(salonSlug, data.conversation);
    } catch {
      setError('network');
    } finally {
      setLoading(false);
    }
  };

  const restart = () => {
    if (confirmationUnresolved) {
      return;
    }
    clearStoredConversation(salonSlug);
    setConversation(null);
    setMessages([]);
    setResult(null);
    setContact({ name: '', email: '', phone: '' });
    setReviewDirty(false);
    void createSession();
  };

  const send = async (message: string) => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || loading || inFlight.current || !conversation || confirmationUnresolved) {
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError(null);
    setInput('');
    setMessages(current => [...current, { id: Date.now(), message: trimmedMessage }].slice(-MAX_DISPLAY_MESSAGES));
    try {
      const response = await fetch(`${endpoint(salonSlug)}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversation, message: trimmedMessage, locale }),
      });
      if (!response.ok) {
        throw new Error('chat request failed');
      }
      const data = await response.json() as CustomerAssistantResponse;
      if (!data.conversation || !data.result) {
        throw new Error('invalid chat response');
      }
      setConversation(data.conversation);
      storeConversation(salonSlug, data.conversation);
      setResult(data.result);
      setReviewDirty(false);
      if (isConversationError(data.result)) {
        setError('token');
      }
    } catch {
      setInput(trimmedMessage);
      setError('network');
    } finally {
      inFlight.current = false;
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const act = async (action: CustomerAssistantAction, internal = false, recoveredConversation?: string) => {
    const actionConversation = recoveredConversation ?? conversation;
    if ((!internal && (loading || inFlight.current || confirmationUnresolved)) || !actionConversation || error === 'token') {
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint(salonSlug)}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversation: actionConversation, ...action }),
      });
      if (!response.ok) {
        throw new Error('action request failed');
      }
      const data = await response.json() as CustomerAssistantResponse;
      if (!data.conversation || !data.result) {
        throw new Error('invalid action response');
      }
      setConversation(data.conversation);
      storeConversation(salonSlug, data.conversation);
      setResult(data.result);
      setReviewDirty(false);
      if (isConversationError(data.result)) {
        setError('token');
      }
    } catch {
      setError('network');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const restoreBookingStatus = async (status: CustomerBookingStatus, storedConversation: string | null) => {
    setError(null);
    setContactConflict(status.lastFailure === 'contact_conflict');
    if (status.status === 'not_created' && status.lastFailure !== 'existing_appointment') {
      // The server still owns this operation. Recollect contact details in
      // memory, then retry this exact capability; never create a session.
      setOperationRevision(status.operation.revision);
      setResult({ kind: 'booking_review', review: status.review, operation: status.operation });
      setBookingStatus(null);
      setRecoveredOriginalOperation(true);
      setSmsConsent(status.review.reminders.selection === null ? undefined : { granted: status.review.reminders.requestedEnabled, selection: status.review.reminders.selection, wordingVersion: 'booking-sms-reminders-v1' });
      setReviewDirty(status.lastFailure !== null || Date.parse(status.review.expiresAt) <= Date.now());
      setConfirmationUnresolved(false);
      if (status.lastFailure === 'slot_unavailable') {
        setLostSlotNotice(true);
        if (storedConversation) {
          await act({ action: 'choose_date', date: status.review.date }, true, storedConversation);
        }
      }
      return;
    }
    setBookingStatus(status);
    setConfirmationUnresolved(false);
  };

  useEffect(() => {
    const storedConversation = readStoredConversation(salonSlug);
    if (storedConversation) {
      setConversation(storedConversation);
    }
    const storedOperation = salonId ? readStoredOperation(salonId) : null;
    if (storedOperation && salonId) {
      setConfirmationUnresolved(true);
      void fetch(`/api/public/customer-booking/${encodeURIComponent(salonId)}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capability: storedOperation.capability }),
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error('status request failed');
        }
        const status = await response.json() as CustomerBookingStatus;
        if (status.kind !== 'booking_status' || status.operation.capability !== storedOperation.capability) {
          throw new Error('invalid status response');
        }
        storeOperation(salonId, status.operation);
        await restoreBookingStatus(status, storedConversation);
      }).catch(() => setError('unresolved'));
      return;
    }
    if (storedConversation) {
      return;
    }
    void createSession();
  // A panel instance is intentionally scoped to this one salon.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salonId, salonSlug]);

  const review = async () => {
    if (loading || inFlight.current || !conversation || error === 'token' || confirmationUnresolved) {
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint(salonSlug)}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversation, contact, smsConsent, expectedRevision: operationRevision }),
      });
      if (!response.ok) {
        throw new Error('review request failed');
      }
      const data = await response.json() as CustomerReviewResponse;
      if (!data.conversation || !data.result) {
        throw new Error('invalid review response');
      }
      if (data.result.kind === 'booking_review') {
        setOperationRevision(data.result.operation.revision);
      }
      setConversation(data.conversation);
      storeConversation(salonSlug, data.conversation);
      setResult(data.result);
      setReviewDirty(false);
      if (isConversationError(data.result)) {
        setError('token');
      }
    } catch {
      setError('network');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const readBookingStatus = async (operation: CustomerBookingOperationReference): Promise<CustomerBookingStatus> => {
    if (!salonId) {
      throw new Error('missing salon id');
    }
    const response = await fetch(`/api/public/customer-booking/${encodeURIComponent(salonId)}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capability: operation.capability }),
    });
    if (!response.ok) {
      throw new Error('status request failed');
    }
    const status = await response.json() as CustomerBookingStatus;
    if (status.kind !== 'booking_status' || status.operation.capability !== operation.capability) {
      throw new Error('invalid status response');
    }
    storeOperation(salonId, status.operation);
    return status;
  };

  const acceptBookingStatus = async (status: CustomerBookingStatus) => {
    setError(null);
    setContactConflict(status.lastFailure === 'contact_conflict');
    if (status.status === 'not_created' && (status.lastFailure === 'review_changed' || status.lastFailure === 'contact_conflict')) {
      setBookingStatus(null);
      setReviewDirty(true);
      setConfirmationUnresolved(false);
      return;
    }
    if (status.status === 'not_created' && status.lastFailure === 'slot_unavailable' && result?.kind === 'booking_review') {
      setBookingStatus(null);
      setLostSlotNotice(true);
      setConfirmationUnresolved(false);
      inFlight.current = false;
      setLoading(false);
      await act({ action: 'choose_date', date: result.review.date }, true);
      return;
    }
    if (status.status === 'not_created' && status.lastFailure === null) {
      setBookingStatus(null);
      setConfirmationUnresolved(false);
      return;
    }
    setBookingStatus(status);
  };

  const confirmBooking = async (policyAccepted: boolean, recoveredRetry = false) => {
    if ((!recoveredRetry && (loading || confirmationUnresolved)) || inFlight.current || result?.kind !== 'booking_review' || reviewDirty) {
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError(null);
    const operation = result.operation;
    confirmedPolicyAccepted.current = policyAccepted;
    setRecoveredOriginalOperation(false);
    try {
      if (!salonId) {
        throw new Error('missing salon id');
      }
      storeOperation(salonId, operation);
    } catch {
      setError('storage');
      inFlight.current = false;
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(`${endpoint(salonSlug)}/booking/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'confirm_booking', capability: operation.capability, revision: operation.revision, fingerprint: operation.fingerprint, contact, policyAccepted }),
      });
      if (!response.ok) {
        throw new Error('confirm request failed');
      }
      const status = await response.json() as CustomerBookingStatus;
      if (status.kind !== 'booking_status') {
        throw new Error('invalid confirm response');
      }
      if (salonId) {
        storeOperation(salonId, status.operation);
      }
      await acceptBookingStatus(status);
    } catch {
      try {
        await acceptBookingStatus(await readBookingStatus(operation));
        setConfirmationUnresolved(false);
      } catch {
        setConfirmationUnresolved(true);
        setError('unresolved');
      }
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const retryConfirmation = async () => {
    if (loading || inFlight.current || reviewDirty) {
      return;
    }
    const operation = result?.kind === 'booking_review' ? result.operation : salonId ? readStoredOperation(salonId) : null;
    if (!operation) {
      return;
    }
    inFlight.current = true;
    setLoading(true);
    try {
      const current = await readBookingStatus(operation);
      if (result?.kind !== 'booking_review') {
        await restoreBookingStatus(current, readStoredConversation(salonSlug));
        return;
      }
      if (current.status !== 'not_created' || current.lastFailure !== null) {
        await acceptBookingStatus(current);
        setConfirmationUnresolved(false);
        return;
      }
      setConfirmationUnresolved(false);
      inFlight.current = false;
      setLoading(false);
      await confirmBooking(confirmedPolicyAccepted.current, true);
    } catch {
      setConfirmationUnresolved(true);
      setError('unresolved');
    } finally {
      if (inFlight.current) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  };

  const runBookingAction = async (action: 'resume' | 'manage') => {
    if (!salonId || !bookingStatus) {
      return;
    }
    try {
      const response = await fetch(`/api/public/customer-booking/${encodeURIComponent(salonId)}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capability: bookingStatus.operation.capability }) });
      if (action === 'resume' && response.status === 409) {
        await acceptBookingStatus(await readBookingStatus(bookingStatus.operation));
        return;
      }
      const data = await response.json().catch(() => null) as { url?: unknown } | null;
      if (typeof data?.url !== 'string') {
        throw new TypeError('missing action url');
      }
      const url = customerBookingRecoveryUrl(data.url, action);
      if (!url) {
        throw new Error('untrusted action url');
      }
      window.location.assign(url);
    } catch {
      setError('network');
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send(input);
  };

  return (
    <div role="dialog" aria-modal="true" className="flex h-[min(42rem,calc(100dvh-1rem))] flex-col sm:max-h-[calc(100dvh-2rem)]" aria-label={copy.title}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/10 p-4 sm:px-5">
        <h2 className="text-lg font-semibold text-neutral-950">{copy.title}</h2>
        <button type="button" onClick={onClose} aria-label={copy.close} className="grid size-11 shrink-0 place-items-center rounded-full text-neutral-700 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"><X className="size-5" /></button>
      </div>
      <div ref={transcriptRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">
        <p className="rounded-2xl bg-neutral-100 px-4 py-3 text-sm leading-6 text-neutral-700">{copy.introduction}</p>
        {messages.map(message => <p key={message.id} className="ml-auto max-w-[85%] rounded-2xl bg-neutral-950 px-4 py-3 text-sm leading-6 text-white">{message.message}</p>)}
        {loading && <p role="status" className="text-sm text-neutral-600">{copy.loading}</p>}
        {error === 'network' && (
          <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
            <p>{copy.networkError}</p>
            <button type="button" onClick={() => conversation ? inputRef.current?.focus() : void createSession()} className="mt-2 min-h-11 font-medium underline underline-offset-4">{copy.retry}</button>
          </div>
        )}
        {error === 'storage' && <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{locale === 'fr' ? 'Nous ne pouvons pas enregistrer la récupération de cette réservation. La confirmation n’a pas été envoyée.' : 'We could not save recovery for this booking. The confirmation was not sent.'}</div>}
        {error === 'unresolved' && (
          <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
            <p>{locale === 'fr' ? 'Nous ne pouvons pas encore confirmer l’état de cette réservation. Ne créez pas une nouvelle réservation.' : 'We could not confirm this booking’s status yet. Do not create a new booking.'}</p>
            <button type="button" onClick={() => void retryConfirmation()} className="mt-2 min-h-11 font-medium underline underline-offset-4">{locale === 'fr' ? 'Vérifier l’état de la réservation' : 'Check booking status'}</button>
          </div>
        )}
        {contactConflict && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{locale === 'fr' ? 'Ces coordonnées ne peuvent pas être utilisées ensemble. Vérifiez-les ou contactez le salon.' : 'These contact details cannot be used together. Check them or contact the salon.'}</p>}
        {lostSlotNotice && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{locale === 'fr' ? 'Cette heure n’est plus disponible. Choisissez une autre heure.' : 'That time is no longer available. Choose another time.'}</p>}
        {error === 'token' && (
          <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
            <p>{copy.tokenError}</p>
            <button type="button" onClick={restart} className="mt-2 min-h-11 font-medium underline underline-offset-4">{copy.restart}</button>
          </div>
        )}
        {bookingStatus && !result && <BookingStatusCard status={bookingStatus} locale={locale} onResume={() => void runBookingAction('resume')} onManage={() => void runBookingAction('manage')} />}
        {result && (
          <AssistantResult
            result={result}
            locale={locale}
            loading={loading}
            onOption={option => void send(option)}
            onAction={action => void act(action)}
            contact={contact}
            onContactChange={(updated) => {
              setContact(updated);
              if (!recoveredOriginalOperation) {
                setReviewDirty(true);
              }
            }}
            onReview={() => void review()}
            reviewDirty={reviewDirty}
            smsMode={smsMode}
            smsConsent={smsConsent}
            onSmsChange={(updated) => {
              setSmsConsent(updated);
              setReviewDirty(true);
            }}
            onConfirm={policyAccepted => void confirmBooking(policyAccepted)}
            status={bookingStatus}
            onResume={() => void runBookingAction('resume')}
            onManage={() => void runBookingAction('manage')}
          />
        )}
      </div>
      <form onSubmit={handleSubmit} className="shrink-0 border-t border-black/10 p-4 sm:px-5">
        <label htmlFor="customer-assistant-message" className="sr-only">{copy.placeholder}</label>
        <div className="flex items-center gap-2">
          <input ref={inputRef} id="customer-assistant-message" value={input} onChange={event => setInput(event.target.value)} disabled={loading || !conversation || error === 'token' || confirmationUnresolved || Boolean(bookingStatus)} maxLength={600} placeholder={copy.placeholder} className="min-h-11 min-w-0 flex-1 rounded-xl border border-neutral-300 bg-white px-3 text-base text-neutral-950 placeholder:text-neutral-500 focus:border-neutral-950 focus:outline-none disabled:bg-neutral-100" />
          <button type="submit" disabled={loading || !conversation || !input.trim() || error === 'token' || confirmationUnresolved || Boolean(bookingStatus)} className="grid size-11 shrink-0 place-items-center rounded-xl bg-neutral-950 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-45" aria-label={copy.send}><Send className="size-4" /></button>
        </div>
        <button type="button" onClick={onClose} className="mt-3 min-h-11 text-sm font-medium text-neutral-700 underline underline-offset-4">{copy.continueManually}</button>
      </form>
    </div>
  );
}

export function CustomerAssistantLauncher({ salonSlug, salonId, locale, smsMode = 'default_on' }: CustomerAssistantLauncherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const copy = customerAssistantCopy[locale];
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)} className="min-h-11 rounded-xl border border-neutral-900 bg-white px-4 py-2 text-sm font-semibold text-neutral-950 shadow-sm transition hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950">{copy.launcher}</button>
      <DialogShell isOpen={isOpen} onClose={() => setIsOpen(false)} maxWidthClassName="max-w-xl" alignClassName="items-end p-0 sm:items-center sm:p-4" contentClassName="max-h-[calc(100dvh-0.5rem)] touch-pan-y overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl"><CustomerAssistantPanel smsMode={smsMode} salonId={salonId} salonSlug={salonSlug} locale={locale} onClose={() => setIsOpen(false)} /></DialogShell>
    </>
  );
}
