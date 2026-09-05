import { OwnerSignInCard } from '@/components/auth/OwnerSignInCard';

export default async function OwnerSignInPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-12">
      <div className="flex w-full max-w-sm flex-col items-center space-y-5 text-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Luster</p>
          <h1 className="mt-2 text-2xl font-semibold text-stone-900">Salon owner sign in</h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Sign in to Luster to open your salon workspace.
          </p>
        </div>
        <OwnerSignInCard dashboardUrl={`/${locale}/admin`} />
      </div>
    </main>
  );
}
