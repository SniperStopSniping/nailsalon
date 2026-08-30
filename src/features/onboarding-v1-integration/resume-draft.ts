import type { SiteBuilderDocument } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/types';
import type { OnboardingLabState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/types';
import type { SavedPreviewMediaRecord } from './saved-preview';

/**
 * Plain-data Server Component payload for resuming one exact account-backed
 * draft. It contains customer-safe media endpoints, never storage keys,
 * provider credentials, membership data, or a reusable authorization token.
 */
export type InitialOnboardingResumeDraft = {
  document: SiteBuilderDocument;
  media: SavedPreviewMediaRecord[];
  payloadFingerprint: string;
  siteId: string;
  state: OnboardingLabState;
  verifiedRevision: number;
};
