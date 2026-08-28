import { resolveCustomDesignAction } from '../../custom-design/model/actions';
import type { LocationDraft } from './types';

export type PublicLocationPreview = {
  detail: string | null;
  directionsTarget: string | null;
  primary: string;
};

export type PublicDirectionsAction = {
  accessibleLabel: string;
  href: string;
  rel: 'noopener noreferrer';
  target: '_blank';
};

export const getPublicLocationPreview = (
  location: LocationDraft,
): PublicLocationPreview => {
  const area = location.cityOrArea.trim();
  const exactAddress = location.exactAddress.trim();

  if (location.addressVisibility === 'public' && exactAddress) {
    return {
      detail: area && area !== exactAddress ? area : null,
      directionsTarget: exactAddress,
      primary: exactAddress,
    };
  }

  if (location.addressVisibility === 'after_booking') {
    return {
      detail: exactAddress ? 'Exact address shared after booking.' : 'Location shared after booking.',
      directionsTarget: null,
      primary: area,
    };
  }

  return {
    detail: null,
    directionsTarget: location.addressVisibility === 'public'
      && location.allowGeneralAreaDirections
      && area
      ? area
      : null,
    primary: area,
  };
};

/** Resolves Directions through the same validated customer-action path as Custom Design. */
export const getPublicDirectionsAction = (
  location: LocationDraft,
): PublicDirectionsAction | null => {
  const target = getPublicLocationPreview(location).directionsTarget;
  if (!target) return null;
  const resolution = resolveCustomDesignAction({
    destination: { address: target },
    type: 'directions',
  });
  if (
    resolution.status !== 'resolved'
    || resolution.target !== '_blank'
    || resolution.rel !== 'noopener noreferrer'
  ) return null;
  return {
    accessibleLabel: `Directions to ${target}`,
    href: resolution.href,
    rel: resolution.rel,
    target: resolution.target,
  };
};
