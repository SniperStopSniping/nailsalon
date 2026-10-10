import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  requireRealSalonOwner: vi.fn(),
  requireAdmin: vi.fn(),
  getAdminImpersonationForAdmin: vi.fn(),
  getStarterAllowanceStatus: vi.fn(),
  select: vi.fn(),
  claimVerifiedStarterCredits: vi.fn(),
  checkEndpointRateLimit: vi.fn(),
  getClientIp: vi.fn(),
  rateLimitResponse: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ currentUser: mocks.currentUser }));
vi.mock('@/libs/adminAuth', () => ({
  requireRealSalonOwner: mocks.requireRealSalonOwner,
  requireAdmin: mocks.requireAdmin,
  getAdminImpersonationForAdmin: mocks.getAdminImpersonationForAdmin,
}));
vi.mock('@/libs/billing/starterAllowanceStatus', () => ({ getStarterAllowanceStatus: mocks.getStarterAllowanceStatus }));
vi.mock('@/libs/billing/businessIdentity', () => ({ BusinessIdentityError: class BusinessIdentityError extends Error {} }));
vi.mock('@/libs/billing/verifiedStarterGrant', () => ({ claimVerifiedStarterCredits: mocks.claimVerifiedStarterCredits }));
vi.mock('@/libs/DB', () => ({ db: { transaction: mocks.transaction, select: mocks.select } }));
vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit: mocks.checkEndpointRateLimit,
  getClientIp: mocks.getClientIp,
  rateLimitResponse: mocks.rateLimitResponse,
}));

let salonRow: { id: string; deletedAt: Date | null } | undefined;
const transactionTx = {
  marker: 'tx',
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => ({
          for: async () => salonRow ? [salonRow] : [],
        }),
      }),
    }),
  }),
};

const request = (body: unknown, headers: HeadersInit = {}) => new Request(
  'https://luster.test/api/admin/salon/communications/starter-credits',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://luster.test', ...headers },
    body: JSON.stringify(body),
  },
);

