import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { initializeStarter } from '../../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { createDefaultOnboardingState } from '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import type { OnboardingAuthProviderAvailability } from '../auth-providers';
import { PremiumAccountGate } from './AccountGate';

const mocks = vi.hoisted(() => ({
  clerk: {
    addListener: vi.fn(() => () => undefined),
    session: null as unknown,
    setActive: vi.fn(),
  },
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

  it('keeps the short-phone reward preview scaled to its width instead of shrinking it to its cropped height', () => {
    renderGate();

    const preview = screen.getByRole('region', { name: 'Preview of Isla Nail Studio' });

    expect(preview).not.toHaveClass('is-fit-available');
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
      expect(mocks.setActiveSignUp).toHaveBeenCalledWith({ session: 'sess_new' });
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
      expect(mocks.setActiveSignUp).toHaveBeenCalledWith({ session: 'sess_immediate' });
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
      });
    });

    expect(mocks.resolveOrganization).toHaveBeenCalledWith('Isla Nail Studio');
    expect(screen.queryByText(/organization/iu)).not.toBeInTheDocument();
  });

  it('offers a business choice when the account already has several', async () => {
    const user = userEvent.setup();
    mocks.clerk.session = {
      currentTask: { key: 'choose-organization' },
      id: 'sess_pending',
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
      });
    });
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
});
