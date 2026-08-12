/**
 * Post-commit booking side effects (D4.5).
 *
 * BEHAVIOUR-FREE EXTRACTION. Every statement in `runBookingCommitSideEffects`
 * was moved verbatim out of the POST handler in
 * `src/app/api/appointments/route.ts`; none of it was rewritten. The extraction
 * exists so a SECOND caller can run the same effects for a booking whose
 * effects were deliberately skipped at commit time.
 *
 * WHY A SECOND CALLER EXISTS. A deposit hold (D4) commits an appointment in
 * `awaiting_payment` and skips all eight of these effects, because at that
 * moment nobody has paid and the booking may never become real. When the
 * deposit is later confirmed, exactly those eight effects must fire — once.
 * Re-deriving them at the confirmation site would be a second copy of the
 * highest-traffic money path in the repository, so they live here instead.
 *
 * THE SET IS NOT ARBITRARY. It is exactly D4's eight `!isDepositHold` guards in
 * `route.ts` — i.e. exactly "the effects a hold skips" — kept in their original
 * relative order. Effects that are NOT deposit-guarded (the Google review
 * decision, the reschedule cancel/SMS block) stay in the route: they belong to
 * the booking request, not to the commit.
 *
 * ORDERING CONTRACT. The route calls this AFTER the idempotency cache write.
 * The context is assembled BEFORE that write, because it shares `manageUrl`
 * with the response body. The two halves straddling the cache write are
 * deliberate and pinned by test, not incidental.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import { sendBookingNotificationsForNewBooking } from '@/libs/bookingNotifications';
import { sendCustomerBookingConfirmationEmail } from '@/libs/customerBookingEmail';
import { db } from '@/libs/DB';
import { enqueueGoogleCalendarUpsert } from '@/libs/integrationOutbox';
import { createOpaqueToken } from '@/libs/lusterSecurity';
import {
  getAppointmentServiceNames,
  getTechnicianById,
} from '@/libs/queries';
import { sendSalonNotificationEmail } from '@/libs/salonNotificationEmail';
import { sendBookingConfirmationToClient } from '@/libs/SMS';
import type { Appointment } from '@/models/Schema';
import {
  appointmentAccessTokenSchema,
  appointmentSchema,
  appointmentServicesSchema,
  clientCommunicationSchema,
  referralSchema,
  rewardSchema,
  salonClientSchema,
  salonLocationSchema,
  salonSchema,
  serviceSchema,
  technicianSchema,
} from '@/models/Schema';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

/**
 * The manage capability's lifetime, measured from the appointment's END.
 *
 * Single source of the 30-day rule. It was previously an inline
 * `endTime.getTime() + 30 * 24 * 60 * 60 * 1000` at the booking site; a second
 * minting site would have made it two literals that could drift apart.
 */
const MANAGE_CAPABILITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Formats a salon location into the single-line address the calendar upsert
 * carries. Moved here (from a route-local function) because BOTH the route and
 * the database-backed context loader need it; duplicating eleven lines would
 * have let the two copies drift.
 */
export function formatLocationAddress(location: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
} | null): string | null {
  if (!location) {
    return null;
  }

  return [location.address, location.city, location.state, location.zipCode]
    .map(part => part?.trim())
    .filter(Boolean)
    .join(', ') || null;
}

/**
 * Everything the eight effects read. Deliberately a plain data object with no
 * behaviour: the route fills it from values it already holds in memory (zero
 * extra queries), and a later caller fills it from the database via
 * `loadBookingCommitEffectsContext`.
 */
export type BookingCommitEffectsContext = {
  salon: {
    id: string;
    name: string;
    ownerName: string | null;
    ownerPhone: string | null;
    ownerEmail: string | null;
    features: SalonFeatures | null;
    settings: SalonSettings | null;
  };
  salonClientId: string;
  clientPhone: string;
  /** Null renders as 'Guest' at the sites that require a name. Preserved. */
  clientName: string | null;
  appointment: {
    id: string;
    notes: string | null;
    googleCalendarEventId: string | null;
  };
  serviceNames: string[];
  technician: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
  } | null;
  startTime: Date;
  endTime: Date;
  totalPrice: number;
  totalDurationMinutes: number;
  timeZone: string;
  manageUrl: string;
  smsConsentGranted: boolean;
  /** The reward to mark used, or null when no automatic discount applied. */
  appliedRewardId: string | null;
  actorRole: 'guest' | 'client' | 'staff' | 'admin';
  originalAppointment: Appointment | null;
  /**
   * D4's guard 4/8 second conjunct:
   * `!googleReviewEvent || googleReviewEvent.syncMode === 'bidirectional'`.
   * Carried as a resolved boolean so this module never re-derives it.
   */
  googleCalendarSyncEligible: boolean;
  locationName: string | null;
  locationAddress: string | null;
};

