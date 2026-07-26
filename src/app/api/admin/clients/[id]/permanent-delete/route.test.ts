import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const {
  canonicalizeClientVersionToken,
  getAdminSession,
  permanentlyDeleteSalonClient,
  requireAdminSalon,
  ClientDeletionError,
} = vi.hoisted(() => {
  class ClientDeletionError extends Error {
    code: string;

    constructor(code: string) {
      super('Client lifecycle operation failed.');
      this.code = code;
    }
  }

  return {
    canonicalizeClientVersionToken: vi.fn((value: string) => value),
    getAdminSession: vi.fn(),
    permanentlyDeleteSalonClient: vi.fn(),
    requireAdminSalon: vi.fn(),
    ClientDeletionError,
  };
});

vi.mock('@/libs/adminAuth', () => ({
  getAdminSession,
  requireAdminSalon,
}));

vi.mock('@/libs/clientDeletion', () => ({
  canonicalizeClientVersionToken,
  ClientDeletionError,
  permanentlyDeleteSalonClient,
}));

const EXPECTED_VERSION = '2026-07-26T18:55:24.123456Z';

function request(body: unknown) {
  return new Request(
    'http://localhost/api/admin/clients/client_1/permanent-delete',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

async function post(body: unknown, clientId = 'client_1') {
  return POST(request(body), {
    params: Promise.resolve({ id: clientId }),
  });
}

describe('POST /api/admin/clients/[id]/permanent-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canonicalizeClientVersionToken.mockImplementation((value: string) => value);
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    getAdminSession.mockResolvedValue({ id: 'admin_1' });
  });

  it('validates the expected version before calling the deletion authority', async () => {
    const response = await post({
      salonSlug: 'salon-a',
      expectedUpdatedAt: '2026-07-26',
    });

    expect(response.status).toBe(400);
    expect(permanentlyDeleteSalonClient).not.toHaveBeenCalled();
  });

  it('permanently deletes an eligible terminal and returns only opaque identifiers', async () => {
    permanentlyDeleteSalonClient.mockResolvedValue({
      code: 'CLIENT_PERMANENTLY_DELETED',
      terminalClientId: 'client_1',
      idempotent: false,
    });

    const response = await post({
      salonSlug: 'salon-a',
      expectedUpdatedAt: EXPECTED_VERSION,
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(permanentlyDeleteSalonClient).toHaveBeenCalledWith({
      salonId: 'salon_1',
      requestedClientId: 'client_1',
      expectedUpdatedAt: EXPECTED_VERSION,
      actorAdminId: 'admin_1',
    });
    expect(text).not.toContain('phone');
    expect(text).not.toContain('email');
    expect(JSON.parse(text)).toEqual({
      data: {
        code: 'CLIENT_PERMANENTLY_DELETED',
        clientId: 'client_1',
      },
      meta: {
        idempotent: false,
      },
    });
  });

  it('returns idempotent success for an exact same-salon tombstone match', async () => {
    permanentlyDeleteSalonClient.mockResolvedValue({
      code: 'CLIENT_PERMANENTLY_DELETED',
      terminalClientId: 'deleted_1',
      idempotent: true,
    });

    const response = await post({
      salonSlug: 'salon-a',
      expectedUpdatedAt: EXPECTED_VERSION,
    }, 'deleted_1');

    expect(response.status).toBe(200);
    expect((await response.json()).meta.idempotent).toBe(true);
  });

  it.each([
    'CLIENT_PERMANENT_DELETE_NOT_ALLOWED',
    'CLIENT_HAS_ACTIVE_APPOINTMENT',
  ])('uses the exact generic history response for %s', async (code) => {
    permanentlyDeleteSalonClient.mockRejectedValue(
      new ClientDeletionError(code),
    );

    const response = await post({
      salonSlug: 'salon-a',
      expectedUpdatedAt: EXPECTED_VERSION,
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: 'CLIENT_PERMANENT_DELETE_NOT_ALLOWED',
        message:
          'This client has history and can’t be permanently deleted. Delete them from the active list instead.',
      },
    });
  });

  it.each([
    ['random, foreign, or stale missing IDs', 'CLIENT_NOT_FOUND', 404, 'CLIENT_NOT_FOUND'],
    ['lost CAS', 'CLIENT_ARCHIVE_CONFLICT', 409, 'CLIENT_PERMANENT_DELETE_CONFLICT'],
    ['unsupported identity', 'UNSUPPORTED_CLIENT_IDENTITY', 409, 'UNSUPPORTED_CLIENT_IDENTITY'],
  ])('maps %s without hidden-record disclosure', async (
    _label,
    code,
    status,
    responseCode,
  ) => {
    permanentlyDeleteSalonClient.mockRejectedValue(
      new ClientDeletionError(code),
    );

    const response = await post({
      salonSlug: 'salon-a',
      expectedUpdatedAt: EXPECTED_VERSION,
    });
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body.error.code).toBe(responseCode);
    expect(JSON.stringify(body)).not.toContain('history_table');
    expect(JSON.stringify(body)).not.toContain('1111111111');
  });

  it('maps lock timeouts to a retryable conflict with no partial-success claim', async () => {
    permanentlyDeleteSalonClient.mockRejectedValue(
      new ClientDeletionError('CLIENT_LIFECYCLE_BUSY'),
    );

    const response = await post({
      salonSlug: 'salon-a',
      expectedUpdatedAt: EXPECTED_VERSION,
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: 'CLIENT_PERMANENT_DELETE_CONFLICT',
        message: 'This client is busy right now. Try again in a moment.',
        retryable: true,
      },
    });
  });
});
