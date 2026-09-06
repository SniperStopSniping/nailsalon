import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OwnerSignInCard } from './OwnerSignInCard';

type ClerkResourceListener = (resources: { session: unknown }) => void;

const mocks = vi.hoisted(() => ({
  clerk: {
    addListener: vi.fn((_listener: (resources: { session: unknown }) => void) => () => undefined),
    session: null as unknown,
    setActive: vi.fn(),
  },
  resolveOrganization: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('@clerk/nextjs', () => ({
  SignIn: (props: Record<string, unknown>) => {
    mocks.signIn(props);

    return (
      <div data-testid="clerk-sign-in">
        <h1>Sign in to Luster</h1>
        <a href="#/sign-up">Sign up</a>
      </div>
    );
  },
  useClerk: () => mocks.clerk,
}));

vi.mock('@/features/onboarding-v1-integration/client', () => ({
  resolveOnboardingOrganization: mocks.resolveOrganization,
}));

const pendingOrganizationSession = {
  currentTask: { key: 'choose-organization' },
  id: 'sess_pending',
  status: 'pending',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clerk.session = null;
  mocks.clerk.addListener.mockReturnValue(() => undefined);
  mocks.clerk.setActive.mockResolvedValue(undefined);
  mocks.resolveOrganization.mockResolvedValue({
    created: true,
    organizations: [{ id: 'org_1', name: 'My nail studio' }],
  });
});

describe('OwnerSignInCard branding', () => {
  it('themes the Clerk widget with Luster tokens and hides the sign-up footer', () => {
    render(<OwnerSignInCard dashboardUrl="/en/admin" />);

    expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument();
    expect(mocks.signIn).toHaveBeenCalledWith(expect.objectContaining({
      appearance: {
        elements: {
          footerAction__signIn: { display: 'none' },
          headerTitle: { display: 'none' },
        },
        variables: expect.objectContaining({
          borderRadius: '14px',
          colorPrimary: '#8f3155',
        }),
      },
      fallbackRedirectUrl: '/en/admin',
    }));
  });
});

describe('OwnerSignInCard organization task', () => {
  it('resolves the choose-organization task without showing Clerk\'s form', async () => {
    mocks.clerk.session = pendingOrganizationSession;

    render(<OwnerSignInCard dashboardUrl="/en/admin" />);

    expect(screen.getByRole('status')).toHaveTextContent('Opening your workspace…');
    expect(screen.queryByTestId('clerk-sign-in')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.clerk.setActive).toHaveBeenCalledWith({
        organization: 'org_1',
        redirectUrl: '/en/admin',
        session: 'sess_pending',
      });
    });

    expect(mocks.resolveOrganization).toHaveBeenCalledOnce();
  });

  it('reacts to a session that turns pending after the password step', async () => {
    let listener: ClerkResourceListener | null = null;
    mocks.clerk.addListener.mockImplementation((callback: ClerkResourceListener) => {
      listener = callback;

      return () => undefined;
    });

    render(<OwnerSignInCard dashboardUrl="/en/admin" />);

    expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument();

    await act(async () => {
      listener?.({ session: pendingOrganizationSession });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('clerk-sign-in')).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mocks.clerk.setActive).toHaveBeenCalledOnce();
    });
  });

  it('offers a retry when the organization cannot be resolved', async () => {
    mocks.clerk.session = pendingOrganizationSession;
    mocks.resolveOrganization.mockRejectedValueOnce(new Error('We couldn’t finish setting up your business. Try again.'));

    render(<OwnerSignInCard dashboardUrl="/en/admin" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t finish setting up your business. Try again.');
    });

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(mocks.clerk.setActive).toHaveBeenCalledOnce();
    });
  });
});
