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
import { OWNER_ASSISTANT_SUGGESTED_QUESTIONS } from '@/libs/ownerAssistant/contracts';

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
  busy: boolean;
  banner: OwnerAssistantBanner | null;
  /** Non-null after a 409: the previous thread was dropped. */
  notice: string | null;
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

  // Bumped on salon switch and on "New conversation" so a response that was
  // already in flight can never land in a thread it does not belong to.
  const sessionRef = useRef(0);
  const turnControllerRef = useRef<AbortController | null>(null);
  const lastOwnerMessageRef = useRef<string | null>(null);
  const previousSlugRef = useRef<string | null>(null);
  const busyRef = useRef(false);

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

    if (!salonSlug) {
      setThread(EMPTY_THREAD);
      return undefined;
    }

    const stored = readOwnerAssistantThread(salonSlug);
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
        if (payload && session === sessionRef.current) {
          setContext(payload);
        }
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
    writeOwnerAssistantThread(thread.slug, {
      conversation: thread.conversation,
      messages: thread.messages,
    });
  }, [salonSlug, thread]);

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

      // Read the token from the rendered thread, not from inside a state
      // updater: React runs updaters during the render phase, so a value
      // captured there would still be null when the request is built.
      const conversation = thread.slug === salonSlug ? thread.conversation : null;
      if (appendOwnerMessage) {
        setThread(previous =>
          previous.slug === salonSlug
            ? {
                ...previous,
                messages: [...previous.messages, { id: createMessageId(), role: 'owner', text }],
              }
            : previous,
        );
      }

      const body: ChatRequest = {
        salonSlug,
        message: text,
        locale,
        ...(conversation ? { conversation } : {}),
      };

      try {
        const response = await fetch(CHAT_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (session !== sessionRef.current || controller.signal.aborted) {
          return;
        }

        // The signed window no longer matches this session: the only honest
        // move is to drop it and start again (docs §3.6).
        if (response.status === 409) {
          lastOwnerMessageRef.current = null;
          setThread(previous =>
            previous.slug === salonSlug ? { ...previous, conversation: null, messages: [] } : previous,
          );
          setNotice(ownerAssistantCopy.conversationReset);
          return;
        }

        if (!response.ok) {
          setBanner({ tone: 'error', message: ownerAssistantCopy.networkError });
          return;
        }

        const payload = asChatTurnResponse(await response.json());
        if (session !== sessionRef.current) {
          return;
        }
        if (!payload) {
          setBanner({ tone: 'error', message: ownerAssistantCopy.networkError });
          return;
        }

        if (payload.kind === 'unavailable') {
          // The reason sentence is the server's; render it verbatim and keep
          // the thread so Retry re-sends the same question.
          setBanner({ tone: 'unavailable', message: payload.message });
          if (payload.conversation) {
            const echoed = payload.conversation;
            setThread(previous =>
              previous.slug === salonSlug ? { ...previous, conversation: echoed } : previous,
            );
          }
          return;
        }

        const answer: UiMessage = {
          id: createMessageId(),
          role: 'assistant',
          text: payload.message,
          checked: payload.checked.length > 0 ? payload.checked : undefined,
          links: payload.links.length > 0 ? payload.links : undefined,
          followUps: payload.followUps.length > 0 ? payload.followUps : undefined,
        };
        setThread(previous =>
          previous.slug === salonSlug
            ? {
                ...previous,
                conversation: payload.conversation,
                messages: [...previous.messages, answer],
              }
            : previous,
        );
      } catch {
        if (session === sessionRef.current && !controller.signal.aborted) {
          setBanner({ tone: 'error', message: ownerAssistantCopy.networkError });
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
    setThread({ slug: salonSlug, conversation: null, messages: [] });
    if (salonSlug) {
      clearOwnerAssistantThread(salonSlug);
    }
  }, [salonSlug]);

  const suggestedQuestions = useMemo(() => {
    const fromServer = context?.suggestedQuestions ?? [];
    return fromServer.length > 0 ? fromServer : [...OWNER_ASSISTANT_SUGGESTED_QUESTIONS];
  }, [context]);

  return {
    context,
    messages: thread.slug === salonSlug ? thread.messages : [],
    busy,
    banner,
    notice,
    suggestedQuestions,
    send,
    retry,
    reset,
  };
}
