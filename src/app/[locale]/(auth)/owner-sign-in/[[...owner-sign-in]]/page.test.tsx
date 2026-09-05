import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import OwnerSignInPage from './page';

const mocks = vi.hoisted(() => ({
  card: vi.fn(),
}));

vi.mock('@/components/auth/OwnerSignInCard', () => ({
  OwnerSignInCard: (props: { dashboardUrl: string }) => {
    mocks.card(props);

    return <div data-testid="owner-sign-in-card" />;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OwnerSignInPage', () => {
  it('names Luster once, under a single page heading', async () => {
    render(await OwnerSignInPage({ params: Promise.resolve({ locale: 'en' }) }));

    const headings = screen.getAllByRole('heading', { level: 1 });

    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Salon owner sign in');
    expect(screen.getByText('Sign in to Luster to open your salon workspace.')).toBeInTheDocument();
    expect(screen.getByTestId('owner-sign-in-card')).toBeInTheDocument();
  });

  it('offers no self-serve sign-up path (owner accounts are invitation-only)', async () => {
    render(await OwnerSignInPage({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.queryByRole('link', { name: /sign up/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/My Application/i)).not.toBeInTheDocument();
  });

  it('sends the owner to the workspace for the active locale', async () => {
    render(await OwnerSignInPage({ params: Promise.resolve({ locale: 'fr' }) }));

    expect(mocks.card).toHaveBeenCalledWith(expect.objectContaining({ dashboardUrl: '/fr/admin' }));
  });
});
