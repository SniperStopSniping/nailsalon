import { and, asc, eq } from 'drizzle-orm';

import { getSalonPolicy, getSuperAdminPolicy } from '@/core/appointments/policyRepo';
import {
  listPayments,
} from '@/libs/appointmentCheckoutServer';
import {
  resolveAppointmentDepositFinancials,
} from '@/libs/appointmentDepositFinancials';
import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import {
  resolveCheckoutCurrencyProjection,
  validateAppointmentTaxSnapshotChain,
} from '@/libs/appointmentTaxSnapshot';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { buildPaymentReference, derivePaymentStatus } from '@/libs/checkoutTotals';
import { db } from '@/libs/DB';
import { loadAppointmentDepositCreditRows } from '@/libs/depositCredit.server';
import { getSalonById } from '@/libs/queries';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';
import {
  resolveEtransferSettings,
  resolveTaxConfig,
} from '@/libs/taxConfig';
import {
  addOnSchema,
  appointmentAddOnSchema,
  appointmentFinalItemSchema,
  appointmentPhotoSchema,
  appointmentServicesSchema,
  serviceSchema,
} from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

export const dynamic = 'force-dynamic';

// =============================================================================
// GET /api/appointments/[id]/checkout — everything the checkout sheet needs
// =============================================================================
// One request: booked snapshot items (immutable), final items (when a prior
// completion recorded them), the salon catalog, resolved tax config, photos,
// payments + balance, e-Transfer instructions, and the coarse permission map.
// =============================================================================

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;
    const access = await requireAppointmentManagerAccess(appointmentId, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can check out this appointment',
      assignmentForbiddenMessage: 'You can only check out your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
    });
    if (!access.ok) {
      return access.response;
    }
    const { appointment } = access;
    const isAdmin = access.actorRole === 'admin';

    const [
      salon,
      bookedServices,
      bookedAddOns,
      finalItems,
      photos,
      payments,
      depositRows,
      catalogServices,
      catalogAddOns,
      salonPolicy,
      superAdminPolicy,
    ] = await Promise.all([
      getSalonById(appointment.salonId),
      db
        .select()
        .from(appointmentServicesSchema)
        .where(eq(appointmentServicesSchema.appointmentId, appointmentId)),
      db
        .select()
        .from(appointmentAddOnSchema)
        .where(eq(appointmentAddOnSchema.appointmentId, appointmentId)),
      db
        .select()
        .from(appointmentFinalItemSchema)
        .where(eq(appointmentFinalItemSchema.appointmentId, appointmentId))
        .orderBy(asc(appointmentFinalItemSchema.sortOrder)),
      db
        .select({
          id: appointmentPhotoSchema.id,
          imageUrl: appointmentPhotoSchema.imageUrl,
          thumbnailUrl: appointmentPhotoSchema.thumbnailUrl,
          photoType: appointmentPhotoSchema.photoType,
          uploadedByTechId: appointmentPhotoSchema.uploadedByTechId,
        })
        .from(appointmentPhotoSchema)
        .where(
          and(
            eq(appointmentPhotoSchema.appointmentId, appointmentId),
            eq(appointmentPhotoSchema.salonId, appointment.salonId),
          ),
        )
        .orderBy(asc(appointmentPhotoSchema.createdAt)),
      listPayments(db, appointmentId),
      loadAppointmentDepositCreditRows({
        salonId: appointment.salonId,
        appointmentId,
      }),
      db
        .select({
          id: serviceSchema.id,
          name: serviceSchema.name,
          category: serviceSchema.category,
          priceCents: serviceSchema.price,
          durationMinutes: serviceSchema.durationMinutes,
        })
        .from(serviceSchema)
        .where(and(
          eq(serviceSchema.salonId, appointment.salonId),
          eq(serviceSchema.isActive, true),
        ))
        .orderBy(asc(serviceSchema.sortOrder)),
      db
        .select({
          id: addOnSchema.id,
          name: addOnSchema.name,
          category: addOnSchema.category,
          priceCents: addOnSchema.priceCents,
          durationMinutes: addOnSchema.durationMinutes,
          pricingType: addOnSchema.pricingType,
          maxQuantity: addOnSchema.maxQuantity,
        })
        .from(addOnSchema)
        .where(and(
          eq(addOnSchema.salonId, appointment.salonId),
          eq(addOnSchema.isActive, true),
        )),
      getSalonPolicy(db, appointment.salonId),
      getSuperAdminPolicy(db),
    ]);

    const settings = (salon?.settings as SalonSettings | null | undefined) ?? null;
    const bookingConfig = resolveBookingConfigFromSettings(settings);
    const taxConfig = resolveTaxConfig(settings, new Date());
    const etransfer = resolveEtransferSettings(settings);
    const taxChain = validateAppointmentTaxSnapshotChain(appointment);
    if (!taxChain.ok) {
      return Response.json(
        {
          error: {
            code: 'TAX_SNAPSHOT_INVALID',
            reason: taxChain.code,
            message: taxChain.detail,
          },
        },
        { status: 409 },
      );
    }
    const frozenInvoiceCurrency = taxChain.invoiceCurrency;
    const checkoutCurrency = resolveCheckoutCurrencyProjection({
      frozenCurrency: frozenInvoiceCurrency,
      currentCurrency: bookingConfig.currency,
      appointmentStatus: appointment.status,
      hasDepositHistory: depositRows.length > 0,
      hasSnapshotEvidence: appointment.bookingTaxSnapshot !== null
        || appointment.rescheduleTaxSnapshot !== null
        || appointment.finalTaxSnapshot !== null,
    });
    const paymentLedger = resolveAppointmentPaymentLedger({
      cachedAmountPaidCents: appointment.amountPaidCents,
      paymentRows: payments,
      expectedSalonId: appointment.salonId,
      appointmentStatus: appointment.status,
      paymentStatus: appointment.paymentStatus,
    });
    if (!paymentLedger.ok) {
      return Response.json(
        { error: { code: paymentLedger.code, message: paymentLedger.detail } },
        { status: 409 },
      );
    }
    const hasFinalInvoice = appointment.finalPriceCents !== null;
    const activeTaxSnapshot = taxChain.active.snapshot;
    const depositFinancials = resolveAppointmentDepositFinancials({
      deposits: depositRows,
      invoiceCurrency: checkoutCurrency,
      finalPriceCents: hasFinalInvoice
        ? appointment.finalPriceCents
        : activeTaxSnapshot?.serviceSubtotalCents ?? appointment.totalPrice,
      taxAmountCents: hasFinalInvoice
        ? appointment.taxAmountCents
        : activeTaxSnapshot?.taxAmountCents ?? 0,
      tipCents: hasFinalInvoice ? appointment.tipCents : 0,
      appointmentPaymentsCents: paymentLedger.appointmentPaymentsCents,
      appointmentStatus: appointment.status,
      paymentStatus: appointment.paymentStatus,
    });
    const tenderOverpayment = depositFinancials.financials.ok
      && depositFinancials.financials.tenderExcessCents > 0;
    const balance = depositFinancials.balance ?? {
      serviceInvoiceTotalCents: 0,
      totalDueCents: 0,
      appointmentPaymentsCents: 0,
      depositCreditAppliedCents: 0,
      amountAlreadyPaidCents: 0,
      balanceCents: 0,
      excessDepositCents: 0,
      tenderExcessCents: 0,
      legacyPaidAssumed: false,
    };
    const canonicalPaymentStatus
      = tenderOverpayment
        ? (appointment.paymentStatus === 'comp' ? 'comp' : 'pending')
        : depositFinancials.depositResolution.ok && depositFinancials.financials.ok
          ? appointment.paymentStatus === 'comp'
            ? 'comp'
            : derivePaymentStatus(
              depositFinancials.financials.totalDueCents,
              depositFinancials.financials.amountAlreadyPaidCents,
            )
          : appointment.paymentStatus;

    const bookedItems = [
      ...bookedServices.map(row => ({
        kind: 'service' as const,
        catalogServiceId: row.serviceId,
        catalogAddOnId: null,
        name: row.nameSnapshot ?? 'Service',
        quantity: 1,
        unitPriceCents: row.priceCentsSnapshot ?? row.priceAtBooking,
        lineTotalCents: row.priceCentsSnapshot ?? row.priceAtBooking,
        durationMinutes: row.durationMinutesSnapshot ?? row.durationAtBooking,
      })),
      ...bookedAddOns.map(row => ({
        kind: 'addon' as const,
        catalogServiceId: null,
        catalogAddOnId: row.addOnId,
        name: row.nameSnapshot,
        quantity: row.quantitySnapshot,
        unitPriceCents: row.unitPriceCentsSnapshot,
        lineTotalCents: row.lineTotalCentsSnapshot,
        durationMinutes: row.lineDurationMinutesSnapshot,
      })),
    ];

    return Response.json({
      data: {
        appointment: {
          id: appointment.id,
          status: appointment.status,
          paymentStatus: canonicalPaymentStatus,
          clientName: appointment.clientName,
          startTime: appointment.startTime,
          endTime: appointment.endTime,
          totalDurationMinutes: appointment.totalDurationMinutes,
          totalPrice: appointment.totalPrice,
          subtotalBeforeDiscountCents: appointment.subtotalBeforeDiscountCents,
          discountAmountCents: appointment.discountAmountCents,
          discountLabel: appointment.discountLabel,
          startedAt: appointment.startedAt,
          completedAt: appointment.completedAt,
          actualStartAt: appointment.actualStartAt,
          actualEndAt: appointment.actualEndAt,
          finalPriceCents: appointment.finalPriceCents,
          finalSubtotalCents: appointment.finalSubtotalCents,
          finalDiscountCents: appointment.finalDiscountCents,
          finalDiscountReason: appointment.finalDiscountReason,
          tipCents: appointment.tipCents,
          paymentMethod: appointment.paymentMethod,
          taxEnabledSnapshot: appointment.taxEnabledSnapshot,
          taxNameSnapshot: appointment.taxNameSnapshot,
          taxRateBps: appointment.taxRateBps,
          taxInclusive: appointment.taxInclusive,
          taxAmountCents: appointment.taxAmountCents,
          taxableSubtotalCents: appointment.taxableSubtotalCents,
          taxExempt: appointment.taxExempt,
          taxExemptReason: appointment.taxExemptReason,
          invoiceCurrency: appointment.invoiceCurrency,
          bookingTaxSnapshot: appointment.bookingTaxSnapshot,
          rescheduleTaxSnapshot: appointment.rescheduleTaxSnapshot,
          finalTaxSnapshot: appointment.finalTaxSnapshot,
        },
        bookedItems,
        finalItems: finalItems.map(item => ({
          id: item.id,
          kind: item.kind,
          catalogServiceId: item.catalogServiceId,
          catalogAddOnId: item.catalogAddOnId,
          name: item.name,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          lineTotalCents: item.lineTotalCents,
          durationMinutes: item.durationMinutes,
          taxable: item.taxable,
        })),
        catalog: {
          services: catalogServices,
          addOns: catalogAddOns,
        },
        taxConfig,
        currency: checkoutCurrency,
        timeZone: bookingConfig.timezone,
        photoPolicy: {
          requireAfterPhotoToFinish:
            superAdminPolicy.requireAfterPhotoToFinish
            ?? salonPolicy.requireAfterPhotoToFinish
            ?? 'off',
        },
        photos,
        payments: payments.map((payment: typeof payments[number]) => ({
          id: payment.id,
          amountCents: payment.amountCents,
          method: payment.method,
          reference: payment.reference,
          note: payment.note,
          recordedAt: payment.recordedAt,
          recordedByName: payment.recordedByName,
          voidedAt: payment.voidedAt,
        })),
        depositCredit: depositFinancials.depositCredit,
        balance,
        etransfer,
        paymentReference: buildPaymentReference(appointment.id),
        permissions: {
          canEditItems: true,
          canApplyDiscount: true,
          canRecordPayment: true,
          canTaxExempt: isAdmin,
          canMarkComp: isAdmin,
          canVoidPayments: isAdmin,
          canReopen: isAdmin && appointment.status === 'completed',
          canRemovePhotos: isAdmin,
        },
      },
    });
  } catch (error) {
    console.error('Error loading checkout context:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load checkout details' } },
      { status: 500 },
    );
  }
}