export type RunBookingCommitSideEffectsOptions = {
  /**
   * The Google Calendar upsert is the one effect a confirmation-time caller may
   * need to own itself (it enqueues with its own transaction handle so the
   * enqueue commits with the state change). Defaults to `true`, which is the
   * route's behaviour and keeps every existing caller byte-unchanged.
   */
  includeGoogleCalendarUpsert?: boolean;
};

/**
 * Marks the most recent eligible retention outreach as converted.
 *
 * Moved verbatim from `route.ts`. `converted` is TERMINAL, which is why the
 * route guards it and why it is first here: order among the effects is
 * preserved exactly as the route ran them.
 */
async function markLatestRetentionOutreachConverted(args: {
  salonId: string;
  salonClientId: string;
  appointmentId: string;
}): Promise<void> {
  const convertedAt = new Date();
  await db.execute(sql`
    WITH latest_eligible AS (
      SELECT id
      FROM ${clientCommunicationSchema}
      WHERE ${clientCommunicationSchema.salonId} = ${args.salonId}
        AND ${clientCommunicationSchema.salonClientId} = ${args.salonClientId}
        AND ${clientCommunicationSchema.kind} IN ('rebook', 'promo_6w', 'promo_8w')
        AND ${clientCommunicationSchema.status} IN ('prepared', 'marked_sent', 'snoozed')
      ORDER BY ${clientCommunicationSchema.createdAt} DESC
      LIMIT 1
    )
    UPDATE ${clientCommunicationSchema}
    SET status = 'converted',
        converted_at = ${convertedAt},
        updated_at = ${convertedAt},
        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ resultingAppointmentId: args.appointmentId })}::jsonb
    WHERE ${clientCommunicationSchema.id} IN (SELECT id FROM latest_eligible)
      AND ${clientCommunicationSchema.salonId} = ${args.salonId}
  `);
}

/**
 * Salon-facing "new booking" / "rescheduled" alert.
 *
 * Moved verbatim from `route.ts`.
 *
 * A reschedule in this codebase creates a brand new appointment and cancels the
 * original with cancelReason='rescheduled', so the two events are mutually
 * exclusive: a reschedule must never also announce itself as a new booking.
 *
 * Only customer-initiated reschedules notify — an owner moving an appointment
 * in their own dashboard does not need an email about their own action.
 *
 * Never throws: the booking is already committed and the client has already
 * been shown a confirmation.
 */
async function notifySalonAboutBooking(args: {
  salonId: string;
  appointmentId: string;
  actorRole: 'guest' | 'client' | 'staff' | 'admin';
  originalAppointment: Appointment | null;
  newStartTime: Date;
  newEndTime: Date;
}): Promise<void> {
  try {
    const customerInitiated = args.actorRole === 'guest' || args.actorRole === 'client';

    if (!args.originalAppointment) {
      await sendSalonNotificationEmail({
        salonId: args.salonId,
        appointmentId: args.appointmentId,
        event: 'newBooking',
        source: customerInitiated ? 'online_booking' : 'dashboard',
      });
      return;
    }

    if (!customerInitiated) {
      return;
    }

    const original = args.originalAppointment;
    const scheduleChanged
      = original.startTime.getTime() !== args.newStartTime.getTime()
      || original.endTime.getTime() !== args.newEndTime.getTime();

    if (!scheduleChanged) {
      return;
    }

    const [previousTechnician, previousServiceNames] = await Promise.all([
      original.technicianId
        ? getTechnicianById(original.technicianId, args.salonId)
        : Promise.resolve(null),
      getAppointmentServiceNames(original.id),
    ]);

    await sendSalonNotificationEmail({
      salonId: args.salonId,
      appointmentId: args.appointmentId,
      event: 'rescheduled',
      source: 'client_manage_link',
      previous: {
        appointmentId: original.id,
        startTime: original.startTime.toISOString(),
        endTime: original.endTime.toISOString(),
        technicianName: previousTechnician?.name ?? null,
        serviceSummary: previousServiceNames.join(', ') || 'Appointment',
        discountLabel: original.discountLabel,
        discountAmountCents: original.discountAmountCents ?? 0,
        totalPriceCents: original.totalPrice,
      },
    });
  } catch (error) {
    console.error('[SALON NOTIFICATION] Booking alert failed after the booking committed:', {
      salonId: args.salonId,
      appointmentId: args.appointmentId,
      error,
    });
  }
}

