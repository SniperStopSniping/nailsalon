/**
 * Portfolio eligibility — two predicates, deliberately not one.
 *
 * A photo can be visible on the salon's own profile while being excluded from
 * Discover. Collapsing this into a single `publicEligible` flag would mean
 * that switching a photo out of Discover also pulled it from the owner's
 * profile grid, which is not what the owner asked for. So:
 *
 *   profileEligible  = ownerVisible && planEligible && moderationAllowed
 *                      && businessEligible
 *
 *   discoverEligible = profileEligible && businessDiscoverEnabled
 *                      && discoverIncluded && discoverMetadataComplete
 *                      && discoverCropReady && locationEligible
 *
 * The profile grid reads `profileEligible`. Nearby thumbnails, the swipe deck
 * and Saved Nails rehydration read `discoverEligible`.
 *
 * `planEligible` is DERIVED, never stored. When an allowance shrinks, the
 * first N photos in owner-managed order stay eligible and the rest become
 * "retained over allowance" — nothing is deleted, and no owner-controlled
 * flag is rewritten. Reordering changes which photos survive; upgrading or
 * deleting restores eligibility automatically. That is what makes a downgrade
 * non-destructive and reversible.
 */

import type {
  DiscoverNailLength,
  DiscoverServiceFamily,
} from '@/libs/discoverTaxonomy';
import { UNLIMITED_PORTFOLIO_PHOTOS } from '@/libs/portfolioLimits';
import type { PortfolioModerationState } from '@/models/Schema';

export type EligibilityPhoto = {
  id: string;
  sortOrder: number;
  createdAt: Date;
  ownerVisible: boolean;
  discoverIncluded: boolean;
  serviceFamily: DiscoverServiceFamily;
  nailLength: DiscoverNailLength;
  moderationState: PortfolioModerationState;
  deletedAt: Date | null;
  cropX: string | number | null;
  cropY: string | number | null;
  cropWidth: string | number | null;
  cropHeight: string | number | null;
};

export type EligibilityContext = {
  /** Salon is active, published, not soft-deleted and not suspended. */
  businessEligible: boolean;
  /** Discover is enabled for the business and not administratively suspended. */
  businessDiscoverEnabled: boolean;
  /** Families the salon can currently actually be booked for. */
  bookableFamilies: ReadonlySet<DiscoverServiceFamily>;
  /**
   * Whether the photo's location is usable for Discover.
   *
   * PR1 has no geo model, so there is nothing to evaluate yet and callers pass
   * `true`. PR3 introduces the public discovery point and radius filtering and
   * becomes the real source of this value. It is a required field precisely so
   * that PR3 cannot forget to supply it.
   */
  locationEligible: boolean;
};

export type PhotoEligibility = {
  photoId: string;
  planEligible: boolean;
  profileEligible: boolean;
  discoverEligible: boolean;
  /** Stored, but outside the current allowance — retained, never deleted. */
  retainedOverAllowance: boolean;
  discoverMetadataComplete: boolean;
  discoverCropReady: boolean;
};

/**
 * Owner-managed order: explicit sort order first, then oldest-first, then id
 * so the result is total and stable. Determinism matters — this ordering
 * decides which photos survive a downgrade.
 */
