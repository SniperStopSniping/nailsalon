export default function OwnerSignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="max-w-md rounded-3xl border border-stone-200 bg-white p-8 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Luster Free Booking</p>
        <h1 className="mt-3 text-2xl font-semibold text-stone-900">An invitation is required</h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">During the pilot, each owner receives a private seven-day signup link by email. Open that link to create your account.</p>
        <a href="/en/owner-sign-in" className="mt-6 inline-flex rounded-full bg-stone-900 px-5 py-3 text-sm font-medium text-white">Already joined? Sign in</a>
      </div>
    </main>
  );
}
