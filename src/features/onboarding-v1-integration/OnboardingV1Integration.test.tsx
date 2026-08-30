import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { SITE_BUILDER_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { saveOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';
import type { OnboardingClaimSuccess } from './contracts';
import {
  createOnboardingIntegrationFlow,
  saveOnboardingIntegrationFlow,
} from './flow-storage';
import { OnboardingV1Integration } from './OnboardingV1Integration';

const mocks = vi.hoisted(() => ({
  auth: { isLoaded: true, isSignedIn: false },
  claim: vi.fn(),
  cleanupMedia: vi.fn(),
  claimMedia: vi.fn(),
  lab: {
    document: null as unknown,
    getReachableAssetIds: vi.fn(() => []),
  },
  savePlan: vi.fn(),
}));

vi.mock('@clerk/nextjs', () => ({
  SignIn: () => <div data-testid="clerk-sign-in">Clerk sign in</div>,
  SignUp: () => (
    <div data-testid="clerk-sign-up">
      <h1>Create your account</h1>
      Clerk sign up
    </div>
  ),
  useAuth: () => mocks.auth,
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

vi.mock('./client', () => ({
  claimOnboardingDraft: (...args: unknown[]) => mocks.claim(...args),
  getOnboardingDraftClaimStatus: vi.fn(),
  saveOnboardingPlanIntent: (...args: unknown[]) => mocks.savePlan(...args),
}));

vi.mock('./media-claim-client', () => ({
  claimOnboardingMedia: (...args: unknown[]) => mocks.claimMedia(...args),
  cleanupVerifiedUnreferencedOnboardingMedia: (...args: unknown[]) => mocks.cleanupMedia(...args),
  collectOnboardingMediaReferences: () => [],
}));

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
    mocks.claim.mockReset();
    mocks.claimMedia.mockReset();
    mocks.cleanupMedia.mockReset();
    mocks.savePlan.mockReset();
    seedAcceptedReview();
    saveOnboardingIntegrationFlow({
      ...createOnboardingIntegrationFlow(),
      phase: 'account',
    });
  });

  it('shows one owner heading and delegates the unauthenticated gate to Clerk', async () => {
    render(<OnboardingV1Integration locale="en" />);

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Create your free Luster account',
    })).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId('clerk-sign-up')).toBeVisible();
    expect(screen.getByText('Isla Nail Studio is ready to save')).toBeVisible();
    expect(screen.getByText(/continue on any device/u)).toBeVisible();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('claims an authenticated draft, reveals the saved site, then offers one plan action', async () => {
    const user = userEvent.setup();
    mocks.auth.isSignedIn = true;
    mocks.claim.mockResolvedValue({ status: 'saved', value: savedSite });
    mocks.claimMedia.mockResolvedValue({ failures: [], verifiedRevision: 1 });
    mocks.cleanupMedia.mockResolvedValue({ removedAssetIds: [] });

    render(<OnboardingV1Integration locale="en" />);

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
    mocks.claim.mockResolvedValue({ status: 'saved', value: savedSite });
    mocks.claimMedia
      .mockRejectedValueOnce(new Error('The photo verification was interrupted.'))
      .mockResolvedValueOnce({ failures: [], verifiedRevision: 1 });
    mocks.cleanupMedia.mockResolvedValue({ removedAssetIds: [] });

    render(<OnboardingV1Integration locale="en" />);

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
