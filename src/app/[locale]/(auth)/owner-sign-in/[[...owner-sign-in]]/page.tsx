import { SignIn } from '@clerk/nextjs';

export default function OwnerSignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-12">
      <div className="space-y-5 text-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Luster</p>
          <h1 className="mt-2 text-2xl font-semibold text-stone-900">Salon owner sign in</h1>
        </div>
        <SignIn routing="hash" fallbackRedirectUrl="/en/admin" />
      </div>
    </main>
  );
}
