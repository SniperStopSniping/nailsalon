import { and, eq } from 'drizzle-orm';
import { CalendarDays, Clock, Download, ExternalLink, Scissors, Sparkles, User } from 'lucide-react';

import { verifyAppointmentAccessToken } from '@/libs/appointmentAccess';
import { getClientChangePolicy, resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { db } from '@/libs/DB';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/libs/timeZone';
import { appointmentAddOnSchema, appointmentServicesSchema, technicianSchema } from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

import { ManageAppointmentActions } from './ManageAppointmentActions';

/**
 * Why the link failed, in the customer's terms. Never leaks whether some other
 * appointment id exists — an unknown, revoked, tampered and never-issued token
 * are all indistinguishable from the outside.
 */
type ManageLinkFailure = 'invalid' | 'expired' | 'not_found';

const FAILURE_COPY: Record<ManageLinkFailure, { title: string; body: string }> = {
  invalid: {
    title: 'This link is not valid',
    body: 'The link may have been copied incompletely, or it has already been replaced by a newer one. Request a fresh private link and we will email it to the address on file.',
  },
  expired: {
    title: 'This link has expired',
    body: 'Private appointment links stop working a while after the appointment. Request a fresh one and we will email it to the address on file.',
  },
  not_found: {
    title: 'We could not find that appointment',
    body: 'The appointment attached to this link is no longer available. Request a fresh private link, or contact the salon directly.',
  },
};

function ManageLinkError({ failure, findBookingHref }: { failure: ManageLinkFailure; findBookingHref: string }) {
  const copy = FAILURE_COPY[failure];
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-14">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-stone-900">{copy.title}</h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">{copy.body}</p>
        <a href={findBookingHref} className="mt-6 inline-flex rounded-full bg-rose-800 px-5 py-3 text-sm font-semibold text-white">Email me a fresh link</a>
      </div>
    </main>
  );
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * The private appointment-management view.
 *
 * Rendered by both the tenant path (`/{locale}/{slug}/manage/{token}`) and the
 * dedicated-host path (`/manage/{token}`) so the two link shapes can never
 * drift. The token is the only credential: the appointment and salon are
 * resolved from it server-side, and when the URL also carries a slug it must
 * match the token's salon or the link is rejected as invalid.
 */
export async function ManageAppointmentView({
  token,
  locale,
  slug,
}: {
  token: string;
  locale: string;
  /** Present only on the tenant path. Cross-salon mismatches are rejected. */
  slug?: string;
}) {
  const capability = await verifyAppointmentAccessToken(token, { salonId: undefined });
  const findBookingHref = `/${locale}/${slug ?? capability?.salonSlug ?? ''}/find-booking`;

  if (!capability) {
    return <ManageLinkError failure="invalid" findBookingHref={slug ? findBookingHref : `/${locale}`} />;
  }
  if (capability.appointment.salonId !== capability.salonId || (slug && capability.salonSlug !== slug)) {
    return <ManageLinkError failure="invalid" findBookingHref={findBookingHref} />;
  }
  if (capability.expiresAt <= new Date()) {
    return <ManageLinkError failure="expired" findBookingHref={findBookingHref} />;
  }

  const appointment = capability.appointment;
  const resolvedSlug = capability.salonSlug;
  const bookingConfig = resolveBookingConfigFromSettings(capability.salonSettings as SalonSettings | null);
  const timezone = bookingConfig.timezone;
  const changePolicy = getClientChangePolicy(appointment.startTime, bookingConfig);
  const isActive = ['pending', 'confirmed'].includes(appointment.status);

  const [services, addOns, technician] = await Promise.all([
    db.select({ name: appointmentServicesSchema.nameSnapshot })
      .from(appointmentServicesSchema)
      .where(eq(appointmentServicesSchema.appointmentId, appointment.id)),
    db.select({
      name: appointmentAddOnSchema.nameSnapshot,
      quantity: appointmentAddOnSchema.quantitySnapshot,
      lineTotalCents: appointmentAddOnSchema.lineTotalCentsSnapshot,
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

  const serviceName = services.map(service => service.name).filter(Boolean).join(', ') || 'Nail appointment';
  const technicianName = technician[0]?.name ?? 'Any available artist';
  const discountAmountCents = appointment.discountAmountCents ?? 0;
  const subtotalCents = appointment.subtotalBeforeDiscountCents ?? (appointment.totalPrice + discountAmountCents);
  const statusLabel = appointment.status === 'cancelled'
    ? 'Cancelled'
    : appointment.status === 'completed'
      ? 'Completed'
      : appointment.status === 'confirmed'
        ? 'Confirmed'
        : 'Awaiting confirmation';

  const rescheduleUrl = `/${locale}/${resolvedSlug}/manage/${encodeURIComponent(token)}/reschedule`;
  const googleCalendarQuery = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${serviceName} at ${capability.salonName}`,
    dates: `${appointment.startTime.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}/${appointment.endTime.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
    details: `Booked through Luster with ${capability.salonName}.`,
  });

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-14">
      <div className="mx-auto max-w-xl">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Appointment management</p>
        <div className="mt-5 rounded-[2rem] border border-stone-200 bg-white p-6 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-rose-700">{capability.salonName}</p>
              <h1 className="mt-1 text-2xl font-semibold text-stone-900">
                {appointment.clientName ? `${appointment.clientName}'s appointment` : 'Your appointment'}
              </h1>
            </div>
            <span
              data-testid="appointment-status"
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                appointment.status === 'cancelled'
                  ? 'bg-stone-200 text-stone-700'
                  : 'bg-emerald-50 text-emerald-800'
              }`}
            >
              {statusLabel}
            </span>
          </div>

          <div className="mt-6 space-y-4 text-sm text-stone-700">
            <div className="flex gap-3">
              <CalendarDays className="size-5 shrink-0 text-rose-700" />
              <span>{formatDateInTimeZone(appointment.startTime.toISOString(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, timezone)}</span>
            </div>
            <div className="flex gap-3">
              <Clock className="size-5 shrink-0 text-rose-700" />
              <span>
                {formatTimeInTimeZone(appointment.startTime.toISOString(), {}, timezone)}
                {' – '}
                {formatTimeInTimeZone(appointment.endTime.toISOString(), {}, timezone)}
                {' · '}
                {appointment.totalDurationMinutes}
                {' minutes'}
              </span>
            </div>
            <div className="flex gap-3">
              <Scissors className="size-5 shrink-0 text-rose-700" />
              <div>
                <p>{serviceName}</p>
                {addOns.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-stone-600">
                    {addOns.map(addOn => (
                      <li key={`${addOn.name}-${addOn.lineTotalCents}`}>
                        {`+ ${addOn.name}${addOn.quantity > 1 ? ` ×${addOn.quantity}` : ''} · ${formatMoney(addOn.lineTotalCents)}`}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <User className="size-5 shrink-0 text-rose-700" />
              <span>{technicianName}</span>
            </div>
          </div>

          <div className="mt-6 rounded-2xl bg-stone-50 p-4 text-sm">
            {discountAmountCents > 0 && (
              <>
                <div className="flex justify-between text-stone-600">
                  <span>Subtotal</span>
                  <span>{formatMoney(subtotalCents)}</span>
                </div>
                <div className="mt-1 flex justify-between text-emerald-700">
                  <span className="inline-flex items-center gap-1.5">
                    <Sparkles className="size-4" />
                    {appointment.discountLabel || 'Discount'}
                  </span>
                  <span>
                    −
                    {formatMoney(discountAmountCents)}
                  </span>
                </div>
              </>
            )}
            <div className="mt-2 flex justify-between text-base font-semibold text-stone-900">
              <span>Total</span>
              <span>
                {formatMoney(appointment.totalPrice)}
                {' '}
                {bookingConfig.currency}
              </span>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <a href={`https://calendar.google.com/calendar/render?${googleCalendarQuery.toString()}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-full border border-stone-200 px-4 py-3 text-sm font-semibold text-stone-800">
              <ExternalLink className="size-4" />
              Add to Google Calendar
            </a>
            <a href={`/${locale}/${resolvedSlug}/manage/${encodeURIComponent(token)}/calendar.ics`} className="inline-flex items-center justify-center gap-2 rounded-full border border-stone-200 px-4 py-3 text-sm font-semibold text-stone-800">
              <Download className="size-4" />
              Add to Apple Calendar
            </a>
          </div>

          <div className="mt-8">
            <ManageAppointmentActions
              token={token}
              rescheduleUrl={rescheduleUrl}
              isActive={isActive}
              canChange={changePolicy.canChange}
              cutoffHours={bookingConfig.clientChangeCutoffHours}
              salonEmail={capability.salonEmail}
              salonPhone={capability.salonPhone}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
