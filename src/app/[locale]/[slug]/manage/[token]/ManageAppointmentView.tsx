import { and, eq } from 'drizzle-orm';
import { CalendarDays, Clock, Download, ExternalLink, MapPin, Scissors, Sparkles, User } from 'lucide-react';

import { NextVisitOfferRebook } from '@/components/appointments/NextVisitOfferRebook';
import styles from '@/components/customer-booking/customer-booking.module.css';
import { CustomerBookingShell } from '@/components/customer-booking/CustomerBookingShell';
import { describeAppointmentAccessFailure, verifyAppointmentAccessToken } from '@/libs/appointmentAccess';
import { getClientChangePolicy, resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { loadBookingEmailFinancialSummary } from '@/libs/bookingEmailFinancialSummary.server';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { db } from '@/libs/DB';
import { buildDirectionsDestination, buildGoogleMapsDirectionsUrl } from '@/libs/directions';
import { formatMoney } from '@/libs/formatMoney';
import { resolveManageDepositCheckout } from '@/libs/manageDepositCheckout';
import { getLocationById, getPrimaryLocation } from '@/libs/queries';
import { getRetentionSettingsForSalon } from '@/libs/retentionSettings.server';
import {
  applyLocationDisplayMode,
  isExactAddressPublic,
  resolveAwaitingConfirmationAddressNotice,
  resolveConfirmedBookingLocationDisplayMode,
} from '@/libs/salonContent';
import {
  resolvePublicLocationInstructions,
  resolvePublicSalonPhone,
  resolveSharedSalonProfile,
} from '@/libs/sharedSalonProfile';
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
    body: 'The link may have been copied incompletely, or it has already been replaced by a newer one. Request a fresh private link using your booking email or mobile phone.',
  },
  expired: {
    title: 'This link has expired',
    body: 'Private appointment links stop working a while after the appointment. Request a fresh one using your booking email or mobile phone.',
  },
  not_found: {
    title: 'We could not find that appointment',
    body: 'The appointment attached to this link is no longer available. Request a fresh private link, or contact the salon directly.',
  },
};

