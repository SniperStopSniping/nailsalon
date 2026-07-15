'use client';

import { useState } from 'react';

import type { ReviewFollowupAction } from '@/libs/reviewFollowup';

// Cappuccino tokens (match ActionBar)
const c = {
  title: '#6F4E37',
  cardBg: '#FAF8F5',
  cardBorder: '#E6DED6',
  primary: '#4B2E1E',
  secondary: '#EADBC8',
  secondaryText: '#4B2E1E',
  accent: '#059669',
};

type Props = {
  appointmentId: string;
  clientName: string | null;
  /** Called when the tech finishes (any choice) so the parent can close everything. */
  onDone: () => void;
};

export function ReviewFollowupModal({ appointmentId, clientName, onDone }: Props) {
  const [submitting, setSubmitting] = useState<ReviewFollowupAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstName = clientName?.trim().split(/\s+/)[0] || 'your client';

  const send = async (action: ReviewFollowupAction) => {
    if (submitting) {
      return;
    }
    setSubmitting(action);
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/review-followup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message || 'Could not save. Please try again.');
        return;
      }
      // 'skipped' and 'already_reviewed' close immediately.
      // 'send' actions surface the copyable message, then the tech taps Done.
      if (action === 'satisfaction_question' || action === 'google_review_link') {
        if (json?.data?.message) {
          setMessage(json.data.message);
        } else {
          // e.g. google_review_link with no configured URL — nothing to copy
          onDone();
        }
      } else {
        onDone();
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(null);
    }
  };

  const copyMessage = async () => {
    if (!message) {
      return;
    }
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard unavailable — the tech can still select the text manually
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center">
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl shadow-2xl sm:rounded-2xl"
        style={{ backgroundColor: c.cardBg }}
      >
        <div className="p-6">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-xl font-semibold" style={{ color: c.title }}>Appointment completed ✓</h2>
            <button type="button" onClick={onDone} className="text-2xl text-neutral-400 hover:text-neutral-600">×</button>
          </div>

          {error && (
            <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          {message
            ? (
                <>
                  <p className="mb-2 text-sm text-neutral-600">Copy this message and send it to your client:</p>
                  <div
                    className="mb-3 whitespace-pre-wrap rounded-xl border bg-white p-3 text-sm"
                    style={{ borderColor: c.cardBorder, color: c.secondaryText }}
                  >
                    {message}
                  </div>
                  <button
                    type="button"
                    onClick={copyMessage}
                    className="w-full rounded-xl py-3 text-sm font-bold text-white transition-all active:scale-[0.98]"
                    style={{ backgroundColor: c.primary }}
                  >
                    {copied ? 'Copied ✓' : 'Copy message'}
                  </button>
                  <button
                    type="button"
                    onClick={onDone}
                    className="mt-2 w-full py-2 text-sm font-medium text-neutral-500 hover:text-neutral-700"
                  >
                    Done
                  </button>
                </>
              )
            : (
                <>
                  <p className="mb-4 text-sm text-neutral-600">
                    Send a follow-up to
                    {' '}
                    {firstName}
                    ?
                  </p>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => send('satisfaction_question')}
                      disabled={submitting !== null}
                      className="w-full rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-50"
                      style={{ borderColor: c.cardBorder, backgroundColor: 'white', color: c.title }}
                    >
                      💬 Ask if they&apos;re happy first
                    </button>
                    <button
                      type="button"
                      onClick={() => send('google_review_link')}
                      disabled={submitting !== null}
                      className="w-full rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-50"
                      style={{ borderColor: c.cardBorder, backgroundColor: 'white', color: c.title }}
                    >
                      ⭐ Send Google review link
                    </button>
                    <button
                      type="button"
                      onClick={() => send('skipped')}
                      disabled={submitting !== null}
                      className="w-full rounded-xl px-4 py-3 text-left text-sm font-medium text-neutral-500 transition-all active:scale-[0.98] disabled:opacity-50"
                    >
                      Skip for now
                    </button>
                  </div>

                  <div className="mt-4 border-t pt-4" style={{ borderColor: c.cardBorder }}>
                    <button
                      type="button"
                      onClick={() => send('already_reviewed')}
                      disabled={submitting !== null}
                      className="w-full rounded-xl border px-4 py-3 text-center text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-50"
                      style={{ borderColor: c.primary, color: c.primary, backgroundColor: 'white' }}
                    >
                      ✓ Client already left a Google review
                    </button>
                    <p className="mt-2 text-center text-xs text-neutral-400">
                      We won&apos;t ask this client for a review again.
                    </p>
                  </div>
                </>
              )}
        </div>
      </div>
    </div>
  );
}

export default ReviewFollowupModal;