export function comparePortfolioOrder(a: EligibilityPhoto, b: EligibilityPhoto): number {
  if (a.sortOrder !== b.sortOrder) {
    return a.sortOrder - b.sortOrder;
  }

  const at = a.createdAt.getTime();
  const bt = b.createdAt.getTime();

  if (at !== bt) {
    return at - bt;
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function hasDiscoverCrop(photo: EligibilityPhoto): boolean {
  return (
    photo.cropX !== null
    && photo.cropY !== null
    && photo.cropWidth !== null
    && photo.cropHeight !== null
  );
}

export function hasCompleteDiscoverMetadata(
  photo: EligibilityPhoto,
  bookableFamilies: ReadonlySet<DiscoverServiceFamily>,
): boolean {
  if (photo.serviceFamily === 'unspecified' || photo.nailLength === 'unspecified') {
    return false;
  }

  // A family the salon can no longer be booked for stops being Discover-usable.
  // The photo is not deleted or hidden — it simply cannot advertise work the
  // business no longer sells until it is retagged or the service returns.
  return bookableFamilies.has(photo.serviceFamily);
}

/**
 * The set of photo ids inside the current allowance, in owner order.
 * Soft-deleted photos never consume allowance.
 */
export function planEligiblePhotoIds(
  photos: readonly EligibilityPhoto[],
  allowanceMax: number,
): Set<string> {
  const stored = photos
    .filter(photo => photo.deletedAt === null)
    .slice()
    .sort(comparePortfolioOrder);

  if (allowanceMax === UNLIMITED_PORTFOLIO_PHOTOS) {
    return new Set(stored.map(photo => photo.id));
  }

  if (allowanceMax <= 0) {
    return new Set();
  }

  return new Set(stored.slice(0, allowanceMax).map(photo => photo.id));
}

export function computePortfolioEligibility(
  photos: readonly EligibilityPhoto[],
  allowanceMax: number,
  context: EligibilityContext,
): Map<string, PhotoEligibility> {
  const planEligibleIds = planEligiblePhotoIds(photos, allowanceMax);
  const result = new Map<string, PhotoEligibility>();

  for (const photo of photos) {
    const deleted = photo.deletedAt !== null;
    const planEligible = planEligibleIds.has(photo.id);
    const moderationAllowsProfile = photo.moderationState !== 'disabled';
    const moderationAllowsDiscover = photo.moderationState === 'allowed';

    const profileEligible
      = !deleted
      && photo.ownerVisible
      && planEligible
      && moderationAllowsProfile
      && context.businessEligible;

    const discoverMetadataComplete = hasCompleteDiscoverMetadata(
      photo,
      context.bookableFamilies,
    );
    const discoverCropReady = hasDiscoverCrop(photo);

    const discoverEligible
      = profileEligible
      && moderationAllowsDiscover
      && context.businessDiscoverEnabled
      && photo.discoverIncluded
      && discoverMetadataComplete
      && discoverCropReady
      && context.locationEligible;

    result.set(photo.id, {
      photoId: photo.id,
      planEligible,
      profileEligible,
      discoverEligible,
      retainedOverAllowance: !deleted && !planEligible,
      discoverMetadataComplete,
      discoverCropReady,
    });
  }

  return result;
}

export type DiscoverReadiness = {
  storedPhotos: number;
  profileEligiblePhotos: number;
  discoverEligiblePhotos: number;
  retainedOverAllowance: number;
  missingCrop: number;
  missingServiceFamily: number;
  missingNailLength: number;
  /** Tagged with a family the salon can no longer be booked for. */
  unbookableFamily: number;
  discoverEnabled: boolean;
};

/**
 * Owner-facing readiness summary.
 *
 * This is DATA ONLY — counts and reasons an owner can act on. It deliberately
 * renders no nearby card, swipe card or profile preview: those surfaces are
 * built in later Discover PRs and cannot be previewed before they exist.
 */
export function summarizeDiscoverReadiness(
  photos: readonly EligibilityPhoto[],
  allowanceMax: number,
  context: EligibilityContext,
): DiscoverReadiness {
  const eligibility = computePortfolioEligibility(photos, allowanceMax, context);
  const stored = photos.filter(photo => photo.deletedAt === null);

  let profileEligiblePhotos = 0;
  let discoverEligiblePhotos = 0;
  let retainedOverAllowance = 0;
  let missingCrop = 0;
  let missingServiceFamily = 0;
  let missingNailLength = 0;
  let unbookableFamily = 0;

  for (const photo of stored) {
    const entry = eligibility.get(photo.id);

    if (!entry) {
      continue;
    }

    if (entry.profileEligible) {
      profileEligiblePhotos += 1;
    }

    if (entry.discoverEligible) {
      discoverEligiblePhotos += 1;
    }

    if (entry.retainedOverAllowance) {
      retainedOverAllowance += 1;
    }

    if (!entry.discoverCropReady) {
      missingCrop += 1;
    }

    if (photo.serviceFamily === 'unspecified') {
      missingServiceFamily += 1;
    } else if (!context.bookableFamilies.has(photo.serviceFamily)) {
      unbookableFamily += 1;
    }

    if (photo.nailLength === 'unspecified') {
      missingNailLength += 1;
    }
  }

  return {
    storedPhotos: stored.length,
    profileEligiblePhotos,
    discoverEligiblePhotos,
    retainedOverAllowance,
    missingCrop,
    missingServiceFamily,
    missingNailLength,
    unbookableFamily,
    discoverEnabled: context.businessDiscoverEnabled,
  };
}
