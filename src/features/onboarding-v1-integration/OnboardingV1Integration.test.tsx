import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { SITE_BUILDER_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { saveOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';
import type { OnboardingAuthProviderAvailability } from './auth-providers';
import type { OnboardingClaimSuccess } from './contracts';
import {
  createOnboardingIntegrationFlow,
  loadOnboardingIntegrationFlow,
  saveOnboardingIntegrationFlow,
} from './flow-storage';
import { OnboardingV1Integration } from './OnboardingV1Integration';

type MockedClerkUser = {
  primaryEmailAddress: {
    attemptVerification: ReturnType<typeof vi.fn>;
    emailAddress: string;
    prepareVerification: ReturnType<typeof vi.fn>;
    verification: { status: string };
  };
  reload: ReturnType<typeof vi.fn>;
} | null;

const mocks = vi.hoisted(() => ({
  auth: { isLoaded: true, isSignedIn: false },
  claim: vi.fn(),
  claimMedia: vi.fn(),
  cleanupMedia: vi.fn(),
  clerk: {
    addListener: vi.fn(() => () => undefined),
    session: null as unknown,
    setActive: vi.fn(),
  },
  lab: {
    document: null as unknown,
    getReachableAssetIds: vi.fn(() => []),
  },
  savePlan: vi.fn(),
  signIn: { authenticateWithRedirect: vi.fn(), create: vi.fn() },
  signUp: { create: vi.fn(), prepareEmailAddressVerification: vi.fn() },
  userState: { isLoaded: true, user: null as unknown },
}));

const verifiedClerkUser = (): NonNullable<MockedClerkUser> => ({
  primaryEmailAddress: {
    attemptVerification: vi.fn(),
    emailAddress: 'owner@example.com',
    prepareVerification: vi.fn().mockResolvedValue({}),
    verification: { status: 'verified' },
  },
  reload: vi.fn().mockResolvedValue(undefined),
});

vi.mock('@clerk/nextjs', () => ({
  AuthenticateWithRedirectCallback: () => null,
  useAuth: () => mocks.auth,
  useClerk: () => mocks.clerk,
  useSignIn: () => ({ isLoaded: true, setActive: vi.fn(), signIn: mocks.signIn }),
  useSignUp: () => ({ isLoaded: true, setActive: vi.fn(), signUp: mocks.signUp }),
  useUser: () => mocks.userState,
}));

vi.mock('../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/integration/CustomDesignAssetProvider', () => ({
  CustomDesignAssetProvider: ({ children }: { children: ReactNode }) => children,
  useCustomDesignAssetCoordinator: () => null,
  useCustomDesignAssetMap: () => new Map(),
  useCustomDesignAssetRepository: () => ({}),
}));

vi.mock('../../../prototypes/site-builder-v2-booking-integration-lab/src/ui/useLabDocument', () => ({
  useLabDocument: () => mocks.lab,
}));

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>();

  return {
    ...actual,
    claimOnboardingDraft: (...args: unknown[]) => mocks.claim(...args),
    getOnboardingDraftClaimStatus: vi.fn(),
    resolveOnboardingOrganization: vi.fn(),
    saveOnboardingPlanIntent: (...args: unknown[]) => mocks.savePlan(...args),
  };
});

vi.mock('./media-claim-client', () => ({
  claimOnboardingMedia: (...args: unknown[]) => mocks.claimMedia(...args),
  cleanupVerifiedUnreferencedOnboardingMedia: (...args: unknown[]) => mocks.cleanupMedia(...args),
  collectOnboardingMediaReferences: () => [],
}));

const ALL_PROVIDERS: OnboardingAuthProviderAvailability = {
  apple: true,
  email: true,
  google: true,
  source: 'clerk-environment',
};

const savedSite: OnboardingClaimSuccess = {
  claimId: 'claim-id',
  created: true,
  dashboardUrl: '/en/admin',
  media: { failed: 0, pending: 0, ready: 0 },
  ownerCreatedServiceIds: [],
  payloadFingerprint: '0123456789abcdef',
  revision: 1,
  revisionId: 'revision-id',
  salonId: 'salon-id',
  salonSlug: 'isla-nail-studio',
  serviceMappingIssues: [],
  serviceMenuApplied: true,
  siteId: '11111111-1111-4111-8111-111111111111',
};