/**
 * Runs the eight post-commit effects a deposit hold skips, in the order the
 * booking route ran them.
 *
 * Each effect keeps the exact failure posture it had in the route: the
 * outreach conversion and the customer email swallow their own errors (the
 * appointment is already committed, and a 500 here would encourage a duplicate
 * retry); `notifySalonAboutBooking` swallows internally; the rest propagate, as
 * they did before.
 */
export async function runBookingCommitSideEffects(
  context: BookingCommitEffectsContext,
  options: RunBookingCommitSideEffectsOptions = {},
): Promise<void> {
  const includeGoogleCalendarUpsert = options.includeGoogleCalendarUpsert ?? true;

  // 1/8. `converted` is TERMINAL — see the guard comment in the route history.
  try {
    await markLatestRetentionOutreachConverted({
      salonId: context.salon.id,
      salonClientId: context.salonClientId,
      appointmentId: context.appointment.id,
    });
  } catch (conversionError) {
    // The appointment is already committed. Timeline enrichment must never
    // turn a successful booking into a 500 that encourages a duplicate retry.
    console.error('[Retention] Failed to convert latest outreach after booking:', conversionError);
  }

  // 2/8. Link the applied reward to this appointment (mark as pending redemption).
  if (context.appliedRewardId) {
    await db
      .update(rewardSchema)
      .set({
        usedInAppointmentId: context.appointment.id,
      })
      .where(eq(rewardSchema.id, context.appliedRewardId));
  }

  // 3/8. Check for claimed referrals for this client and update status to 'booked'.
  // This handles the case where a referee (person who claimed a referral) books
  // their first appointment. Uses the client's phone and variants (source of truth).
  const phoneVariants = [
    context.clientPhone,
    `+1${context.clientPhone}`,
    `+${context.clientPhone}`,
  ];

  const claimedReferrals = await db
    .select()
    .from(referralSchema)
    .where(
      and(
        eq(referralSchema.salonId, context.salon.id),
        inArray(referralSchema.refereePhone, phoneVariants),
        eq(referralSchema.status, 'claimed'),
      ),
    );

  // Update claimed referrals based on expiry status
  for (const referral of claimedReferrals) {
    if (referral.expiresAt && new Date(referral.expiresAt) < new Date()) {
      // Referral has expired - mark as expired
      await db
        .update(referralSchema)
        .set({ status: 'expired' })
        .where(eq(referralSchema.id, referral.id));
    } else {
      // Within expiry window - update to 'booked'
      await db
        .update(referralSchema)
        .set({ status: 'booked' })
        .where(eq(referralSchema.id, referral.id));
    }
  }

  // 4/8. Google Calendar upsert.
  if (includeGoogleCalendarUpsert && context.googleCalendarSyncEligible) {
    await enqueueGoogleCalendarUpsert({
      appointmentId: context.appointment.id,
      salonId: context.salon.id,
      salonName: context.salon.name,
      clientName: context.clientName,
      clientPhone: context.clientPhone,
      serviceNames: context.serviceNames,
      technicianName: context.technician?.name ?? null,
      startTime: context.startTime,
      endTime: context.endTime,
      totalPrice: context.totalPrice,
      totalDurationMinutes: context.totalDurationMinutes,
      timeZone: context.timeZone,
      locationName: context.locationName,
      locationAddress: context.locationAddress,
      notes: context.appointment.notes,
      googleCalendarEventId: context.appointment.googleCalendarEventId,
    });
  }

  // 5/8. Customer confirmation email.
  try {
    await sendCustomerBookingConfirmationEmail({
      salonId: context.salon.id,
      appointmentId: context.appointment.id,
      salonName: context.salon.name,
      clientName: context.clientName ?? 'Guest',
      serviceNames: context.serviceNames,
      startTime: context.startTime.toISOString(),
      timeZone: context.timeZone,
      manageUrl: context.manageUrl,
    });
  } catch {
    console.error('[Booking] Customer confirmation failed after the appointment committed:', {
      salonId: context.salon.id,
      appointmentId: context.appointment.id,
    });
  }

  // 6/8. Client confirmation SMS, gated on consent exactly as before.
  if (context.smsConsentGranted) {
    await sendBookingConfirmationToClient(context.salon.id, {
      phone: context.clientPhone,
      clientName: context.clientName ?? undefined,
      appointmentId: context.appointment.id,
      salonName: context.salon.name,
      services: context.serviceNames,
      technicianName: context.technician?.name ?? 'Any available artist',
      startTime: context.startTime.toISOString(),
      totalPrice: context.totalPrice,
      timeZone: context.timeZone,
      manageUrl: context.manageUrl,
    });
  }

  // 7/8. Salon-facing appointment alert. Failures are swallowed inside the
  // helper: a notification must never undo a booking the client already saw
  // succeed.
  await notifySalonAboutBooking({
    salonId: context.salon.id,
    appointmentId: context.appointment.id,
    actorRole: context.actorRole,
    originalAppointment: context.originalAppointment,
    newStartTime: context.startTime,
    newEndTime: context.endTime,
  });

  // 8/8. Owner/staff notifications.
  await sendBookingNotificationsForNewBooking({
    salon: {
      id: context.salon.id,
      name: context.salon.name,
      ownerName: context.salon.ownerName,
      ownerPhone: context.salon.ownerPhone,
      ownerEmail: context.salon.ownerEmail,
      features: context.salon.features,
      settings: context.salon.settings,
    },
    technician: context.technician
      ? {
          id: context.technician.id,
          name: context.technician.name,
          phone: context.technician.phone,
          email: context.technician.email,
        }
      : null,
    appointmentId: context.appointment.id,
    clientName: context.clientName ?? 'Guest',
    clientPhone: context.clientPhone,
    services: context.serviceNames,
    startTime: context.startTime.toISOString(),
    totalDurationMinutes: context.totalDurationMinutes,
    totalPrice: context.totalPrice,
    timeZone: context.timeZone,
  });
}

