import { getSalonBySlug } from '@/libs/queries';

import { FindBookingForm } from './FindBookingForm';

export default async function FindBookingPage({ params }: { params: { slug: string } }) {
  const salon = await getSalonBySlug(params.slug);
  return (
    <main className="min-h-[calc(100vh-60px)] bg-[#fbf6f1] px-4 py-14">
      <div className="mx-auto max-w-md">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.28em] text-rose-700">Luster booking access</p>
        <div className="mt-5 rounded-[2rem] border border-stone-200 bg-white p-7 shadow-sm">
          <h1 className="text-3xl font-semibold tracking-tight text-stone-950">Find my booking</h1>
          <p className="mt-3 text-sm leading-6 text-stone-600">Enter the email or phone number you booked with. We will email the secure management link to the contact on file.</p>
          <FindBookingForm salonSlug={params.slug} salonPhone={salon?.phone ?? null} />
        </div>
      </div>
    </main>
  );
}
