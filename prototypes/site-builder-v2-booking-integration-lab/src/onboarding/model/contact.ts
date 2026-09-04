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

export type InstagramUsernameResolution =
  | { status: 'empty'; username: null }
  | { error: string; status: 'invalid'; username: null }
  | { status: 'resolved'; username: string };

const INSTAGRAM_USERNAME_PATTERN = /^[\w.]{1,30}$/u;
const INSTAGRAM_PROFILE_PREFIX = /^(?:https:\/\/)?(?:www\.)?instagram\.com\//iu;
const INSTAGRAM_LIKE_PREFIX = /^(?:https?:\/\/)?(?:www\.)?instagram\.com(?:\/|$)/iu;

/**
 * The single onboarding interpretation of an Instagram profile value. Owner
 * fields, contact completeness, preferred-contact selection, readiness, and
 * public links all call this resolver so an invalid value can never appear
 * configured while being suppressed from the customer site.
 */
export const resolveInstagramUsername = (
  value: unknown,
): InstagramUsernameResolution => {
  if (typeof value !== 'string') {
    return { status: 'empty', username: null };
  }
  const input = value.trim();
  if (!input) {
    return { status: 'empty', username: null };
  }

  let username = input;
  if (INSTAGRAM_PROFILE_PREFIX.test(username)) {
    username = username.replace(INSTAGRAM_PROFILE_PREFIX, '');
    if (username.endsWith('/')) {
      username = username.slice(0, -1);
    }
    if (!username || /[/?#]/u.test(username)) {
      return {
        error: 'Enter only your Instagram username, such as islanailstudio.',
        status: 'invalid',
        username: null,
      };
    }
  } else if (INSTAGRAM_LIKE_PREFIX.test(username) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(username)) {
    return {
      error: 'Enter only your Instagram username, such as islanailstudio.',
      status: 'invalid',
      username: null,
    };
  } else if (username.startsWith('@')) {
    username = username.slice(1);
  }

  if (username.length > 30) {
    return {
      error: 'Instagram usernames can be up to 30 characters.',
      status: 'invalid',
      username: null,
    };
  }
  if (!INSTAGRAM_USERNAME_PATTERN.test(username)) {
    return {
      error: 'Enter only your Instagram username, such as islanailstudio.',
      status: 'invalid',
      username: null,
    };
  }
  return { status: 'resolved', username };
};

export const getInstagramInputError = (value: unknown): string | undefined => {
  const resolution = resolveInstagramUsername(value);
  return resolution.status === 'invalid' ? resolution.error : undefined;
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
  if (!method) {
    return false;
  }
  if (method === 'call') {
    return profile.clientContact.callEnabled
      && Boolean(profile.clientContact.primaryNumber.trim());
  }
  if (method === 'text') {
    return profile.clientContact.textEnabled && Boolean(getClientTextNumber(profile));
  }
  if (method === 'instagram') {
    return resolveInstagramUsername(profile.instagram).status === 'resolved';
  }
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
  method => contactMethodHasValue(profile, method),
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
    const instagram = resolveInstagramUsername(profile.instagram);
    if (instagram.status !== 'resolved') {
      return null;
    }
    detail = instagram.username;
    actionLabel = 'Instagram';
    action = { destination: { username: detail }, type: 'instagram' };
  } else {
    detail = profile.email.trim();
    actionLabel = 'Email';
    action = { destination: { email: detail }, type: 'email' };
  }
  const resolution = resolveCustomDesignAction(action);
  if (resolution.status !== 'resolved') {
    return null;
  }
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
    const bookingAction = resolution.status === 'resolved'
      ? {
        actionLabel: 'Book now',
        detail: 'Booking is the best way to reach us',
        external: resolution.external,
        href: resolution.href,
        method: 'booking',
        preferred: true,
      } satisfies PublicContactAction
      : null;
    const instagramAction = contactMethodHasValue(profile, 'instagram')
      ? getResolvedContactAction(profile, 'instagram', false)
      : null;
    return [bookingAction, instagramAction].filter(
      (action): action is PublicContactAction => action !== null,
    );
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
