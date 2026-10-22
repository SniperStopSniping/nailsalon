import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onTestFinished } from 'vitest';

import { initializeStarter } from '../../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { createDefaultOnboardingState } from '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import type { OnboardingAuthProviderAvailability } from '../auth-providers';
import { PremiumAccountGate } from './AccountGate';

const mocks = vi.hoisted(() => ({
  clerk: {
    addListener: vi.fn((_listener: (state: { session: unknown }) => void) => () => undefined),
    session: null as unknown,
    setActive: vi.fn(),
    signOut: vi.fn(),
  },
  getToken: vi.fn(),
  resolveOrganization: vi.fn(),
  setActiveSignIn: vi.fn(),
  setActiveSignUp: vi.fn(),
  signIn: {
    attemptFirstFactor: vi.fn(),
    authenticateWithRedirect: vi.fn(),
    create: vi.fn(),
    resetPassword: vi.fn(),
  },
  signUp: {
    attemptEmailAddressVerification: vi.fn(),
    create: vi.fn(),
    prepareEmailAddressVerification: vi.fn(),
  },
  userState: { isLoaded: true, user: null as unknown },
}));

vi.mock('@clerk/nextjs', () => ({
  AuthenticateWithRedirectCallback: () => null,
  useClerk: () => mocks.clerk,
  useSignIn: () => ({
    isLoaded: true,
    setActive: mocks.setActiveSignIn,
    signIn: mocks.signIn,
  }),
  useSignUp: () => ({
    isLoaded: true,
    setActive: mocks.setActiveSignUp,
    signUp: mocks.signUp,
  }),
  useUser: () => mocks.userState,
}));

vi.mock('../../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/integration/CustomDesignAssetProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    useCustomDesignAssetCoordinator: () => null,
    useCustomDesignAssetMap: () => new Map(),
    useCustomDesignAssetRepository: () => ({}),
  };
});

vi.mock('../client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client')>();

  return {
    ...actual,
    resolveOnboardingOrganization: (...args: unknown[]) => mocks.resolveOrganization(...args),
  };
});

const ALL_PROVIDERS: OnboardingAuthProviderAvailability = {
  apple: true,
  email: true,
  google: true,
  source: 'clerk-environment',
};

const buildDraft = () => {
  const state = createDefaultOnboardingState();
  state.profile.businessName = 'Isla Nail Studio';
  state.recipe.starter = 'one_page';
  state.recipe.starterDocumentSiteId = 'local-site';
  const document = initializeStarter('one_page', {
    siteId: 'local-site',
    siteName: state.profile.businessName,
  });

  return { document, state };
};

const renderGate = (overrides: {
  authMode?: 'sign-in' | 'sign-up';
  configureDraft?: (draft: ReturnType<typeof buildDraft>) => void;
  errorMessage?: string | null;
  needsSessionEmailVerification?: boolean;
  onSessionEmailVerified?: () => void;
  providers?: OnboardingAuthProviderAvailability;
} = {}) => {
  const draft = buildDraft();
  overrides.configureDraft?.(draft);

  return render(
    <PremiumAccountGate
      authMode={overrides.authMode ?? 'sign-up'}
      document={draft.document}
      errorMessage={overrides.errorMessage ?? null}
      locale="en"
      needsSessionEmailVerification={overrides.needsSessionEmailVerification ?? false}
      onCancel={() => undefined}
      onSessionEmailVerified={overrides.onSessionEmailVerified}
      providers={overrides.providers ?? ALL_PROVIDERS}
      state={draft.state}
    />,
  );
};

