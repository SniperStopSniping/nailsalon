import '@/styles/global.css';

import { NextIntlClientProvider } from 'next-intl';
import { createRoot } from 'react-dom/client';

import { OwnerAdminFeatureFlagsContext } from '@/app/[locale]/admin/OwnerAdminFeatureFlags';
import AdminPage from '@/app/[locale]/admin/page';
import { createOnboardingIntegrationFlow, saveOnboardingIntegrationFlow } from '@/features/onboarding-v1-integration/flow-storage';
import { OnboardingV1Integration } from '@/features/onboarding-v1-integration/OnboardingV1Integration';
import en from '@/locales/en.json';

import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { SITE_BUILDER_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { saveOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';

// Real application components, isolated synthetic identity and API responses.
// No customer data, account provisioning, messages or payments.
const dashboard = new URLSearchParams(location.search).get('screen') === 'dashboard';
if (!dashboard) {
  await Promise.all([
    import('../../../prototypes/site-builder-v2-booking-integration-lab/src/styles.css'),
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
const state = createDefaultOnboardingState();
state.profile.businessName = 'Recovery test studio';
state.profile.ownerName = 'Test owner';
state.profile.businessStructure = 'solo';
state.recipe.starter = 'one_page';
state.recipe.starterDocumentSiteId = 'local-site';
saveOnboardingState(state);
localStorage.setItem(SITE_BUILDER_STORAGE_KEY, JSON.stringify(initializeStarter('one_page', { siteId: 'local-site', siteName: state.profile.businessName })));
saveOnboardingIntegrationFlow({ ...createOnboardingIntegrationFlow(), phase: 'failure', errorCode: 'OWNER_ACCOUNT_CONFLICT', errorMessage: 'Sign in with the Luster account already connected to this email.' });
window.fetch = async (input) => {
  const url = String(input);
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
      {dashboard ? <AdminPage /> : <OnboardingV1Integration locale="en" />}
    </OwnerAdminFeatureFlagsContext.Provider>
  </NextIntlClientProvider>,
);
