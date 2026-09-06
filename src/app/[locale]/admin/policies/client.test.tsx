import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SalonPoliciesClient } from './client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/admin/AdminImpersonationBanner', () => ({
  AdminImpersonationBanner: () => null,
}));

vi.mock('@/components/admin/MetaStatusPanel', () => ({
  MetaStatusPanel: () => <div data-testid="meta-status-panel" />,
}));

function renderPage() {
  render(
    <SalonPoliciesClient
      initialSalonPolicy={{
        requireBeforePhotoToStart: 'off',
        requireAfterPhotoToFinish: 'off',
        requireAfterPhotoToPay: 'off',
        autoPostEnabled: false,
        autoPostPlatforms: [],
        autoPostIncludePrice: false,
        autoPostIncludeColor: false,
        autoPostIncludeBrand: false,
        autoPostAiCaptionEnabled: false,
      }}
      superAdminPolicy={{
        requireBeforePhotoToStart: null,
        requireAfterPhotoToFinish: null,
        requireAfterPhotoToPay: null,
        autoPostEnabled: null,
        autoPostAiCaptionEnabled: null,
      }}
      salonName="Nail Salon No.5"
      salonSlug="nail-salon-no5"
      metaStatus={{
        hasSystemUserToken: false,
        hasFacebookPageId: false,
        hasInstagramAccountId: false,
        graphVersion: 'v19.0',
      }}
      latestFailure={null}
      locale="en"
    />,
  );
}

/*
  AG-w2-settings-integrations-15: this route rendered in a different visual
  language from the workspace it belongs to — iOS grey ground, a generic
  "Policy Settings" title, no sign of which salon was open — and leaked
  super-admin vocabulary to owners.
*/
describe('SalonPoliciesClient — inside the workspace shell', () => {
  it('wears the owner workspace chrome and names the salon it is editing', () => {
    renderPage();

    const page = screen.getByTestId('admin-policies-page');

    expect(page).toHaveClass('owner-workspace-theme');
    expect(page).toHaveAttribute('data-theme-scope', 'owner');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Photo & auto-post rules' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Managing Nail Salon No.5')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Back to your workspace' }),
    ).toBeInTheDocument();
  });

  it('speaks the owner’s language, not the platform’s', () => {
    renderPage();

    expect(document.body).not.toHaveTextContent(/super admin/i);
    expect(document.body).not.toHaveTextContent(/SA Forced/);
    expect(screen.getByText('What is enforced right now')).toBeInTheDocument();
  });
});
