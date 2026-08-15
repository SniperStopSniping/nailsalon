import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StaffClientProfilePage from './page';

const { fetchMock, router } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  router: {
    back: vi.fn(),
    push: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ phone: '5551234567' }),
  useRouter: () => router,
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({ salonSlug: 'salon-a' }),
}));

function profileResponse(depositBlockedCode: string) {
  return {
    data: {
      client: {
        phone: '5551234567',
        name: 'Ava',
        memberSince: null,
        hasGoogleReview: false,
      },
      stats: {},
      preferences: null,
      photos: [],
      appointments: [{
        id: 'appt_blocked',
        startTime: '2026-03-10T14:00:00.000Z',
        endTime: '2026-03-10T15:00:00.000Z',
        status: 'completed',
        totalPrice: 12345,
        currency: 'CAD',
        // The UI must remain fail-closed even if a stale/malicious API labels
        // a non-null blocked summary as resolved.
        financialState: 'resolved',
        financialBlockCode: null,
        financial: {
          serviceInvoiceTotalCents: 12345,
          totalDueCents: 13456,
          collectedDepositCents: 2500,
          refundedDepositCents: 0,
          forfeitedDepositCents: 0,
          depositCreditAppliedCents: 0,
          amountAlreadyPaidCents: 4000,
          balanceCents: 9456,
          depositBlockedCode,
          depositPresentationState: 'refund_in_flight',
        },
        technicianName: 'Taylor',
        services: ['Gel manicure'],
      }],
    },
  };
}

describe('staff client financial history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  it.each([
    ['pending refund', 'DEPOSIT_REFUND_IN_FLIGHT'],
    ['failed refund', 'DEPOSIT_REFUND_UNRESOLVED'],
    ['refund conflict', 'DEPOSIT_REFUND_CONFLICT'],
  ])('shows only under-review copy for a %s summary', async (_case, blockCode) => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/staff/me') {
        return new Response(JSON.stringify({
          data: { technician: { id: 'tech_1' } },
        }), { status: 200 });
      }
      if (url === '/api/staff/client/5551234567?salonSlug=salon-a') {
        return new Response(JSON.stringify(profileResponse(blockCode)), {
          status: 200,
        });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<StaffClientProfilePage />);

    fireEvent.click(await screen.findByRole('button', { name: /history/i }));

    expect(await screen.findByText('Financial details under review'))
      .toBeInTheDocument();
    expect(screen.getByText('Under review')).toBeInTheDocument();
    expect(screen.queryByText('$123.45')).not.toBeInTheDocument();
    expect(screen.queryByText('$134.56')).not.toBeInTheDocument();
    expect(screen.queryByText('$94.56')).not.toBeInTheDocument();
    expect(screen.queryByText(/refund in progress/i)).not.toBeInTheDocument();
  });
});
