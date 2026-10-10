import styles from '@/components/customer-booking/customer-booking.module.css';
import { CustomerBookingShell } from '@/components/customer-booking/CustomerBookingShell';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import {
  resolvePublicSalonPhone,
  resolveSharedSalonProfile,
} from '@/libs/sharedSalonProfile';
import { requirePublishedTenantSalon } from '@/libs/tenant';

import { FindBookingForm } from './FindBookingForm';

export default async function FindBookingPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  // S3 (Stage 1): this anonymous salon-by-slug route had NO gate of any kind —
  // no publication check, no owner-preview gate — so an unpublished salon
  // rendered here at HTTP 200 and exposed its identity and phone number. The
  // guard 404s exactly as an unresolvable slug already does, so unpublished and
  // nonexistent stay indistinguishable.
  const salon = await requirePublishedTenantSalon(params.slug);
  // Post-launch privacy fix: this public, unauthenticated page previously
  // passed `salon.phone` straight through with no redaction at all — no
  // owner-preview gate exists on this route, so it always reads the LIVE
  // `locationDisplayMode` side (the same default every other public,
  // non-preview surface falls back to). `resolveBookingPageContent` is
  // pure/DB-free (it only parses `salon.settings`, already in hand), so
  // this costs nothing. Reuses `applyPhoneDisplayMode` (`@/libs/salonContent`)
  // — the exact same scalar redaction `book/confirm/page.tsx`'s `salonPhone`
  // now uses — never a second, independently-decided rule.
  const locationDisplayMode = resolveBookingPageContent(salon.settings ?? null).live.locationDisplayMode;
  const salonPhone = resolvePublicSalonPhone(
    resolveSharedSalonProfile(salon.settings ?? null),
    salon.phone ?? null,
    locationDisplayMode,
  );
  return (
    <CustomerBookingShell eyebrow="Booking access">
      <div className={styles.card}>
        <h1 className={styles.title}>Find my booking</h1>
        <p className={styles.intro}>Your next visit, at your fingertips. Request a private link to view or manage your appointment.</p>
        <FindBookingForm salonSlug={params.slug} salonPhone={salonPhone} />
      </div>
    </CustomerBookingShell>
  );
}
