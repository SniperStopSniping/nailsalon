/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  db,
  insertValues,
  logAuditEvent,
  queueSelectResults,
  requireSuperAdmin,
  requireSuperAdminTestTools,
  sendSalonSignupInviteEmail,
  transaction,
  tx,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const selectQuery = {
    from: vi.fn(() => selectQuery),
    where: vi.fn(() => selectQuery),
    limit: vi.fn(async () => selectResults.shift() ?? []),
    then: (resolve: (value: unknown[]) => unknown) => resolve(selectResults.shift() ?? []),
  };
  const insertValues = vi.fn(async () => undefined);
  const updateWhere = vi.fn(async () => []);
  const update = vi.fn(() => ({
    set: vi.fn(() => ({ where: updateWhere })),
  }));
  const tx = {
    select: vi.fn(() => selectQuery),
    update,
    insert: vi.fn(() => ({ values: insertValues })),
  };
  const transaction = vi.fn();
  return {
    db: { transaction, update },
    insertValues,
    logAuditEvent: vi.fn(),
    queueSelectResults: (...rows: unknown[][]) => selectResults.splice(0, selectResults.length, ...rows),
    requireSuperAdmin: vi.fn(),
    requireSuperAdminTestTools: vi.fn(),
    sendSalonSignupInviteEmail: vi.fn(),
    transaction,
    tx,
  };
});

vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/adminAuth', () => ({ requireSuperAdmin }));
vi.mock('@/libs/superAdminTestTools.server', () => ({ requireSuperAdminTestTools }));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent }));
vi.mock('@/libs/salonSignupInviteEmail', () => ({ sendSalonSignupInviteEmail }));
vi.mock('@/libs/lusterSecurity', () => ({
  createOpaqueToken: () => ({ token: 'opaque-invitation-token', tokenHash: 'hashed-invitation-token' }),
}));
vi.mock('@/libs/publicUrl', () => ({
  buildSalonPublicUrl: (path: string) => `https://islanailsalon.com${path}`,
}));
vi.mock('server-only', () => ({}));

import { POST } from './route';

function request(body: Record<string, unknown>) {
  return new Request('https://islanailsalon.com/api/super-admin/signup-invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/super-admin/signup-invites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSuperAdmin.mockResolvedValue({ ok: true, admin: { id: 'super_1' } });
    requireSuperAdminTestTools.mockResolvedValue({ ok: true, admin: { id: 'super_1' } });
    sendSalonSignupInviteEmail.mockResolvedValue({ ok: true, errorCode: null, providerMessageId: 'email_1' });
    transaction.mockImplementation(callback => callback(tx));
  });

  it('creates and emails a normal nail-tech invitation without Twilio', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    const response = await POST(request({ email: 'OWNER@Example.com', campaignSource: 'pilot' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      invitedEmail: 'owner@example.com',
      intent: 'create_salon',
      salonId: null,
    }));
    expect(sendSalonSignupInviteEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'owner@example.com',
      joinUrl: 'https://islanailsalon.com/en/join/opaque-invitation-token',
    }));
    expect(body.data).toMatchObject({ emailDeliveryStatus: 'sent', status: 'active' });
    expect(network).not.toHaveBeenCalled();
  });

  it('creates a claim invitation only for a safe unowned matching salon', async () => {
    queueSelectResults(
      [{ id: 'salon_best', name: 'best', ownerEmail: 'owner@example.com', ownerClerkUserId: null }],
      [{ count: 0 }],
      [{ count: 0 }],
    );

    const response = await POST(request({
      email: 'owner@example.com',
      salonId: 'salon_best',
      campaignSource: 'legacy-salon-recovery',
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      intent: 'claim_existing',
      salonId: 'salon_best',
    }));
    expect(sendSalonSignupInviteEmail).toHaveBeenCalledWith(expect.objectContaining({ salonName: 'best' }));
    expect(body.data.joinUrl).toContain('/en/join/');
  });

  it('rejects automatic claims when appointment data exists', async () => {
    queueSelectResults(
      [{ id: 'salon_best', name: 'best', ownerEmail: 'owner@example.com', ownerClerkUserId: null }],
      [{ count: 0 }],
      [{ count: 1 }],
    );

    const response = await POST(request({ email: 'owner@example.com', salonId: 'salon_best' }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('CLAIM_REQUIRES_REVIEW');
    expect(sendSalonSignupInviteEmail).not.toHaveBeenCalled();
  });

  it('preserves the secure join link when email delivery fails', async () => {
    sendSalonSignupInviteEmail.mockResolvedValue({
      ok: false,
      errorCode: 'RESEND_HTTP_401',
      providerMessageId: null,
    });

    const response = await POST(request({ email: 'owner@example.com' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.emailDeliveryStatus).toBe('failed');
    expect(body.data.joinUrl).toBe('https://islanailsalon.com/en/join/opaque-invitation-token');
  });
});
