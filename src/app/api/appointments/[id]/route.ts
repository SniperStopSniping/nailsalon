import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  ACTIVE_APPOINTMENT_STATUSES,
  getActiveAppointmentsForCanonicalClientWithHandle,
} from '@/libs/activeAppointments';
import { validateAppointmentTaxSnapshotChain } from '@/libs/appointmentTaxSnapshot';
import {
  lockTechnicianAndAssertSlotFree,
  SlotConflictError,
} from '@/libs/bookingConflictGuard';
import { sendBookingNotificationsForAppointmentCancelled } from '@/libs/bookingNotifications';
import {
  ClientLifecycleStabilizationError,
  lockOperationalSalonClientContactWithHandle,
  resolveCanonicalSalonClientIdentityWithHandle,
  resolveOperationalSalonClientByPhoneWithHandle,
  resolveTerminalSalonClientWithHandle,
  withClientLifecycleTransactionRetry,
} from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import { resolveDepositCredit } from '@/libs/depositCredit';
import { loadAppointmentDepositCreditRows } from '@/libs/depositCredit.server';
import {
  DepositForfeitureBlockedError,
  forfeitAppointmentDepositInTx,
} from '@/libs/deposits/depositForfeiture';
import {
  enqueueGoogleCalendarAppointmentMutation,
  enqueueGoogleCalendarDeleteInTx,
} from '@/libs/integrationOutbox';
import {
  getAppointmentServiceNames,
  getSalonById,
  getTechnicianById,
  updateAppointmentStatus,
} from '@/libs/queries';
import { requireAppointmentAccess } from '@/libs/routeAccessGuards';
import { sendSalonNotificationEmail } from '@/libs/salonNotificationEmail';
import { sendCancellationConfirmation } from '@/libs/SMS';
import {
  APPOINTMENT_STATUSES,
  appointmentSchema,
  CANCEL_REASONS,
  rewardSchema,
  salonClientSchema,
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

const TERMINAL_APPOINTMENT_STATUSES = [
  'cancelled',
  'completed',
  'no_show',
] as const;

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

type ReactivationTransition = {
  applied: boolean;
  appointment: AppointmentRecord;
  conflictStatus: string | null;
};

class ActiveAppointmentConflictError extends Error {
  constructor() {
    super('CLIENT_ALREADY_HAS_ACTIVE_APPOINTMENT');
    this.name = 'ActiveAppointmentConflictError';
  }
}

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

function reactivationConflictResponse(status?: string | null): Response {
  if (status === 'completed_requires_admin_reopen') {
    return Response.json(
      {
        error: {
          code: 'ADMIN_REOPEN_REQUIRED',
          message: 'Completed appointments can only be reopened through the dedicated admin reopen flow.',
        },
      } satisfies ErrorResponse,
      { status: 409 },
    );
  }
  if (status === 'final_invoice_revision_required') {
    return Response.json(
      {
        error: {
          code: 'INVOICE_REVISION_UNSUPPORTED',
          message: 'This finalized invoice cannot be reactivated without immutable invoice revision history.',
        },
      } satisfies ErrorResponse,
      { status: 409 },
    );
  }
  if (status === 'financial_reconciliation_required') {
    return Response.json(
      {
        error: {
          code: 'APPOINTMENT_FINANCIAL_RECONCILIATION_REQUIRED',
          message: 'The appointment financial history must be reconciled before it can be reactivated.',
        },
      } satisfies ErrorResponse,
      { status: 409 },
    );
  }
  if (status === 'deposit_forfeited') {
    return Response.json(
      {
        error: {
          code: 'DEPOSIT_FORFEITURE_REACTIVATION_BLOCKED',
          message: 'This no-show retained a deposit. Refund and reconcile it before reactivating the appointment.',
        },
      } satisfies ErrorResponse,
      { status: 409 },
    );
  }
  return Response.json(
    {
      error: {
        code: 'INVALID_STATE',
        message: status
          ? `Appointment cannot be reactivated from "${status}" status.`
          : 'Appointment cannot be reactivated safely.',
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

    // 1b. 'awaiting_payment' is not a status this route may WRITE. It is
    // reachable only by the booking transaction that creates the hold; letting
    // it in here would manufacture a hold on an already-committed appointment,
    // with no deposit row behind it and nothing to reap it.
    if (data.status === 'awaiting_payment') {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'awaiting_payment cannot be set through this endpoint',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 2. Verify appointment exists
    const existingAppointment = access.appointment;

    // 2b. ...and a hold is not a status this route may write FROM, for any
    // target. Evaluated against `access.appointment` deliberately: that is the
    // same snapshot the blind `updateAppointmentStatus` writer below would act
    // on, so checking it here forecloses the stale-read stomp rather than
    // merely narrowing the window.
    if (existingAppointment.status === 'awaiting_payment') {
      return Response.json(
        {
          error: {
            code: 'HOLD_LOCKED',
            message: 'This appointment is awaiting a deposit payment and cannot be changed.',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    // Completion is a financial write, not a generic status toggle. The
    // canonical checkout endpoint locks tax configuration, deposit history,
    // and payment ledger before issuing the final invoice. Keeping this path
    // status-only would bypass every D6.1 invariant (and legacy reward hooks).
    // The source hold guard remains first so an unpaid hold always reports its
    // stronger immutable-state error regardless of the requested target.
    if (data.status === 'completed') {
      return Response.json(
        {
          error: {
            code: 'CHECKOUT_COMPLETION_REQUIRED',
            message: 'Use the appointment checkout to finalize the invoice and complete this appointment.',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    if (
      existingAppointment.status === 'completed'
      && data.status
      && ACTIVE_APPOINTMENT_STATUSES.includes(
        data.status as (typeof ACTIVE_APPOINTMENT_STATUSES)[number],
      )
    ) {
      return reactivationConflictResponse('completed_requires_admin_reopen');
    }

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
            const now = new Date(Math.max(
              Date.now(),
              lockedAppointment.updatedAt.getTime() + 1,
            ));
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
    } else if (data.status === 'no_show') {
      const transition = await withClientLifecycleTransactionRetry(() =>
        db.transaction(async (tx): Promise<ReactivationTransition> => {
          const [lockedAppointment] = await tx
            .select()
            .from(appointmentSchema)
            .where(and(
              eq(appointmentSchema.id, appointmentId),
              eq(appointmentSchema.salonId, existingAppointment.salonId),
            ))
            .for('update')
            .limit(1);

          if (!lockedAppointment) {
            return {
              applied: false,
              appointment: existingAppointment,
              conflictStatus: 'missing',
            };
          }
          if (lockedAppointment.status === 'no_show') {
            await forfeitAppointmentDepositInTx({
              tx,
              salonId: existingAppointment.salonId,
              appointmentId,
              invoiceCurrency: lockedAppointment.invoiceCurrency,
              forfeitedAt: new Date(),
              appointmentLockHeld: true,
            });
            return {
              applied: false,
              appointment: lockedAppointment,
              conflictStatus: null,
            };
          }
          if (!CANCELLABLE_STATUSES.includes(
            lockedAppointment.status as (typeof APPOINTMENT_STATUSES)[number],
          )) {
            return {
              applied: false,
              appointment: lockedAppointment,
              conflictStatus: lockedAppointment.status,
            };
          }

          const [noShowAppointment] = await tx
            .update(appointmentSchema)
            .set({
              status: 'no_show',
              cancelReason: 'no_show',
              updatedAt: new Date(Math.max(
                Date.now(),
                lockedAppointment.updatedAt.getTime() + 1,
              )),
            })
            .where(and(
              eq(appointmentSchema.id, appointmentId),
              eq(appointmentSchema.salonId, existingAppointment.salonId),
              eq(appointmentSchema.status, lockedAppointment.status),
              inArray(appointmentSchema.status, CANCELLABLE_STATUSES),
            ))
            .returning();

          if (!noShowAppointment) {
            return {
              applied: false,
              appointment: lockedAppointment,
              conflictStatus: 'stale',
            };
          }

          await forfeitAppointmentDepositInTx({
            tx,
            salonId: existingAppointment.salonId,
            appointmentId,
            invoiceCurrency: noShowAppointment.invoiceCurrency,
            forfeitedAt: noShowAppointment.updatedAt,
            appointmentLockHeld: true,
          });

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

          await enqueueGoogleCalendarDeleteInTx(tx, {
            appointmentId: noShowAppointment.id,
            salonId: noShowAppointment.salonId,
            mutationVersion: noShowAppointment.updatedAt,
            googleCalendarEventId: noShowAppointment.googleCalendarEventId,
          });

          return {
            applied: true,
            appointment: noShowAppointment,
            conflictStatus: null,
          };
        }),
      );
      if (transition.conflictStatus) {
        return cancellationConflictResponse(transition.conflictStatus);
      }
      updatedAppointment = transition.appointment;
    } else if (
      data.status
      && ACTIVE_APPOINTMENT_STATUSES.includes(
        data.status as (typeof ACTIVE_APPOINTMENT_STATUSES)[number],
      )
    ) {
      const transition = await withClientLifecycleTransactionRetry(() =>
        db.transaction(async (tx): Promise<ReactivationTransition> => {
          // Global order for active-state writes:
          // terminal client -> technician advisory lock -> appointment row ->
          // lineage-wide active check -> compare-and-set.
          let terminalClient = existingAppointment.salonClientId
            ? await lockOperationalSalonClientContactWithHandle(tx, {
              salonId: existingAppointment.salonId,
              clientId: existingAppointment.salonClientId,
              allowArchived: true,
            })
            : null;

          if (!terminalClient) {
            let identity;
            try {
              identity = await resolveCanonicalSalonClientIdentityWithHandle(
                tx,
                {
                  salonId: existingAppointment.salonId,
                  phone: existingAppointment.clientPhone,
                  email: existingAppointment.clientEmail,
                  allowArchived: true,
                },
              );
            } catch (error) {
              if (error instanceof TypeError) {
                throw new ActiveAppointmentConflictError();
              }
              throw error;
            }
            if (!identity) {
              throw new ActiveAppointmentConflictError();
            }
            terminalClient = await lockOperationalSalonClientContactWithHandle(
              tx,
              {
                salonId: existingAppointment.salonId,
                clientId: identity.terminal.id,
                allowArchived: true,
              },
            );
          }

          if (existingAppointment.technicianId) {
            await tx.execute(sql`
              select pg_advisory_xact_lock(
                hashtext(${existingAppointment.salonId}),
                hashtext(${existingAppointment.technicianId})
              )
            `);
          }

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
            };
          }
          if (lockedAppointment.status !== existingAppointment.status) {
            return {
              applied: false,
              appointment: lockedAppointment,
              conflictStatus: lockedAppointment.status,
            };
          }
          if (lockedAppointment.status === 'completed') {
            return {
              applied: false,
              appointment: lockedAppointment,
              conflictStatus: 'completed_requires_admin_reopen',
            };
          }
          if (lockedAppointment.finalTaxSnapshot) {
            return {
              applied: false,
              appointment: lockedAppointment,
              conflictStatus: 'final_invoice_revision_required',
            };
          }

          let lockedTerminalClientId: string | null = null;
          if (lockedAppointment.salonClientId) {
            lockedTerminalClientId = (
              await resolveTerminalSalonClientWithHandle(tx, {
                salonId: lockedAppointment.salonId,
                clientId: lockedAppointment.salonClientId,
                allowArchived: true,
              })
            ).id;
          } else {
            try {
              lockedTerminalClientId = (
                await resolveCanonicalSalonClientIdentityWithHandle(tx, {
                  salonId: lockedAppointment.salonId,
                  phone: lockedAppointment.clientPhone,
                  email: lockedAppointment.clientEmail,
                  allowArchived: true,
                })
              )?.terminal.id ?? null;
            } catch (error) {
              if (error instanceof TypeError) {
                throw new ActiveAppointmentConflictError();
              }
              throw error;
            }
          }
          if (lockedTerminalClientId !== terminalClient.id) {
            throw new ActiveAppointmentConflictError();
          }

          const lockedStatusCanBecomeActive
            = TERMINAL_APPOINTMENT_STATUSES.includes(
              lockedAppointment.status as (typeof TERMINAL_APPOINTMENT_STATUSES)[number],
            )
            || ACTIVE_APPOINTMENT_STATUSES.includes(
              lockedAppointment.status as (typeof ACTIVE_APPOINTMENT_STATUSES)[number],
            );
          if (!lockedStatusCanBecomeActive) {
            return {
              applied: false,
              appointment: lockedAppointment,
              conflictStatus: lockedAppointment.status,
            };
          }

          if (lockedAppointment.status === 'no_show') {
            const depositRows = await loadAppointmentDepositCreditRows({
              salonId: lockedAppointment.salonId,
              appointmentId,
              database: tx,
              forUpdate: true,
              appointmentLockHeld: true,
            });
            const taxChain = validateAppointmentTaxSnapshotChain(lockedAppointment);
            const invoiceCurrency = taxChain.ok ? taxChain.invoiceCurrency : null;
            const depositResolution = depositRows.length === 0
              ? taxChain.ok
                ? resolveDepositCredit({ deposits: depositRows, invoiceCurrency: 'CAD' })
                : null
              : invoiceCurrency
                ? resolveDepositCredit({ deposits: depositRows, invoiceCurrency })
                : null;
            // Immutable forfeiture evidence remains after a later refund. A
            // coherent full refund therefore permits reactivation; retained
            // money and every unresolved history remain fail-closed.
            if (
              depositResolution === null
              || !depositResolution.ok
            ) {
              return {
                applied: false,
                appointment: lockedAppointment,
                conflictStatus: 'financial_reconciliation_required',
              };
            }
            if (depositResolution.state === 'forfeited') {
              return {
                applied: false,
                appointment: lockedAppointment,
                conflictStatus: 'deposit_forfeited',
              };
            }
          }

          if (
            lockedAppointment.technicianId
            !== existingAppointment.technicianId
          ) {
            return {
              applied: false,
              appointment: lockedAppointment,
              conflictStatus: lockedAppointment.status,
            };
          }

          const activeAppointments
            = await getActiveAppointmentsForCanonicalClientWithHandle(tx, {
              salonId: existingAppointment.salonId,
              terminalClientId: terminalClient.id,
              horizon: 'lineage-active',
              excludeAppointmentId: appointmentId,
              allowArchived: true,
            });
          if (activeAppointments.length > 0) {
            throw new ActiveAppointmentConflictError();
          }

          if (lockedAppointment.technicianId) {
            const blockedDurationMinutes
              = lockedAppointment.blockedDurationMinutes
              ?? (
                lockedAppointment.totalDurationMinutes
                + (lockedAppointment.bufferMinutes ?? 0)
              );
            const blockedEndTime = new Date(Math.max(
              lockedAppointment.endTime.getTime(),
              lockedAppointment.startTime.getTime()
              + blockedDurationMinutes * 60_000,
            ));
            await lockTechnicianAndAssertSlotFree(tx, {
              salonId: lockedAppointment.salonId,
              technicianId: lockedAppointment.technicianId,
              startTime: lockedAppointment.startTime,
              blockedEndTime,
              excludedAppointmentId: appointmentId,
            });
          }

          const reactivatedAt = new Date(Math.max(
            Date.now(),
            lockedAppointment.updatedAt.getTime() + 1,
          ));
          const [reactivatedAppointment] = await tx
            .update(appointmentSchema)
            .set({
              status: data.status,
              cancelReason: null,
              canvasState: data.status === 'in_progress' ? 'working' : 'waiting',
              canvasStateUpdatedAt: reactivatedAt,
              completedAt: null,
              updatedAt: reactivatedAt,
            })
            .where(
              and(
                eq(appointmentSchema.id, appointmentId),
                eq(appointmentSchema.salonId, existingAppointment.salonId),
                eq(appointmentSchema.status, lockedAppointment.status),
                inArray(
                  appointmentSchema.status,
                  [
                    ...ACTIVE_APPOINTMENT_STATUSES,
                    ...TERMINAL_APPOINTMENT_STATUSES,
                  ],
                ),
                isNull(appointmentSchema.deletedAt),
              ),
            )
            .returning();

          if (!reactivatedAppointment) {
            const [currentAppointment] = await tx
              .select()
              .from(appointmentSchema)
              .where(
                and(
                  eq(appointmentSchema.id, appointmentId),
                  eq(appointmentSchema.salonId, existingAppointment.salonId),
                ),
              )
              .limit(1);
            return {
              applied: false,
              appointment: currentAppointment ?? existingAppointment,
              conflictStatus: currentAppointment?.status ?? 'missing',
            };
          }

          await enqueueGoogleCalendarAppointmentMutation(tx, {
            appointmentId: reactivatedAppointment.id,
            salonId: reactivatedAppointment.salonId,
            mutationVersion: reactivatedAppointment.updatedAt,
          });

          return {
            applied: true,
            appointment: reactivatedAppointment,
            conflictStatus: null,
          };
        }),
      );

      if (!transition.applied) {
        return reactivationConflictResponse(transition.conflictStatus);
      }
      updatedAppointment = transition.appointment;
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

    return Response.json({
      data: { appointment: updatedAppointment },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    if (error instanceof DepositForfeitureBlockedError) {
      return depositForfeitureBlockedResponse(error);
    }
    if (
      error instanceof ActiveAppointmentConflictError
      || error instanceof SlotConflictError
      || error instanceof ClientLifecycleStabilizationError
    ) {
      return reactivationConflictResponse();
    }
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
