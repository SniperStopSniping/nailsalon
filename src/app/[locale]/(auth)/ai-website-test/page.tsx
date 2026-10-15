import { SignIn, SignUp } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { notFound, redirect } from 'next/navigation';

import { setupPreviewTrialEnabled } from '@/features/business-setup/access.server';
import { openPreviewTrial } from '@/features/business-setup/preview-trial.server';
import { requireAuthenticatedOnboardingIdentity } from '@/features/onboarding-v1-integration/identity.server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Luster · Private AI website test', robots: { index: false, follow: false } };
export default async function AIWebsiteTest(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ signup?: string }> }) {
  if (!setupPreviewTrialEnabled()) {
    notFound();
  }
  const { locale } = await props.params;
  const { signup } = await props.searchParams;
  const { userId } = await auth();
  const returnUrl = `/${locale}/ai-website-test`;
  async function begin() {
    'use server';
    const identity = await requireAuthenticatedOnboardingIdentity();
    const slug = await openPreviewTrial(identity);
    redirect(`/${locale}/admin/business-setup?salon=${encodeURIComponent(slug)}`);
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center gap-6 px-5 py-12 text-center">
      <p className="text-sm tracking-widest">✦ LUSTER · PRIVATE TEST</p>
      <h1 className="font-serif text-4xl">Your ideas. Your booking website.</h1>
      <p>Tell Luster about your business and services, then upload a design you love or describe something original. Create, refine, and preview your website before approving it.</p>
      <p className="rounded-xl bg-amber-50 p-4 text-sm">This is an isolated test. Publishing here does not change your live salon. Use test customer details when trying bookings.</p>
      {!userId
        ? signup
          ? <SignUp routing="hash" signInUrl={returnUrl} forceRedirectUrl={returnUrl} />
          : <SignIn routing="hash" signUpUrl={`${returnUrl}?signup=1`} forceRedirectUrl={returnUrl} />
        : <form action={begin}><button type="submit" className="rounded-full bg-stone-900 px-8 py-4 font-medium text-white">Open my AI website test</button></form>}
      <p className="text-sm text-stone-500">Your answers and designs are saved to this test account so you can return on another device. The approved AI testing budget is shared across this private trial.</p>
    </main>
  );
}
