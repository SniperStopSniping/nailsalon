import crypto from 'node:crypto';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { getSalonPolicy, getSuperAdminPolicy } from '@/core/appointments/policyRepo';
import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import {
  resolveCheckoutActor,
  sumNonVoidedPayments,
} from '@/libs/appointmentCheckoutServer';
import {
  computeCheckoutTotals,
  derivePaymentStatus,
  type ResolvedTaxConfig,
} from '@/libs/checkoutTotals';
import { db } from '@/libs/DB';
import { evaluateAndFlagIfNeeded } from '@/libs/fraudDetection';
import { computeEarnedPointsFromCents } from '@/libs/pointsCalculation';
import {
  getAppointmentById,
  getOrCreateSalonClient,
  getSalonById,
  updateSalonClientStats,
} from '@/libs/queries';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';
import { resolveTaxConfig } from '@/libs/taxConfig';
import {
  addOnSchema,
  appointmentAuditLogSchema,
  appointmentFinalItemSchema,
  appointmentPaymentSchema,
  appointmentPhotoSchema,
  appointmentSchema,
  PAYMENT_METHODS,
  salonClientSchema,
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
  taxExemptReason: z.string().trim().max(200).optional(),
  // Payments recorded at checkout. PRESENCE of this field (even empty) opts
  // into derived payment status; absence keeps the legacy hard-coded 'paid'.
  payments: z.array(paymentEntrySchema).max(10).optional(),
  // Admin-only. 'comp' = complimentary (0 revenue, no payments allowed).
  paymentStatusIntent: z.literal('comp').optional(),
  // Optimistic-concurrency check: server recomputes and 409s on drift.
  expectedTotalDueCents: z.number().int().min(0).max(10_000_000).optional(),
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

type CompletionTotals = {
  finalSubtotalCents: number;
  finalDiscountCents: number;
  taxableSubtotalCents: number;
  taxAmountCents: number;
  finalPriceCents: number;
  tipCents: number;
  totalDueCents: number;
  amountPaidCents: number | null;
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
    // Whether the post-appointment review prompt should be shown to the tech.
    // False once the client is marked as already reviewed on Google.
    showReviewPrompt?: boolean;
  };
};

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
    const services = await db
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
    const addOns = await db
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
      return Response.json({
        data: {
          appointment: {
            id: appointmentId,
            status: 'completed',
            paymentStatus: existingAppointment.paymentStatus ?? 'paid',
            completedAt: existingAppointment.completedAt ?? new Date(),
          },
        },
      } satisfies SuccessResponse);
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

    // 5. Resolve tax config (frozen into the snapshot) and the final items.
    const salon = await getSalonById(existingAppointment.salonId);
    const now = new Date();
    const taxConfig = resolveTaxConfig(
      (salon?.settings as SalonSettings | null | undefined) ?? null,
      now,
    );
    const taxExempt = payload.taxExempt ?? false;

    const finalItems = await resolveFinalItems(existingAppointment, payload, taxConfig);
    // Two independent capabilities: recording WHAT was performed (any item
    // shape, incl. legacy performed-ids) vs pricing FROM the items (only the
    // explicit `finalItems` checkout payload). The legacy staff sheet sends
    // performed ids + a hand-entered finalPriceCents — its money truth stays
    // the entered price, exactly as before this phase.
    const pricedFromItems = payload.finalItems !== undefined;

    // 6. Compute totals. Item-priced mode sums the lines; legacy mode treats
    // the (possibly overridden) final price as one default-taxable line so a
    // tax-enabled salon still gets a consistent snapshot.
    const tipCents = payload.tipCents ?? 0;
    const legacyFinalPrice = payload.finalPriceCents ?? existingAppointment.totalPrice;
    const totals = computeCheckoutTotals({
      items: pricedFromItems
        ? finalItems!.map(item => ({ lineTotalCents: item.lineTotalCents, taxable: item.taxable }))
        : [{
            lineTotalCents: legacyFinalPrice,
            taxable: defaultTaxableFor('service', taxConfig),
          }],
      discountCents: pricedFromItems ? payload.discountCents ?? 0 : 0,
      taxConfig,
      taxExempt,
      tipCents,
    });

    if (
      payload.expectedTotalDueCents !== undefined
      && payload.expectedTotalDueCents !== totals.totalDueCents
    ) {
      return Response.json(
        {
          error: {
            code: 'TOTALS_MISMATCH',
            message: 'The salon tax or pricing settings changed while checking out. Review the updated totals and try again.',
            details: { totals },
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    // 7. Payments recorded at checkout: presence of `payments` (even empty)
    // opts into derived payment status; absence keeps legacy 'paid'.
    // Payments surviving a reopen also count toward the paid total, so the
    // combined sum (existing non-voided rows + new entries) is the basis.
    const paymentsProvided = payload.payments !== undefined || payload.paymentStatusIntent !== undefined;
    const paymentEntries = payload.payments ?? [];
    const paidSum = paymentEntries.reduce((sum, entry) => sum + entry.amountCents, 0);
    const existingPaidCents = paymentsProvided
      ? await sumNonVoidedPayments(db, appointmentId)
      : 0;
    const combinedPaidCents = existingPaidCents + paidSum;

    if (paymentsProvided && combinedPaidCents > totals.totalDueCents) {
      return Response.json(
        {
          error: {
            code: 'PAYMENTS_EXCEED_TOTAL',
            message: 'Recorded payments exceed the amount due',
            details: { totals },
          },
        } satisfies ErrorResponse,
        { status: 422 },
      );
    }
    if (payload.paymentStatusIntent === 'comp' && existingPaidCents > 0) {
      return Response.json(
        {
          error: {
            code: 'COMP_WITH_PAYMENTS',
            message: 'Void the recorded payments before marking this appointment complimentary',
          },
        } satisfies ErrorResponse,
        { status: 422 },
      );
    }

    const paymentStatus = payload.paymentStatusIntent === 'comp'
      ? 'comp'
      : paymentsProvided
        ? derivePaymentStatus(totals.totalDueCents, combinedPaidCents)
        : 'paid'; // Legacy contract: completion implies paid.
    const amountPaidCents = paymentsProvided
      ? (payload.paymentStatusIntent === 'comp' ? 0 : combinedPaidCents)
      : null; // Not recorded (legacy) — reads as "unknown", not zero owed.
    const paymentMethod = payload.paymentMethod
      ?? paymentEntries.find(entry => entry.method)?.method;

    const actor = resolveCheckoutActor(access);

    // 8. ATOMIC COMPLETION. Every checkout write is gated on the CAS update:
    // an idempotent replay (0 rows) inserts nothing.
    const validStates = ['confirmed', 'in_progress'] as const;

    const result = await db.transaction(async (tx) => {
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
          // Legacy bodies never touch the paid total (preserves it across a
          // legacy-shaped re-completion after reopen).
          ...(paymentsProvided ? { amountPaidCents } : {}),
          ...(payload.actualStartAt ? { actualStartAt: payload.actualStartAt } : {}),
          ...(payload.actualEndAt ? { actualEndAt: payload.actualEndAt } : {}),
          // Tax snapshot — frozen forever; settings changes never recalculate.
          taxEnabledSnapshot: taxConfig.enabled,
          ...(taxConfig.enabled
            ? {
                taxNameSnapshot: taxConfig.name,
                taxRateBps: taxConfig.rateBps,
                taxInclusive: taxConfig.pricesIncludeTax,
                taxAmountCents: totals.taxAmountCents,
                taxableSubtotalCents: totals.taxableSubtotalCents,
                taxExempt,
                taxExemptReason: taxExempt ? payload.taxExemptReason ?? null : null,
              }
            : {}),
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
      return { success: true as const, updatedAppointment: completedAppointment };
    });

    // 9. Handle transaction result
    if (!result.success) {
      // Atomic update failed - re-fetch to determine why
      const currentAppointment = await getAppointmentById(
        appointmentId,
        existingAppointment.salonId,
      );

      if (currentAppointment?.status === 'completed') {
        // IDEMPOTENT: Already completed - return current state
        // DO NOT run fraud eval or points - already processed on first completion
        return Response.json({
          data: {
            appointment: {
              id: appointmentId,
              status: 'completed',
              paymentStatus: currentAppointment.paymentStatus ?? 'paid',
              completedAt: currentAppointment.completedAt ?? now,
            },
          },
        } satisfies SuccessResponse);
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

    const updatedAppointment = result.updatedAppointment;
    if (!updatedAppointment) {
      console.warn('[BUG] Unexpected: success=true but updatedAppointment is null', {
        appointmentId,
      });
      return Response.json({
        data: {
          appointment: {
            id: appointmentId,
            status: 'completed',
            paymentStatus,
            completedAt: now,
          },
        },
      } satisfies SuccessResponse);
    }

    return await handleSuccessfulCompletion(
      updatedAppointment,
      appointmentId,
      now,
      {
        ...totals,
        amountPaidCents,
        balanceCents: paymentStatus === 'comp'
          ? 0
          : Math.max(0, totals.totalDueCents - (amountPaidCents ?? totals.totalDueCents)),
      },
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
  if (salonClientId && completedAppointment.paymentStatus === 'paid') {
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

  // 6c. Recompute client stats (visits/spend/points) POST-COMMIT so the just-
  // completed appointment is counted. Non-fatal — stats are recomputable.
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

    // 3. Update appointment to in_progress
    const now = new Date();

    await db
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
          ...(access.actorRole === 'staff'
            ? [eq(appointmentSchema.technicianId, access.session.technicianId)]
            : []),
        ),
      );

    // 4. Return success response
    return Response.json({
      data: {
        appointment: {
          id: appointmentId,
          status: 'in_progress',
          startedAt: now,
        },
      },
    });
  } catch (error) {
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
