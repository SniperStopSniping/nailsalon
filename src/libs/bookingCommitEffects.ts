/**
 * Post-commit booking side effects (D4.5).
 *
 * SHARED SIDE-EFFECT RUNNER. This began as an extraction from the POST handler
 * in `src/app/api/appointments/route.ts`; it now also carries the replay,
 * cancellation, and durable-calendar ownership needed by the confirmation
 * worker. A SECOND caller can therefore run the same effect set for a booking
 * whose effects were deliberately skipped at commit time.
 *
 * WHY A SECOND CALLER EXISTS. A deposit hold (D4) commits an appointment in
 * `awaiting_payment` and skips all eight of these effects, because at that
 * moment nobody has paid and the booking may never become real. When the
 * deposit is later confirmed, exactly those eight effect sites become eligible.
 * The durable confirmation aggregate is at-least-once, so this runner may be
 * entered more than once and every effect keeps its own replay posture.
 * Re-deriving the effects at the confirmation site would be a second copy of
 * the highest-traffic money path in the repository, so they live here instead.
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

import { loadBookingEmailFinancialSummary } from '@/libs/bookingEmailFinancialSummary.server';
import { sendBookingNotificationsForNewBooking } from '@/libs/bookingNotifications';
import { sendCustomerBookingConfirmationEmail } from '@/libs/customerBookingEmail';
import { db } from '@/libs/DB';
import {
  enqueueGoogleCalendarAppointmentMutation,
  enqueueGoogleCalendarUpsert,
} from '@/libs/integrationOutbox';
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
    updatedAt: Date;
    status?: string;
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
   * Paid confirmation passes the durable aggregate job identity so its child
   * calendar operation has one immutable cause across aggregate retries and
   * appointment moves. Ordinary booking callers omit it and retain the normal
   * immutable mutation-version identity used by independent create/reschedule
   * work.
   */
  calendarCause?: { kind: 'deposit_confirmation'; parentJobId: string };
  /** The booking transaction already committed the matching Calendar intent. */
  calendarAlreadyEnqueued?: boolean;
  /**
   * Parent worker budget. Provider helpers finish any already-dispatched
   * provider bookkeeping, then this runner stops before starting another leg.
   */
  signal?: AbortSignal;
};

function throwIfBookingEffectsAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('BOOKING_COMMIT_EFFECTS_ABORTED');
}

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
 * `originalAppointment` is this helper's explicit discriminator: absent means
 * a new booking; present plus a customer-visible schedule change means a
 * reschedule. That classification is independent of whether another flow
 * mutates one row in place or replaces and cancels an earlier row.
 *
 * Only customer-initiated reschedules notify — an owner moving an appointment
 * in their own dashboard does not need an email about their own action.
 *
 * Ordinary notification failures never throw: the booking is already
 * committed and the client has already been shown a confirmation. A supplied
 * parent-worker abort is different; it propagates so the durable aggregate can
 * retry the undispatched later legs.
 */
