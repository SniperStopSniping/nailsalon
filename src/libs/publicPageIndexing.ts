import { isReservedSalonSlug } from './tenantSlug';

/** Public account flows should be crawled to read noindex, not listed as marketing pages. */
export function isUnlistedAccountPage(pathname: string): boolean {
  return /^\/(?:en\/|fr\/)?(?:onboarding-v1|onboarding|owner-sign-in|owner-sign-up|sign-in|sign-up|admin-login|admin-onboarding|staff-login|super-admin-login)(?:\/|$)/u.test(pathname);
}

const customerUtilityPath = /^(?:appointments\/history|booking-disabled|cancelled|change-appointment|deposit|find-booking|invite|manage|membership|my-referrals|payment-methods|preferences|profile|referral|rewards(?:-disabled)?|suspended)(?:\/|$)/u;

/** Match a customer utility in the same path or host form as the public salon routes. */
export function isUnlistedSalonCapabilityPage(pathname: string, hostnameSalonSlug?: string | null): boolean {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] === 'en' || segments[0] === 'fr') {
    segments.shift();
  }
  const first = segments[0];
  if (!first) {
    return false;
  }

  // On a tenant host the slug can be implicit. On the shared host a
  // non-reserved first segment is the salon itself, even if named "deposit".
  if (first === hostnameSalonSlug || (!hostnameSalonSlug && !isReservedSalonSlug(first))) {
    segments.shift();
  }
  return customerUtilityPath.test(segments.join('/'));
}