export type LoadBookingCommitEffectsContextArgs = {
  salonId: string;
  appointmentId: string;
  /**
   * The manage URL to put in the confirmation email and SMS. The caller owns
   * it because minting a capability and rendering its URL are the caller's
   * decision — see `mintAppointmentManageCapability`.
   */
  manageUrl: string;
  smsConsentGranted: boolean;
  /**
   * Defaults to `'guest'`, which is the online-booking value and the only one
   * that reaches this loader today. It selects the salon-alert `source` label.
   */
  actorRole?: 'guest' | 'client' | 'staff' | 'admin';
  /**
   * A confirmation is never a reschedule, so this defaults to null and the
   * salon alert takes its `newBooking` arm.
   */
  originalAppointment?: Appointment | null;
  googleCalendarSyncEligible?: boolean;
  appliedRewardId?: string | null;
};

/**
 * Rebuilds a `BookingCommitEffectsContext` from the database, for a caller that
 * holds only ids — i.e. anything running after the request that created the
 * appointment has ended.
 *
 * The booking route does NOT use this: it already holds every value in memory,
 * and re-reading them would be a behaviour change, not a refactor.
 *
 * Returns null when the appointment, its salon or its client cannot be read —
 * the caller decides whether that is retryable.
 */
export async function loadBookingCommitEffectsContext(
  args: LoadBookingCommitEffectsContextArgs,
): Promise<BookingCommitEffectsContext | null> {
  const [appointment] = await db
    .select()
    .from(appointmentSchema)
    .where(and(
      eq(appointmentSchema.id, args.appointmentId),
      eq(appointmentSchema.salonId, args.salonId),
    ))
    .limit(1);

  if (!appointment) {
    return null;
  }

  const [salon] = await db
    .select()
    .from(salonSchema)
    .where(eq(salonSchema.id, args.salonId))
    .limit(1);

  if (!salon) {
    return null;
  }

  const [salonClient] = appointment.salonClientId
    ? await db
      .select()
      .from(salonClientSchema)
      .where(and(
        eq(salonClientSchema.id, appointment.salonClientId),
        eq(salonClientSchema.salonId, args.salonId),
      ))
      .limit(1)
    : [];

  if (!salonClient) {
    return null;
  }

  const serviceRows = await db
    .select({ name: serviceSchema.name })
    .from(appointmentServicesSchema)
    .innerJoin(serviceSchema, eq(appointmentServicesSchema.serviceId, serviceSchema.id))
    .where(eq(appointmentServicesSchema.appointmentId, appointment.id));

  const [technician] = appointment.technicianId
    ? await db
      .select()
      .from(technicianSchema)
      .where(and(
        eq(technicianSchema.id, appointment.technicianId),
        eq(technicianSchema.salonId, args.salonId),
      ))
      .limit(1)
    : [];

  const [location] = appointment.locationId
    ? await db
      .select()
      .from(salonLocationSchema)
      .where(and(
        eq(salonLocationSchema.id, appointment.locationId),
        eq(salonLocationSchema.salonId, args.salonId),
      ))
      .limit(1)
    : [];

  const { resolveBookingConfigFromSettings } = await import('@/libs/bookingConfig');
  const bookingConfig = resolveBookingConfigFromSettings(
    (salon.settings as SalonSettings | null | undefined) ?? null,
  );

  return {
    salon: {
      id: salon.id,
      name: salon.name,
      ownerName: salon.ownerName,
      ownerPhone: salon.ownerPhone,
      ownerEmail: salon.ownerEmail,
      features: (salon.features as SalonFeatures | null | undefined) ?? null,
      settings: (salon.settings as SalonSettings | null | undefined) ?? null,
    },
    salonClientId: salonClient.id,
    clientPhone: salonClient.phone,
    clientName: salonClient.fullName ?? null,
    appointment: {
      id: appointment.id,
      notes: appointment.notes,
      googleCalendarEventId: appointment.googleCalendarEventId,
    },
    serviceNames: serviceRows.map(row => row.name),
    technician: technician
      ? {
          id: technician.id,
          name: technician.name,
          phone: technician.phone,
          email: technician.email,
        }
      : null,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    totalPrice: appointment.totalPrice,
    totalDurationMinutes: appointment.totalDurationMinutes,
    timeZone: bookingConfig.timezone,
    manageUrl: args.manageUrl,
    smsConsentGranted: args.smsConsentGranted,
    appliedRewardId: args.appliedRewardId ?? null,
    actorRole: args.actorRole ?? 'guest',
    originalAppointment: args.originalAppointment ?? null,
    googleCalendarSyncEligible: args.googleCalendarSyncEligible ?? true,
    locationName: location?.name ?? null,
    locationAddress: formatLocationAddress(location ?? null),
  };
}

