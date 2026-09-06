import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import OwnerAdminLayout from './layout';

const mocks = vi.hoisted(() => ({
  boundary: vi.fn(),
  enabled: vi.fn(() => false),
}));

// next/font/google resolves font files at build time; under Vitest it never
// settles, so stub the two faces the admin layout publishes as CSS variables.
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: '--font-owner-sans', className: 'font-owner-sans', style: { fontFamily: 'Inter' } }),
  Newsreader: () => ({ variable: '--font-owner-display', className: 'font-owner-display', style: { fontFamily: 'Newsreader' } }),
}));

// The dark Section Gallery flag is read server-side (server-only + Env); keep
// the layout test hermetic by mocking it like the onboarding flag.
vi.mock('@/features/section-library-v1/config.server', () => ({
  isSectionLibraryV1Enabled: () => false,
}));

vi.mock('@/features/onboarding-v1-integration/config.server', () => ({
  isOnboardingV1IntegrationEnabled: mocks.enabled,
}));

vi.mock('./OwnerAdminClientBoundary', () => ({
  OwnerAdminClientBoundary: (props: {
    children: React.ReactNode;
    locale: string;
    onboardingV1IntegrationEnabled: boolean;
  }) => {
    mocks.boundary(props);
    return <div data-testid="owner-admin-boundary">{props.children}</div>;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(false);
});

describe('OwnerAdminLayout integration flag boundary', () => {
  it('resolves the dark-default integration flag on the server boundary', async () => {
    render(await OwnerAdminLayout({
      params: Promise.resolve({ locale: 'en' }),
      children: <p>Workspace</p>,
    }));

    expect(screen.getByTestId('owner-admin-boundary')).toHaveTextContent('Workspace');
    expect(mocks.enabled).toHaveBeenCalledOnce();
    expect(mocks.boundary).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'en',
      onboardingV1IntegrationEnabled: false,
    }));
  });

  it('passes an explicit enabled value to the client dashboard', async () => {
    mocks.enabled.mockReturnValue(true);

    render(await OwnerAdminLayout({
      params: Promise.resolve({ locale: 'fr' }),
      children: <p>Espace de travail</p>,
    }));

    expect(mocks.boundary).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'fr',
      onboardingV1IntegrationEnabled: true,
    }));
  });
});
