import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  requireRealSalonOwner: vi.fn(),
  claimVerifiedStarterCredits: vi.fn(),
  checkEndpointRateLimit: vi.fn(),
  getClientIp: vi.fn(),
  rateLimitResponse: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ currentUser: mocks.currentUser }));
vi.mock('@/libs/adminAuth', () => ({ requireRealSalonOwner: mocks.requireRealSalonOwner }));
vi.mock('@/libs/billing/businessIdentity', () => ({ BusinessIdentityError: class BusinessIdentityError extends Error {} }));
vi.mock('@/libs/billing/verifiedStarterGrant', () => ({ claimVerifiedStarterCredits: mocks.claimVerifiedStarterCredits }));
vi.mock('@/libs/DB', () => ({ db: { transaction: mocks.transaction } }));
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
