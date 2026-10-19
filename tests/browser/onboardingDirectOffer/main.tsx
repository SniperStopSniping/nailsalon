import '../../../prototypes/site-builder-v2-booking-integration-lab/src/styles.css';
import '../../../prototypes/site-builder-v2-booking-integration-lab/src/ui/final-hybrid.css';
import '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/onboarding.css';
import '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/daniela-basics-booking.css';
import '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/gallery-policy-polish.css';
import '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/daniela-about-style.css';
import '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/section-library.css';
import '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/palette.css';
import '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/style-colours-save.css';
import '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/screen-seven-booking.css';
import '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/screen-eight-about.css';
import '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/booking-layout-screen.css';
import '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/feedback/feedback.css';
import '@/features/onboarding-v1-integration/onboarding-integration.css';
import '@/features/onboarding-v1-integration/account-gate/account-gate.css';
import '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/owner-chrome-polish.css';
import '@/styles/global.css';
import './product-fonts.css';

import { NextIntlClientProvider } from 'next-intl';
import { createRoot } from 'react-dom/client';

import { AiWebsiteIntro } from '@/features/business-setup/AiWebsiteIntro';
import { OpenAiBuilder } from '@/features/business-setup/OpenAiBuilder';
import type { OnboardingClaimSuccess } from '@/features/onboarding-v1-integration/contracts';
import { createOnboardingIntegrationFlow, saveOnboardingIntegrationFlow } from '@/features/onboarding-v1-integration/flow-storage';
import { OnboardingV1Integration } from '@/features/onboarding-v1-integration/OnboardingV1Integration';
import en from '@/locales/en.json';

import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { SITE_BUILDER_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { ONBOARDING_STORAGE_KEY, saveOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';

// Real integration and offer components; isolated identity and status response.
// No account, entitlement, credit or provider writes.
const startup = new URLSearchParams(location.search).has('startup');
const aiBuilder = new URLSearchParams(location.search).has('aiBuilder');
const aiIntro = new URLSearchParams(location.search).has('aiIntro');
const aiOwner = new URLSearchParams(location.search).has('aiOwner');
if (new URLSearchParams(location.search).has('productFonts')) {
  document.documentElement.dataset.productFonts = 'true';
} else {
  await import('../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/standalone-fonts.css');
}
const warnings = new URLSearchParams(location.search).has('warnings');
const resume = new URLSearchParams(location.search).get('resume');
if (startup && (resume === 'hours' || resume === 'location_contact' || resume === 'site_style') && !localStorage.getItem(ONBOARDING_STORAGE_KEY)) {
  const { createDanielaFixtureState } = await import('../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/fixtures');
  const state = createDanielaFixtureState();
  state.progress.currentScreen = resume;
  state.progress.lastActiveScreen = resume;
  state.progress.screenHistory = resume === 'site_style' ? ['starter', 'hours', resume] : ['starter', resume];
  state.progress.visitedScreens = [...state.progress.screenHistory];
  state.progress.sessionStatus = 'active';
  state.recipe.starterDocumentSiteId = 'local-resumed-site';
  saveOnboardingState(state);
  localStorage.setItem(SITE_BUILDER_STORAGE_KEY, JSON.stringify(initializeStarter('quick_book', { siteId: 'local-resumed-site', siteName: state.profile.businessName })));
}
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
if (!startup) {
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
}
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, options) => {
  if (aiIntro) {
    return nativeFetch(input, options);
  }
  if (String(input) === '/api/onboarding/v1/status') {
    return Response.json({ data: { claim } });
  }
  throw new Error(`Unexpected isolated offer request: ${String(input)}`);
};
createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale="en" messages={en}>
    {aiIntro
      ? (
          <AiWebsiteIntro locale="en" showGetStarted={!aiOwner}>
            {aiOwner && (
              <OpenAiBuilder
                locale="en"
                onNavigate={(url) => {
                  document.body.dataset.aiDestination = url;
                }}
              />
            )}
          </AiWebsiteIntro>
        )
      : <OnboardingV1Integration locale="en" aiBuilderEnabled={aiBuilder} />}
  </NextIntlClientProvider>,
);
