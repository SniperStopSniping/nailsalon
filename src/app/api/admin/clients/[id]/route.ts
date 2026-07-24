import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { getAdminSession, requireAdminSalon } from '@/libs/adminAuth';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import {
  collectClientContactAliases,
  editSalonClient,
  getClientDependencySummary,
  permanentlyDeleteSalonClient,
  resolveSalonClient,
} from '@/libs/clientLifecycle';
import {
  clientLifecycleErrorResponse,
  privateClientJson,
} from '@/libs/clientLifecycleHttp';
import { requireClientManagerSalon } from '@/libs/clientManagementAuth';
import { db } from '@/libs/DB';
import { buildReportingProvenance, resolveAppointmentBalance, resolveCompletedAppointmentRevenue } from '@/libs/financialReporting';
import { getCurrentFinancialReportingRanges, getFinancialBalanceSummary } from '@/libs/financialReportingServer';
import { normalizePhone } from '@/libs/queries';
import { completedAppointmentRevenueAggregateSql } from '@/libs/revenueSql';
import {
  appointmentAddOnSchema,
  appointmentFinalItemSchema,
  appointmentPaymentSchema,
  appointmentPhotoSchema,
  appointmentSchema,
  appointmentServicesSchema,
  clientPreferencesSchema,
  salonClientNoteSchema,
  salonLocationSchema,
  serviceSchema,
  technicianSchema,
} from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const getQuerySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

const updateSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  firstName: z.string().trim().max(100).optional().nullable(),
  lastName: z.string().trim().max(100).optional().nullable(),
  fullName: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional().nullable(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  preferredTechnicianId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  sensitivities: z.string().max(2000).optional().nullable(),
  nailPreferences: z.object({
    shape: z.string().max(100).optional(),
    length: z.string().max(100).optional(),
    favoriteColors: z.string().max(500).optional(),
    productsUsed: z.string().max(1000).optional(),
  }).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  rebookIntervalDays: z.number().int().min(1).max(365).optional().nullable(),
});

const destructiveSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
});

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

