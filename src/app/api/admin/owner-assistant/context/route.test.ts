/**
 * The context route is what makes the launcher appear at all, so its admission
 * matrix IS the feature's visibility posture: dark answers 404 BEFORE
 * authentication (a probe learns nothing), and a salon that is simply not on
 * the pilot answers 404 too — indistinguishable from dark, on purpose.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envHolder = vi.hoisted(() => ({
  CLERK_SECRET_KEY: 'sk_test_context',
  NODE_ENV: 'test' as string,
  OWNER_ASSISTANT_ENABLED: 'true' as string | undefined,
  OWNER_ASSISTANT_SALON_ALLOWLIST: 'isla-nail-studio' as string | undefined,
  OWNER_ASSISTANT_TOOLS: 'get_salon_overview,list_services,find_destination' as string | undefined,
  OWNER_ASSISTANT_MODEL: undefined as string | undefined,
  OWNER_ASSISTANT_JSON_MODE: undefined as string | undefined,
  OPENAI_API_KEY_OWNER: 'sk-owner-test' as string | undefined,
  OWNER_ASSISTANT_SIGNING_SECRET: 'context-test-secret' as string | undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

const redisHolder = vi.hoisted(() => ({ client: {} as unknown }));
vi.mock('@/core/redis/redisClient', () => ({
  get redis() {
    return redisHolder.client;
  },
}));

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

const { GET, maxDuration, runtime, dynamic } = await import('./route');
const { OWNER_ASSISTANT_DISCLOSURE, OWNER_ASSISTANT_SUGGESTED_QUESTIONS } = await import('@/libs/ownerAssistant/contracts');

const SALON = {
  id: 'salon_ctx',
  slug: 'isla-nail-studio',
  name: 'Isla Nail Studio',
  features: null,
};

const get = (search = '?salonSlug=isla-nail-studio') =>
  GET(new Request(`http://localhost/api/admin/owner-assistant/context${search}`));

beforeEach(() => {
  vi.clearAllMocks();
  envHolder.NODE_ENV = 'test';
  envHolder.OWNER_ASSISTANT_ENABLED = 'true';
  envHolder.OWNER_ASSISTANT_SALON_ALLOWLIST = 'isla-nail-studio';
  envHolder.OWNER_ASSISTANT_TOOLS = 'get_salon_overview,list_services,find_destination';
  envHolder.OPENAI_API_KEY_OWNER = 'sk-owner-test';
  redisHolder.client = {};
  guards.salonResult = { error: null, salon: SALON, admin: { id: 'admin_1' }, impersonation: null };
  guards.ownerResult = { ok: true, admin: { id: 'admin_1', clerkUserId: 'user_1' } };
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

    const response = await get();

    expect(response.status).toBe(404);
    expect(guards.requireAdminSalonForSlug).not.toHaveBeenCalled();
    expect(guards.requireRealSalonOwner).not.toHaveBeenCalled();
  });

  it('answers 404 for a salon that is neither allowlisted nor feature-entitled', async () => {
    envHolder.OWNER_ASSISTANT_SALON_ALLOWLIST = 'some-other-salon';

    expect((await get()).status).toBe(404);
  });

  it('does NOT admit a salon by its feature key alone in this slice (allowlist only)', async () => {
    envHolder.OWNER_ASSISTANT_SALON_ALLOWLIST = undefined;
    guards.salonResult = {
      error: null,
      salon: { ...SALON, features: { ai: { ownerAssistant: true } } },
      admin: { id: 'admin_1' },
      impersonation: null,
    };

    expect((await get()).status).toBe(404);
  });

  it('matches the allowlist case-insensitively and ignores surrounding space', async () => {
    envHolder.OWNER_ASSISTANT_SALON_ALLOWLIST = ' other-salon ,  ISLA-Nail-Studio ';

    expect((await get()).status).toBe(200);
  });
});

describe('request validation', () => {
  it.each(['', '?salonSlug=', '?salonSlug=%20%20'])('answers 400 for a missing slug (%s)', async (search) => {
    const response = await get(search);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'BAD_REQUEST', message: 'salonSlug is required.' },
    });
    expect(guards.requireAdminSalonForSlug).not.toHaveBeenCalled();
  });

  it('rejects unknown query parameters', async () => {
    expect((await get('?salonSlug=isla-nail-studio&salonId=salon_other')).status).toBe(400);
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

    const response = await get();

    expect(response.status).toBe(401);
    expect(guards.requireRealSalonOwner).not.toHaveBeenCalled();
  });

  it('does not persist the active salon cookie for a read-only probe', async () => {
    await get();

    expect(guards.requireAdminSalonForSlug)
      .toHaveBeenCalledWith('isla-nail-studio', { persistActiveSalon: false });
  });

  it('propagates the owner guard 403 verbatim', async () => {
    guards.ownerResult = {
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'OWNER_REQUIRED', message: 'no' } }), { status: 403 }),
    };

    const response = await get();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'OWNER_REQUIRED' } });
  });

  it('propagates an impersonation refusal', async () => {
    guards.ownerResult = {
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'IMPERSONATION_NOT_ALLOWED', message: 'no' } }), { status: 403 }),
    };

    await expect((await get()).json()).resolves.toMatchObject({
      error: { code: 'IMPERSONATION_NOT_ALLOWED' },
    });
    expect(guards.requireRealSalonOwner).toHaveBeenCalledWith('salon_ctx');
  });

  it('checks entitlement only AFTER both guards', async () => {
    envHolder.OWNER_ASSISTANT_SALON_ALLOWLIST = 'nope';
    await get();

    expect(guards.requireAdminSalonForSlug).toHaveBeenCalled();
    expect(guards.requireRealSalonOwner).toHaveBeenCalled();
  });
});

describe('successful context', () => {
  it('returns the enabled envelope with the enabled tools', async () => {
    const response = await get();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        enabled: true,
        salonSlug: 'isla-nail-studio',
        salonName: 'Isla Nail Studio',
        tools: ['get_salon_overview', 'list_services', 'find_destination'],
        model: { available: true },
        suggestedQuestions: [...OWNER_ASSISTANT_SUGGESTED_QUESTIONS],
        disclosure: OWNER_ASSISTANT_DISCLOSURE,
      },
    });

    const payload = await (await get()).json() as { data: { ownerRef: string } };

    expect(payload.data.ownerRef).toMatch(/^[0-9a-f]{16}$/);
  });

  it('never caches', async () => {
    expect((await get()).headers.get('Cache-Control')).toBe('private, no-store');

    envHolder.OWNER_ASSISTANT_ENABLED = undefined;

    expect((await get()).headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('reports an unusable model honestly rather than hiding the surface', async () => {
    envHolder.OPENAI_API_KEY_OWNER = undefined;

    const response = await get();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { model: { available: false, reason: 'not_configured' } },
    });
  });

  it('reports redis_unavailable when no Redis client exists', async () => {
    redisHolder.client = null;

    await expect((await get()).json()).resolves.toMatchObject({
      data: { model: { available: false, reason: 'redis_unavailable' } },
    });
  });

  it('reports no tools when the tools switch is unset', async () => {
    envHolder.OWNER_ASSISTANT_TOOLS = undefined;

    await expect((await get()).json()).resolves.toMatchObject({ data: { tools: [] } });
  });

  it('ignores an unknown tool name in the switch', async () => {
    envHolder.OWNER_ASSISTANT_TOOLS = 'list_services,delete_everything';

    await expect((await get()).json()).resolves.toMatchObject({ data: { tools: ['list_services'] } });
  });
});
