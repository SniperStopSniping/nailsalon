/**
 * The chat route's admission matrix (docs/OWNER_ASSISTANT_CHAT.md §3.1, §4).
 *
 * The turn itself is exercised in turn.server.test.ts; what is pinned here is
 * the ORDER and the envelopes — dark before auth, body before guards, guards
 * before entitlement, entitlement before any work — plus the one error the
 * turn is allowed to throw (409 CONVERSATION_INVALID) and the fact that a
 * salon can never be named by the body.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envHolder = vi.hoisted(() => ({
  CLERK_SECRET_KEY: 'sk_test_chat',
  NODE_ENV: 'test' as string,
  OWNER_ASSISTANT_ENABLED: 'true' as string | undefined,
  OWNER_ASSISTANT_SALON_ALLOWLIST: 'isla-nail-studio' as string | undefined,
  OWNER_ASSISTANT_TOOLS: 'list_services' as string | undefined,
  OWNER_ASSISTANT_MODEL: undefined as string | undefined,
  OWNER_ASSISTANT_JSON_MODE: undefined as string | undefined,
  OPENAI_API_KEY_OWNER: 'sk-owner-test' as string | undefined,
  OWNER_ASSISTANT_SIGNING_SECRET: 'chat-test-secret' as string | undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));
vi.mock('@/core/redis/redisClient', () => ({ redis: { eval: vi.fn(async () => 0) } }));

const guards = vi.hoisted(() => ({
  salonResult: null as unknown,
  ownerResult: null as unknown,
  requireAdminSalonForSlug: vi.fn(),
  requireRealSalonOwner: vi.fn(),
}));
vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalonForSlug: (...callArgs: unknown[]) => {
    guards.requireAdminSalonForSlug(...callArgs);
    return Promise.resolve(guards.salonResult);
  },
  requireRealSalonOwner: (...callArgs: unknown[]) => {
    guards.requireRealSalonOwner(...callArgs);
    return Promise.resolve(guards.ownerResult);
  },
}));

const turnHolder = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/libs/ownerAssistant/turn.server', () => ({
  runOwnerAssistantTurn: (...callArgs: unknown[]) => turnHolder.run(...callArgs),
}));

const { POST, dynamic, maxDuration, runtime } = await import('./route');
const { ConversationInvalidError } = await import('@/libs/ownerAssistant/conversation.server');
const { OWNER_ASSISTANT_LIMITS } = await import('@/libs/ownerAssistant/contracts');

const SALON = { id: 'salon_chat', slug: 'isla-nail-studio', name: 'Isla Nail Studio', features: null };

const ANSWER = {
  kind: 'answer' as const,
  message: 'You offer 2 services.',
  checked: [{ tool: 'list_services' as const, label: 'your services list' }],
  links: [],
  followUps: [],
  needsClarification: false,
  conversation: 'signed.token',
  usage: { modelCalls: 1, toolCalls: 1 },
};

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/admin/owner-assistant/chat', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }));

const VALID_BODY = { salonSlug: 'isla-nail-studio', message: 'what services do I offer?' };

beforeEach(() => {
  vi.clearAllMocks();
  envHolder.OWNER_ASSISTANT_ENABLED = 'true';
  envHolder.OWNER_ASSISTANT_SALON_ALLOWLIST = 'isla-nail-studio';
  guards.salonResult = { error: null, salon: SALON, admin: { id: 'admin_1' }, impersonation: null };
  guards.ownerResult = { ok: true, admin: { id: 'admin_1', clerkUserId: 'user_1' } };
  turnHolder.run.mockResolvedValue(ANSWER);
});

describe('route configuration', () => {
  it('is dynamic, node, and declares the documented maxDuration inline', () => {
    expect(dynamic).toBe('force-dynamic');
    expect(runtime).toBe('nodejs');
    expect(maxDuration).toBe(60);
  });
});

describe('dark posture', () => {
  it.each([undefined, 'false', ''])('answers 404 before auth while the switch is %j', async (value) => {
    envHolder.OWNER_ASSISTANT_ENABLED = value;

    const response = await post(VALID_BODY);

    expect(response.status).toBe(404);
    expect(guards.requireAdminSalonForSlug).not.toHaveBeenCalled();
    expect(turnHolder.run).not.toHaveBeenCalled();
  });

  it('answers 404 for a salon that is not on the pilot, after authorizing it', async () => {
    envHolder.OWNER_ASSISTANT_SALON_ALLOWLIST = 'a-different-salon';

    const response = await post(VALID_BODY);

    expect(response.status).toBe(404);
    expect(guards.requireRealSalonOwner).toHaveBeenCalledWith('salon_chat');
    expect(turnHolder.run).not.toHaveBeenCalled();
  });
});

describe('body validation', () => {
  it.each([
    ['no body at all', 'not json'],
    ['missing slug', { message: 'hi' }],
    ['empty slug', { salonSlug: '  ', message: 'hi' }],
    ['missing message', { salonSlug: 'isla-nail-studio' }],
    ['empty message', { salonSlug: 'isla-nail-studio', message: '   ' }],
    ['non-string message', { salonSlug: 'isla-nail-studio', message: 42 }],
    ['unknown locale', { salonSlug: 'isla-nail-studio', message: 'hi', locale: 'de' }],
  ])('answers 400 BAD_REQUEST for %s', async (_label, body) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'BAD_REQUEST', message: 'Invalid request.' },
    });
    expect(guards.requireAdminSalonForSlug).not.toHaveBeenCalled();
  });

  it('rejects extra body keys, so a client cannot name a salon id', async () => {
    const response = await post({ ...VALID_BODY, salonId: 'salon_other' });

    expect(response.status).toBe(400);
    expect(guards.requireAdminSalonForSlug).not.toHaveBeenCalled();
  });

  it('rejects a message longer than the documented cap', async () => {
    const response = await post({
      ...VALID_BODY,
      message: 'a'.repeat(OWNER_ASSISTANT_LIMITS.messageMaxChars + 1),
    });

    expect(response.status).toBe(400);
  });
});

describe('guards', () => {
  it('propagates a 401 from the salon guard', async () => {
    guards.salonResult = {
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      salon: null,
      admin: null,
      impersonation: null,
    };

    expect((await post(VALID_BODY)).status).toBe(401);
    expect(guards.requireRealSalonOwner).not.toHaveBeenCalled();
  });

  it('propagates a 403 from the salon guard (scope mismatch)', async () => {
    guards.salonResult = {
      error: new Response(JSON.stringify({ error: { code: 'SALON_SCOPE_MISMATCH' } }), { status: 403 }),
      salon: null,
      admin: null,
      impersonation: null,
    };

    await expect((await post(VALID_BODY)).json()).resolves.toMatchObject({
      error: { code: 'SALON_SCOPE_MISMATCH' },
    });
  });

  it.each([
    ['UNAUTHORIZED', 401],
    ['OWNER_REQUIRED', 403],
    ['IMPERSONATION_NOT_ALLOWED', 403],
  ])('propagates the owner guard\'s %s', async (code, status) => {
    guards.ownerResult = {
      ok: false,
      response: new Response(JSON.stringify({ error: { code, message: 'no' } }), { status }),
    };

    const response = await post(VALID_BODY);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
    expect(turnHolder.run).not.toHaveBeenCalled();
  });

  it('never persists the active salon cookie', async () => {
    await post(VALID_BODY);

    expect(guards.requireAdminSalonForSlug)
      .toHaveBeenCalledWith('isla-nail-studio', { persistActiveSalon: false });
  });
});

describe('turn handoff', () => {
  it('passes the session-resolved salon and admin, never anything from the body', async () => {
    await post({ ...VALID_BODY, conversation: 'prev.token', locale: 'fr' });

    expect(turnHolder.run).toHaveBeenCalledWith({
      salon: { id: 'salon_chat', slug: 'isla-nail-studio', name: 'Isla Nail Studio' },
      admin: { id: 'admin_1', clerkUserId: 'user_1' },
      message: 'what services do I offer?',
      conversationToken: 'prev.token',
      locale: 'fr',
    });
  });

  it('returns the answer in a data envelope with no caching', async () => {
    const response = await post(VALID_BODY);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ data: ANSWER });
  });

  it('returns an unavailable turn as 200, not as an error', async () => {
    turnHolder.run.mockResolvedValue({
      kind: 'unavailable',
      reason: 'budget_exhausted',
      message: 'You\'ve reached the assistant limit for now. It resets daily.',
    });

    const response = await post(VALID_BODY);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { kind: 'unavailable', reason: 'budget_exhausted' },
    });
  });

  it('answers 409 CONVERSATION_INVALID when the turn refuses the token', async () => {
    turnHolder.run.mockRejectedValue(new ConversationInvalidError('signature'));

    const response = await post({ ...VALID_BODY, conversation: 'tampered.token' });

    expect(response.status).toBe(409);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      error: { code: 'CONVERSATION_INVALID', message: 'Start a new conversation.' },
    });
  });

  it('does not swallow an unexpected fault as a 409', async () => {
    turnHolder.run.mockRejectedValue(new Error('something else entirely'));

    await expect(post(VALID_BODY)).rejects.toThrow('something else entirely');
  });
});
