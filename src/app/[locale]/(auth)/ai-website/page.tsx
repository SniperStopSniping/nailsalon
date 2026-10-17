import { auth } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';

import { OwnerSignInCard } from '@/components/auth/OwnerSignInCard';
import { businessSetupSelfServeEnabled } from '@/features/business-setup/access.server';
import { AiWebsiteIntro } from '@/features/business-setup/AiWebsiteIntro';
import { OpenAiBuilder } from '@/features/business-setup/OpenAiBuilder';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Build your booking website with Luster AI', robots: { index: false, follow: false } };
export default async function AiWebsitePage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ account?: string }> }) {
  if (!businessSetupSelfServeEnabled()) {
    notFound();
  }
  const locale = (await props.params).locale === 'fr' ? 'fr' : 'en';
  const { account } = await props.searchParams;
  const { userId } = await auth();
  const url = `/${locale}/ai-website`;
  return (
    <AiWebsiteIntro locale={locale} showGetStarted={!userId && !account}>
      {userId
        ? <OpenAiBuilder locale={locale} />
        : account && (
          <section className="ai-entry-account">
            <h2>{account === 'sign-in' ? 'Welcome back.' : 'Save a place for your ideas.'}</h2>
            <p>{account === 'sign-in' ? 'Sign in to use your current website and business details.' : 'Create your Luster account, then choose credits inside your builder.'}</p>
            <OwnerSignInCard mode={account === 'sign-in' ? 'sign-in' : 'sign-up'} signInUrl={`${url}?account=sign-in`} createSalonUrl={`${url}?account=sign-up`} dashboardUrl={url} />
          </section>
        )}
    </AiWebsiteIntro>
  );
}
