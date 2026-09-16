'use client';

/**
 * Owner Assistant feedback (A1-4b) — client state for ratings and reports.
 *
 * Three rules shape this file.
 *
 * 1. **Feedback never blocks the conversation.** Nothing here can produce a
 *    banner, a dialog or a thrown error: a rating that fails leaves an inline
 *    "Not sent · Retry" beside the message and the owner keeps talking.
 * 2. **A retry is safe.** Every attempt keeps its `feedbackId`, so retrying
 *    re-sends the SAME id and the server-side reader de-duplicates it (see
 *    `feedback.server.ts`). Changing the rating mints a NEW id, because that is
 *    a different statement, not the same one again.
 * 3. **Only the label leaves the browser.** The request carries the rating, the
 *    opaque conversation id and the turn number. The conversation token itself
 *    is decoded HERE, locally, and is never sent to the feedback endpoint —
 *    which is what makes the form's disclosure literally true.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FeedbackRequest, OwnerAssistantFeedbackKind } from '@/libs/ownerAssistant/contracts';

import type { UiMessage } from './ownerAssistantStorage';

const FEEDBACK_ENDPOINT = '/api/admin/owner-assistant/feedback';

export type OwnerAssistantRating = Extract<OwnerAssistantFeedbackKind, 'up' | 'down'>;

type AttemptState = 'idle' | 'sending' | 'failed';

type Attempt = { kind: OwnerAssistantRating; feedbackId: string };

type Entry = {
  /** The rating the server accepted, if any. */
  rating: OwnerAssistantRating | null;
  /** The attempt in flight or the one that failed; null when settled. */
  attempt: Attempt | null;
  attemptState: AttemptState;
  reportOpen: boolean;
  reportState: 'idle' | 'sending' | 'failed' | 'sent';
  reportFeedbackId: string | null;
};

export type OwnerAssistantFeedbackEntry = {
  /** What the control paints as chosen — optimistic while an attempt is in flight. */
  selected: OwnerAssistantRating | null;
  sending: boolean;
  /** The last rating attempt did not reach the server; the control offers Retry. */
  failed: boolean;
  /** A rating was accepted at least once for this message. */
  acknowledged: boolean;
  reportOpen: boolean;
  reportSending: boolean;
  reportFailed: boolean;
  reportSent: boolean;
};

export type OwnerAssistantFeedbackState = {
  entryFor: (messageId: string) => OwnerAssistantFeedbackEntry;
  rate: (message: UiMessage, kind: OwnerAssistantRating) => void;
  retryRating: (message: UiMessage) => void;
  openReport: (messageId: string) => void;
  closeReport: (messageId: string) => void;
  sendReport: (message: UiMessage, text: string) => void;
};

const EMPTY_ENTRY: Entry = {
  rating: null,
  attempt: null,
  attemptState: 'idle',
  reportOpen: false,
  reportState: 'idle',
  reportFeedbackId: null,
};

export const EMPTY_FEEDBACK_ENTRY: OwnerAssistantFeedbackEntry = {
  selected: null,
  sending: false,
  failed: false,
  acknowledged: false,
  reportOpen: false,
  reportSending: false,
  reportFailed: false,
  reportSent: false,
};

function createFeedbackId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The conversation id out of the client's own signed token.
 *
 * The token is `base64url(payload).signature`; only `payload.cid` is read, and
 * any surprise (a changed token shape, a private-mode `atob`, non-JSON) simply
 * yields `undefined` and the feedback is recorded without a conversation id
 * rather than not at all. The id is a correlation hint the server treats as
 * self-reported — identity and salon always come from the session.
 */
export function readConversationId(token: string | null | undefined): string | undefined {
  const encoded = token?.split('.')[0];
  if (!encoded) {
    return undefined;
  }
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const cid = (payload as { cid?: unknown } | null)?.cid;
    return typeof cid === 'string' && /^[\w-]{8,64}$/.test(cid) ? cid : undefined;
  } catch {
    return undefined;
  }
}

function toPublicEntry(entry: Entry): OwnerAssistantFeedbackEntry {
  return {
    // Optimistic while sending; back to the last accepted value on failure, so
    // the control never claims a rating the server does not have.
    selected: entry.attemptState === 'sending' ? (entry.attempt?.kind ?? entry.rating) : entry.rating,
    sending: entry.attemptState === 'sending',
    failed: entry.attemptState === 'failed',
    acknowledged: entry.rating !== null,
    reportOpen: entry.reportOpen,
    reportSending: entry.reportState === 'sending',
    reportFailed: entry.reportState === 'failed',
    reportSent: entry.reportState === 'sent',
  };
}

