import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { saveOnboardingIntegrationRecoveryRecord } from '@/features/onboarding-v1-integration/flow-storage';
import type { SavedSitePreviewModel } from '@/features/onboarding-v1-integration/saved-preview';

import { SavedSitePreviewClient } from './SavedSitePreviewClient';

vi.mock('../../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/integration/CustomDesignAssetProvider', () => ({
  CustomDesignAssetProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/preview/OnboardingSitePreview', () => ({
  OnboardingSitePreview: ({ device, interactionMode }: {
    device: string;
    interactionMode: string;
  }) => (
    <div data-device={device} data-interaction={interactionMode} data-testid="saved-customer-site" />
  ),
}));

const model = {
  document: { pages: [] },
  media: [],
  state: {},
} as unknown as SavedSitePreviewModel;

const props = {
  embedded: false,
  locale: 'en',
  model,
  revision: 4,
  salonSlug: 'isla',
  setupUrl: '/en/onboarding-v1?resume=review&site=site_1',
  showAuditRevision: false,
  siteId: 'site_1',
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('SavedSitePreviewClient', () => {
  it('keeps customer tokens inside the Preview and owner tokens on the shell', () => {
    const { container } = render(<SavedSitePreviewClient {...props} />);

    expect(container.querySelector('[data-theme-scope="owner"]'))
      .toHaveClass('owner-workspace-theme');
    expect(container.querySelector('[data-theme-scope="site"]'))
      .toContainElement(screen.getByTestId('saved-customer-site'));

    fireEvent.click(screen.getByRole('button', { name: 'Desktop' }));

    expect(screen.getByTestId('saved-customer-site')).toHaveAttribute('data-device', 'desktop');
  });

  it('offers setup changes only for a matching verified same-browser revision', async () => {
    saveOnboardingIntegrationRecoveryRecord({ siteId: 'site_1', verifiedRevision: 4 });
    render(<SavedSitePreviewClient {...props} />);

    expect(await screen.findByRole('link', { name: 'Change website setup' })).toHaveAttribute(
      'href',
      props.setupUrl,
    );
  });

  it('omits setup changes on a different browser or revision', async () => {
    saveOnboardingIntegrationRecoveryRecord({ siteId: 'site_1', verifiedRevision: 3 });
    render(<SavedSitePreviewClient {...props} />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Return to Workspace' })).toBeInTheDocument();
    });

    expect(screen.queryByRole('link', { name: 'Change website setup' })).not.toBeInTheDocument();
  });

  it('uses the inert customer-only shell when embedded in the saved celebration', () => {
    render(<SavedSitePreviewClient {...props} embedded />);

    expect(screen.getByTestId('saved-customer-site')).toHaveAttribute('data-device', 'phone');
    expect(screen.getByTestId('saved-customer-site')).toHaveAttribute('data-interaction', 'inline');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
