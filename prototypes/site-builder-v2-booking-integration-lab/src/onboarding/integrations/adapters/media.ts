import type { CustomDesignAssetUrlPair } from '../../../custom-design/integration/CustomDesignAssetProvider';
import type { LocalImageReference } from '../../model/types';
import { LAB_ONBOARDING_MEDIA_PORT } from '../lab/media-port';

/** Lab binding. Production integration replaces this binding, not its consumers. */
export const onboardingMediaPort = LAB_ONBOARDING_MEDIA_PORT;

export type OnboardingImageResolution =
  | { status: 'empty'; url: null }
  | { status: 'error'; error: Error; url: null }
  | { status: 'loading'; url: null }
  | { status: 'missing'; url: null }
  | { status: 'ready'; url: string };

const resolutionError = (
  pair: CustomDesignAssetUrlPair,
): Error | null => {
  const failed = [pair.thumbnail, pair.original].find((state) => (
    state.status === 'error' || state.status === 'unavailable'
  ));
  return failed && (failed.status === 'error' || failed.status === 'unavailable')
    ? failed.error
    : null;
};

/**
 * Keeps each Business Profile image honest while its own repository lease is
 * loading, missing, or unavailable. Callers must pass the explicit role field;
 * this resolver never searches for another image to use as a fallback.
 */
export const resolveOnboardingImage = (
  image: LocalImageReference | undefined,
  assets: ReadonlyMap<string, CustomDesignAssetUrlPair>,
): OnboardingImageResolution => {
  if (!image) return { status: 'empty', url: null };
  if (image.source === 'data_url' || image.source === 'missing') {
    return { status: 'missing', url: null };
  }
  if (image.previewUrl) return { status: 'ready', url: image.previewUrl };
  if (!image.storageId) return { status: 'missing', url: null };

  const pair = assets.get(image.storageId);
  if (!pair) return { status: 'loading', url: null };
  if (pair.thumbnail.status === 'ready') {
    return { status: 'ready', url: pair.thumbnail.url };
  }
  if (pair.original.status === 'ready') {
    return { status: 'ready', url: pair.original.url };
  }
  if (pair.thumbnail.status === 'loading' || pair.original.status === 'loading') {
    return { status: 'loading', url: null };
  }

  const error = resolutionError(pair);
  return error
    ? { error, status: 'error', url: null }
    : { status: 'missing', url: null };
};

/**
 * Resolves presentation URLs through the shared asset provider. Fixture URLs
 * remain supported, while persisted owner images never place bytes in the
 * onboarding document or localStorage.
 */
export const resolveOnboardingImageUrl = (
  image: LocalImageReference | undefined,
  assets: ReadonlyMap<string, CustomDesignAssetUrlPair>,
): string | null => {
  const resolution = resolveOnboardingImage(image, assets);
  return resolution.status === 'ready' ? resolution.url : null;
};