describe('PremiumAccountGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getToken.mockReset().mockResolvedValue('synthetic-session-token');
    window.history.replaceState({}, '', '/en/onboarding-v1?account=1');
    mocks.clerk.session = null;
    mocks.userState.user = null;
    mocks.clerk.addListener.mockReturnValue(() => undefined);
  });

  it('opens Screen 6 at the document top before focusing its reward heading', () => {
    document.documentElement.scrollTop = 325;
    document.body.scrollTop = 325;

    renderGate();

    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
    expect(screen.getByRole('heading', {
      level: 1,
      name: /Your site is coming together/u,
    })).toHaveFocus();
  });

  it('fits the scrollable reward to its visible host using the shared width-scaled viewport', () => {
    renderGate();

    const preview = screen.getByRole('region', { name: 'Preview of Isla Nail Studio' });

    expect(preview).toHaveClass('is-fit-available');
    expect(preview).toHaveAttribute('data-preview-interaction', 'scrollable');
  });

  it('renders exact provider labels for the configured set and hides the rest entirely', () => {
    renderGate({ providers: { apple: false, email: true, google: true, source: 'clerk-environment' } });

    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue with email' })).toBeVisible();
    expect(screen.queryByText(/Apple/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sign up with/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/facebook/iu)).not.toBeInTheDocument();
  });

  it('does not reintroduce optional sections that onboarding turned off', () => {
    const excludedIds: string[] = [];
    renderGate({
      configureDraft: ({ document, state }) => {
        state.recipe.aboutEnabled = false;
        state.recipe.galleryEnabled = false;
        state.recipe.policiesEnabled = false;
        excludedIds.push(...document.pages.flatMap(page => page.sections)
          .filter(section => [
            'about',
            'deposits_cancellations',
            'gallery',
            'policies',
          ].includes(section.sectionType))
          .map(section => section.id));
      },
    });

    const preview = document.querySelector<HTMLElement>(
      '[aria-label="Preview of Isla Nail Studio"]',
    );

    expect(preview).not.toBeNull();

    if (!preview) {
      throw new Error('Account Gate preview was not rendered.');
    }
    for (const sectionId of excludedIds) {
      expect(preview.querySelector(`[data-section-id="${sectionId}"]`))
        .not.toBeInTheDocument();
    }
  });

  it('still looks intentional when email is the only method', () => {
    renderGate({ providers: { apple: false, email: true, google: false, source: 'fallback' } });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your site is coming together');
    expect(screen.getAllByRole('button', { name: /^Continue with/u })).toHaveLength(1);
  });

  it('switches to the existing-account journey from the Log in action', async () => {
    const user = userEvent.setup();
    renderGate();

    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Log in to keep building.',
    })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue with email' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create your free account' })).toBeVisible();
    // OP-002: the card kept sign-up wording in log-in mode, telling a
    // returning owner to create the account they already have.
    expect(screen.getByRole('heading', {
      level: 2,
      name: 'Log in to your Luster account',
    })).toBeVisible();
    expect(screen.queryByRole('heading', {
      level: 2,
      name: 'Create your free account',
    })).not.toBeInTheDocument();
    expect(screen.queryByText('No payment required. You can change everything later.')).not.toBeInTheDocument();
    expect(screen.queryByText('Free to create · No payment required')).not.toBeInTheDocument();
    expect(screen.getByText('Secure log in · Nothing you built is changed')).toBeVisible();
  });

  it('keeps the sign-up wording in sign-up mode', () => {
    renderGate();

    expect(screen.getByRole('heading', {
      level: 2,
      name: 'Create your free account',
    })).toBeVisible();
    expect(screen.getByText('Free to create · No payment required')).toBeVisible();
  });

  it('routes a known email to the existing-user password step', async () => {
    const user = userEvent.setup();
    mocks.signIn.create.mockResolvedValueOnce({ status: 'needs_first_factor' });
    renderGate();

    await user.click(screen.getByRole('button', { name: 'Continue with email' }));
    await user.type(screen.getByLabelText('Email address'), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Enter your password',
    })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Log in and save my site' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeVisible();
  });

  it('routes an unknown email to account creation and verifies before finishing', async () => {
    const user = userEvent.setup();
    mocks.signIn.create.mockRejectedValueOnce({
      errors: [{ code: 'form_identifier_not_found' }],
    });
    mocks.signUp.create.mockResolvedValue({ status: 'missing_requirements' });
    mocks.signUp.prepareEmailAddressVerification.mockResolvedValue({});
    mocks.signUp.attemptEmailAddressVerification.mockResolvedValue({
      createdSessionId: 'sess_new',
      status: 'complete',
    });
    renderGate();

    await user.click(screen.getByRole('button', { name: 'Continue with email' }));
    await user.type(screen.getByLabelText('Email address'), 'new-owner@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Create your password',
    })).toBeVisible();

    await user.type(screen.getByLabelText('Password'), 'a-strong-password');
    await user.click(screen.getByRole('button', { name: 'Create account and continue' }));

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Check your email',
    })).toBeVisible();
    expect(mocks.signUp.prepareEmailAddressVerification)
      .toHaveBeenCalledWith({ strategy: 'email_code' });
    expect(screen.getByText(/new-owner@example.com/u)).toBeVisible();

    await user.type(screen.getByLabelText('Verification code'), '424242');
    await user.click(screen.getByRole('button', { name: 'Verify and save my site' }));

    await waitFor(() => {
      expect(mocks.setActiveSignUp).toHaveBeenCalledWith({ session: 'sess_new', navigate: expect.any(Function) });
    });
  });

  it('activates an immediately-complete sign-up so the session verification step can gate the claim', async () => {
    const user = userEvent.setup();
    mocks.signIn.create.mockRejectedValueOnce({
      errors: [{ code: 'form_identifier_not_found' }],
    });
    mocks.signUp.create.mockResolvedValue({
      createdSessionId: 'sess_immediate',
      status: 'complete',
    });
    renderGate();

    await user.click(screen.getByRole('button', { name: 'Continue with email' }));
    await user.type(screen.getByLabelText('Email address'), 'new-owner@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByLabelText('Password'), 'a-strong-password');
    await user.click(screen.getByRole('button', { name: 'Create account and continue' }));

    await waitFor(() => {
      expect(mocks.setActiveSignUp).toHaveBeenCalledWith({ session: 'sess_immediate', navigate: expect.any(Function) });
    });

    expect(mocks.signUp.prepareEmailAddressVerification).not.toHaveBeenCalled();
  });

  it('maps a wrong verification code to owner copy instead of a raw Clerk error', async () => {
    const user = userEvent.setup();
    mocks.signIn.create.mockRejectedValueOnce({
      errors: [{ code: 'form_identifier_not_found' }],
    });
    mocks.signUp.create.mockResolvedValue({ status: 'missing_requirements' });
    mocks.signUp.prepareEmailAddressVerification.mockResolvedValue({});
    mocks.signUp.attemptEmailAddressVerification.mockRejectedValue({
      errors: [{ code: 'form_code_incorrect', longMessage: 'Incorrect code' }],
    });
    renderGate();

    await user.click(screen.getByRole('button', { name: 'Continue with email' }));
    await user.type(screen.getByLabelText('Email address'), 'new-owner@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByLabelText('Password'), 'a-strong-password');
    await user.click(screen.getByRole('button', { name: 'Create account and continue' }));
    await user.type(await screen.findByLabelText('Verification code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify and save my site' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code doesn’t match. Check the newest email and try again.',
    );
    expect(screen.getByRole('button', { name: /Send a new code/u })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Use a different email' })).toBeVisible();
  });

  it('starts OAuth with a same-route return and claim completion URL', async () => {
    const user = userEvent.setup();
    mocks.signIn.authenticateWithRedirect.mockResolvedValue(undefined);
    renderGate();

    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(mocks.signIn.authenticateWithRedirect).toHaveBeenCalledWith({
      redirectUrl: '/en/onboarding-v1?sso=1',
      redirectUrlComplete: '/en/onboarding-v1?claim=1',
      strategy: 'oauth_google',
    });
    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Continuing with Google…',
    })).toBeVisible();
  });

  it('resolves a pending choose-organization task without a generic Clerk screen', async () => {
    mocks.clerk.session = {
      currentTask: { key: 'choose-organization' },
      id: 'sess_pending',
      getToken: mocks.getToken,
      status: 'pending',
    };
    mocks.resolveOrganization.mockResolvedValue({
      created: true,
      organizations: [{ id: 'org_1', name: 'Isla Nail Studio' }],
    });
    renderGate();

    await waitFor(() => {
      expect(mocks.clerk.setActive).toHaveBeenCalledWith({
        organization: 'org_1',
        session: 'sess_pending',
        navigate: expect.any(Function),
      });
    });

    expect(mocks.getToken).toHaveBeenCalledWith({ skipCache: true });
    expect(mocks.resolveOrganization).toHaveBeenCalledWith('Isla Nail Studio', { sessionToken: 'synthetic-session-token' });
    expect(screen.queryByText(/organization/iu)).not.toBeInTheDocument();
  });

  it('does not dispatch organization setup when the pending token is unavailable', async () => {
    mocks.clerk.session = { id: 'sess_pending', currentTask: { key: 'choose-organization' }, status: 'pending', getToken: mocks.getToken };
    mocks.getToken.mockResolvedValueOnce(null);
    renderGate();

    expect(await screen.findByRole('button', { name: 'Sign in again' })).toBeVisible();
    expect(mocks.resolveOrganization).not.toHaveBeenCalled();
  });

  it('does not dispatch a token after its pending session is replaced', async () => {
    let finishToken!: (token: string) => void;
    mocks.clerk.session = { id: 'sess_old', currentTask: { key: 'choose-organization' }, status: 'pending', getToken: mocks.getToken };
    mocks.getToken.mockImplementationOnce(() => new Promise((resolve) => {
      finishToken = resolve;
    }));
    renderGate();
    await waitFor(() => expect(mocks.getToken).toHaveBeenCalledTimes(1));
    mocks.clerk.session = { id: 'sess_other', currentTask: { key: 'choose-organization' }, status: 'pending', getToken: mocks.getToken };
    await act(async () => {
      finishToken('stale-session-token');
    });

    expect(mocks.resolveOrganization).not.toHaveBeenCalled();
    expect(mocks.clerk.setActive).not.toHaveBeenCalled();
  });

  it('keeps token transport failure bounded and allows an explicit retry', async () => {
    mocks.clerk.session = { id: 'sess_pending', currentTask: { key: 'choose-organization' }, status: 'pending', getToken: mocks.getToken };
    mocks.getToken.mockRejectedValueOnce(new Error('network interrupted'));
    renderGate();

    expect(await screen.findByRole('button', { name: 'Retry business setup' })).toBeVisible();
    expect(mocks.getToken).toHaveBeenCalledTimes(1);
    expect(mocks.resolveOrganization).not.toHaveBeenCalled();
  });

  it('offers a business choice when the account already has several', async () => {
    const user = userEvent.setup();
    mocks.clerk.session = {
      currentTask: { key: 'choose-organization' },
      id: 'sess_pending',
      getToken: mocks.getToken,
      status: 'pending',
    };
    mocks.resolveOrganization.mockResolvedValue({
      created: false,
      organizations: [
        { id: 'org_a', name: 'Studio A' },
        { id: 'org_b', name: 'Studio B' },
      ],
    });
    renderGate();

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Choose your business',
    })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Studio B' }));

    await waitFor(() => {
      expect(mocks.clerk.setActive).toHaveBeenCalledWith({
        organization: 'org_b',
        session: 'sess_pending',
        navigate: expect.any(Function),
      });
    });
  });

  it('does not activate a stale business choice after the pending session changes', async () => {
    const refreshes: Array<(state: { session: unknown }) => void> = [];
    mocks.clerk.addListener.mockImplementation((listener) => {
      refreshes.push((state) => {
        mocks.clerk.session = state.session;
        (listener as (state: { session: unknown }) => void)(state);
      });
      return () => undefined;
    });
    mocks.clerk.session = { currentTask: { key: 'choose-organization' }, id: 'sess_old', getToken: mocks.getToken, status: 'pending' };
    mocks.resolveOrganization.mockResolvedValueOnce({
      created: false,
      organizations: [{ id: 'org_a', name: 'Old Studio A' }, { id: 'org_b', name: 'Old Studio B' }],
    }).mockImplementationOnce(() => new Promise(() => undefined));
    renderGate();
    const oldChoice = await screen.findByRole('button', { name: 'Old Studio B' });
    act(() => {
      refreshes[0]!({ session: { currentTask: { key: 'choose-organization' }, id: 'sess_new', getToken: mocks.getToken, status: 'pending' } });
      fireEvent.click(oldChoice);
    });

    expect(mocks.clerk.setActive).not.toHaveBeenCalled();
  });

  it('does not repeat a failed setup request when Clerk refreshes the same pending task', async () => {
    const refreshes: Array<(state: { session: unknown }) => void> = [];
    mocks.clerk.addListener.mockImplementation((listener) => {
      refreshes.push((state) => {
        mocks.clerk.session = state.session;
        (listener as (state: { session: unknown }) => void)(state);
      });
      return () => undefined;
    });
    mocks.clerk.session = {
      currentTask: { key: 'choose-organization' },
      id: 'sess_pending',
      getToken: mocks.getToken,
      status: 'pending',
    };
    mocks.resolveOrganization.mockRejectedValue(new Error('temporary network failure'));
    renderGate();

    expect(await screen.findByRole('button', { name: 'Retry business setup' })).toBeVisible();

    await act(async () => {
      refreshes[0]?.({ session: { currentTask: { key: 'choose-organization' }, id: 'sess_pending', getToken: mocks.getToken, status: 'pending' } });
    });

    expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1);
  });

  it('allows one explicit retry after a transient setup failure', async () => {
    const user = userEvent.setup();
    mocks.clerk.session = {
      currentTask: { key: 'choose-organization' },
      id: 'sess_pending',
      getToken: mocks.getToken,
      status: 'pending',
    };
    mocks.resolveOrganization
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({ created: true, organizations: [{ id: 'org_1', name: 'Isla Nail Studio' }] });
    renderGate();

    await user.click(await screen.findByRole('button', { name: 'Retry business setup' }));

    await waitFor(() => {
      expect(mocks.clerk.setActive).toHaveBeenCalledWith({
        organization: 'org_1',
        session: 'sess_pending',
        navigate: expect.any(Function),
      });
    });

    expect(mocks.resolveOrganization).toHaveBeenCalledTimes(2);
  });

  it('shows support guidance for unavailable organization setup without offering retry or claiming', async () => {
    mocks.clerk.session = {
      currentTask: { key: 'choose-organization' },
      id: 'sess_pending',
      getToken: mocks.getToken,
      status: 'pending',
    };
    const unavailable = Object.assign(new Error('safe server message'), {
      code: 'ORGANIZATION_SETUP_UNAVAILABLE',
      status: 503,
    });
    mocks.resolveOrganization.mockRejectedValue(unavailable);
    renderGate();

    expect(await screen.findByText(
      'We couldn’t finish setting up your business right now. Your work is still safe on this device. Please contact Luster support.',
    )).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry business setup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create your account|Continue with/u })).not.toBeInTheDocument();
    expect(mocks.clerk.setActive).not.toHaveBeenCalled();
    expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1);
  });

  it('offers a session-scoped sign-in-again action when organization activation fails', async () => {
    const user = userEvent.setup();
    mocks.clerk.session = {
      currentTask: { key: 'choose-organization' },
      id: 'sess_pending',
      getToken: mocks.getToken,
      status: 'pending',
    };
    mocks.resolveOrganization.mockResolvedValue({
      created: true,
      organizations: [{ id: 'org_1', name: 'Isla Nail Studio' }],
    });
    mocks.clerk.setActive.mockRejectedValueOnce(new Error('session expired'));
    renderGate();

    expect(await screen.findByRole('heading', { level: 1, name: 'Business setup needs attention' })).toBeVisible();
    expect(screen.getByText('We couldn’t activate your business. Sign in again to continue.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry business setup' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    await waitFor(() => {
      expect(mocks.clerk.signOut).toHaveBeenCalledWith({ sessionId: 'sess_pending', redirectUrl: '/en/onboarding-v1?claim=1' });
    });

    expect(screen.getByRole('button', { name: 'Continue with email' })).toBeVisible();
  });

  it('ignores setup completion after the pending session changes', async () => {
    const refreshes: Array<(state: { session: unknown }) => void> = [];
    mocks.clerk.addListener.mockImplementation((listener) => {
      refreshes.push((state) => {
        mocks.clerk.session = state.session;
        (listener as (state: { session: unknown }) => void)(state);
      });
      return () => undefined;
    });
    let finishFirst!: (value: { created: boolean; organizations: { id: string; name: string }[] }) => void;
    mocks.clerk.session = {
      currentTask: { key: 'choose-organization' },
      id: 'sess_old',
      getToken: mocks.getToken,
      status: 'pending',
    };
    mocks.resolveOrganization.mockImplementationOnce(() => new Promise((resolve) => {
      finishFirst = resolve;
    }));
    const view = renderGate();

    await waitFor(() => expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1));
    await act(async () => {
      refreshes[0]?.({ session: { currentTask: { key: 'choose-organization' }, id: 'sess_new', getToken: mocks.getToken, status: 'pending' } });
    });
    await waitFor(() => expect(mocks.resolveOrganization).toHaveBeenCalledTimes(2));
    await act(async () => {
      finishFirst({ created: true, organizations: [{ id: 'org_old', name: 'Old Business' }] });
    });

    expect(mocks.clerk.setActive).not.toHaveBeenCalledWith(expect.objectContaining({ organization: 'org_old', session: 'sess_old' }));
    expect(view.container).not.toHaveTextContent('Old Business');
  });

  it('ignores setup completion after the account gate unmounts', async () => {
    let finishResolution!: (value: { created: boolean; organizations: { id: string; name: string }[] }) => void;
    mocks.clerk.session = {
      currentTask: { key: 'choose-organization' },
      id: 'sess_pending',
      getToken: mocks.getToken,
      status: 'pending',
    };
    mocks.resolveOrganization.mockImplementationOnce(() => new Promise((resolve) => {
      finishResolution = resolve;
    }));
    const view = renderGate();

    await waitFor(() => expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {
      finishResolution({ created: true, organizations: [{ id: 'org_1', name: 'Isla Nail Studio' }] });
    });

    expect(mocks.clerk.setActive).not.toHaveBeenCalled();
  });

  it('returns to sign-in after a pending session ends and retries automatically for a new pending session', async () => {
    const refreshes: Array<(state: { session: unknown }) => void> = [];
    mocks.clerk.addListener.mockImplementation((listener) => {
      refreshes.push((state) => {
        mocks.clerk.session = state.session;
        (listener as (state: { session: unknown }) => void)(state);
      });
      return () => undefined;
    });
    mocks.clerk.session = {
      currentTask: { key: 'choose-organization' },
      id: 'sess_ended',
      getToken: mocks.getToken,
      status: 'pending',
    };
    mocks.resolveOrganization
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({ created: true, organizations: [{ id: 'org_new', name: 'Isla Nail Studio' }] });
    renderGate();

    expect(await screen.findByRole('button', { name: 'Retry business setup' })).toBeVisible();

    await act(async () => {
      refreshes[0]?.({ session: null });
    });

    expect(await screen.findByRole('button', { name: 'Continue with email' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Your sign-in session ended. Sign in again to continue.');

    await act(async () => {
      refreshes[0]?.({ session: {
        currentTask: { key: 'choose-organization' },
        id: 'sess_new',
        getToken: mocks.getToken,
        status: 'pending',
      } });
    });

    await waitFor(() => {
      expect(mocks.resolveOrganization).toHaveBeenCalledTimes(2);
      expect(mocks.clerk.setActive).toHaveBeenCalledWith({ organization: 'org_new', session: 'sess_new', navigate: expect.any(Function) });
    });
  });

  it('does not expose sign-in recovery when a pending session becomes active', async () => {
    const refreshes: Array<(state: { session: unknown }) => void> = [];
    mocks.clerk.addListener.mockImplementation((listener) => {
      refreshes.push((state) => {
        mocks.clerk.session = state.session;
        (listener as (state: { session: unknown }) => void)(state);
      });
      return () => undefined;
    });
    mocks.clerk.session = {
      currentTask: { key: 'choose-organization' },
      id: 'sess_pending',
      getToken: mocks.getToken,
      status: 'pending',
    };
    mocks.resolveOrganization.mockReturnValue(new Promise(() => undefined));
    renderGate();

    await waitFor(() => expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1));
    await act(async () => {
      refreshes[0]?.({ session: { id: 'sess_pending', status: 'active' } });
    });

    expect(screen.getByRole('heading', { level: 1, name: 'Setting up your account…' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue with email' })).not.toBeInTheDocument();
    expect(screen.queryByText('Your sign-in session ended. Sign in again to continue.')).not.toBeInTheDocument();
  });

  it('keeps a transient setup retry to one in-flight request after rapid duplicate clicks', async () => {
    mocks.clerk.session = {
      currentTask: { key: 'choose-organization' },
      id: 'sess_pending',
      getToken: mocks.getToken,
      status: 'pending',
    };
    let finishRetry!: (value: { created: boolean; organizations: { id: string; name: string }[] }) => void;
    mocks.resolveOrganization
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockImplementationOnce(() => new Promise((resolve) => {
        finishRetry = resolve;
      }));
    renderGate();

    const retryButton = await screen.findByRole('button', { name: 'Retry business setup' });
    await act(async () => {
      retryButton.click();
      retryButton.click();
    });

    await waitFor(() => expect(mocks.resolveOrganization).toHaveBeenCalledTimes(2));

    expect(screen.getByRole('heading', { level: 1, name: 'Setting up your account…' })).toBeVisible();

    await act(async () => {
      finishRetry({ created: false, organizations: [] });
    });
  });

  it('offers session-scoped sign-in recovery for an expired setup request without retry', async () => {
    const user = userEvent.setup();
    mocks.clerk.session = {
      currentTask: { key: 'choose-organization' },
      id: 'sess_pending',
      getToken: mocks.getToken,
      status: 'pending',
    };
    const unauthenticated = Object.assign(new Error('unauthorized'), {
      code: 'UNAUTHENTICATED',
      status: 401,
    });
    mocks.resolveOrganization.mockRejectedValue(unauthenticated);
    renderGate();

    expect(await screen.findByText('We couldn’t activate your business. Sign in again to continue.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry business setup' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(mocks.clerk.signOut).toHaveBeenCalledWith({ sessionId: 'sess_pending', redirectUrl: '/en/onboarding-v1?claim=1' });
  });

  it('verifies a signed-in owner’s email in place before any claim', async () => {
    const prepareVerification = vi.fn().mockResolvedValue({});
    const attemptVerification = vi.fn().mockResolvedValue({ verification: { status: 'verified' } });
    const onSessionEmailVerified = vi.fn();
    mocks.userState.user = {
      primaryEmailAddress: {
        attemptVerification,
        emailAddress: 'owner@example.com',
        prepareVerification,
        verification: { status: 'unverified' },
      },
      reload: vi.fn().mockResolvedValue(undefined),
    };
    const user = userEvent.setup();
    renderGate({ needsSessionEmailVerification: true, onSessionEmailVerified });

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Check your email',
    })).toBeVisible();
    expect(prepareVerification).toHaveBeenCalledWith({ strategy: 'email_code' });

    await user.type(screen.getByLabelText('Verification code'), '424242');
    await user.click(screen.getByRole('button', { name: 'Verify and save my site' }));

    await waitFor(() => {
      expect(attemptVerification).toHaveBeenCalledWith({ code: '424242' });
      expect(onSessionEmailVerified).toHaveBeenCalledTimes(1);
    });
  });

  it('does not unlock a claim when the email verification response is still unverified', async () => {
    const onSessionEmailVerified = vi.fn();
    const reload = vi.fn();
    mocks.userState.user = {
      primaryEmailAddress: {
        attemptVerification: vi.fn().mockResolvedValue({ verification: { status: 'unverified' } }),
        emailAddress: 'owner@example.com',
        prepareVerification: vi.fn().mockResolvedValue({}),
        verification: { status: 'unverified' },
      },
      reload,
    };
    const user = userEvent.setup();
    renderGate({ needsSessionEmailVerification: true, onSessionEmailVerified });

    await user.type(screen.getByLabelText('Verification code'), '424242');
    await user.click(screen.getByRole('button', { name: 'Verify and save my site' }));

    expect(await screen.findByText('That code didn’t finish verification. Send a new code and try again.')).toBeVisible();
    expect(onSessionEmailVerified).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps session verification retryable when refreshing a successfully verified user fails', async () => {
    const onSessionEmailVerified = vi.fn();
    const reload = vi.fn()
      .mockRejectedValueOnce(new Error('The connection was interrupted.'))
      .mockResolvedValueOnce(undefined);
    mocks.userState.user = {
      primaryEmailAddress: {
        attemptVerification: vi.fn().mockResolvedValue({ verification: { status: 'verified' } }),
        emailAddress: 'owner@example.com',
        prepareVerification: vi.fn().mockResolvedValue({}),
        verification: { status: 'verified' },
      },
      reload,
    };
    const user = userEvent.setup();
    renderGate({ needsSessionEmailVerification: true, onSessionEmailVerified });

    await user.type(screen.getByLabelText('Verification code'), '424242');
    await user.click(screen.getByRole('button', { name: 'Verify and save my site' }));

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Verify and save my site' })).toBeEnabled();
    expect(onSessionEmailVerified).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Verify and save my site' }));

    await waitFor(() => expect(onSessionEmailVerified).toHaveBeenCalledTimes(1));

    expect(reload).toHaveBeenCalledTimes(2);
  });

  describe('completed-session navigation', () => {
    type Session = { id: string; status: string; currentTask?: { key: string } | null };
    type Navigate = (input: { session: Session; decorateUrl?: (url: string) => string }) => void;
    const active: Session = { id: 'sess_handoff', status: 'active', currentTask: null };
    let assign: ReturnType<typeof vi.fn>;
    let emit: (session: unknown) => void;

    beforeEach(() => {
      const originalLocation = window.location;
      assign = vi.fn();
      Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign } });
      onTestFinished(() => {
        Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
      });
      mocks.setActiveSignUp.mockReset().mockResolvedValue(undefined);
      mocks.clerk.setActive.mockReset().mockResolvedValue(undefined);
      mocks.clerk.addListener.mockImplementation((listener) => {
        emit = (session) => {
          mocks.clerk.session = session;
          listener({ session });
        };
        return () => undefined;
      });
    });

    async function completedSignup() {
      const user = userEvent.setup();
      mocks.signIn.create.mockRejectedValueOnce({ errors: [{ code: 'form_identifier_not_found' }] });
      mocks.signUp.create.mockResolvedValueOnce({ createdSessionId: active.id, status: 'complete' });
      const view = renderGate();
      await user.click(screen.getByRole('button', { name: 'Continue with email' }));
      await user.type(screen.getByLabelText('Email address'), 'handoff+clerk_test@example.com');
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await user.type(await screen.findByLabelText('Password'), 'synthetic-handoff-password');
      await user.click(screen.getByRole('button', { name: 'Create account and continue' }));
      await waitFor(() => expect(mocks.setActiveSignUp).toHaveBeenCalledTimes(1));
      return { view, navigate: mocks.setActiveSignUp.mock.calls[0]![0].navigate as Navigate };
    }

    it('navigates once only for its completed session and uses the decorated claim route', async () => {
      const { navigate } = await completedSignup();
      const decorateUrl = vi.fn((url: string) => `${url}&handoff=synthetic`);
      for (const session of [
        { ...active, id: 'sess_other' },
        { ...active, status: 'pending' },
        { ...active, currentTask: { key: 'choose-organization' } },
      ]) {
        navigate({ session, decorateUrl });
      }

      expect(assign).not.toHaveBeenCalled();

      navigate({ session: active, decorateUrl });
      navigate({ session: active, decorateUrl });

      expect(decorateUrl).toHaveBeenCalledExactlyOnceWith('/en/onboarding-v1?claim=1');
      expect(assign).toHaveBeenCalledExactlyOnceWith('/en/onboarding-v1?claim=1&handoff=synthetic');
    });

    it('supports the Core 2 completed-session callback without a URL decorator', async () => {
      const { navigate } = await completedSignup();
      navigate({ session: active });

      expect(assign).toHaveBeenCalledExactlyOnceWith('/en/onboarding-v1?claim=1');
    });

    it.each(['token', 'lookup'])('preserves an in-flight organization task across undefined during %s', async (phase) => {
      let resolve!: (value: never) => void;
      const deferred = new Promise<never>((done) => {
        resolve = done;
      });
      const pending = { ...active, status: 'pending', currentTask: { key: 'choose-organization' }, getToken: mocks.getToken };
      const resolution = { created: false, organizations: [{ id: 'org_handoff', name: 'Handoff Studio' }] };
      mocks.clerk.session = pending;
      if (phase === 'token') {
        mocks.getToken.mockReturnValueOnce(deferred);
      }
      mocks.resolveOrganization.mockReset().mockResolvedValue(resolution);
      if (phase === 'lookup') {
        mocks.resolveOrganization.mockReturnValueOnce(deferred);
      }
      renderGate();
      await waitFor(() => expect(phase === 'token' ? mocks.getToken : mocks.resolveOrganization).toHaveBeenCalledTimes(1));
      act(() => {
        emit(undefined);
        emit(pending);
      });
      await act(async () => {
        resolve((phase === 'token' ? 'synthetic-token' : resolution) as never);
      });
      await waitFor(() => expect(mocks.clerk.setActive).toHaveBeenCalledTimes(1));

      expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1);
    });

    it('retries only once on a subsequent same-task event after lookup completes while undefined', async () => {
      let resolve!: (value: unknown) => void;
      const deferred = new Promise((done) => {
        resolve = done;
      });
      const pending = { ...active, status: 'pending', currentTask: { key: 'choose-organization' }, getToken: mocks.getToken };
      const resolution = { created: false, organizations: [{ id: 'org_handoff', name: 'Handoff Studio' }] };
      mocks.clerk.session = pending;
      mocks.resolveOrganization.mockReturnValueOnce(deferred).mockImplementationOnce(async () => {
        emit(undefined);
        return resolution;
      });
      renderGate();
      await waitFor(() => expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1));
      act(() => emit(undefined));
      await act(async () => {
        resolve(resolution);
      });

      expect(mocks.clerk.setActive).not.toHaveBeenCalled();

      act(() => emit(pending));
      await waitFor(() => expect(mocks.resolveOrganization).toHaveBeenCalledTimes(2));
      act(() => emit(pending));
      await act(async () => {});

      expect(mocks.resolveOrganization).toHaveBeenCalledTimes(2);
      expect(mocks.clerk.setActive).not.toHaveBeenCalled();
      expect(assign).not.toHaveBeenCalled();

      const retry = await screen.findByRole('button', { name: 'Retry business setup' });
      mocks.resolveOrganization.mockResolvedValueOnce(resolution);
      await userEvent.setup().click(retry);
      await waitFor(() => expect(mocks.clerk.setActive).toHaveBeenCalledTimes(1));

      expect(mocks.resolveOrganization).toHaveBeenCalledTimes(3);

      const navigate = mocks.clerk.setActive.mock.calls[0]![0].navigate as Navigate;
      navigate({ session: active, decorateUrl: url => url });

      expect(assign).toHaveBeenCalledExactlyOnceWith('/en/onboarding-v1?claim=1');
    });

    it.each([null, { ...active, status: 'revoked' }, { ...active, id: 'sess_replacement' }])(
      'does not recover a transient lookup after explicit session invalidation: %j',
      async (invalid) => {
        let resolve!: (value: unknown) => void;
        const deferred = new Promise((done) => {
          resolve = done;
        });
        const pending = { ...active, status: 'pending', currentTask: { key: 'choose-organization' }, getToken: mocks.getToken };
        mocks.clerk.session = pending;
        mocks.resolveOrganization.mockReturnValueOnce(deferred);
        renderGate();
        await waitFor(() => expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1));
        act(() => emit(undefined));
        await act(async () => {
          resolve({ created: false, organizations: [{ id: 'org_handoff', name: 'Handoff Studio' }] });
        });
        act(() => {
          emit(invalid);
          emit(pending);
        });
        await act(async () => {});

        expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1);
        expect(mocks.clerk.setActive).not.toHaveBeenCalled();
      },
    );

    it('shares one navigation between organization activation and a later signup callback', async () => {
      const { navigate: signupNavigate } = await completedSignup();
      mocks.resolveOrganization.mockResolvedValueOnce({ created: true, organizations: [{ id: 'org_handoff', name: 'Handoff Studio' }] });
      act(() => emit({ ...active, status: 'pending', currentTask: { key: 'choose-organization' }, getToken: mocks.getToken }));
      await waitFor(() => expect(mocks.clerk.setActive).toHaveBeenCalledTimes(1));
      const orgNavigate = mocks.clerk.setActive.mock.calls[0]![0].navigate as Navigate;
      const decorateUrl = vi.fn((url: string) => url);
      // SDK navigation can emit undefined before calling navigate, while the
      // previous raw session is still pending. Neither is a sign-out.
      act(() => emit(undefined));

      expect(screen.queryByText('Your sign-in session ended. Sign in again to continue.')).not.toBeInTheDocument();

      orgNavigate({ session: active, decorateUrl });
      signupNavigate({ session: active, decorateUrl });

      expect(assign).toHaveBeenCalledExactlyOnceWith('/en/onboarding-v1?claim=1');
    });

    it.each([
      null,
      { ...active, status: 'ended' },
      { ...active, status: 'revoked' },
      { ...active, id: 'sess_replacement' },
    ])('ignores delayed completion after an ended or replaced session: %j', async (session) => {
      const { navigate } = await completedSignup();
      act(() => emit(session));
      navigate({ session: active, decorateUrl: url => url });

      expect(assign).not.toHaveBeenCalled();
    });

    it('ignores a stale callback when raw session changes before a listener is delivered', async () => {
      const { navigate } = await completedSignup();
      mocks.clerk.session = { id: 'sess_replacement', status: 'active' };
      navigate({ session: active, decorateUrl: url => url });

      expect(assign).not.toHaveBeenCalled();
    });

    it('ignores completion after unmount', async () => {
      const { view, navigate } = await completedSignup();
      view.unmount();
      navigate({ session: active, decorateUrl: url => url });

      expect(assign).not.toHaveBeenCalled();
    });

    it('navigates from an existing pending organization only after that session becomes active', async () => {
      mocks.clerk.session = { ...active, status: 'pending', currentTask: { key: 'choose-organization' }, getToken: mocks.getToken };
      mocks.resolveOrganization.mockResolvedValueOnce({ created: false, organizations: [{ id: 'org_handoff', name: 'Handoff Studio' }] });
      renderGate();
      await waitFor(() => expect(mocks.clerk.setActive).toHaveBeenCalledTimes(1));
      const navigate = mocks.clerk.setActive.mock.calls[0]![0].navigate as Navigate;
      navigate({ session: { ...active, status: 'pending' }, decorateUrl: url => url });

      expect(assign).not.toHaveBeenCalled();

      act(() => emit(active));
      navigate({ session: active, decorateUrl: url => url });

      expect(assign).toHaveBeenCalledExactlyOnceWith('/en/onboarding-v1?claim=1');
    });

    it.each(['complete', 'missing_requirements'])('allows pre-session null emissions during signup and verification (%s)', async (status) => {
      const user = userEvent.setup();
      mocks.signIn.create.mockRejectedValueOnce({ errors: [{ code: 'form_identifier_not_found' }] });
      mocks.signUp.create.mockImplementationOnce(async () => {
        emit(null);
        return { createdSessionId: status === 'complete' ? active.id : null, status };
      });
      mocks.signUp.prepareEmailAddressVerification.mockResolvedValueOnce({});
      mocks.signUp.attemptEmailAddressVerification.mockImplementationOnce(async () => {
        emit(null);
        return { createdSessionId: active.id, status: 'complete' };
      });
      renderGate();
      await user.click(screen.getByRole('button', { name: 'Continue with email' }));
      await user.type(screen.getByLabelText('Email address'), 'handoff+clerk_test@example.com');
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await user.type(await screen.findByLabelText('Password'), 'synthetic-handoff-password');
      await user.click(screen.getByRole('button', { name: 'Create account and continue' }));
      if (status === 'missing_requirements') {
        expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeVisible();

        await user.type(screen.getByLabelText('Verification code'), '424242');
        await user.click(screen.getByRole('button', { name: 'Verify and save my site' }));
      }
      await waitFor(() => expect(mocks.setActiveSignUp).toHaveBeenCalledTimes(1));
      const navigate = mocks.setActiveSignUp.mock.calls[0]![0].navigate as Navigate;
      navigate({ session: active, decorateUrl: url => url });

      expect(assign).toHaveBeenCalledExactlyOnceWith('/en/onboarding-v1?claim=1');
    });

    it('uses completed-session navigation after the owner selects an allowed organization', async () => {
      const user = userEvent.setup();
      mocks.clerk.session = { ...active, status: 'pending', currentTask: { key: 'choose-organization' }, getToken: mocks.getToken };
      mocks.resolveOrganization.mockResolvedValueOnce({ created: false, organizations: [
        { id: 'org_one', name: 'First Studio' },
        { id: 'org_two', name: 'Second Studio' },
      ] });
      renderGate();
      await user.click(await screen.findByRole('button', { name: 'Second Studio' }));

      expect(mocks.clerk.setActive).toHaveBeenCalledWith({
        organization: 'org_two',
        session: active.id,
        navigate: expect.any(Function),
      });

      const navigate = mocks.clerk.setActive.mock.calls[0]![0].navigate as Navigate;
      navigate({ session: active, decorateUrl: url => `${url}&selected=synthetic` });

      expect(assign).toHaveBeenCalledExactlyOnceWith('/en/onboarding-v1?claim=1&selected=synthetic');
    });
  });
});
