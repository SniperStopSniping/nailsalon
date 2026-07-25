import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import { sendBookingNotificationsForAppointmentCancelled } from '@/libs/bookingNotifications';
import {
  lockOperationalSalonClientContactWithHandle,
  resolveOperationalSalonClientByPhoneWithHandle,
  withClientLifecycleTransactionRetry,
} from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import { enqueueGoogleCalendarDelete } from '@/libs/integrationOutbox';
import {
  getAppointmentServiceNames,
  getSalonById,
  getTechnicianById,
  updateAppointmentStatus,
} from '@/libs/queries';
import { REFERRAL_REFERRER_AMOUNT_CENTS, REFERRAL_REFERRER_EXPIRY_DAYS } from '@/libs/rewardRules';
import { requireAppointmentAccess } from '@/libs/routeAccessGuards';
import { sendSalonNotificationEmail } from '@/libs/salonNotificationEmail';
import { sendCancellationConfirmation } from '@/libs/SMS';
import {
  APPOINTMENT_STATUSES,
  appointmentSchema,
  CANCEL_REASONS,
  referralSchema,
  rewardSchema,
  salonClientSchema,
  salonSchema,
} from '@/models/Schema';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const updateAppointmentSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  cancelReason: z.enum(CANCEL_REASONS).optional(),
});

const CANCELLABLE_STATUSES: Array<(typeof APPOINTMENT_STATUSES)[number]> = [
  'pending',
  'confirmed',
  'in_progress',
];

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

type AppointmentRecord = NonNullable<
  Awaited<ReturnType<typeof updateAppointmentStatus>>
>;

type CancellationTransition = {
  applied: boolean;
  appointment: AppointmentRecord;
  conflictStatus: string | null;
  operationalClientPhone: string;
};

function cancellationConflictResponse(status: string): Response {
  return Response.json(
    {
      error: {
        code: 'INVALID_STATE',
        message: `Appointment is already in "${status}" status.`,
      },
    } satisfies ErrorResponse,
    { status: 409 },
  );
}

