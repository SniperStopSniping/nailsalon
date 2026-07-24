/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  db,
  insertValues,
  requireClientApiSession,
  requireClientSalonFromBody,
  resolveSalonClientIdentityByPhone,
  updateSet,
  upsertSalonClient,
} = vi.hoisted(() => {
  const insertValues = vi.fn(() => ({
    onConflictDoUpdate: vi.fn(() => ({
      returning: vi.fn(async () => [{
        id: 'client_1',
        phone: '+15551234567',
      }]),
    })),
  }));
  const updateSet = vi.fn(() => ({
    where: vi.fn(async () => []),
  }));

  return {
    insertValues,
    requireClientApiSession: vi.fn(),
    requireClientSalonFromBody: vi.fn(),
    resolveSalonClientIdentityByPhone: vi.fn(),
    updateSet,
    upsertSalonClient: vi.fn(),
    db: {
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: updateSet })),
    },
  };
});

vi.mock('@/libs/clientApiGuards', () => ({
  requireClientApiSession,
  requireClientSalonFromBody,
}));

vi.mock('@/libs/DB', () => ({ db }));

vi.mock('@/libs/queries', () => ({
  resolveSalonClientIdentityByPhone,
  upsertSalonClient,
}));

import { POST } from './route';

function profileRequest() {
  return new Request('http://localhost/api/client/complete-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Ava',
      email: 'AVA@example.com',
      salonSlug: 'salon-a',
    }),
  });
}

describe('POST /api/client/complete-profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '5551234567',
      phoneVariants: ['5551234567', '+15551234567'],
      session: {
        phone: '+15551234567',
        clientName: 'Ava',
        sessionId: 'client_session_1',
      },
    });
    requireClientSalonFromBody.mockResolvedValue({
      ok: true,
      salon: { id: 'salon_1', slug: 'salon-a' },
    });
    resolveSalonClientIdentityByPhone.mockResolvedValue(null);
    upsertSalonClient.mockResolvedValue({ id: 'salon_client_1' });
  });

  it('does not mutate either identity when the authenticated phone is only a historical alias', async () => {
    resolveSalonClientIdentityByPhone.mockResolvedValue({
      client: {
        id: 'salon_client_primary',
        phone: '5559876543',
        mergedIntoClientId: null,
      },
      clientIds: ['salon_client_primary', 'salon_client_source'],
      normalizedPhones: ['5551234567', '5559876543'],
      phoneVariants: [
        '5551234567',
        '+15551234567',
        '5559876543',
        '+15559876543',
      ],
      resolvedFromClientId: 'salon_client_source',
    });

    const response = await POST(profileRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toEqual({
      code: 'CLIENT_IDENTITY_RECONCILIATION_REQUIRED',
      message: 'This profile needs account assistance before it can be updated.',
    });
    expect(resolveSalonClientIdentityByPhone).toHaveBeenCalledWith(
      'salon_1',
      '5551234567',
    );
    expect(upsertSalonClient).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('continues the existing flow for the exact current salon phone', async () => {
    resolveSalonClientIdentityByPhone.mockResolvedValue({
      client: {
        id: 'salon_client_1',
        phone: '+1 (555) 123-4567',
        mergedIntoClientId: null,
      },
      clientIds: ['salon_client_1'],
      normalizedPhones: ['5551234567'],
      phoneVariants: ['5551234567', '+15551234567'],
      resolvedFromClientId: null,
    });

    const response = await POST(profileRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(upsertSalonClient).toHaveBeenCalledWith(
      'salon_1',
      '5551234567',
      'Ava',
      'ava@example.com',
    );
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+15551234567',
      firstName: 'Ava',
      email: 'ava@example.com',
    }));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      profileCompletionRewardGranted: false,
      updatedAt: expect.any(Date),
    }));
    expect(body.success).toBe(true);
  });

  it('allows a resolved source when the primary current phone still exactly matches', async () => {
    resolveSalonClientIdentityByPhone.mockResolvedValue({
      client: {
        id: 'salon_client_primary',
        phone: '5551234567',
        mergedIntoClientId: null,
      },
      clientIds: ['salon_client_primary', 'salon_client_source'],
      normalizedPhones: ['5551234567'],
      phoneVariants: ['5551234567', '+15551234567'],
      resolvedFromClientId: 'salon_client_source',
    });

    const response = await POST(profileRequest());

    expect(response.status).toBe(200);
    expect(upsertSalonClient).toHaveBeenCalledWith(
      'salon_1',
      '5551234567',
      'Ava',
      'ava@example.com',
    );
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});