const seedAcceptedReview = () => {
  const state = createDefaultOnboardingState();
  state.profile.businessName = 'Isla Nail Studio';
  state.profile.ownerName = 'Daniela';
  state.profile.businessStructure = 'solo';
  state.recipe.starter = 'one_page';
  state.recipe.starterDocumentSiteId = 'local-site';
  const document = initializeStarter('one_page', {
    siteId: 'local-site',
    siteName: state.profile.businessName,
  });

  expect(saveOnboardingState(state).success).toBe(true);

  window.localStorage.setItem(SITE_BUILDER_STORAGE_KEY, JSON.stringify(document));
  mocks.lab.document = document;
};

describe('OnboardingV1Integration rendered account-save flow', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/en/onboarding-v1?account=1');
    mocks.auth.isLoaded = true;
    mocks.auth.isSignedIn = false;
    mocks.userState.isLoaded = true;
    mocks.userState.user = null;
    mocks.clerk.session = null;
    mocks.claim.mockReset();
    mocks.claimMedia.mockReset();
    mocks.cleanupMedia.mockReset();
    mocks.savePlan.mockReset();
    mocks.signIn.create.mockReset();
    mocks.signUp.create.mockReset();
    seedAcceptedReview();
    saveOnboardingIntegrationFlow({
      ...createOnboardingIntegrationFlow(),
      phase: 'account',
    });
  });

  it('shows the premium gate with every configured provider and one owner heading', async () => {
    render(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);

    expect(await screen.findByRole('heading', {
      level: 1,
      name: /Your site is coming together/u,
    })).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue with email' })).toBeVisible();
    expect(screen.queryByText(/facebook/iu)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeVisible();
    expect(screen.getAllByText('Isla Nail Studio')).not.toHaveLength(0);
    expect(screen.getAllByText(/No payment required/u)).not.toHaveLength(0);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('renders only the configured providers and never a disabled stand-in', async () => {
    render(
      <OnboardingV1Integration
        authProviders={{ apple: false, email: true, google: false, source: 'clerk-environment' }}
        locale="en"
      />,
    );

    expect(await screen.findByRole('button', { name: 'Continue with email' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue with Apple' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
    expect(screen.queryByText('Continue with Apple')).not.toBeInTheDocument();
    expect(screen.queryByText('Continue with Google')).not.toBeInTheDocument();
  });

  it('keeps a signed-in owner with an unverified email inside verification without claiming', async () => {
    mocks.auth.isSignedIn = true;
    const unverifiedUser = verifiedClerkUser();
    unverifiedUser.primaryEmailAddress.verification.status = 'unverified';
    mocks.userState.user = unverifiedUser;

    render(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Check your email',
    })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Verify and save my site' })).toBeVisible();
    expect(unverifiedUser.primaryEmailAddress.prepareVerification).toHaveBeenCalledWith({
      strategy: 'email_code',
    });
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it.each([false, true])('returns EMAIL_NOT_VERIFIED to verification without retrying (reload fails: %s)', async (reloadFails) => {
    const { OnboardingIntegrationRequestError } = await import('./client');
    mocks.auth.isSignedIn = true;
    const user = verifiedClerkUser();
    if (reloadFails) {
      user.reload.mockRejectedValue(new Error('Clerk is temporarily unavailable.'));
    }
    mocks.userState.user = user;
    mocks.claim.mockRejectedValue(new OnboardingIntegrationRequestError(
      'Verify your email before saving your Luster site.',
      { code: 'EMAIL_NOT_VERIFIED', status: 403 },
    ));

    const { rerender } = render(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
    expect(loadOnboardingIntegrationFlow().errorMessage).toBe('Verify your email to finish saving your site.');
    expect(screen.queryByRole('heading', {
      level: 1,
      name: 'We couldn’t finish saving your site',
    })).not.toBeInTheDocument();
    expect(user.reload).toHaveBeenCalled();
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.claimMedia).not.toHaveBeenCalled();
    expect(mocks.cleanupMedia).not.toHaveBeenCalled();

    // An unrelated render and stale verified hook value must not resubmit.
    rerender(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);

    expect(screen.getByRole('button', { name: 'Verify and save my site' })).toBeVisible();
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY)).not.toBeNull();
  });

  it('retries the same preserved draft only after explicit successful email verification', async () => {
    const { OnboardingIntegrationRequestError } = await import('./client');
    const interaction = userEvent.setup();
    mocks.auth.isSignedIn = true;
    const user = verifiedClerkUser();
    mocks.userState.user = user;
    user.primaryEmailAddress.attemptVerification.mockResolvedValue({ verification: { status: 'verified' } });
    mocks.claim
      .mockRejectedValueOnce(new OnboardingIntegrationRequestError('Verify your email.', {
        code: 'EMAIL_NOT_VERIFIED',
        status: 403,
      }))
      .mockResolvedValueOnce({ status: 'saved', value: savedSite });
    mocks.claimMedia.mockResolvedValue({ failures: [], verifiedRevision: 1 });
    mocks.cleanupMedia.mockResolvedValue({ removedAssetIds: [] });

    render(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);

    await screen.findByRole('heading', { level: 1, name: 'Check your email' });

    expect(mocks.claim).toHaveBeenCalledTimes(1);

    const firstClaim = mocks.claim.mock.calls[0]?.[0];
    await interaction.type(screen.getByLabelText('Verification code'), '424242');
    await interaction.click(screen.getByRole('button', { name: 'Verify and save my site' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Your Luster site is saved' })).toBeVisible();
    expect(user.primaryEmailAddress.attemptVerification).toHaveBeenCalledWith({ code: '424242' });
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    expect(mocks.claim.mock.calls[1]?.[0]).toEqual(firstClaim);
    expect(mocks.claimMedia).toHaveBeenCalledTimes(1);
  });

  it('keeps ordinary request failures retryable without requesting email verification', async () => {
    mocks.auth.isSignedIn = true;
    const user = verifiedClerkUser();
    mocks.userState.user = user;
    mocks.claim.mockRejectedValue(new Error('The connection was interrupted.'));

    render(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);

    expect(await screen.findByRole('heading', { level: 1, name: 'We couldn’t finish saving your site' })).toBeVisible();
    expect(screen.queryByRole('heading', { level: 1, name: 'Check your email' })).not.toBeInTheDocument();
    expect(user.primaryEmailAddress.prepareVerification).not.toHaveBeenCalled();
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  });

  it('claims an authenticated draft, reveals the saved site, then offers one plan action', async () => {
    const user = userEvent.setup();
    mocks.auth.isSignedIn = true;
    mocks.userState.user = verifiedClerkUser();
    mocks.claim.mockResolvedValue({ status: 'saved', value: savedSite });
    mocks.claimMedia.mockResolvedValue({ failures: [], verifiedRevision: 1 });
    mocks.cleanupMedia.mockResolvedValue({ removedAssetIds: [] });

    render(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Your Luster site is saved',
    })).toBeVisible();
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle('Saved preview of Isla Nail Studio')).toHaveAttribute(
      'src',
      '/en/admin/website/preview/11111111-1111-4111-8111-111111111111?embed=1',
    );

    await user.click(screen.getByRole('button', { name: 'Choose how to start' }));

    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Choose how you want to start',
    })).toBeVisible();
    expect(screen.getByRole('radio', { name: /Free/u })).toBeChecked();
    expect(screen.getAllByRole('button', { name: 'Continue free' })).toHaveLength(1);
    expect(screen.queryByText(/lifetime/iu)).not.toBeInTheDocument();
    expect(screen.getByText('Nothing is charged today.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /pay|checkout|purchase/iu }))
      .not.toBeInTheDocument();
  });

  it('retains a successful core claim when media finalization must be retried', async () => {
    const user = userEvent.setup();
    mocks.auth.isSignedIn = true;
    mocks.userState.user = verifiedClerkUser();
    mocks.claim.mockResolvedValue({ status: 'saved', value: savedSite });
    mocks.claimMedia
      .mockRejectedValueOnce(new Error('The photo verification was interrupted.'))
      .mockResolvedValueOnce({ failures: [], verifiedRevision: 1 });
    mocks.cleanupMedia.mockResolvedValue({ removedAssetIds: [] });

    render(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Some photos still need attention',
    })).toBeVisible();
    expect(mocks.claim).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Retry photos' }));

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Your Luster site is saved',
    })).toBeVisible();
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.claimMedia).toHaveBeenCalledTimes(2);
  });
});
