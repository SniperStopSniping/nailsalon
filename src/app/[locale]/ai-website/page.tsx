import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { OwnerClerkProvider } from '@/components/auth/OwnerClerkProvider';
import { OwnerSignInCard } from '@/components/auth/OwnerSignInCard';
import { businessSetupSelfServeEnabled } from '@/features/business-setup/access.server';
import { AiWebsiteIntro } from '@/features/business-setup/AiWebsiteIntro';
import { VerifiedAiAccount } from '@/features/business-setup/VerifiedAiAccount';
import { hasClerkSessionCookie } from '@/libs/clerkSessionCookie';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Build your booking website with Luster AI', robots: { index: false, follow: false } };
export default async function AiWebsitePage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ account?: string }> }) {
  if (!businessSetupSelfServeEnabled()) {
    notFound();
  }
  const locale = (await props.params).locale === 'fr' ? 'fr' : 'en';
  const { account } = await props.searchParams;
  const hasSession = hasClerkSessionCookie((await cookies()).getAll());
  const needsAccount = Boolean(account) || hasSession;
  const userId = needsAccount ? (await auth()).userId : null;
  const url = `/${locale}/ai-website`;
  if (userId) {
    return (
      <OwnerClerkProvider params={Promise.resolve({ locale })}>
        <main className="ai-entry">
          <header className="ai-entry-nav">
            <a href={`/${locale}/onboarding-v1`} aria-label="Back to website choices">← Website choices</a>
            <span>✦ LUSTER</span>
          </header>
          <VerifiedAiAccount locale={locale} />
        </main>
      </OwnerClerkProvider>
    );
  }
  const content = (
    <AiWebsiteIntro locale={locale} showGetStarted={!account}>
      {account && (
        <section className="ai-entry-account" id="account">
          <h2>{account === 'sign-in' ? 'Welcome back.' : 'Save a place for your ideas.'}</h2>
          <p>{account === 'sign-in' ? 'Sign in to use your current website and business details.' : 'Create your Luster account, then choose credits inside your builder.'}</p>
          <OwnerSignInCard mode={account === 'sign-in' ? 'sign-in' : 'sign-up'} signInUrl={`${url}?account=sign-in#account`} createSalonUrl={`${url}?account=sign-up#account`} dashboardUrl={url} />
        </section>
      )}
    </AiWebsiteIntro>
  );
  return needsAccount ? <OwnerClerkProvider params={Promise.resolve({ locale })}>{content}</OwnerClerkProvider> : content;
}
