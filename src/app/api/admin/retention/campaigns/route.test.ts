import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RETENTION_SETTINGS } from '@/libs/retentionAssistant';

import { POST } from './route';

vi.mock('server-only', () => ({}));

const {
  requireAdminSalon,
  getAdminSession,
  getRetentionSettingsForSalon,
  buildSalonTenantPublicUrl,
  selectQueue,
  insertedCampaigns,
  updatedCommunications,
  lifecycleState,
  lifecycleOperations,
  getSalonClientLineageIdsWithHandle,
  getSalonClientPhoneAliasesWithHandle,
  lockTerminalSalonClientWithHandle,
  withClientLifecycleTransactionRetry,
  db,
} = vi.hoisted(() => {
  const selectQueue: unknown[] = [];
  const insertedCampaigns: Array<Record<string, unknown>> = [];
  const updatedCommunications: Array<Record<string, unknown>> = [];
  const lifecycleState: { terminalClientId: string | null } = { terminalClientId: null };
  const lifecycleOperations: string[] = [];
  const query = (result: unknown) => {
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => result),
      then: (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve),
    };
    return chain;
  };
  const tx = {
    select: vi.fn(() => {
      lifecycleOperations.push('dependent-read');
      return query(selectQueue.shift() ?? []);
    }),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        insertedCampaigns.push(values);
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updatedCommunications.push(values);
        return { where: vi.fn(async () => []) };
      }),
    })),
  };
  return {
    requireAdminSalon: vi.fn(),
    getAdminSession: vi.fn(),
    getRetentionSettingsForSalon: vi.fn(),
    buildSalonTenantPublicUrl: vi.fn((_path: string) => 'https://example.com/en/salon-a/book?campaign=opaque'),
    selectQueue,
    insertedCampaigns,
    updatedCommunications,
    lifecycleState,
    lifecycleOperations,
    getSalonClientLineageIdsWithHandle: vi.fn(async (
      _handle: unknown,
      input: { terminalClientId: string },
    ) => [input.terminalClientId]),
    getSalonClientPhoneAliasesWithHandle: vi.fn(async () => []),
    lockTerminalSalonClientWithHandle: vi.fn(async (
      _handle: unknown,
      input: { salonId: string; clientId: string },
    ) => {
      lifecycleOperations.push('terminal-lock');
      return {
        id: lifecycleState.terminalClientId ?? input.clientId,
        salonId: input.salonId,
        archivedAt: null,
        redirectedFromClientId: lifecycleState.terminalClientId
          ? input.clientId
          : null,
        lineagePath: lifecycleState.terminalClientId
          ? [input.clientId, lifecycleState.terminalClientId]
          : [input.clientId],
      };
    }),
    withClientLifecycleTransactionRetry: vi.fn(async (
      operation: (attempt: number) => Promise<unknown>,
    ) => operation(1)),
    db: {
      select: vi.fn(() => query(selectQueue.shift() ?? [])),
      transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    },
  };
});

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon, getAdminSession }));
vi.mock('@/libs/clientLifecycleStabilization', () => ({
  ClientLifecycleStabilizationError: class ClientLifecycleStabilizationError extends Error {},
  getSalonClientLineageIdsWithHandle,
  getSalonClientPhoneAliasesWithHandle,
  lockTerminalSalonClientWithHandle,
  withClientLifecycleTransactionRetry,
}));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/publicUrl', () => ({ buildSalonTenantPublicUrl }));
vi.mock('@/libs/retentionSettings.server', () => ({ getRetentionSettingsForSalon }));

const NOW = new Date('2026-07-17T16:00:00.000Z');

