import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StarterSmsCreditsCard } from './StarterSmsCreditsCard';

const mocks = vi.hoisted(() => ({ openUserProfile: vi.fn() }));

vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({ user: null }),
  useClerk: () => ({ openUserProfile: mocks.openUserProfile }),
}));

const fetchMock = vi.fn();
const endpoint = '/api/admin/salon/communications/starter-credits';

function statusResponse(status: 'verified' | 'verification_required' | 'unclaimed', canClaim: boolean) {
  return new Response(JSON.stringify({ data: { status, canClaim } }), { status: 200 });
}

describe('StarterSmsCreditsCard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('claims only after the owner-authorized status read and refreshes the balance after a grant', async () => {
    const onClaimed = vi.fn();
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ data: { granted: true, status: 'granted' } }), { status: 200 });
      }
      return statusResponse('unclaimed', true);
    });

    render(<StarterSmsCreditsCard salonId="salon_a" hasKnownStarterCredits={false} onClaimed={onClaimed} />);

    expect(screen.getByText('Checking free-text allowance…')).toBeInTheDocument();

    const claim = await screen.findByRole('button', { name: 'Claim 100 free texts' });
    fireEvent.click(claim);

    await waitFor(() => expect(onClaimed).toHaveBeenCalledOnce());

    expect(fetchMock).toHaveBeenNthCalledWith(1, `${endpoint}?salonId=salon_a`, { cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonId: 'salon_a' }),
    });
    expect(screen.getByText('100 free SMS credits have been added.')).toBeInTheDocument();
  });

  it('sends an unverified owner to the Clerk profile instead of requesting contact data', async () => {
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ data: { granted: false, status: 'verification_required' } }), { status: 200 });
      }
      return statusResponse('verification_required', true);
    });

    render(<StarterSmsCreditsCard salonId="salon_a" hasKnownStarterCredits={false} onClaimed={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Verify free-text allowance' }));

    expect(screen.getByRole('heading', { name: 'Verify your free-text allowance' })).toBeInTheDocument();
    expect(screen.getByText('Link your verified owner email and phone number to your existing lifetime allowance. Your SMS credit balance stays the same.')).toBeInTheDocument();

    expect(await screen.findByText('Verify your primary email and phone number to claim your free texts.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Verify email and phone' }));

    expect(mocks.openUserProfile).toHaveBeenCalledOnce();
  });

  it('shows a collaborator the owner-only explanation without posting a claim', async () => {
    fetchMock.mockResolvedValue(statusResponse('unclaimed', false));

    render(<StarterSmsCreditsCard salonId="salon_a" hasKnownStarterCredits={false} onClaimed={vi.fn()} />);

    expect(await screen.findByText('Only the salon owner can verify the free-text allowance. Sign in with the owner account.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Claim|Verify free-text/ })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows an explicit status retry after a status network error without granting credits', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(statusResponse('unclaimed', true));

    render(<StarterSmsCreditsCard salonId="salon_a" hasKnownStarterCredits={false} onClaimed={vi.fn()} />);

    expect(await screen.findByText('We could not check your free-text allowance. Please try again.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry status check' }));

    expect(await screen.findByRole('button', { name: 'Claim 100 free texts' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  });

  it('does not offer a repeat claim when reopening a verified allowance', async () => {
    fetchMock.mockImplementation(() => statusResponse('verified', false));
    const { unmount } = render(<StarterSmsCreditsCard salonId="salon_a" hasKnownStarterCredits onClaimed={vi.fn()} />);

    expect(await screen.findByText('Free-text allowance already claimed. Verification does not add another 100 credits.')).toBeInTheDocument();

    unmount();
    render(<StarterSmsCreditsCard salonId="salon_a" hasKnownStarterCredits onClaimed={vi.fn()} />);

    expect(await screen.findByText('Free-text allowance already claimed. Verification does not add another 100 credits.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  });

  it('ignores a stale status response after the salon changes', async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    fetchMock
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(statusResponse('verified', false));
    const { rerender } = render(<StarterSmsCreditsCard salonId="salon_a" hasKnownStarterCredits={false} onClaimed={vi.fn()} />);

    rerender(<StarterSmsCreditsCard salonId="salon_b" hasKnownStarterCredits={false} onClaimed={vi.fn()} />);

    expect(await screen.findByText('Free-text allowance already claimed. Verification does not add another 100 credits.')).toBeInTheDocument();

    resolveFirst!(statusResponse('unclaimed', true));
    await waitFor(() => expect(screen.getByText('Free-text allowance already claimed. Verification does not add another 100 credits.')).toBeInTheDocument());
  });

  it('does not let a delayed claim for an old salon update the new salon', async () => {
    let resolveClaim: ((response: Response) => void) | undefined;
    const delayedClaim = new Promise<Response>((resolve) => {
      resolveClaim = resolve;
    });
    const onClaimed = vi.fn();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return delayedClaim;
      }
      return statusResponse(String(input).includes('salon_b') ? 'verification_required' : 'unclaimed', true);
    });
    const { rerender } = render(<StarterSmsCreditsCard salonId="salon_a" hasKnownStarterCredits={false} onClaimed={onClaimed} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Claim 100 free texts' }));

    expect(await screen.findByRole('button', { name: 'Verifying…' })).toBeDisabled();

    rerender(<StarterSmsCreditsCard salonId="salon_b" hasKnownStarterCredits={false} onClaimed={onClaimed} />);

    expect(await screen.findByRole('button', { name: 'Verify free-text allowance' })).toBeEnabled();

    resolveClaim!(new Response(JSON.stringify({ data: { status: 'granted' } }), { status: 200 }));
    await Promise.resolve();
    await Promise.resolve();

    expect(onClaimed).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Verify free-text allowance' })).toBeEnabled();
  });

  it('offers verification immediately without submitting a claim, then rechecks on return', async () => {
    let ready = false;
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: {
      status: 'unclaimed',
      canClaim: true,
      verification: { email: true, phone: ready },
    } })));
    render(<StarterSmsCreditsCard salonId="salon_a" onClaimed={vi.fn()} inline />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verify email and phone' }));
    await waitFor(() => expect(mocks.openUserProfile).toHaveBeenCalledOnce());

    expect(await screen.findByText('✓ Email verified')).toBeInTheDocument();
    expect(screen.getByText('2. Verify phone')).toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);

    ready = true;
    fireEvent.click(screen.getByRole('button', { name: 'I’ve verified — check again' }));

    expect(await screen.findByRole('button', { name: 'Claim 100 free texts' })).toBeEnabled();
    expect(screen.getByText('✓ Phone verified')).toBeInTheDocument();
  });

  it('keeps an already claimed allowance compact on More, including after all credits are used', async () => {
    fetchMock.mockResolvedValue(statusResponse('verified', false));
    render(<StarterSmsCreditsCard salonId="salon_a" onClaimed={vi.fn()} inline />);
    await waitFor(() => expect(screen.queryByText('Checking free-text allowance…')).not.toBeInTheDocument());

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('keeps a claim in flight across rapid clicks and focus refreshes', async () => {
    let settle!: (response: Response) => void;
    const onClaimed = vi.fn();
    fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST'
      ? new Promise<Response>((resolve) => {
        settle = resolve;
      })
      : Promise.resolve(statusResponse('unclaimed', true)));
    render(<StarterSmsCreditsCard salonId="salon_a" onClaimed={onClaimed} inline />);
    const claim = await screen.findByRole('button', { name: 'Claim 100 free texts' });
    fireEvent.click(claim);
    fireEvent.click(claim);
    fireEvent(window, new Event('focus'));

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);

    settle(new Response(JSON.stringify({ data: { granted: true, status: 'granted' } })));

    expect(await screen.findByText('100 free SMS credits have been added.')).toBeInTheDocument();
    expect(onClaimed).toHaveBeenCalledOnce();
  });

  it('keeps the Today claim honest when free-credit activation is unavailable', async () => {
    const onClaimed = vi.fn();
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST'
      ? new Response(JSON.stringify({ data: { granted: false, status: 'identity_setup_required' } }))
      : statusResponse('unclaimed', true));
    render(<StarterSmsCreditsCard salonId="salon_a" onClaimed={onClaimed} dashboardFallback={<button type="button">Buy texts</button>} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Claim 100 free texts' }));

    expect(await screen.findByText('Free texts are temporarily unavailable. Please try again later or contact support.')).toBeInTheDocument();
    expect(screen.queryByText('100 free SMS credits have been added.')).not.toBeInTheDocument();
    expect(onClaimed).not.toHaveBeenCalled();
  });
});
