'use client';

/**
 * Owner Assistant chat (A1-1) — client state for the conversational slice.
 *
 * The hook owns admission, the thread, one in-flight turn and persistence. The
 * server stays authoritative for everything that matters: it decides whether
 * the feature exists for this salon (a non-200 context response renders no UI
 * at all, exactly like PR #223's silent admission), it writes the owner-facing
 * sentence of an `unavailable` turn, and it builds every link href. This file
 * never invents an availability state, a reason or a destination.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  ChatRequest,
  ChatTurnResponse,
  ContextResponse,
} from '@/libs/ownerAssistant/contracts';
import {
  CHAT_UNAVAILABLE_MESSAGES,
  OWNER_ASSISTANT_SUGGESTED_QUESTIONS,
} from '@/libs/ownerAssistant/contracts';

import { ownerAssistantCopy } from './ownerAssistantCopy';
import type { UiMessage } from './ownerAssistantStorage';
import {
  clearOwnerAssistantThread,
  readOwnerAssistantThread,
  writeOwnerAssistantThread,
} from './ownerAssistantStorage';

const CONTEXT_ENDPOINT = '/api/admin/owner-assistant/context';
const CHAT_ENDPOINT = '/api/admin/owner-assistant/chat';

export type OwnerAssistantBanner = {
  /** `unavailable` carries the server's own sentence; `error` is our generic one. */
  tone: 'unavailable' | 'error';
  message: string;
  /**
   * False when there is no question to send again — the model being unavailable
   * on open is a state of the salon, not of a turn, so offering Retry would be
   * a control that does nothing.
   */
  retryable: boolean;
};

type Thread = {
  /** The salon this thread belongs to; guards persistence against a switch. */
  slug: string | null;
  conversation: string | null;
  messages: UiMessage[];
};

export type OwnerAssistantState = {
  /** Null until `GET /context` answered 200. The UI renders nothing while null. */
  context: ContextResponse | null;
  messages: UiMessage[];
  /**
   * The signed conversation token for the thread on screen, or null before the
   * first answer. Exposed so the feedback control can label a rating with the
   * conversation it belongs to; nothing outside this module ever sends it.
   */
  conversation: string | null;
  busy: boolean;
  banner: OwnerAssistantBanner | null;
  /** Non-null after a 409: the previous thread was dropped. */
  notice: string | null;
  /**
   * Text handed back to the composer when a turn could not be delivered at all
   * (a refused conversation that a fresh one could not rescue). Non-null exactly
   * once per occurrence; the composer clears it through `clearDraftToRestore`.
   */
  draftToRestore: string | null;
  clearDraftToRestore: () => void;
  suggestedQuestions: string[];
  send: (message: string) => void;
  retry: () => void;
  reset: () => void;
};

const EMPTY_THREAD: Thread = { slug: null, conversation: null, messages: [] };

function createMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function ownerMessage(text: string): UiMessage {
  return { id: createMessageId(), role: 'owner', text };
}

/**
 * Marks (or unmarks) the owner message this turn belongs to — always the last
 * one in the thread. A turn that ended `unavailable` or in an error produced no
 * assistant bubble and, on the server, no window entry either: without the mark
 * the visible thread would silently claim a question was answered.
 */
function withLastOwnerUnanswered(messages: UiMessage[], unanswered: boolean): UiMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'owner') {
      continue;
    }
    if ((message.unanswered ?? false) === unanswered) {
      return messages;
    }
    const next = [...messages];
    next[index] = { ...message, unanswered };
    return next;
  }
  return messages;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Both endpoints are specified to answer with the bare contract shape. Some
 * admin routes in this repo wrap their payload in `{ data: … }`, so the one
 * extra unwrap here keeps the UI working against either spelling instead of
 * silently rendering nothing.
 */
function unwrapPayload(body: unknown): unknown {
  if (isRecord(body) && !('kind' in body) && !('enabled' in body) && isRecord(body.data)) {
    return body.data;
  }
  return body;
}

