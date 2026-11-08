import { render, screen, within } from '@testing-library/react';
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

  it('offers website setup and shopping with a single owner sign-in when enabled', async () => {
    render(await HomePage({}));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The booking app built for nail techs and nail salons.');
    expect(screen.getByRole('link', { name: 'Build my website' })).toHaveAttribute('href', '/onboarding-v1');
    expect(screen.queryByRole('link', { name: 'Open owner dashboard' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Salon owner sign in' })).toHaveAttribute('href', '/owner-sign-in');
    expect(screen.getAllByRole('link').filter(link => link.getAttribute('href') === '/owner-sign-in')).toHaveLength(1);

    const shopLinks = screen.getAllByRole('link', { name: 'Shop Luster gel' });

    expect(shopLinks).toHaveLength(2);
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Shop Luster gel' })).toBeVisible();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Shop Luster gel' })).toBeVisible();

    shopLinks.forEach((link) => {
      expect(link).toHaveAttribute('href', 'https://lustergel.ca/shop');
      expect(link).not.toHaveAttribute('target');
    });
  });

  it('does not advertise disabled onboarding or change the existing owner entry', async () => {
    mocks.enabled.mockReturnValue(false);
    render(await HomePage({}));

    expect(screen.queryByRole('link', { name: 'Build my website' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open owner dashboard' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Salon owner sign in' })).toHaveAttribute('href', '/owner-sign-in');
    expect(screen.getAllByRole('link', { name: 'Shop Luster gel' })).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Request an invite' })).toHaveAttribute('href', expect.stringContaining('mailto:'));
  });

  it('defaults to the safe existing entry when no integration flag is supplied', () => {
    render(<LusterHome />);

    expect(screen.queryByRole('link', { name: 'Build my website' })).not.toBeInTheDocument();
  });

  it('keeps French copy and destinations in sync', async () => {
    render(await LocalizedHomePage({ params: Promise.resolve({ locale: 'fr' }) }));

    expect(screen.getByRole('link', { name: 'Créer mon site web' })).toHaveAttribute('href', '/fr/onboarding-v1');
    expect(screen.queryByRole('link', { name: 'Ouvrir mon tableau de bord' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connexion propriétaire' })).toHaveAttribute('href', '/fr/owner-sign-in');

    const shopLinks = screen.getAllByRole('link', { name: 'Acheter le gel Luster' });

    expect(shopLinks).toHaveLength(2);

    shopLinks.forEach(link => expect(link).toHaveAttribute('href', 'https://lustergel.ca/shop'));

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('preserves tenant customer booking redirects on the root homepage', async () => {
    await expect(HomePage({ searchParams: Promise.resolve({ salonSlug: 'maya-nails' }) })).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining('maya-nails'));
    expect(mocks.enabled).not.toHaveBeenCalled();
  });

  it('keeps shopping and one localized sign-in when French onboarding is disabled', () => {
    render(<LusterHome locale="fr" websiteSetupEnabled={false} />);

    expect(screen.queryByRole('link', { name: 'Créer mon site web' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ouvrir mon tableau de bord' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connexion propriétaire' })).toHaveAttribute('href', '/fr/owner-sign-in');
    expect(screen.getAllByRole('link', { name: 'Acheter le gel Luster' })).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Demander une invitation' })).toHaveAttribute('href', expect.stringContaining('mailto:'));
  });

  it('preserves tenant customer booking redirects on localized homepages', async () => {
    await expect(LocalizedHomePage({ params: Promise.resolve({ locale: 'fr' }), searchParams: Promise.resolve({ salonSlug: 'maya-nails' }) })).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringMatching(/^\/fr\/.*maya-nails/u));
    expect(mocks.enabled).not.toHaveBeenCalled();
  });
});
