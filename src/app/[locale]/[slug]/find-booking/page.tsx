import { FindBookingForm } from './FindBookingForm';

export default function FindBookingPage({ params }: { params: { slug: string } }) {
  return (
    <main className="min-h-[calc(100vh-60px)] bg-[#fbf6f1] px-4 py-14">
      <div className="mx-auto max-w-md">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.28em] text-rose-700">Luster booking access</p>
        <div className="mt-5 rounded-[2rem] border border-stone-200 bg-white p-7 shadow-sm">
          <h1 className="text-3xl font-semibold tracking-tight text-stone-950">Find my booking</h1>
          <p className="mt-3 text-sm leading-6 text-stone-600">Enter the same email used to book. We will send private links for any upcoming reservations.</p>
          <FindBookingForm salonSlug={params.slug} />
        </div>
      </div>
    </main>
  );
}
