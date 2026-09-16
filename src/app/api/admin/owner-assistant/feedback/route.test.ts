/**
 * The feedback route's admission matrix (docs/OWNER_ASSISTANT_CHAT.md §3.1).
 *
 * The writer itself is exercised in `feedback.server.test.ts`; what is pinned
 * here is the ORDER — dark before parsing and before auth, body before guards,
 * guards before entitlement, entitlement before any write — plus the two
 * properties that make this endpoint safe to expose: a client can never name a
 * salon (`.strict()` bodies, identity from the session), and the GET can never
 * hand one owner another owner's rows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envHolder = vi.hoisted(() => ({
  CLERK_SECRET_KEY: 'sk_test_feedback',
  NODE_ENV: 'test' as string,
  OWNER_ASSISTANT_ENABLED: 'true' as string | undefined,
  OWNER_ASSISTANT_SALON_ALLOWLIST: 'isla-nail-studio' as string | undefined,
  OWNER_ASSISTANT_TOOLS: 'list_services' as string | undefined,
  OPENAI_API_KEY_OWNER: 'sk-owner-test' as string | undefined,
  OWNER_ASSISTANT_SIGNING_SECRET: 'feedback-test-secret' as string | undefined,
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

const store = vi.hoisted(() => ({
  record: vi.fn(),
  list: vi.fn(),
}));
vi.mock('@/libs/ownerAssistant/feedback.server', () => ({
  recordOwnerAssistantFeedback: (...callArgs: unknown[]) => store.record(...callArgs),
  listOwnerAssistantFeedback: (...callArgs: unknown[]) => store.list(...callArgs),
}));

const { GET, POST, dynamic, maxDuration, runtime } = await import('./route');

const SALON = { id: 'salon_feedback', slug: 'isla-nail-studio', name: 'Isla Nail Studio', features: null };

const VALID_BODY = {
  salonSlug: 'isla-nail-studio',
  feedbackId: '8f1c2d3e-0000-4000-8000-0123456789ab',
  kind: 'up' as const,
};

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/admin/owner-assistant/feedback', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }));

const get = (search = '?salonSlug=isla-nail-studio') =>
  GET(new Request(`http://localhost/api/admin/owner-assistant/feedback${search}`));

beforeEach(() => {
  vi.clearAllMocks();
  envHolder.OWNER_ASSISTANT_ENABLED = 'true';
  envHolder.OWNER_ASSISTANT_SALON_ALLOWLIST = 'isla-nail-studio';
  guards.salonResult = { error: null, salon: SALON, admin: { id: 'admin_1' }, impersonation: null };
  guards.ownerResult = { ok: true, admin: { id: 'admin_1', clerkUserId: 'user_1' } };
  store.record.mockResolvedValue(undefined);
  store.list.mockResolvedValue([]);
});

describe('route configuration', () => {
  it('is dynamic, node, and declares the documented maxDuration inline', () => {
    expect(dynamic).toBe('force-dynamic');
    expect(runtime).toBe('nodejs');
    expect(maxDuration).toBe(60);
  });
});

describe('dark posture', () => {
  it.each([undefined, 'false', 'TRUE', ''])('answers 404 before auth while the switch is %j', async (value) => {
    envHolder.OWNER_ASSISTANT_ENABLED = value;

    const posted = await post(VALID_BODY);
    const listed = await get();

    expect(posted.status).toBe(404);
    expect(listed.status).toBe(404);
    expect(guards.requireAdminSalonForSlug).not.toHaveBeenCalled();
    expect(guards.requireRealSalonOwner).not.toHaveBeenCalled();
    expect(store.record).not.toHaveBeenCalled();
    expect(store.list).not.toHaveBeenCalled();
  });

  it('answers 404 before parsing, so a malformed body cannot reveal the switch', async () => {
    envHolder.OWNER_ASSISTANT_ENABLED = undefined;

    // The same body answers 400 when the feature is on (asserted below); while
    // dark it must answer 404, or the status code becomes an oracle.
    expect((await post('not json')).status).toBe(404);
  });

  it('answers 404 for a salon that is not on the pilot, after authorizing it', async () => {
    envHolder.OWNER_ASSISTANT_SALON_ALLOWLIST = 'a-different-salon';

    const posted = await post(VALID_BODY);

    expect(posted.status).toBe(404);
    expect(guards.requireRealSalonOwner).toHaveBeenCalledWith('salon_feedback');
    expect(store.record).not.toHaveBeenCalled();
    expect((await get()).status).toBe(404);
  });
});

describe('body validation', () => {
  it.each([
    ['no body at all', 'not json'],
    ['missing slug', { feedbackId: VALID_BODY.feedbackId, kind: 'up' }],
    ['empty slug', { ...VALID_BODY, salonSlug: '  ' }],
    ['missing feedbackId', { salonSlug: 'isla-nail-studio', kind: 'up' }],
    ['a feedbackId that is not url-safe', { ...VALID_BODY, feedbackId: 'no spaces allowed' }],
    ['a feedbackId that is too short', { ...VALID_BODY, feedbackId: 'short' }],
    ['an unknown kind', { ...VALID_BODY, kind: 'sideways' }],
    ['a negative turn index', { ...VALID_BODY, turnIndex: -1 }],
    ['a fractional turn index', { ...VALID_BODY, turnIndex: 1.5 }],
    ['an unknown card kind', { ...VALID_BODY, cardKind: 'banner' }],
    ['an unknown reason code', { ...VALID_BODY, kind: 'report', reasonCodes: ['because'] }],
    ['a conversation id that is not opaque', { ...VALID_BODY, conversationId: 'sel ect *' }],
  ])('answers 400 BAD_REQUEST for %s', async (_label, body) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'BAD_REQUEST', message: 'Invalid request.' },
    });
    expect(guards.requireAdminSalonForSlug).not.toHaveBeenCalled();
    expect(store.record).not.toHaveBeenCalled();
  });

  it('rejects extra body keys, so a client cannot name a salon id', async () => {
    const response = await post({ ...VALID_BODY, salonId: 'salon_other' });

    expect(response.status).toBe(400);
    expect(guards.requireAdminSalonForSlug).not.toHaveBeenCalled();
  });

  it.each(['up', 'down'] as const)('refuses free text on a %s rating', async (kind) => {
    const response = await post({ ...VALID_BODY, kind, text: 'a sentence a rating may not carry' });

    expect(response.status).toBe(400);
    expect(store.record).not.toHaveBeenCalled();
  });

  it('refuses report text beyond the documented cap', async () => {
    const response = await post({ ...VALID_BODY, kind: 'report', text: 'x'.repeat(1001) });

    expect(response.status).toBe(400);
  });

  it('refuses the conversation token itself — only the id may be sent', async () => {
    // The signed window is deliberately not part of this contract: a transcript
    // has no business reaching the feedback endpoint at all.
    const response = await post({ ...VALID_BODY, conversation: 'payload.signature' });

    expect(response.status).toBe(400);
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
    expect(guards.requireRealSalonOwner).not.toHaveBeenCalled();
    expect(store.record).not.toHaveBeenCalled();
  });

  it('does not persist the active salon cookie', async () => {
    await post(VALID_BODY);

    expect(guards.requireAdminSalonForSlug)
      .toHaveBeenCalledWith('isla-nail-studio', { persistActiveSalon: false });
  });

  it('refuses a collaborator who is not the owner', async () => {
    guards.ownerResult = {
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'OWNER_REQUIRED', message: 'no' } }), { status: 403 }),
    };

    const response = await post(VALID_BODY);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'OWNER_REQUIRED' } });
    expect(store.record).not.toHaveBeenCalled();
  });

  it('refuses an impersonating super admin', async () => {
    guards.ownerResult = {
      ok: false,
      response: new Response(
        JSON.stringify({ error: { code: 'IMPERSONATION_NOT_ALLOWED', message: 'no' } }),
        { status: 403 },
      ),
    };

    await expect((await post(VALID_BODY)).json()).resolves.toMatchObject({
      error: { code: 'IMPERSONATION_NOT_ALLOWED' },
    });
    expect(store.record).not.toHaveBeenCalled();
  });

  it('refuses an owner of a different salon (the guard sees the resolved id)', async () => {
    guards.ownerResult = {
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'OWNER_REQUIRED', message: 'no' } }), { status: 403 }),
    };

    await post(VALID_BODY);

    expect(guards.requireRealSalonOwner).toHaveBeenCalledWith('salon_feedback');
  });
});

describe('a recorded rating', () => {
  it('writes the row with the salon and actor from the session, and answers 200', async () => {
    const response = await post({
      ...VALID_BODY,
      kind: 'down',
      conversationId: 'cid-abcdefgh',
      turnIndex: 3,
      cardKind: 'answer',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        feedbackId: VALID_BODY.feedbackId,
        receivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
    });
    expect(store.record).toHaveBeenCalledWith({
      salonId: 'salon_feedback',
      performedBy: 'user_1',
      feedbackId: VALID_BODY.feedbackId,
      kind: 'down',
      conversationId: 'cid-abcdefgh',
      turnIndex: 3,
      cardKind: 'answer',
      reasonCodes: undefined,
      text: undefined,
    });
  });

  it('accepts a report with the owner\'s own text', async () => {
    await post({ ...VALID_BODY, kind: 'report', text: '  it said my page was live  ' });

    expect(store.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'report',
      // zod trims before the writer ever sees it.
      text: 'it said my page was live',
    }));
  });

  it('falls back to the admin id when there is no Clerk user id', async () => {
    guards.ownerResult = { ok: true, admin: { id: 'admin_1', clerkUserId: null } };

    await post(VALID_BODY);

    expect(store.record).toHaveBeenCalledWith(expect.objectContaining({ performedBy: 'admin_1' }));
  });

  it('reports a failed write rather than claiming the feedback was saved', async () => {
    store.record.mockRejectedValue(new Error('insert failed'));

    const response = await post(VALID_BODY);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'FEEDBACK_NOT_RECORDED' },
    });
  });

  it('never caches', async () => {
    expect((await post(VALID_BODY)).headers.get('Cache-Control')).toBe('private, no-store');

    envHolder.OWNER_ASSISTANT_ENABLED = undefined;

    expect((await post(VALID_BODY)).headers.get('Cache-Control')).toBe('private, no-store');
  });
});

describe('listing own feedback', () => {
  it('asks the reader for this owner\'s rows in this salon only', async () => {
    store.list.mockResolvedValue([
      { feedbackId: 'fb-2', kind: 'down', createdAt: '2026-09-16T10:01:00.000Z', withdrawn: false },
      { feedbackId: 'fb-1', kind: 'up', createdAt: '2026-09-16T10:00:00.000Z', withdrawn: true },
    ]);

    const response = await get();

    expect(response.status).toBe(200);
    expect(store.list).toHaveBeenCalledWith({ salonId: 'salon_feedback', performedBy: 'user_1' });
    await expect(response.json()).resolves.toEqual({
      data: {
        items: [
          { feedbackId: 'fb-2', kind: 'down', createdAt: '2026-09-16T10:01:00.000Z', withdrawn: false },
          { feedbackId: 'fb-1', kind: 'up', createdAt: '2026-09-16T10:00:00.000Z', withdrawn: true },
        ],
      },
    });
  });

  it('never lets the query name the actor or the salon id', async () => {
    expect((await get('?salonSlug=isla-nail-studio&performedBy=user_2')).status).toBe(400);
    expect((await get('?salonSlug=isla-nail-studio&salonId=salon_other')).status).toBe(400);
    expect(store.list).not.toHaveBeenCalled();
  });

  it.each(['', '?salonSlug=', '?salonSlug=%20%20'])('answers 400 for a missing slug (%s)', async (search) => {
    const response = await get(search);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'BAD_REQUEST', message: 'salonSlug is required.' },
    });
    expect(guards.requireAdminSalonForSlug).not.toHaveBeenCalled();
  });

  it('propagates the owner guard refusal', async () => {
    guards.ownerResult = {
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'OWNER_REQUIRED', message: 'no' } }), { status: 403 }),
    };

    expect((await get()).status).toBe(403);
    expect(store.list).not.toHaveBeenCalled();
  });

  it('never caches', async () => {
    expect((await get()).headers.get('Cache-Control')).toBe('private, no-store');
  });
});
