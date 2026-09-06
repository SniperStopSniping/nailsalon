import { Inter, Newsreader } from 'next/font/google';

import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { isSectionLibraryV1Enabled } from '@/features/section-library-v1/config.server';

import { OwnerAdminClientBoundary } from './OwnerAdminClientBoundary';

/**
 * Owner workspace faces. These are the same two families the onboarding flow
 * uses, so the owner keeps one typographic voice across setup and daily work:
 * Newsreader for screen titles, Inter for everything else.
 *
 * next/font self-hosts them, so the workspace no longer depends on the Google
 * Fonts @import that only the onboarding prototype bundle pulled in.
 */
const ownerSans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-owner-sans',
});

const ownerDisplay = Newsreader({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-owner-display',
});

/**
 * The face variables are published on :root for this route only. AppModal (and
 * every ?app= modal it wraps) renders through a react-dom portal into
 * document.body, i.e. outside this layout's subtree, so a wrapper element
 * alone would leave every modal on the fallback stack.
 */
const ownerFontVariables = `:root{--font-owner-sans:${ownerSans.style.fontFamily};--font-owner-display:${ownerDisplay.style.fontFamily};}`;

export default async function OwnerAdminLayout(
  props: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
  },
) {
  return (
    <>
      <style>{ownerFontVariables}</style>
      <div className={`${ownerSans.variable} ${ownerDisplay.variable} contents`}>
        <OwnerAdminClientBoundary
          locale={(await props.params).locale}
          onboardingV1IntegrationEnabled={isOnboardingV1IntegrationEnabled()}
          sectionLibraryV1Enabled={isSectionLibraryV1Enabled()}
        >
          {props.children}
        </OwnerAdminClientBoundary>
      </div>
    </>
  );
}