function pointsRedeemedFromNotes(notes: string | null): number {
  const match = (notes ?? '').match(
    /\[Points redeemed:.*?(\d{1,3}(?:,\d{3})*)\s*pts/,
  );
  return match ? Number.parseInt(match[1]!.replace(/,/g, ''), 10) : 0;
}

// =============================================================================
// PATCH /api/appointments/[id] - Update appointment status
// =============================================================================

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;
    const access = await requireAppointmentAccess(appointmentId, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can update this appointment',
      assignmentForbiddenMessage: 'You can only manage your own appointments',
      clientForbiddenMessage: 'You can only update your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
    });
    if (!access.ok) {
      return access.response;
    }

    // 1. Parse and validate request body
    const body = await request.json();
    const parsed = updateAppointmentSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: parsed.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const data = parsed.data;

    // 2. Verify appointment exists
    const existingAppointment = access.appointment;

    // 3. Validate the update makes sense
    if (!data.status && !data.cancelReason) {
      return Response.json(
        {
          error: {
            code: 'NO_UPDATE_PROVIDED',
            message: 'At least one of status or cancelReason must be provided',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    if (access.actorRole === 'client') {
      const isClientCancellation = data.status === 'cancelled'
        && data.cancelReason === 'client_request';

      if (!isClientCancellation) {
        return Response.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'Clients can only cancel their own appointments',
            },
          } satisfies ErrorResponse,
          { status: 403 },
        );
      }
    }

    // 4. If cancelReason is provided, status should be 'cancelled'
    if (data.cancelReason && data.status && data.status !== 'cancelled') {
      return Response.json(
        {
          error: {
            code: 'INVALID_STATUS_FOR_CANCEL_REASON',
            message: 'cancelReason can only be set when status is "cancelled"',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 5. Cancellation is a compare-and-set transaction. Two requests may both
    // authorize against the same snapshot, but only one may transition the
    // appointment and perform dependent economic mutations.
    let cancellationApplied = false;
    let operationalClientPhone = existingAppointment.clientPhone;
    let updatedAppointment: AppointmentRecord;
    if (data.status === 'cancelled') {
      const requestedReason
        = data.cancelReason ?? existingAppointment.cancelReason ?? null;

      if (existingAppointment.status === 'cancelled') {
        if (existingAppointment.cancelReason !== requestedReason) {
          return cancellationConflictResponse(existingAppointment.status);
        }
        updatedAppointment = existingAppointment;
      } else if (
        !CANCELLABLE_STATUSES.includes(
          existingAppointment.status as (typeof APPOINTMENT_STATUSES)[number],
        )
      ) {
        return cancellationConflictResponse(existingAppointment.status);
      } else {
        const transition = await withClientLifecycleTransactionRetry(() =>
          db.transaction(async (tx): Promise<CancellationTransition> => {
            // Global order: terminal client before the appointment and every
            // other dependent row. Legacy appointments without a stable client
            // retain the existing salon-scoped phone fallback.
            let operationalClient = existingAppointment.salonClientId
              ? await lockOperationalSalonClientContactWithHandle(tx, {
                salonId: existingAppointment.salonId,
                clientId: existingAppointment.salonClientId,
                allowArchived: true,
              })
              : null;
            if (!operationalClient) {
              const terminalClient
                = await resolveOperationalSalonClientByPhoneWithHandle(tx, {
                  salonId: existingAppointment.salonId,
                  phone: existingAppointment.clientPhone,
                  allowArchived: true,
                });
              operationalClient = terminalClient
                ? await lockOperationalSalonClientContactWithHandle(tx, {
                  salonId: existingAppointment.salonId,
                  clientId: terminalClient.id,
                  allowArchived: true,
                })
                : null;
            }
            const currentPhone
              = operationalClient?.phone ?? existingAppointment.clientPhone;
            const [lockedAppointment] = await tx
              .select()
              .from(appointmentSchema)
              .where(
                and(
                  eq(appointmentSchema.id, appointmentId),
                  eq(appointmentSchema.salonId, existingAppointment.salonId),
                ),
              )
              .for('update')
              .limit(1);

            if (!lockedAppointment) {
              return {
                applied: false,
                appointment: existingAppointment,
                conflictStatus: 'missing',
                operationalClientPhone: currentPhone,
              };
            }

            if (lockedAppointment.status === 'cancelled') {
              if (lockedAppointment.cancelReason === requestedReason) {
                return {
                  applied: false,
                  appointment: lockedAppointment,
                  conflictStatus: null,
                  operationalClientPhone: currentPhone,
                };
              }
              return {
                applied: false,
                appointment: lockedAppointment,
                conflictStatus: lockedAppointment.status,
                operationalClientPhone: currentPhone,
              };
            }

            if (!CANCELLABLE_STATUSES.includes(
              lockedAppointment.status as (typeof APPOINTMENT_STATUSES)[number],
            )) {
              return {
                applied: false,
                appointment: lockedAppointment,
                conflictStatus: lockedAppointment.status,
                operationalClientPhone: currentPhone,
              };
            }

            const pointsToRefund = pointsRedeemedFromNotes(
              lockedAppointment.notes,
            );
            const now = new Date();
            const [cancelledAppointment] = await tx
              .update(appointmentSchema)
              .set({
                status: 'cancelled',
                cancelReason: requestedReason,
                updatedAt: now,
              })
              .where(
                and(
                  eq(appointmentSchema.id, appointmentId),
                  eq(appointmentSchema.salonId, existingAppointment.salonId),
                  eq(appointmentSchema.status, lockedAppointment.status),
                  inArray(appointmentSchema.status, CANCELLABLE_STATUSES),
                ),
              )
              .returning();

            if (!cancelledAppointment) {
              const [currentAppointment] = await tx
                .select({
                  status: appointmentSchema.status,
                  cancelReason: appointmentSchema.cancelReason,
                  updatedAt: appointmentSchema.updatedAt,
                })
                .from(appointmentSchema)
                .where(
                  and(
                    eq(appointmentSchema.id, appointmentId),
                    eq(appointmentSchema.salonId, existingAppointment.salonId),
                  ),
                )
                .limit(1);

              if (
                currentAppointment?.status === 'cancelled'
                && currentAppointment.cancelReason === requestedReason
              ) {
                return {
                  applied: false,
                  appointment: {
                    ...existingAppointment,
                    ...currentAppointment,
                  },
                  conflictStatus: null,
                  operationalClientPhone: currentPhone,
                };
              }

              return {
                applied: false,
                appointment: existingAppointment,
                conflictStatus: currentAppointment?.status ?? 'missing',
                operationalClientPhone: currentPhone,
              };
            }

            const [linkedReward] = await tx
              .select()
              .from(rewardSchema)
              .where(
                and(
                  eq(rewardSchema.usedInAppointmentId, appointmentId),
                  eq(rewardSchema.salonId, existingAppointment.salonId),
                ),
              )
              .limit(1);

            if (linkedReward && linkedReward.status !== 'used') {
              await tx
                .update(rewardSchema)
                .set({
                  usedInAppointmentId: null,
                  status: 'active',
                })
                .where(
                  and(
                    eq(rewardSchema.id, linkedReward.id),
                    eq(rewardSchema.salonId, existingAppointment.salonId),
                    eq(rewardSchema.usedInAppointmentId, appointmentId),
                    ne(rewardSchema.status, 'used'),
                  ),
                );
            }

            if (pointsToRefund > 0 && operationalClient) {
              await tx
                .update(salonClientSchema)
                .set({
                  loyaltyPoints: sql`COALESCE(${salonClientSchema.loyaltyPoints}, 0) + ${pointsToRefund}`,
                })
                .where(
                  and(
                    eq(salonClientSchema.salonId, existingAppointment.salonId),
                    eq(salonClientSchema.id, operationalClient.id),
                  ),
                );
            }

            return {
              applied: true,
              appointment: cancelledAppointment,
              conflictStatus: null,
              operationalClientPhone: currentPhone,
            };
          }),
        );

        if (transition.conflictStatus) {
          return cancellationConflictResponse(transition.conflictStatus);
        }

        cancellationApplied = transition.applied;
        operationalClientPhone = transition.operationalClientPhone;
        updatedAppointment = transition.appointment;
      }

      if (cancellationApplied) {
        try {
          await enqueueGoogleCalendarDelete({
            appointmentId,
            salonId: existingAppointment.salonId,
            googleCalendarEventId: existingAppointment.googleCalendarEventId,
          });
        } catch (calendarError) {
          console.error('Failed to enqueue Google Calendar deletion after cancellation:', {
            salonId: existingAppointment.salonId,
            appointmentId,
            error: calendarError,
          });
        }
      }
    } else {
      const result = await updateAppointmentStatus(
        appointmentId,
        existingAppointment.salonId,
        data.status ?? existingAppointment.status,
        data.cancelReason,
      );
      if (!result) {
        throw new Error('Failed to update appointment');
      }
      updatedAppointment = result;
    }

    // 6. Only the request that committed the cancellation transition may
    // trigger customer or salon notifications.
    if (
      cancellationApplied
      && data.cancelReason !== 'rescheduled'
    ) {
      try {
        const [salon, technician, serviceNames] = await Promise.all([
          getSalonById(existingAppointment.salonId),
          existingAppointment.technicianId
            ? getTechnicianById(existingAppointment.technicianId, existingAppointment.salonId)
            : Promise.resolve(null),
          getAppointmentServiceNames(appointmentId),
        ]);
        const notificationResults = await Promise.allSettled([
          sendCancellationConfirmation(existingAppointment.salonId, {
            phone: operationalClientPhone,
            clientName: existingAppointment.clientName || undefined,
            appointmentId,
            salonName: salon?.name || 'the salon',
          }),
          salon
            ? sendBookingNotificationsForAppointmentCancelled({
              salon: {
                id: salon.id,
                name: salon.name,
                ownerName: salon.ownerName,
                ownerPhone: salon.ownerPhone,
                ownerEmail: salon.ownerEmail,
                features: (salon.features as SalonFeatures | null | undefined) ?? null,
                settings: (salon.settings as SalonSettings | null | undefined) ?? null,
              },
              technician: technician
                ? {
                    id: technician.id,
                    name: technician.name,
                    phone: technician.phone,
                    email: technician.email,
                  }
                : null,
              appointmentId,
              clientName: existingAppointment.clientName || 'Guest',
              clientPhone: existingAppointment.clientPhone,
              services: serviceNames,
              startTime: existingAppointment.startTime.toISOString(),
              cancelReason: data.cancelReason ?? 'cancelled',
            })
            : Promise.resolve(null),
          sendSalonNotificationEmail({
            salonId: existingAppointment.salonId,
            appointmentId,
            event: 'cancelled',
            source: 'dashboard',
            cancellation: {
              reason: data.cancelReason ?? null,
              cancelledAt: new Date().toISOString(),
            },
          }),
        ]);
        for (const notificationResult of notificationResults) {
          if (notificationResult.status === 'rejected') {
            console.error('Cancellation notification failed after commit:', {
              salonId: existingAppointment.salonId,
              appointmentId,
              error: notificationResult.reason,
            });
          }
        }
      } catch (notificationPreparationError) {
        console.error('Failed to prepare cancellation notifications after commit:', {
          salonId: existingAppointment.salonId,
          appointmentId,
          error: notificationPreparationError,
        });
      }
    }

    // 7. If status changed to 'completed', handle reward completion
    if (data.status === 'completed') {
      // Mark any reward linked to this appointment as 'used'
      const linkedReward = await db
        .select()
        .from(rewardSchema)
        .where(
          and(
            eq(rewardSchema.usedInAppointmentId, appointmentId),
            eq(rewardSchema.salonId, existingAppointment.salonId),
          ),
        )
        .limit(1);

      if (linkedReward.length > 0) {
        const reward = linkedReward[0]!;
        await db
          .update(rewardSchema)
          .set({
            status: 'used',
            usedAt: new Date(),
          })
          .where(eq(rewardSchema.id, reward.id));

        // If this is a referee reward, update the referral status and create referrer reward
        if (reward.type === 'referral_referee' && reward.referralId) {
          // Update referral status to reward_earned
          await db
            .update(referralSchema)
            .set({ status: 'reward_earned' })
            .where(eq(referralSchema.id, reward.referralId));

          // Get the referral to find the referrer info
          const [referral] = await db
            .select()
            .from(referralSchema)
            .where(eq(referralSchema.id, reward.referralId))
            .limit(1);

          if (referral) {
            // Fetch salon to resolve loyalty points
            const [referralSalon] = await db
              .select()
              .from(salonSchema)
              .where(eq(salonSchema.id, referral.salonId))
              .limit(1);

            // Skip referrer bonus if salon no longer exists (FK allows orphaned referrals)
            if (referralSalon) {
              // Create a reward for the referrer (uses salon-resolved points)
              await db.insert(rewardSchema).values({
                id: `reward_${crypto.randomUUID()}`,
                salonId: referral.salonId,
                clientPhone: referral.referrerPhone,
                clientName: referral.referrerName,
                referralId: referral.id,
                type: 'referral_referrer',
                points: 0,
                discountType: 'fixed_amount',
                discountAmountCents: REFERRAL_REFERRER_AMOUNT_CENTS,
                eligibleServiceName: null,
                status: 'active',
                // Referrer reward expires in 1 year
                expiresAt: new Date(Date.now() + REFERRAL_REFERRER_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
              });
            }
          }
        }
      }
    }

    return Response.json({
      data: { appointment: updatedAppointment },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    console.error('Error updating appointment:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while updating the appointment',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// GET /api/appointments/[id] - Get appointment by ID
// =============================================================================

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;
    const access = await requireAppointmentAccess(appointmentId, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can view this appointment',
      assignmentForbiddenMessage: 'You can only view your own appointments',
      clientForbiddenMessage: 'You can only view your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
    });
    if (!access.ok) {
      return access.response;
    }

    return Response.json({
      data: { appointment: access.appointment },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    console.error('Error fetching appointment:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while fetching the appointment',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