function ManageLinkError({ failure, findBookingHref }: { failure: ManageLinkFailure; findBookingHref: string }) {
  const copy = FAILURE_COPY[failure];
  return (
    <CustomerBookingShell eyebrow="Booking access">
      <div className={styles.card}>
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.intro}>{copy.body}</p>
        <a href={findBookingHref} className={`${styles.section} ${styles.button}`}>Find my booking</a>
      </div>
    </CustomerBookingShell>
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
  // The customer reached this page with a verified appointment capability, so
  // this is the ONE customer surface where "Show my full address after they
  // book" resolves to the exact address. The projection still runs through
  // `applyLocationDisplayMode`: a `city_only` owner never publishes the
  // street address, not even here.
  const liveContent = resolveBookingPageContent(capability.salonSettings).live;
  const confirmedDisplayMode = resolveConfirmedBookingLocationDisplayMode(liveContent.locationDisplayMode, appointment.status);
  const sharedProfile = resolveSharedSalonProfile(capability.salonSettings);
  const [services, addOns, technician, financialSummary, depositForResumeRows, visitLocationRow, retentionSettings] = await Promise.all([
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
    appointment.locationId
      ? getLocationById(appointment.locationId, appointment.salonId)
      : getPrimaryLocation(appointment.salonId),
    // Parking text is only ever shown together with a public/confirmed
    // address (`resolvePublicLocationInstructions` gates it), so fetching it
    // here cannot leak anything a browsing visitor would not already see.
    isExactAddressPublic(confirmedDisplayMode)
      ? getRetentionSettingsForSalon(appointment.salonId).catch(() => null)
      : Promise.resolve(null),
  ]);

  const visitLocation = visitLocationRow
    ? applyLocationDisplayMode({
      name: visitLocationRow.name,
      address: visitLocationRow.address,
      city: visitLocationRow.city,
      state: visitLocationRow.state,
      zipCode: visitLocationRow.zipCode,
    }, confirmedDisplayMode)
    : null;
  const visitDestination = buildDirectionsDestination(visitLocation);
  const visitDirectionsUrl = isExactAddressPublic(confirmedDisplayMode)
    ? buildGoogleMapsDirectionsUrl(visitLocation)
    : null;
  const visitLocationName = visitLocation?.name
    && visitLocation.name.localeCompare(capability.salonName, undefined, { sensitivity: 'accent' }) !== 0
    && !/^primary location$/iu.test(visitLocation.name)
    ? visitLocation.name
    : null;
  // `after_booking` promotes to the exact address only once the appointment is
  // CONFIRMED. While the request is still unreviewed the customer sees the city
  // and, without this line, no idea that an address is coming at all — so say
  // when it appears instead of leaving a silent gap. Null under every mode that
  // either already shows the address or never will.
  const addressNotice = resolveAwaitingConfirmationAddressNotice(
    confirmedDisplayMode,
    appointment.status,
  );
  const visitInstructions = resolvePublicLocationInstructions(sharedProfile, {
    addressIsPublic: isExactAddressPublic(confirmedDisplayMode),
    parkingInstructions: retentionSettings?.parkingInstructions ?? null,
  });

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
    details: [`Booked through Luster with ${capability.salonName}.`, addressNotice].filter(Boolean).join(' '),
    // The Google button and the Apple/.ics button must hand over the SAME
    // destination: both read `visitDestination`, built from the one
    // capability-scoped `applyLocationDisplayMode` projection above, so
    // neither can disclose more than the other.
    ...(visitDestination ? { location: visitDestination } : {}),
  });

  return (
    <CustomerBookingShell eyebrow="Appointment management">
      <div className={styles.card}>
        <div className={styles.salonRow}>
          <p className={styles.salonName}>{capability.salonName}</p>
          <span
            data-testid="appointment-status"
            className={styles.badge}
            data-tone={isTerminal ? 'neutral' : isAwaitingDeposit || appointment.status === 'pending' ? 'pending' : 'confirmed'}
          >
            {statusLabel}
          </span>
        </div>
        <h1 className={styles.title}>
          {appointment.clientName ? `${appointment.clientName}'s appointment` : 'Your appointment'}
        </h1>

        {isAwaitingDeposit
          ? (
              <div className={`${styles.section} ${styles.notice}`}>
                <p className="font-semibold">Awaiting deposit</p>
                <p className="mt-1">
                  This booking is held while we wait for the deposit. It is not confirmed yet, and it
                  cannot be changed or cancelled from here until the payment is settled.
                </p>
                {depositCheckout
                  ? (
                      <a
                        className={`mt-3 ${styles.button}`}
                        href={depositCheckout.checkoutUrl}
                      >
                        Resume payment
                      </a>
                    )
                  : null}
              </div>
            )
          : null}

        <div className={styles.details}>
          <div className={styles.detail}>
            <CalendarDays aria-hidden="true" />
            <div>
              <p className={styles.detailLabel}>When</p>
              <p className={styles.detailValue}>{formatDateInTimeZone(appointment.startTime.toISOString(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, timezone)}</p>
            </div>
          </div>
          <div className={styles.detail}>
            <Clock aria-hidden="true" />
            <div>
              <p className={styles.detailLabel}>
                Salon time
              </p>
              <p className={styles.detailValue}>
                {formatTimeInTimeZone(appointment.startTime.toISOString(), {}, timezone)}
                {' – '}
                {formatTimeInTimeZone(appointment.endTime.toISOString(), {}, timezone)}
                {' · '}
                {appointment.totalDurationMinutes}
                {' minutes'}
              </p>
            </div>
          </div>
          <div className={styles.detail}>
            <Scissors aria-hidden="true" />
            <div>
              <p className={styles.detailLabel}>Your service</p>
              <p className={styles.detailValue}>{serviceName}</p>
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
          <div className={styles.detail}>
            <User aria-hidden="true" />
            <div>
              <p className={styles.detailLabel}>With</p>
              <p className={styles.detailValue}>{technicianName}</p>
            </div>
          </div>
          {visitDestination && (
            <div className={`${styles.detail} ${styles.location}`} data-testid="manage-visit-location">
              <MapPin aria-hidden="true" />
              <div className="min-w-0">
                <p className={styles.detailLabel}>Where to find us</p>
                {visitLocationName && <p className="font-medium text-stone-900">{visitLocationName}</p>}
                <p className="break-words">{visitDestination}</p>
                {addressNotice && (
                  <p className="mt-1 text-stone-600" data-testid="manage-address-notice">{addressNotice}</p>
                )}
                {visitInstructions.map(line => (
                  <p className="mt-1 text-stone-600" key={line}>{line}</p>
                ))}
                {visitDirectionsUrl && (
                  <a
                    className={styles.textLink}
                    href={visitDirectionsUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Get directions
                    <ExternalLink className="size-4" aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        <div className={styles.summary}>
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
          <div className={styles.summaryTotal}>
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
                <div className={`mt-3 ${styles.notice}`}>
                  Financial details are under review. Contact the salon for confirmed amounts.
                </div>
              )
            : financialSummary?.depositPresentationState === 'blocked'
              ? (
                  <div className={`mt-3 ${styles.notice}`}>
                    Deposit and remaining balance are under review. Contact the salon before sending payment.
                  </div>
                )
              : financialSummary
                ? (
                    <div className={styles.summaryBreakdown}>
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

        <section className={styles.section} aria-label="Calendar options">
          <h2 className={styles.sectionTitle}>Keep the date</h2>
          <div className={styles.actionGrid}>
            <a href={`https://calendar.google.com/calendar/render?${googleCalendarQuery.toString()}`} target="_blank" rel="noreferrer" className={styles.secondaryButton}>
              <ExternalLink className="size-4" aria-hidden="true" />
              Add to Google Calendar
            </a>
            <a href={`/${locale}/${resolvedSlug}/manage/${encodeURIComponent(token)}/calendar.ics`} className={styles.secondaryButton}>
              <Download aria-hidden="true" />
              Add to Apple Calendar
            </a>
          </div>
        </section>

        <div className={styles.section}>
          {appointment.status === 'completed' && <NextVisitOfferRebook token={token} />}
          <ManageAppointmentActions
            appointmentStatus={appointment.status}
            token={token}
            rescheduleUrl={rescheduleUrl}
            isActive={isActive}
            canChange={changePolicy.canChange}
            cutoffHours={bookingConfig.clientChangeCutoffHours}
            salonPhone={resolvePublicSalonPhone(
              sharedProfile,
              capability.salonPhone,
              confirmedDisplayMode,
            )}
          />
        </div>
      </div>
    </CustomerBookingShell>
  );
}
