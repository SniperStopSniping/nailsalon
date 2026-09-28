import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StarterSmsCreditsCard } from './StarterSmsCreditsCard';

const mocks = vi.hoisted(() => ({ openUserProfile: vi.fn() }));

vi.mock('@clerk/nextjs', () => ({
  useClerk: () => ({ openUserProfile: mocks.openUserProfile }),
}));

const fetchMock = vi.fn();

describe('StarterSmsCreditsCard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('claims only by salon id and updates the parent balance after a grant', async () => {
    const onClaimed = vi.fn();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: { granted: true, status: 'granted' },
    }), { status: 200 }));

    render(<StarterSmsCreditsCard salonId="salon_a" hasKnownStarterCredits={false} onClaimed={onClaimed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Claim 100 free texts' }));

    await waitFor(() => expect(onClaimed).toHaveBeenCalledOnce());

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/salon/communications/starter-credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonId: 'salon_a' }),
    });
    expect(screen.queryByText('100 free texts')).not.toBeInTheDocument();
  });

  it('sends an unverified owner to the Clerk profile instead of requesting contact data', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: { granted: false, status: 'verification_required' },
    }), { status: 200 }));

    render(<StarterSmsCreditsCard salonId="salon_a" hasKnownStarterCredits={false} onClaimed={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Claim 100 free texts' }));

    expect(await screen.findByText('Verify your primary email and phone number to claim your free texts.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Verify email and phone' }));

    expect(mocks.openUserProfile).toHaveBeenCalledOnce();
  });

  it('reconciles a historical allowance without adding a second balance', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: { granted: false, status: 'already_claimed' },
    }), { status: 200 }));
    render(<StarterSmsCreditsCard salonId="salon_a" hasKnownStarterCredits onClaimed={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Verify your free-text allowance' })).toBeInTheDocument();
    expect(screen.getByText('Link your verified owner email and phone number to your existing lifetime allowance. Your SMS credit balance stays the same.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Verify free-text allowance' }));

    expect(await screen.findByText('Your free-text allowance has been verified. Your existing SMS credits are unchanged.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/salon/communications/starter-credits', expect.objectContaining({
      body: JSON.stringify({ salonId: 'salon_a' }),
    }));
  });
});
