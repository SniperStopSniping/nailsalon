import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const {
  archiveSalonClient,
  canonicalizeClientVersionToken,
  getAdminSession,
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
    archiveSalonClient: vi.fn(),
    canonicalizeClientVersionToken: vi.fn((value: string) => value),
    getAdminSession: vi.fn(),
    requireAdminSalon: vi.fn(),
    ClientDeletionError,
  };
});

vi.mock('@/libs/adminAuth', () => ({
  getAdminSession,
  requireAdminSalon,
}));

vi.mock('@/libs/clientDeletion', () => ({
  archiveSalonClient,
  canonicalizeClientVersionToken,
  ClientDeletionError,
}));

const EXPECTED_VERSION = '2026-07-26T18:55:24.123456Z';

function request(body: unknown) {
  return new Request('http://localhost/api/admin/clients/client_1/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function post(body: unknown, clientId = 'client_1') {
  return POST(request(body), {
    params: Promise.resolve({ id: clientId }),
  });
}

describe('POST /api/admin/clients/[id]/archive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canonicalizeClientVersionToken.mockImplementation((value: string) => value);
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    getAdminSession.mockResolvedValue({ id: 'admin_1' });
  });

  it('validates the salon and exact version token before calling the helper', async () => {
    const response = await post({
      salonSlug: 'salon-a',
      expectedUpdatedAt: 'not-a-version',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
      },
    });
    expect(archiveSalonClient).not.toHaveBeenCalled();
  });

  it('preserves an authorization response and adds private cache headers', async () => {
    requireAdminSalon.mockResolvedValue({
      error: Response.json({
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      }, { status: 401 }),
      salon: null,
    });

    const response = await post({
      salonSlug: 'salon-a',
      expectedUpdatedAt: EXPECTED_VERSION,
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0',
    );
    expect(archiveSalonClient).not.toHaveBeenCalled();
  });

  it('archives a direct terminal using the authenticated admin and exact CAS token', async () => {
    archiveSalonClient.mockResolvedValue({
      code: 'CLIENT_ARCHIVED',
      terminalClientId: 'client_1',
      updatedAt: '2026-07-26T19:00:00.000001Z',
      idempotent: false,
      redirectedFromStaleSource: false,
    });

    const response = await post({
      salonSlug: 'salon-a',
      expectedUpdatedAt: EXPECTED_VERSION,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(archiveSalonClient).toHaveBeenCalledWith({
      salonId: 'salon_1',
      requestedClientId: 'client_1',
      expectedUpdatedAt: EXPECTED_VERSION,
      actorAdminId: 'admin_1',
    });
    expect(body).toEqual({
      data: {
        code: 'CLIENT_ARCHIVED',
        clientId: 'client_1',
        updatedAt: '2026-07-26T19:00:00.000001Z',
      },
      meta: {
        idempotent: false,
        redirectedFromStaleSource: false,
      },
    });
  });

  it('returns stale-source and repeated archive outcomes without disclosing client data', async () => {
    archiveSalonClient.mockResolvedValue({
      code: 'CLIENT_ALREADY_ARCHIVED',
      terminalClientId: 'terminal_1',
      updatedAt: '2026-07-26T19:00:00.000001Z',
      idempotent: true,
      redirectedFromStaleSource: true,
    });

    const response = await post({
      salonSlug: 'salon-a',
      expectedUpdatedAt: EXPECTED_VERSION,
    }, 'source_1');
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain('phone');
    expect(text).not.toContain('email');
    expect(JSON.parse(text)).toEqual({
      data: {
        code: 'CLIENT_ALREADY_ARCHIVED',
        clientId: 'terminal_1',
        updatedAt: '2026-07-26T19:00:00.000001Z',
      },
      meta: {
        idempotent: true,
        redirectedFromStaleSource: true,
      },
    });
  });

  it.each([
    [
      'CLIENT_ARCHIVE_CONFLICT',
      409,
      'CLIENT_ARCHIVE_CONFLICT',
    ],
    [
      'CLIENT_HAS_ACTIVE_APPOINTMENT',
      409,
      'CLIENT_HAS_ACTIVE_APPOINTMENT',
    ],
    [
      'UNSUPPORTED_CLIENT_IDENTITY',
      409,
      'UNSUPPORTED_CLIENT_IDENTITY',
    ],
    [
      'CLIENT_NOT_FOUND',
      404,
      'CLIENT_NOT_FOUND',
    ],
  ])('maps %s to a safe response', async (code, status, responseCode) => {
    archiveSalonClient.mockRejectedValue(new ClientDeletionError(code));

    const response = await post({
      salonSlug: 'salon-a',
      expectedUpdatedAt: EXPECTED_VERSION,
    });
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body.error.code).toBe(responseCode);
    expect(JSON.stringify(body)).not.toContain('1111111111');
  });

  it('maps lock timeouts to a retryable non-disclosing conflict', async () => {
    archiveSalonClient.mockRejectedValue(
      new ClientDeletionError('CLIENT_LIFECYCLE_BUSY'),
    );

    const response = await post({
      salonSlug: 'salon-a',
      expectedUpdatedAt: EXPECTED_VERSION,
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: 'CLIENT_ARCHIVE_CONFLICT',
        message: 'This client is busy right now. Try again in a moment.',
        retryable: true,
      },
    });
  });
});