function asContextResponse(body: unknown): ContextResponse | null {
  const payload = unwrapPayload(body);
  if (!isRecord(payload) || payload.enabled !== true || typeof payload.salonSlug !== 'string') {
    return null;
  }
  return payload as unknown as ContextResponse;
}

function asChatTurnResponse(body: unknown): ChatTurnResponse | null {
  const payload = unwrapPayload(body);
  if (!isRecord(payload)) {
    return null;
  }
  if (payload.kind === 'answer' && typeof payload.message === 'string') {
    return payload as unknown as ChatTurnResponse;
  }
  if (payload.kind === 'unavailable' && typeof payload.message === 'string') {
    return payload as unknown as ChatTurnResponse;
  }
  return null;
}

export function useOwnerAssistant({
  salonSlug,
  locale,
}: {
  salonSlug: string | null;
  locale: 'en' | 'fr';
}): OwnerAssistantState {
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [thread, setThread] = useState<Thread>(EMPTY_THREAD);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<OwnerAssistantBanner | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftToRestore, setDraftToRestore] = useState<string | null>(null);

  // Bumped on salon switch and on "New conversation" so a response that was
  // already in flight can never land in a thread it does not belong to.
  const sessionRef = useRef(0);
  const turnControllerRef = useRef<AbortController | null>(null);
  const lastOwnerMessageRef = useRef<string | null>(null);
  const previousSlugRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  // Owner reference the restored thread was stored under (undefined = no
  // stored thread). Compared against the context once admission succeeds so
  // one owner never sees another owner's conversation on a shared device.
  const storedOwnerRefRef = useRef<string | null | undefined>(undefined);

  const clearDraftToRestore = useCallback(() => setDraftToRestore(null), []);

  // Salon switch: drop the previous salon's stored thread. Keyed storage means
  // a reload of the *same* salon still restores, which is the point of §7.
  useEffect(() => {
    const previous = previousSlugRef.current;
    previousSlugRef.current = salonSlug;
    if (previous && previous !== salonSlug) {
      clearOwnerAssistantThread(previous);
    }
  }, [salonSlug]);

  // Admission. A 404/403 (dark, not entitled, not an owner) and every transport
  // failure are silent by design: an optional tool must not put a broken or
  // disabled control on the dashboard, and 404 must stay indistinguishable
  // from dark (docs §3.1).
  useEffect(() => {
    sessionRef.current += 1;
    turnControllerRef.current?.abort();
    turnControllerRef.current = null;
    busyRef.current = false;
    lastOwnerMessageRef.current = null;
    setContext(null);
    setBusy(false);
    setBanner(null);
    setNotice(null);
    setDraftToRestore(null);

    if (!salonSlug) {
      setThread(EMPTY_THREAD);
      return undefined;
    }

    const stored = readOwnerAssistantThread(salonSlug);
    storedOwnerRefRef.current = stored ? (stored.ownerRef ?? null) : undefined;
    setThread({
      slug: salonSlug,
      conversation: stored?.conversation ?? null,
      messages: stored?.messages ?? [],
    });

    const session = sessionRef.current;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `${CONTEXT_ENDPOINT}?salonSlug=${encodeURIComponent(salonSlug)}`,
          { signal: controller.signal },
        );
        if (!response.ok || session !== sessionRef.current) {
          return;
        }
        const payload = asContextResponse(await response.json());
        if (!payload || session !== sessionRef.current) {
          return;
        }
        // A stored thread belongs to exactly one owner. Anything stored under
        // another owner's reference (or under none) is dropped before the
        // sheet can render it.
        const storedOwnerRef = storedOwnerRefRef.current;
        if (storedOwnerRef !== undefined && storedOwnerRef !== payload.ownerRef) {
          clearOwnerAssistantThread(salonSlug);
          storedOwnerRefRef.current = undefined;
          setThread({ slug: salonSlug, conversation: null, messages: [] });
        }
        setContext(payload);
      } catch {
        // Silent: admission failures leave the dashboard exactly as it was.
      }
    })();

    return () => controller.abort();
  }, [salonSlug]);

  useEffect(() => () => turnControllerRef.current?.abort(), []);

  // Persistence. The thread carries its own slug so a render that has already
  // seen the new `salonSlug` but not yet the new thread cannot write one
  // salon's conversation under another salon's key.
  useEffect(() => {
    if (!thread.slug || thread.slug !== salonSlug) {
      return;
    }
    if (thread.messages.length === 0 && thread.conversation === null) {
      clearOwnerAssistantThread(thread.slug);
      return;
    }
    // Only persist once admission has told us WHO this thread belongs to;
    // before that the restored thread is invisible and needs no re-write.
    if (!context) {
      return;
    }
    writeOwnerAssistantThread(thread.slug, {
      ownerRef: context.ownerRef,
      conversation: thread.conversation,
      messages: thread.messages,
    });
  }, [salonSlug, thread, context]);

  const runTurn = useCallback(
    async (text: string, appendOwnerMessage: boolean) => {
      if (!salonSlug || busyRef.current) {
        return;
      }
      const session = sessionRef.current;
      const controller = new AbortController();
      turnControllerRef.current?.abort();
      turnControllerRef.current = controller;
      lastOwnerMessageRef.current = text;
      busyRef.current = true;
      setBusy(true);
      setBanner(null);
      setNotice(null);
      setDraftToRestore(null);

      const markUnanswered = (unanswered: boolean) => {
        setThread(previous =>
          previous.slug === salonSlug
            ? { ...previous, messages: withLastOwnerUnanswered(previous.messages, unanswered) }
            : previous,
        );
      };

      // Read the token from the rendered thread, not from inside a state
      // updater: React runs updaters during the render phase, so a value
      // captured there would still be null when the request is built.
      let conversation = thread.slug === salonSlug ? thread.conversation : null;
      let pendingOwnerMessage = appendOwnerMessage;

      try {
        // At most two attempts. A 409 means the signed window was refused, and
        // the question itself is still perfectly valid: re-send it once with no
        // token at all rather than dropping what the owner typed (docs §3.6).
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          if (pendingOwnerMessage) {
            pendingOwnerMessage = false;
            setThread(previous =>
              previous.slug === salonSlug
                ? { ...previous, messages: [...previous.messages, ownerMessage(text)] }
                : previous,
            );
          }

          const body: ChatRequest = {
            salonSlug,
            message: text,
            locale,
            ...(conversation ? { conversation } : {}),
          };

          // The second attempt is a deliberate consequence of the first one's
          // 409, never a parallel call: awaiting inside the loop is the point.
          const response = await fetch(CHAT_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (session !== sessionRef.current || controller.signal.aborted) {
            return;
          }

          if (response.status === 409) {
            setNotice(ownerAssistantCopy.conversationReset);
            if (attempt === 1) {
              // Drop the refused window, keep the question on screen exactly
              // once, and send it again as the first turn of a new conversation.
              conversation = null;
              setThread(previous =>
                previous.slug === salonSlug
                  ? { ...previous, conversation: null, messages: [ownerMessage(text)] }
                  : previous,
              );
              continue;
            }
            // Even a brand new conversation was refused: hand the text back to
            // the composer so the owner still has what they wrote.
            lastOwnerMessageRef.current = null;
            setThread(previous =>
              previous.slug === salonSlug
                ? { ...previous, conversation: null, messages: [] }
                : previous,
            );
            setDraftToRestore(text);
            return;
          }

          if (!response.ok) {
            setBanner({ tone: 'error', message: ownerAssistantCopy.networkError, retryable: true });
            markUnanswered(true);
            return;
          }

          const payload = asChatTurnResponse(await response.json());
          if (session !== sessionRef.current) {
            return;
          }
          if (!payload) {
            setBanner({ tone: 'error', message: ownerAssistantCopy.networkError, retryable: true });
            markUnanswered(true);
            return;
          }

          if (payload.kind === 'unavailable') {
            // The reason sentence is the server's; render it verbatim and keep
            // the thread so Retry re-sends the same question.
            setBanner({ tone: 'unavailable', message: payload.message, retryable: true });
            const echoed = payload.conversation;
            setThread(previous =>
              previous.slug === salonSlug
                ? {
                    ...previous,
                    ...(echoed ? { conversation: echoed } : {}),
                    messages: withLastOwnerUnanswered(previous.messages, true),
                  }
                : previous,
            );
            return;
          }

          setThread((previous) => {
            if (previous.slug !== salonSlug) {
              return previous;
            }
            const settled = withLastOwnerUnanswered(previous.messages, false);
            const answer: UiMessage = {
              id: createMessageId(),
              role: 'assistant',
              text: payload.message,
              checked: payload.checked.length > 0 ? payload.checked : undefined,
              links: payload.links.length > 0 ? payload.links : undefined,
              followUps: payload.followUps.length > 0 ? payload.followUps : undefined,
              // The server's `turnIndex` is the number of ANSWERED turns that
              // preceded this one in the conversation, which is exactly the
              // number of assistant bubbles already in the thread: an
              // `unavailable` turn adds neither. Derived here rather than read
              // from the response because the turn contract does not carry it.
              turnIndex: settled.filter(message => message.role === 'assistant').length,
            };
            return {
              ...previous,
              conversation: payload.conversation,
              messages: [...settled, answer],
            };
          });
          return;
        }
      } catch {
        if (session === sessionRef.current && !controller.signal.aborted) {
          setBanner({ tone: 'error', message: ownerAssistantCopy.networkError, retryable: true });
          markUnanswered(true);
        }
      } finally {
        if (turnControllerRef.current === controller) {
          turnControllerRef.current = null;
        }
        if (session === sessionRef.current) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [locale, salonSlug, thread],
  );

  const send = useCallback(
    (message: string) => {
      const text = message.trim();
      if (text.length === 0) {
        return;
      }
      void runTurn(text, true);
    },
    [runTurn],
  );

  const retry = useCallback(() => {
    const text = lastOwnerMessageRef.current;
    if (!text) {
      return;
    }
    void runTurn(text, false);
  }, [runTurn]);

  const reset = useCallback(() => {
    sessionRef.current += 1;
    turnControllerRef.current?.abort();
    turnControllerRef.current = null;
    busyRef.current = false;
    lastOwnerMessageRef.current = null;
    setBusy(false);
    setBanner(null);
    setNotice(null);
    setDraftToRestore(null);
    setThread({ slug: salonSlug, conversation: null, messages: [] });
    if (salonSlug) {
      clearOwnerAssistantThread(salonSlug);
    }
  }, [salonSlug]);

  // The server already knows the assistant cannot answer for this salon. Say so
  // the moment the sheet opens, with the very sentence a turn would carry
  // (docs §4), instead of letting the owner type a question only to be told
  // afterwards. A banner from an actual turn is more specific, so it wins.
  const modelBanner = useMemo<OwnerAssistantBanner | null>(() => {
    if (!context || context.model.available) {
      return null;
    }
    return {
      tone: 'unavailable',
      message: CHAT_UNAVAILABLE_MESSAGES[context.model.reason],
      retryable: false,
    };
  }, [context]);

  const suggestedQuestions = useMemo(() => {
    const fromServer = context?.suggestedQuestions ?? [];
    return fromServer.length > 0 ? fromServer : [...OWNER_ASSISTANT_SUGGESTED_QUESTIONS];
  }, [context]);

  return {
    context,
    messages: thread.slug === salonSlug ? thread.messages : [],
    conversation: thread.slug === salonSlug ? thread.conversation : null,
    busy,
    banner: banner ?? modelBanner,
    notice,
    draftToRestore,
    clearDraftToRestore,
    suggestedQuestions,
    send,
    retry,
    reset,
  };
}
