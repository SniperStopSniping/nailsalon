'use client';

import { useEffect } from 'react';

export default function OwnerAuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Owner auth] Page recovery required', error.digest ?? 'client_error');
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-5">
      <section className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-7 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Luster</p>
        <h1 className="mt-3 text-2xl font-semibold text-stone-900">Let’s reload your owner account</h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          Your invitation is still safe. This can happen after an account or sign-in update on mobile.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <button type="button" onClick={reset} className="rounded-full bg-rose-700 px-5 py-3 text-sm font-semibold text-white">
            Try again
          </button>
          <button type="button" onClick={() => window.location.reload()} className="rounded-full border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-800">
            Reload this page
          </button>
        </div>
      </section>
    </main>
  );
}
