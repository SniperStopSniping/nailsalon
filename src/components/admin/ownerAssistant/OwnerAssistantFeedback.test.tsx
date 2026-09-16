/**
 * Owner Assistant feedback (A1-4b) — the control on an assistant message.
 *
 * Three product rules are pinned here, because all three are easy to lose in a
 * refactor and expensive to lose in production:
 *  - one tap, no form: a rating posts exactly once, a second identical tap
 *    posts nothing, and switching choice posts a NEW statement;
 *  - a failure is inline and honest: the control stops claiming the rating was
 *    saved, offers Retry, and the retry re-sends the SAME feedbackId;
 *  - the request carries the rating, the conversation id and the turn number,
 *    and never a word of the conversation — which is exactly what the form's
 *    disclosure tells the owner.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatTurnResponse, ContextResponse, FeedbackRequest } from '@/libs/ownerAssistant/contracts';
import {
  OWNER_ASSISTANT_DISCLOSURE,
  OWNER_ASSISTANT_FEEDBACK_LIMITS,
} from '@/libs/ownerAssistant/contracts';

import { ownerAssistantCopy } from './ownerAssistantCopy';
import OwnerAssistantLauncher from './OwnerAssistantLauncher';

const { fetchMock, routerPush } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
}));

const SALON_SLUG = 'isla-nail-studio';
const CONVERSATION_ID = 'cid-abcdefgh';
const ASSISTANT_TEXT = 'You offer Gel manicure and Pedicure.';

/**
 * A token shaped exactly like the server's: `base64url(payload).signature`.
 * The client reads `cid` out of it locally and sends only that.
 */
