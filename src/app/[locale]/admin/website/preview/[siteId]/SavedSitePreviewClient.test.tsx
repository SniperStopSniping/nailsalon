import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SavedSitePreviewModel } from '@/features/onboarding-v1-integration/saved-preview';

import { SavedSitePreviewClient } from './SavedSitePreviewClient';

vi.mock('../../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/integration/CustomDesignAssetProvider', () => ({
  CustomDesignAssetProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/preview/OnboardingSitePreview', () => ({
  OnboardingSitePreview: ({ customerPagePlan, device, interactionMode }: {
    customerPagePlan: unknown;
    device: string;
    interactionMode: string;
  }) => (
    <div
      data-device={device}
      data-interaction={interactionMode}
      data-page-plan={JSON.stringify(customerPagePlan)}
      data-testid="saved-customer-site"
    />
  ),
}));

const model = {
  document: { pages: [] },
  media: [],
  pagePlan: [{ id: 'home', label: 'Home', sections: [] }],
  state: {},
} as unknown as SavedSitePreviewModel;

const props = {
  embedded: false,
  locale: 'en',
  model,
  revision: 4,
  salonSlug: 'isla',
  setupAvailable: true,
  setupUrl: '/en/onboarding-v1?resume=review&site=site_1&revision=4',
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
    expect(screen.getByTestId('saved-customer-site'))
      .toHaveAttribute('data-page-plan', JSON.stringify(model.pagePlan));

    fireEvent.click(screen.getByRole('button', { name: 'Desktop' }));

    expect(screen.getByTestId('saved-customer-site')).toHaveAttribute('data-device', 'desktop');
  });

  it('offers server-authorized setup after signing in on a new device', async () => {
    render(<SavedSitePreviewClient {...props} />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Return to Workspace' })).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'Change website setup' }))
      .toHaveAttribute('href', props.setupUrl);
    expect(screen.getByRole('link', { name: 'Manage & publish Booking Page' }))
      .toHaveAttribute('href', '/en/admin/website?salon=isla');
  });

  it('omits setup changes when the server says the saved site cannot be edited', async () => {
    render(<SavedSitePreviewClient {...props} setupAvailable={false} />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Return to Workspace' })).toBeInTheDocument();
    });

    expect(screen.queryByRole('link', { name: 'Change website setup' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage & publish Booking Page' }))
      .toHaveAttribute('href', '/en/admin/website?salon=isla');
  });

  it('uses the inert customer-only shell when embedded in the saved celebration', () => {
    render(<SavedSitePreviewClient {...props} embedded />);

    expect(screen.getByTestId('saved-customer-site')).toHaveAttribute('data-device', 'phone');
    expect(screen.getByTestId('saved-customer-site')).toHaveAttribute('data-interaction', 'inline');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
