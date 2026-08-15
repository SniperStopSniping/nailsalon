import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { sendBookingNotificationsForAppointmentCancelled } from '@/libs/bookingNotifications';
import {
  lockOperationalSalonClientContactWithHandle,
  resolveOperationalSalonClientByPhoneWithHandle,
  withClientLifecycleTransactionRetry,
} from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import {
  DepositForfeitureBlockedError,
  forfeitAppointmentDepositInTx,
} from '@/libs/deposits/depositForfeiture';
import { enqueueGoogleCalendarDeleteInTx } from '@/libs/integrationOutbox';
import {
  getAppointmentServiceNames,
  getSalonById,
  getTechnicianById,
  updateSalonClientStats,
} from '@/libs/queries';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';
import { sendSalonNotificationEmail } from '@/libs/salonNotificationEmail';
import { sendCancellationConfirmation } from '@/libs/SMS';
import { appointmentSchema, CANCEL_REASONS, rewardSchema, salonClientSchema } from '@/models/Schema';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const cancelAppointmentSchema = z.object({
  cancelReason: z.enum(CANCEL_REASONS),
  notes: z.string().optional(),
});

const CANCELLABLE_STATUSES: string[] = ['pending', 'confirmed', 'in_progress'];

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

type SuccessResponse = {
  data: {
    appointment: {
      id: string;
      status: string;
      cancelReason: string;
      cancelledAt: Date;
    };
  };
};

type CancellationTransition = {
  applied: boolean;
  conflictStatus: string | null;
  cancelledAt: Date;
};

function isSameCancellation(
  appointment: { status: string; cancelReason: string | null },
  status: 'cancelled' | 'no_show',
  cancelReason: (typeof CANCEL_REASONS)[number],
): boolean {
  return appointment.status === status && appointment.cancelReason === cancelReason;
}

function invalidStateResponse(status: string): Response {
  return Response.json(
    {
      error: {
        code: 'INVALID_STATE',
        message: `Cannot cancel appointment in "${status}" status. Must be pending, confirmed, or in_progress.`,
      },
    } satisfies ErrorResponse,
    { status: 400 },
  );
}

