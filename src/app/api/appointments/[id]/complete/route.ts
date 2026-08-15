import crypto from 'node:crypto';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { getSalonPolicy, getSuperAdminPolicy } from '@/core/appointments/policyRepo';
import { getActiveAppointmentsForCanonicalClientWithHandle } from '@/libs/activeAppointments';
import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import {
  listPayments,
  resolveCheckoutActor,
} from '@/libs/appointmentCheckoutServer';
import {
  APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED,
  appointmentFinancialOverpayment,
  resolveAppointmentDepositFinancials,
} from '@/libs/appointmentDepositFinancials';
import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import { validateAppointmentTaxSnapshotChain } from '@/libs/appointmentTaxSnapshot';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import {
  lockTechnicianAndAssertSlotFree,
  SlotConflictError,
} from '@/libs/bookingConflictGuard';
import {
  CheckoutMoneyRangeError,
  computeCheckoutTotals,
  derivePaymentStatus,
  type ResolvedTaxConfig,
} from '@/libs/checkoutTotals';
import {
  ClientLifecycleStabilizationError,
  type LifecycleSqlHandle,
  lockOperationalSalonClientContactWithHandle,
  resolveCanonicalSalonClientIdentity,
  resolveCanonicalSalonClientIdentityWithHandle,
  resolveTerminalSalonClient,
  resolveTerminalSalonClientWithHandle,
  withClientLifecycleTransactionRetry,
} from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import { loadAppointmentDepositCreditRows } from '@/libs/depositCredit.server';
import { evaluateAndFlagIfNeeded } from '@/libs/fraudDetection';
import { computeEarnedPointsFromCents } from '@/libs/pointsCalculation';
import {
  getAppointmentById,
  getOrCreateSalonClient,
  updateSalonClientStats,
} from '@/libs/queries';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';
import {
  buildFinalTaxSnapshot,
  resolveTaxConfig,
} from '@/libs/taxConfig';
import {
  addOnSchema,
  appointmentAuditLogSchema,
  appointmentFinalItemSchema,
  appointmentPaymentSchema,
  appointmentPhotoSchema,
  appointmentSchema,
  PAYMENT_METHODS,
  salonClientSchema,
  salonSchema,
  serviceSchema,
} from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const paymentMethodEnum = z.enum(PAYMENT_METHODS);

const finalItemSchema = z.object({
  kind: z.enum(['service', 'addon', 'custom']),
  catalogServiceId: z.string().max(64).nullish(),
  catalogAddOnId: z.string().max(64).nullish(),
  name: z.string().trim().min(1).max(120),
  quantity: z.number().int().min(1).max(99).default(1),
  unitPriceCents: z.number().int().min(0).max(1_000_000),
  durationMinutes: z.number().int().min(0).max(600).nullish(),
  /** Defaults from the salon tax config per kind when omitted. */
  taxable: z.boolean().optional(),
});

const paymentEntrySchema = z.object({
  amountCents: z.number().int().min(1).max(5_000_000),
  method: paymentMethodEnum.optional(),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

const completeAppointmentSchema = z.object({
  // Photo gate: policy 'required' ignores this flag; otherwise it preserves
  // the long-standing soft gate (missing after photo → 400 unless skipped).
  skipPhotoValidation: z.boolean().optional().default(false),

  // Legacy completion record (kept for back-compat: a body with none of the
  // new checkout fields completes exactly as before this phase).
  finalPriceCents: z.number().int().min(0).max(1_000_000).optional(),
  tipCents: z.number().int().min(0).max(100_000).optional(),
  paymentMethod: paymentMethodEnum.optional(),
  techNotes: z.string().trim().max(2000).optional(),

  // Legacy performed-item ids — translated into final items (the booked
  // appointment_services/appointment_add_on snapshot is IMMUTABLE now).
  performedServiceIds: z.array(z.string()).max(20).optional(),
  performedAddOnIds: z.array(z.string()).max(20).optional(),

  // Checkout payload (0058)
  finalItems: z.array(finalItemSchema).max(40).optional(),
  actualStartAt: z.coerce.date().optional(),
  actualEndAt: z.coerce.date().optional(),
  discountCents: z.number().int().min(0).max(1_000_000).optional(),
  discountReason: z.string().trim().max(200).optional(),
  // Admin-only
  taxExempt: z.boolean().optional(),
  // An empty or whitespace-only reason is "no reason supplied". Normalizing it
  // to absent here keeps the stored scalar and the frozen snapshot identical:
  // a stored '' beside a snapshot null would permanently fail chain validation.
  taxExemptReason: z.string().trim().max(200).optional()
    .transform(value => value || undefined),
  // Payments recorded at checkout. PRESENCE of this field (even empty) opts
  // into derived payment status; absence keeps the legacy hard-coded 'paid'.
  payments: z.array(paymentEntrySchema).max(10).optional(),
  // Admin-only. 'comp' = complimentary (0 revenue, no payments allowed).
  paymentStatusIntent: z.literal('comp').optional(),
  // Optimistic-concurrency check: server recomputes and 409s on drift.
  expectedTotalDueCents: z.number().int().min(0).max(10_000_000).optional(),
  // The client-reviewed amount before this request's new payment entries.
  // Revalidated while holding appointment -> deposit locks.
  expectedBalanceCents: z.number().int().min(0).max(10_000_000).optional(),
});

type CompletePayload = z.infer<typeof completeAppointmentSchema>;

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

class StartAppointmentStateConflictError extends Error {
  constructor() {
    super('START_APPOINTMENT_STATE_CONFLICT');
    this.name = 'StartAppointmentStateConflictError';
  }
}

class StartAppointmentIdentityConflictError extends Error {
  constructor() {
    super('START_APPOINTMENT_IDENTITY_CONFLICT');
    this.name = 'StartAppointmentIdentityConflictError';
  }
}

class StartAppointmentActiveConflictError extends Error {
  constructor() {
    super('START_APPOINTMENT_ACTIVE_CONFLICT');
    this.name = 'StartAppointmentActiveConflictError';
  }
}

function postgresErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string') {
      return candidate.code;
    }
    current = candidate.cause;
  }
  return null;
}

type CompletionTotals = {
  finalSubtotalCents: number;
  finalDiscountCents: number;
  taxableSubtotalCents: number;
  taxAmountCents: number;
  taxApplied: boolean;
  finalPriceCents: number;
  tipCents: number;
  totalDueCents: number;
  amountPaidCents: number | null;
  appointmentPaymentsCents: number;
  depositCreditAppliedCents: number;
  amountAlreadyPaidCents: number;
  excessDepositCents: number;
  balanceCents: number;
};

type SuccessResponse = {
  data: {
    appointment: {
      id: string;
      status: string;
      paymentStatus: string;
      completedAt: Date;
      finalPriceCents?: number | null;
      tipCents?: number | null;
      paymentMethod?: string | null;
    };
    totals?: CompletionTotals;
    depositCredit?: {
      state: 'resolved' | 'blocked';
      blockedCode: string | null;
      blockedDetail: string | null;
      collectedCents: number;
      refundedCents: number;
      forfeitedCents: number;
      eligibleCents: number;
    };
    // Whether the post-appointment review prompt should be shown to the tech.
    // False once the client is marked as already reviewed on Google.
    showReviewPrompt?: boolean;
  };
};

