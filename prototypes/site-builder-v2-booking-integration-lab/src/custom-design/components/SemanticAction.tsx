import type { CSSProperties, ReactNode } from 'react';

import {
  normalizePhoneNumber,
  parseCustomDesignAction,
  parseSafeHttpsUrl,
  resolveCustomDesignAction,
} from '../model/actions';
import { useTapWithoutScroll } from './useTapWithoutScroll';
import type {
  CustomDesignRenderResolution,
  CustomDesignScrollPositionReader,
} from './view-types';

const MAXIMUM_RENDERED_HREF_LENGTH = 2_048;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const MALFORMED_PERCENT_ENCODING_PATTERN = /%(?![0-9a-f]{2})/iu;
const INTERNAL_ROUTE_CONFUSION_PATTERN = /%(?:0[0-9a-f]|1[0-9a-f]|23|25|2e|2f|3f|5c|7f)/iu;
const EXTERNAL_UNSAFE_ENCODING_PATTERN = /%(?:0[0-9a-f]|1[0-9a-f]|25|5c|7f)/iu;
const INTERNAL_VALIDATION_ORIGIN = 'https://luster-render.invalid';

type NormalizedRenderedHref = {
  external: boolean;
  href: string;
};

const hasUnsafeCommonShape = (href: string): boolean =>
  href.length === 0
  || href.length > MAXIMUM_RENDERED_HREF_LENGTH
  || href.trim() !== href
  || CONTROL_CHARACTER_PATTERN.test(href)
  || MALFORMED_PERCENT_ENCODING_PATTERN.test(href);

const normalizeInternalHref = (href: string): NormalizedRenderedHref | null => {
  if (
    hasUnsafeCommonShape(href)
    || href.includes('\\')
    || INTERNAL_ROUTE_CONFUSION_PATTERN.test(href)
  ) {
    return null;
  }

  if (href.startsWith('#')) {
    return href.length > 1 ? { external: false, href } : null;
  }
  if (!href.startsWith('/') || href.startsWith('//') || /\s/u.test(href)) {
    return null;
  }

  const rawPath = href.split(/[?#]/u, 1)[0] ?? '';
  if (rawPath.split('/').some(segment => segment === '.' || segment === '..')) {
    return null;
  }

  try {
    const parsed = new URL(href, INTERNAL_VALIDATION_ORIGIN);
    if (parsed.origin !== INTERNAL_VALIDATION_ORIGIN) {
      return null;
    }
    const normalizedHref = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return normalizedHref === href
      ? { external: false, href: normalizedHref }
      : null;
  } catch {
    return null;
  }
};

const normalizeHttpsHref = (href: string): NormalizedRenderedHref | null => {
  if (
    hasUnsafeCommonShape(href)
    || !/^https:\/\//u.test(href)
    || href.includes('\\')
    || /\s/u.test(href)
    || EXTERNAL_UNSAFE_ENCODING_PATTERN.test(href)
  ) {
    return null;
  }
  const normalizedHref = parseSafeHttpsUrl(href);
  return normalizedHref
    ? { external: true, href: normalizedHref }
    : null;
};

const normalizePhoneHref = (
  href: string,
  scheme: 'sms' | 'tel',
): NormalizedRenderedHref | null => {
  if (hasUnsafeCommonShape(href) || !href.startsWith(`${scheme}:`)) {
    return null;
  }
  const phoneNumber = normalizePhoneNumber(href.slice(scheme.length + 1));
  return phoneNumber
    ? { external: false, href: `${scheme}:${phoneNumber}` }
    : null;
};

const normalizeMailtoHref = (href: string): NormalizedRenderedHref | null => {
  if (hasUnsafeCommonShape(href) || !href.startsWith('mailto:') || href.includes('#')) {
    return null;
  }
  const destination = href.slice('mailto:'.length);
  const questionMarkIndex = destination.indexOf('?');
  const email = questionMarkIndex === -1
    ? destination
    : destination.slice(0, questionMarkIndex);
  const query = questionMarkIndex === -1
    ? ''
    : destination.slice(questionMarkIndex + 1);
  if (!email || email.includes('%') || query.includes('?')) {
    return null;
  }

  const parameters = new URLSearchParams(query);
  const entries = [...parameters.entries()];
  if (
    entries.some(([key]) => key !== 'subject')
    || entries.filter(([key]) => key === 'subject').length > 1
  ) {
    return null;
  }
  const subject = parameters.get('subject') ?? undefined;
  const action = parseCustomDesignAction({
    type: 'email',
    destination: subject === undefined ? { email } : { email, subject },
  });
  if (!action) {
    return null;
  }
  const resolution = resolveCustomDesignAction(action);
  return resolution.status === 'resolved' && resolution.href.startsWith('mailto:')
    ? { external: false, href: resolution.href }
    : null;
};

export const normalizeSafeRenderedHref = (
  href: string,
): NormalizedRenderedHref | null => {
  if (href.startsWith('/') || href.startsWith('#')) {
    return normalizeInternalHref(href);
  }
  if (href.startsWith('https://')) {
    return normalizeHttpsHref(href);
  }
  if (href.startsWith('tel:')) {
    return normalizePhoneHref(href, 'tel');
  }
  if (href.startsWith('sms:')) {
    return normalizePhoneHref(href, 'sms');
  }
  if (href.startsWith('mailto:')) {
    return normalizeMailtoHref(href);
  }
  return null;
};

export const isSafeRenderedHref = (href: string): boolean =>
  normalizeSafeRenderedHref(href) !== null;

type SemanticActionProps = {
  accessibleLabel: string;
  children?: ReactNode;
  className: string;
  getScrollPosition?: CustomDesignScrollPositionReader;
  resolution: CustomDesignRenderResolution;
  style?: CSSProperties;
  testId?: string;
};

export function SemanticAction({
  accessibleLabel,
  children,
  className,
  getScrollPosition,
  resolution,
  style,
  testId,
}: SemanticActionProps) {
  const linkTapGuard = useTapWithoutScroll<HTMLAnchorElement>({
    getScrollPosition,
    onActivate: resolution.status === 'resolved'
      ? resolution.onActivate
      : undefined,
  });
  const buttonTapGuard = useTapWithoutScroll<HTMLButtonElement>({
    getScrollPosition,
    onActivate: resolution.status === 'button'
      ? resolution.onActivate
      : undefined,
  });

  if (resolution.status === 'unresolved') {
    return null;
  }

  if (resolution.status === 'button') {
    return (
      <button
        aria-label={accessibleLabel}
        className={className}
        data-testid={testId}
        style={style}
        type="button"
        {...buttonTapGuard}
      >
        {children}
      </button>
    );
  }

  const normalizedHref = normalizeSafeRenderedHref(resolution.href);
  if (!normalizedHref) {
    return null;
  }

  return (
    <a
      aria-label={accessibleLabel}
      className={className}
      data-testid={testId}
      href={normalizedHref.href}
      rel={normalizedHref.external ? 'noopener noreferrer' : undefined}
      style={style}
      target={normalizedHref.external ? '_blank' : undefined}
      {...linkTapGuard}
    >
      {children}
    </a>
  );
}