/**
 * The narrow slice of a Drizzle transaction handle this module needs. Typed
 * structurally so the module does not import the route's transaction type (and
 * so a caller may pass either a transaction or the module-level `db`).
 */
type ManageCapabilityWriter = {
  insert: typeof db.insert;
};

/**
 * Inserts an `appointment_access_token` row for an appointment and returns the
 * capability.
 *
 * This is the ONLY place the manage-capability row shape and its 30-day expiry
 * are written. The booking route had the same insert twice (fresh booking and
 * reschedule), which is why the shape is centralised here rather than copied a
 * third time by a confirmation-time caller.
 *
 * `capability` lets a caller that has already minted a token (the booking
 * route mints one before it opens its transaction, because the plaintext must
 * reach the response) reuse it. Omit it and a fresh token is minted — only the
 * HASH is persisted, so a token minted later is additive: earlier tokens for
 * the same appointment keep working, because lookups are by hash.
 */
export async function mintAppointmentManageCapability(
  tx: ManageCapabilityWriter,
  args: {
    salonId: string;
    appointmentId: string;
    /** The capability expires 30 days after the appointment ENDS. */
    appointmentEndTime: Date;
    capability?: { token: string; tokenHash: string };
  },
): Promise<{ token: string; tokenHash: string; expiresAt: Date }> {
  const capability = args.capability ?? createOpaqueToken();
  const expiresAt = new Date(args.appointmentEndTime.getTime() + MANAGE_CAPABILITY_TTL_MS);

  await tx.insert(appointmentAccessTokenSchema).values({
    id: crypto.randomUUID(),
    salonId: args.salonId,
    appointmentId: args.appointmentId,
    tokenHash: capability.tokenHash,
    expiresAt,
  });

  return { token: capability.token, tokenHash: capability.tokenHash, expiresAt };
}