/**
 * Reconstruct the canonical response for every completed replay, including a
 * request that lost the completion CAS after another identical request won.
 * Keeping both paths here prevents concurrency-only response truncation while
 * ensuring no completion side effects run twice.
 */
async function completedReplayResponse(
  appointmentId: string,
  completedAppointment: typeof appointmentSchema.$inferSelect,
): Promise<Response> {
  const replayTaxChain = validateAppointmentTaxSnapshotChain(completedAppointment);
  if (!replayTaxChain.ok) {
    return Response.json(
      {
        error: {
          code: 'TAX_SNAPSHOT_INVALID',
          message: replayTaxChain.detail,
          details: { reason: replayTaxChain.code },
        },
      } satisfies ErrorResponse,
      { status: 409 },
    );
  }
  const [depositRows, replayPayments] = await Promise.all([
    loadAppointmentDepositCreditRows({
      salonId: completedAppointment.salonId,
      appointmentId,
    }),
    listPayments(db, appointmentId),
  ]);
  const replayPaymentLedger = resolveAppointmentPaymentLedger({
    cachedAmountPaidCents: completedAppointment.amountPaidCents,
    paymentRows: replayPayments,
    expectedSalonId: completedAppointment.salonId,
    appointmentStatus: 'completed',
    paymentStatus: completedAppointment.paymentStatus,
  });
  if (!replayPaymentLedger.ok) {
    return Response.json(
      {
        error: {
          code: replayPaymentLedger.code,
          message: replayPaymentLedger.detail,
        },
      } satisfies ErrorResponse,
      { status: 409 },
    );
  }
  const replayCurrency = replayTaxChain.invoiceCurrency
    // No deposit exists to compare in this branch; the sentinel is never
    // displayed or used to reinterpret historical money.
    ?? (depositRows.length === 0 ? 'CAD' : null);
  const replayFinancials = resolveAppointmentDepositFinancials({
    deposits: depositRows,
    invoiceCurrency: replayCurrency,
    finalPriceCents: completedAppointment.finalPriceCents
      ?? completedAppointment.totalPrice,
    taxAmountCents: completedAppointment.taxAmountCents,
    tipCents: completedAppointment.tipCents,
    appointmentPaymentsCents: replayPaymentLedger.appointmentPaymentsCents,
    appointmentStatus: 'completed',
    paymentStatus: completedAppointment.paymentStatus,
  });
  if (!replayFinancials.depositResolution.ok) {
    return Response.json(
      {
        error: {
          code: replayFinancials.depositResolution.code,
          message: replayFinancials.depositResolution.detail,
        },
      } satisfies ErrorResponse,
      { status: 409 },
    );
  }
  if (!replayFinancials.financials.ok) {
    return Response.json(
      {
        error: {
          code: replayFinancials.financials.code,
          message: 'The completed invoice money requires reconciliation.',
        },
      } satisfies ErrorResponse,
      { status: 409 },
    );
  }
  if (replayFinancials.financials.excessDepositCents > 0) {
    return Response.json(
      {
        error: {
          code: 'DEPOSIT_EXCESS_REQUIRES_REFUND',
          message: 'Refund the excess deposit before relying on this completed invoice.',
        },
      } satisfies ErrorResponse,
      { status: 409 },
    );
  }
  const replayOverpayment = appointmentFinancialOverpayment(replayFinancials);
  if (replayOverpayment) {
    return Response.json(
      {
        error: {
          code: APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED,
          message: 'Collected money exceeds this completed invoice and requires reconciliation.',
        },
      } satisfies ErrorResponse,
      { status: 409 },
    );
  }
  const replayPaymentStatus
    = completedAppointment.paymentStatus === 'comp'
      ? 'comp'
      : replayFinancials.depositResolution.ok && replayFinancials.financials.ok
        ? derivePaymentStatus(
          replayFinancials.financials.totalDueCents,
          replayFinancials.financials.amountAlreadyPaidCents,
        )
        : completedAppointment.paymentStatus ?? 'pending';
  return Response.json({
    data: {
      appointment: {
        id: appointmentId,
        status: 'completed',
        paymentStatus: replayPaymentStatus,
        completedAt: completedAppointment.completedAt ?? new Date(),
      },
      depositCredit: replayFinancials.depositCredit,
      ...(replayFinancials.financials.ok
        ? {
            totals: {
              finalSubtotalCents: completedAppointment.finalSubtotalCents
                ?? completedAppointment.totalPrice,
              finalDiscountCents: completedAppointment.finalDiscountCents ?? 0,
              taxableSubtotalCents: completedAppointment.taxableSubtotalCents ?? 0,
              taxAmountCents: completedAppointment.taxAmountCents ?? 0,
              taxApplied: completedAppointment.finalTaxSnapshot
                ? completedAppointment.finalTaxSnapshot.configuration.enabled
                && completedAppointment.finalTaxSnapshot.configuration.rateBps > 0
                && !completedAppointment.finalTaxSnapshot.taxExempt
                : (completedAppointment.taxAmountCents ?? 0) > 0,
              finalPriceCents: completedAppointment.finalPriceCents
                ?? completedAppointment.totalPrice,
              tipCents: completedAppointment.tipCents ?? 0,
              totalDueCents: replayFinancials.financials.totalDueCents,
              amountPaidCents: completedAppointment.amountPaidCents,
              appointmentPaymentsCents: replayFinancials.financials.tenderedCents,
              depositCreditAppliedCents:
                replayFinancials.financials.depositCreditAppliedCents,
              amountAlreadyPaidCents: replayFinancials.financials.amountAlreadyPaidCents,
              excessDepositCents: replayFinancials.financials.excessDepositCents,
              balanceCents: replayFinancials.financials.remainingBalanceCents,
            },
          }
        : {}),
    },
  } satisfies SuccessResponse);
}

// =============================================================================
// CHECKOUT COMPUTATION
// =============================================================================

type ResolvedFinalItem = {
  kind: 'service' | 'addon' | 'custom';
  catalogServiceId: string | null;
  catalogAddOnId: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  durationMinutes: number | null;
  taxable: boolean;
};

function defaultTaxableFor(kind: ResolvedFinalItem['kind'], taxConfig: ResolvedTaxConfig): boolean {
  if (kind === 'service') {
    return taxConfig.taxServicesByDefault;
  }
  if (kind === 'addon') {
    return taxConfig.taxAddOnsByDefault;
  }
  return taxConfig.taxCustomByDefault;
}

/**
 * Resolve the final line items from the payload. Three shapes:
 * - `finalItems` (the checkout sheet) — used as sent.
 * - legacy `performedServiceIds`/`performedAddOnIds` — priced from the live
 *   catalog (same semantics as the removed destructive rewrite, minus the
 *   destruction).
 * - neither — legacy completion; no final items are recorded.
 */
