import { beforeEach, describe, expect, it, vi } from 'vitest';

import Page from './page';

const mocks = vi.hoisted(() => ({ gate: vi.fn(), owner: vi.fn(), salon: vi.fn() }));
vi.mock('next/navigation', () => ({ notFound: () => {
  throw new Error('NOT_FOUND');
} }));
vi.mock('@/libs/customerPayments/creditReviewTestGate', () => ({ isCustomerPaymentCreditReviewTestEnabled: mocks.gate }));
vi.mock('@/libs/adminAuth', () => ({ requireRealSalonOwner: mocks.owner }));
vi.mock('@/libs/queries', () => ({ getSalonBySlug: mocks.salon }));
vi.mock('@/components/customerPayments/CustomerPaymentReview', () => ({ CustomerPaymentReview: () => null }));
const props = { params: Promise.resolve({ locale: 'en', slug: 'salon', appointmentId: 'appointment' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate.mockReturnValue(true);
  mocks.salon.mockResolvedValue({ id: 'salon-id' });
  mocks.owner.mockResolvedValue({ ok: true });
});

describe('dedicated test review page', () => {
  it('404s before its own auth/database work when disabled', async () => {
    mocks.gate.mockReturnValue(false);

    await expect(Page(props)).rejects.toThrow('NOT_FOUND');
    expect(mocks.salon).not.toHaveBeenCalled();
    expect(mocks.owner).not.toHaveBeenCalled();
  });

  it('requires the real tenant owner', async () => {
    mocks.owner.mockResolvedValue({ ok: false });

    await expect(Page(props)).rejects.toThrow('NOT_FOUND');
    expect(mocks.owner).toHaveBeenCalledWith('salon-id');

    mocks.owner.mockResolvedValue({ ok: true });

    expect(await Page(props)).toBeTruthy();
  });
});
