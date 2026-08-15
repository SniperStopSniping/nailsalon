import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RewardsContent from './RewardsContent';

const { fetchMock, routerBack, routerPush } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  routerBack: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock('canvas-confetti', () => ({
  default: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: routerBack,
    push: routerPush,
  }),
  useParams: () => ({ locale: 'en' }),
}));

vi.mock('framer-motion', () => {
  const makeMotionTag = (tag: string) =>
    React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement> & Record<string, unknown>>(({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      whileTap: _whileTap,
      whileHover: _whileHover,
      whileInView: _whileInView,
      whileDrag: _whileDrag,
      drag: _drag,
      dragConstraints: _dragConstraints,
      dragElastic: _dragElastic,
      onDragEnd: _onDragEnd,
      style: _style,
      ...props
    }, ref) => React.createElement(tag, { ...props, ref }, children as React.ReactNode));
  const cache = new Map<string, ReturnType<typeof makeMotionTag>>();

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy({}, {
      get: (_, tag: string) => {
        const cached = cache.get(tag);
        if (cached) {
          return cached;
        }
        const component = makeMotionTag(tag);
        cache.set(tag, component);
        return component;
      },
    }),
    useMotionValue: () => ({ set: vi.fn() }),
    useReducedMotion: () => true,
    useTransform: () => 0,
  };
});

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({ salonSlug: 'salon-a' }),
}));

vi.mock('@/hooks/useClientSession', () => ({
  useClientSession: () => ({ phone: '4165551234' }),
}));

let appointmentFinancial: Record<string, unknown>;

describe('RewardsContent appointment financial presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { vibrate: vi.fn() });
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    appointmentFinancial = {
      state: 'resolved',
      currency: 'USD',
      taxClassification: 'estimate',
      taxAmountCents: 500,
      taxLabel: 'Sales tax',
      taxMode: 'added',
      taxApplied: true,
      totalCents: 6500,
      collectedDepositCents: 2000,
      refundedDepositCents: 0,
      depositCreditCents: 2000,
      amountAlreadyPaidCents: 2000,
      balanceCents: 4500,
    };

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/client/next-appointment')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            appointment: {
              id: 'appt_1',
              startTime: '2099-03-20T15:00:00.000Z',
              endTime: '2099-03-20T16:15:00.000Z',
              status: 'confirmed',
              totalPrice: 6500,
              financial: appointmentFinancial,
            },
            services: [{ id: 'srv_1', name: 'BIAB Short', price: 6500 }],
            technician: null,
          },
        }), { status: 200 }));
      }
      if (url.includes('/api/rewards/redeem')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            discountApplied: 10,
            newTotalPrice: 55,
          },
        }), { status: 200 }));
      }
      if (url.includes('/api/rewards')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            rewards: [{
              id: 'reward_1',
              points: 0,
              status: 'active',
              type: 'referral',
              discountType: 'fixed_amount',
              discountAmountCents: 1000,
              discountPercent: null,
              eligibleServiceName: null,
              expiresAt: null,
              usedInAppointmentId: null,
              clientName: 'Ava',
              createdAt: '2099-01-01T00:00:00.000Z',
              isExpired: false,
              daysUntilExpiry: null,
              displayTitle: 'Referral reward',
              displaySubtitle: 'Thank you for referring a friend',
              kindLabel: 'Referral',
              valueLabel: 'Reward value',
            }],
          },
          meta: {
            activePoints: 3000,
            pendingPoints: 0,
            pendingAppointments: 0,
            streak: 0,
          },
        }), { status: 200 }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
  });

  it('uses the frozen USD estimate and shows the collected deposit and balance', async () => {
    render(<RewardsContent />);

    expect(await screen.findByText('Your Next Appointment')).toBeInTheDocument();
    expect(screen.getByText('$65.00 USD')).toBeInTheDocument();
    expect(screen.getByText('Deposit collected')).toBeInTheDocument();
    expect(screen.getByText('$45.00 USD')).toBeInTheDocument();
  });

  it('omits the raw appointment total when money provenance is unresolved', async () => {
    appointmentFinancial = { state: 'under_review' };

    render(<RewardsContent />);

    expect(await screen.findByTestId('client-appointment-financial-under-review'))
      .toHaveTextContent('Financial details are under review');
    expect(screen.queryByText('$65.00')).not.toBeInTheDocument();
  });

  it('disables both reward writers while appointment financials are under review', async () => {
    appointmentFinancial = { state: 'under_review' };

    render(<RewardsContent />);

    expect(await screen.findByTestId('reward-redemption-financial-review'))
      .toHaveTextContent('Rewards are temporarily unavailable');

    const apiRewardButton = screen.getByRole('button', { name: 'Under Review' });
    const pointsRewardButton = screen.getByRole('button', {
      name: 'Redeem $5 Off unavailable while financial details are under review',
    });

    expect(apiRewardButton).toBeDisabled();
    expect(pointsRewardButton).toBeDisabled();

    fireEvent.click(apiRewardButton);
    fireEvent.click(pointsRewardButton);

    expect(fetchMock.mock.calls.some(([, init]) => (
      (init as RequestInit | undefined)?.method === 'POST'
    ))).toBe(false);
  });

  it('does not present unqualified reward response amounts as the updated total', async () => {
    render(<RewardsContent />);

    fireEvent.click(await screen.findByRole('button', { name: 'Use' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Slide to confirm redemption' }), {
      target: { value: '100' },
    });

    await waitFor(() => {
      expect(screen.getByText('Reward applied.')).toBeInTheDocument();
    });

    expect(screen.getByText(/financial details are refreshing/i)).toBeInTheDocument();
    expect(screen.queryByText('$55.00')).not.toBeInTheDocument();
    expect(screen.queryByText('$10.00')).not.toBeInTheDocument();
  });
});