async function resolveFinalItems(
  database: Pick<typeof db, 'select'>,
  appointment: typeof appointmentSchema.$inferSelect,
  payload: CompletePayload,
  taxConfig: ResolvedTaxConfig,
): Promise<ResolvedFinalItem[] | null> {
  if (payload.finalItems) {
    return payload.finalItems.map(item => ({
      kind: item.kind,
      catalogServiceId: item.kind === 'service' ? item.catalogServiceId ?? null : null,
      catalogAddOnId: item.kind === 'addon' ? item.catalogAddOnId ?? null : null,
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.unitPriceCents * item.quantity,
      durationMinutes: item.durationMinutes ?? null,
      taxable: item.taxable ?? defaultTaxableFor(item.kind, taxConfig),
    }));
  }

  const { performedServiceIds, performedAddOnIds } = payload;
  if (!performedServiceIds?.length && !performedAddOnIds) {
    return null;
  }

  const items: ResolvedFinalItem[] = [];

  if (performedServiceIds?.length) {
    const services = await database
      .select()
      .from(serviceSchema)
      .where(and(
        eq(serviceSchema.salonId, appointment.salonId),
        inArray(serviceSchema.id, performedServiceIds),
      ));
    for (const service of services) {
      items.push({
        kind: 'service',
        catalogServiceId: service.id,
        catalogAddOnId: null,
        name: service.name,
        quantity: 1,
        unitPriceCents: service.price,
        lineTotalCents: service.price,
        durationMinutes: service.durationMinutes,
        taxable: defaultTaxableFor('service', taxConfig),
      });
    }
  }

  if (performedAddOnIds?.length) {
    const addOns = await database
      .select()
      .from(addOnSchema)
      .where(and(
        eq(addOnSchema.salonId, appointment.salonId),
        inArray(addOnSchema.id, performedAddOnIds),
      ));
    for (const addOn of addOns) {
      items.push({
        kind: 'addon',
        catalogServiceId: null,
        catalogAddOnId: addOn.id,
        name: addOn.name,
        quantity: 1,
        unitPriceCents: addOn.priceCents,
        lineTotalCents: addOn.priceCents,
        durationMinutes: addOn.durationMinutes,
        taxable: defaultTaxableFor('addon', taxConfig),
      });
    }
  }

  return items;
}

