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
  signIn: {
    attemptFirstFactor: vi.fn(),
    authenticateWithRedirect: vi.fn(),
    create: vi.fn(),
    resetPassword: vi.fn(),
  },
  signUp: {
    createdSessionId: null as string | null,
    finalize: vi.fn(),
    password: vi.fn(),
    sso: vi.fn(),
    status: null as null | string,
    verifications: {
      emailAddress: { status: 'unverified' as string },
      sendEmailCode: vi.fn(),
      verifyEmailCode: vi.fn(),
    },
  },
  userState: { isLoaded: true, user: null as unknown },
}));

vi.mock('@clerk/nextjs', () => ({
  HandleSSOCallback: () => null,
  useClerk: () => mocks.clerk,
  useSignUp: () => ({
    signUp: mocks.signUp,
  }),
  useUser: () => mocks.userState,
}));

vi.mock('@clerk/nextjs/legacy', () => ({
  useSignIn: () => ({
    isLoaded: true,
    setActive: mocks.setActiveSignIn,
    signIn: mocks.signIn,
  }),
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
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    onTestFinished(() => hasFocus.mockRestore());
    mocks.getToken.mockReset().mockResolvedValue('synthetic-session-token');
    window.history.replaceState({}, '', '/en/onboarding-v1?account=1');
    mocks.clerk.session = null;
    mocks.userState.user = null;
    mocks.clerk.addListener.mockReturnValue(() => undefined);
    mocks.signUp.createdSessionId = null;
    mocks.signUp.status = null;
    mocks.signUp.verifications.emailAddress.status = 'unverified';
    mocks.signUp.password.mockReset().mockImplementation(async () => {
      mocks.signUp.status = 'missing_requirements';
      return { error: null };
    });
    mocks.signUp.verifications.sendEmailCode.mockReset().mockResolvedValue({ error: null });
    mocks.signUp.verifications.verifyEmailCode.mockReset().mockImplementation(async () => {
      mocks.signUp.createdSessionId = 'sess_new';
      mocks.signUp.status = 'complete';
      mocks.signUp.verifications.emailAddress.status = 'verified';
      return { error: null };
    });
    mocks.signUp.finalize.mockReset().mockResolvedValue({ error: null });
    mocks.signUp.sso.mockReset().mockResolvedValue({ error: null });
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
    expect(mocks.signUp.verifications.sendEmailCode).toHaveBeenCalledWith();
    expect(screen.getByText(/new-owner@example.com/u)).toBeVisible();

    await user.type(screen.getByLabelText('Verification code'), '424242');
    await user.click(screen.getByRole('button', { name: 'Verify and save my site' }));

    await waitFor(() => {
      expect(mocks.signUp.finalize).toHaveBeenCalledWith({ navigate: expect.any(Function) });
    });
  });

  it('activates an immediately-complete sign-up so the session verification step can gate the claim', async () => {
    const user = userEvent.setup();
    mocks.signIn.create.mockRejectedValueOnce({
      errors: [{ code: 'form_identifier_not_found' }],
    });
    mocks.signUp.password.mockImplementation(async () => {
      mocks.signUp.createdSessionId = 'sess_new';
      mocks.signUp.status = 'complete';
      return { error: null };
    });
    renderGate();

    await user.click(screen.getByRole('button', { name: 'Continue with email' }));
    await user.type(screen.getByLabelText('Email address'), 'new-owner@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByLabelText('Password'), 'a-strong-password');
    await user.click(screen.getByRole('button', { name: 'Create account and continue' }));

    await waitFor(() => {
      expect(mocks.signUp.finalize).toHaveBeenCalledWith({ navigate: expect.any(Function) });
    });

    expect(mocks.signUp.verifications.sendEmailCode).not.toHaveBeenCalled();
  });

  it('does not advance a cancelled or failed Protect-gated sign-up operation', async () => {
    const user = userEvent.setup();
    mocks.signIn.create.mockRejectedValueOnce({
      errors: [{ code: 'form_identifier_not_found' }],
    });
    mocks.signUp.password.mockResolvedValue({ error: {
      errors: [{ code: 'protect_check_failed', longMessage: 'Challenge cancelled' }],
    } });
    renderGate();

    await user.click(screen.getByRole('button', { name: 'Continue with email' }));
    await user.type(screen.getByLabelText('Email address'), 'new-owner@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByLabelText('Password'), 'a-strong-password');
    await user.click(screen.getByRole('button', { name: 'Create account and continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t create your account. Try again.');
    expect(mocks.signUp.verifications.sendEmailCode).not.toHaveBeenCalled();
    expect(mocks.signUp.finalize).not.toHaveBeenCalled();
  });

  it('maps a wrong verification code to owner copy instead of a raw Clerk error', async () => {
    const user = userEvent.setup();
    mocks.signIn.create.mockRejectedValueOnce({
      errors: [{ code: 'form_identifier_not_found' }],
    });
    mocks.signUp.verifications.verifyEmailCode.mockResolvedValue({ error: {
      errors: [{ code: 'form_code_incorrect', longMessage: 'Incorrect code' }],
    } });
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

  it('does not present a failed Protect check during verification as a bad code', async () => {
    const user = userEvent.setup();
    mocks.signIn.create.mockRejectedValueOnce({
      errors: [{ code: 'form_identifier_not_found' }],
    });
    mocks.signUp.verifications.verifyEmailCode.mockResolvedValue({ error: {
      errors: [{ code: 'protect_check_failed', longMessage: 'Challenge cancelled' }],
    } });
    renderGate();

    await user.click(screen.getByRole('button', { name: 'Continue with email' }));
    await user.type(screen.getByLabelText('Email address'), 'new-owner@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByLabelText('Password'), 'a-strong-password');
    await user.click(screen.getByRole('button', { name: 'Create account and continue' }));
    await user.type(await screen.findByLabelText('Verification code'), '424242');
    await user.click(screen.getByRole('button', { name: 'Verify and save my site' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t verify your email. Try again.');
    expect(mocks.signUp.finalize).not.toHaveBeenCalled();
  });

  it('does not call a verified but incomplete sign-up a bad code or finalize its session', async () => {
    const user = userEvent.setup();
    mocks.signIn.create.mockRejectedValueOnce({
      errors: [{ code: 'form_identifier_not_found' }],
    });
    mocks.signUp.verifications.verifyEmailCode.mockResolvedValue({ error: null });
    mocks.signUp.verifications.emailAddress.status = 'verified';
    renderGate();

    await user.click(screen.getByRole('button', { name: 'Continue with email' }));
    await user.type(screen.getByLabelText('Email address'), 'new-owner@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByLabelText('Password'), 'a-strong-password');
    await user.click(screen.getByRole('button', { name: 'Create account and continue' }));
    await user.type(await screen.findByLabelText('Verification code'), '424242');
    await user.click(screen.getByRole('button', { name: 'Verify and save my site' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your email was verified, but your account still needs another verification step. Try again to continue.',
    );
    expect(mocks.signUp.finalize).not.toHaveBeenCalled();
  });

  it('does not claim an unverified email was verified when sign-up remains incomplete', async () => {
    const user = userEvent.setup();
    mocks.signIn.create.mockRejectedValueOnce({
      errors: [{ code: 'form_identifier_not_found' }],
    });
    mocks.signUp.verifications.verifyEmailCode.mockResolvedValue({ error: null });
    renderGate();

    await user.click(screen.getByRole('button', { name: 'Continue with email' }));
    await user.type(screen.getByLabelText('Email address'), 'new-owner@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByLabelText('Password'), 'a-strong-password');
    await user.click(screen.getByRole('button', { name: 'Create account and continue' }));
    await user.type(await screen.findByLabelText('Verification code'), '424242');
    await user.click(screen.getByRole('button', { name: 'Verify and save my site' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We couldn’t finish creating your account. Your work is safe on this device. Try again to continue.',
    );
    expect(mocks.signUp.finalize).not.toHaveBeenCalled();
  });

  it('does not describe a post-verification finalization failure as a bad code', async () => {
    const user = userEvent.setup();
    mocks.signIn.create.mockRejectedValueOnce({
      errors: [{ code: 'form_identifier_not_found' }],
    });
    mocks.signUp.finalize.mockResolvedValue({ error: {
      errors: [{ code: 'session_finalize_failed', longMessage: 'Session unavailable' }],
    } });
    renderGate();

    await user.click(screen.getByRole('button', { name: 'Continue with email' }));
    await user.type(screen.getByLabelText('Email address'), 'new-owner@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByLabelText('Password'), 'a-strong-password');
    await user.click(screen.getByRole('button', { name: 'Create account and continue' }));
    await user.type(await screen.findByLabelText('Verification code'), '424242');
    await user.click(screen.getByRole('button', { name: 'Verify and save my site' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your email was verified, but we couldn’t sign you in. Try again.',
    );
    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  });

  it('preserves a newer pending organization task when sign-up finalization resolves later', async () => {
    const user = userEvent.setup();
    let finishFinalize!: (result: { error: unknown }) => void;
    let onSessionChanged!: (state: { session: unknown }) => void;
    mocks.signIn.create.mockRejectedValueOnce({
      errors: [{ code: 'form_identifier_not_found' }],
    });
    mocks.signUp.finalize.mockImplementationOnce(() => new Promise((resolve) => {
      finishFinalize = resolve;
    }));
    mocks.clerk.addListener.mockImplementation((listener) => {
      onSessionChanged = listener;
      return () => undefined;
    });
    mocks.resolveOrganization.mockResolvedValue({
      created: false,
      organizations: [
        { id: 'org_1', name: 'Isla Nail Studio' },
        { id: 'org_2', name: 'Luster Studio' },
      ],
    });
    renderGate();

    await user.click(screen.getByRole('button', { name: 'Continue with email' }));
    await user.type(screen.getByLabelText('Email address'), 'new-owner@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByLabelText('Password'), 'a-strong-password');
    await user.click(screen.getByRole('button', { name: 'Create account and continue' }));
    await user.type(await screen.findByLabelText('Verification code'), '424242');
    await user.click(screen.getByRole('button', { name: 'Verify and save my site' }));
    await waitFor(() => expect(mocks.signUp.finalize).toHaveBeenCalledTimes(1));

    const pendingSession = {
      currentTask: { key: 'choose-organization' },
      getToken: mocks.getToken,
      id: 'sess_pending',
      status: 'pending',
    };
    mocks.clerk.session = pendingSession;
    await act(async () => {
      onSessionChanged({ session: pendingSession });
    });

    expect(await screen.findByRole('heading', { name: 'Choose your business' })).toBeVisible();

    await act(async () => {
      finishFinalize({ error: { errors: [{ code: 'session_finalize_failed' }] } });
    });

    expect(screen.getByRole('heading', { name: 'Choose your business' })).toBeVisible();
    expect(screen.queryByText('Your email was verified, but we couldn’t sign you in. Try again.')).not.toBeInTheDocument();
  });

  it('starts sign-up OAuth through the current Clerk resource with a same-route callback', async () => {
    const user = userEvent.setup();
    renderGate();

    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(mocks.signUp.sso).toHaveBeenCalledWith({
      redirectCallbackUrl: '/en/onboarding-v1?sso=1',
      redirectUrl: '/en/onboarding-v1?sso=1',
      strategy: 'oauth_google',
    });
    expect(mocks.signIn.authenticateWithRedirect).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Continuing with Google…',
    })).toBeVisible();
  });

  it('keeps a cancelled or failed sign-up OAuth challenge out of the callback and claim flow', async () => {
    const user = userEvent.setup();
    mocks.signUp.sso.mockResolvedValue({ error: {
      errors: [{ code: 'protect_check_failed', longMessage: 'Challenge cancelled' }],
    } });
    renderGate();

    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t open Google sign-in. Try again.');
    expect(mocks.signIn.authenticateWithRedirect).not.toHaveBeenCalled();
  });

  it('keeps the existing-account OAuth flow on its existing sign-in resource', async () => {
    const user = userEvent.setup();
    mocks.signIn.authenticateWithRedirect.mockResolvedValue(undefined);
    renderGate({ authMode: 'sign-in' });

    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(mocks.signIn.authenticateWithRedirect).toHaveBeenCalledWith({
      redirectUrl: '/en/onboarding-v1?sso=1',
      redirectUrlComplete: '/en/onboarding-v1?claim=1',
      strategy: 'oauth_google',
    });
    expect(mocks.signUp.sso).not.toHaveBeenCalled();
  });

  it('describes a returned sign-up callback failure without blaming an email code', () => {
    window.history.replaceState({}, '', '/en/onboarding-v1?clerk-sign-up=failed');
    renderGate();

    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t complete sign-up. Try again.');
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
      mocks.signUp.finalize.mockReset().mockResolvedValue({ error: null });
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
      mocks.signUp.password.mockImplementationOnce(async () => {
        mocks.signUp.createdSessionId = active.id;
        mocks.signUp.status = 'complete';
        return { error: null };
      });
      const view = renderGate();
      await user.click(screen.getByRole('button', { name: 'Continue with email' }));
      await user.type(screen.getByLabelText('Email address'), 'handoff+clerk_test@example.com');
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await user.type(await screen.findByLabelText('Password'), 'synthetic-handoff-password');
      await user.click(screen.getByRole('button', { name: 'Create account and continue' }));
      await waitFor(() => expect(mocks.signUp.finalize).toHaveBeenCalledTimes(1));
      return { view, navigate: mocks.signUp.finalize.mock.calls[0]![0].navigate as Navigate };
    }

    describe('bounded finalization recovery', () => {
      const pending = () => ({ ...active, status: 'pending', currentTask: { key: 'choose-organization' }, getToken: mocks.getToken });
      const resolution = { created: false, organizations: [{ id: 'org_handoff', name: 'Handoff Studio' }] };
      function deferred<T>() {
        let resolve!: (value: T) => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<T>((done, fail) => {
          resolve = done;
          reject = fail;
        });
        return { promise, resolve, reject };
      }

      beforeEach(() => {
        vi.useFakeTimers();
        onTestFinished(() => {
          vi.useRealTimers();
        });
        mocks.resolveOrganization.mockReset().mockResolvedValue(resolution);
      });

      async function startSignup(needsSessionEmailVerification = false) {
        mocks.signIn.create.mockRejectedValueOnce({ errors: [{ code: 'form_identifier_not_found' }] });
        mocks.signUp.password.mockImplementationOnce(async () => {
          mocks.signUp.createdSessionId = active.id;
          mocks.signUp.status = 'complete';
          return { error: null };
        });
        const view = renderGate({ needsSessionEmailVerification });
        fireEvent.click(screen.getByRole('button', { name: 'Continue with email' }));
        fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'bounded+clerk_test@example.com' } });
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'synthetic-bounded-password' } });
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Create account and continue' }));
        });

        expect(mocks.signUp.finalize).toHaveBeenCalledTimes(1);

        return { view, navigate: mocks.signUp.finalize.mock.calls[0]![0].navigate as Navigate };
      }
      const advance = (ms = 30000) => act(() => {
        vi.advanceTimersByTime(ms);
      });
      const panel = () => screen.getByRole('heading', { name: 'Connecting is taking longer than expected' });

      it.each(['finalize', 'token', 'lookup', 'activation'] as const)('bounds never-settling %s without starting another operation', async (phase) => {
        const waiting = new Promise<never>(() => {});
        if (phase === 'finalize') {
          mocks.signUp.finalize.mockReturnValueOnce(waiting);
          await startSignup();
          act(() => emit(active));
        } else {
          mocks.clerk.session = pending();
          if (phase === 'token') {
            mocks.getToken.mockReturnValueOnce(waiting);
          }
          if (phase === 'lookup') {
            mocks.resolveOrganization.mockReturnValueOnce(waiting);
          }
          if (phase === 'activation') {
            mocks.clerk.setActive.mockReturnValueOnce(waiting);
          }
          renderGate();
          await act(async () => {});
        }
        advance(20000);
        act(() => emit(phase === 'finalize' ? active : pending()));
        advance(10000);

        expect(panel()).toBeVisible();
        expect(panel().parentElement).toHaveAttribute('aria-busy', 'false');
        expect(panel().parentElement?.querySelector('.onboarding-integration-spinner')).toBeNull();
        expect(screen.getByRole('link', { name: 'Contact Luster support' })).toHaveAttribute('href', 'mailto:support@lustergel.app');
        expect(screen.queryByRole('button', { name: 'Continue securely' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Retry business setup' })).not.toBeInTheDocument();

        advance(60000);

        expect(mocks.signUp.finalize).toHaveBeenCalledTimes(phase === 'finalize' ? 1 : 0);
        expect(mocks.getToken).toHaveBeenCalledTimes(phase === 'finalize' ? 0 : 1);
        expect(mocks.resolveOrganization).toHaveBeenCalledTimes(['lookup', 'activation'].includes(phase) ? 1 : 0);
        expect(mocks.clerk.setActive).toHaveBeenCalledTimes(phase === 'activation' ? 1 : 0);
      });

      it('keeps the deadline across signup-to-organization stages and duplicate task emissions', async () => {
        const finalize = deferred<{ error: null }>();
        const token = deferred<string>();
        mocks.signUp.finalize.mockReturnValueOnce(finalize.promise);
        mocks.getToken.mockReturnValueOnce(token.promise);
        await startSignup();
        advance(20000);
        act(() => emit(pending()));
        advance(9000);
        act(() => emit(pending()));
        advance(1000);

        expect(panel()).toBeVisible();

        await act(async () => {
          finalize.resolve({ error: null });
        });

        expect(screen.queryByRole('button', { name: 'Retry business setup' })).not.toBeInTheDocument();
        expect(mocks.getToken).toHaveBeenCalledTimes(1);
        expect(mocks.resolveOrganization).not.toHaveBeenCalled();
      });

      it('accepts late valid decorated navigation once while finalization is still pending', async () => {
        const finalize = deferred<{ error: null }>();
        mocks.signUp.finalize.mockReturnValueOnce(finalize.promise);
        const { navigate } = await startSignup();
        advance();

        expect(panel()).toBeVisible();

        act(() => emit(active));
        act(() => {
          navigate({ session: active, decorateUrl: url => `${url}&bounded=synthetic` });
          navigate({ session: active });
        });
        await act(async () => {
          finalize.resolve({ error: null });
        });

        expect(assign).toHaveBeenCalledExactlyOnceWith('/en/onboarding-v1?claim=1&bounded=synthetic');
        expect(mocks.clerk.setActive).not.toHaveBeenCalled();
      });

      it('continues a settled active session once without changing its organization', async () => {
        const activation = deferred<void>();
        mocks.clerk.setActive.mockReturnValueOnce(activation.promise);
        const { navigate } = await startSignup();
        act(() => emit({ ...active, lastActiveOrganizationId: 'org_existing' }));
        advance();
        const button = screen.getByRole('button', { name: 'Continue securely' });
        act(() => {
          fireEvent.click(button);
          fireEvent.click(button);
        });

        expect(mocks.clerk.setActive).toHaveBeenCalledExactlyOnceWith({ session: active.id, navigate: expect.any(Function) });
        expect(mocks.clerk.setActive.mock.calls[0]![0]).not.toHaveProperty('organization');
        expect(mocks.resolveOrganization).not.toHaveBeenCalled();

        advance();

        expect(panel()).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Continue securely' })).not.toBeInTheDocument();

        const recoveryNavigate = mocks.clerk.setActive.mock.calls[0]![0].navigate as Navigate;
        act(() => {
          recoveryNavigate({ session: active, decorateUrl: url => `${url}&recovered=synthetic` });
          navigate({ session: active });
        });
        await act(async () => {
          activation.resolve();
        });

        expect(assign).toHaveBeenCalledExactlyOnceWith('/en/onboarding-v1?claim=1&recovered=synthetic');
      });

      it('withholds recovery through undefined and resumes the same expired deadline when restored', async () => {
        await startSignup();
        act(() => emit(active));
        advance();

        expect(screen.getByRole('button', { name: 'Continue securely' })).toBeVisible();

        act(() => emit(undefined));

        expect(panel()).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Continue securely' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Retry business setup' })).not.toBeInTheDocument();

        act(() => emit(active));

        expect(screen.getByRole('button', { name: 'Continue securely' })).toBeVisible();
        expect(mocks.signUp.finalize).toHaveBeenCalledTimes(1);
      });

      it('keeps a settled transient continuation rejection actionable without organization provisioning', async () => {
        mocks.clerk.setActive.mockRejectedValueOnce(new Error('Offline'));
        await startSignup();
        act(() => emit(active));
        advance();
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Continue securely' }));
        });

        expect(panel()).toBeVisible();
        expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t continue securely. Try again or contact Luster support.');
        expect(screen.getByRole('button', { name: 'Continue securely' })).toBeEnabled();
        expect(screen.getByRole('link', { name: 'Contact Luster support' })).toHaveAttribute('href', 'mailto:support@lustergel.app');
        expect(mocks.clerk.setActive).toHaveBeenCalledTimes(1);
        expect(mocks.resolveOrganization).not.toHaveBeenCalled();
        expect(assign).not.toHaveBeenCalled();
      });

      it.each(['SESSION_EXPIRED', 'organization_quota_exceeded'])('shows support without a generic retry for continuation %s', async (code) => {
        mocks.clerk.setActive.mockRejectedValueOnce({ errors: [{ code }] });
        await startSignup();
        act(() => emit(active));
        advance();
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Continue securely' }));
        });

        expect(screen.getByRole('heading', { name: 'Business setup needs attention' })).toBeVisible();
        expect(screen.getByRole('link', { name: 'Contact Luster support' })).toHaveAttribute('href', 'mailto:support@lustergel.app');
        expect(screen.queryByRole('button', { name: 'Continue securely' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Retry business setup' })).not.toBeInTheDocument();
        expect(mocks.resolveOrganization).not.toHaveBeenCalled();
      });

      it.each([
        ['replacement', 'resolve'],
        ['replacement', 'reject'],
        ['unmount', 'resolve'],
        ['unmount', 'reject'],
      ])('ignores stale continuation navigation and %s/%s settlement', async (change, settlement) => {
        const activation = deferred<void>();
        mocks.clerk.setActive.mockReturnValueOnce(activation.promise);
        const { view } = await startSignup();
        act(() => emit(active));
        advance();
        fireEvent.click(screen.getByRole('button', { name: 'Continue securely' }));
        const staleNavigate = mocks.clerk.setActive.mock.calls[0]![0].navigate as Navigate;
        const replacement = { ...active, id: 'sess_replacement' };
        if (change === 'replacement') {
          act(() => emit(replacement));
        } else {
          view.unmount();
        }
        act(() => staleNavigate({ session: active, decorateUrl: url => `${url}&stale=synthetic` }));
        await act(async () => {
          if (settlement === 'resolve') {
            activation.resolve();
          } else {
            activation.reject(new Error('Stale activation failure'));
          }
        });
        act(() => staleNavigate({ session: active, decorateUrl: url => `${url}&stale=synthetic` }));
        advance();

        expect(screen.queryByText('We couldn’t continue securely. Try again or contact Luster support.')).not.toBeInTheDocument();
        expect(mocks.clerk.setActive).toHaveBeenCalledTimes(1);
        expect(mocks.resolveOrganization).not.toHaveBeenCalled();
        expect(assign).not.toHaveBeenCalled();

        if (change === 'replacement') {
          expect(mocks.clerk.session).toBe(replacement);
        }
      });

      it('retains one resolved organization through an unfocused deadline and duplicate focus events', async () => {
        vi.mocked(document.hasFocus).mockReturnValue(false);
        mocks.clerk.session = pending();
        renderGate();
        await act(async () => {});

        expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1);
        expect(mocks.clerk.setActive).not.toHaveBeenCalled();

        advance(30001);
        act(() => {
          emit(pending());
          window.dispatchEvent(new Event('focus'));
          document.dispatchEvent(new Event('visibilitychange'));
        });

        expect(panel()).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Retry business setup' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Continue securely' })).not.toBeInTheDocument();
        expect(mocks.getToken).toHaveBeenCalledTimes(1);
        expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1);
        expect(mocks.clerk.setActive).not.toHaveBeenCalled();

        vi.mocked(document.hasFocus).mockReturnValue(true);
        await act(async () => {
          window.dispatchEvent(new Event('focus'));
          window.dispatchEvent(new Event('focus'));
        });

        expect(mocks.clerk.setActive).toHaveBeenCalledExactlyOnceWith({
          organization: 'org_handoff',
          session: active.id,
          navigate: expect.any(Function),
        });
        expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1);

        const navigate = mocks.clerk.setActive.mock.calls[0]![0].navigate as Navigate;
        act(() => navigate({ session: active, decorateUrl: url => url }));

        expect(assign).toHaveBeenCalledExactlyOnceWith('/en/onboarding-v1?claim=1');
      });

      it('retains the focus wait through undefined accessors until the same pending task returns', async () => {
        vi.mocked(document.hasFocus).mockReturnValue(false);
        mocks.clerk.session = pending();
        renderGate();
        await act(async () => {});
        // The wait sees focus first; the accessor clears before its await resumes.
        window.addEventListener('focus', () => emit(undefined), { once: true });
        vi.mocked(document.hasFocus).mockReturnValue(true);
        await act(async () => {
          window.dispatchEvent(new Event('focus'));
        });

        expect(mocks.clerk.setActive).not.toHaveBeenCalled();

        await act(async () => emit(pending()));

        expect(mocks.clerk.setActive).toHaveBeenCalledTimes(1);
        expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1);
      });

      it('rejects replacement after the focus wait resolves but before activation dispatch', async () => {
        vi.mocked(document.hasFocus).mockReturnValue(false);
        mocks.clerk.session = pending();
        renderGate();
        await act(async () => {});
        vi.mocked(document.hasFocus).mockReturnValue(true);
        await act(async () => {
          window.dispatchEvent(new Event('focus'));
          emit({ ...active, id: 'sess_replacement' });
        });

        expect(mocks.clerk.setActive).not.toHaveBeenCalled();
        expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1);
        expect(assign).not.toHaveBeenCalled();
      });

      it.each(['unmount', 'replacement', 'ended', 'signout', 'task-change', 'task-complete'])(
        'cancels a resolved organization focus wait on %s',
        async (change) => {
          vi.mocked(document.hasFocus).mockReturnValue(false);
          mocks.clerk.session = pending();
          const view = renderGate();
          await act(async () => {});

          expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1);

          if (change === 'unmount') {
            view.unmount();
          } else {
            act(() => emit(change === 'signout'
              ? null
              : change === 'replacement'
                ? { ...active, id: 'sess_replacement' }
                : change === 'ended'
                  ? { ...active, status: 'ended' }
                  : change === 'task-change'
                    ? { ...pending(), currentTask: { key: 'reset-password' } }
                    : active));
          }
          vi.mocked(document.hasFocus).mockReturnValue(true);
          await act(async () => {
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
          });

          expect(mocks.clerk.setActive).not.toHaveBeenCalled();
          expect(mocks.getToken).toHaveBeenCalledTimes(1);
          expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1);
          expect(assign).not.toHaveBeenCalled();
        },
      );

      it('keeps delayed organization activation fenced past the deadline and navigates during an undefined transition', async () => {
        const activation = deferred<void>();
        mocks.clerk.session = pending();
        mocks.clerk.setActive.mockReturnValueOnce(activation.promise);
        renderGate();
        await act(async () => {});

        expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1);
        expect(mocks.clerk.setActive).toHaveBeenCalledExactlyOnceWith({
          organization: 'org_handoff',
          session: active.id,
          navigate: expect.any(Function),
        });

        const navigate = mocks.clerk.setActive.mock.calls[0]![0].navigate as Navigate;

        advance(30001);
        act(() => emit(pending()));

        expect(panel()).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Retry business setup' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Continue securely' })).not.toBeInTheDocument();
        expect(assign).not.toHaveBeenCalled();
        expect(mocks.getToken).toHaveBeenCalledTimes(1);
        expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1);
        expect(mocks.clerk.setActive).toHaveBeenCalledTimes(1);

        act(() => {
          emit(undefined);
          navigate({ session: active, decorateUrl: url => `${url}&activated=synthetic` });
        });
        await act(async () => {
          activation.resolve();
        });
        act(() => emit(active));

        expect(assign).toHaveBeenCalledExactlyOnceWith('/en/onboarding-v1?claim=1&activated=synthetic');
        expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1);
        expect(mocks.clerk.setActive).toHaveBeenCalledTimes(1);
      });

      it('makes recovery actionable after a single pending activation callback and a later active event', async () => {
        const activation = deferred<void>();
        mocks.clerk.session = pending();
        mocks.clerk.setActive.mockReturnValueOnce(activation.promise);
        renderGate();
        await act(async () => {});

        expect(mocks.clerk.setActive).toHaveBeenCalledTimes(1);

        const navigate = mocks.clerk.setActive.mock.calls[0]![0].navigate as Navigate;

        // Model one SDK callback while its task is still pending.
        act(() => navigate({ session: pending(), decorateUrl: url => url }));
        await act(async () => {
          activation.resolve();
        });
        advance(30001);

        expect(panel()).toBeVisible();
        expect(screen.getByRole('button', { name: 'Retry business setup' })).toBeEnabled();
        expect(assign).not.toHaveBeenCalled();

        // A later listener event is not a second invocation of that callback.
        act(() => emit(active));

        expect(screen.getByRole('button', { name: 'Continue securely' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Retry business setup' })).not.toBeInTheDocument();
        expect(assign).not.toHaveBeenCalled();
        expect(mocks.getToken).toHaveBeenCalledTimes(1);
        expect(mocks.resolveOrganization).toHaveBeenCalledTimes(1);
        expect(mocks.clerk.setActive).toHaveBeenCalledTimes(1);
      });

      it('allows exactly one explicit same-task retry only after existing organization work settles', async () => {
        mocks.clerk.session = pending();
        renderGate();
        await act(async () => {});

        expect(mocks.clerk.setActive).toHaveBeenCalledTimes(1);

        advance();
        const retry = deferred<typeof resolution>();
        mocks.resolveOrganization.mockReturnValueOnce(retry.promise);
        const button = screen.getByRole('button', { name: 'Retry business setup' });
        act(() => {
          fireEvent.click(button);
          fireEvent.click(button);
        });
        await act(async () => {});

        expect(mocks.resolveOrganization).toHaveBeenCalledTimes(2);

        act(() => emit(pending()));
        advance();

        expect(panel()).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Retry business setup' })).not.toBeInTheDocument();
        expect(mocks.getToken).toHaveBeenCalledTimes(2);
      });

      it.each(['ORGANIZATION_QUOTA_EXCEEDED', 'SESSION_EXPIRED'])('preserves a late %s error without generic recovery', async (code) => {
        const lookup = deferred<typeof resolution>();
        mocks.clerk.session = pending();
        mocks.resolveOrganization.mockReturnValueOnce(lookup.promise);
        renderGate();
        await act(async () => {});
        advance();

        expect(panel()).toBeVisible();

        await act(async () => {
          lookup.reject(Object.assign(new Error('Setup refused'), { code }));
        });

        expect(screen.getByRole('heading', { name: 'Business setup needs attention' })).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Retry business setup' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Continue securely' })).not.toBeInTheDocument();
      });

      it('preserves a late signup error after the recovery deadline', async () => {
        const finalize = deferred<{ error: { message: string } }>();
        mocks.signUp.finalize.mockReturnValueOnce(finalize.promise);
        await startSignup();
        advance();

        expect(panel()).toBeVisible();

        await act(async () => {
          finalize.resolve({ error: { message: 'Final activation refused' } });
        });

        expect(screen.getByRole('alert')).toHaveTextContent('Your account was created, but we couldn’t sign you in. Try again.');
        expect(screen.getByLabelText('Password')).toBeVisible();
        expect(screen.queryByRole('heading', { name: 'Connecting is taking longer than expected' })).not.toBeInTheDocument();
      });

      it.each([null, { ...active, status: 'ended' }, { ...active, id: 'sess_other' }])('invalidates finalization without a previous task on %j', async (session) => {
        const finalize = deferred<{ error: null }>();
        mocks.signUp.finalize.mockReturnValueOnce(finalize.promise);
        const { navigate } = await startSignup();
        act(() => emit(session));
        advance();

        expect(screen.getByRole('alert')).toHaveTextContent('Your sign-in session ended');
        expect(screen.queryByRole('heading', { name: 'Connecting is taking longer than expected' })).not.toBeInTheDocument();

        await act(async () => {
          finalize.reject(new Error('Old failure'));
        });
        navigate({ session: active });

        expect(assign).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).not.toHaveTextContent('Old failure');
      });

      it('ignores the old recovery click, timer and callback after replacement or unmount', async () => {
        const { view, navigate } = await startSignup();
        act(() => emit(active));
        advance();
        const button = screen.getByRole('button', { name: 'Continue securely' });
        act(() => emit({ ...active, id: 'sess_other' }));
        fireEvent.click(button);
        view.unmount();
        advance(60000);
        navigate({ session: active });

        expect(mocks.clerk.setActive).not.toHaveBeenCalled();
        expect(assign).not.toHaveBeenCalled();
      });

      it('does not offer active-session recovery while parent email verification is required', async () => {
        await startSignup(true);
        act(() => emit(active));
        advance();

        expect(panel()).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Continue securely' })).not.toBeInTheDocument();
        expect(mocks.clerk.setActive).not.toHaveBeenCalled();
      });
    });

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

    it('falls back to the claim route when a callback has no URL decorator', async () => {
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
      // Model a loading emission before navigate while the previous raw
      // session is pending. Loading alone does not establish sign-out.
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
      mocks.signUp.password.mockImplementationOnce(async () => {
        emit(null);
        mocks.signUp.createdSessionId = status === 'complete' ? active.id : null;
        mocks.signUp.status = status;
        return { error: null };
      });
      mocks.signUp.verifications.sendEmailCode.mockResolvedValueOnce({ error: null });
      mocks.signUp.verifications.verifyEmailCode.mockImplementationOnce(async () => {
        emit(null);
        mocks.signUp.createdSessionId = active.id;
        mocks.signUp.status = 'complete';
        mocks.signUp.verifications.emailAddress.status = 'verified';
        return { error: null };
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
      await waitFor(() => expect(mocks.signUp.finalize).toHaveBeenCalledTimes(1));
      const navigate = mocks.signUp.finalize.mock.calls[0]![0].navigate as Navigate;
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

  it('shows the provider password minimum and recovers after editing and retrying', async () => {
    const user = userEvent.setup();
    mocks.signIn.create.mockRejectedValueOnce({ errors: [{ code: 'form_identifier_not_found' }] });
    mocks.signUp.password
      .mockResolvedValueOnce({ error: { errors: [{
        code: 'form_password_length_too_short',
        longMessage: 'Passwords must be 15 characters or more.',
      }] } })
      .mockImplementationOnce(async () => {
        mocks.signUp.status = 'missing_requirements';
        return { error: null };
      });
    mocks.signUp.verifications.sendEmailCode.mockResolvedValue({ error: null });
    renderGate();
    await user.click(screen.getByRole('button', { name: 'Continue with email' }));
    await user.type(screen.getByLabelText('Email address'), 'synthetic-retry@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const password = await screen.findByLabelText('Password');

    expect(password).toBeRequired();
    expect(password).not.toHaveAttribute('minlength');

    await user.type(password, 'synthetic-first');
    await user.click(screen.getByRole('button', { name: 'Create account and continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a password of at least 15 characters.');
    expect(mocks.signUp.verifications.sendEmailCode).not.toHaveBeenCalled();
    expect(mocks.signUp.finalize).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create account and continue' })).toBeEnabled();

    await user.clear(password);
    await user.type(password, 'synthetic-replacement-password');
    await user.click(screen.getByRole('button', { name: 'Create account and continue' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.signUp.password).toHaveBeenCalledTimes(2);
    expect(mocks.signUp.password).toHaveBeenNthCalledWith(2, {
      emailAddress: 'synthetic-retry@example.com',
      password: 'synthetic-replacement-password',
    });
    expect(mocks.signUp.verifications.sendEmailCode).toHaveBeenCalledTimes(1);
    expect(mocks.signUp.finalize).not.toHaveBeenCalled();
  });
});
