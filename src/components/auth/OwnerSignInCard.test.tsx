import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingIntegrationRequestError } from '@/features/onboarding-v1-integration/client';

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
  signUp: vi.fn(),
}));

vi.mock('@clerk/nextjs', () => ({
  SignUp: (props: Record<string, unknown>) => {
    mocks.signUp(props);
    return <div>Save your Luster account</div>;
  },
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

vi.mock('@/features/onboarding-v1-integration/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/onboarding-v1-integration/client')>(),
  resolveOnboardingOrganization: mocks.resolveOrganization,
}));

const pendingOrganizationSession = {
  currentTask: { key: 'choose-organization' },
  getToken: vi.fn().mockResolvedValue('synthetic-session-token'),
  id: 'sess_pending',
  status: 'pending',
};

const createDeferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
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
  it('keeps AI signup on the requested builder return and resolves the same organization task', async () => {
    mocks.clerk.session = pendingOrganizationSession;
    render(<OwnerSignInCard mode="sign-up" dashboardUrl="/en/ai-website" signInUrl="/en/ai-website?account=sign-in" />);

    expect(mocks.signUp).toHaveBeenCalledWith(expect.objectContaining({ forceRedirectUrl: '/en/ai-website', signInUrl: '/en/ai-website?account=sign-in', routing: 'hash' }));

    await waitFor(() => expect(mocks.clerk.setActive).toHaveBeenCalledWith({ organization: 'org_1', redirectUrl: '/en/ai-website', session: 'sess_pending' }));
  });

  it('uses the supplied salon builder link when self-service onboarding is enabled', () => {
    render(<OwnerSignInCard dashboardUrl="/en/admin" createSalonUrl="/en/onboarding-v1" />);

    expect(mocks.signIn).toHaveBeenCalledWith(expect.objectContaining({
      signUpUrl: '/en/onboarding-v1',
      appearance: expect.objectContaining({
        elements: expect.objectContaining({ footerAction__signIn: 'luster-auth-create' }),
      }),
    }));
  });

  it('themes the Clerk widget with Luster tokens and hides the sign-up footer', () => {
    render(<OwnerSignInCard dashboardUrl="/en/admin" />);

    expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument();
    expect(mocks.signIn).toHaveBeenCalledWith(expect.objectContaining({
      appearance: expect.objectContaining({
        elements: expect.objectContaining({
          footerAction__signIn: { display: 'none' },
          headerTitle: { display: 'none' },
          formButtonPrimary: 'luster-auth-primary',
        }),
        variables: expect.objectContaining({
          borderRadius: '14px',
          colorPrimary: '#8f3155',
          colorForeground: '#30262a',
          colorMutedForeground: '#706267',
        }),
        options: { socialButtonsPlacement: 'bottom', socialButtonsVariant: 'blockButton' },
      }),
      fallbackRedirectUrl: '/en/admin',
    }));
  });
});

