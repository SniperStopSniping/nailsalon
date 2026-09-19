import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PaymentsModal } from './PaymentsModal';
import { RewardsReviewsModal } from './RewardsReviewsModal';
import { TeamModal } from './TeamModal';

const { pushMock, replaceMock, state } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
  state: { query: '' },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(state.query),
}));

afterEach(() => {
  cleanup();
  pushMock.mockReset();
  replaceMock.mockReset();
  state.query = '';
});

function queryOf(href: string) {
  return new URL(href, 'https://luster.test').searchParams;
}

describe('owner dashboard app hubs', () => {
  it('keeps team schedules and time-off as contextual Hours shortcuts', () => {
    state.query = 'salon=studio&client=client_9&returnTo=calendar&technician=old_tech&app=team';
    render(<TeamModal onClose={vi.fn()} salonSlug="studio" />);

    expect(screen.getByText('Team Members')).toBeInTheDocument();
    expect(screen.getByText('Team schedules')).toBeInTheDocument();
    expect(screen.getByText('Time Off')).toBeInTheDocument();
    expect(screen.getByText('Time-off requests')).toBeInTheDocument();
    expect(screen.getByText('Services & Skills')).toBeInTheDocument();
    expect(screen.getByText('Permissions')).toBeInTheDocument();
    expect(screen.getByText('Earnings')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Team schedules'));
    fireEvent.click(screen.getByText('Time Off'));
    fireEvent.click(screen.getByText('Time-off requests'));

    expect(pushMock).toHaveBeenCalledTimes(3);

    for (const [index, view] of ['working-hours', 'time-off', 'requests'].entries()) {
      const query = queryOf(pushMock.mock.calls[index]![0]);

      expect(query.get('salon')).toBe('studio');
      expect(query.get('client')).toBe('client_9');
      expect(query.get('returnTo')).toBe('calendar');
      expect(query.get('app')).toBe('hours');
      expect(query.get('view')).toBe(view);
      expect(query.get('technician')).toBeNull();
    }
  });

  it('replaces legacy Team schedule paths with their canonical Hours destination', () => {
    state.query = 'salon=studio&returnTo=calendar&app=team&view=schedules';
    render(<TeamModal onClose={vi.fn()} salonSlug="studio" initialView="schedules" />);

    expect(replaceMock).toHaveBeenCalledTimes(1);

    const query = queryOf(replaceMock.mock.calls[0]![0]);

    expect(query.get('salon')).toBe('studio');
    expect(query.get('returnTo')).toBe('calendar');
    expect(query.get('app')).toBe('hours');
    expect(query.get('view')).toBe('working-hours');
  });

  it('keeps client-payment behavior together and hands Stripe setup to Integrations', () => {
    const onOpenIntegrations = vi.fn();
    render(
      <PaymentsModal
        onClose={vi.fn()}
        onOpenIntegrations={onOpenIntegrations}
        salonSlug="studio"
      />,
    );

    expect(screen.getByText('Deposits')).toBeInTheDocument();
    expect(screen.getByText('Payment Methods')).toBeInTheDocument();
    expect(screen.getByText('Taxes')).toBeInTheDocument();
    expect(screen.getByText('Currency')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Stripe / Payouts'));

    expect(onOpenIntegrations).toHaveBeenCalledOnce();
  });

  it('combines rewards, referrals, reviews and offer rules without bypassing gates', () => {
    render(
      <RewardsReviewsModal
        onClose={vi.fn()}
        reviewsAvailable={false}
        rewardsAvailable={false}
      />,
    );

    expect(screen.getByRole('button', { name: /Rewards Program/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Referrals/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Reviews/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Offers/ })).toBeDisabled();
  });
});
