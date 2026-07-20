import { and, eq } from 'drizzle-orm';
import type { Metadata } from 'next';

import { verifyAppointmentAccessToken } from '@/libs/appointmentAccess';
import { getClientChangePolicy, resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { db } from '@/libs/DB';
import {
  formatDateInTimeZone,
  formatTimeInTimeZone,
  getDateKeyInTimeZone,
} from '@/libs/timeZone';
import { appointmentAddOnSchema, appointmentServicesSchema, technicianSchema } from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

import { RescheduleAppointmentClient } from './RescheduleAppointmentClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

function ErrorCard({ title, body, href }: { title: string; body: string; href: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-14">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-stone-900">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">{body}</p>
        <a href={href} className="mt-6 inline-flex rounded-full bg-rose-800 px-5 py-3 text-sm font-semibold text-white">Email me a fresh link</a>
      </div>
    </main>
  );
}

/**
 * Reschedule the appointment this capability token belongs to.
 *
 * Everything but the time is fixed here — the customer never re-picks a
 * service, so the flow stays visibly attached to the existing appointment
 * instead of restarting the public booking funnel.
 */
export default async function RescheduleAppointmentPage({
  params,
}: {
  params: { locale: string; slug: string; token: string };
}) {
  const capability = await verifyAppointmentAccessToken(params.token);
  const findBookingHref = `/${params.locale}/${params.slug}/find-booking`;

  if (
    !capability
    || capability.appointment.salonId !== capability.salonId
    || capability.salonSlug !== params.slug
  ) {
    return (
      <ErrorCard
        title="This link is not valid"
        body="The link may have been copied incompletely, or it has already been replaced by a newer one. Request a fresh private link and we will email it to the address on file."
        href={findBookingHref}
      />
    );
  }

  const appointment = capability.appointment;
  const manageHref = `/${params.locale}/${params.slug}/manage/${encodeURIComponent(params.token)}`;

  if (!['pending', 'confirmed'].includes(appointment.status)) {
    return (
      <ErrorCard
        title="This appointment can no longer be changed"
        body="It has already been cancelled or completed. Open your appointment for the current details, or contact the salon."
        href={manageHref}
      />
    );
  }

  const bookingConfig = resolveBookingConfigFromSettings(capability.salonSettings as SalonSettings | null);
  const timeZone = bookingConfig.timezone;
  if (!getClientChangePolicy(appointment.startTime, bookingConfig).canChange) {
    return (
      <ErrorCard
        title="Online changes are closed"
        body={`Changes close ${bookingConfig.clientChangeCutoffHours} hours before the appointment. Please contact the salon for a late change.`}
        href={manageHref}
      />
    );
  }

  const [services, addOns, technician] = await Promise.all([
    db.select({ name: appointmentServicesSchema.nameSnapshot })
      .from(appointmentServicesSchema)
      .where(eq(appointmentServicesSchema.appointmentId, appointment.id)),
    db.select({
      name: appointmentAddOnSchema.nameSnapshot,
      quantity: appointmentAddOnSchema.quantitySnapshot,
    })
      .from(appointmentAddOnSchema)
      .where(eq(appointmentAddOnSchema.appointmentId, appointment.id)),
    appointment.technicianId
      ? db.select({ name: technicianSchema.name })
        .from(technicianSchema)
        .where(and(
          eq(technicianSchema.id, appointment.technicianId),
          eq(technicianSchema.salonId, appointment.salonId),
        ))
        .limit(1)
      : Promise.resolve([]),
  ]);

  const serviceSummary = [
    services.map(service => service.name).filter(Boolean).join(', ') || 'Nail appointment',
    ...addOns.map(addOn => `+ ${addOn.name}${addOn.quantity > 1 ? ` ×${addOn.quantity}` : ''}`),
  ].join(' · ');

  const currentDateKey = getDateKeyInTimeZone(appointment.startTime, timeZone);
  const currentTimeKey = formatTimeInTimeZone(
    appointment.startTime.toISOString(),
    { hour: '2-digit', minute: '2-digit', hour12: false },
    timeZone,
  );
  const currentLabel = `${formatDateInTimeZone(appointment.startTime.toISOString(), { weekday: 'long', month: 'long', day: 'numeric' }, timeZone)} at ${formatTimeInTimeZone(appointment.startTime.toISOString(), {}, timeZone)}`;
  const discountAmountCents = appointment.discountAmountCents ?? 0;

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10">
      <div className="mx-auto max-w-xl">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Choose a new time</p>
        <h1 className="mt-2 text-center text-2xl font-semibold text-stone-900">{capability.salonName}</h1>
        <div className="mt-6">
          <RescheduleAppointmentClient
            token={params.token}
            salonSlug={params.slug}
            manageHref={manageHref}
            serviceSummary={serviceSummary}
            technicianName={technician[0]?.name ?? 'Any available artist'}
            technicianId={appointment.technicianId}
            locationId={appointment.locationId}
            totalDurationMinutes={appointment.totalDurationMinutes}
            appointmentId={appointment.id}
            currentDateKey={currentDateKey}
            currentTimeKey={currentTimeKey}
            currentLabel={currentLabel}
            priceLabel={`Total $${(appointment.totalPrice / 100).toFixed(2)} ${bookingConfig.currency}`}
            discountNote={
              discountAmountCents > 0
                ? `${appointment.discountLabel || 'Your discount'} stays applied when you move this appointment.`
                : null
            }
          />
        </div>
      </div>
    </main>
  );
}