describe('POST /api/admin/retention/campaigns', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    selectQueue.length = 0;
    insertedCampaigns.length = 0;
    updatedCommunications.length = 0;
    lifecycleState.terminalClientId = null;
    lifecycleOperations.length = 0;
    requireAdminSalon.mockResolvedValue({ salon: { id: 'salon_1', slug: 'salon-a' }, error: null });
    getAdminSession.mockResolvedValue({ id: 'admin_1' });
    getRetentionSettingsForSalon.mockResolvedValue({
      ...DEFAULT_RETENTION_SETTINGS,
      sixWeekPromotion: {
        ...DEFAULT_RETENTION_SETTINGS.sixWeekPromotion,
        enabled: true,
        value: 15,
      },
    });
  });

  afterEach(() => vi.useRealTimers());

  it('does not allow cross-tenant campaign minting', async () => {
    requireAdminSalon.mockResolvedValue({
      salon: null,
      error: new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: 403 }),
    });

    const response = await POST(new Request('http://localhost/api/admin/retention/campaigns', {
      method: 'POST',
      body: JSON.stringify({ salonSlug: 'other', clientId: 'client_1', stage: 'promo_6w' }),
    }));

    expect(response.status).toBe(403);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('mints a tenant-bound opaque link while storing only the token hash', async () => {
    selectQueue.push(
      [{
        id: 'client_1',
        phone: '4165551212',
        lastVisitAt: new Date('2026-06-05T16:00:00.000Z'),
        rebookIntervalDays: null,
        isBlocked: false,
      }],
      [],
    );

    const response = await POST(new Request('http://localhost/api/admin/retention/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonSlug: 'salon-a', clientId: 'client_1', stage: 'promo_6w' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.campaign.token).toMatch(/^[\w-]{40,}$/);
    expect(insertedCampaigns[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(insertedCampaigns[0]?.tokenHash).not.toBe(body.data.campaign.token);
    expect(insertedCampaigns[0]).toMatchObject({
      salonId: 'salon_1',
      salonClientId: 'client_1',
      stage: 'promo_6w',
      singleUse: true,
    });
    expect(body.data.campaign.bookingUrl).toContain('/book?campaign=');
  });

  it('locks and writes the terminal client for a merged-source campaign request', async () => {
    lifecycleState.terminalClientId = 'primary_client';
    selectQueue.push(
      [{
        id: 'primary_client',
        phone: '4165551212',
        lastVisitAt: new Date('2026-06-05T16:00:00.000Z'),
        rebookIntervalDays: null,
        isBlocked: false,
      }],
      [],
      [{
        id: 'communication_1',
        salonId: 'salon_1',
        salonClientId: 'primary_client',
        kind: 'promo_6w',
        metadata: {},
      }],
    );

    const response = await POST(new Request('http://localhost/api/admin/retention/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'salon-a',
        clientId: 'merged_source',
        stage: 'promo_6w',
        communicationId: 'communication_1',
      }),
    }));

    expect(response.status).toBe(201);
    expect(lockTerminalSalonClientWithHandle).toHaveBeenCalledWith(
      expect.anything(),
      { salonId: 'salon_1', clientId: 'merged_source' },
    );
    expect(lifecycleOperations.slice(0, 2)).toEqual(['terminal-lock', 'dependent-read']);
    expect(insertedCampaigns[0]).toMatchObject({
      salonClientId: 'primary_client',
      communicationId: 'communication_1',
    });
    expect(updatedCommunications).toHaveLength(1);
  });

  it('checks the terminal client block before preparing campaign state', async () => {
    lifecycleState.terminalClientId = 'primary_client';
    selectQueue.push([{
      id: 'primary_client',
      phone: '4165551212',
      lastVisitAt: new Date('2026-06-05T16:00:00.000Z'),
      rebookIntervalDays: null,
      isBlocked: true,
    }]);

    const response = await POST(new Request('http://localhost/api/admin/retention/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonSlug: 'salon-a', clientId: 'merged_source', stage: 'promo_6w' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('CLIENT_BLOCKED');
    expect(insertedCampaigns).toHaveLength(0);
  });

  it('checks future appointments on the terminal client before preparing campaign state', async () => {
    lifecycleState.terminalClientId = 'primary_client';
    selectQueue.push(
      [{
        id: 'primary_client',
        phone: '4165551212',
        lastVisitAt: new Date('2026-06-05T16:00:00.000Z'),
        rebookIntervalDays: null,
        isBlocked: false,
      }],
      [{ id: 'future_appointment' }],
    );

    const response = await POST(new Request('http://localhost/api/admin/retention/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonSlug: 'salon-a', clientId: 'merged_source', stage: 'promo_6w' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('CLIENT_ALREADY_BOOKED');
    expect(insertedCampaigns).toHaveLength(0);
  });
});
