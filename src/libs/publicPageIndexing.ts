/** Public account flows should be crawled to read noindex, not listed as marketing pages. */
export function isUnlistedAccountPage(pathname: string): boolean {
  return /^\/(?:en\/|fr\/)?(?:onboarding-v1|onboarding|owner-sign-in|owner-sign-up|sign-in|sign-up|admin-login|admin-onboarding|staff-login|super-admin-login)(?:\/|$)/u.test(pathname);
}
