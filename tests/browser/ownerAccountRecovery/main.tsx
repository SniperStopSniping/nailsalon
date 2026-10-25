import '@/styles/global.css';

import { NextIntlClientProvider } from 'next-intl';
import { type ReactNode, StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { OwnerAdminFeatureFlagsContext } from '@/app/[locale]/admin/OwnerAdminFeatureFlags';
import AdminPage from '@/app/[locale]/admin/page';
import { FreshOnboardingAuthBoundary } from '@/features/onboarding-v1-integration/account-gate/FreshOnboardingAuthBoundary';
import { createOnboardingIntegrationFlow, saveOnboardingIntegrationFlow } from '@/features/onboarding-v1-integration/flow-storage';
import { OnboardingV1Integration } from '@/features/onboarding-v1-integration/OnboardingV1Integration';
import en from '@/locales/en.json';

import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { reconcileV1StarterDocument } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/v1-starter-recipes';
import { SITE_BUILDER_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { applyOnboardingSitePresentation } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/site-document-presentation';
import { deriveSiteLibraryContext, deriveSitePlanToggles } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/site-library-context';
import { ONBOARDING_STORAGE_KEY, saveOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';

// Real application components, isolated synthetic identity and API responses.
// No customer data, account provisioning, messages or payments.
const params = new URLSearchParams(location.search);
const dashboard = params.get('screen') === 'dashboard';
const claimResponseLoss = params.get('scenario') === 'claim-response-loss';
const finalizationRecovery = params.get('scenario') === 'finalization-recovery';
const authContext = params.get('scenario') === 'auth-context';
const activationHandoff = params.get('scenario') === 'activation-handoff';
const accountScenario = finalizationRecovery || authContext || activationHandoff || params.get('scenario') === 'organization-focus';
if (activationHandoff) {
  const generation = Number(sessionStorage.getItem('fixture-activation-document') ?? '0') + 1;
  sessionStorage.setItem('fixture-activation-document', String(generation));
}
const claimedScenario = params.get('scenario') === 'claimed' || sessionStorage.getItem('fixture-claimed') === 'yes';
if (params.get('scenario') === 'claimed') {
  sessionStorage.setItem('fixture-claimed', 'yes');
}
if (!dashboard) {
  await Promise.all([
    import('../../../prototypes/site-builder-v2-booking-integration-lab/src/styles.css'),
    import('../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/standalone-fonts.css'),
    import('../../../prototypes/site-builder-v2-booking-integration-lab/src/ui/final-hybrid.css'),
    import('../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/onboarding.css'),
    import('../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/daniela-basics-booking.css'),
    import('../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/gallery-policy-polish.css'),
    import('../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/daniela-about-style.css'),
    import('../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/section-library.css'),
    import('../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/palette.css'),
    import('../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/style-colours-save.css'),
    import('../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/screen-seven-booking.css'),
    import('../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/screen-eight-about.css'),
    import('../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/booking-layout-screen.css'),
    import('../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/feedback/feedback.css'),
    import('@/features/onboarding-v1-integration/onboarding-integration.css'),
    import('@/features/onboarding-v1-integration/account-gate/account-gate.css'),
    import('../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/owner-chrome-polish.css'),
  ]);
}
if (!sessionStorage.getItem('fixture-seeded')) {
  const state = createDefaultOnboardingState();
  state.profile.businessName = 'Recovery test studio';
  state.profile.ownerName = 'Test owner';
  state.profile.businessStructure = 'solo';
  state.recipe.starter = 'one_page';
  state.recipe.starterDocumentSiteId = 'local-site';
  if (claimResponseLoss || accountScenario) {
    state.progress.currentScreen = 'save_progress';
  }
  saveOnboardingState(state);
  const starter = initializeStarter('one_page', { siteId: 'local-site', siteName: state.profile.businessName });
  // Seed the same accepted document a real owner already has on entering the
  // account gate. Otherwise returning to onboarding would first reconcile a
  // generic starter's empty optional sections, obscuring draft preservation.
  const document = activationHandoff
    ? reconcileV1StarterDocument(applyOnboardingSitePresentation(starter, {
      aboutPreset: state.recipe.aboutPreset,
      galleryLayout: state.gallery.layout,
    }), {
      context: deriveSiteLibraryContext(state, starter),
      toggles: deriveSitePlanToggles(state),
    }).document
    : starter;
  localStorage.setItem(SITE_BUILDER_STORAGE_KEY, JSON.stringify(document));
  saveOnboardingIntegrationFlow(claimedScenario
    ? {
        ...createOnboardingIntegrationFlow(),
        phase: 'plans',
        savedSiteOwnerId: 'different-fixture-owner',
        savedSite: { created: false, dashboardUrl: '/en/admin', media: { ready: 0, pending: 0, failed: 0 }, ownerCreatedServiceIds: [], revisionId: 'fixture-revision', serviceMenuApplied: false, serviceMappingIssues: [], claimId: 'fixture-claim', siteId: 'fixture-site', salonId: 'fixture-salon', salonSlug: 'fixture-salon', revision: 1, payloadFingerprint: '0000000000000000' },
      }
    : claimResponseLoss || accountScenario
      ? { ...createOnboardingIntegrationFlow(), phase: 'account' }
      : { ...createOnboardingIntegrationFlow(), phase: 'failure', errorCode: 'OWNER_ACCOUNT_CONFLICT', errorMessage: 'Sign in with the Luster account already connected to this email.' });
  sessionStorage.setItem('fixture-seeded', 'yes');
}
if (authContext && !sessionStorage.getItem('fixture-auth-context-original-draft')) {
  sessionStorage.setItem('fixture-auth-context-original-draft', JSON.stringify({
    state: localStorage.getItem(ONBOARDING_STORAGE_KEY),
    document: localStorage.getItem(SITE_BUILDER_STORAGE_KEY),
  }));
}

export function AuthContextMountProbe({ children }: { children: ReactNode }) {
  useEffect(() => {
    const generations = JSON.parse(sessionStorage.getItem('fixture-auth-context-mounts') ?? '[]') as number[];
    generations.push(Number(sessionStorage.getItem('fixture-auth-context-generation')));
    sessionStorage.setItem('fixture-auth-context-mounts', JSON.stringify(generations));
  }, []);
  return children;
}
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, options) => {
  const url = String(input);
  if (activationHandoff && url.startsWith('/api/')) {
    // Identify the actual originating document at the intercepted HTTP boundary.
    const headers = new Headers(options?.headers);
    headers.set('x-fixture-document', sessionStorage.getItem('fixture-activation-document')!);
    return nativeFetch(input, { ...options, headers });
  }
  if (accountScenario && url === '/api/onboarding/v1/organization') {
    // Count even caught provisioning attempts at the browser HTTP boundary.
    return nativeFetch(input, options);
  }
  if ((claimResponseLoss || accountScenario) && ['/api/onboarding/v1/claim', '/api/onboarding/v1/status', '/api/onboarding/v1/media/verify'].includes(url)) {
    // The browser regression supplies these responses at the HTTP boundary.
    return nativeFetch(input, options);
  }
  if (url === '/api/onboarding/v1/status') {
    return Response.json({ error: { code: 'BUSINESS_ACCESS_DENIED', message: 'Sign in to the account that saved this website.' } }, { status: 403 });
  }
  if (url === '/api/admin/auth/me') {
    return Response.json({ user: { id: 'fixture-admin', name: 'Test owner', email: 'owner@example.test', salons: [], availableSalons: [], hiddenSalons: [], isSuperAdmin: false } });
  }
  if (url === '/api/admin/auth/logout') {
    return Response.json({ success: true });
  }
  throw new Error(`Unexpected isolated fixture request: ${url}`);
};
createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale="en" messages={en}>
    <OwnerAdminFeatureFlagsContext.Provider value={{ onboardingV1IntegrationEnabled: true, sectionLibraryV1Enabled: false }}>
      {authContext
        ? (
            <StrictMode>
              <FreshOnboardingAuthBoundary>
                <AuthContextMountProbe><OnboardingV1Integration locale="en" /></AuthContextMountProbe>
              </FreshOnboardingAuthBoundary>
            </StrictMode>
          )
        : dashboard ? <AdminPage /> : <OnboardingV1Integration locale="en" />}
    </OwnerAdminFeatureFlagsContext.Provider>
  </NextIntlClientProvider>,
);
