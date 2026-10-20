import { normalizeEmailAddress, normalizePhoneNumber, parseSafeHttpsUrl } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/actions';
import { hasUnsafeTextControls } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/text';

/** Shared safe navigation contract for owner-drawn links; never a URL fetcher. */
export function manualLinkHref(value: string): string | null {
  if (!value || value.length > 2048 || hasUnsafeTextControls(value)) {
    return null;
  }
  if (/^#[a-z][\w-]{0,70}$/iu.test(value)) {
    return value;
  }
  const https = parseSafeHttpsUrl(value);
  if (https) {
    const url = new URL(https);
    return (!url.port || url.port === '443') && url.hostname.includes('.')
      && !/^[\d.]+$|:|(?:^|\.)(?:localhost|local|internal|test)$/iu.test(url.hostname)
      && !/^\/(?:admin|api)(?:\/|$)/iu.test(url.pathname)
      ? url.href
      : null;
  }
  const match = /^(tel|sms|mailto):(.+)$/u.exec(value);
  if (!match) {
    return null;
  }
  if (match[1] !== 'mailto') {
    const phone = normalizePhoneNumber(match[2]);
    return phone ? `${match[1]}:${phone}` : null;
  }
  const [address, query, extra] = match[2]!.split('?');
  const email = normalizeEmailAddress(address);
  if (!email || extra !== undefined) {
    return null;
  }
  if (query === undefined) {
    return `mailto:${email}`;
  }
  const parameters = new URLSearchParams(query);
  const subject = parameters.get('subject');
  if ([...parameters.keys()].some(key => key !== 'subject') || parameters.getAll('subject').length !== 1 || !subject?.trim() || subject.length > 200 || hasUnsafeTextControls(subject)) {
    return null;
  }
  return `mailto:${email}?subject=${encodeURIComponent(subject.trim())}`;
}

/** Contact/profile names may contain 'booking'; internal IDs are not intent. */
export function manualLinkTargetsBooking(label: string, href: string) {
  if (!href.startsWith('https:')) {
    return false;
  }
  const url = new URL(href);
  return /^(?:book(?:\s|now\b|$)|schedule\b|reserve\b)/iu.test(label.trim())
    || /(?:^|\.)(?:acuityscheduling\.com|calendly\.com|booksy\.com|fresha\.com|vagaro\.com)$/iu.test(url.hostname)
    || /(?:^|\/)(?:book|booking|appointments?|reservations?|schedule)(?:\/|$)/iu.test(url.pathname);
}
