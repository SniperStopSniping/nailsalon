import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LocalizedHomePage from '@/app/[locale]/(unauth)/page';
import HomePage from '@/app/page';

import { LusterHome } from './LusterHome';

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

vi.mock('@/features/onboarding-v1-integration/config.server', () => ({
  isOnboardingV1IntegrationEnabled: mocks.enabled,
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

describe('Luster homepage entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled.mockReturnValue(true);
  });

  it('offers website setup before dashboard access when the integration is enabled', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Let’s build your website.');
    expect(screen.getByRole('link', { name: 'Build my website' })).toHaveAttribute('href', '/en/onboarding-v1');
    expect(screen.getByRole('link', { name: 'Open owner dashboard' })).toHaveAttribute('href', '/en/owner-sign-in');
    expect(screen.getByRole('link', { name: 'Salon owner sign in' })).toHaveAttribute('href', '/en/owner-sign-in');
  });

  it('does not advertise disabled onboarding or change the existing owner entry', () => {
    mocks.enabled.mockReturnValue(false);
    render(<HomePage />);

    expect(screen.queryByRole('link', { name: 'Build my website' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open owner dashboard' })).toHaveAttribute('href', '/en/owner-sign-in');
    expect(screen.getByRole('link', { name: 'Request an invite' })).toHaveAttribute('href', expect.stringContaining('mailto:'));
  });

  it('defaults to the safe existing entry when no integration flag is supplied', () => {
    render(<LusterHome />);

    expect(screen.queryByRole('link', { name: 'Build my website' })).not.toBeInTheDocument();
  });

  it('keeps French copy and destinations in sync', () => {
    render(<LocalizedHomePage params={{ locale: 'fr' }} />);

    expect(screen.getByRole('link', { name: 'Créer mon site web' })).toHaveAttribute('href', '/fr/onboarding-v1');
    expect(screen.getByRole('link', { name: 'Ouvrir mon tableau de bord' })).toHaveAttribute('href', '/fr/owner-sign-in');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('preserves tenant customer booking redirects on the root homepage', () => {
    expect(() => HomePage({ searchParams: { salonSlug: 'maya-nails' } })).toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining('maya-nails'));
    expect(mocks.enabled).not.toHaveBeenCalled();
  });

  it('preserves tenant customer booking redirects on localized homepages', () => {
    expect(() => LocalizedHomePage({ params: { locale: 'fr' }, searchParams: { salonSlug: 'maya-nails' } })).toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringMatching(/^\/fr\/.*maya-nails/u));
    expect(mocks.enabled).not.toHaveBeenCalled();
  });
});
