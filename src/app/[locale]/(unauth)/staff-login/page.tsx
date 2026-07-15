export default function StaffLoginRetiredPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <section className="max-w-md rounded-3xl border border-stone-200 bg-white p-8 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Luster</p>
        <h1 className="mt-3 text-2xl font-semibold text-stone-900">Staff login is unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          The free solo product does not use staff phone authentication. Salon owners sign in with their verified email and password.
        </p>
        <a href="../owner-sign-in" className="mt-6 inline-flex rounded-full bg-stone-900 px-5 py-3 text-sm font-medium text-white">
          Owner sign in
        </a>
      </section>
    </main>
  );
}
