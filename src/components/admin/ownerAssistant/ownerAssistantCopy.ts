/**
 * Owner Assistant chat (A1-1) — every owner-facing string of the UI slice.
 *
 * English only in this slice (docs/OWNER_ASSISTANT_CHAT.md §7). The strings the
 * server owns are deliberately absent: an `unavailable` turn carries its own
 * `message` and the UI renders it verbatim, because only the server knows
 * which honest reason applies (docs §4). The disclosure comes from
 * `contracts.ts` so the sheet and the server cannot drift apart.
 */
import { OWNER_ASSISTANT_DISCLOSURE } from '@/libs/ownerAssistant/contracts';

export const ownerAssistantCopy = {
  /** Launcher pill. */
  launcher: 'Ask',
  launcherAriaLabel: 'Ask the assistant about your salon',

  /** Sheet chrome. */
  title: 'Assistant',
  close: 'Close assistant',
  disclosure: OWNER_ASSISTANT_DISCLOSURE,

  /** Thread. */
  threadLabel: 'Conversation with the assistant',
  ownerMessageLabel: 'You',
  assistantMessageLabel: 'Assistant',
  /** Rendered before the comma-separated tool labels of an assistant turn. */
  checkedPrefix: 'Checked:',
  followUpsLabel: 'Ask next',
  linksLabel: 'Go to',
  suggestedQuestionsLabel: 'Try asking',
  emptyStateTitle: 'Ask about your salon',
  emptyStateBody: 'Questions about your services, hours, booking page or where a setting lives.',
  /** Caption under an owner message whose turn ended unavailable or in an error. */
  notAnswered: 'Not answered',

  /** Turn states. */
  busy: 'Checking your salon…',
  retry: 'Retry',
  /** Shown for 400/401/403/5xx and for network failures — never provider text. */
  networkError: 'Something went wrong. Please try again.',
  /** Shown when the server refuses the conversation token (HTTP 409). */
  conversationReset: 'Let\'s start a fresh conversation.',
  newConversation: 'New conversation',

  /** Composer. */
  composerLabel: 'Message the assistant',
  composerPlaceholder: 'Ask a question about your salon…',
  composerHint: 'Enter sends · Shift + Enter adds a line',
  counterLabel: 'Characters used',
  send: 'Send',
} as const;

export type OwnerAssistantCopy = typeof ownerAssistantCopy;