async function notifySalonAboutBooking(args: {
  salonId: string;
  appointmentId: string;
  actorRole: 'guest' | 'client' | 'staff' | 'admin';
  originalAppointment: Appointment | null;
  newStartTime: Date;
  newEndTime: Date;
  signal?: AbortSignal;
}): Promise<void> {
  try {
    throwIfBookingEffectsAborted(args.signal);
    const customerInitiated = args.actorRole === 'guest' || args.actorRole === 'client';

    if (!args.originalAppointment) {
      await sendSalonNotificationEmail({
        salonId: args.salonId,
        appointmentId: args.appointmentId,
        event: 'newBooking',
        source: customerInitiated ? 'online_booking' : 'dashboard',
        ...(args.signal ? { signal: args.signal } : {}),
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
    throwIfBookingEffectsAborted(args.signal);

    await sendSalonNotificationEmail({
      salonId: args.salonId,
      appointmentId: args.appointmentId,
      event: 'rescheduled',
      source: 'client_manage_link',
      ...(args.signal ? { signal: args.signal } : {}),
      previous: {
        appointmentId: original.id,
        startTime: original.startTime.toISOString(),
        endTime: original.endTime.toISOString(),
        technicianName: previousTechnician?.name ?? null,
        serviceSummary: previousServiceNames.join(', ') || 'Appointment',
        discountLabel: original.discountLabel,
        discountAmountCents: original.discountAmountCents ?? 0,
      },
    });
  } catch (error) {
    // Ordinary notification failures remain best-effort, but a parent-budget
    // abort must reach the aggregate worker so it can retry the unfinished
    // later legs instead of falsely completing the batch.
    throwIfBookingEffectsAborted(args.signal);
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
 * Each effect keeps the failure posture it had in the route. Retention,
 * customer email, salon email and owner/staff delivery absorb their ordinary
 * delivery failures; reward/referral/calendar work and unexpected dependency
 * failures may still propagate. This function is not a once-only delivery
 * boundary: customer and salon email own stable local claims, while client SMS
 * and owner/staff delivery are best-effort and may be invoked again when the
 * aggregate is replayed after a crash or another propagated failure.
 */
export async function runBookingCommitSideEffects(
  context: BookingCommitEffectsContext,
  options: RunBookingCommitSideEffectsOptions = {},
): Promise<void> {
  throwIfBookingEffectsAborted(options.signal);
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
  throwIfBookingEffectsAborted(options.signal);

  // 2/8. Link the applied reward to this appointment (mark as pending redemption).
  if (context.appliedRewardId) {
    await db
      .update(rewardSchema)
      .set({
        usedInAppointmentId: context.appointment.id,
      })
      .where(eq(rewardSchema.id, context.appliedRewardId));
    throwIfBookingEffectsAborted(options.signal);
  }

  // 3/8. Check for claimed referrals for this client and update status to 'booked'.
  // This handles the case where a referee (person who claimed a referral) books
  // their first appointment. Uses the client's phone and variants (source of truth).
  const phoneVariants = [
    context.clientPhone,
    `+1${context.clientPhone}`,
    `+${context.clientPhone}`,
  ];

  throwIfBookingEffectsAborted(options.signal);

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
  throwIfBookingEffectsAborted(options.signal);

  // Update claimed referrals based on expiry status
  for (const referral of claimedReferrals) {
    throwIfBookingEffectsAborted(options.signal);
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
    throwIfBookingEffectsAborted(options.signal);
  }

  // 4/8. Google Calendar upsert.
  throwIfBookingEffectsAborted(options.signal);
  if (context.googleCalendarSyncEligible) {
    const calendarInput = {
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
    };
    if (options.calendarAlreadyEnqueued) {
      // The booking transaction owns this intent; never enqueue it again here.
    } else if (options.calendarCause) {
      await enqueueGoogleCalendarUpsert(calendarInput, {
        cause: options.calendarCause,
        mutationVersion: context.appointment.updatedAt,
      });
    } else {
      await db.transaction(tx => enqueueGoogleCalendarAppointmentMutation(tx, {
        appointmentId: context.appointment.id,
        salonId: context.salon.id,
        mutationVersion: context.appointment.updatedAt,
      }));
    }
  }
  throwIfBookingEffectsAborted(options.signal);

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
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    console.error('[Booking] Customer confirmation failed after the appointment committed:', {
      salonId: context.salon.id,
      appointmentId: context.appointment.id,
    });
  }
  throwIfBookingEffectsAborted(options.signal);

  // Resolve money once for both SMS audiences from the immutable tax snapshot,
  // canonical deposit resolver, and appointment-payment ledger. A null result
  // is deliberate: the templates keep confirming the appointment but suppress
  // every definitive amount until the financial evidence is reconciled.
  let financialSummary = null;
  try {
    financialSummary = await loadBookingEmailFinancialSummary({
      salonId: context.salon.id,
      appointmentId: context.appointment.id,
    });
  } catch {
    console.error('[Booking] SMS financial summary unavailable after the appointment committed:', {
      salonId: context.salon.id,
      appointmentId: context.appointment.id,
    });
  }
  throwIfBookingEffectsAborted(options.signal);

  // 6/8. Client confirmation SMS. MODE-FIRST (Gate C1, owner decision 2.2):
  // shared-Luster salons get their confirmation through the durable
  // communication-intent pipeline — materialized in-transaction by the
  // deposit seam and the booking route — which is exactly-once per
  // authoritative transition, so the legacy leg MUST NOT also fire (its
  // delivery identity is per attempt, and an aggregate replay of this
  // at-least-once runner can invoke it again: the historical double-send).
  // BYO salons keep this path byte-identical; provider failures are absorbed
  // by the SMS helper exactly as before.
  const { resolveSalonCommunicationContext } = await import('@/libs/communicationMaterialization');
  const communicationContext = await resolveSalonCommunicationContext(db, context.salon.id);
  if (context.smsConsentGranted && !communicationContext.smsEligible) {
    const smsParams = {
      phone: context.clientPhone,
      clientName: context.clientName ?? undefined,
      appointmentId: context.appointment.id,
      salonName: context.salon.name,
      services: context.serviceNames,
      technicianName: context.technician?.name ?? 'Any available artist',
      startTime: context.startTime.toISOString(),
      financialSummary,
      timeZone: context.timeZone,
      manageUrl: context.manageUrl,
    };
    if (options.signal) {
      await sendBookingConfirmationToClient(
        context.salon.id,
        smsParams,
        { signal: options.signal },
      );
    } else {
      await sendBookingConfirmationToClient(context.salon.id, smsParams);
    }
  }
  throwIfBookingEffectsAborted(options.signal);

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
    signal: options.signal,
  });
  throwIfBookingEffectsAborted(options.signal);

  // 8/8. Owner/staff notifications. The helper deduplicates matching
  // destinations within this invocation, but not across aggregate attempts.
  const notificationContext = {
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
    financialSummary,
    timeZone: context.timeZone,
  };
  if (options.signal) {
    await sendBookingNotificationsForNewBooking(
      notificationContext,
      { signal: options.signal },
    );
  } else {
    await sendBookingNotificationsForNewBooking(notificationContext);
  }
  throwIfBookingEffectsAborted(options.signal);
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
      updatedAt: appointment.updatedAt,
      status: appointment.status,
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
