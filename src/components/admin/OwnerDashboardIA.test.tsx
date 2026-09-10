import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PaymentsModal } from './PaymentsModal';
import { RewardsReviewsModal } from './RewardsReviewsModal';
import { TeamModal } from './TeamModal';

afterEach(() => {
  cleanup();
});

describe('owner dashboard app hubs', () => {
  it('groups team work and keeps requests separate from owner blocked time', () => {
    render(<TeamModal onClose={vi.fn()} salonSlug="studio" />);

    expect(screen.getByText('Team Members')).toBeInTheDocument();
    expect(screen.getByText('Schedules')).toBeInTheDocument();
    expect(screen.getByText('Services & Skills')).toBeInTheDocument();
    expect(screen.getByText('Permissions')).toBeInTheDocument();
    expect(screen.getByText('Earnings')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Time Off'));

    expect(screen.getByText('Requests')).toBeInTheDocument();
    expect(screen.getByText('Blocked Time')).toBeInTheDocument();
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
