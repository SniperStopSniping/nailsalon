import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import OwnerSignInPage from './page';

const mocks = vi.hoisted(() => ({ card: vi.fn(), enabled: vi.fn(() => false) }));
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: 'entry-sans' }),
  Newsreader: () => ({ variable: 'entry-display' }),
}));
vi.mock('@/features/onboarding-v1-integration/config.server', () => ({
  isOnboardingV1IntegrationEnabled: mocks.enabled,
}));
vi.mock('@/components/auth/OwnerSignInCard', () => ({
  OwnerSignInCard: (props: { dashboardUrl: string; createSalonUrl?: string }) => {
    mocks.card(props);
    return <div data-testid="owner-sign-in-card" />;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(false);
});

describe('OwnerSignInPage', () => {
  it('has one calm welcome heading and the existing authentication card', async () => {
    render(await OwnerSignInPage({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByText('Sign in to manage your salon, bookings and clients.')).toBeInTheDocument();
    expect(screen.getByTestId('owner-sign-in-card')).toBeInTheDocument();
    expect(screen.queryByText('Salon owner sign in')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  });

  it('does not send new owners into disabled onboarding', async () => {
    render(await OwnerSignInPage({ params: Promise.resolve({ locale: 'en' }) }));

    expect(mocks.card).toHaveBeenCalledWith(expect.objectContaining({ createSalonUrl: undefined }));
  });

  it('uses the canonical enabled salon builder and localized dashboard', async () => {
    mocks.enabled.mockReturnValue(true);
    render(await OwnerSignInPage({ params: Promise.resolve({ locale: 'fr' }) }));

    expect(mocks.card).toHaveBeenCalledWith(expect.objectContaining({ dashboardUrl: '/fr/admin', createSalonUrl: '/fr/onboarding-v1' }));
  });
});
