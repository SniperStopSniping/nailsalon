import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({ gate: vi.fn(), owner: vi.fn(), salon: vi.fn(), preview: vi.fn(), record: vi.fn(), authImports: 0, dbImports: 0, writerImports: 0 }));
vi.mock('@/libs/customerPayments/creditReviewTestGate', () => ({ isCustomerPaymentCreditReviewTestEnabled: mocks.gate }));
vi.mock('@/libs/adminAuth', () => {
  mocks.authImports++;
  return { requireRealSalonOwner: mocks.owner };
});
vi.mock('@/libs/queries', () => ({ getSalonBySlug: mocks.salon }));
vi.mock('@/libs/DB', () => {
  mocks.dbImports++;
  return { db: {} };
});
vi.mock('@/libs/customerPayments/server/recordSyntheticCreditDecision', () => {
  mocks.writerImports++;
  return { previewSyntheticCreditReview: mocks.preview, recordSyntheticCreditDecision: mocks.record };
});
const context = { params: Promise.resolve({ id: 'appointment' }) };
const body = { requestId: '1cfb5245-a096-40fa-8fb5-689af6617d93', expectedEvidenceRevision: 'a'.repeat(64), reason: 'Test credit', serviceCreditCents: 2500, taxCreditCents: 0, tipCreditCents: 500 };
const decision = { id: 'decision', previousDecisionId: null, serviceCreditCents: 2500, taxCreditCents: 0, tipCreditCents: 500, deltaServiceCreditCents: 2500, deltaTaxCreditCents: 0, deltaTipCreditCents: 500, reason: 'Test credit', createdAt: new Date() };
const flags = { testOnly: true, nonLegal: true, ordinaryActionsBlocked: true };
function request(value: unknown = body, origin = 'http://localhost') {
  return new Request('http://localhost/api/admin/appointments/appointment/customer-payment-review?salonSlug=salon', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(value) });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.authImports = 0;
  mocks.dbImports = 0;
  mocks.writerImports = 0;
  mocks.gate.mockReturnValue(true);
  mocks.salon.mockResolvedValue({ id: 'salon-id' });
  mocks.owner.mockResolvedValue({ ok: true, admin: { id: 'owner-id' } });
  mocks.record.mockResolvedValue({ ...flags, decision, replayed: false, evidenceMatchesCurrent: true, privateAccount: 'secret' });
  mocks.preview.mockResolvedValue({ ...flags, evidenceRevision: 'a'.repeat(64), original: { serviceCents: 10000, taxCents: 0, tipCents: 2000, totalCents: 12000 }, refunded: { principalCents: 2500, tipCents: 500, totalCents: 3000 }, netTenderCents: 9000, previousCredit: { serviceCreditCents: 0, taxCreditCents: 0, tipCreditCents: 0 }, decision: null, resolution: null, evidence: { private: true } });
});

describe('owner synthetic credit review API', () => {
  it('gates before auth/database/writer imports', async () => {
    mocks.gate.mockReturnValue(false);

    expect((await GET(request(), context)).status).toBe(404);
    expect((await POST(request(), context)).status).toBe(404);
    expect([mocks.authImports, mocks.dbImports, mocks.writerImports]).toEqual([0, 0, 0]);
  });

  it('rejects origin and untrusted actor fields before dependencies', async () => {
    expect((await POST(request(body, 'https://foreign.invalid'), context)).status).toBe(403);
    expect((await POST(request({ ...body, actorId: 'fake' }), context)).status).toBe(400);
    expect([mocks.authImports, mocks.dbImports, mocks.writerImports]).toEqual([0, 0, 0]);
  });

  it('rejects malformed or oversized bodies before authorization', async () => {
    const base = 'http://localhost/api/admin/appointments/appointment/customer-payment-review?salonSlug=salon';
    for (const body of ['{', 'x'.repeat(4097)]) {
      const invalid = new Request(base, { method: 'POST', headers: { 'origin': 'http://localhost', 'content-type': 'application/json' }, body });

      expect((await POST(invalid, context)).status).toBe(400);
    }

    expect(mocks.authImports).toBe(0);
    expect(mocks.writerImports).toBe(0);
  });

  it.each([401, 403])('preserves non-owner/non-authenticated denial %i', async (status) => {
    mocks.owner.mockResolvedValue({ ok: false, response: new Response(null, { status }) });

    expect((await GET(request(), context)).status).toBe(status);
    expect((await POST(request(), context)).status).toBe(status);
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('binds actor/tenant from auth and exposes only sanitized result', async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(mocks.record).toHaveBeenCalledWith({}, { adminId: 'owner-id', authenticated: true, impersonating: false }, { ...body, salonId: 'salon-id', appointmentId: 'appointment' });
    expect(await response.json()).not.toHaveProperty('privateAccount');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('returns sanitized preview and maps stale evidence to re-review', async () => {
    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('evidence');

    mocks.record.mockRejectedValue(new Error('CUSTOMER_PAYMENT_CREDIT_STALE_EVIDENCE'));

    expect((await POST(request(), context)).status).toBe(409);
  });
});
