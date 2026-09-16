import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatRequest, ChatTurnResponse, ContextResponse } from '@/libs/ownerAssistant/contracts';
import {
  CHAT_UNAVAILABLE_MESSAGES,
  OWNER_ASSISTANT_DISCLOSURE,
  OWNER_ASSISTANT_LIMITS,
} from '@/libs/ownerAssistant/contracts';

import { ownerAssistantCopy } from './ownerAssistantCopy';
import OwnerAssistantLauncher from './OwnerAssistantLauncher';
import { ownerAssistantStorageKey } from './ownerAssistantStorage';

const { fetchMock, routerPush } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
}));

const SALON_SLUG = 'isla-nail-studio';
const OTHER_SLUG = 'nail-salon-no5';

function contextBody(
  slug = SALON_SLUG,
  name = 'Isla Nail Studio',
  model: ContextResponse['model'] = { available: true },
): ContextResponse {
  return {
    enabled: true,
    salonSlug: slug,
    salonName: name,
    ownerRef: 'owner-ref-1',
    tools: ['get_salon_overview', 'list_services', 'find_destination'],
    model,
    suggestedQuestions: ['What services do I offer?', 'Where do I upload my logo?'],
    disclosure: OWNER_ASSISTANT_DISCLOSURE,
  };
}