export function useOwnerAssistantFeedback({
  salonSlug,
  conversation,
}: {
  salonSlug: string | null;
  /** The signed conversation token of the thread on screen; decoded locally. */
  conversation: string | null;
}): OwnerAssistantFeedbackState {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  /**
   * The same map, readable synchronously. Two taps inside one tick would both
   * read the pre-update `entries` from state and both fire a request; the
   * decision to send is therefore made from this ref, and state exists only to
   * paint. Every write goes through `update`, so the two cannot diverge.
   */
  const entriesRef = useRef<Record<string, Entry>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // A salon switch empties the thread, so the ratings that belonged to it must
  // go with it rather than colouring the next salon's first answers.
  useEffect(() => {
    entriesRef.current = {};
    setEntries({});
  }, [salonSlug]);

  const conversationId = useMemo(() => readConversationId(conversation), [conversation]);

  const update = useCallback((messageId: string, patch: (entry: Entry) => Entry) => {
    const next = {
      ...entriesRef.current,
      [messageId]: patch(entriesRef.current[messageId] ?? EMPTY_ENTRY),
    };
    entriesRef.current = next;
    setEntries(next);
  }, []);

  const post = useCallback(
    async (body: FeedbackRequest): Promise<boolean> => {
      try {
        const response = await fetch(FEEDBACK_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return response.ok;
      } catch {
        // Offline, aborted, blocked: all the same to the owner — not sent.
        return false;
      }
    },
    [],
  );

  const sendRating = useCallback(
    (message: UiMessage, attempt: Attempt) => {
      if (!salonSlug) {
        return;
      }
      update(message.id, entry => ({ ...entry, attempt, attemptState: 'sending' }));

      void (async () => {
        const ok = await post({
          salonSlug,
          feedbackId: attempt.feedbackId,
          kind: attempt.kind,
          cardKind: 'answer',
          ...(conversationId ? { conversationId } : {}),
          ...(typeof message.turnIndex === 'number' ? { turnIndex: message.turnIndex } : {}),
        });
        if (!mountedRef.current) {
          return;
        }
        update(message.id, (entry) => {
          // A newer attempt (the owner changed their mind mid-flight) owns the
          // control now; this reply is stale and must not overwrite it.
          if (entry.attempt?.feedbackId !== attempt.feedbackId) {
            return entry;
          }
          return ok
            ? { ...entry, rating: attempt.kind, attempt: null, attemptState: 'idle' }
            : { ...entry, attemptState: 'failed' };
        });
      })();
    },
    [conversationId, post, salonSlug, update],
  );

  const rate = useCallback(
    (message: UiMessage, kind: OwnerAssistantRating) => {
      const entry = entriesRef.current[message.id] ?? EMPTY_ENTRY;
      // Idempotent per message: tapping the choice that is already recorded (or
      // already on its way) sends nothing at all.
      if (entry.attemptState === 'sending' && entry.attempt?.kind === kind) {
        return;
      }
      if (entry.attemptState !== 'failed' && entry.rating === kind) {
        return;
      }
      sendRating(message, { kind, feedbackId: createFeedbackId() });
    },
    [sendRating],
  );

  const retryRating = useCallback(
    (message: UiMessage) => {
      const entry = entriesRef.current[message.id];
      if (!entry || entry.attemptState !== 'failed' || !entry.attempt) {
        return;
      }
      // Same id: the server sees a retry, not a second opinion.
      sendRating(message, entry.attempt);
    },
    [sendRating],
  );

  const openReport = useCallback(
    (messageId: string) => {
      update(messageId, entry => ({ ...entry, reportOpen: true, reportState: 'idle' }));
    },
    [update],
  );

  const closeReport = useCallback(
    (messageId: string) => {
      update(messageId, entry => ({ ...entry, reportOpen: false }));
    },
    [update],
  );

  const sendReport = useCallback(
    (message: UiMessage, text: string) => {
      const trimmed = text.trim();
      if (!salonSlug || trimmed.length === 0) {
        return;
      }
      const existing = entriesRef.current[message.id] ?? EMPTY_ENTRY;
      if (existing.reportState === 'sending') {
        return;
      }
      // A failed report keeps its id so re-sending is a retry of one report.
      const feedbackId = existing.reportFeedbackId ?? createFeedbackId();

      update(message.id, entry => ({ ...entry, reportState: 'sending', reportFeedbackId: feedbackId }));

      void (async () => {
        const ok = await post({
          salonSlug,
          feedbackId,
          kind: 'report',
          cardKind: 'answer',
          text: trimmed,
          ...(conversationId ? { conversationId } : {}),
          ...(typeof message.turnIndex === 'number' ? { turnIndex: message.turnIndex } : {}),
        });
        if (!mountedRef.current) {
          return;
        }
        update(message.id, entry => (ok
          ? { ...entry, reportOpen: false, reportState: 'sent', reportFeedbackId: null }
          : { ...entry, reportState: 'failed' }));
      })();
    },
    [conversationId, post, salonSlug, update],
  );

  const entryFor = useCallback(
    (messageId: string) => {
      const entry = entries[messageId];
      return entry ? toPublicEntry(entry) : EMPTY_FEEDBACK_ENTRY;
    },
    [entries],
  );

  return { entryFor, rate, retryRating, openReport, closeReport, sendReport };
}
