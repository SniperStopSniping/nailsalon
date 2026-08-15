import { and, desc, eq, inArray, ne } from 'drizzle-orm';

import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import { buildBookingEmailFinancialSummary } from '@/libs/bookingEmailFinancialSummary.server';
import { requireClientApiSession, requireClientSalonFromQuery } from '@/libs/clientApiGuards';
import { db } from '@/libs/DB';
import {
  appointmentDepositSchema,
  appointmentPaymentSchema,
  appointmentSchema,
  appointmentServicesSchema,
  serviceSchema,
  technicianSchema,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

/**
 * GET /api/appointments/history
 * Returns ALL appointments for a client, sorted newest to oldest.
 * Includes all statuses: pending, confirmed, in_progress, cancelled,
 * completed, no_show — but NOT 'awaiting_payment'. A deposit hold is an unpaid,
 * lapsing reservation, not a booking the client has made; showing it in the
 * history would present an appointment that may vanish minutes later.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const auth = await requireClientApiSession();
    if (!auth.ok) {
      return auth.response;
    }
    const salonGuard = await requireClientSalonFromQuery(url.searchParams);
    if (!salonGuard.ok) {
      return salonGuard.response;
    }
    const { salon } = salonGuard;

    // Find ALL appointments for this client, sorted by newest first
    const appointments = await db
      .select()
      .from(appointmentSchema)
      .where(
        and(
          inArray(appointmentSchema.clientPhone, auth.phoneVariants),
          eq(appointmentSchema.salonId, salon.id),
          ne(appointmentSchema.status, 'awaiting_payment'),
        ),
      )
      .orderBy(desc(appointmentSchema.startTime));

    if (appointments.length === 0) {
      return Response.json(
        { data: { appointments: [] } },
        { status: 200 },
      );
    }

    // Get all appointment IDs for batch fetching services
    const appointmentIds = appointments.map(a => a.id);

    // Batch fetch item and money history. Deposits remain their own ledger;
    // they are never fabricated as appointment_payment rows.
    const [allAppointmentServices, depositRows, paymentRows] = await Promise.all([
      db
        .select({
          appointmentId: appointmentServicesSchema.appointmentId,
          serviceId: appointmentServicesSchema.serviceId,
          priceAtBooking: appointmentServicesSchema.priceAtBooking,
          durationAtBooking: appointmentServicesSchema.durationAtBooking,
        })
        .from(appointmentServicesSchema)
        .where(inArray(appointmentServicesSchema.appointmentId, appointmentIds)),
      db
        .select()
        .from(appointmentDepositSchema)
        .where(and(
          eq(appointmentDepositSchema.salonId, salon.id),
          inArray(appointmentDepositSchema.appointmentId, appointmentIds),
        )),
      db
        .select()
        .from(appointmentPaymentSchema)
        .where(inArray(appointmentPaymentSchema.appointmentId, appointmentIds)),
    ]);
    const depositsByAppointment = new Map<string, typeof depositRows>();
    for (const row of depositRows) {
      const rows = depositsByAppointment.get(row.appointmentId) ?? [];
      rows.push(row);
      depositsByAppointment.set(row.appointmentId, rows);
    }
    const paymentsByAppointment = new Map<string, typeof paymentRows>();
    for (const row of paymentRows) {
      const rows = paymentsByAppointment.get(row.appointmentId) ?? [];
      rows.push(row);
      paymentsByAppointment.set(row.appointmentId, rows);
    }
    const paymentLedgerByAppointment = new Map<string, Extract<
      ReturnType<typeof resolveAppointmentPaymentLedger>,
      { ok: true }
    >>();
    for (const appointment of appointments) {
      const paymentLedger = resolveAppointmentPaymentLedger({
        cachedAmountPaidCents: appointment.amountPaidCents,
        paymentRows: paymentsByAppointment.get(appointment.id) ?? [],
        expectedSalonId: salon.id,
        appointmentStatus: appointment.status,
        paymentStatus: appointment.paymentStatus,
      });
      if (!paymentLedger.ok) {
        return Response.json(
          { error: { code: paymentLedger.code, message: paymentLedger.detail } } satisfies ErrorResponse,
          { status: 409 },
        );
      }
      paymentLedgerByAppointment.set(appointment.id, paymentLedger);
    }
    // Get unique service IDs
    const serviceIds = [...new Set(allAppointmentServices.map(as => as.serviceId))];

    // Batch fetch all services
    const services = serviceIds.length > 0
      ? await db
        .select()
        .from(serviceSchema)
        .where(inArray(serviceSchema.id, serviceIds))
      : [];

    // Create service lookup map
    const serviceMap = new Map(services.map(s => [s.id, s]));

    // Get unique technician IDs
    const technicianIds = [...new Set(appointments.map(a => a.technicianId).filter(Boolean))] as string[];

    // Batch fetch all technicians
    const technicians = technicianIds.length > 0
      ? await db
        .select()
        .from(technicianSchema)
        .where(inArray(technicianSchema.id, technicianIds))
      : [];

    // Create technician lookup map
    const technicianMap = new Map(technicians.map(t => [t.id, t]));

    // Build response with all details
    const appointmentsWithDetails = appointments.map((appointment) => {
      // Get services for this appointment
      const apptServices = allAppointmentServices.filter(
        as => as.appointmentId === appointment.id,
      );

      const servicesData = apptServices.map((as) => {
        const service = serviceMap.get(as.serviceId);
        return {
          id: as.serviceId,
          name: service?.name ?? 'Unknown Service',
          price: as.priceAtBooking,
          duration: as.durationAtBooking,
          imageUrl: service?.imageUrl ?? null,
        };
      });

      // Get technician
      const technician = appointment.technicianId
        ? technicianMap.get(appointment.technicianId)
        : null;
      const paymentLedger = paymentLedgerByAppointment.get(appointment.id)!;
      const invoiceCurrency = appointment.invoiceCurrency
        ?? appointment.finalTaxSnapshot?.currency
        ?? appointment.rescheduleTaxSnapshot?.currency
        ?? appointment.bookingTaxSnapshot?.currency
        ?? null;
      const financialSummary = buildBookingEmailFinancialSummary({
        appointment,
        deposits: depositsByAppointment.get(appointment.id) ?? [],
        appointmentPaymentsCents: paymentLedger.appointmentPaymentsCents,
      });

      return {
        id: appointment.id,
        startTime: appointment.startTime.toISOString(),
        endTime: appointment.endTime.toISOString(),
        status: appointment.status,
        cancelReason: appointment.cancelReason,
        totalPrice: appointment.totalPrice,
        currency: invoiceCurrency,
        totalDurationMinutes: appointment.totalDurationMinutes,
        financial: financialSummary
          ? {
              serviceInvoiceTotalCents: financialSummary.serviceInvoiceTotalCents,
              totalCents: financialSummary.totalDueCents,
              depositCreditCents: financialSummary.depositCreditAppliedCents,
              appointmentPaymentsCents: financialSummary.appointmentPaymentsCents,
              amountAlreadyPaidCents: financialSummary.amountAlreadyPaidCents,
              balanceCents: financialSummary.balanceCents,
              depositState: financialSummary.depositBlockedCode === null
                ? 'resolved' as const
                : 'blocked' as const,
              depositBlockCode: financialSummary.depositBlockedCode,
              depositPresentationState: financialSummary.depositPresentationState,
              collectedDepositCents: financialSummary.collectedDepositCents,
              refundedDepositCents: financialSummary.refundedDepositCents,
              forfeitedDepositCents: financialSummary.forfeitedDepositCents,
            }
          : null,
        locationId: appointment.locationId,
        services: servicesData,
        technician: technician
          ? {
              id: technician.id,
              name: technician.name,
              avatarUrl: technician.avatarUrl,
            }
          : null,
      };
    });

    return Response.json({
      data: {
        appointments: appointmentsWithDetails,
      },
      meta: {
        timestamp: new Date().toISOString(),
        count: appointmentsWithDetails.length,
      },
    });
  } catch (error) {
    console.error('Error fetching appointment history:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
