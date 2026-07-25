import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const {
  requireAppointmentManagerAccess,
  getSalonById,
  getOrCreateSalonClient,
  getRetentionSettingsForSalon,
  lockTerminalSalonClientWithHandle,
  resolveOperationalSalonClientByPhoneWithHandle,
  withClientLifecycleTransactionRetry,
  updateCalls,
  transaction,
  transactionHandle,
  rootUpdate,
} = vi.hoisted(() => {
  const updateCalls: Array<{
    scope: 'root' | 'transaction';
    set: Record<string, unknown>;
    where?: unknown;
  }> = [];

  const createUpdate = (scope: 'root' | 'transaction') =>
    vi.fn(() => {
      const call: {
        scope: 'root' | 'transaction';
        set: Record<string, unknown>;
        where?: unknown;
      } = { scope, set: {} };
      const chain: any = {
        set: vi.fn((values: Record<string, unknown>) => {
          call.set = values;
          updateCalls.push(call);
          return chain;
        }),
        where: vi.fn(async (where: unknown) => {
          call.where = where;
          return [];
        }),
      };
      return chain;
    });

  const transactionHandle = {
    update: createUpdate('transaction'),
  };
  const transaction = vi.fn(async (operation: (tx: typeof transactionHandle) => Promise<unknown>) =>
    operation(transactionHandle));

  return {
    requireAppointmentManagerAccess: vi.fn(),
    getSalonById: vi.fn(),
    getOrCreateSalonClient: vi.fn(),
    getRetentionSettingsForSalon: vi.fn(),
    lockTerminalSalonClientWithHandle: vi.fn(),
    resolveOperationalSalonClientByPhoneWithHandle: vi.fn(),
    withClientLifecycleTransactionRetry: vi.fn(
      (operation: (attempt: number) => Promise<unknown>) => operation(1),
    ),
    updateCalls,
    transaction,
    transactionHandle,
    rootUpdate: createUpdate('root'),
  };
});

vi.mock('@/libs/clientLifecycleStabilization', () => ({
  ClientLifecycleStabilizationError: class ClientLifecycleStabilizationError extends Error {},
  lockTerminalSalonClientWithHandle,
  resolveOperationalSalonClientByPhoneWithHandle,
  withClientLifecycleTransactionRetry,
}));
vi.mock('@/libs/routeAccessGuards', () => ({ requireAppointmentManagerAccess }));
vi.mock('@/libs/queries', () => ({
  getSalonById,
  getOrCreateSalonClient,
}));
vi.mock('@/libs/retentionSettings.server', () => ({ getRetentionSettingsForSalon }));
vi.mock('@/libs/DB', () => ({
  db: {
    update: rootUpdate,
    transaction,
  },
}));

const appointment = {
  id: 'appt_1',
  salonId: 'salon_1',
  salonClientId: 'salon_client_1',
  clientName: 'Ava Nguyen',
  clientPhone: '4165551234',
  status: 'completed',
};

function post(action: string, url = 'https://app.test/api/appointments/appt_1/review-followup') {
  return POST(
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }),
    { params: { id: 'appt_1' } },
  );
}

function collectSqlValues(value: unknown, seen = new WeakSet<object>()): unknown[] {
  if (value == null || typeof value !== 'object') {
    return [value];
  }
  if (seen.has(value)) {
    return [];
  }
  seen.add(value);
  return Object.values(value).flatMap(child => collectSqlValues(child, seen));
}

describe('POST /api/appointments/[id]/review-followup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateCalls.length = 0;
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      appointment,
      actorRole: 'admin',
    });
    getSalonById.mockResolvedValue({
      id: 'salon_1',
      name: 'Isla Nail Studio',
      settings: { googleReviewUrl: 'https://legacy.example/review' },
    });
    getRetentionSettingsForSalon.mockResolvedValue({ googleReviewUrl: 'https://g.page/r/isla/review' });
    resolveOperationalSalonClientByPhoneWithHandle.mockResolvedValue(null);
    lockTerminalSalonClientWithHandle.mockResolvedValue({
      id: 'primary_client_1',
      salonId: 'salon_1',
      archivedAt: null,
      redirectedFromClientId: 'salon_client_1',
      lineagePath: ['salon_client_1', 'primary_client_1'],
    });
  });

  it('threads the explicit salon hint into the access guard', async () => {
    const response = await post('satisfaction_question', 'https://app.test/api/appointments/appt_1/review-followup?salonSlug=glow');

    expect(response.status).toBe(200);
    expect(requireAppointmentManagerAccess).toHaveBeenCalledWith('appt_1', expect.objectContaining({
      assignedOnly: true,
      salonSlugHint: 'glow',
    }));
  });

  it('prefers the retention-settings review URL over the legacy salon setting', async () => {
    const response = await post('google_review_link');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.message).toContain('https://g.page/r/isla/review');
    expect(body.data.message).not.toContain('https://legacy.example/review');
  });

  it('falls back to the legacy salon-settings review URL when retention settings have none', async () => {
    getRetentionSettingsForSalon.mockResolvedValue({ googleReviewUrl: null });

    const response = await post('google_review_link');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.message).toContain('https://legacy.example/review');
  });

  it('marks the client as reviewed for already_reviewed without composing a message', async () => {
    const response = await post('already_reviewed');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.clientHasGoogleReview).toBe(true);
    expect(body.data.message).toBeNull();
    expect(withClientLifecycleTransactionRetry).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(lockTerminalSalonClientWithHandle).toHaveBeenCalledWith(
      transactionHandle,
      {
        salonId: 'salon_1',
        clientId: 'salon_client_1',
      },
    );
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls.every(call => call.scope === 'transaction')).toBe(true);

    const reviewedUpdate = updateCalls.find(call => call.set.hasGoogleReview === true);

    expect(reviewedUpdate).toBeTruthy();
    expect(collectSqlValues(reviewedUpdate?.where)).toContain('primary_client_1');
    expect(collectSqlValues(reviewedUpdate?.where)).not.toContain('salon_client_1');
  });

  it('uses a historical operational phone alias without creating a duplicate client', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      appointment: {
        ...appointment,
        salonClientId: null,
        clientPhone: '4165559999',
      },
      actorRole: 'admin',
    });
    resolveOperationalSalonClientByPhoneWithHandle.mockResolvedValue({
      id: 'primary_client_1',
      salonId: 'salon_1',
      archivedAt: null,
      redirectedFromClientId: 'source_client_1',
      lineagePath: ['source_client_1', 'primary_client_1'],
    });

    const response = await post('already_reviewed');

    expect(response.status).toBe(200);
    expect(getOrCreateSalonClient).not.toHaveBeenCalled();
    expect(lockTerminalSalonClientWithHandle).toHaveBeenCalledWith(
      transactionHandle,
      { salonId: 'salon_1', clientId: 'primary_client_1' },
    );
  });

  it('keeps message-only actions on the existing non-lifecycle write path', async () => {
    const response = await post('satisfaction_question');

    expect(response.status).toBe(200);
    expect(transaction).not.toHaveBeenCalled();
    expect(lockTerminalSalonClientWithHandle).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.scope).toBe('root');
  });

  it('preserves authorization failures from the guard', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 }),
    });

    const response = await post('satisfaction_question');

    expect(response.status).toBe(403);
    expect(updateCalls).toHaveLength(0);
  });

  it('rejects unknown actions', async () => {
    const response = await post('spam_everyone');

    expect(response.status).toBe(400);
    expect(updateCalls).toHaveLength(0);
  });
});
