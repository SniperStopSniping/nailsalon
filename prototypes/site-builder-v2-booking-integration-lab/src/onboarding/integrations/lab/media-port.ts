import {
  AssetStorageError,
  ImageUploadError,
  prepareImageAsset,
  type AssetRepository,
  type ImageUploadErrorCode,
} from '../../../custom-design/assets';
import { normalizeOnboardingLocalImage } from '../../model/local-images';
import type { LocalImageReference } from '../../model/types';
import {
  OnboardingMediaError,
  ONBOARDING_MEDIA_STORAGE_UNAVAILABLE_MESSAGE,
  type OnboardingMediaBatchResult,
  type OnboardingMediaFailure,
  type OnboardingMediaFailureStage,
  type OnboardingMediaOwner,
  type OnboardingMediaPort,
} from '../contracts/media';

const makeAssetId = (owner: OnboardingMediaOwner): string =>
  `onboarding_${owner}_${Date.now()}_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

const toReference = (
  owner: OnboardingMediaOwner,
  metadata: Awaited<ReturnType<AssetRepository['commit']>>,
): LocalImageReference => ({
  altText: owner === 'profile'
    ? 'Business owner portrait'
    : owner === 'logo'
      ? 'Business logo'
      : 'Uploaded portfolio work',
  fileName: metadata.fileName,
  height: metadata.height,
  id: `${owner}_${metadata.id}`,
  mimeType: metadata.mimeType,
  source: 'indexed_db',
  storageId: metadata.id,
  width: metadata.width,
});

const stageForUploadCode = (
  code: ImageUploadErrorCode,
): OnboardingMediaFailureStage => {
  switch (code) {
    case 'corrupt_image':
    case 'signature_mismatch':
      return 'signature';
    case 'decode_failed':
    case 'unsupported_heic':
      return 'decode';
    case 'normalization_failed':
      return 'normalization';
    case 'orientation_failed':
      return 'orientation';
    case 'thumbnail_failed':
      return 'thumbnail';
    default:
      return 'validation';
  }
};

const ownerNoun = (owner: OnboardingMediaOwner): string =>
  owner === 'logo' ? 'logo' : 'photo';

const imageOwnerMessage = (
  code: ImageUploadErrorCode,
  owner: OnboardingMediaOwner,
): string => {
  const noun = ownerNoun(owner);
  switch (code) {
    case 'unsupported_heic':
      return 'This iPhone photo format isn’t supported in this browser. Choose a JPG, PNG, or WebP image.';
    case 'unsupported_type':
      return 'Choose a JPG, PNG, or WebP image.';
    case 'empty_file':
      return `This ${noun} file is empty. Choose another image.`;
    case 'file_too_large':
    case 'section_too_large':
      return `This ${noun} is too large to save here. Choose a smaller image.`;
    case 'dimensions_too_large':
      return `This ${noun} is too large to process safely. Choose a smaller copy.`;
    case 'invalid_capacity':
    case 'invalid_file_size':
      return `This ${noun} has an invalid file size. Choose another copy.`;
    case 'signature_mismatch':
      return `This ${noun}’s file type doesn’t match its contents. Choose another copy.`;
    case 'orientation_failed':
      return `This ${noun}’s orientation couldn’t be read. Try selecting it again or choose another copy.`;
    case 'normalization_failed':
      return `This ${noun} couldn’t be prepared for your site. Try selecting it again or choose another copy.`;
    case 'thumbnail_failed':
      return `A preview couldn’t be created for this ${noun}. Try selecting it again or choose another copy.`;
    case 'corrupt_image':
    case 'decode_failed':
      return `This ${noun} couldn’t be read. Try selecting it again or choose another copy.`;
    case 'too_many_images':
      return 'No more images can be added here.';
  }
};

const storageOwnerMessage = (
  error: AssetStorageError,
): string => {
  switch (error.code) {
    case 'security':
    case 'unavailable':
      return ONBOARDING_MEDIA_STORAGE_UNAVAILABLE_MESSAGE;
    case 'quota_exceeded':
      return 'This browser doesn’t have enough storage available for the image. Remove another image or try a smaller file.';
    case 'blocked':
      return 'Image storage is busy in another Luster tab. Close the other tab and try again.';
    case 'closed':
      return 'Image storage closed before the photo could be saved. Reload the page and try again.';
    default:
      return 'The image was read, but couldn’t be saved on this device. Try again in a regular browser tab.';
  }
};

const uploadRetryable = (code: ImageUploadErrorCode): boolean => ![
  'dimensions_too_large',
  'empty_file',
  'file_too_large',
  'invalid_capacity',
  'invalid_file_size',
  'section_too_large',
  'signature_mismatch',
  'too_many_images',
  'unsupported_heic',
  'unsupported_type',
].includes(code);

const mediaFailure = (
  error: unknown,
  file: File,
  owner: OnboardingMediaOwner,
  index: number,
  stage?: 'storage_commit' | 'storage_stage',
): OnboardingMediaFailure => {
  if (error instanceof OnboardingMediaError) return error.failure;
  if (error instanceof AssetStorageError) {
    return {
      code: `storage_${error.code}`,
      fileName: file.name,
      index,
      message: storageOwnerMessage(error),
      retryable: true,
      stage: stage ?? 'unknown',
    };
  }
  if (error instanceof ImageUploadError) {
    return {
      code: error.code,
      fileName: file.name,
      index,
      message: imageOwnerMessage(error.code, owner),
      retryable: uploadRetryable(error.code),
      stage: stageForUploadCode(error.code),
    };
  }
  if (stage) {
    return {
      code: 'storage_unknown',
      fileName: file.name,
      index,
      message: 'The image was read, but couldn’t be saved on this device. Try again in a regular browser tab.',
      retryable: true,
      stage,
    };
  }
  return {
    code: 'unknown',
    fileName: file.name,
    index,
    message: `This ${ownerNoun(owner)} couldn’t be processed. Try selecting it again or choose another copy.`,
    retryable: true,
    stage: stage ?? 'unknown',
  };
};

const discardAfterFailure = async (
  repository: AssetRepository,
  assetId: string,
): Promise<void> => {
  try {
    await repository.discard(assetId);
  } catch {
    // Preserve the original typed failure. Reset and stale-stage reclamation
    // remain the bounded cleanup fallback for a repository that is unavailable.
  }
};

const store = async (
  repository: AssetRepository,
  file: File,
  owner: OnboardingMediaOwner,
  index: number,
): Promise<LocalImageReference> => {
  const assetId = makeAssetId(owner);
  let prepared: Awaited<ReturnType<typeof prepareImageAsset>>;
  try {
    const normalized = await normalizeOnboardingLocalImage(file);
    prepared = await prepareImageAsset(normalized, {
      assetId,
      requireThumbnail: true,
    });
  } catch (error) {
    throw new OnboardingMediaError(
      mediaFailure(error, file, owner, index),
      error,
    );
  }

  try {
    await repository.stage(prepared);
  } catch (error) {
    await discardAfterFailure(repository, assetId);
    throw new OnboardingMediaError(
      mediaFailure(error, file, owner, index, 'storage_stage'),
      error,
    );
  }

  try {
    const metadata = await repository.commit(assetId);
    return toReference(owner, metadata);
  } catch (error) {
    await discardAfterFailure(repository, assetId);
    throw new OnboardingMediaError(
      mediaFailure(error, file, owner, index, 'storage_commit'),
      error,
    );
  }
};

export const LAB_ONBOARDING_MEDIA_PORT: OnboardingMediaPort = {
  deleteOwned: async (repository, images) => {
    const errors: Error[] = [];
    for (const storageId of new Set(images.flatMap((image) =>
      image.source === 'indexed_db' && image.storageId ? [image.storageId] : []))) {
      try {
        await repository.delete(storageId);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error('An earlier image could not be removed.'));
      }
    }
    return errors;
  },
  storeBatch: async (repository, files, owner): Promise<OnboardingMediaBatchResult> => {
    const accepted: LocalImageReference[] = [];
    const failures: OnboardingMediaBatchResult['failures'] = [];
    for (const [index, file] of files.entries()) {
      try {
        accepted.push(await store(repository, file, owner, index));
      } catch (error) {
        failures.push(mediaFailure(error, file, owner, index));
      }
    }
    return { accepted, failures };
  },
  storeOne: (repository, file, owner) => store(repository, file, owner, 0),
};
