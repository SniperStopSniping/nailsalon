'use client';

import { Send, X } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import { DialogShell } from '@/components/ui/dialog-shell';
import type { CustomerAssistantAction, CustomerAssistantLocale, CustomerAssistantResponse, CustomerAssistantResult } from '@/libs/customerAssistant/contracts';
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
  locale: CustomerAssistantLocale;
};

type CustomerAssistantPanelProps = CustomerAssistantLauncherProps & {
  onClose: () => void;
};

type DisplayMessage = { id: number; message: string };

const storageKey = (salonSlug: string) => `luster.customer-assistant.conversation.${salonSlug}`;
const endpoint = (salonSlug: string) => `/api/public/customer-assistant/${encodeURIComponent(salonSlug)}`;
const MAX_DISPLAY_MESSAGES = 12;

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

function AssistantResult({ result, locale, loading, onOption, onAction, contact, onContactChange, onReview, reviewDirty }: { result: CustomerReviewResponse['result']; locale: CustomerAssistantLocale; loading: boolean; onOption: (option: string) => void; onAction: (action: CustomerAssistantAction) => void; contact: CustomerContactValues; onContactChange: (contact: CustomerContactValues) => void; onReview: () => void; reviewDirty: boolean }) {
  const copy = customerAssistantCopy[locale];
  if (result.kind === 'review_prepared') {
    return (
      <div className="space-y-4">
        {reviewDirty ? <p role="status" className="text-sm text-amber-950">{copy.contactChanged}</p> : <CustomerBookingReviewCard review={result.review} locale={locale} />}
        <ContactDetailsForm locale={locale} contact={contact} disabled={loading} onChange={onContactChange} onReview={onReview} />
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
        {result.kind === 'slot_selected' && <ContactDetailsForm locale={locale} contact={contact} disabled={loading} onChange={onContactChange} onReview={onReview} />}
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

export function CustomerAssistantPanel({ salonSlug, locale, onClose }: CustomerAssistantPanelProps) {
  const copy = customerAssistantCopy[locale];
  const [conversation, setConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [result, setResult] = useState<CustomerReviewResponse['result'] | null>(null);
  const [input, setInput] = useState('');
  const [contact, setContact] = useState<CustomerContactValues>({ name: '', email: '', phone: '' });
  const [reviewDirty, setReviewDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'network' | 'token' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

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

  useEffect(() => {
    const storedConversation = readStoredConversation(salonSlug);
    if (storedConversation) {
      setConversation(storedConversation);
      return;
    }
    void createSession();
  // A panel instance is intentionally scoped to this one salon.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salonSlug]);

  const restart = () => {
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
    if (!trimmedMessage || loading || inFlight.current || !conversation) {
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

  const act = async (action: CustomerAssistantAction) => {
    if (loading || inFlight.current || !conversation || error === 'token') {
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint(salonSlug)}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversation, ...action }),
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

  const review = async () => {
    if (loading || inFlight.current || !conversation || error === 'token') {
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint(salonSlug)}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversation, contact }),
      });
      if (!response.ok) {
        throw new Error('review request failed');
      }
      const data = await response.json() as CustomerReviewResponse;
      if (!data.conversation || !data.result) {
        throw new Error('invalid review response');
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
        {error === 'token' && (
          <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
            <p>{copy.tokenError}</p>
            <button type="button" onClick={restart} className="mt-2 min-h-11 font-medium underline underline-offset-4">{copy.restart}</button>
          </div>
        )}
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
              setReviewDirty(true);
            }}
            onReview={() => void review()}
            reviewDirty={reviewDirty}
          />
        )}
      </div>
      <form onSubmit={handleSubmit} className="shrink-0 border-t border-black/10 p-4 sm:px-5">
        <label htmlFor="customer-assistant-message" className="sr-only">{copy.placeholder}</label>
        <div className="flex items-center gap-2">
          <input ref={inputRef} id="customer-assistant-message" value={input} onChange={event => setInput(event.target.value)} disabled={loading || !conversation || error === 'token'} maxLength={600} placeholder={copy.placeholder} className="min-h-11 min-w-0 flex-1 rounded-xl border border-neutral-300 bg-white px-3 text-base text-neutral-950 placeholder:text-neutral-500 focus:border-neutral-950 focus:outline-none disabled:bg-neutral-100" />
          <button type="submit" disabled={loading || !conversation || !input.trim() || error === 'token'} className="grid size-11 shrink-0 place-items-center rounded-xl bg-neutral-950 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-45" aria-label={copy.send}><Send className="size-4" /></button>
        </div>
        <button type="button" onClick={onClose} className="mt-3 min-h-11 text-sm font-medium text-neutral-700 underline underline-offset-4">{copy.continueManually}</button>
      </form>
    </div>
  );
}

export function CustomerAssistantLauncher({ salonSlug, locale }: CustomerAssistantLauncherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const copy = customerAssistantCopy[locale];
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)} className="min-h-11 rounded-xl border border-neutral-900 bg-white px-4 py-2 text-sm font-semibold text-neutral-950 shadow-sm transition hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950">{copy.launcher}</button>
      <DialogShell isOpen={isOpen} onClose={() => setIsOpen(false)} maxWidthClassName="max-w-xl" alignClassName="items-end p-0 sm:items-center sm:p-4" contentClassName="max-h-[calc(100dvh-0.5rem)] touch-pan-y overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl"><CustomerAssistantPanel salonSlug={salonSlug} locale={locale} onClose={() => setIsOpen(false)} /></DialogShell>
    </>
  );
}
