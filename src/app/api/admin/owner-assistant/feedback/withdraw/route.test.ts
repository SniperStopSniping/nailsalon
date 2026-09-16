/**
 * The withdrawal route's admission matrix.
 *
 * Same normative order as its sibling (dark → parse → salon → real owner →
 * entitlement → work), plus the one property specific to a retraction: it
 * carries the `feedbackId` and nothing else that could be mistaken for
 * content — the schema has no `text` field at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envHolder = vi.hoisted(() => ({
  CLERK_SECRET_KEY: 'sk_test_withdraw',
  NODE_ENV: 'test' as string,
  OWNER_ASSISTANT_ENABLED: 'true' as string | undefined,
  OWNER_ASSISTANT_SALON_ALLOWLIST: 'isla-nail-studio' as string | undefined,
  OPENAI_API_KEY_OWNER: 'sk-owner-test' as string | undefined,
  OWNER_ASSISTANT_SIGNING_SECRET: 'withdraw-test-secret' as string | undefined,
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

const store = vi.hoisted(() => ({ withdraw: vi.fn() }));
vi.mock('@/libs/ownerAssistant/feedback.server', () => ({
  recordOwnerAssistantFeedbackWithdrawal: (...callArgs: unknown[]) => store.withdraw(...callArgs),
}));

const { POST, dynamic, maxDuration, runtime } = await import('./route');

const SALON = { id: 'salon_feedback', slug: 'isla-nail-studio', name: 'Isla Nail Studio', features: null };

const VALID_BODY = {
  salonSlug: 'isla-nail-studio',
  feedbackId: '8f1c2d3e-0000-4000-8000-0123456789ab',
};

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/admin/owner-assistant/feedback/withdraw', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }));

beforeEach(() => {
  vi.clearAllMocks();
  envHolder.OWNER_ASSISTANT_ENABLED = 'true';
  envHolder.OWNER_ASSISTANT_SALON_ALLOWLIST = 'isla-nail-studio';
  guards.salonResult = { error: null, salon: SALON, admin: { id: 'admin_1' }, impersonation: null };
  guards.ownerResult = { ok: true, admin: { id: 'admin_1', clerkUserId: 'user_1' } };
  store.withdraw.mockResolvedValue(undefined);
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

    expect((await post(VALID_BODY)).status).toBe(404);
    expect(guards.requireAdminSalonForSlug).not.toHaveBeenCalled();
    expect(store.withdraw).not.toHaveBeenCalled();
  });

  it('answers 404 for a salon that is not on the pilot, after authorizing it', async () => {
    envHolder.OWNER_ASSISTANT_SALON_ALLOWLIST = 'a-different-salon';

    expect((await post(VALID_BODY)).status).toBe(404);
    expect(guards.requireRealSalonOwner).toHaveBeenCalledWith('salon_feedback');
    expect(store.withdraw).not.toHaveBeenCalled();
  });
});

describe('body validation', () => {
  it.each([
    ['no body at all', 'not json'],
    ['missing slug', { feedbackId: VALID_BODY.feedbackId }],
    ['missing feedbackId', { salonSlug: 'isla-nail-studio' }],
    ['a feedbackId that is not url-safe', { ...VALID_BODY, feedbackId: 'has spaces' }],
    ['an unknown key', { ...VALID_BODY, salonId: 'salon_other' }],
    ['a kind, which a withdrawal does not take', { ...VALID_BODY, kind: 'up' }],
    ['text, which a withdrawal may never carry', { ...VALID_BODY, text: 'never mind' }],
  ])('answers 400 BAD_REQUEST for %s', async (_label, body) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'BAD_REQUEST', message: 'Invalid request.' },
    });
    expect(store.withdraw).not.toHaveBeenCalled();
  });
});

describe('guards', () => {
  it('propagates the salon guard error verbatim', async () => {
    guards.salonResult = {
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      salon: null,
      admin: null,
      impersonation: null,
    };

    expect((await post(VALID_BODY)).status).toBe(401);
    expect(store.withdraw).not.toHaveBeenCalled();
  });

  it.each([
    ['a collaborator', 'OWNER_REQUIRED'],
    ['an impersonating super admin', 'IMPERSONATION_NOT_ALLOWED'],
  ])('refuses %s', async (_label, code) => {
    guards.ownerResult = {
      ok: false,
      response: new Response(JSON.stringify({ error: { code, message: 'no' } }), { status: 403 }),
    };

    const response = await post(VALID_BODY);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
    expect(store.withdraw).not.toHaveBeenCalled();
  });

  it('does not persist the active salon cookie', async () => {
    await post(VALID_BODY);

    expect(guards.requireAdminSalonForSlug)
      .toHaveBeenCalledWith('isla-nail-studio', { persistActiveSalon: false });
  });
});

describe('a recorded withdrawal', () => {
  it('names the same feedbackId, with the salon and actor from the session', async () => {
    const response = await post({ ...VALID_BODY, conversationId: 'cid-abcdefgh', turnIndex: 1 });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { feedbackId: VALID_BODY.feedbackId, receivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
    });
    expect(store.withdraw).toHaveBeenCalledWith({
      salonId: 'salon_feedback',
      performedBy: 'user_1',
      feedbackId: VALID_BODY.feedbackId,
      conversationId: 'cid-abcdefgh',
      turnIndex: 1,
    });
  });

  it('reports a failed write rather than claiming the withdrawal was saved', async () => {
    store.withdraw.mockRejectedValue(new Error('insert failed'));

    const response = await post(VALID_BODY);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'FEEDBACK_NOT_RECORDED' } });
  });

  it('never caches', async () => {
    expect((await post(VALID_BODY)).headers.get('Cache-Control')).toBe('private, no-store');
  });
});
