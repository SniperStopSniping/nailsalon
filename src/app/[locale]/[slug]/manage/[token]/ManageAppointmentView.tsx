import { and, eq } from 'drizzle-orm';
import { CalendarDays, Clock, Download, ExternalLink, Scissors, Sparkles, User } from 'lucide-react';

import { describeAppointmentAccessFailure, verifyAppointmentAccessToken } from '@/libs/appointmentAccess';
import { getClientChangePolicy, resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { loadBookingEmailFinancialSummary } from '@/libs/bookingEmailFinancialSummary.server';
import { db } from '@/libs/DB';
import { formatMoney } from '@/libs/formatMoney';
import { resolveManageDepositCheckout } from '@/libs/manageDepositCheckout';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/libs/timeZone';
import { appointmentAddOnSchema, appointmentDepositSchema, appointmentServicesSchema, technicianSchema } from '@/models/Schema';
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
    // Distinguish an aged-out link from a wrong one: the SQL filter in
    // verifyAppointmentAccessToken hides expiry, and telling a customer their
    // link is invalid when it merely expired sends them hunting for a typo.
    const failure = await describeAppointmentAccessFailure(token);
    return <ManageLinkError failure={failure} findBookingHref={slug ? findBookingHref : `/${locale}`} />;
  }
  if (capability.appointment.salonId !== capability.salonId || (slug && capability.salonSlug !== slug)) {
    return <ManageLinkError failure="invalid" findBookingHref={findBookingHref} />;
  }
  const appointment = capability.appointment;
  const resolvedSlug = capability.salonSlug;
  const bookingConfig = resolveBookingConfigFromSettings(capability.salonSettings as SalonSettings | null);
  const timezone = bookingConfig.timezone;
  const changePolicy = getClientChangePolicy(appointment.startTime, bookingConfig);
  const isActive = ['pending', 'confirmed'].includes(appointment.status);
  const isTerminal = ['cancelled', 'no_show'].includes(appointment.status);
  const isAwaitingDeposit = appointment.status === 'awaiting_payment';

  const financialSummaryEligible = [
    'awaiting_payment',
    'pending',
    'confirmed',
    'in_progress',
    'completed',
    'cancelled',
    'no_show',
  ]
    .includes(appointment.status);
  const [services, addOns, technician, financialSummary, depositForResumeRows] = await Promise.all([
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
    financialSummaryEligible
      ? loadBookingEmailFinancialSummary({
          salonId: appointment.salonId,
          appointmentId: appointment.id,
        })
      : Promise.resolve(null),
    isAwaitingDeposit
      ? db
          .select({
            amountCents: appointmentDepositSchema.amountCents,
            currency: appointmentDepositSchema.currency,
            checkoutUrl: appointmentDepositSchema.stripeCheckoutUrl,
          })
          .from(appointmentDepositSchema)
          .where(and(
            eq(appointmentDepositSchema.salonId, appointment.salonId),
            eq(appointmentDepositSchema.appointmentId, appointment.id),
            eq(appointmentDepositSchema.status, 'checkout_created'),
          ))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const serviceName = services.map(service => service.name).filter(Boolean).join(', ') || 'Nail appointment';
  const technicianName = technician[0]?.name ?? 'Any available artist';
  const discountAmountCents = appointment.discountAmountCents ?? 0;
  const subtotalCents = appointment.subtotalBeforeDiscountCents ?? (appointment.totalPrice + discountAmountCents);
  const displayCurrency = financialSummary?.currency
    ?? appointment.invoiceCurrency
    ?? null;
  const depositForResume = depositForResumeRows[0] ?? null;
  const depositCheckout = isAwaitingDeposit
    ? resolveManageDepositCheckout({
        invoiceCurrency: appointment.invoiceCurrency,
        financialSummary,
        deposit: depositForResume,
      })
    : null;
  const depositDueCents = depositCheckout?.amountCents ?? null;
  const financialDetailsUnavailable = financialSummaryEligible
    && (
      financialSummary === null
      || (isAwaitingDeposit && depositDueCents === null)
    );
  const displayMoney = (cents: number) => displayCurrency && !financialDetailsUnavailable
    ? `${formatMoney(cents, displayCurrency)} ${displayCurrency}`
    : 'Unavailable';
  // A deposit hold is READ-ONLY here. Every mutating manage-token handler
  // already rejects it (ensureEditable throws HOLD_LOCKED, the PATCH cancel CAS
  // excludes it); this branch only makes the screen honest about WHY, and
  // offers the one thing the client can still usefully do — resume paying.
  const statusLabel = appointment.status === 'cancelled'
    ? 'Cancelled'
    : appointment.status === 'completed'
      ? 'Completed'
      : appointment.status === 'no_show'
        ? 'No-show'
        : isAwaitingDeposit
          ? 'Awaiting deposit'
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
                  : isAwaitingDeposit
                    ? 'bg-fuchsia-50 text-fuchsia-800'
                    : 'bg-emerald-50 text-emerald-800'
              }`}
            >
              {statusLabel}
            </span>
          </div>

          {isAwaitingDeposit
            ? (
                <div className="mt-5 rounded-2xl border border-fuchsia-200 bg-fuchsia-50 p-4">
                  <p className="text-sm font-semibold text-fuchsia-900">Awaiting deposit</p>
                  <p className="mt-1 text-sm leading-6 text-fuchsia-900/80">
                    This booking is held while we wait for the deposit. It is not confirmed yet, and it
                    cannot be changed or cancelled from here until the payment is settled.
                  </p>
                  {depositCheckout
                    ? (
                        <a
                          className="mt-3 inline-flex rounded-full bg-stone-950 px-4 py-2 text-sm font-semibold text-white"
                          href={depositCheckout.checkoutUrl}
                        >
                          Resume payment
                        </a>
                      )
                    : null}
                </div>
              )
            : null}

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
                        {`+ ${addOn.name}${addOn.quantity > 1 ? ` ×${addOn.quantity}` : ''} · ${displayMoney(addOn.lineTotalCents)}`}
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
                  <span>{displayMoney(subtotalCents)}</span>
                </div>
                <div className="mt-1 flex justify-between text-emerald-700">
                  <span className="inline-flex items-center gap-1.5">
                    <Sparkles className="size-4" />
                    {appointment.discountLabel || 'Discount'}
                  </span>
                  <span>
                    −
                    {displayMoney(discountAmountCents)}
                  </span>
                </div>
              </>
            )}
            <div className="mt-2 flex justify-between text-base font-semibold text-stone-900">
              <span>
                {['cancelled', 'no_show'].includes(appointment.status)
                  ? 'Booked services'
                  : appointment.status === 'completed' ? 'Final total' : 'Estimated total'}
              </span>
              <span>
                {!financialDetailsUnavailable && financialSummary
                  ? displayMoney(
                      isTerminal
                        ? financialSummary.serviceInvoiceTotalCents
                        : financialSummary.totalDueCents,
                    )
                  : financialSummaryEligible
                    ? 'Unavailable'
                    : displayMoney(appointment.totalPrice)}
              </span>
            </div>
            {financialDetailsUnavailable
              ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    Financial details are under review. Contact the salon for confirmed amounts.
                  </div>
                )
              : financialSummary?.depositPresentationState === 'blocked'
                ? (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      Deposit and remaining balance are under review. Contact the salon before sending payment.
                    </div>
                  )
                : financialSummary
                  ? (
                      <div className="mt-3 space-y-1.5 border-t border-stone-200 pt-3 text-sm text-stone-700">
                        {financialSummary.collectedDepositCents > 0 && (
                          <div className="flex justify-between gap-3">
                            <span>{isTerminal ? 'Deposit collected' : 'Deposit paid'}</span>
                            <span data-testid="manage-deposit-paid">
                              {displayMoney(financialSummary.collectedDepositCents)}
                            </span>
                          </div>
                        )}
                        {financialSummary.refundedDepositCents > 0 && (
                          <div className="flex justify-between gap-3">
                            <span>Deposit refunded</span>
                            <span data-testid="manage-deposit-refunded">
                              {displayMoney(financialSummary.refundedDepositCents)}
                            </span>
                          </div>
                        )}
                        {financialSummary.depositCreditAppliedCents > 0 && (
                          <div className="flex justify-between gap-3">
                            <span>Deposit payment credit</span>
                            <span data-testid="manage-deposit-credit">
                              −
                              {displayMoney(financialSummary.depositCreditAppliedCents)}
                            </span>
                          </div>
                        )}
                        {isAwaitingDeposit && (
                          <>
                            <div className="flex justify-between gap-3">
                              <span>Deposit payment credit</span>
                              <span data-testid="manage-deposit-credit">
                                {displayMoney(0)}
                              </span>
                            </div>
                            <div className="flex justify-between gap-3 font-medium">
                              <span>Deposit due now</span>
                              <span data-testid="manage-deposit-due">
                                {displayMoney(depositDueCents!)}
                              </span>
                            </div>
                          </>
                        )}
                        {financialSummary.appointmentPaymentsCents > 0 && (
                          <div className="flex justify-between gap-3">
                            <span>Other payments</span>
                            <span>{displayMoney(financialSummary.appointmentPaymentsCents)}</span>
                          </div>
                        )}
                        {financialSummary.depositPresentationState === 'refund_candidate' && (
                          <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                            Refund due for owner review. The deposit is not appointment credit.
                          </div>
                        )}
                        {financialSummary.depositPresentationState === 'refund_in_flight' && (
                          <div className="rounded-lg bg-blue-50 px-3 py-2 text-blue-900">
                            Deposit refund in progress.
                          </div>
                        )}
                        {financialSummary.depositPresentationState === 'forfeited' && (
                          <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                            Deposit retained after no-show.
                          </div>
                        )}
                        {financialSummary.depositPresentationState === 'refund_review' && (
                          <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                            Deposit handling is under review. Contact the salon for details.
                          </div>
                        )}
                        {!isTerminal && (
                          <>
                            <div className="flex justify-between gap-3 font-medium">
                              <span>Already paid</span>
                              <span data-testid="manage-already-paid">
                                {displayMoney(financialSummary.amountAlreadyPaidCents)}
                              </span>
                            </div>
                            <div className="flex justify-between gap-3 font-semibold text-stone-900">
                              <span>Remaining balance</span>
                              <span data-testid="manage-balance">
                                {displayMoney(financialSummary.balanceCents)}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  : null}
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
