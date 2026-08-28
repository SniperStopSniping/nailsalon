import { resolveCustomDesignAction } from '../../custom-design/model/actions';
import type { CustomDesignAction } from '../../custom-design/model/types';
import type {
  BusinessProfileDraft,
  PreferredContactMethod,
} from './types';

export type PublicContactPreview = {
  actionLabel: 'Book now' | 'Call' | 'Email' | 'Instagram' | 'Text';
  detail: string;
  method: PreferredContactMethod | 'booking';
};

export type PublicContactAction = PublicContactPreview & {
  external: boolean;
  href: string;
  preferred: boolean;
  rel?: 'noopener noreferrer';
  target?: '_blank';
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

const getResolvedContactAction = (
  profile: BusinessProfileDraft,
  method: PreferredContactMethod,
  preferred: boolean,
): PublicContactAction | null => {
  let action: CustomDesignAction;
  let actionLabel: PublicContactPreview['actionLabel'];
  let detail: string;
  if (method === 'call') {
    detail = profile.clientContact.primaryNumber.trim();
    actionLabel = 'Call';
    action = { destination: { phoneNumber: detail }, type: 'call' };
  } else if (method === 'text') {
    detail = getClientTextNumber(profile);
    actionLabel = 'Text';
    action = { destination: { phoneNumber: detail }, type: 'text' };
  } else if (method === 'instagram') {
    detail = profile.instagram.trim();
    actionLabel = 'Instagram';
    action = { destination: { username: detail }, type: 'instagram' };
  } else {
    detail = profile.email.trim();
    actionLabel = 'Email';
    action = { destination: { email: detail }, type: 'email' };
  }
  const resolution = resolveCustomDesignAction(action);
  if (resolution.status !== 'resolved') return null;
  return {
    actionLabel,
    detail,
    external: resolution.external,
    href: resolution.href,
    method,
    preferred,
    ...(resolution.rel ? { rel: resolution.rel } : {}),
    ...(resolution.target ? { target: resolution.target } : {}),
  };
};

/** All safe public contact actions, with the preferred channel first. */
export const getPublicContactActions = (
  profile: BusinessProfileDraft,
): PublicContactAction[] => {
  if (profile.bookingOnlyContact) {
    const resolution = resolveCustomDesignAction(
      { type: 'start_booking' },
      { bookingHref: '#booking' },
    );
    return resolution.status === 'resolved'
      ? [{
          actionLabel: 'Book now',
          detail: 'Booking is the best way to reach us',
          external: resolution.external,
          href: resolution.href,
          method: 'booking',
          preferred: true,
        }]
      : [];
  }

  const preferred = getCoherentPreferredContact(profile);
  return [...getAvailableContactMethods(profile)]
    .sort((left, right) => Number(right === preferred) - Number(left === preferred))
    .flatMap((method) => {
      const action = getResolvedContactAction(profile, method, method === preferred);
      return action ? [action] : [];
    });
};

export const getPublicContactPreview = (
  profile: BusinessProfileDraft,
): PublicContactPreview | null => {
  const action = getPublicContactActions(profile)[0];
  return action
    ? { actionLabel: action.actionLabel, detail: action.detail, method: action.method }
    : null;
};
