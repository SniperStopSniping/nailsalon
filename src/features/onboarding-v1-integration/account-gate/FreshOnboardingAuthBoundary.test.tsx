import { ClerkProvider } from '@clerk/nextjs';
import { cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FreshOnboardingAuthBoundary } from './FreshOnboardingAuthBoundary';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FreshOnboardingAuthBoundary', () => {
  it('withholds the real Clerk provider and its scripts during server rendering', () => {
    const html = renderToString(
      <FreshOnboardingAuthBoundary>
        <ClerkProvider publishableKey="pk_test_Zml4dHVyZS5jbGVyay5hY2NvdW50cy5kZXYk">
          <p>Owner account form</p>
        </ClerkProvider>
      </FreshOnboardingAuthBoundary>,
    );

    expect(html).toContain('Opening your business setup');
    expect(html).not.toContain('Owner account form');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('data-clerk-js-script');
  });

  it('opens a fresh document without starting a reload', () => {
    render(<FreshOnboardingAuthBoundary><p>Owner account form</p></FreshOnboardingAuthBoundary>);

    expect(screen.getByText('Owner account form')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not reclassify its own initialized provider on a later StrictMode render', () => {
    const view = render(
      <StrictMode>
        <FreshOnboardingAuthBoundary><p>Owner account form</p></FreshOnboardingAuthBoundary>
      </StrictMode>,
    );
    vi.stubGlobal('Clerk', { loaded: true });

    view.rerender(
      <StrictMode>
        <FreshOnboardingAuthBoundary><p>Verified owner account</p></FreshOnboardingAuthBoundary>
      </StrictMode>,
    );

    expect(screen.getByText('Verified owner account')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