function signedToken(cid = CONVERSATION_ID, turnCount = 1): string {
  const payload = {
    v: 1,
    cid,
    salonId: 'salon_1',
    adminId: 'admin_1',
    iat: 1,
    exp: 2,
    turnCount,
    turns: [{ role: 'user', content: 'a secret question about my client Jane' }],
  };
  return `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

function contextBody(): ContextResponse {
  return {
    enabled: true,
    salonSlug: SALON_SLUG,
    salonName: 'Isla Nail Studio',
    ownerRef: 'owner-ref-1',
    tools: ['list_services'],
    model: { available: true },
    suggestedQuestions: ['What services do I offer?'],
    disclosure: OWNER_ASSISTANT_DISCLOSURE,
  };
}

function answer(conversation = signedToken()): ChatTurnResponse {
  return {
    kind: 'answer',
    message: ASSISTANT_TEXT,
    checked: [],
    links: [],
    followUps: [],
    needsClarification: false,
    conversation,
    usage: { modelCalls: 1, toolCalls: 1 },
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
  feedbackResponses: Array<() => Response | Promise<Response>>;
  feedbackRequests: FeedbackRequest[];
};

const scenario: Scenario = {
  contextResponses: [],
  chatResponses: [],
  feedbackResponses: [],
  feedbackRequests: [],
};

beforeEach(() => {
  scenario.contextResponses = [];
  scenario.chatResponses = [];
  scenario.feedbackResponses = [];
  scenario.feedbackRequests = [];
  routerPush.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/admin/owner-assistant/context')) {
      const next = scenario.contextResponses.shift() ?? (() => jsonResponse(contextBody()));
      return next();
    }
    if (url.includes('/api/admin/owner-assistant/feedback')) {
      scenario.feedbackRequests.push(JSON.parse(String(init?.body)) as FeedbackRequest);
      const next = scenario.feedbackResponses.shift() ?? (() => jsonResponse({
        data: { feedbackId: 'x', receivedAt: '2026-09-16T10:00:00.000Z' },
      }));
      return next();
    }
    if (url.includes('/api/admin/owner-assistant/chat')) {
      const next = scenario.chatResponses.shift() ?? (() => jsonResponse(answer()));
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

/** Render, open the sheet, ask one question and wait for the answer bubble. */
async function askOnce(): Promise<void> {
  const user = userEvent.setup();
  render(<OwnerAssistantLauncher locale="en" salonSlug={SALON_SLUG} />);
  await user.click(await screen.findByTestId('owner-assistant-launcher'));
  await screen.findByTestId('owner-assistant-sheet');
  await user.type(screen.getByLabelText(ownerAssistantCopy.composerLabel), 'what services do I offer?');
  await user.click(screen.getByRole('button', { name: ownerAssistantCopy.send }));
  await screen.findByText(ASSISTANT_TEXT);
}

function controls() {
  return within(screen.getByTestId('owner-assistant-feedback'));
}

const upButton = () => screen.getByRole('button', { name: ownerAssistantCopy.feedbackUp });
const downButton = () => screen.getByRole('button', { name: ownerAssistantCopy.feedbackDown });

describe('the control itself', () => {
  it('renders one labelled rating pair per assistant message, and none on the owner\'s', async () => {
    await askOnce();

    expect(screen.getAllByTestId('owner-assistant-feedback')).toHaveLength(1);
    expect(upButton()).toBeInTheDocument();
    expect(downButton()).toBeInTheDocument();
    expect(upButton()).toHaveAttribute('aria-pressed', 'false');
    expect(controls().getByRole('group', { name: ownerAssistantCopy.feedbackGroupLabel })).toBeInTheDocument();
  });

  it('keeps every target at the 44 px minimum', async () => {
    await askOnce();

    // `size-11` is 2.75rem = 44 px; the report affordance uses `min-h-11`.
    expect(upButton()).toHaveClass('size-11');
    expect(downButton()).toHaveClass('size-11');
    expect(screen.getByTestId('owner-assistant-report-open')).toHaveClass('min-h-11');
  });

  it('is reachable and operable from the keyboard alone', async () => {
    const user = userEvent.setup();
    await askOnce();

    upButton().focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(scenario.feedbackRequests).toHaveLength(1));

    expect(scenario.feedbackRequests[0]?.kind).toBe('up');
  });
});

describe('rating', () => {
  it('posts the rating with the conversation id and the turn number — and no conversation text', async () => {
    const user = userEvent.setup();
    await askOnce();

    await user.click(upButton());

    await waitFor(() => expect(scenario.feedbackRequests).toHaveLength(1));

    const sent = scenario.feedbackRequests[0]!;

    expect(sent).toMatchObject({
      salonSlug: SALON_SLUG,
      kind: 'up',
      cardKind: 'answer',
      conversationId: CONVERSATION_ID,
      // The first answer of a conversation is turn 0, the way the ledger counts.
      turnIndex: 0,
    });
    expect(sent.feedbackId).toMatch(/^[\w-]{8,64}$/);

    const serialized = JSON.stringify(sent);

    expect(serialized).not.toContain(ASSISTANT_TEXT);
    expect(serialized).not.toContain('what services do I offer?');
    expect(serialized).not.toContain('Jane');
    // The signed token itself never leaves the browser for this endpoint.
    expect(serialized).not.toContain('signature');
  });

  it('shows the rating as chosen and acknowledges it', async () => {
    const user = userEvent.setup();
    await askOnce();

    await user.click(downButton());

    await waitFor(() => expect(downButton()).toHaveAttribute('aria-pressed', 'true'));

    expect(await screen.findByTestId('owner-assistant-feedback-thanks')).toHaveTextContent(
      ownerAssistantCopy.feedbackThanks,
    );
    expect(upButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('sends nothing on a second tap of the same choice', async () => {
    const user = userEvent.setup();
    await askOnce();

    await user.click(upButton());
    await waitFor(() => expect(scenario.feedbackRequests).toHaveLength(1));

    await user.click(upButton());
    await user.click(upButton());

    // Still exactly one request: the rating is idempotent per message.
    expect(scenario.feedbackRequests).toHaveLength(1);
    expect(upButton()).toHaveAttribute('aria-pressed', 'true');
  });

  it('sends once even when both taps land before React repaints', async () => {
    await askOnce();

    // Both clicks inside ONE act(): React batches them, so the second handler
    // runs against the render that has not yet seen the first one's state.
    // That is why the decision to send reads a ref rather than state.
    const button = upButton();
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitFor(() => expect(upButton()).toHaveAttribute('aria-pressed', 'true'));

    expect(scenario.feedbackRequests).toHaveLength(1);
  });

  it('sends again when the owner switches choice, as a new statement', async () => {
    const user = userEvent.setup();
    await askOnce();

    await user.click(upButton());
    await waitFor(() => expect(scenario.feedbackRequests).toHaveLength(1));

    await user.click(downButton());
    await waitFor(() => expect(scenario.feedbackRequests).toHaveLength(2));

    expect(scenario.feedbackRequests.map(request => request.kind)).toEqual(['up', 'down']);
    // A different opinion is a different row, not a retry of the first one.
    expect(scenario.feedbackRequests[1]?.feedbackId).not.toBe(scenario.feedbackRequests[0]?.feedbackId);

    await waitFor(() => expect(downButton()).toHaveAttribute('aria-pressed', 'true'));

    expect(upButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('never interrupts the conversation when a rating fails, and retries with the same id', async () => {
    const user = userEvent.setup();
    scenario.feedbackResponses.push(() => new Response('', { status: 500 }));
    await askOnce();

    await user.click(upButton());

    const failure = await screen.findByTestId('owner-assistant-feedback-failed');

    expect(failure).toHaveTextContent(ownerAssistantCopy.feedbackFailed);
    // No banner, no dialog, and the control stops claiming the rating stuck.
    expect(screen.queryByTestId('owner-assistant-banner')).not.toBeInTheDocument();
    expect(upButton()).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByTestId('owner-assistant-feedback-retry'));

    await waitFor(() => expect(scenario.feedbackRequests).toHaveLength(2));

    expect(scenario.feedbackRequests[1]?.feedbackId).toBe(scenario.feedbackRequests[0]?.feedbackId);
    expect(scenario.feedbackRequests[1]?.kind).toBe('up');

    await waitFor(() => expect(upButton()).toHaveAttribute('aria-pressed', 'true'));

    expect(screen.queryByTestId('owner-assistant-feedback-failed')).not.toBeInTheDocument();
  });

  it('treats a transport failure exactly like a refusal', async () => {
    const user = userEvent.setup();
    scenario.feedbackResponses.push(() => Promise.reject(new Error('offline')));
    await askOnce();

    await user.click(downButton());

    expect(await screen.findByTestId('owner-assistant-feedback-failed')).toBeInTheDocument();
    expect(screen.getByText(ASSISTANT_TEXT)).toBeInTheDocument();
  });
});

describe('report a problem', () => {
  it('opens an inline form that states exactly what is sent', async () => {
    const user = userEvent.setup();
    await askOnce();

    await user.click(screen.getByTestId('owner-assistant-report-open'));

    const form = await screen.findByTestId('owner-assistant-report-form');

    expect(within(form).getByText(ownerAssistantCopy.reportNote)).toBeInTheDocument();
    expect(within(form).getByLabelText(ownerAssistantCopy.reportLabel)).toBeInTheDocument();
    expect(screen.getByTestId('owner-assistant-report-counter'))
      .toHaveTextContent(`0/${OWNER_ASSISTANT_FEEDBACK_LIMITS.textMaxChars}`);
  });

  it('counts characters as they are typed and caps the field at the documented limit', async () => {
    const user = userEvent.setup();
    await askOnce();
    await user.click(screen.getByTestId('owner-assistant-report-open'));

    const field = await screen.findByLabelText(ownerAssistantCopy.reportLabel);
    await user.type(field, 'it was wrong');

    expect(screen.getByTestId('owner-assistant-report-counter'))
      .toHaveTextContent(`12/${OWNER_ASSISTANT_FEEDBACK_LIMITS.textMaxChars}`);
    expect(field).toHaveAttribute('maxlength', String(OWNER_ASSISTANT_FEEDBACK_LIMITS.textMaxChars));
  });

  it('will not send an empty report', async () => {
    const user = userEvent.setup();
    await askOnce();
    await user.click(screen.getByTestId('owner-assistant-report-open'));

    expect(await screen.findByTestId('owner-assistant-report-send')).toBeDisabled();
    expect(scenario.feedbackRequests).toHaveLength(0);
  });

  it('sends the owner\'s own words, then closes and confirms', async () => {
    const user = userEvent.setup();
    await askOnce();
    await user.click(screen.getByTestId('owner-assistant-report-open'));
    await user.type(await screen.findByLabelText(ownerAssistantCopy.reportLabel), 'it said my page was live');
    await user.click(screen.getByTestId('owner-assistant-report-send'));

    await waitFor(() => expect(scenario.feedbackRequests).toHaveLength(1));

    const sent = scenario.feedbackRequests[0]!;

    expect(sent).toMatchObject({
      kind: 'report',
      text: 'it said my page was live',
      conversationId: CONVERSATION_ID,
      turnIndex: 0,
    });
    expect(JSON.stringify(sent)).not.toContain(ASSISTANT_TEXT);

    await waitFor(() => expect(screen.queryByTestId('owner-assistant-report-form')).not.toBeInTheDocument());

    expect(await screen.findByTestId('owner-assistant-report-sent')).toHaveTextContent(
      ownerAssistantCopy.reportSent,
    );
  });

  it('keeps the form open and offers another try when the report fails', async () => {
    const user = userEvent.setup();
    scenario.feedbackResponses.push(() => new Response('', { status: 500 }));
    await askOnce();
    await user.click(screen.getByTestId('owner-assistant-report-open'));
    await user.type(await screen.findByLabelText(ownerAssistantCopy.reportLabel), 'still wrong');
    await user.click(screen.getByTestId('owner-assistant-report-send'));

    expect(await screen.findByTestId('owner-assistant-report-failed')).toHaveTextContent(
      ownerAssistantCopy.reportFailed,
    );
    expect(screen.getByTestId('owner-assistant-report-form')).toBeInTheDocument();

    await user.click(screen.getByTestId('owner-assistant-report-send'));

    await waitFor(() => expect(scenario.feedbackRequests).toHaveLength(2));

    // One report, retried — not two reports.
    expect(scenario.feedbackRequests[1]?.feedbackId).toBe(scenario.feedbackRequests[0]?.feedbackId);

    await waitFor(() => expect(screen.queryByTestId('owner-assistant-report-form')).not.toBeInTheDocument());
  });

  it('closes only the form on Escape, never the whole sheet', async () => {
    const user = userEvent.setup();
    await askOnce();
    await user.click(screen.getByTestId('owner-assistant-report-open'));
    await user.type(await screen.findByLabelText(ownerAssistantCopy.reportLabel), 'half a thought{Escape}');

    await waitFor(() => expect(screen.queryByTestId('owner-assistant-report-form')).not.toBeInTheDocument());

    expect(screen.getByTestId('owner-assistant-sheet')).toBeInTheDocument();
    expect(scenario.feedbackRequests).toHaveLength(0);
  });

  it('cancels without sending anything', async () => {
    const user = userEvent.setup();
    await askOnce();
    await user.click(screen.getByTestId('owner-assistant-report-open'));
    await user.click(await screen.findByTestId('owner-assistant-report-cancel'));

    await waitFor(() => expect(screen.queryByTestId('owner-assistant-report-form')).not.toBeInTheDocument());

    expect(scenario.feedbackRequests).toHaveLength(0);
    // The sheet itself stays open: cancelling a form is not closing a dialog.
    expect(screen.getByTestId('owner-assistant-sheet')).toBeInTheDocument();
  });
});