// =============================================================================
// PATCH /api/appointments/[id]/complete - Complete via checkout
// =============================================================================
// Single completion endpoint for every surface. A body with none of the new
// checkout fields behaves exactly as before this phase (paid, final = booked
// total). All checkout writes are gated on the CAS update so an idempotent
// replay inserts nothing.
// =============================================================================

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;
    const access = await requireAppointmentManagerAccess(appointmentId, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can complete this appointment',
      assignmentForbiddenMessage: 'You can only complete your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
    });
    if (!access.ok) {
      return access.response;
    }
    const { appointment: existingAppointment } = access;

    // 1. Parse and validate request body
    let body = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is okay, we have defaults
    }

    const validated = completeAppointmentSchema.safeParse(body);

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
    const payload = validated.data;

    // 2. Server-side permission gates (coarse role model): tax exemption and
    // complimentary status are admin-only.
    if (
      access.actorRole === 'staff'
      && (payload.taxExempt !== undefined || payload.paymentStatusIntent !== undefined)
    ) {
      return Response.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Only admins can mark an appointment tax-exempt or complimentary',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      );
    }

    // Idempotency short-circuit: a replayed completion returns the current
    // state without re-validating money (its payment entries were already
    // recorded the first time and would otherwise read as over-payment).
    if (existingAppointment.status === 'completed' || existingAppointment.completedAt) {
      return completedReplayResponse(appointmentId, existingAppointment);
    }

    if (payload.paymentStatusIntent === 'comp' && payload.payments?.length) {
      return Response.json(
        {
          error: {
            code: 'COMP_WITH_PAYMENTS',
            message: 'A complimentary appointment cannot also record payments',
          },
        } satisfies ErrorResponse,
        { status: 422 },
      );
    }

    // 3. Actual-time validation (salon timezone is a display concern; values
    // arrive as instants).
    if (
      payload.actualStartAt
      && payload.actualEndAt
      && payload.actualEndAt.getTime() < payload.actualStartAt.getTime()
    ) {
      return Response.json(
        {
          error: {
            code: 'INVALID_ACTUAL_TIMES',
            message: 'Actual finish cannot be before actual start',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }
    if (
      payload.actualStartAt
      && payload.actualEndAt
      && payload.actualEndAt.getTime() - payload.actualStartAt.getTime() > 24 * 60 * 60 * 1000
    ) {
      return Response.json(
        {
          error: {
            code: 'INVALID_ACTUAL_TIMES',
            message: 'Actual duration cannot exceed 24 hours',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 4. Photo gate. Policy 'required' hard-blocks (skip flag ignored);
    // otherwise today's soft gate is preserved exactly.
    const [salonPolicy, superAdminPolicy] = await Promise.all([
      getSalonPolicy(db, existingAppointment.salonId),
      getSuperAdminPolicy(db),
    ]);
    // Super-admin override wins when set; otherwise the salon decides.
    const afterPhotoRequired
      = (superAdminPolicy.requireAfterPhotoToFinish
        ?? salonPolicy.requireAfterPhotoToFinish) === 'required';

    if (afterPhotoRequired || !payload.skipPhotoValidation) {
      const afterPhotos = await db
        .select({ id: appointmentPhotoSchema.id })
        .from(appointmentPhotoSchema)
        .where(
          and(
            eq(appointmentPhotoSchema.appointmentId, appointmentId),
            eq(appointmentPhotoSchema.salonId, existingAppointment.salonId),
            eq(appointmentPhotoSchema.photoType, 'after'),
          ),
        )
        .limit(1);

      if (afterPhotos.length === 0) {
        return Response.json(
          {
            error: {
              code: 'PHOTOS_REQUIRED',
              message: 'At least one "after" photo must be uploaded before completing the appointment. Upload photos via POST /api/appointments/[id]/photos',
              details: { policy: afterPhotoRequired ? 'required' : 'optional' },
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }
    }

    // 5. Final tax/pricing inputs are resolved only after the appointment and
    // deposit locks below. This prevents an invoice from freezing settings
    // that changed while completion waited to serialize.
    const taxExempt = payload.taxExempt ?? false;
    // Two independent capabilities: recording WHAT was performed (any item
    // shape, incl. legacy performed-ids) vs pricing FROM the items (only the
    // explicit `finalItems` checkout payload). The legacy staff sheet sends
    // performed ids + a hand-entered finalPriceCents — its money truth stays
    // the entered price, exactly as before this phase.
    const pricedFromItems = payload.finalItems !== undefined;
    const tipCents = payload.tipCents ?? 0;

    // 6. Payments recorded at checkout: presence of `payments` (even empty)
    // opts into derived payment status; absence keeps legacy 'paid'.
    // Payments surviving a reopen also count toward the paid total. The
    // definitive sum and deposit state are resolved again inside the locked
    // transaction below, so a concurrent refund cannot race completion.
    const paymentsProvided = payload.payments !== undefined || payload.paymentStatusIntent !== undefined;
    const paymentEntries = payload.payments ?? [];
    const paidSum = paymentEntries.reduce((sum, entry) => sum + entry.amountCents, 0);
    const paymentMethod = payload.paymentMethod
      ?? paymentEntries.find(entry => entry.method)?.method;

    const actor = resolveCheckoutActor(access);

    // 7. ATOMIC COMPLETION. Every checkout write is gated on the CAS update:
    // an idempotent replay (0 rows) inserts nothing.
    const validStates = ['confirmed', 'in_progress'] as const;

    const result = await db.transaction(async (tx) => {
      const [lockedAppointment] = await tx
        .select()
        .from(appointmentSchema)
        .where(and(
          eq(appointmentSchema.id, appointmentId),
          eq(appointmentSchema.salonId, existingAppointment.salonId),
          ...(access.actorRole === 'staff'
            ? [eq(appointmentSchema.technicianId, access.session.technicianId)]
            : []),
        ))
        .for('update')
        .limit(1);
      if (
        !lockedAppointment
        || !validStates.includes(lockedAppointment.status as typeof validStates[number])
        || lockedAppointment.completedAt !== null
      ) {
        return { success: false as const, updatedAppointment: null };
      }

      // D6 lock order is appointment first, then every terminal-history
      // deposit row. Keeping the credit decision inside this transaction
      // prevents a refund request/observation from racing the invoice write.
      const depositRows = await loadAppointmentDepositCreditRows({
        salonId: lockedAppointment.salonId,
        appointmentId,
        database: tx,
        forUpdate: true,
        appointmentLockHeld: true,
      });

      // Settings writers and booking hold the salon row before touching an
      // appointment. Completion must retain D6's appointment -> deposit lock
      // order, so it takes the salon lock with NOWAIT: either this transaction
      // gets one coherent issue-time configuration or the caller retries. It
      // can never wait in the inverse order and deadlock a booking/settings
      // transaction.
      await tx.execute(sql.raw('SAVEPOINT completion_salon_config_lock'));
      try {
        await tx.execute(sql`
          SELECT ${salonSchema.id}
          FROM ${salonSchema}
          WHERE ${salonSchema.id} = ${lockedAppointment.salonId}
          FOR SHARE NOWAIT
        `);
        await tx.execute(sql.raw('RELEASE SAVEPOINT completion_salon_config_lock'));
      } catch (error) {
        if (postgresErrorCode(error) === '55P03') {
          // PostgreSQL marks the transaction failed after NOWAIT. Recover the
          // savepoint before returning the typed retry response so the outer
          // transaction can finish cleanly instead of turning it into a 500.
          await tx.execute(sql.raw('ROLLBACK TO SAVEPOINT completion_salon_config_lock'));
          await tx.execute(sql.raw('RELEASE SAVEPOINT completion_salon_config_lock'));
          return {
            success: false as const,
            updatedAppointment: null,
            response: Response.json(
              {
                error: {
                  code: 'TAX_CONFIGURATION_BUSY',
                  message: 'The salon financial settings are being updated. Review the totals and try again.',
                },
              } satisfies ErrorResponse,
              { status: 409 },
            ),
          };
        }
        throw error;
      }
      const [lockedSalon] = await tx
        .select({ settings: salonSchema.settings })
        .from(salonSchema)
        .where(eq(salonSchema.id, lockedAppointment.salonId))
        .limit(1);
      if (!lockedSalon) {
        return {
          success: false as const,
          updatedAppointment: null,
          response: Response.json(
            {
              error: {
                code: 'SALON_NOT_FOUND',
                message: 'The salon financial settings could not be resolved.',
              },
            } satisfies ErrorResponse,
            { status: 409 },
          ),
        };
      }

      const now = new Date();
      const salonSettings
        = (lockedSalon.settings as SalonSettings | null | undefined) ?? null;
      const fallbackInvoiceCurrency = resolveBookingConfigFromSettings(salonSettings)
        .currency
        .toUpperCase();
      const taxConfig = resolveTaxConfig(salonSettings, now);
      const finalItems = await resolveFinalItems(tx, lockedAppointment, payload, taxConfig);
      const legacyFinalPrice = payload.finalPriceCents ?? lockedAppointment.totalPrice;
      let totals: ReturnType<typeof computeCheckoutTotals>;
      try {
        totals = computeCheckoutTotals({
          items: pricedFromItems
            ? finalItems!.map(item => ({
              lineTotalCents: item.lineTotalCents,
              taxable: item.taxable,
            }))
            : [{
                lineTotalCents: legacyFinalPrice,
                taxable: defaultTaxableFor('service', taxConfig),
              }],
          discountCents: pricedFromItems ? payload.discountCents ?? 0 : 0,
          taxConfig,
          taxExempt,
          tipCents,
        });
      } catch (error) {
        if (error instanceof CheckoutMoneyRangeError) {
          return {
            success: false as const,
            updatedAppointment: null,
            response: Response.json(
              {
                error: {
                  code: error.code,
                  message: error.message,
                },
              } satisfies ErrorResponse,
              { status: 422 },
            ),
          };
        }
        throw error;
      }
      if (
        payload.expectedTotalDueCents !== undefined
        && payload.expectedTotalDueCents !== totals.totalDueCents
      ) {
        return {
          success: false as const,
          updatedAppointment: null,
          response: Response.json(
            {
              error: {
                code: 'TOTALS_MISMATCH',
                message: 'The salon tax or pricing settings changed while checking out. Review the updated totals and try again.',
                details: { totals },
              },
            } satisfies ErrorResponse,
            { status: 409 },
          ),
        };
      }

      // The booking-time currency is immutable invoice identity. Only a truly
      // historical appointment with no deposit may adopt the issue-time salon
      // currency; historical deposit rows fail closed rather than being guessed.
      const existingTaxChain = validateAppointmentTaxSnapshotChain(lockedAppointment);
      if (!existingTaxChain.ok) {
        return {
          success: false as const,
          updatedAppointment: null,
          response: Response.json(
            {
              error: {
                code: 'TAX_SNAPSHOT_INVALID',
                message: existingTaxChain.detail,
                details: { reason: existingTaxChain.code },
              },
            } satisfies ErrorResponse,
            { status: 409 },
          ),
        };
      }
      const invoiceCurrency = existingTaxChain.invoiceCurrency
        ?? (depositRows.length === 0 ? fallbackInvoiceCurrency : null);
      if (!invoiceCurrency) {
        return {
          success: false as const,
          updatedAppointment: null,
          response: Response.json(
            {
              error: {
                code: 'DEPOSIT_CURRENCY_MISMATCH',
                message: 'The historical appointment has no frozen invoice currency.',
              },
            } satisfies ErrorResponse,
            { status: 409 },
          ),
        };
      }
      const existingPaymentRows = await listPayments(tx, appointmentId);
      const existingPaymentLedger = resolveAppointmentPaymentLedger({
        cachedAmountPaidCents: lockedAppointment.amountPaidCents,
        paymentRows: existingPaymentRows,
        expectedSalonId: lockedAppointment.salonId,
        appointmentStatus: lockedAppointment.status,
        paymentStatus: lockedAppointment.paymentStatus,
      });
      if (!existingPaymentLedger.ok) {
        return {
          success: false as const,
          updatedAppointment: null,
          response: Response.json(
            {
              error: {
                code: existingPaymentLedger.code,
                message: existingPaymentLedger.detail,
              },
            } satisfies ErrorResponse,
            { status: 409 },
          ),
        };
      }
      const existingPaidCents = existingPaymentLedger.ledgerPaymentsCents;
      if (payload.paymentStatusIntent === 'comp' && existingPaidCents > 0) {
        return {
          success: false as const,
          updatedAppointment: null,
          response: Response.json(
            {
              error: {
                code: 'COMP_WITH_PAYMENTS',
                message: 'Void the recorded payments before marking this appointment complimentary',
              },
            } satisfies ErrorResponse,
            { status: 422 },
          ),
        };
      }

      const beforeFinancials = resolveAppointmentDepositFinancials({
        deposits: depositRows,
        invoiceCurrency,
        finalPriceCents: totals.finalPriceCents,
        taxAmountCents: totals.taxAmountCents,
        tipCents: totals.tipCents,
        appointmentPaymentsCents: existingPaymentLedger.appointmentPaymentsCents,
        appointmentStatus: lockedAppointment.status,
        paymentStatus: payload.paymentStatusIntent === 'comp' ? 'comp' : 'pending',
      });
      if (!beforeFinancials.depositResolution.ok) {
        return {
          success: false as const,
          updatedAppointment: null,
          response: Response.json(
            {
              error: {
                code: beforeFinancials.depositResolution.code,
                message: beforeFinancials.depositResolution.detail,
              },
            } satisfies ErrorResponse,
            { status: 409 },
          ),
        };
      }
      if (!beforeFinancials.financials.ok) {
        return {
          success: false as const,
          updatedAppointment: null,
          response: Response.json(
            { error: { code: beforeFinancials.financials.code, message: 'The appointment money is invalid.' } } satisfies ErrorResponse,
            { status: 422 },
          ),
        };
      }
      if (
        payload.expectedBalanceCents !== undefined
        && payload.expectedBalanceCents
        !== beforeFinancials.financials.remainingBalanceCents
      ) {
        return {
          success: false as const,
          updatedAppointment: null,
          response: Response.json(
            {
              error: {
                code: 'BALANCE_MISMATCH',
                message: 'The deposit, refund, or payment balance changed. Review the updated balance and try again.',
                details: {
                  balanceCents: beforeFinancials.financials.remainingBalanceCents,
                  depositCreditAppliedCents:
                    beforeFinancials.financials.depositCreditAppliedCents,
                },
              },
            } satisfies ErrorResponse,
            { status: 409 },
          ),
        };
      }

      const combinedPaidCents = existingPaidCents + paidSum;
      const legacyImplicitPaid = payload.paymentStatusIntent !== 'comp'
        && !paymentsProvided
        && beforeFinancials.depositResolution.state === 'none'
        && existingPaymentLedger.state === 'untracked_zero';
      const intendedPaymentStatus = payload.paymentStatusIntent === 'comp'
        ? 'comp'
        : paymentsProvided || !legacyImplicitPaid
          ? 'pending'
          : 'paid';
      const completionFinancials = resolveAppointmentDepositFinancials({
        deposits: depositRows,
        invoiceCurrency,
        finalPriceCents: totals.finalPriceCents,
        taxAmountCents: totals.taxAmountCents,
        tipCents: totals.tipCents,
        appointmentPaymentsCents: payload.paymentStatusIntent === 'comp'
          ? 0
          : paymentsProvided
            ? combinedPaidCents
            : legacyImplicitPaid
              ? null
              : existingPaymentLedger.appointmentPaymentsCents,
        appointmentStatus: 'completed',
        paymentStatus: intendedPaymentStatus,
      });
      if (!completionFinancials.financials.ok) {
        return {
          success: false as const,
          updatedAppointment: null,
          response: Response.json(
            { error: { code: completionFinancials.financials.code, message: 'The appointment money is invalid.' } } satisfies ErrorResponse,
            { status: 422 },
          ),
        };
      }
      if (completionFinancials.financials.excessDepositCents > 0) {
        return {
          success: false as const,
          updatedAppointment: null,
          response: Response.json(
            {
              error: {
                code: 'DEPOSIT_EXCESS_REQUIRES_REFUND',
                message: 'Refund the deposit in full and wait for reconciliation before completing this invoice.',
                details: {
                  excessDepositCents:
                    completionFinancials.financials.excessDepositCents,
                },
              },
            } satisfies ErrorResponse,
            { status: 409 },
          ),
        };
      }
      if (completionFinancials.financials.tenderExcessCents > 0) {
        return {
          success: false as const,
          updatedAppointment: null,
          response: Response.json(
            {
              error: {
                code: 'PAYMENTS_EXCEED_TOTAL',
                message: 'Recorded payments exceed the amount due',
                details: {
                  totals,
                  depositCreditAppliedCents:
                    completionFinancials.financials.depositCreditAppliedCents,
                },
              },
            } satisfies ErrorResponse,
            { status: 422 },
          ),
        };
      }

      const paymentStatus = payload.paymentStatusIntent === 'comp'
        ? 'comp'
        : !legacyImplicitPaid
            ? derivePaymentStatus(
              completionFinancials.financials.totalDueCents,
              completionFinancials.financials.amountAlreadyPaidCents,
            )
            : 'paid';
      const amountPaidCents = paymentsProvided
        ? (payload.paymentStatusIntent === 'comp' ? 0 : combinedPaidCents)
        : legacyImplicitPaid
          ? lockedAppointment.amountPaidCents
          : existingPaymentLedger.appointmentPaymentsCents;

      const expectedPaymentRows = [
        ...existingPaymentRows,
        ...paymentEntries.map(entry => ({
          salonId: lockedAppointment.salonId,
          amountCents: entry.amountCents,
          voidedAt: null,
        })),
      ];
      const completedPaymentLedger = resolveAppointmentPaymentLedger({
        cachedAmountPaidCents: amountPaidCents,
        paymentRows: expectedPaymentRows,
        expectedSalonId: lockedAppointment.salonId,
        appointmentStatus: 'completed',
        paymentStatus,
      });
      if (!completedPaymentLedger.ok) {
        return {
          success: false as const,
          updatedAppointment: null,
          response: Response.json(
            {
              error: {
                code: completedPaymentLedger.code,
                message: completedPaymentLedger.detail,
              },
            } satisfies ErrorResponse,
            { status: 409 },
          ),
        };
      }

      // One normalization, two writes: the scalar column and the frozen
      // snapshot must carry the byte-identical reason (or both null), or the
      // completed chain permanently fails its scalar-consistency validation.
      const normalizedTaxExemptReason = taxExempt
        ? (payload.taxExemptReason?.trim() || null)
        : null;
      const updateResult = await tx
        .update(appointmentSchema)
        .set({
          status: 'completed',
          paymentStatus,
          canvasState: 'complete',
          canvasStateUpdatedAt: now,
          completedAt: now,
          updatedAt: now,
          // Money truth. finalPriceCents is ALWAYS net-of-tax, post-discount.
          finalPriceCents: totals.finalPriceCents,
          tipCents: totals.tipCents,
          invoiceCurrency,
          ...(paymentMethod !== undefined ? { paymentMethod } : {}),
          ...(payload.techNotes !== undefined ? { techNotes: payload.techNotes } : {}),
          // Checkout record (nullable = not recorded on legacy shapes)
          ...(pricedFromItems
            ? {
                finalSubtotalCents: totals.finalSubtotalCents,
                finalDiscountCents: totals.finalDiscountCents,
                finalDiscountReason: payload.discountReason ?? null,
              }
            : {}),
          // Only explicit pre-ledger legacy-paid inference with canonically
          // settled no-money deposit history may preserve a NULL cache.
          // Collected, refunded, forfeited, blocked, or authoritative-ledger
          // history persists its exact sum (including zero) so every later
          // consumer can distinguish known-zero tender from unknown history.
          ...(!legacyImplicitPaid ? { amountPaidCents } : {}),
          ...(payload.actualStartAt ? { actualStartAt: payload.actualStartAt } : {}),
          ...(payload.actualEndAt ? { actualEndAt: payload.actualEndAt } : {}),
          // Tax snapshot — frozen forever; settings changes never recalculate.
          taxEnabledSnapshot: taxConfig.enabled,
          taxNameSnapshot: taxConfig.name,
          taxRateBps: taxConfig.rateBps,
          taxInclusive: taxConfig.pricesIncludeTax,
          taxAmountCents: totals.taxAmountCents,
          taxableSubtotalCents: totals.taxableSubtotalCents,
          taxExempt,
          taxExemptReason: normalizedTaxExemptReason,
          finalTaxSnapshot: buildFinalTaxSnapshot({
            taxConfig,
            totals,
            capturedAt: now,
            currency: invoiceCurrency,
            taxExempt,
            taxExemptReason: normalizedTaxExemptReason,
          }),
        })
        .where(
          and(
            eq(appointmentSchema.id, appointmentId),
            eq(appointmentSchema.salonId, existingAppointment.salonId),
            ...(access.actorRole === 'staff'
              ? [eq(appointmentSchema.technicianId, access.session.technicianId)]
              : []),
            inArray(appointmentSchema.status, [...validStates]),
            isNull(appointmentSchema.completedAt), // Extra safety: prevent re-completion
          ),
        )
        .returning();

      if (updateResult.length === 0) {
        return { success: false as const, updatedAppointment: null };
      }

      const completedAppointment = updateResult[0]!;

      // Final items: replace wholesale (re-completion after reopen). The
      // booked appointment_services/appointment_add_on rows are never touched.
      await tx
        .delete(appointmentFinalItemSchema)
        .where(eq(appointmentFinalItemSchema.appointmentId, appointmentId));
      if (finalItems && finalItems.length > 0) {
        await tx.insert(appointmentFinalItemSchema).values(
          finalItems.map((item, index) => ({
            id: `fitem_${crypto.randomUUID()}`,
            appointmentId,
            salonId: existingAppointment.salonId,
            kind: item.kind,
            catalogServiceId: item.catalogServiceId,
            catalogAddOnId: item.catalogAddOnId,
            name: item.name,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            lineTotalCents: item.lineTotalCents,
            durationMinutes: item.durationMinutes,
            taxable: item.taxable,
            sortOrder: index,
          })),
        );
      }

      if (paymentEntries.length > 0) {
        await tx.insert(appointmentPaymentSchema).values(
          paymentEntries.map(entry => ({
            id: `pay_${crypto.randomUUID()}`,
            appointmentId,
            salonId: existingAppointment.salonId,
            amountCents: entry.amountCents,
            method: entry.method ?? null,
            reference: entry.reference ?? null,
            note: entry.note ?? null,
            recordedByType: actor.recordedByType,
            recordedById: actor.recordedById,
            recordedByName: actor.recordedByName,
            recordedAt: now,
          })),
        );
      }

      // Audit trail, atomic with the completion.
      const auditRows = [
        buildAppointmentAuditRow({
          appointmentId,
          salonId: existingAppointment.salonId,
          action: 'completed',
          performedBy: actor.performedBy,
          performedByRole: actor.performedByRole,
          performedByName: actor.performedByName ?? undefined,
          previousValue: {
            status: existingAppointment.status,
            totalPrice: existingAppointment.totalPrice,
          },
          newValue: {
            status: 'completed',
            paymentStatus,
            finalPriceCents: totals.finalPriceCents,
            taxAmountCents: totals.taxAmountCents,
            tipCents: totals.tipCents,
            totalDueCents: totals.totalDueCents,
            depositCreditAppliedCents:
              completionFinancials.financials.depositCreditAppliedCents,
            amountAlreadyPaidCents:
              completionFinancials.financials.amountAlreadyPaidCents,
            balanceCents: completionFinancials.financials.remainingBalanceCents,
            excessDepositCents: completionFinancials.financials.excessDepositCents,
          },
        }),
      ];
      if (finalItems) {
        auditRows.push(buildAppointmentAuditRow({
          appointmentId,
          salonId: existingAppointment.salonId,
          action: 'items_changed',
          performedBy: actor.performedBy,
          performedByRole: actor.performedByRole,
          performedByName: actor.performedByName ?? undefined,
          newValue: {
            items: finalItems.map(item => ({
              kind: item.kind,
              name: item.name,
              quantity: item.quantity,
              lineTotalCents: item.lineTotalCents,
            })),
          },
        }));
      }
      if (pricedFromItems && totals.finalDiscountCents > 0) {
        auditRows.push(buildAppointmentAuditRow({
          appointmentId,
          salonId: existingAppointment.salonId,
          action: 'discount_applied',
          performedBy: actor.performedBy,
          performedByRole: actor.performedByRole,
          performedByName: actor.performedByName ?? undefined,
          newValue: { discountCents: totals.finalDiscountCents },
          reason: payload.discountReason,
        }));
      }
      if (taxExempt) {
        auditRows.push(buildAppointmentAuditRow({
          appointmentId,
          salonId: existingAppointment.salonId,
          action: 'tax_exempted',
          performedBy: actor.performedBy,
          performedByRole: actor.performedByRole,
          performedByName: actor.performedByName ?? undefined,
          reason: payload.taxExemptReason,
        }));
      }
      if (payload.actualStartAt || payload.actualEndAt) {
        auditRows.push(buildAppointmentAuditRow({
          appointmentId,
          salonId: existingAppointment.salonId,
          action: 'times_recorded',
          performedBy: actor.performedBy,
          performedByRole: actor.performedByRole,
          performedByName: actor.performedByName ?? undefined,
          newValue: {
            actualStartAt: payload.actualStartAt?.toISOString() ?? null,
            actualEndAt: payload.actualEndAt?.toISOString() ?? null,
          },
        }));
      }
      for (const entry of paymentEntries) {
        auditRows.push(buildAppointmentAuditRow({
          appointmentId,
          salonId: existingAppointment.salonId,
          action: 'payment_recorded',
          performedBy: actor.performedBy,
          performedByRole: actor.performedByRole,
          performedByName: actor.performedByName ?? undefined,
          newValue: {
            amountCents: entry.amountCents,
            method: entry.method ?? null,
            reference: entry.reference ?? null,
          },
        }));
      }
      await tx.insert(appointmentAuditLogSchema).values(auditRows);

      // NOTE: client stats (visits/spend/points) are recomputed AFTER this
      // transaction commits — see handleSuccessfulCompletion. Doing it here
      // would read the not-yet-committed 'completed' row on a separate
      // connection and undercount the visit by one.
      return {
        success: true as const,
        updatedAppointment: completedAppointment,
        completedAt: now,
        totals,
        paymentStatus,
        amountPaidCents,
        financials: completionFinancials.financials,
        depositCredit: completionFinancials.depositCredit,
      };
    });

    // 9. Handle transaction result
    if (!result.success) {
      if ('response' in result && result.response) {
        return result.response;
      }
      // Atomic update failed - re-fetch to determine why
      const currentAppointment = await getAppointmentById(
        appointmentId,
        existingAppointment.salonId,
      );

      if (currentAppointment?.status === 'completed') {
        // IDEMPOTENT: Already completed - return current state
        // DO NOT run fraud eval or points - already processed on first completion
        return completedReplayResponse(appointmentId, currentAppointment);
      }

      // Invalid state (cancelled, no_show, pending, etc.)
      return Response.json(
        {
          error: {
            code: 'INVALID_STATE',
            message: `Cannot complete appointment in "${currentAppointment?.status ?? 'unknown'}" status. Must be confirmed or in_progress.`,
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    return await handleSuccessfulCompletion(
      result.updatedAppointment,
      appointmentId,
      result.completedAt,
      {
        ...result.totals,
        amountPaidCents: result.amountPaidCents,
        appointmentPaymentsCents: result.financials.tenderedCents,
        depositCreditAppliedCents: result.financials.depositCreditAppliedCents,
        amountAlreadyPaidCents: result.financials.amountAlreadyPaidCents,
        excessDepositCents: result.financials.excessDepositCents,
        balanceCents: result.financials.remainingBalanceCents,
      },
      result.depositCredit,
    );
  } catch (error) {
    console.error('Error completing appointment:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to complete appointment',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// HELPER: Process successful (non-idempotent) completion
// =============================================================================
// Structurally isolated so fraud eval ONLY runs on fresh completions.
// =============================================================================

async function handleSuccessfulCompletion(
  completedAppointment: NonNullable<typeof appointmentSchema.$inferSelect>,
  appointmentId: string,
  now: Date,
  totals: CompletionTotals,
  depositCredit: NonNullable<SuccessResponse['data']['depositCredit']>,
): Promise<Response> {
  // DEFENSIVE CHECK: completedAt must be set (set by atomic update above)
  if (!completedAppointment.completedAt) {
    console.error('[BUG] handleSuccessfulCompletion called with null completedAt', {
      appointmentId,
      status: completedAppointment.status,
    });
    return Response.json({
      data: {
        appointment: {
          id: appointmentId,
          status: 'completed',
          paymentStatus: completedAppointment.paymentStatus ?? 'paid',
          completedAt: now,
        },
      },
    } satisfies SuccessResponse);
  }

  // 6a. Get or repair salonClientId if missing (legacy data)
  let salonClientId: string | null = completedAppointment.salonClientId;

  if (!salonClientId) {
    // Self-healing: resolve and repair for legacy appointments
    try {
      const salonClient = await getOrCreateSalonClient(
        completedAppointment.salonId,
        completedAppointment.clientPhone,
        completedAppointment.clientName ?? undefined,
      );
      if (salonClient?.id) {
        const updateResult = await db
          .update(appointmentSchema)
          .set({ salonClientId: salonClient.id })
          .where(
            and(
              eq(appointmentSchema.id, appointmentId),
              eq(appointmentSchema.salonId, completedAppointment.salonId),
            ),
          )
          .returning();

        if (updateResult.length === 1) {
          salonClientId = salonClient.id;
        } else {
          console.error('[FraudDetection] Legacy repair: unexpected update count', {
            appointmentId,
            salonId: completedAppointment.salonId,
            expectedRows: 1,
            actualRows: updateResult.length,
          });
        }
      } else {
        const { normalizePhone } = await import('@/libs/phone');
        console.warn('[FraudDetection] Legacy repair skipped: invalid phone', {
          appointmentId,
          salonId: completedAppointment.salonId,
          rawPhone: completedAppointment.clientPhone,
          normalizedPhone: normalizePhone(completedAppointment.clientPhone),
        });
      }
    } catch (repairError) {
      const { normalizePhone } = await import('@/libs/phone');
      console.error('[FraudDetection] Legacy repair failed', {
        appointmentId,
        salonId: completedAppointment.salonId,
        rawPhone: completedAppointment.clientPhone,
        normalizedPhone: normalizePhone(completedAppointment.clientPhone),
        error: repairError instanceof Error ? repairError.message : String(repairError),
      });
    }
  }

  // 6b. Evaluate fraud signals (fire-and-forget).
  // ONLY when the completion is fully PAID: fraud queries filter
  // payment_status='paid', so unpaid/partial/comp completions must skip eval —
  // for those, the payments route runs it on the transition to fully-paid.
  if (
    salonClientId
    && completedAppointment.paymentStatus === 'paid'
    && totals.depositCreditAppliedCents === 0
  ) {
    // eslint-disable-next-line no-console -- intentional info-level observability log
    console.info('[FraudDetection] fraud_eval_triggered', {
      appointmentId,
      salonClientId,
      salonId: completedAppointment.salonId,
    });

    // Points/velocity basis = final (net-of-tax) revenue, falling back to the
    // booked total for legacy rows.
    const pointsEarnedThisAppt = computeEarnedPointsFromCents(
      completedAppointment.finalPriceCents ?? completedAppointment.totalPrice,
    );
    evaluateAndFlagIfNeeded(
      completedAppointment.salonId,
      salonClientId,
      appointmentId,
      pointsEarnedThisAppt,
    ).catch((err) => {
      console.error('[FraudDetection] Evaluation failed (non-blocking):', err);
    });
  }

  // 6c. Recompute client visit/spend caches POST-COMMIT. The stats resolver
  // itself freezes loyalty whenever collected-deposit history exists, keeping
  // D6.1 from attributing or releasing rewards that belong to D6.2.
  try {
    await updateSalonClientStats(
      completedAppointment.salonId,
      completedAppointment.clientPhone,
    );
  } catch (statsError) {
    console.error('Failed to update salon client stats (non-fatal):', statsError);
  }

  // 6d. Decide whether to show the post-appointment review prompt.
  let showReviewPrompt = false;
  try {
    if (salonClientId) {
      const [client] = await db
        .select({ hasGoogleReview: salonClientSchema.hasGoogleReview })
        .from(salonClientSchema)
        .where(eq(salonClientSchema.id, salonClientId))
        .limit(1);
      showReviewPrompt = !client?.hasGoogleReview;
    } else {
      showReviewPrompt = true;
    }
  } catch (reviewLookupError) {
    console.error('Failed to resolve review prompt state (non-fatal):', reviewLookupError);
  }

  // 7. Return success response
  return Response.json({
    data: {
      appointment: {
        id: appointmentId,
        status: 'completed',
        paymentStatus: completedAppointment.paymentStatus ?? 'paid',
        completedAt: completedAppointment.completedAt,
        finalPriceCents: completedAppointment.finalPriceCents,
        tipCents: completedAppointment.tipCents,
        paymentMethod: completedAppointment.paymentMethod,
      },
      totals,
      depositCredit,
      showReviewPrompt,
    },
  } satisfies SuccessResponse);
}

// =============================================================================
// POST /api/appointments/[id]/start - Start an appointment (optional)
// =============================================================================
// Sets status to 'in_progress' and records startedAt.
// Used when tech begins working on client.
// =============================================================================

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;
    const access = await requireAppointmentManagerAccess(appointmentId, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can start this appointment',
      assignmentForbiddenMessage: 'You can only start your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
    });
    if (!access.ok) {
      return access.response;
    }
    const { appointment } = access;

    // 2. Check appointment is in valid state to start
    if (appointment.status !== 'confirmed') {
      return Response.json(
        {
          error: {
            code: 'INVALID_STATE',
            message: `Cannot start appointment in "${appointment.status}" status. Must be confirmed.`,
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Stable appointment ownership is authoritative. Only legacy appointments
    // without a stable salon_client_id may resolve through their immutable
    // contact snapshot.
    let expectedTerminalClientId: string | null = null;
    if (appointment.salonClientId) {
      expectedTerminalClientId = (
        await resolveTerminalSalonClient({
          salonId: appointment.salonId,
          clientId: appointment.salonClientId,
          allowArchived: true,
        })
      ).id;
    } else {
      let preliminaryIdentity: Awaited<
        ReturnType<typeof resolveCanonicalSalonClientIdentity>
      > = null;
      try {
        preliminaryIdentity = await resolveCanonicalSalonClientIdentity({
          salonId: appointment.salonId,
          phone: appointment.clientPhone,
          email: appointment.clientEmail,
          allowArchived: true,
        });
      } catch (error) {
        if (error instanceof TypeError) {
          throw new StartAppointmentIdentityConflictError();
        }
        throw error;
      }
      expectedTerminalClientId = preliminaryIdentity?.terminal.id ?? null;
    }
    if (!expectedTerminalClientId) {
      throw new StartAppointmentIdentityConflictError();
    }

    // Authoritative start transition. The lock order is terminal client,
    // technician advisory lock, then appointment row. The final update is a
    // compare-and-set, so a cancellation or another start that wins while this
    // request waits cannot be overwritten.
    const startedAppointment = await withClientLifecycleTransactionRetry(() =>
      db.transaction(async (tx) => {
        const terminalClient = await lockOperationalSalonClientContactWithHandle(
          tx as LifecycleSqlHandle,
          {
            salonId: appointment.salonId,
            clientId: expectedTerminalClientId,
            allowArchived: true,
          },
        );

        if (appointment.salonClientId) {
          const refreshedTerminal = await resolveTerminalSalonClientWithHandle(
            tx as LifecycleSqlHandle,
            {
              salonId: appointment.salonId,
              clientId: appointment.salonClientId,
              allowArchived: true,
            },
          );
          if (
            refreshedTerminal.id !== terminalClient.id
            || terminalClient.id !== expectedTerminalClientId
          ) {
            throw new StartAppointmentIdentityConflictError();
          }
        } else {
          let refreshedIdentity: Awaited<
            ReturnType<typeof resolveCanonicalSalonClientIdentityWithHandle>
          >;
          try {
            refreshedIdentity = await resolveCanonicalSalonClientIdentityWithHandle(
              tx as LifecycleSqlHandle,
              {
                salonId: appointment.salonId,
                phone: appointment.clientPhone,
                email: appointment.clientEmail,
                allowArchived: true,
              },
            );
          } catch (error) {
            if (error instanceof TypeError) {
              throw new StartAppointmentIdentityConflictError();
            }
            throw error;
          }
          if (
            !refreshedIdentity
            || refreshedIdentity.terminal.id !== terminalClient.id
          ) {
            throw new StartAppointmentIdentityConflictError();
          }
        }

        const expectedStartTime = new Date(appointment.startTime);
        const expectedEndTime = new Date(appointment.endTime);
        const blockedMinutes = appointment.blockedDurationMinutes
          ?? (
            appointment.totalDurationMinutes
            + (appointment.bufferMinutes ?? 0)
          );
        const expectedBlockedEndTime = new Date(Math.max(
          expectedEndTime.getTime(),
          expectedStartTime.getTime() + blockedMinutes * 60_000,
        ));

        if (appointment.technicianId) {
          await lockTechnicianAndAssertSlotFree(tx, {
            salonId: appointment.salonId,
            technicianId: appointment.technicianId,
            startTime: expectedStartTime,
            blockedEndTime: expectedBlockedEndTime,
            excludedAppointmentId: appointmentId,
          });
        }

        const [lockedAppointment] = await tx
          .select()
          .from(appointmentSchema)
          .where(and(
            eq(appointmentSchema.id, appointmentId),
            eq(appointmentSchema.salonId, appointment.salonId),
          ))
          .for('update')
          .limit(1);
        if (
          !lockedAppointment
          || lockedAppointment.status !== 'confirmed'
          || lockedAppointment.deletedAt
          || lockedAppointment.salonClientId !== appointment.salonClientId
          || lockedAppointment.clientPhone !== appointment.clientPhone
          || lockedAppointment.clientEmail !== appointment.clientEmail
          || lockedAppointment.technicianId !== appointment.technicianId
          || lockedAppointment.startTime.getTime() !== expectedStartTime.getTime()
          || lockedAppointment.endTime.getTime() !== expectedEndTime.getTime()
          || lockedAppointment.totalDurationMinutes
          !== appointment.totalDurationMinutes
          || lockedAppointment.bufferMinutes !== appointment.bufferMinutes
          || lockedAppointment.blockedDurationMinutes
          !== appointment.blockedDurationMinutes
        ) {
          throw new StartAppointmentStateConflictError();
        }

        const competingAppointments
          = await getActiveAppointmentsForCanonicalClientWithHandle(
            tx as LifecycleSqlHandle,
            {
              salonId: appointment.salonId,
              terminalClientId: terminalClient.id,
              horizon: 'lineage-active',
              excludeAppointmentId: appointmentId,
              allowArchived: true,
            },
          );
        if (competingAppointments.length > 0) {
          throw new StartAppointmentActiveConflictError();
        }

        const now = new Date();
        const [updatedAppointment] = await tx
          .update(appointmentSchema)
          .set({
            status: 'in_progress',
            canvasState: 'working',
            canvasStateUpdatedAt: now,
            startedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(appointmentSchema.id, appointmentId),
              eq(appointmentSchema.salonId, appointment.salonId),
              eq(appointmentSchema.status, 'confirmed'),
              isNull(appointmentSchema.deletedAt),
              ...(access.actorRole === 'staff'
                ? [eq(appointmentSchema.technicianId, access.session.technicianId)]
                : []),
            ),
          )
          .returning();
        if (!updatedAppointment) {
          throw new StartAppointmentStateConflictError();
        }

        return updatedAppointment;
      }),
    );

    // 4. Return success response
    return Response.json({
      data: {
        appointment: {
          id: appointmentId,
          status: 'in_progress',
          startedAt: startedAppointment.startedAt,
        },
      },
    });
  } catch (error) {
    if (error instanceof StartAppointmentStateConflictError) {
      return Response.json(
        {
          error: {
            code: 'APPOINTMENT_STATE_CHANGED',
            message: 'The appointment changed before it could be started.',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }
    if (error instanceof StartAppointmentActiveConflictError) {
      return Response.json(
        {
          error: {
            code: 'EXISTING_APPOINTMENT',
            message: 'This client already has another active appointment.',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }
    if (
      error instanceof StartAppointmentIdentityConflictError
      || error instanceof ClientLifecycleStabilizationError
    ) {
      return Response.json(
        {
          error: {
            code: 'CLIENT_IDENTITY_CONFLICT',
            message: 'The client identity could not be resolved safely.',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }
    if (error instanceof SlotConflictError) {
      return Response.json(
        {
          error: {
            code: 'TIME_CONFLICT',
            message: 'This appointment conflicts with another active appointment.',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }
    console.error('Error starting appointment:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to start appointment',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
