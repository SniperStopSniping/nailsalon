/**
 * Clerk widget theming for the owner surfaces.
 *
 * The account gate and the onboarding layout already dress Clerk in Luster's
 * tokens (`src/app/[locale]/onboarding-v1/layout.tsx`); the stock owner
 * sign-in did not, so it shipped Clerk's default near-black button and card.
 * These variables are the single source for both, so the first screen of the
 * product matches the workspace it opens.
 */
export const lusterClerkVariables = {
  borderRadius: '14px',
  colorBackground: '#fffdfb',
  colorPrimary: '#8f3155',
  colorText: '#30262a',
  colorTextSecondary: '#706267',
};

/**
 * Sign-in card overrides:
 * - `headerTitle` is hidden because the page owns the only <h1>
 *   ("Salon owner sign in"); Clerk's per-step subtitle keeps the step
 *   context ("Welcome back…", "Enter the password associated with…").
 * - the sign-in card's footer action ("Don't have an account? Sign up") is
 *   hidden because owner accounts are invitation-only during the pilot, so
 *   the link is a dead end. Clerk ids that row by the card it belongs to, so
 *   the key is `footerAction__signIn`; the password step's own footer action
 *   (`__havingTrouble`, "Get help") is untouched.
 */
export const lusterOwnerSignInAppearance = {
  elements: {
    footerAction__signIn: { display: 'none' },
    headerTitle: { display: 'none' },
  },
  variables: lusterClerkVariables,
};
