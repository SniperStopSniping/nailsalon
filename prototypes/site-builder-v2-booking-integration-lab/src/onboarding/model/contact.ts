import type {
  BusinessProfileDraft,
  PreferredContactMethod,
} from './types';

export type PublicContactPreview = {
  actionLabel: 'Book now' | 'Call' | 'Email' | 'Instagram' | 'Text';
  detail: string;
  method: PreferredContactMethod | 'booking';
};

export const getClientTextNumber = (
  profile: BusinessProfileDraft,
): string => profile.clientContact.useDifferentTextNumber
  ? profile.clientContact.differentTextNumber.trim()
  : profile.clientContact.primaryNumber.trim();

export const contactMethodHasValue = (
  profile: BusinessProfileDraft,
  method: PreferredContactMethod | null,
): boolean => {
  if (!method) return false;
  if (method === 'call') {
    return profile.clientContact.callEnabled
      && Boolean(profile.clientContact.primaryNumber.trim());
  }
  if (method === 'text') {
    return profile.clientContact.textEnabled && Boolean(getClientTextNumber(profile));
  }
  if (method === 'instagram') return Boolean(profile.instagram.trim());
  return Boolean(profile.email.trim());
};

const CONTACT_METHOD_ORDER: readonly PreferredContactMethod[] = [
  'text',
  'call',
  'instagram',
  'email',
];

export const getAvailableContactMethods = (
  profile: BusinessProfileDraft,
): PreferredContactMethod[] => CONTACT_METHOD_ORDER.filter(
  (method) => contactMethodHasValue(profile, method),
);

export const getCoherentPreferredContact = (
  profile: BusinessProfileDraft,
  requested = profile.preferredContact,
): PreferredContactMethod | null => requested && contactMethodHasValue(profile, requested)
  ? requested
  : getAvailableContactMethods(profile)[0] ?? null;

export const getPublicContactPreview = (
  profile: BusinessProfileDraft,
): PublicContactPreview | null => {
  if (profile.bookingOnlyContact) {
    return {
      actionLabel: 'Book now',
      detail: 'Booking is the best way to reach us',
      method: 'booking',
    };
  }

  const method = getCoherentPreferredContact(profile);
  if (!method) return null;
  if (method === 'call') {
    return {
      actionLabel: 'Call',
      detail: profile.clientContact.primaryNumber.trim(),
      method,
    };
  }
  if (method === 'text') {
    return { actionLabel: 'Text', detail: getClientTextNumber(profile), method };
  }
  if (method === 'instagram') {
    return { actionLabel: 'Instagram', detail: profile.instagram.trim(), method };
  }
  return { actionLabel: 'Email', detail: profile.email.trim(), method };
};
