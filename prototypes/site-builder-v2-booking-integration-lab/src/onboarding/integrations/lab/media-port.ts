import { prepareImageAsset } from '../../../custom-design/assets/image-processing';
import type { AssetRepository } from '../../../custom-design/assets';
import {
  decodeOnboardingLocalImage,
  ONBOARDING_IMAGE_DECODE_ERROR,
} from '../../model/local-images';
import type { LocalImageReference } from '../../model/types';
import type {
  OnboardingMediaBatchResult,
  OnboardingMediaOwner,
  OnboardingMediaPort,
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

const ownerMessage = (error: unknown): string => {
  if (error instanceof Error) {
    if (/smaller|under|too (?:large|many)|PNG|JPG|WebP/iu.test(error.message)) {
      return error.message;
    }
  }
  return ONBOARDING_IMAGE_DECODE_ERROR;
};

const store = async (
  repository: AssetRepository,
  file: File,
  owner: OnboardingMediaOwner,
): Promise<LocalImageReference> => {
  // Keep the onboarding-specific byte limits and owner copy, then reuse the
  // final accepted decoder, thumbnail generator, and WebKit-safe repository.
  await decodeOnboardingLocalImage(file);
  const assetId = makeAssetId(owner);
  const prepared = await prepareImageAsset(file, { assetId });
  try {
    await repository.stage(prepared);
    const metadata = await repository.commit(assetId);
    return toReference(owner, metadata);
  } catch (error) {
    try {
      await repository.discard(assetId);
    } catch {
      // The original storage error is the useful owner-facing failure.
    }
    throw new Error(ownerMessage(error));
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
    for (const file of files) {
      try {
        accepted.push(await store(repository, file, owner));
      } catch (error) {
        failures.push({ fileName: file.name, message: ownerMessage(error) });
      }
    }
    return { accepted, failures };
  },
  storeOne: (repository, file, owner) => store(repository, file, owner),
};
