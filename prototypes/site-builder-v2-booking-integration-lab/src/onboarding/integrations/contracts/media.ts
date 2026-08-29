import type {
  AssetRepository,
  AssetStorageErrorCode,
  ImageUploadErrorCode,
} from '../../../custom-design/assets';
import type { LocalImageReference } from '../../model/types';

export const ONBOARDING_MEDIA_STORAGE_UNAVAILABLE_MESSAGE =
  'This browser tab isn’t allowing Luster to save images. If you’re using a private tab, open this page in a regular tab and try again.';

export type OnboardingMediaOwner = 'gallery' | 'logo' | 'profile';

export type OnboardingMediaFailureStage =
  | 'decode'
  | 'normalization'
  | 'orientation'
  | 'signature'
  | 'storage_commit'
  | 'storage_stage'
  | 'thumbnail'
  | 'unknown'
  | 'validation';

export type OnboardingMediaFailureCode =
  | ImageUploadErrorCode
  | `storage_${AssetStorageErrorCode}`
  | 'unknown';

export type OnboardingMediaFailure = {
  code: OnboardingMediaFailureCode;
  fileName: string;
  index: number;
  message: string;
  retryable: boolean;
  stage: OnboardingMediaFailureStage;
};

export class OnboardingMediaError extends Error {
  readonly failure: OnboardingMediaFailure;

  constructor(failure: OnboardingMediaFailure, cause?: unknown) {
    super(failure.message, cause === undefined ? undefined : { cause });
    this.name = 'OnboardingMediaError';
    this.failure = failure;
  }
}

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
