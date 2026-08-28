import type { LocationDraft } from './types';

export type PublicLocationPreview = {
  detail: string | null;
  directionsTarget: string | null;
  primary: string;
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