function withPrivateNoStore(response: Response): Response {
  for (const [key, value] of Object.entries({
    'Cache-Control': 'private, no-store, max-age=0',
    'Pragma': 'no-cache',
    'Vary': 'Cookie',
  })) {
    response.headers.set(key, value);
  }
  return response;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

// =============================================================================
// GET /api/admin/clients/[id] - Get client profile with appointment history
// =============================================================================
// VISIBILITY: Admin role = full_access (no redaction applied)
// The getEffectiveVisibility(policy, 'admin') returns 'full_access' for admin role.
// All client data is returned without redaction.
// =============================================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: clientId } = await params;
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    // Validate query params
    const validated = getQuerySchema.safeParse(queryParams);
    if (!validated.success) {
      return privateClientJson(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: validated.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { salonSlug } = validated.data;

    // Verify user owns this salon
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return withPrivateNoStore(error!);
    }
    const admin = await getAdminSession();
    const membership = admin?.salons.find(candidate => candidate.salonId === salon.id);
    const canManageLifecycle = Boolean(
      admin?.isSuperAdmin
      || membership?.role === 'owner'
      || membership?.role === 'admin',
    );

    // Resolve preserved merged aliases to their stable primary profile.
    const resolvedClient = await resolveSalonClient({
      salonId: salon.id,
      clientId,
    });
    const client = resolvedClient.client;

    // Get preferred technician details if set
    let preferredTechnician = null;
    if (client.preferredTechnicianId) {
      const [tech] = await db
        .select({
          id: technicianSchema.id,
          name: technicianSchema.name,
          avatarUrl: technicianSchema.avatarUrl,
        })
        .from(technicianSchema)
        .where(and(
          eq(technicianSchema.id, client.preferredTechnicianId),
          eq(technicianSchema.salonId, salon.id),
        ))
        .limit(1);
      preferredTechnician = tech ?? null;
    }

    // Stable IDs are authoritative. Contact aliases only recover legacy rows
    // that predate appointment.salon_client_id.
    const contactAliases = await collectClientContactAliases({
      salonId: salon.id,
      clientId: client.id,
    });
    const normalizedPhone = normalizePhone(client.phone);
    const normalizedPhones = [...new Set([
      normalizedPhone,
      ...contactAliases.phones.map(normalizePhone),
    ].filter(Boolean))];
    const phoneVariants = [...new Set(
      normalizedPhones.flatMap(phone => [phone, `1${phone}`, `+1${phone}`]),
    )];
    const clientAppointmentIdentity = or(
      eq(appointmentSchema.salonClientId, client.id),
      and(
        isNull(appointmentSchema.salonClientId),
        inArray(appointmentSchema.clientPhone, phoneVariants),
      ),
    );

    const now = new Date();

    // Get upcoming appointments
    const upcomingAppointments = await db
      .select({
        id: appointmentSchema.id,
        startTime: appointmentSchema.startTime,
        endTime: appointmentSchema.endTime,
        status: appointmentSchema.status,
        totalPrice: appointmentSchema.totalPrice,
        technicianId: appointmentSchema.technicianId,
        locationId: appointmentSchema.locationId,
        notes: appointmentSchema.notes,
        finalPriceCents: appointmentSchema.finalPriceCents,
        finalDiscountCents: appointmentSchema.finalDiscountCents,
        taxAmountCents: appointmentSchema.taxAmountCents,
        tipCents: appointmentSchema.tipCents,
        paymentStatus: appointmentSchema.paymentStatus,
        amountPaidCents: appointmentSchema.amountPaidCents,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, salon.id),
          clientAppointmentIdentity,
          isNull(appointmentSchema.deletedAt),
          gte(appointmentSchema.startTime, now),
          inArray(appointmentSchema.status, ['pending', 'confirmed']),
        ),
      )
      .orderBy(appointmentSchema.startTime)
      .limit(5);

    // Get completed appointments (most recent 20)
    const pastAppointments = await db
      .select({
        id: appointmentSchema.id,
        startTime: appointmentSchema.startTime,
        endTime: appointmentSchema.endTime,
        status: appointmentSchema.status,
        totalPrice: appointmentSchema.totalPrice,
        technicianId: appointmentSchema.technicianId,
        locationId: appointmentSchema.locationId,
        notes: appointmentSchema.notes,
        finalPriceCents: appointmentSchema.finalPriceCents,
        finalDiscountCents: appointmentSchema.finalDiscountCents,
        taxAmountCents: appointmentSchema.taxAmountCents,
        tipCents: appointmentSchema.tipCents,
        paymentStatus: appointmentSchema.paymentStatus,
        amountPaidCents: appointmentSchema.amountPaidCents,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, salon.id),
          clientAppointmentIdentity,
          isNull(appointmentSchema.deletedAt),
          lt(appointmentSchema.startTime, now),
          eq(appointmentSchema.status, 'completed'),
        ),
      )
      .orderBy(desc(appointmentSchema.startTime))
      .limit(20);

    // Get recent issues separately so completed history stays clean.
    const recentIssues = await db
      .select({
        id: appointmentSchema.id,
        startTime: appointmentSchema.startTime,
        endTime: appointmentSchema.endTime,
        status: appointmentSchema.status,
        totalPrice: appointmentSchema.totalPrice,
        technicianId: appointmentSchema.technicianId,
        locationId: appointmentSchema.locationId,
        notes: appointmentSchema.notes,
        finalPriceCents: appointmentSchema.finalPriceCents,
        finalDiscountCents: appointmentSchema.finalDiscountCents,
        taxAmountCents: appointmentSchema.taxAmountCents,
        tipCents: appointmentSchema.tipCents,
        paymentStatus: appointmentSchema.paymentStatus,
        amountPaidCents: appointmentSchema.amountPaidCents,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, salon.id),
          clientAppointmentIdentity,
          isNull(appointmentSchema.deletedAt),
          lt(appointmentSchema.startTime, now),
          inArray(appointmentSchema.status, ['cancelled', 'no_show']),
        ),
      )
      .orderBy(desc(appointmentSchema.startTime))
      .limit(20);

    // Get technician and service details for all appointments
    const allAppointmentIds = [
      ...upcomingAppointments.map(a => a.id),
      ...pastAppointments.map(a => a.id),
      ...recentIssues.map(a => a.id),
    ];

    const allTechIds = [
      ...upcomingAppointments.map(a => a.technicianId),
      ...pastAppointments.map(a => a.technicianId),
      ...recentIssues.map(a => a.technicianId),
    ].filter((id): id is string => id !== null);

    // Get technicians
    let techMap = new Map<string, { id: string; name: string; avatarUrl: string | null }>();
    if (allTechIds.length > 0) {
      const technicians = await db
        .select({
          id: technicianSchema.id,
          name: technicianSchema.name,
          avatarUrl: technicianSchema.avatarUrl,
        })
        .from(technicianSchema)
        .where(inArray(technicianSchema.id, allTechIds));
      techMap = new Map(technicians.map(t => [t.id, t]));
    }

    const upcomingLocationIds = [
      ...new Set(
        upcomingAppointments
          .map(appointment => appointment.locationId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    let locationMap = new Map<string, {
      id: string;
      name: string;
      address: string | null;
      city: string | null;
      state: string | null;
      zipCode: string | null;
    }>();
    if (upcomingLocationIds.length > 0) {
      const locations = await db
        .select({
          id: salonLocationSchema.id,
          name: salonLocationSchema.name,
          address: salonLocationSchema.address,
          city: salonLocationSchema.city,
          state: salonLocationSchema.state,
          zipCode: salonLocationSchema.zipCode,
        })
        .from(salonLocationSchema)
        .where(and(
          eq(salonLocationSchema.salonId, salon.id),
          inArray(salonLocationSchema.id, upcomingLocationIds),
        ));
      locationMap = new Map(locations.map(location => [location.id, location]));
    }

    // Get services for each appointment
    const appointmentServicesMap = new Map<string, { id: string; name: string; price: number }[]>();
    const appointmentAddOnsMap = new Map<string, {
      id: string;
      name: string;
      quantity: number;
      lineTotalCents: number;
    }[]>();
    const appointmentFinalItemsMap = new Map<string, {
      id: string;
      kind: string;
      name: string;
      quantity: number;
      lineTotalCents: number;
    }[]>();
    const appointmentPaymentsMap = new Map<string, {
      id: string;
      amountCents: number;
      method: string | null;
      recordedAt: string;
    }[]>();
    const appointmentHasPaymentHistory = new Set<string>();
    if (allAppointmentIds.length > 0) {
      const [services, addOns, finalItems, paymentRows] = await Promise.all([
        db
          .select({
            appointmentId: appointmentServicesSchema.appointmentId,
            serviceId: appointmentServicesSchema.serviceId,
            serviceName: sql<string>`COALESCE(
              ${appointmentServicesSchema.nameSnapshot},
              ${serviceSchema.name},
              'Service'
            )`,
            priceAtBooking: sql<number>`COALESCE(
              ${appointmentServicesSchema.priceCentsSnapshot},
              ${appointmentServicesSchema.priceAtBooking}
            )`,
          })
          .from(appointmentServicesSchema)
          .leftJoin(serviceSchema, eq(appointmentServicesSchema.serviceId, serviceSchema.id))
          .where(inArray(appointmentServicesSchema.appointmentId, allAppointmentIds)),
        db
          .select()
          .from(appointmentAddOnSchema)
          .where(inArray(appointmentAddOnSchema.appointmentId, allAppointmentIds)),
        db
          .select()
          .from(appointmentFinalItemSchema)
          .where(and(
            eq(appointmentFinalItemSchema.salonId, salon.id),
            inArray(appointmentFinalItemSchema.appointmentId, allAppointmentIds),
          )),
        db
          .select()
          .from(appointmentPaymentSchema)
          .where(and(
            eq(appointmentPaymentSchema.salonId, salon.id),
            inArray(appointmentPaymentSchema.appointmentId, allAppointmentIds),
          )),
      ]);

      for (const svc of services) {
        const existing = appointmentServicesMap.get(svc.appointmentId) ?? [];
        existing.push({ id: svc.serviceId, name: svc.serviceName, price: svc.priceAtBooking });
        appointmentServicesMap.set(svc.appointmentId, existing);
      }

      for (const addOn of addOns) {
        const existing = appointmentAddOnsMap.get(addOn.appointmentId) ?? [];
        existing.push({
          id: addOn.id,
          name: addOn.nameSnapshot,
          quantity: addOn.quantitySnapshot,
          lineTotalCents: addOn.lineTotalCentsSnapshot,
        });
        appointmentAddOnsMap.set(addOn.appointmentId, existing);
      }

      for (const item of finalItems) {
        const existing = appointmentFinalItemsMap.get(item.appointmentId) ?? [];
        existing.push({
          id: item.id,
          kind: item.kind,
          name: item.name,
          quantity: item.quantity,
          lineTotalCents: item.lineTotalCents,
        });
        appointmentFinalItemsMap.set(item.appointmentId, existing);
      }

      for (const payment of paymentRows) {
        appointmentHasPaymentHistory.add(payment.appointmentId);
        if (payment.voidedAt || payment.amountCents <= 0) {
          continue;
        }
        const existing = appointmentPaymentsMap.get(payment.appointmentId) ?? [];
        existing.push({
          id: payment.id,
          amountCents: payment.amountCents,
          method: payment.method,
          recordedAt: payment.recordedAt.toISOString(),
        });
        appointmentPaymentsMap.set(payment.appointmentId, existing);
      }
    }

    // Format appointments
    const formatAppointment = (appt: typeof upcomingAppointments[0]) => {
      const payments = appointmentPaymentsMap.get(appt.id) ?? [];
      const paymentsReceivedCents = payments.reduce(
        (total, payment) => total + payment.amountCents,
        0,
      );
      const paymentTrackingKnown
        = appt.amountPaidCents === 0 || appointmentHasPaymentHistory.has(appt.id);
      const settledByLegacyStatus = !paymentTrackingKnown && appt.paymentStatus === 'paid';
      const revenue = resolveCompletedAppointmentRevenue({
        status: appt.status,
        paymentStatus: appt.paymentStatus,
        finalPriceCents: appt.finalPriceCents,
        legacyBookedTotalCents: appt.totalPrice,
      });
      const balance = resolveAppointmentBalance({
        status: appt.status,
        paymentStatus: appt.paymentStatus,
        startTime: appt.startTime,
        now,
        finalPriceCents: appt.finalPriceCents,
        legacyBookedTotalCents: appt.totalPrice,
        taxAmountCents: appt.taxAmountCents,
        tipCents: appt.tipCents,
        nonVoidedPaymentsCents: settledByLegacyStatus
          ? revenue.amountCents + Math.max(appt.taxAmountCents ?? 0, 0) + Math.max(appt.tipCents ?? 0, 0)
          : paymentTrackingKnown ? paymentsReceivedCents : null,
        legacyPaymentDataReliable: paymentTrackingKnown || settledByLegacyStatus,
      });

      return {
        id: appt.id,
        startTime: appt.startTime.toISOString(),
        endTime: appt.endTime.toISOString(),
        status: appt.status,
        totalPrice: appt.totalPrice,
        technician: appt.technicianId ? techMap.get(appt.technicianId) ?? null : null,
        location: appt.locationId ? locationMap.get(appt.locationId) ?? null : null,
        services: appointmentServicesMap.get(appt.id) ?? [],
        addOns: appointmentAddOnsMap.get(appt.id) ?? [],
        finalItems: appointmentFinalItemsMap.get(appt.id) ?? [],
        notes: appt.notes,
        financial: {
          completedValueCents: revenue.source === 'excluded' ? null : revenue.amountCents,
          source: revenue.source,
          discountCents: Math.max(appt.finalDiscountCents ?? 0, 0),
          taxCents: Math.max(appt.taxAmountCents ?? 0, 0),
          tipsCents: Math.max(appt.tipCents ?? 0, 0),
          paymentsReceivedCents,
          payments,
          paymentStatus: appt.paymentStatus,
          completedOutstandingCents:
            balance.category === 'completed_outstanding' ? balance.amountCents : null,
          balanceState: balance.category,
        },
      };
    };

    // Calculate average spend
    const averageSpend
      = client.totalVisits && client.totalVisits > 0
        ? Math.round((client.totalSpent ?? 0) / client.totalVisits)
        : 0;
    const bookingConfig = resolveBookingConfigFromSettings(
      (salon.settings as Parameters<typeof resolveBookingConfigFromSettings>[0]) ?? null,
    );
    const { monthToDate } = getCurrentFinancialReportingRanges(
      bookingConfig.timezone,
      now,
    );
    const revenueAggregate = completedAppointmentRevenueAggregateSql();
    const serviceNameExpression = sql<string>`COALESCE(
      ${appointmentServicesSchema.nameSnapshot},
      ${serviceSchema.name},
      'Service'
    )`;

    const [
      lifetimeRows,
      monthRows,
      balanceSummary,
      submittedPreferenceRows,
      mostBookedServiceRows,
    ] = await Promise.all([
      db
        .select({
          ...revenueAggregate,
          completedVisits: sql<number>`COUNT(*) FILTER (
            WHERE ${appointmentSchema.status} = 'completed'
              AND ${appointmentSchema.deletedAt} IS NULL
          )::int`,
        })
        .from(appointmentSchema)
        .where(and(
          eq(appointmentSchema.salonId, salon.id),
          clientAppointmentIdentity,
        )),
      db
        .select(revenueAggregate)
        .from(appointmentSchema)
        .where(and(
          eq(appointmentSchema.salonId, salon.id),
          clientAppointmentIdentity,
          gte(appointmentSchema.startTime, monthToDate.start),
          lt(appointmentSchema.startTime, monthToDate.end),
        )),
      getFinancialBalanceSummary({
        salonId: salon.id,
        asOf: now,
        salonClientId: client.id,
        clientPhoneVariants: phoneVariants,
      }),
      db
        .select()
        .from(clientPreferencesSchema)
        .where(and(
          eq(clientPreferencesSchema.salonId, salon.id),
          inArray(clientPreferencesSchema.normalizedClientPhone, normalizedPhones),
        ))
        .orderBy(sql`CASE
          WHEN ${clientPreferencesSchema.normalizedClientPhone} = ${normalizedPhone}
            THEN 0
          ELSE 1
        END`)
        .limit(1),
      db
        .select({
          id: appointmentServicesSchema.serviceId,
          name: serviceNameExpression,
          count: sql<number>`COUNT(*)::int`,
          lastBookedAt: sql<Date>`MAX(${appointmentSchema.startTime})`,
        })
        .from(appointmentServicesSchema)
        .innerJoin(
          appointmentSchema,
          eq(appointmentServicesSchema.appointmentId, appointmentSchema.id),
        )
        .leftJoin(serviceSchema, eq(appointmentServicesSchema.serviceId, serviceSchema.id))
        .where(and(
          eq(appointmentSchema.salonId, salon.id),
          clientAppointmentIdentity,
          eq(appointmentSchema.status, 'completed'),
          isNull(appointmentSchema.deletedAt),
        ))
        .groupBy(appointmentServicesSchema.serviceId, serviceNameExpression)
        .orderBy(
          desc(sql`COUNT(*)`),
          desc(sql`MAX(${appointmentSchema.startTime})`),
          serviceNameExpression,
        )
        .limit(1),
    ]);

    const buildProvenance = (row: {
      finalizedAppointmentCount: number;
      legacyAppointmentCount: number;
      unresolvedAppointmentCount: number;
      finalizedAmountCents: number;
      legacyFallbackAmountCents: number;
    } | undefined) =>
      buildReportingProvenance({
        finalizedAppointmentCount: numberValue(row?.finalizedAppointmentCount),
        legacyAppointmentCount: numberValue(row?.legacyAppointmentCount),
        unresolvedAppointmentCount: numberValue(row?.unresolvedAppointmentCount),
        finalizedAmountCents: numberValue(row?.finalizedAmountCents),
        legacyFallbackAmountCents: numberValue(row?.legacyFallbackAmountCents),
      });
    const lifetimeProvenance = buildProvenance(lifetimeRows[0]);
    const monthToDateProvenance = buildProvenance(monthRows[0]);
    const submittedPreferences = submittedPreferenceRows[0] ?? null;
    let submittedFavoriteTechnician = null;
    if (submittedPreferences?.favoriteTechId) {
      const [favoriteTech] = await db
        .select({
          id: technicianSchema.id,
          name: technicianSchema.name,
          avatarUrl: technicianSchema.avatarUrl,
        })
        .from(technicianSchema)
        .where(and(
          eq(technicianSchema.salonId, salon.id),
          eq(technicianSchema.id, submittedPreferences.favoriteTechId),
        ))
        .limit(1);
      submittedFavoriteTechnician = favoriteTech ?? null;
    }

    const nextAppointment = upcomingAppointments[0] ?? null;
    const rebooking = nextAppointment
      ? { status: 'booked', dueAt: client.nextRebookDueAt?.toISOString() ?? null }
      : !client.lastVisitAt
          ? { status: 'new_client', dueAt: null }
          : !client.nextRebookDueAt
              ? { status: 'not_set', dueAt: null }
              : client.nextRebookDueAt.getTime() <= now.getTime()
                ? { status: 'overdue', dueAt: client.nextRebookDueAt.toISOString() }
                : { status: 'due_later', dueAt: client.nextRebookDueAt.toISOString() };

    const [clientPhotos, clientNotes, dependencies] = await Promise.all([
      db
        .select({
          id: appointmentPhotoSchema.id,
          appointmentId: appointmentPhotoSchema.appointmentId,
          imageUrl: appointmentPhotoSchema.imageUrl,
          thumbnailUrl: appointmentPhotoSchema.thumbnailUrl,
          photoType: appointmentPhotoSchema.photoType,
          caption: appointmentPhotoSchema.caption,
          createdAt: appointmentPhotoSchema.createdAt,
        })
        .from(appointmentPhotoSchema)
        .innerJoin(
          appointmentSchema,
          eq(appointmentPhotoSchema.appointmentId, appointmentSchema.id),
        )
        .where(and(
          eq(appointmentPhotoSchema.salonId, salon.id),
          eq(appointmentSchema.salonId, salon.id),
          clientAppointmentIdentity,
        ))
        .orderBy(desc(appointmentPhotoSchema.createdAt))
        .limit(24),
      db
        .select({
          id: salonClientNoteSchema.id,
          body: salonClientNoteSchema.body,
          sourceClientId: salonClientNoteSchema.sourceClientId,
          createdBy: salonClientNoteSchema.createdBy,
          createdAt: salonClientNoteSchema.createdAt,
        })
        .from(salonClientNoteSchema)
        .where(and(
          eq(salonClientNoteSchema.salonId, salon.id),
          eq(salonClientNoteSchema.salonClientId, client.id),
        ))
        .orderBy(desc(salonClientNoteSchema.createdAt))
        .limit(100),
      getClientDependencySummary({
        salonId: salon.id,
        clientId: client.id,
      }),
    ]);
    const trimmedName = client.fullName?.trim() ?? '';
    const [firstName = '', ...lastNameParts] = trimmedName.split(/\s+/).filter(Boolean);

    return privateClientJson({
      data: {
        client: {
          id: client.id,
          phone: client.phone,
          fullName: client.fullName,
          firstName,
          lastName: lastNameParts.join(' '),
          email: client.email,
          birthday: client.birthday,
          preferredTechnician,
          notes: client.notes,
          sensitivities: client.sensitivities,
          nailPreferences: client.nailPreferences ?? {},
          tags: client.tags ?? [],
          rebookIntervalDays: client.rebookIntervalDays,
          nextRebookDueAt: client.nextRebookDueAt?.toISOString() ?? null,
          lastContactAt: client.lastContactAt?.toISOString() ?? null,
          lastVisitAt: client.lastVisitAt?.toISOString() ?? null,
          totalVisits: client.totalVisits ?? 0,
          totalSpent: client.totalSpent ?? 0,
          averageSpend,
          noShowCount: client.noShowCount ?? 0,
          loyaltyPoints: client.loyaltyPoints ?? 0,
          hasGoogleReview: client.hasGoogleReview,
          googleReviewMarkedAt: client.googleReviewMarkedAt?.toISOString() ?? null,
          archivedAt: client.archivedAt?.toISOString() ?? null,
          archivedBy: client.archivedBy,
          mergedIntoClientId: client.mergedIntoClientId,
          updatedAt: client.updatedAt.toISOString(),
          createdAt: client.createdAt.toISOString(),
        },
        management: {
          resolvedFromClientId: resolvedClient.redirectedFromClientId,
          canManageLifecycle,
          canPermanentlyDelete: dependencies.hardDeleteEligible,
          dependencies,
          authenticationIdentityDeferred: dependencies.hasExternalClientIdentity,
        },
        summary: {
          currency: bookingConfig.currency,
          timeZone: bookingConfig.timezone,
          lifetimeSpendCents:
            lifetimeProvenance.finalizedAmountCents
            + lifetimeProvenance.legacyFallbackAmountCents,
          spendThisMonthCents:
            monthToDateProvenance.finalizedAmountCents
            + monthToDateProvenance.legacyFallbackAmountCents,
          completedOutstandingCents: balanceSummary.completedOutstandingCents,
          completedVisits: numberValue(lifetimeRows[0]?.completedVisits),
          mostBookedService: mostBookedServiceRows[0] ?? null,
          rebooking,
          provenance: {
            lifetimeSpend: lifetimeProvenance,
            spendThisMonth: monthToDateProvenance,
            completedOutstanding: balanceSummary.completedOutstandingProvenance,
          },
          monthToDateRange: {
            start: monthToDate.start.toISOString(),
            end: monthToDate.end.toISOString(),
          },
        },
        submittedPreferences: submittedPreferences
          ? {
              favoriteTechnician: submittedFavoriteTechnician,
              favoriteServices: submittedPreferences.favoriteServices,
              nailShape: submittedPreferences.nailShape,
              nailLength: submittedPreferences.nailLength,
              finishes: submittedPreferences.finishes,
              colorFamilies: submittedPreferences.colorFamilies,
              preferredBrands: submittedPreferences.preferredBrands,
              sensitivities: submittedPreferences.sensitivities,
              musicPreference: submittedPreferences.musicPreference,
              conversationLevel: submittedPreferences.conversationLevel,
              beveragePreference: submittedPreferences.beveragePreference,
              techNotes: submittedPreferences.techNotes,
              appointmentNotes: submittedPreferences.appointmentNotes,
              updatedAt: submittedPreferences.updatedAt.toISOString(),
            }
          : null,
        upcomingAppointments: upcomingAppointments.map(formatAppointment),
        pastAppointments: pastAppointments.map(formatAppointment),
        recentIssues: recentIssues.map(formatAppointment),
        photos: clientPhotos.map(photo => ({
          ...photo,
          createdAt: photo.createdAt.toISOString(),
        })),
        notesHistory: clientNotes.map(note => ({
          ...note,
          createdAt: note.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    return clientLifecycleErrorResponse(error, 'Failed to fetch client');
  }
}

// =============================================================================
// PATCH /api/admin/clients/[id] - Update client profile
// =============================================================================

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: clientId } = await params;
    const body = await request.json();

    // Validate request body
    const validated = updateSchema.safeParse(body);
    if (!validated.success) {
      return privateClientJson(
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

    const {
      salonSlug,
      expectedUpdatedAt,
      firstName,
      lastName,
      ...updates
    } = validated.data;

    // Verify user owns this salon
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return withPrivateNoStore(error!);
    }

    const admin = await getAdminSession();
    if (!admin) {
      return privateClientJson(
        { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 },
      );
    }
    const membership = admin.salons.find(candidate => candidate.salonId === salon.id);
    const actorRole = admin.isSuperAdmin
      ? 'admin'
      : membership?.role === 'owner' || membership?.role === 'admin'
        ? membership.role
        : 'staff';

    let fullName = updates.fullName;
    if (firstName !== undefined || lastName !== undefined) {
      const resolved = await resolveSalonClient({ salonId: salon.id, clientId });
      const currentParts = resolved.client.fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
      const currentFirstName = currentParts[0] ?? '';
      const currentLastName = currentParts.slice(1).join(' ');
      fullName = [
        firstName === undefined ? currentFirstName : firstName ?? '',
        lastName === undefined ? currentLastName : lastName ?? '',
      ].filter(Boolean).join(' ').trim() || null;
    }

    const updatedClient = await editSalonClient({
      salonId: salon.id,
      clientId,
      expectedUpdatedAt,
      actor: {
        id: admin.id,
        role: actorRole,
      },
      changes: {
        fullName,
        phone: updates.phone,
        birthday: updates.birthday,
        email: updates.email,
        preferredTechnicianId: updates.preferredTechnicianId,
        notes: updates.notes,
        sensitivities: updates.sensitivities,
        nailPreferences: updates.nailPreferences,
        tags: updates.tags
          ? [...new Set(updates.tags.map(tag => tag.toLowerCase()))]
          : undefined,
        rebookIntervalDays: updates.rebookIntervalDays,
      },
    });

    const updatedNameParts = updatedClient.fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
    return privateClientJson({
      data: {
        client: {
          id: updatedClient.id,
          phone: updatedClient.phone,
          fullName: updatedClient.fullName,
          firstName: updatedNameParts[0] ?? '',
          lastName: updatedNameParts.slice(1).join(' '),
          email: updatedClient.email,
          birthday: updatedClient.birthday,
          preferredTechnicianId: updatedClient.preferredTechnicianId,
          notes: updatedClient.notes,
          sensitivities: updatedClient.sensitivities,
          nailPreferences: updatedClient.nailPreferences ?? {},
          tags: updatedClient.tags ?? [],
          rebookIntervalDays: updatedClient.rebookIntervalDays,
          nextRebookDueAt: updatedClient.nextRebookDueAt?.toISOString() ?? null,
          archivedAt: updatedClient.archivedAt?.toISOString() ?? null,
          mergedIntoClientId: updatedClient.mergedIntoClientId,
          updatedAt: updatedClient.updatedAt.toISOString(),
        },
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return clientLifecycleErrorResponse(error, 'Failed to update client');
  }
}

// =============================================================================
// DELETE /api/admin/clients/[id] - Permanently delete an eligible empty profile
// =============================================================================

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: clientId } = await params;
    const validated = destructiveSchema.safeParse(await request.json());
    if (!validated.success) {
      return privateClientJson(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: validated.error.flatten(),
          },
        },
        { status: 400 },
      );
    }
    const guard = await requireClientManagerSalon(validated.data.salonSlug);
    if (!guard.ok) {
      return guard.response;
    }
    const result = await permanentlyDeleteSalonClient({
      salonId: guard.salon.id,
      clientId,
      expectedUpdatedAt: validated.data.expectedUpdatedAt,
      actor: guard.actor,
    });
    return privateClientJson({ data: result });
  } catch (error) {
    return clientLifecycleErrorResponse(error, 'Failed to permanently delete client');
  }
}
