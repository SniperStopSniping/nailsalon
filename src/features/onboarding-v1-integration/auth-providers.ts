/**
 * Which real authentication methods the active Clerk instance offers.
 *
 * The account gate renders a provider button only when the instance really
 * supports that method, so this shape is resolved server-side from Clerk's
 * environment document and passed down — never hard-coded to match a design.
 */
export type OnboardingAuthProviderAvailability = {
  apple: boolean;
  google: boolean;
  email: boolean;
  /**
   * 'clerk-environment' when derived from the live instance configuration;
   * 'fallback' when the environment document could not be read. The fallback
   * offers only email because a verified email is the one identity this
   * product structurally requires — a transient configuration outage must not
   * render a provider the instance may not have, nor leave the owner with no
   * way to save.
   */
  source: 'clerk-environment' | 'fallback';
};

export const FALLBACK_AUTH_PROVIDER_AVAILABILITY: OnboardingAuthProviderAvailability = {
  apple: false,
  email: true,
  google: false,
  source: 'fallback',
};
