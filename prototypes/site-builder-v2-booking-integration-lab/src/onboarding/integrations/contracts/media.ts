import type { AssetRepository } from '../../../custom-design/assets';
import type { LocalImageReference } from '../../model/types';

export type OnboardingMediaOwner = 'gallery' | 'logo' | 'profile';

export type OnboardingMediaFailure = {
  fileName: string;
  message: string;
};

export type OnboardingMediaBatchResult = {
  accepted: LocalImageReference[];
  failures: OnboardingMediaFailure[];
};

/**
 * Replaceable UX-Lab port over the accepted shared browser asset repository.
 * It stores no image bytes in the onboarding profile or localStorage.
 */
export type OnboardingMediaPort = {
  deleteOwned: (
    repository: AssetRepository,
    images: readonly LocalImageReference[],
  ) => Promise<Error[]>;
  storeBatch: (
    repository: AssetRepository,
    files: readonly File[],
    owner: OnboardingMediaOwner,
  ) => Promise<OnboardingMediaBatchResult>;
  storeOne: (
    repository: AssetRepository,
    file: File,
    owner: Exclude<OnboardingMediaOwner, 'gallery'>,
  ) => Promise<LocalImageReference>;
};