function answer(overrides: Partial<Extract<ChatTurnResponse, { kind: 'answer' }>> = {}): ChatTurnResponse {
  return {
    kind: 'answer',
    message: 'You offer Gel manicure and Pedicure.',
    checked: [{ tool: 'list_services', label: 'your services list' }],
    links: [],
    followUps: [],
    needsClarification: false,
    conversation: 'token-1',
    usage: { modelCalls: 1, toolCalls: 1 },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Scenario = {
  contextResponses: Array<() => Response | Promise<Response>>;
  chatResponses: Array<() => Response | Promise<Response>>;
  chatRequests: ChatRequest[];
};

const scenario: Scenario = { contextResponses: [], chatResponses: [], chatRequests: [] };

function queueContext(...responses: Array<() => Response | Promise<Response>>): void {
  scenario.contextResponses.push(...responses);
}

function queueChat(...responses: Array<() => Response | Promise<Response>>): void {
  scenario.chatResponses.push(...responses);
}

async function openSheet(): Promise<void> {
  const user = userEvent.setup();
  await user.click(await screen.findByTestId('owner-assistant-launcher'));
  await screen.findByTestId('owner-assistant-sheet');
}

function composer(): HTMLTextAreaElement {
  return screen.getByLabelText(ownerAssistantCopy.composerLabel) as HTMLTextAreaElement;
}

/**
 * Message queries are scoped to the thread, which is itself the polite live
 * region: an answer must appear in the accessibility tree exactly once.
 */
function thread() {
  return within(screen.getByTestId('owner-assistant-thread'));
}

/** A chat response that stays in flight until the test releases it. */
function deferredChat(body: unknown): { queue: () => Promise<Response>; release: () => void } {
  let release = (): void => {};
  const pending = new Promise<Response>((resolve) => {
    release = () => resolve(jsonResponse(body));
  });

  return { queue: () => pending, release: () => release() };
}

async function ask(text: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(composer(), text);
  await user.click(screen.getByRole('button', { name: ownerAssistantCopy.send }));
}

beforeEach(() => {
  scenario.contextResponses = [];
  scenario.chatResponses = [];
  scenario.chatRequests = [];
  routerPush.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/admin/owner-assistant/context')) {
      const next = scenario.contextResponses.shift();
      if (!next) {
        throw new Error(`unexpected context request: ${url}`);
      }
      return next();
    }
    if (url.includes('/api/admin/owner-assistant/chat')) {
      scenario.chatRequests.push(JSON.parse(String(init?.body)) as ChatRequest);
      const next = scenario.chatResponses.shift();
      if (!next) {
        throw new Error(`unexpected chat request: ${url}`);
      }
      return next();
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe('OwnerAssistantLauncher — admission', () => {
  it('renders nothing when the context endpoint answers 404', async () => {
    queueContext(() => new Response('', { status: 404 }));

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(screen.queryByTestId('owner-assistant-launcher')).not.toBeInTheDocument();
  });

  it('renders nothing when the context request fails outright', async () => {
    queueContext(() => Promise.reject(new Error('offline')));

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(screen.queryByTestId('owner-assistant-launcher')).not.toBeInTheDocument();
  });

  it('renders nothing while there is no active salon slug', () => {
    render(<OwnerAssistantLauncher locale="en" salonSlug={null} />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('owner-assistant-launcher')).not.toBeInTheDocument();
  });

  it('shows the pill, the disclosure and the suggested questions on a 200', async () => {
    queueContext(() => jsonResponse(contextBody()));

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: ownerAssistantCopy.title })).toBeInTheDocument();
    expect(screen.getByText('Isla Nail Studio')).toBeInTheDocument();
    expect(screen.getByText(OWNER_ASSISTANT_DISCLOSURE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What services do I offer?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Where do I upload my logo?' })).toBeInTheDocument();
  });

  it('clears the fixed workspace bottom nav at every width', async () => {
    queueContext(() => jsonResponse(contextBody()));

    render(<OwnerAssistantLauncher locale="en" placement="workspace" salonSlug={SALON_SLUG} />);

    const pill = await screen.findByTestId('owner-assistant-launcher');

    // OwnerWorkspaceNav is `fixed inset-x-0 bottom-0` at every width and is
    // never hidden, so a wide-screen offset would park the pill on its 5th tab.
    expect(pill).toHaveClass('bottom-[calc(5.5rem+env(safe-area-inset-bottom))]');
    expect(pill).not.toHaveClass('sm:bottom-6');
  });

  it('sits at the bottom edge on a screen that has no bottom nav', async () => {
    queueContext(() => jsonResponse(contextBody()));

    render(<OwnerAssistantLauncher locale="en" placement="standalone" salonSlug={SALON_SLUG} />);

    const pill = await screen.findByTestId('owner-assistant-launcher');

    expect(pill).toHaveClass('bottom-[calc(1.5rem+env(safe-area-inset-bottom))]');
    expect(pill).not.toHaveClass('bottom-[calc(5.5rem+env(safe-area-inset-bottom))]');
  });

  it('shows the server reason on open when the model is not available', async () => {
    queueContext(() => jsonResponse(
      contextBody(SALON_SLUG, 'Isla Nail Studio', { available: false, reason: 'redis_unavailable' }),
    ));

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();

    expect(screen.getByTestId('owner-assistant-banner')).toHaveTextContent(
      CHAT_UNAVAILABLE_MESSAGES.redis_unavailable,
    );
    // Nothing has been asked yet, so a Retry control would do nothing at all.
    expect(screen.queryByRole('button', { name: ownerAssistantCopy.retry })).not.toBeInTheDocument();
  });
});

describe('OwnerAssistantLauncher — turns', () => {
  it('posts the contract body, without a token first and with the echoed token next', async () => {
    queueContext(() => jsonResponse(contextBody()));
    queueChat(
      () => jsonResponse(answer()),
      () => jsonResponse(answer({ message: 'Only Gel manicure is active.', conversation: 'token-2' })),
    );

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();
    await ask('What services do I offer?');

    expect(await thread().findByText('You offer Gel manicure and Pedicure.')).toBeInTheDocument();
    expect(screen.getByTestId('owner-assistant-thread')).toHaveAttribute('aria-live', 'polite');
    // The thread is the live region: no sr-only copy reads the answer twice.
    expect(screen.getAllByText('You offer Gel manicure and Pedicure.')).toHaveLength(1);

    await ask('only the active ones');

    expect(await thread().findByText('Only Gel manicure is active.')).toBeInTheDocument();
    expect(scenario.chatRequests).toEqual([
      { salonSlug: SALON_SLUG, message: 'What services do I offer?', locale: 'en' },
      {
        salonSlug: SALON_SLUG,
        message: 'only the active ones',
        locale: 'en',
        conversation: 'token-1',
      },
    ]);
  });

  it('renders the Checked line, link chips and follow-up chips of an answer', async () => {
    queueContext(() => jsonResponse(contextBody()));
    queueChat(
      () => jsonResponse(answer({
        message: 'Your logo lives on the booking page.',
        checked: [
          { tool: 'get_salon_overview', label: 'your salon setup' },
          { tool: 'find_destination', label: 'where things live in Luster' },
        ],
        links: [{ key: 'page_gallery', label: 'Photos & logo', href: '/en/admin/booking-page?salon=isla-nail-studio&panel=gallery' }],
        followUps: ['And my cover photo?'],
      })),
      () => jsonResponse(answer({ message: 'Your cover photo is set.', conversation: 'token-2' })),
    );

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();
    await ask('Where do I upload my logo?');

    expect(await screen.findByTestId('owner-assistant-checked')).toHaveTextContent(
      'Checked: your salon setup, where things live in Luster',
    );

    const user = userEvent.setup();
    await user.click(within(screen.getByTestId('owner-assistant-follow-ups')).getByRole('button', { name: 'And my cover photo?' }));

    expect(await thread().findByText('Your cover photo is set.')).toBeInTheDocument();
    expect(scenario.chatRequests[1]?.message).toBe('And my cover photo?');
  });

  it('navigates and closes the sheet when a link chip is used', async () => {
    queueContext(() => jsonResponse(contextBody()));
    queueChat(() => jsonResponse(answer({
      message: 'Hours live in Settings.',
      links: [{ key: 'business_hours', label: 'Business hours', href: '/en/admin?salon=isla-nail-studio&app=settings&view=hours' }],
    })));

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();
    await ask('Where do I change my hours?');

    // What was focused at the moment the route changed? Closing first hands
    // focus back to the pill; navigating first would leave it on a node the
    // route change is about to unmount.
    const focusedDuringPush: Array<string | undefined> = [];

    routerPush.mockImplementation(() => {
      focusedDuringPush.push((document.activeElement as HTMLElement | null)?.dataset.testid);
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Business hours' }));

    expect(routerPush).toHaveBeenCalledWith('/en/admin?salon=isla-nail-studio&app=settings&view=hours');
    expect(focusedDuringPush).toEqual(['owner-assistant-launcher']);

    await waitFor(() => expect(screen.queryByTestId('owner-assistant-sheet')).not.toBeInTheDocument());

    expect(screen.getByTestId('owner-assistant-launcher')).toHaveFocus();
  });

  it('shows the server sentence of an unavailable turn and retries the same question', async () => {
    queueContext(() => jsonResponse(contextBody()));
    queueChat(
      () => jsonResponse({
        kind: 'unavailable',
        reason: 'budget_exhausted',
        message: 'You\'ve reached the assistant limit for now. It resets daily.',
      } satisfies ChatTurnResponse),
      () => jsonResponse(answer({ message: 'You offer Gel manicure.' })),
    );

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();
    await ask('What services do I offer?');

    expect(await screen.findByTestId('owner-assistant-banner')).toHaveTextContent(
      'You\'ve reached the assistant limit for now. It resets daily.',
    );
    expect(thread().getByText('What services do I offer?')).toBeInTheDocument();
    // The question is still on screen but was never answered; say so.
    expect(screen.getByTestId('owner-assistant-unanswered')).toHaveTextContent(
      ownerAssistantCopy.notAnswered,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: ownerAssistantCopy.retry }));

    expect(await thread().findByText('You offer Gel manicure.')).toBeInTheDocument();
    expect(screen.queryByTestId('owner-assistant-unanswered')).not.toBeInTheDocument();
    expect(scenario.chatRequests).toHaveLength(2);
    expect(scenario.chatRequests[1]?.message).toBe('What services do I offer?');
    // The owner question is not duplicated in the thread by a retry.
    expect(thread().getAllByText('What services do I offer?')).toHaveLength(1);
  });

  it('shows a generic error with Retry for a server failure', async () => {
    queueContext(() => jsonResponse(contextBody()));
    queueChat(() => new Response('', { status: 500 }));

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();
    await ask('Is my page live?');

    expect(await screen.findByTestId('owner-assistant-banner')).toHaveTextContent(
      ownerAssistantCopy.networkError,
    );
    expect(screen.getByRole('button', { name: ownerAssistantCopy.retry })).toBeInTheDocument();
    expect(screen.getByTestId('owner-assistant-unanswered')).toHaveTextContent(
      ownerAssistantCopy.notAnswered,
    );
  });

  it('re-sends the refused message once on a fresh conversation (409)', async () => {
    queueContext(() => jsonResponse(contextBody()));
    queueChat(
      () => jsonResponse(answer()),
      () => jsonResponse({ error: { code: 'CONVERSATION_INVALID' } }, 409),
      () => jsonResponse(answer({ message: 'Two add-ons: nail art and French tips.', conversation: 'token-2' })),
    );

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();
    await ask('What services do I offer?');

    expect(await thread().findByText('You offer Gel manicure and Pedicure.')).toBeInTheDocument();

    await ask('and the add-ons?');

    // The refused window is dropped and the owner is told, but the question
    // itself is answered rather than lost.
    expect(await thread().findByText('Two add-ons: nail art and French tips.')).toBeInTheDocument();
    expect(screen.getByTestId('owner-assistant-notice')).toHaveTextContent(
      ownerAssistantCopy.conversationReset,
    );
    expect(thread().queryByText('You offer Gel manicure and Pedicure.')).not.toBeInTheDocument();
    expect(thread().getAllByText('and the add-ons?')).toHaveLength(1);
    expect(scenario.chatRequests[1]).toEqual({
      salonSlug: SALON_SLUG,
      message: 'and the add-ons?',
      locale: 'en',
      conversation: 'token-1',
    });
    expect(scenario.chatRequests[2]).toEqual({
      salonSlug: SALON_SLUG,
      message: 'and the add-ons?',
      locale: 'en',
    });
  });

  it('gives the message back to the composer when the fresh conversation is refused too', async () => {
    queueContext(() => jsonResponse(contextBody()));
    queueChat(
      () => jsonResponse(answer()),
      () => jsonResponse({ error: { code: 'CONVERSATION_INVALID' } }, 409),
      () => jsonResponse({ error: { code: 'CONVERSATION_INVALID' } }, 409),
    );

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();
    await ask('What services do I offer?');

    expect(await thread().findByText('You offer Gel manicure and Pedicure.')).toBeInTheDocument();

    await ask('and the add-ons?');

    await waitFor(() => expect(composer()).toHaveValue('and the add-ons?'));

    expect(screen.getByTestId('owner-assistant-notice')).toHaveTextContent(
      ownerAssistantCopy.conversationReset,
    );
    expect(thread().queryByText('and the add-ons?')).not.toBeInTheDocument();
    expect(screen.getByTestId('owner-assistant-empty-state')).toBeInTheDocument();
    expect(scenario.chatRequests).toHaveLength(3);
    expect(scenario.chatRequests[2]?.conversation).toBeUndefined();
    expect(window.sessionStorage.getItem(ownerAssistantStorageKey(SALON_SLUG))).toBeNull();
  });

  it('ignores a link chip whose href leaves this origin', async () => {
    queueContext(() => jsonResponse(contextBody()));
    queueChat(() => jsonResponse(answer({
      message: 'Hours live in Settings.',
      links: [{ key: 'business_hours', label: 'Business hours', href: 'https://evil.example/x' }],
    })));

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();
    await ask('Where do I change my hours?');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Business hours' }));

    expect(routerPush).not.toHaveBeenCalled();
    expect(screen.getByTestId('owner-assistant-sheet')).toBeInTheDocument();
  });

  it('ignores a protocol-relative link chip href', async () => {
    queueContext(() => jsonResponse(contextBody()));
    queueChat(() => jsonResponse(answer({
      message: 'Hours live in Settings.',
      links: [{ key: 'business_hours', label: 'Business hours', href: '//evil.example/x' }],
    })));

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();
    await ask('Where do I change my hours?');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Business hours' }));

    expect(routerPush).not.toHaveBeenCalled();
    expect(screen.getByTestId('owner-assistant-sheet')).toBeInTheDocument();
  });
});

describe('OwnerAssistantLauncher — composer', () => {
  it('counts characters, caps them at the contract limit and sends on Enter', async () => {
    queueContext(() => jsonResponse(contextBody()));
    queueChat(() => jsonResponse(answer({ message: 'Yes, your page is live.' })));

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();

    const textarea = composer();

    expect(textarea).toHaveFocus();
    expect(textarea).toHaveAttribute('maxlength', String(OWNER_ASSISTANT_LIMITS.messageMaxChars));
    expect(textarea).toHaveAttribute('enterkeyhint', 'send');
    expect(screen.getByTestId('owner-assistant-counter')).toHaveTextContent(
      `0/${OWNER_ASSISTANT_LIMITS.messageMaxChars}`,
    );
    // An aria-label on a <p> would replace the number a sighted owner reads.
    expect(screen.getByTestId('owner-assistant-counter')).not.toHaveAttribute('aria-label');
    expect(screen.getByTestId('owner-assistant-counter')).toHaveTextContent(
      ownerAssistantCopy.counterLabel,
    );

    const user = userEvent.setup();
    await user.type(textarea, 'Is my page live?');

    expect(screen.getByTestId('owner-assistant-counter')).toHaveTextContent(
      `16/${OWNER_ASSISTANT_LIMITS.messageMaxChars}`,
    );

    await user.keyboard('{Enter}');

    expect(await thread().findByText('Yes, your page is live.')).toBeInTheDocument();
    expect(scenario.chatRequests[0]?.message).toBe('Is my page live?');
    expect(composer()).toHaveValue('');
  });

  it('keeps the composer focusable and announces the wait while a turn is in flight', async () => {
    queueContext(() => jsonResponse(contextBody()));

    const inFlight = deferredChat(answer({ message: 'Yes, your page is live.' }));

    queueChat(inFlight.queue);

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();
    await ask('Is my page live?');

    const busy = await screen.findByTestId('owner-assistant-busy');

    expect(busy).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('owner-assistant-thread')).toHaveAttribute('aria-busy', 'true');
    // `disabled` would throw keyboard focus out of the dialog for the whole turn.
    expect(composer()).toBeEnabled();
    expect(composer()).toHaveAttribute('readonly');
    expect(composer()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: ownerAssistantCopy.send })).toBeDisabled();
    expect(screen.getByTestId('owner-assistant-sheet')).toContainElement(
      document.activeElement as HTMLElement,
    );

    inFlight.release();

    expect(await thread().findByText('Yes, your page is live.')).toBeInTheDocument();

    await waitFor(() => expect(composer()).toHaveFocus());

    expect(composer()).not.toHaveAttribute('readonly');
    expect(screen.getByTestId('owner-assistant-thread')).toHaveAttribute('aria-busy', 'false');
  });

  it('keeps the composer clear of the home indicator', async () => {
    queueContext(() => jsonResponse(contextBody()));

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();

    // `viewportFit: 'cover'` in the root layout means the inset is ours to add.
    expect(screen.getByTestId('owner-assistant-composer-bar')).toHaveClass(
      'pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]',
    );
    expect(screen.getByTestId('owner-assistant-sheet')).toHaveClass(
      'max-h-[calc(100dvh-1rem-env(safe-area-inset-bottom,0px))]',
    );
  });

  it('keeps a Shift+Enter newline in the draft instead of sending', async () => {
    queueContext(() => jsonResponse(contextBody()));

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();

    const user = userEvent.setup();
    await user.type(composer(), 'first{Shift>}{Enter}{/Shift}second');

    expect(composer()).toHaveValue('first\nsecond');
    expect(scenario.chatRequests).toHaveLength(0);
  });
});

