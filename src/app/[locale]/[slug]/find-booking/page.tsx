import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { getSalonBySlug } from '@/libs/queries';
import { applyPhoneDisplayMode } from '@/libs/salonContent';

import { FindBookingForm } from './FindBookingForm';

export default async function FindBookingPage({ params }: { params: { slug: string } }) {
  const salon = await getSalonBySlug(params.slug);
  // Post-launch privacy fix: this public, unauthenticated page previously
  // passed `salon.phone` straight through with no redaction at all — no
  // owner-preview gate exists on this route, so it always reads the LIVE
  // `locationDisplayMode` side (the same default every other public,
  // non-preview surface falls back to). `resolveBookingPageContent` is
  // pure/DB-free (it only parses `salon.settings`, already in hand), so
  // this costs nothing. Reuses `applyPhoneDisplayMode` (`@/libs/salonContent`)
  // — the exact same scalar redaction `book/confirm/page.tsx`'s `salonPhone`
  // now uses — never a second, independently-decided rule.
  const locationDisplayMode = resolveBookingPageContent(salon?.settings ?? null).live.locationDisplayMode;
  const salonPhone = applyPhoneDisplayMode(salon?.phone ?? null, locationDisplayMode);
  return (
    <main className="min-h-[calc(100vh-60px)] bg-[#fbf6f1] px-4 py-14">
      <div className="mx-auto max-w-md">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.28em] text-rose-700">Luster booking access</p>
        <div className="mt-5 rounded-[2rem] border border-stone-200 bg-white p-7 shadow-sm">
          <h1 className="text-3xl font-semibold tracking-tight text-stone-950">Find my booking</h1>
          <p className="mt-3 text-sm leading-6 text-stone-600">Enter the email or phone number you booked with. We will email the secure management link to the contact on file.</p>
          <FindBookingForm salonSlug={params.slug} salonPhone={salonPhone} />
        </div>
      </div>
    </main>
  );
}