describe('POST /api/admin/salon/communications/starter-credits', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireRealSalonOwner.mockResolvedValue({
      ok: true,
      admin: { clerkUserId: 'user_owner' },
    });
    mocks.currentUser.mockResolvedValue({
      id: 'user_owner',
      primaryEmailAddressId: 'email_primary',
      primaryPhoneNumberId: 'phone_primary',
      emailAddresses: [{
        id: 'email_primary',
        emailAddress: 'owner@example.test',
        verification: { status: 'verified' },
      }],
      phoneNumbers: [{
        id: 'phone_primary',
        phoneNumber: '+14165550123',
        verification: { status: 'verified' },
      }],
    });
    mocks.checkEndpointRateLimit.mockReturnValue({ allowed: true });
    mocks.getClientIp.mockReturnValue('127.0.0.1');
    salonRow = { id: 'salon_a', deletedAt: null };
    mocks.transaction.mockImplementation(async (callback: (tx: typeof transactionTx) => unknown) => callback(transactionTx));
    mocks.claimVerifiedStarterCredits.mockResolvedValue({ granted: true, status: 'granted' });
  });

  it('uses only the authenticated owner primary verified contacts', async () => {
    const response = await POST(request({ salonId: 'salon_a' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { granted: true, status: 'granted' } });
    expect(mocks.requireRealSalonOwner).toHaveBeenCalledWith('salon_a');
    expect(mocks.claimVerifiedStarterCredits).toHaveBeenCalledWith(expect.objectContaining({ marker: 'tx' }), {
      salonId: 'salon_a',
      clerkUserId: 'user_owner',
      verifiedEmail: 'owner@example.test',
      verifiedPhone: '+14165550123',
    });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it.each(['OWNER_REQUIRED', 'IMPERSONATION_NOT_ALLOWED'])('preserves %s with credit-specific error copy', async (code) => {
    mocks.requireRealSalonOwner.mockResolvedValue({
      ok: false,
      response: Response.json({ error: { code, message: 'owner assistant actions' } }, { status: 403 }),
    });
    const response = await POST(request({ salonId: 'salon_a' }));

    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatchObject({ code, message: expect.stringContaining('owner account') });
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.claimVerifiedStarterCredits).not.toHaveBeenCalled();
  });

  it('does not accept caller-provided contact values', async () => {
    const response = await POST(request({
      salonId: 'salon_a',
      email: 'attacker@example.test',
      phone: '+14165559999',
    }));

    expect(response.status).toBe(400);
    expect(mocks.requireRealSalonOwner).not.toHaveBeenCalled();
    expect(mocks.claimVerifiedStarterCredits).not.toHaveBeenCalled();
  });

  it('rejects a Clerk identity that differs from the authorized owner', async () => {
    mocks.currentUser.mockResolvedValue({ id: 'user_other', emailAddresses: [], phoneNumbers: [] });

    const response = await POST(request({ salonId: 'salon_a' }));

    expect(response.status).toBe(403);
    expect(mocks.claimVerifiedStarterCredits).not.toHaveBeenCalled();
  });

  it('rejects cross-origin requests before claiming', async () => {
    const response = await POST(request({ salonId: 'salon_a' }, { Origin: 'https://attacker.test' }));

    expect(response.status).toBe(403);
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.claimVerifiedStarterCredits).not.toHaveBeenCalled();
  });

  it('passes unverified primary contacts as null for the server policy to decide', async () => {
    mocks.currentUser.mockResolvedValue({
      id: 'user_owner',
      primaryEmailAddressId: 'email_primary',
      primaryPhoneNumberId: 'phone_primary',
      emailAddresses: [{ id: 'email_primary', emailAddress: 'owner@example.test', verification: { status: 'unverified' } }],
      phoneNumbers: [{ id: 'phone_primary', phoneNumber: '+14165550123', verification: { status: 'failed' } }],
    });
    mocks.claimVerifiedStarterCredits.mockResolvedValue({ granted: false, status: 'verification_required' });

    const response = await POST(request({ salonId: 'salon_a' }));

    expect(response.status).toBe(200);
    expect(mocks.claimVerifiedStarterCredits).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      verifiedEmail: null,
      verifiedPhone: null,
    }));
  });

  it('does not grant credits to a deleted salon', async () => {
    salonRow = { id: 'salon_a', deletedAt: new Date('2026-09-01T00:00:00.000Z') };

    const response = await POST(request({ salonId: 'salon_a' }));

    expect(response.status).toBe(409);
    expect(mocks.claimVerifiedStarterCredits).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/salon/communications/starter-credits', () => {
  const getRequest = (salonId = 'salon_a') => new Request(`https://luster.test/api/admin/salon/communications/starter-credits?salonId=${salonId}`);
  const ownerAdmin = { clerkUserId: 'user_owner', salons: [{ salonId: 'salon_a', role: 'owner' }] };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAdmin.mockResolvedValue({ ok: true, admin: ownerAdmin });
    mocks.getAdminImpersonationForAdmin.mockResolvedValue(null);
    mocks.checkEndpointRateLimit.mockReturnValue({ allowed: true });
    mocks.getClientIp.mockReturnValue('127.0.0.1');
    mocks.currentUser.mockResolvedValue({ id: 'user_owner', emailAddresses: [], phoneNumbers: [] });
    mocks.getStarterAllowanceStatus.mockResolvedValue('verification_required');
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ deletedAt: null }] }) }) });
    mocks.transaction.mockImplementation(async (callback: (tx: typeof transactionTx) => unknown) => callback(transactionTx));
  });

  it('reads saved verification without claiming, identity writes, or contacting Clerk', async () => {
    mocks.getStarterAllowanceStatus.mockResolvedValue('verified');
    const response = await GET(getRequest());

    expect(await response.json()).toEqual({ data: { status: 'verified', canClaim: false } });
    expect(mocks.getStarterAllowanceStatus).toHaveBeenCalledWith(transactionTx, 'salon_a');
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.claimVerifiedStarterCredits).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('allows verification only for a matching authenticated Clerk owner', async () => {
    const response = await GET(getRequest());

    expect(await response.json()).toEqual({ data: { status: 'verification_required', canClaim: true, verification: { email: false, phone: false } } });
    expect(mocks.claimVerifiedStarterCredits).not.toHaveBeenCalled();
  });

  it('returns only verification booleans for the matching owner, never contact details', async () => {
    mocks.currentUser.mockResolvedValue({ id: 'user_owner', primaryEmailAddressId: 'primary', primaryPhoneNumberId: 'phone', emailAddresses: [{ id: 'primary', emailAddress: 'private@example.test', verification: { status: 'verified' } }], phoneNumbers: [{ id: 'phone', phoneNumber: '+14165550123', verification: { status: 'unverified' } }] });
    const response = await GET(getRequest());

    expect(await response.json()).toEqual({ data: { status: 'verification_required', canClaim: true, verification: { email: true, phone: false } } });
    expect(mocks.claimVerifiedStarterCredits).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'collaborator', admin: { clerkUserId: 'user_owner', salons: [{ salonId: 'salon_a', role: 'admin' }] }, impersonation: null, userId: 'user_owner' },
    { label: 'super admin without membership', admin: { isSuperAdmin: true, clerkUserId: 'user_super', salons: [] }, impersonation: null, userId: 'user_super' },
    { label: 'legacy owner session', admin: { ...ownerAdmin, clerkUserId: null }, impersonation: null, userId: 'user_owner' },
    { label: 'impersonated owner', admin: ownerAdmin, impersonation: { salonId: 'salon_a' }, userId: 'user_owner' },
    { label: 'mismatched Clerk session', admin: ownerAdmin, impersonation: null, userId: 'user_other' },
  ])('does not offer a claim to $label', async ({ admin, impersonation, userId }) => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, admin });
    mocks.getAdminImpersonationForAdmin.mockResolvedValue(impersonation);
    mocks.currentUser.mockResolvedValue({ id: userId });
    const response = await GET(getRequest());

    expect(await response.json()).toEqual({ data: { status: 'verification_required', canClaim: false } });
    expect(mocks.claimVerifiedStarterCredits).not.toHaveBeenCalled();
  });

  it.each([401, 403])('refuses unauthorized or wrong-tenant reads before billing lookup (%s)', async (status) => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, response: new Response('Denied', { status }) });
    const response = await GET(getRequest('salon_other'));

    expect(response.status).toBe(status);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.getStarterAllowanceStatus).not.toHaveBeenCalled();
  });

  it('rate limits status reads before querying the database', async () => {
    mocks.checkEndpointRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 1000 });
    mocks.rateLimitResponse.mockReturnValue(new Response('Limited', { status: 429 }));
    const response = await GET(getRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it('returns a non-cacheable error if the status lookup fails', async () => {
    mocks.getStarterAllowanceStatus.mockRejectedValue(new Error('database unavailable'));
    const response = await GET(getRequest());

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await response.json()).error.code).toBe('STARTER_STATUS_ERROR');
  });

  it('rejects a missing salon before reading its allowance', async () => {
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [] }) }) });
    const response = await GET(getRequest());

    expect(response.status).toBe(409);
    expect(mocks.getStarterAllowanceStatus).not.toHaveBeenCalled();
  });

  it('rejects a deleted salon before reading its allowance', async () => {
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ deletedAt: new Date() }] }) }) });
    const response = await GET(getRequest());

    expect(response.status).toBe(409);
    expect(mocks.getStarterAllowanceStatus).not.toHaveBeenCalled();
  });
});
