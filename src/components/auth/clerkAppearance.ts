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

/** Only the start title is redundant; Clerk retains all step and recovery copy. */
export const lusterOwnerSignInAppearance = {
  elements: {
    card: 'luster-auth-card',
    cardBox: 'luster-auth-box',
    dividerLine: 'luster-auth-divider',
    footer: 'luster-auth-footer',
    // The page links to the canonical salon builder when self-service is enabled.
    footerAction__signIn: { display: 'none' },
    formButtonPrimary: 'luster-auth-primary',
    formFieldInput: 'luster-auth-input',
    formFieldLabel: 'luster-auth-label',
    headerSubtitle: 'luster-auth-subtitle',
    headerTitle: { display: 'none' },
    rootBox: 'luster-auth-root',
    socialButtonsBlockButton: 'luster-auth-social',
    socialButtonsBlockButtonText: 'luster-auth-social-text',
  },
  layout: {
    socialButtonsPlacement: 'bottom' as const,
    socialButtonsVariant: 'blockButton' as const,
  },
  variables: {
    ...lusterClerkVariables,
    fontFamily: 'var(--font-owner-sans, Inter, ui-sans-serif, system-ui, sans-serif)',
    fontSize: '16px',
  },
};