describe('OwnerAssistantLauncher — persistence', () => {
  it('drops a stored thread that belongs to a different owner of the same salon', async () => {
    window.sessionStorage.setItem(
      ownerAssistantStorageKey(SALON_SLUG),
      JSON.stringify({
        ownerRef: 'someone-else',
        conversation: 'token-other',
        messages: [{ id: 'm1', role: 'assistant', text: 'Another owner answer.' }],
      }),
    );
    queueContext(() => jsonResponse(contextBody()));

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();

    expect(screen.queryByText('Another owner answer.')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(ownerAssistantStorageKey(SALON_SLUG))).toBeNull();
  });

  it('stores the thread and the token, and restores them on a remount', async () => {
    queueContext(() => jsonResponse(contextBody()), () => jsonResponse(contextBody()));
    queueChat(
      () => jsonResponse(answer()),
      () => jsonResponse(answer({ message: 'Two add-ons.', conversation: 'token-2' })),
    );

    const first = render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();
    await ask('What services do I offer?');

    expect(await thread().findByText('You offer Gel manicure and Pedicure.')).toBeInTheDocument();

    const stored = JSON.parse(
      window.sessionStorage.getItem(ownerAssistantStorageKey(SALON_SLUG)) ?? 'null',
    ) as { conversation: string; messages: unknown[] };

    expect(stored.conversation).toBe('token-1');
    expect(stored.messages).toHaveLength(2);

    first.unmount();

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();

    expect(thread().getByText('You offer Gel manicure and Pedicure.')).toBeInTheDocument();

    await ask('and the add-ons?');

    expect(await thread().findByText('Two add-ons.')).toBeInTheDocument();
    expect(scenario.chatRequests[1]?.conversation).toBe('token-1');
  });

  it('closes the sheet and clears the thread when the active salon changes', async () => {
    queueContext(
      () => jsonResponse(contextBody()),
      () => jsonResponse(contextBody(OTHER_SLUG, 'Nail Salon No5')),
    );
    queueChat(() => jsonResponse(answer()));

    const view = render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();
    await ask('What services do I offer?');

    expect(await thread().findByText('You offer Gel manicure and Pedicure.')).toBeInTheDocument();
    expect(window.sessionStorage.getItem(ownerAssistantStorageKey(SALON_SLUG))).not.toBeNull();

    view.rerender(<OwnerAssistantLauncher locale="en" salonSlug={OTHER_SLUG} />);

    // An open sheet must never survive the switch onto another salon.
    await waitFor(() => expect(screen.queryByTestId('owner-assistant-sheet')).not.toBeInTheDocument());

    await openSheet();

    expect(screen.getByText('Nail Salon No5')).toBeInTheDocument();
    expect(thread().queryByText('You offer Gel manicure and Pedicure.')).not.toBeInTheDocument();
    expect(screen.getByTestId('owner-assistant-empty-state')).toBeInTheDocument();
    expect(window.sessionStorage.getItem(ownerAssistantStorageKey(SALON_SLUG))).toBeNull();
    expect(window.sessionStorage.getItem(ownerAssistantStorageKey(OTHER_SLUG))).toBeNull();
  });

  it('starts a fresh conversation on request', async () => {
    queueContext(() => jsonResponse(contextBody()));
    queueChat(
      () => jsonResponse(answer()),
      () => jsonResponse(answer({ message: 'Starting over.', conversation: 'token-9' })),
    );

    render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
    await openSheet();
    await ask('What services do I offer?');

    expect(await thread().findByText('You offer Gel manicure and Pedicure.')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: ownerAssistantCopy.newConversation }));

    expect(screen.getByTestId('owner-assistant-empty-state')).toBeInTheDocument();
    expect(window.sessionStorage.getItem(ownerAssistantStorageKey(SALON_SLUG))).toBeNull();

    await ask('What services do I offer?');

    expect(await thread().findByText('Starting over.')).toBeInTheDocument();
    expect(scenario.chatRequests[1]?.conversation).toBeUndefined();
  });
});
