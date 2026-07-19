import { and, asc, eq } from 'drizzle-orm';

import { getSalonPolicy, getSuperAdminPolicy } from '@/core/appointments/policyRepo';
import {
  listPayments,
  sumNonVoidedPayments,
} from '@/libs/appointmentCheckoutServer';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { buildPaymentReference, computeBalance } from '@/libs/checkoutTotals';
import { db } from '@/libs/DB';
import { getSalonById } from '@/libs/queries';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';
import { resolveEtransferSettings, resolveTaxConfig } from '@/libs/taxConfig';
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
      amountPaidCents,
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
      sumNonVoidedPayments(db, appointmentId),
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
    const balance = computeBalance({
      finalPriceCents: appointment.finalPriceCents,
      taxAmountCents: appointment.taxAmountCents,
      tipCents: appointment.tipCents,
      amountPaidCents,
      paymentStatus: appointment.paymentStatus,
    });

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
          paymentStatus: appointment.paymentStatus,
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
        currency: bookingConfig.currency,
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
