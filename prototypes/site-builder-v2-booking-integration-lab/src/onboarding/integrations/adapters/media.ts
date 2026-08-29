import type { CustomDesignAssetUrlPair } from '../../../custom-design/integration/CustomDesignAssetProvider';
import type { LocalImageReference } from '../../model/types';
import { LAB_ONBOARDING_MEDIA_PORT } from '../lab/media-port';

/** Lab binding. Production integration replaces this binding, not its consumers. */
export const onboardingMediaPort = LAB_ONBOARDING_MEDIA_PORT;

/**
 * Resolves presentation URLs through the shared asset provider. Fixture URLs
 * remain supported, while persisted owner images never place bytes in the
 * onboarding document or localStorage.
 */
export const resolveOnboardingImageUrl = (
  image: LocalImageReference | undefined,
  assets: ReadonlyMap<string, CustomDesignAssetUrlPair>,
): string | null => {
  if (!image) return null;
  if (image.source === 'data_url' || image.source === 'missing') return null;
  if (image.previewUrl) return image.previewUrl;
  if (!image.storageId) return null;
  const pair = assets.get(image.storageId);
  if (pair?.thumbnail.status === 'ready') return pair.thumbnail.url;
  if (pair?.original.status === 'ready') return pair.original.url;
  return null;
};
