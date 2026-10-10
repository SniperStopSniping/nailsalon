import '@/styles/global.css';
import '@/features/onboarding-v1-integration/onboarding-integration.css';

import { NextIntlClientProvider } from 'next-intl';
import { createRoot } from 'react-dom/client';

import type { OnboardingClaimSuccess } from '@/features/onboarding-v1-integration/contracts';
import { createOnboardingIntegrationFlow, saveOnboardingIntegrationFlow } from '@/features/onboarding-v1-integration/flow-storage';
import { OnboardingV1Integration } from '@/features/onboarding-v1-integration/OnboardingV1Integration';
import en from '@/locales/en.json';

import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { SITE_BUILDER_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { saveOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';

// Real integration and offer components; isolated identity and status response.
// No account, entitlement, credit or provider writes.
const warnings = new URLSearchParams(location.search).has('warnings');
const claim: OnboardingClaimSuccess = {
  claimId: 'fixture-claim',
  created: true,
  dashboardUrl: '/en/admin',
  media: { failed: 0, pending: 0, ready: 0 },
  ownerCreatedServiceIds: [],
  payloadFingerprint: '0123456789abcdef',
  revision: 1,
  revisionId: 'fixture-revision',
  salonId: 'fixture-salon',
  salonSlug: 'fixture-salon',
  serviceMappingIssues: [],
  serviceMenuApplied: true,
  siteId: '11111111-1111-4111-8111-111111111111',
  ...(warnings ? { preservedDashboardEdits: ['opening hours', 'service prices'] } : {}),
};
const state = createDefaultOnboardingState();
state.profile.businessName = 'Isla Nail Studio';
state.profile.ownerName = 'Test owner';
state.profile.businessStructure = 'solo';
state.progress.currentScreen = 'final_preview';
state.recipe.starter = 'one_page';
state.recipe.starterDocumentSiteId = 'local-site';
saveOnboardingState(state);
localStorage.setItem(SITE_BUILDER_STORAGE_KEY, JSON.stringify(initializeStarter('one_page', { siteId: 'local-site', siteName: state.profile.businessName })));
saveOnboardingIntegrationFlow({ ...createOnboardingIntegrationFlow(), phase: 'saved', mediaComplete: !warnings, savedSite: claim });
window.fetch = async (input) => {
  if (String(input) === '/api/onboarding/v1/status') {
    return Response.json({ data: { claim } });
  }
  throw new Error(`Unexpected isolated offer request: ${String(input)}`);
};
createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale="en" messages={en}>
    <OnboardingV1Integration locale="en" />
  </NextIntlClientProvider>,
);
