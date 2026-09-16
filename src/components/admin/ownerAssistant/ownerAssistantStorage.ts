/**
 * Owner Assistant chat (A1-1) — client-side thread persistence.
 *
 * `sessionStorage['owner-assistant:v1:<salonSlug>']` holds the signed
 * conversation token and the rendered thread so a tab refresh does not lose the
 * exchange (docs/OWNER_ASSISTANT_CHAT.md §7). Nothing else is stored client
 * side, and the entry is dropped on salon switch, on a 409 and by "New
 * conversation".
 *
 * Every access is wrapped: Safari private mode throws on `sessionStorage`
 * access, and a stored value written by an older build (or by anything else on
 * this origin) must never crash the dashboard. A malformed entry is treated as
 * "no thread", not as a partially trusted one.
 */
import type { ChatChecked, ChatLink } from '@/libs/ownerAssistant/contracts';

export type UiMessage = {
  id: string;
  role: 'owner' | 'assistant';
  /** Plain text. Rendered as text — never as markup. */
  text: string;
  checked?: ChatChecked[];
  links?: ChatLink[];
  followUps?: string[];
  /**
   * Assistant messages only: which turn of the current conversation produced
   * this answer, counted the way the server counts it (answered turns only, so
   * an `unavailable` turn does not advance it). Feedback sends this number so a
   * rating joins to the ledger row of the turn it rates (A1-4b).
   */
  turnIndex?: number;
  /**
   * Owner messages only: the turn ended `unavailable` or in an error, so this
   * question never reached the signed window and was never answered. Rendered
   * as a caption so the visible thread cannot claim otherwise.
   */
  unanswered?: boolean;
};

export type OwnerAssistantStoredThread = {
  /** Opaque per-owner reference from the context response; a stored thread is only restored for the same owner. */
  ownerRef?: string;
  conversation: string | null;
  messages: UiMessage[];
};

const STORAGE_PREFIX = 'owner-assistant:v1:';

export function ownerAssistantStorageKey(salonSlug: string): string {
  return `${STORAGE_PREFIX}${salonSlug}`;
}

function getSessionStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') {
      return null;
    }
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseChecked(value: unknown): ChatChecked[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const checked = value.filter(
    (item): item is ChatChecked =>
      isRecord(item) && typeof item.tool === 'string' && typeof item.label === 'string',
  );
  return checked.length > 0 ? checked : undefined;
}

function parseLinks(value: unknown): ChatLink[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const links = value.filter(
    (item): item is ChatLink =>
      isRecord(item)
      && typeof item.key === 'string'
      && typeof item.label === 'string'
      && typeof item.href === 'string',
  );
  return links.length > 0 ? links : undefined;
}

function parseFollowUps(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const followUps = value.filter((item): item is string => typeof item === 'string');
  return followUps.length > 0 ? followUps : undefined;
}

function parseMessage(value: unknown): UiMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, role, text } = value;
  if (typeof id !== 'string' || typeof text !== 'string') {
    return null;
  }
  if (role !== 'owner' && role !== 'assistant') {
    return null;
  }
  return {
    id,
    role,
    text,
    checked: parseChecked(value.checked),
    links: parseLinks(value.links),
    followUps: parseFollowUps(value.followUps),
    turnIndex:
      typeof value.turnIndex === 'number' && Number.isInteger(value.turnIndex) && value.turnIndex >= 0
        ? value.turnIndex
        : undefined,
    unanswered: value.unanswered === true ? true : undefined,
  };
}

/** Returns the stored thread for a salon, or `null` when there is nothing usable. */
export function readOwnerAssistantThread(salonSlug: string): OwnerAssistantStoredThread | null {
  const storage = getSessionStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(ownerAssistantStorageKey(salonSlug));
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }
    const conversation = typeof parsed.conversation === 'string' ? parsed.conversation : null;
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.map(parseMessage).filter((message): message is UiMessage => message !== null)
      : [];
    return {
      ownerRef: typeof parsed.ownerRef === 'string' ? parsed.ownerRef : undefined,
      conversation,
      messages,
    };
  } catch {
    // An unreadable or malformed entry is indistinguishable from no entry.
    return null;
  }
}

export function writeOwnerAssistantThread(
  salonSlug: string,
  thread: OwnerAssistantStoredThread,
): void {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(ownerAssistantStorageKey(salonSlug), JSON.stringify(thread));
  } catch {
    // Quota or private-mode failures must not break the conversation itself.
  }
}

export function clearOwnerAssistantThread(salonSlug: string): void {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(ownerAssistantStorageKey(salonSlug));
  } catch {
    // Nothing to do: the thread is already gone from this component's state.
  }
}
