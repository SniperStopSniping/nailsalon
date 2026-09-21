import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const {
  requireSuperAdmin,
  checkEndpointRateLimit,
  rateLimitResponse,
  db,
  selectResults,
  tx,
  insertValues,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const insertValues: unknown[] = [];
  const tx = {
    insert: vi.fn(() => ({ values: vi.fn((value: unknown) => {
      insertValues.push(value);
      return { onConflictDoUpdate: vi.fn(async () => undefined) };
    }) })),
    update: vi.fn(),
    select: vi.fn(() => {
      const result = selectResults.shift() ?? [];
      const afterWhere = {
        for: vi.fn(() => ({ limit: vi.fn(async () => result) })),
        limit: vi.fn(async () => result),
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(result).then(resolve),
      };
      return { from: vi.fn(() => ({ where: vi.fn(() => afterWhere) })) };
    }),
  };
  return {
    requireSuperAdmin: vi.fn(),
    checkEndpointRateLimit: vi.fn(() => ({ allowed: true })),
    rateLimitResponse: vi.fn(),
    db: { transaction: vi.fn(async (callback: (handle: typeof tx) => unknown) => callback(tx)) },
    selectResults,
    insertValues,
    tx,
  };
});

vi.mock('@/libs/adminAuth', () => ({ requireSuperAdmin }));
vi.mock('@/libs/rateLimit', () => ({ checkEndpointRateLimit, rateLimitResponse }));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/networkNoShow.server', () => ({
  disableNetworkNoShowPlatformInTx: vi.fn(),
  eraseNetworkNoShowSubjectInTx: vi.fn(),
  suppressNetworkNoShowEventInTx: vi.fn(),
  suppressNetworkNoShowSubjectInTx: vi.fn(),
}));

function post(body: unknown) {
  return POST(new Request('http://localhost/api/super-admin/network-no-show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

describe('/api/super-admin/network-no-show', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    insertValues.length = 0;
    vi.stubEnv('NETWORK_NO_SHOW_ENABLED', 'true');
    vi.stubEnv('NETWORK_NO_SHOW_HMAC_KEY', 'a'.repeat(32));
    requireSuperAdmin.mockResolvedValue({ ok: true, admin: { id: 'operator_a' } });
  });

  it('denies non-operators before any rate-limit or database access', async () => {
    const response = new Response(JSON.stringify({ error: 'FORBIDDEN' }), { status: 403 });
    requireSuperAdmin.mockResolvedValue({ ok: false, response });

    await expect(post({ action: 'inspect', salonId: 'salon_a' })).resolves.toBe(response);

    expect(checkEndpointRateLimit).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid payloads without starting a database transaction', async () => {
    const response = await post({ action: 'inspect', salonId: '' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'INVALID_REQUEST' });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects platform enable while the environment kill switch remains dark', async () => {
    vi.stubEnv('NETWORK_NO_SHOW_ENABLED', 'false');

    const response = await post({ action: 'enable_platform', mode: 'apply' });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'PLATFORM_NOT_READY' });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects retired per-salon enrollment actions and tenant-scoped platform actions', async () => {
    const legacy = await post({ action: 'enroll_salon', salonId: 'salon_a' });
    const scopedEnable = await post({ action: 'enable_platform', salonId: 'salon_a' });
    const scopedDisable = await post({ action: 'disable_platform', appointmentId: 'appointment_a' });

    expect(legacy.status).toBe(400);
    expect(await legacy.json()).toEqual({ error: 'INVALID_REQUEST' });
    expect(scopedEnable.status).toBe(400);
    expect(await scopedEnable.json()).toEqual({ error: 'PLATFORM_ACTION_SCOPE_INVALID' });
    expect(scopedDisable.status).toBe(400);
    expect(await scopedDisable.json()).toEqual({ error: 'PLATFORM_ACTION_SCOPE_INVALID' });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('defaults to a non-mutating plan and records only the operator audit', async () => {
    selectResults.push(
      [{ id: 'salon_a' }],
      [],
    );

    const response = await post({ action: 'disable_platform' });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mode: 'plan',
      action: 'disable_platform',
      applied: false,
    });
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).toHaveBeenCalledOnce();
    expect(insertValues[0]).toMatchObject({ salonId: null, action: 'plan:disable_platform:platform' });
  });

  it('enables with a platform-only audit and uses an upsert to preserve a prior epoch', async () => {
    selectResults.push([], [], []);

    const response = await post({ action: 'enable_platform', mode: 'apply' });

    expect(response.status).toBe(200);
    expect(tx.insert).toHaveBeenCalledTimes(2);
    expect(insertValues[1]).toMatchObject({ salonId: null, action: 'apply:enable_platform:platform' });
  });

  it('does not resolve an appointment from another tenant as an eligible target', async () => {
    selectResults.push(
      [{ id: 'salon_a' }],
      [],
      [],
      [],
    );

    const response = await post({
      action: 'suppress_event',
      salonId: 'salon_a',
      appointmentId: 'appointment_owned_by_salon_b',
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'NOT_FOUND' });
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
