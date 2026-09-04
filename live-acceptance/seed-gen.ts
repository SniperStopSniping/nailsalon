/**
 * Generates a realistic accepted-draft localStorage seed using the real
 * onboarding modules, so responsive checks can open the account gate
 * directly without replaying the whole flow. Output: JSON map of
 * localStorage entries on stdout.
 */
import { initializeStarter } from '../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { SITE_BUILDER_STORAGE_KEY } from '../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { createDefaultOnboardingState } from '../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import { saveOnboardingState } from '../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';
import {
  createOnboardingIntegrationFlow,
  ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY,
  saveOnboardingIntegrationFlow,
} from '../src/features/onboarding-v1-integration/flow-storage';

const backing = new Map<string, string>();
const storage = {
  getItem: (key: string) => backing.get(key) ?? null,
  removeItem: (key: string) => {
    backing.delete(key);
  },
  setItem: (key: string, value: string) => {
    backing.set(key, value);
  },
};

(globalThis as Record<string, unknown>).window = { localStorage: storage };
(globalThis as Record<string, unknown>).localStorage = storage;

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

const saved = saveOnboardingState(state, storage as never);
if (!saved.success) {
  throw new Error('seed state failed validation');
}
storage.setItem(SITE_BUILDER_STORAGE_KEY, JSON.stringify(document));

const flow = { ...createOnboardingIntegrationFlow(), phase: 'account' as const };
const flowSaved = saveOnboardingIntegrationFlow(flow);
if (!flowSaved) {
  storage.setItem(ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY, JSON.stringify(flow));
}

process.stdout.write(JSON.stringify(Object.fromEntries(backing.entries())));