function depositForfeitureBlockedResponse(error: DepositForfeitureBlockedError): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message: 'Deposit state must be reconciled before this appointment can be marked no-show.',
        details: {
          depositIds: error.depositIds,
          reason: error.detail,
        },
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
// PATCH /api/appointments/[id]/cancel - Cancel an appointment
// =============================================================================
// Staff endpoint to cancel an appointment with a reason.
// Valid reasons: 'rescheduled', 'client_request', 'no_show'
// This also unlinks any pending rewards tied to this appointment.
// =============================================================================

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;
    const access = await requireAppointmentManagerAccess(appointmentId, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can cancel this appointment',
      assignmentForbiddenMessage: 'You can only cancel your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
    });
    if (!access.ok) {
      return access.response;
    }

    // 1. Parse and validate request body
    const body = await request.json();
    const validated = cancelAppointmentSchema.safeParse(body);

    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: validated.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 2. Verify appointment exists
    const appointment = access.appointment;

    // 3. A no-show is its own terminal status —
    // writing it as "cancelled" made every no-show metric read zero.
    // canvas_state is kept in sync so the staff flow sees the same outcome.
    const now = new Date();
    const resolvedStatus = validated.data.cancelReason === 'no_show' ? 'no_show' : 'cancelled';
    const alreadyCancelled = isSameCancellation(
      appointment,
      resolvedStatus,
      validated.data.cancelReason,
    );
    if (!CANCELLABLE_STATUSES.includes(appointment.status) && !alreadyCancelled) {
      return invalidStateResponse(appointment.status);
    }

    // The terminal transition and every balance mutation are one atomic unit.
    // The status predicate is the compare-and-set: concurrent requests may both
    // authenticate against the old snapshot, but exactly one can transition the
    // row and therefore exactly one can restore rewards/refund points.
    let transition: CancellationTransition;
    let operationalClientPhone = appointment.clientPhone;
    if (alreadyCancelled) {
      if (resolvedStatus === 'no_show') {
        transition = await db.transaction(async (tx): Promise<CancellationTransition> => {
          const [lockedAppointment] = await tx
            .select()
            .from(appointmentSchema)
            .where(and(
              eq(appointmentSchema.id, appointmentId),
              eq(appointmentSchema.salonId, appointment.salonId),
            ))
            .for('update')
            .limit(1);
          if (!lockedAppointment) {
            return { applied: false, conflictStatus: 'missing', cancelledAt: now };
          }
          await forfeitAppointmentDepositInTx({
            tx,
            salonId: appointment.salonId,
            appointmentId,
            invoiceCurrency: lockedAppointment.invoiceCurrency,
            forfeitedAt: now,
            appointmentLockHeld: true,
          });
          return {
            applied: false,
            conflictStatus: null,
            cancelledAt: lockedAppointment.updatedAt,
          };
        });
      } else {
        transition = {
          applied: false,
          conflictStatus: null,
          cancelledAt: appointment.updatedAt ?? now,
        };
      }
    } else {
      transition = await withClientLifecycleTransactionRetry(() =>
        db.transaction(async (tx): Promise<CancellationTransition> => {
          let operationalClient = appointment.salonClientId
            ? await lockOperationalSalonClientContactWithHandle(tx, {
              salonId: appointment.salonId,
              clientId: appointment.salonClientId,
              allowArchived: true,
            })
            : null;
          if (!operationalClient) {
            const terminalClient
              = await resolveOperationalSalonClientByPhoneWithHandle(tx, {
                salonId: appointment.salonId,
                phone: appointment.clientPhone,
                allowArchived: true,
              });
            operationalClient = terminalClient
              ? await lockOperationalSalonClientContactWithHandle(tx, {
                salonId: appointment.salonId,
                clientId: terminalClient.id,
                allowArchived: true,
              })
              : null;
          }
          operationalClientPhone
            = operationalClient?.phone ?? appointment.clientPhone;
          const [lockedAppointment] = await tx
            .select()
            .from(appointmentSchema)
            .where(and(
              eq(appointmentSchema.id, appointmentId),
              eq(appointmentSchema.salonId, appointment.salonId),
            ))
            .for('update')
            .limit(1);

          if (!lockedAppointment) {
            return {
              applied: false,
              conflictStatus: 'missing',
              cancelledAt: now,
            };
          }

          if (isSameCancellation(
            lockedAppointment,
            resolvedStatus,
            validated.data.cancelReason,
          )) {
            if (resolvedStatus === 'no_show') {
              await forfeitAppointmentDepositInTx({
                tx,
                salonId: appointment.salonId,
                appointmentId,
                invoiceCurrency: lockedAppointment.invoiceCurrency,
                forfeitedAt: now,
                appointmentLockHeld: true,
              });
            }
            return {
              applied: false,
              conflictStatus: null,
              cancelledAt: lockedAppointment.updatedAt,
            };
          }

          if (!CANCELLABLE_STATUSES.includes(lockedAppointment.status)) {
            return {
              applied: false,
              conflictStatus: lockedAppointment.status,
              cancelledAt: now,
            };
          }

          const pointsToRefund = pointsRedeemedFromNotes(
            lockedAppointment.notes,
          );
          const mutationVersion = new Date(Math.max(
            now.getTime(),
            lockedAppointment.updatedAt.getTime() + 1,
          ));
          const [cancelledAppointment] = await tx
            .update(appointmentSchema)
            .set({
              status: resolvedStatus,
              canvasState: resolvedStatus === 'no_show' ? 'no_show' : 'cancelled',
              canvasStateUpdatedAt: now,
              cancelReason: validated.data.cancelReason,
              notes: validated.data.notes || lockedAppointment.notes,
              updatedAt: mutationVersion,
            })
            .where(
              and(
                eq(appointmentSchema.id, appointmentId),
                eq(appointmentSchema.salonId, appointment.salonId),
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
              .where(and(
                eq(appointmentSchema.id, appointmentId),
                eq(appointmentSchema.salonId, appointment.salonId),
              ))
              .limit(1);

            if (currentAppointment && isSameCancellation(
              currentAppointment,
              resolvedStatus,
              validated.data.cancelReason,
            )) {
              return {
                applied: false,
                conflictStatus: null,
                cancelledAt: currentAppointment.updatedAt,
              };
            }

            return {
              applied: false,
              conflictStatus: currentAppointment?.status ?? 'missing',
              cancelledAt: now,
            };
          }

          if (resolvedStatus === 'no_show') {
            await forfeitAppointmentDepositInTx({
              tx,
              salonId: appointment.salonId,
              appointmentId,
              invoiceCurrency: cancelledAppointment.invoiceCurrency,
              forfeitedAt: now,
              appointmentLockHeld: true,
            });
          }

          // Return pending rewards to active inside the same transaction.
          const [linkedReward] = await tx
            .select()
            .from(rewardSchema)
            .where(and(
              eq(rewardSchema.usedInAppointmentId, appointmentId),
              eq(rewardSchema.salonId, appointment.salonId),
            ))
            .limit(1);

          if (linkedReward && linkedReward.status !== 'used') {
            await tx
              .update(rewardSchema)
              .set({
                usedInAppointmentId: null,
                status: 'active',
              })
              .where(and(
                eq(rewardSchema.id, linkedReward.id),
                eq(rewardSchema.salonId, appointment.salonId),
                eq(rewardSchema.usedInAppointmentId, appointmentId),
              ));
          }

          await enqueueGoogleCalendarDeleteInTx(tx, {
            appointmentId: cancelledAppointment.id,
            salonId: cancelledAppointment.salonId,
            mutationVersion: cancelledAppointment.updatedAt,
            googleCalendarEventId: cancelledAppointment.googleCalendarEventId,
          });

          if (pointsToRefund > 0 && operationalClient) {
            await tx
              .update(salonClientSchema)
              .set({
                loyaltyPoints: sql`COALESCE(${salonClientSchema.loyaltyPoints}, 0) + ${pointsToRefund}`,
              })
              .where(and(
                eq(salonClientSchema.salonId, appointment.salonId),
                eq(salonClientSchema.id, operationalClient.id),
              ));
          }

          return {
            applied: true,
            conflictStatus: null,
            cancelledAt: cancelledAppointment.updatedAt,
          };
        }),
      );
    }

    if (transition.conflictStatus) {
      return invalidStateResponse(transition.conflictStatus);
    }

    // No-show statistics and outbound notifications only belong to the request
    // that won the state transition. Retried/idempotent requests do not repeat
    // either side effect.
    if (transition.applied && validated.data.cancelReason === 'no_show') {
      updateSalonClientStats(appointment.salonId, operationalClientPhone).catch((statsError) => {
        console.error('Failed to update salon client stats:', statsError);
      });
    }

    // Send cancellation notifications after the transaction commits.
    // No-shows are excluded: telling a client who missed their appointment
    // that it "was cancelled" is confusing — a follow-up is a separate flow.
    if (
      transition.applied
      && validated.data.cancelReason !== 'rescheduled'
      && validated.data.cancelReason !== 'no_show'
    ) {
      try {
        const [salon, technician, serviceNames] = await Promise.all([
          getSalonById(appointment.salonId),
          appointment.technicianId
            ? getTechnicianById(appointment.technicianId, appointment.salonId)
            : Promise.resolve(null),
          getAppointmentServiceNames(appointmentId),
        ]);
        const notificationResults = await Promise.allSettled([
          sendCancellationConfirmation(appointment.salonId, {
            phone: operationalClientPhone,
            clientName: appointment.clientName || undefined,
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
              clientName: appointment.clientName || 'Guest',
              clientPhone: appointment.clientPhone,
              services: serviceNames,
              startTime: appointment.startTime.toISOString(),
              cancelReason: validated.data.cancelReason,
            })
            : Promise.resolve(),
          sendSalonNotificationEmail({
            salonId: appointment.salonId,
            appointmentId,
            event: 'cancelled',
            source: 'dashboard',
            cancellation: {
              reason: validated.data.cancelReason ?? null,
              cancelledAt: (transition.cancelledAt ?? new Date()).toISOString(),
            },
          }),
        ]);

        for (const result of notificationResults) {
          if (result.status === 'rejected') {
            console.error('Cancellation notification failed after cancellation committed:', result.reason);
          }
        }
      } catch (notificationError) {
        console.error('Failed to prepare cancellation notifications after cancellation committed:', notificationError);
      }
    }

    // 7. Return success response
    const response: SuccessResponse = {
      data: {
        appointment: {
          id: appointmentId,
          status: resolvedStatus,
          cancelReason: validated.data.cancelReason,
          cancelledAt: transition.cancelledAt,
        },
      },
    };

    return Response.json(response);
  } catch (error) {
    if (error instanceof DepositForfeitureBlockedError) {
      return depositForfeitureBlockedResponse(error);
    }
    console.error('Error cancelling appointment:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to cancel appointment',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
