import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { SITE_BUILDER_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { loadOnboardingState, saveOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';
import type { OnboardingAuthProviderAvailability } from './auth-providers';
import type { OnboardingClaimSuccess } from './contracts';
import {
  createOnboardingIntegrationFlow,
  loadOnboardingIntegrationFlow,
  saveOnboardingIntegrationFlow,
} from './flow-storage';
import { OnboardingV1Integration } from './OnboardingV1Integration';

type MockedClerkUser = {
  id: string;
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
    signOut: vi.fn(),
  },
  lab: {
    acceptOnboardingPresentation: vi.fn(() => null),
    document: null as unknown,
    getReachableAssetIds: vi.fn(() => []),
    loadIssues: [],
  },
  savePlan: vi.fn(),
  status: vi.fn(),
  signIn: { authenticateWithRedirect: vi.fn(), create: vi.fn() },
  signUp: { create: vi.fn(), prepareEmailAddressVerification: vi.fn() },
  userState: { isLoaded: true, user: null as unknown },
}));

const verifiedClerkUser = (): NonNullable<MockedClerkUser> => ({
  id: 'user-owner',
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
  useCustomDesignAssetStorageError: () => null,
}));

vi.mock('../../../prototypes/site-builder-v2-booking-integration-lab/src/ui/useLabDocument', () => ({
  useLabDocument: () => mocks.lab,
}));

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>();

  return {
    ...actual,
    claimOnboardingDraft: (...args: unknown[]) => mocks.claim(...args),
    getOnboardingDraftClaimStatus: (...args: unknown[]) => mocks.status(...args),
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

const ownedBusinessConflict = {
  status: 'conflict' as const,
  conflict: {
    code: 'BUSINESS_TARGET_REQUIRED' as const,
    businesses: [{ id: 'owned-salon', name: 'My existing salon', slug: 'my-existing-salon', hasSite: false }],
  },
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
    mocks.clerk.signOut.mockReset().mockResolvedValue(undefined);
    mocks.claim.mockReset();
    mocks.claimMedia.mockReset();
    mocks.cleanupMedia.mockReset();
    mocks.savePlan.mockReset();
    mocks.status.mockReset().mockResolvedValue({ claim: null });
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

  it.each(['loading', 'signed-out'])('never requests or displays existing salons while %s', async (state) => {
    mocks.auth.isLoaded = state !== 'loading';
    mocks.userState.isLoaded = state !== 'loading';
    // Simulate stale hook data while the next auth state is being resolved.
    mocks.userState.user = verifiedClerkUser();
    saveOnboardingIntegrationFlow({ ...createOnboardingIntegrationFlow(), phase: 'conflict' });
    render(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);

    expect(await screen.findByRole('heading', { level: 1, name: /Your site is coming together/u })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Where should we save this site?' })).not.toBeInTheDocument();
    expect(screen.queryByText('My existing salon')).not.toBeInTheDocument();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('identifies the signed-in account and clears its salon picker on sign-out', async () => {
    mocks.auth.isSignedIn = true;
    mocks.userState.user = verifiedClerkUser();
    mocks.claim.mockResolvedValue(ownedBusinessConflict);
    const { rerender } = render(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);

    expect(await screen.findByRole('heading', { name: 'Where should we save this site?' })).toBeVisible();
    expect(screen.getByText('owner@example.com')).toBeVisible();
    expect(screen.getByText('owner@example.com').parentElement).toHaveTextContent('Signed in as owner@example.com.');
    expect(screen.getByText('My existing salon')).toBeVisible();

    mocks.auth.isSignedIn = false;
    mocks.userState.user = null;
    rerender(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);

    expect(screen.queryByText('My existing salon')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Where should we save this site?' })).not.toBeInTheDocument();
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  });

  it.each(['signed-out', 'different-owner'])('discards a previous account response after %s', async (nextAccount) => {
    mocks.auth.isSignedIn = true;
    mocks.userState.user = verifiedClerkUser();
    let completeClaim!: (value: typeof ownedBusinessConflict) => void;
    mocks.claim.mockImplementationOnce(() => new Promise((resolve) => {
      completeClaim = resolve;
    }));
    mocks.claim.mockResolvedValue({
      ...ownedBusinessConflict,
      conflict: { ...ownedBusinessConflict.conflict, businesses: [] },
    });
    const { rerender } = render(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(1));

    mocks.auth.isSignedIn = nextAccount !== 'signed-out';
    mocks.userState.user = nextAccount === 'signed-out'
      ? null
      : {
          ...verifiedClerkUser(),
          id: 'user-second-owner',
        };
    rerender(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);
    await act(async () => {
      completeClaim(ownedBusinessConflict);
    });

    expect(screen.queryByText('My existing salon')).not.toBeInTheDocument();
    expect(mocks.claim).toHaveBeenCalledTimes(nextAccount === 'signed-out' ? 1 : 2);
    expect(mocks.claimMedia).not.toHaveBeenCalled();
  });

  it('offers account switching without deleting the anonymous draft', async () => {
    mocks.auth.isSignedIn = true;
    mocks.userState.user = verifiedClerkUser();
    mocks.claim.mockResolvedValue(ownedBusinessConflict);
    const draft = loadOnboardingState().state;
    render(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Use a different account' }));

    expect(mocks.clerk.signOut).toHaveBeenCalledWith({ redirectUrl: '/en/onboarding-v1?account=1&auth=sign-in' });
    expect(loadOnboardingState().state.profile).toEqual(draft.profile);
    expect(loadOnboardingState().state.recipe).toEqual(draft.recipe);
    expect(loadOnboardingState().state.anonymousDraftId).toBe(draft.anonymousDraftId);
    expect(screen.queryByText('My existing salon')).not.toBeInTheDocument();
  });

  it.each(['saved', 'plans'] as const)('verifies ownership before resuming a legacy %s screen', async (phase) => {
    mocks.auth.isSignedIn = true;
    mocks.userState.user = verifiedClerkUser();
    saveOnboardingIntegrationFlow({ ...createOnboardingIntegrationFlow(), phase, savedSite });
    let completeStatus!: (value: { claim: OnboardingClaimSuccess }) => void;
    mocks.status.mockImplementationOnce(() => new Promise((resolve) => {
      completeStatus = resolve;
    }));
    render(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);

    await waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(1));

    expect(screen.queryByTitle('Saved preview of Isla Nail Studio')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue free' })).not.toBeInTheDocument();

    await act(async () => {
      completeStatus({ claim: savedSite });
    });

    expect(await screen.findByRole('heading', {
      name: phase === 'saved' ? 'Your Luster site is saved' : 'Choose how you want to start',
    })).toBeVisible();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('hides the saved site immediately when a different owner signs in', async () => {
    const { OnboardingIntegrationRequestError } = await import('./client');
    mocks.auth.isSignedIn = true;
    mocks.userState.user = verifiedClerkUser();
    saveOnboardingIntegrationFlow({ ...createOnboardingIntegrationFlow(), phase: 'plans', savedSite });
    mocks.status.mockResolvedValueOnce({ claim: savedSite });
    const { rerender } = render(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);
    await screen.findByRole('button', { name: 'Continue free' });

    mocks.status.mockRejectedValue(new OnboardingIntegrationRequestError('This draft belongs to another account.', {
      code: 'DRAFT_ALREADY_CLAIMED',
      status: 403,
    }));
    mocks.userState.user = { ...verifiedClerkUser(), id: 'user-second-owner' };
    rerender(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);

    expect(screen.queryByRole('button', { name: 'Continue free' })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Saved preview of Isla Nail Studio')).not.toBeInTheDocument();

    await waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(2));

    expect(mocks.savePlan).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('ignores an interrupted-save status response after the account changes', async () => {
    mocks.auth.isSignedIn = true;
    mocks.userState.user = verifiedClerkUser();
    saveOnboardingIntegrationFlow({ ...createOnboardingIntegrationFlow(), phase: 'saving' });
    let completeStatus!: (value: { claim: OnboardingClaimSuccess }) => void;
    mocks.status.mockImplementationOnce(() => new Promise((resolve) => {
      completeStatus = resolve;
    }));
    const { rerender } = render(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);
    await waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(1));

    mocks.auth.isSignedIn = false;
    mocks.userState.user = null;
    rerender(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);
    await act(async () => {
      completeStatus({ claim: savedSite });
    });

    expect(mocks.claimMedia).not.toHaveBeenCalled();
    expect(loadOnboardingIntegrationFlow().savedSite).toBeNull();
    expect(screen.queryByTitle('Saved preview of Isla Nail Studio')).not.toBeInTheDocument();
  });

  it('recovers a taken URL by returning to business details without losing the draft', async () => {
    const { OnboardingIntegrationRequestError } = await import('./client');
    mocks.auth.isSignedIn = true;
    mocks.userState.user = verifiedClerkUser();
    mocks.claim.mockRejectedValue(new OnboardingIntegrationRequestError('That Luster URL is no longer available.', {
      code: 'SITE_SLUG_UNAVAILABLE',
      status: 409,
    }));
    const draft = loadOnboardingState().state;
    render(<OnboardingV1Integration authProviders={ALL_PROVIDERS} locale="en" />);

    expect(await screen.findByRole('heading', { name: 'Choose a different website URL' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Log in to edit my existing salon' })).toHaveAttribute('href', '/en/admin');
    expect(screen.getByRole('link', { name: /Contact support/u })).toHaveAttribute('href', 'mailto:support@islanailsalon.com');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Change my URL' }));

    expect(loadOnboardingState().state.profile).toEqual(draft.profile);
    expect(loadOnboardingState().state.anonymousDraftId).toBe(draft.anonymousDraftId);
    expect(loadOnboardingState().state.progress.currentScreen).toBe('business');
    expect(loadOnboardingIntegrationFlow().phase).toBe('onboarding');
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