describe('OwnerSignInCard organization task', () => {
  it('explains an unavailable account setup without a misleading salon claim or another organization form', async () => {
    mocks.clerk.session = pendingOrganizationSession;
    mocks.resolveOrganization.mockRejectedValueOnce(new OnboardingIntegrationRequestError('Private provider detail', {
      code: 'ORGANIZATION_SETUP_UNAVAILABLE',
      status: 503,
    }));
    render(<OwnerSignInCard mode="sign-up" dashboardUrl="/en/ai-website" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Your account is saved.');
    expect(screen.getByRole('alert')).toHaveTextContent('Please contact Luster support.');
    expect(screen.queryByText('Save your Luster account')).not.toBeInTheDocument();
    expect(screen.queryByText(/salon is already waiting/)).not.toBeInTheDocument();
    expect(screen.queryByText('Private provider detail')).not.toBeInTheDocument();
    expect(mocks.clerk.setActive).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocks.clerk.setActive).toHaveBeenCalledWith({
      organization: 'org_1',
      redirectUrl: '/en/ai-website',
      session: 'sess_pending',
    }));

    expect(mocks.resolveOrganization).toHaveBeenCalledTimes(2);
  });

  it('resolves the choose-organization task without showing Clerk\'s form', async () => {
    mocks.clerk.session = pendingOrganizationSession;

    render(<OwnerSignInCard dashboardUrl="/en/admin" />);

    expect(screen.getByRole('status')).toHaveTextContent('Opening your Luster account…');
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

  it('sends the current pending session token to the organization resolver', async () => {
    mocks.clerk.session = pendingOrganizationSession;

    render(<OwnerSignInCard dashboardUrl="/en/admin" />);

    await waitFor(() => expect(mocks.resolveOrganization).toHaveBeenCalledOnce());

    expect(pendingOrganizationSession.getToken).toHaveBeenCalledWith({ skipCache: true });
    expect(mocks.resolveOrganization).toHaveBeenCalledWith('', {
      sessionToken: 'synthetic-session-token',
    });
  });

  it('does not dispatch a token after the pending session is replaced while reading it', async () => {
    let listener: ClerkResourceListener | null = null;
    const token = createDeferred<string | null>();
    const originalSession = {
      ...pendingOrganizationSession,
      getToken: vi.fn(() => token.promise),
    };
    mocks.clerk.addListener.mockImplementation((callback: ClerkResourceListener) => {
      listener = (resources) => {
        mocks.clerk.session = resources.session;
        callback(resources);
      };

      return () => undefined;
    });
    mocks.clerk.session = originalSession;

    render(<OwnerSignInCard dashboardUrl="/en/admin" />);
    await waitFor(() => expect(originalSession.getToken).toHaveBeenCalledOnce());

    const replacementSession = {
      currentTask: { key: 'choose-organization' },
      getToken: vi.fn().mockResolvedValue('replacement-session-token'),
      id: 'sess_replacement',
      status: 'pending',
    };
    await act(async () => {
      listener?.({ session: replacementSession });
    });
    await act(async () => {
      token.resolve('stale-session-token');
      await token.promise;
    });

    await waitFor(() => expect(mocks.resolveOrganization).toHaveBeenCalledWith('', {
      sessionToken: 'replacement-session-token',
    }));

    expect(mocks.resolveOrganization).not.toHaveBeenCalledWith('', {
      sessionToken: 'stale-session-token',
    });
    expect(mocks.clerk.setActive).not.toHaveBeenCalledWith(expect.objectContaining({
      session: 'sess_pending',
    }));
  });

  it('fails closed if the raw pending session disappears before dispatch', async () => {
    const token = createDeferred<string | null>();
    const session = {
      ...pendingOrganizationSession,
      getToken: vi.fn(() => token.promise),
    };
    mocks.clerk.session = session;

    render(<OwnerSignInCard dashboardUrl="/en/admin" />);
    await waitFor(() => expect(session.getToken).toHaveBeenCalledOnce());

    mocks.clerk.session = null;
    await act(async () => {
      token.resolve('stale-session-token');
      await token.promise;
    });

    expect(mocks.resolveOrganization).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We couldn’t finish signing you in. Try again.',
    );
  });

  it('starts at most one automatic resolver attempt under StrictMode effect replay', async () => {
    mocks.clerk.session = pendingOrganizationSession;

    render(
      <StrictMode>
        <OwnerSignInCard dashboardUrl="/en/admin" />
      </StrictMode>,
    );

    await waitFor(() => expect(mocks.clerk.setActive).toHaveBeenCalledOnce());

    expect(mocks.resolveOrganization).toHaveBeenCalledOnce();
  });

  it('does not activate an organization after the pending session changes during resolution', async () => {
    let listener: ClerkResourceListener | null = null;
    const resolution = createDeferred<{
      created: boolean;
      organizations: Array<{ id: string; name: string }>;
    }>();
    mocks.clerk.addListener.mockImplementation((callback: ClerkResourceListener) => {
      listener = callback;

      return () => undefined;
    });
    mocks.clerk.session = pendingOrganizationSession;
    mocks.resolveOrganization.mockReturnValueOnce(resolution.promise);

    render(<OwnerSignInCard dashboardUrl="/en/admin" />);
    await waitFor(() => expect(mocks.resolveOrganization).toHaveBeenCalledOnce());

    const replacementSession = {
      currentTask: { key: 'choose-organization' },
      getToken: vi.fn().mockResolvedValue('replacement-session-token'),
      id: 'sess_replacement',
      status: 'pending',
    };
    mocks.clerk.session = replacementSession;
    await act(async () => {
      listener?.({ session: replacementSession });
    });
    await act(async () => {
      resolution.resolve({
        created: true,
        organizations: [{ id: 'org_1', name: 'My nail studio' }],
      });
      await resolution.promise;
    });

    expect(mocks.clerk.setActive).not.toHaveBeenCalledWith(expect.objectContaining({
      session: 'sess_pending',
    }));
  });

  it('reacts to a session that turns pending after the password step', async () => {
    let listener: ClerkResourceListener | null = null;
    mocks.clerk.addListener.mockImplementation((callback: ClerkResourceListener) => {
      listener = (resources) => {
        mocks.clerk.session = resources.session;
        callback(resources);
      };

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

  it('offers a bounded retry message when organization resolution fails', async () => {
    mocks.clerk.session = pendingOrganizationSession;
    mocks.resolveOrganization.mockRejectedValueOnce(new Error('sensitive upstream detail'));

    render(<OwnerSignInCard dashboardUrl="/en/admin" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t finish signing you in. Try again.');
      expect(screen.getByRole('alert')).not.toHaveTextContent('sensitive upstream detail');
    });

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(mocks.clerk.setActive).toHaveBeenCalledOnce();
    });
  });

  it('does not resolve or activate a session after the AI entry unmounts while reading its token', async () => {
    const token = createDeferred<string | null>();
    const session = { ...pendingOrganizationSession, getToken: vi.fn(() => token.promise) };
    mocks.clerk.session = session;
    const view = render(<OwnerSignInCard mode="sign-up" dashboardUrl="/en/ai-website" signInUrl="/en/ai-website?account=sign-in" />);
    await waitFor(() => expect(session.getToken).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => {
      token.resolve('stale-session-token');
      await token.promise;
    });

    expect(mocks.resolveOrganization).not.toHaveBeenCalled();
    expect(mocks.clerk.setActive).not.toHaveBeenCalled();
  });

  it('keeps AI signup return links through a failed token and an explicit retry', async () => {
    const getToken = vi.fn().mockResolvedValueOnce(null).mockResolvedValue('retried-session-token');
    mocks.clerk.session = { ...pendingOrganizationSession, getToken };
    render(<OwnerSignInCard mode="sign-up" dashboardUrl="/en/ai-website" signInUrl="/en/ai-website?account=sign-in" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t finish signing you in. Try again.');
    expect(mocks.resolveOrganization).not.toHaveBeenCalled();
    expect(getToken).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocks.clerk.setActive).toHaveBeenCalledWith({ organization: 'org_1', session: 'sess_pending', redirectUrl: '/en/ai-website' }));

    expect(getToken).toHaveBeenCalledTimes(2);
    expect(mocks.resolveOrganization).toHaveBeenCalledOnce();
    expect(mocks.resolveOrganization).toHaveBeenCalledWith('', { sessionToken: 'retried-session-token' });
    expect(mocks.signUp).toHaveBeenLastCalledWith(expect.objectContaining({ forceRedirectUrl: '/en/ai-website', signInUrl: '/en/ai-website?account=sign-in' }));
  });
});
