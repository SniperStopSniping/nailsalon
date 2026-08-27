import type {
  CustomDesignAction,
  CustomDesignActionResolution,
  CustomDesignActionResolutionContext,
  CustomDesignValidationResult,
} from './types';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const INSTAGRAM_USERNAME_PATTERN = /^[A-Za-z0-9._]{1,30}$/u;
const EMAIL_LOCAL_PATTERN = /^[A-Za-z0-9.!$'*+/=_`{|}~-]+$/u;
const EMAIL_DOMAIN_LABEL_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u;
const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ENCODED_UNSAFE_ROUTE_CHARACTER_PATTERN = /%(?:00|0[0-9a-f]|1[0-9a-f]|5c|7f)/iu;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => Object.keys(value).every((key) => expected.includes(key));

const nonEmptyTrimmedString = (
  value: unknown,
  maximumLength: number,
): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
};

export const parseSafeHttpsUrl = (value: unknown): string | null => {
  const candidate = nonEmptyTrimmedString(value, 2_048);
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.hostname === ''
    ) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
};

export const normalizePhoneNumber = (value: unknown): string | null => {
  const candidate = nonEmptyTrimmedString(value, 40);
  if (!candidate || !/^[+()\- .0-9]+$/u.test(candidate)) return null;
  const digits = candidate.replace(/\D/gu, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `${candidate.startsWith('+') ? '+' : ''}${digits}`;
};

export const normalizeEmailAddress = (value: unknown): string | null => {
  const candidate = nonEmptyTrimmedString(value, 254);
  if (!candidate || /[?&#%]/u.test(candidate)) return null;
  const separator = candidate.lastIndexOf('@');
  if (separator <= 0 || separator === candidate.length - 1) return null;
  const local = candidate.slice(0, separator);
  const domain = candidate.slice(separator + 1);
  if (
    local.length > 64 ||
    !EMAIL_LOCAL_PATTERN.test(local) ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..')
  ) {
    return null;
  }
  const labels = domain.split('.');
  if (
    labels.length < 2 ||
    labels.some((label) => !EMAIL_DOMAIN_LABEL_PATTERN.test(label))
  ) {
    return null;
  }
  return `${local}@${domain.toLowerCase()}`;
};

export const normalizeInternalHref = (value: unknown): string | null => {
  const candidate = nonEmptyTrimmedString(value, 2_048);
  if (
    !candidate ||
    candidate.includes('\\') ||
    ENCODED_UNSAFE_ROUTE_CHARACTER_PATTERN.test(candidate)
  ) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    return null;
  }
  if (
    CONTROL_CHARACTER_PATTERN.test(decoded) ||
    decoded.includes('\\') ||
    decoded.startsWith('//')
  ) {
    return null;
  }

  try {
    const base = new URL('https://luster.invalid/');
    if (candidate.startsWith('#')) {
      if (candidate.length === 1) return null;
      const hash = new URL(candidate, base).hash;
      return hash.length > 1 ? hash : null;
    }
    if (!candidate.startsWith('/') || candidate.startsWith('//')) return null;
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin || parsed.pathname.startsWith('//')) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
};

const normalizeContactHref = (value: unknown): string | null => {
  const candidate = nonEmptyTrimmedString(value, 2_048);
  if (!candidate) return null;
  const internal = normalizeInternalHref(candidate);
  if (internal) return internal;
  const https = parseSafeHttpsUrl(candidate);
  if (https) return https;

  const schemeSeparator = candidate.indexOf(':');
  if (schemeSeparator <= 0) return null;
  const scheme = candidate.slice(0, schemeSeparator).toLowerCase();
  const destination = candidate.slice(schemeSeparator + 1);
  if (scheme === 'tel' || scheme === 'sms') {
    const phoneNumber = normalizePhoneNumber(destination);
    return phoneNumber ? `${scheme}:${phoneNumber}` : null;
  }
  if (scheme !== 'mailto') return null;

  const queryIndex = destination.indexOf('?');
  const rawAddress = queryIndex === -1
    ? destination
    : destination.slice(0, queryIndex);
  const email = normalizeEmailAddress(rawAddress);
  if (!email) return null;
  if (queryIndex === -1) return `mailto:${email}`;
  const query = new URLSearchParams(destination.slice(queryIndex + 1));
  if (
    [...query.keys()].some((key) => key !== 'subject') ||
    query.getAll('subject').length !== 1
  ) {
    return null;
  }
  const subject = nonEmptyTrimmedString(query.get('subject'), 200);
  return subject
    ? `mailto:${email}?subject=${encodeURIComponent(subject)}`
    : null;
};

const parseDestination = (
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null => {
  if (!isRecord(value) || !hasOnlyKeys(value, expectedKeys)) return null;
  return value;
};

export const parseCustomDesignAction = (
  value: unknown,
): CustomDesignAction | null => {
  if (!isRecord(value) || typeof value.type !== 'string') return null;

  if (value.type === 'start_booking') {
    return hasOnlyKeys(value, ['type']) ? { type: 'start_booking' } : null;
  }

  if (!hasOnlyKeys(value, ['type', 'destination'])) return null;

  switch (value.type) {
    case 'directions': {
      const destination = parseDestination(value.destination, ['address']);
      const address = nonEmptyTrimmedString(destination?.address, 500);
      return address ? { type: 'directions', destination: { address } } : null;
    }
    case 'instagram': {
      const destination = parseDestination(value.destination, ['username']);
      const rawUsername = nonEmptyTrimmedString(destination?.username, 31);
      const username = rawUsername?.replace(/^@/u, '') ?? null;
      return username && INSTAGRAM_USERNAME_PATTERN.test(username)
        ? { type: 'instagram', destination: { username } }
        : null;
    }
    case 'website':
    case 'custom_url': {
      const destination = parseDestination(value.destination, ['url']);
      const url = parseSafeHttpsUrl(destination?.url);
      return url
        ? { type: value.type, destination: { url } }
        : null;
    }
    case 'call':
    case 'text': {
      const destination = parseDestination(value.destination, ['phoneNumber']);
      const phoneNumber = normalizePhoneNumber(destination?.phoneNumber);
      return phoneNumber
        ? { type: value.type, destination: { phoneNumber } }
        : null;
    }
    case 'email': {
      const destination = parseDestination(value.destination, ['email', 'subject']);
      const email = normalizeEmailAddress(destination?.email);
      const subject = destination?.subject === undefined
        ? undefined
        : nonEmptyTrimmedString(destination.subject, 200);
      if (!email) return null;
      if (destination?.subject !== undefined && subject === null) return null;
      return {
        type: 'email',
        destination: subject ? { email, subject } : { email },
      };
    }
    case 'internal': {
      const destination = parseDestination(value.destination, ['pageId', 'sectionId']);
      const pageId = nonEmptyTrimmedString(destination?.pageId, 128);
      const sectionId = destination?.sectionId === undefined
        ? undefined
        : nonEmptyTrimmedString(destination.sectionId, 128);
      if (!pageId || !ENTITY_ID_PATTERN.test(pageId)) return null;
      if (
        destination?.sectionId !== undefined &&
        (!sectionId || !ENTITY_ID_PATTERN.test(sectionId))
      ) {
        return null;
      }
      return {
        type: 'internal',
        destination: sectionId ? { pageId, sectionId } : { pageId },
      };
    }
    default:
      return null;
  }
};

export const validateCustomDesignAction = (
  value: unknown,
): CustomDesignValidationResult<CustomDesignAction> => {
  const action = parseCustomDesignAction(value);
  return action
    ? { success: true, value: action }
    : { success: false, issues: ['Action destination is invalid or unsafe.'] };
};

const externalResolution = (href: string): CustomDesignActionResolution => ({
  status: 'resolved',
  href,
  external: true,
  target: '_blank',
  rel: 'noopener noreferrer',
});

export const resolveCustomDesignAction = (
  value: unknown,
  context: CustomDesignActionResolutionContext = {},
): CustomDesignActionResolution => {
  const action = parseCustomDesignAction(value);
  if (!action) return { status: 'unresolved', reason: 'invalid_destination' };

  switch (action.type) {
    case 'start_booking': {
      const href = normalizeInternalHref(context.bookingHref);
      return href
        ? {
            status: 'resolved',
            href,
            external: false,
          }
        : { status: 'unresolved', reason: 'booking_unavailable' };
    }
    case 'directions':
      return externalResolution(
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(action.destination.address)}`,
      );
    case 'instagram':
      return externalResolution(
        `https://www.instagram.com/${encodeURIComponent(action.destination.username)}/`,
      );
    case 'website':
    case 'custom_url':
      return externalResolution(action.destination.url);
    case 'call':
      return {
        status: 'resolved',
        href: `tel:${action.destination.phoneNumber}`,
        external: false,
      };
    case 'text':
      return {
        status: 'resolved',
        href: `sms:${action.destination.phoneNumber}`,
        external: false,
      };
    case 'email':
      return {
        status: 'resolved',
        href: `mailto:${action.destination.email}${
          action.destination.subject
            ? `?subject=${encodeURIComponent(action.destination.subject)}`
            : ''
        }`,
        external: false,
      };
    case 'internal': {
      const href = normalizeInternalHref(context.resolveInternalHref?.(
        action.destination.pageId,
        action.destination.sectionId,
      ));
      return href
        ? { status: 'resolved', href, external: false }
        : { status: 'unresolved', reason: 'internal_destination_unavailable' };
    }
  }
};

export const resolveContactCta = (
  context: CustomDesignActionResolutionContext,
): CustomDesignActionResolution => {
  const href = normalizeContactHref(context.contactHref);
  return href
    ? {
        status: 'resolved',
        href,
        external: href.startsWith('https://'),
        ...(href.startsWith('https://')
          ? { target: '_blank' as const, rel: 'noopener noreferrer' as const }
          : {}),
      }
    : { status: 'unresolved', reason: 'contact_unavailable' };
};
