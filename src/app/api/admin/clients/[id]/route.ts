import {
  and,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  lt,
  sql,
} from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { buildBookingEmailFinancialSummary } from '@/libs/bookingEmailFinancialSummary.server';
import {
  ClientLifecycleStabilizationError,
  getSalonClientHistoricalPhoneHints,
  hasUnsafeSalonClientExternalIdentityWithHandle,
  isClientLifecycleTransactionTimeoutError,
  type LifecycleSqlHandle,
  lockGlobalClientIdentityTablesWithHandle,
  lockSalonClientIdentityKeySetWithHandle,
  lockTerminalSalonClientWithHandle,
  normalizeSalonClientIdentity,
  resolveCanonicalSalonClientIdentityWithHandle,
  resolveTerminalSalonClient,
  resolveTerminalSalonClientWithHandle,
  setClientContactEditTransactionTimeoutsWithHandle,
  withClientLifecycleTransactionRetry,
} from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import type { DepositCreditRow } from '@/libs/depositCredit';
import { buildReportingProvenance, resolveCompletedAppointmentRevenue } from '@/libs/financialReporting';
import {
  getCompletedFinancialRows,
  getCurrentFinancialReportingRanges,
  getFinancialBalanceSummary,
} from '@/libs/financialReportingServer';
import {
  normalizePhone,
} from '@/libs/queries';
import { completedAppointmentRevenueAggregateSql } from '@/libs/revenueSql';
import {
  appointmentAddOnSchema,
  appointmentDepositSchema,
  appointmentFinalItemSchema,
  appointmentPaymentSchema,
  appointmentPhotoSchema,
  appointmentSchema,
  appointmentServicesSchema,
  auditLogSchema,
  clientPreferencesSchema,
  salonClientContactAliasSchema,
  salonClientSchema,
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

const birthdaySchema = z.string().superRefine((value, context) => {
  if (value === '') {
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Birthday must use YYYY-MM-DD',
    });
    return;
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  const today = new Date();
  const todayValue = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month! - 1
    || parsed.getUTCDate() !== day
    || value < '1900-01-01'
    || parsed.getTime() > todayValue
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Birthday must be a valid date between 1900-01-01 and today',
    });
  }
});

const CLIENT_VERSION_TOKEN_PATTERN
  = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;

function canonicalizeClientVersionToken(value: string): string {
  const match = CLIENT_VERSION_TOKEN_PATTERN.exec(value);
  if (!match) {
    throw new TypeError('Invalid client version token');
  }

  const fraction = (match[2] ?? '').padEnd(6, '0');
  const parsed = new Date(`${match[1]}.${fraction.slice(0, 3)}${match[3]}`);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError('Invalid client version token');
  }

  return `${parsed.toISOString().slice(0, 19)}.${fraction}Z`;
}

const clientVersionTokenSchema = z.string()
  .datetime({ offset: true })
  .refine(value => CLIENT_VERSION_TOKEN_PATTERN.test(value), {
    message: 'Client version must be a valid timestamp',
  })
  .transform(canonicalizeClientVersionToken);

const updateSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  expectedUpdatedAt: clientVersionTokenSchema,
  firstName: z.string().max(50).optional(),
  lastName: z.string().max(50).optional(),
  fullName: z.string().max(101).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().max(320).optional().nullable(),
  birthday: birthdaySchema.optional().nullable(),
  preferredTechnicianId: z.string().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  sensitivities: z.string().max(2000).optional().nullable(),
  nailPreferences: z.object({
    shape: z.string().max(100).optional(),
    length: z.string().max(100).optional(),
    favoriteColors: z.string().max(500).optional(),
    productsUsed: z.string().max(1000).optional(),
  }).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  rebookIntervalDays: z.number().int().min(1).max(365).optional().nullable(),
}).superRefine((value, context) => {
  const hasFirstName = value.firstName !== undefined;
  const hasLastName = value.lastName !== undefined;
  if (hasFirstName !== hasLastName) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'First name and last name must be submitted together',
      path: hasFirstName ? ['lastName'] : ['firstName'],
    });
  }
  if (hasFirstName && !value.firstName?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'First name is required',
      path: ['firstName'],
    });
  }
  if (value.fullName !== undefined && !value.fullName.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Name is required',
      path: ['fullName'],
    });
  }
  if (hasFirstName && value.fullName !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Use first and last name fields for this edit',
      path: ['fullName'],
    });
  }
  if (value.phone !== undefined) {
    try {
      if (!normalizeSalonClientIdentity({ phone: value.phone }).phone) {
        throw new TypeError('phone is required');
      }
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid Canadian or international phone number',
        path: ['phone'],
      });
    }
  }
  if (value.email != null && value.email.trim()) {
    try {
      normalizeSalonClientIdentity({ email: value.email });
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid email address',
        path: ['email'],
      });
    }
  }
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

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Pragma': 'no-cache',
  'Vary': 'Cookie',
};

function privateJson(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(PRIVATE_HEADERS)) {
    headers.set(key, value);
  }
  return Response.json(body, { ...init, headers });
}

function withPrivateNoStore(response: Response): Response {
  for (const [key, value] of Object.entries(PRIVATE_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

async function resolveRequestedClientId(
  salonId: string,
  requestedClientId: string,
): Promise<string | null> {
  try {
    const terminal = await resolveTerminalSalonClient({
      salonId,
      clientId: requestedClientId,
      allowArchived: true,
    });
    return terminal.id;
  } catch (error) {
    if (
      error instanceof ClientLifecycleStabilizationError
      || error instanceof TypeError
    ) {
      return null;
    }
    throw error;
  }
}

class ContactIdentityConflictError extends Error {
  constructor() {
    super('Client contact identity conflicts with another profile.');
    this.name = 'ContactIdentityConflictError';
  }
}

class ClientEditConflictError extends Error {
  constructor() {
    super('Client profile changed after this edit was loaded.');
    this.name = 'ClientEditConflictError';
  }
}

type EditableClient = typeof salonClientSchema.$inferSelect;
type VersionedEditableClient = EditableClient & {
  updatedAtVersion: string;
};
type EditableClientField =
  | 'birthday'
  | 'email'
  | 'fullName'
  | 'nailPreferences'
  | 'nextRebookDueAt'
  | 'notes'
  | 'phone'
  | 'preferredTechnicianId'
  | 'rebookIntervalDays'
  | 'sensitivities'
  | 'tags';

function normalizeNamePart(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeNullableText(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value?.trim() ?? '';
  return normalized || null;
}

function normalizeStoredEmail(value: string | null): string | null {
  try {
    return normalizeSalonClientIdentity({ email: value }).email;
  } catch {
    return null;
  }
}

function normalizeStoredPhone(value: string): string | null {
  try {
    return normalizeSalonClientIdentity({ phone: value }).phone;
  } catch {
    return null;
  }
}

function birthdayValue(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value);
}

function datesEqual(
  left: Date | null | undefined,
  right: Date | null | undefined,
): boolean {
  return (left?.getTime() ?? null) === (right?.getTime() ?? null);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { code?: unknown; cause?: unknown };
  if (candidate.code === '23505') {
    return true;
  }
  return candidate.cause !== error && isUniqueViolation(candidate.cause);
}

function clientNotFoundResponse(): Response {
  return privateJson(
    {
      error: {
        code: 'CLIENT_NOT_FOUND',
        message: 'Client not found',
      },
    } satisfies ErrorResponse,
    { status: 404 },
  );
}

function clientUpdatedAtVersionSql() {
  return sql<string>`to_char(
    ${salonClientSchema.updatedAt},
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  )`;
}

function clientResponse(
  client: VersionedEditableClient,
): Record<string, unknown> {
  return {
    id: client.id,
    phone: client.phone,
    fullName: client.fullName,
    email: client.email,
    birthday: birthdayValue(client.birthday),
    preferredTechnicianId: client.preferredTechnicianId,
    notes: client.notes,
    sensitivities: client.sensitivities,
    nailPreferences: client.nailPreferences ?? {},
    tags: client.tags ?? [],
    rebookIntervalDays: client.rebookIntervalDays,
    nextRebookDueAt: client.nextRebookDueAt?.toISOString() ?? null,
    updatedAt: client.updatedAtVersion,
  };
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
      return privateJson(
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

    // Resolve stale same-salon source IDs without falling back to contact data.
    const terminalClientId = await resolveRequestedClientId(salon.id, clientId);
    const [client] = terminalClientId
      ? await db
        .select({
          ...getTableColumns(salonClientSchema),
          updatedAtVersion: clientUpdatedAtVersionSql(),
        })
        .from(salonClientSchema)
        .where(and(
          eq(salonClientSchema.salonId, salon.id),
          eq(salonClientSchema.id, terminalClientId),
        ))
        .limit(1)
      : [];
    if (!client) {
      return clientNotFoundResponse();
    }

    let historicalPhones: string[];
    try {
      const phoneHints = await getSalonClientHistoricalPhoneHints({
        salonId: salon.id,
        clientId: terminalClientId!,
        allowArchived: true,
      });
      historicalPhones = phoneHints.phones;
    } catch (error) {
      if (
        error instanceof ClientLifecycleStabilizationError
        || error instanceof TypeError
      ) {
        return clientNotFoundResponse();
      }
      throw error;
    }

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
          eq(technicianSchema.salonId, salon.id),
          eq(technicianSchema.id, client.preferredTechnicianId),
        ))
        .limit(1);
      preferredTechnician = tech ?? null;
    }

    // Historical phone values remain immutable appointment/payment snapshots.
    // Query every valid same-salon lineage and alias hint instead of rewriting
    // those records when a terminal client's current phone changes.
    const normalizedPhone = normalizePhone(client.phone);
    const phoneVariants = [...new Set([
      client.phone,
      ...historicalPhones.flatMap(phone => [
        phone,
        `1${phone}`,
        `+1${phone}`,
      ]),
    ])];

    const now = new Date();

    // Get upcoming appointments
    const upcomingAppointments = await db
      .select({
        id: appointmentSchema.id,
        startTime: appointmentSchema.startTime,
        endTime: appointmentSchema.endTime,
        completedAt: appointmentSchema.completedAt,
        status: appointmentSchema.status,
        totalPrice: appointmentSchema.totalPrice,
        technicianId: appointmentSchema.technicianId,
        locationId: appointmentSchema.locationId,
        notes: appointmentSchema.notes,
        finalPriceCents: appointmentSchema.finalPriceCents,
        finalDiscountCents: appointmentSchema.finalDiscountCents,
        taxableSubtotalCents: appointmentSchema.taxableSubtotalCents,
        taxAmountCents: appointmentSchema.taxAmountCents,
        taxExempt: appointmentSchema.taxExempt,
        taxExemptReason: appointmentSchema.taxExemptReason,
        tipCents: appointmentSchema.tipCents,
        paymentStatus: appointmentSchema.paymentStatus,
        amountPaidCents: appointmentSchema.amountPaidCents,
        invoiceCurrency: appointmentSchema.invoiceCurrency,
        bookingTaxSnapshot: appointmentSchema.bookingTaxSnapshot,
        rescheduleTaxSnapshot: appointmentSchema.rescheduleTaxSnapshot,
        finalTaxSnapshot: appointmentSchema.finalTaxSnapshot,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, salon.id),
          inArray(appointmentSchema.clientPhone, phoneVariants),
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
        completedAt: appointmentSchema.completedAt,
        status: appointmentSchema.status,
        totalPrice: appointmentSchema.totalPrice,
        technicianId: appointmentSchema.technicianId,
        locationId: appointmentSchema.locationId,
        notes: appointmentSchema.notes,
        finalPriceCents: appointmentSchema.finalPriceCents,
        finalDiscountCents: appointmentSchema.finalDiscountCents,
        taxableSubtotalCents: appointmentSchema.taxableSubtotalCents,
        taxAmountCents: appointmentSchema.taxAmountCents,
        taxExempt: appointmentSchema.taxExempt,
        taxExemptReason: appointmentSchema.taxExemptReason,
        tipCents: appointmentSchema.tipCents,
        paymentStatus: appointmentSchema.paymentStatus,
        amountPaidCents: appointmentSchema.amountPaidCents,
        invoiceCurrency: appointmentSchema.invoiceCurrency,
        bookingTaxSnapshot: appointmentSchema.bookingTaxSnapshot,
        rescheduleTaxSnapshot: appointmentSchema.rescheduleTaxSnapshot,
        finalTaxSnapshot: appointmentSchema.finalTaxSnapshot,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, salon.id),
          inArray(appointmentSchema.clientPhone, phoneVariants),
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
        completedAt: appointmentSchema.completedAt,
        status: appointmentSchema.status,
        totalPrice: appointmentSchema.totalPrice,
        technicianId: appointmentSchema.technicianId,
        locationId: appointmentSchema.locationId,
        notes: appointmentSchema.notes,
        finalPriceCents: appointmentSchema.finalPriceCents,
        finalDiscountCents: appointmentSchema.finalDiscountCents,
        taxableSubtotalCents: appointmentSchema.taxableSubtotalCents,
        taxAmountCents: appointmentSchema.taxAmountCents,
        taxExempt: appointmentSchema.taxExempt,
        taxExemptReason: appointmentSchema.taxExemptReason,
        tipCents: appointmentSchema.tipCents,
        paymentStatus: appointmentSchema.paymentStatus,
        amountPaidCents: appointmentSchema.amountPaidCents,
        invoiceCurrency: appointmentSchema.invoiceCurrency,
        bookingTaxSnapshot: appointmentSchema.bookingTaxSnapshot,
        rescheduleTaxSnapshot: appointmentSchema.rescheduleTaxSnapshot,
        finalTaxSnapshot: appointmentSchema.finalTaxSnapshot,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, salon.id),
          inArray(appointmentSchema.clientPhone, phoneVariants),
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
    const appointmentPaymentLedgerRowsMap = new Map<string, {
      salonId: string;
      amountCents: number;
      voidedAt: Date | null;
    }[]>();
    const appointmentDepositsMap = new Map<string, DepositCreditRow[]>();
    if (allAppointmentIds.length > 0) {
      const [services, addOns, finalItems, paymentRows, depositRows] = await Promise.all([
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
          .where(inArray(appointmentPaymentSchema.appointmentId, allAppointmentIds)),
        db
          .select()
          .from(appointmentDepositSchema)
          .where(and(
            eq(appointmentDepositSchema.salonId, salon.id),
            inArray(appointmentDepositSchema.appointmentId, allAppointmentIds),
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
        const ledgerRows = appointmentPaymentLedgerRowsMap.get(payment.appointmentId) ?? [];
        ledgerRows.push({
          salonId: payment.salonId,
          amountCents: payment.amountCents,
          voidedAt: payment.voidedAt,
        });
        appointmentPaymentLedgerRowsMap.set(payment.appointmentId, ledgerRows);
        if (
          payment.salonId !== salon.id
          || payment.voidedAt
          || payment.amountCents <= 0
        ) {
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
      for (const deposit of depositRows) {
        const existing = appointmentDepositsMap.get(deposit.appointmentId) ?? [];
        existing.push(deposit);
        appointmentDepositsMap.set(deposit.appointmentId, existing);
      }
    }

    // Format appointments
    const formatAppointment = (appt: typeof upcomingAppointments[0]) => {
      const payments = appointmentPaymentsMap.get(appt.id) ?? [];
      const paymentLedger = resolveAppointmentPaymentLedger({
        cachedAmountPaidCents: appt.amountPaidCents,
        paymentRows: appointmentPaymentLedgerRowsMap.get(appt.id) ?? [],
        expectedSalonId: salon.id,
        appointmentStatus: appt.status,
        paymentStatus: appt.paymentStatus,
      });
      const paymentsReceivedCents = paymentLedger.ok
        ? paymentLedger.appointmentPaymentsCents
        : null;
      const deposits = appointmentDepositsMap.get(appt.id) ?? [];
      const canonicalSummary = paymentLedger.ok
        ? buildBookingEmailFinancialSummary({
          appointment: appt,
          deposits,
          appointmentPaymentsCents: paymentLedger.appointmentPaymentsCents,
        })
        : null;
      const depositBlocked = canonicalSummary !== null
        && canonicalSummary.depositBlockedCode !== null;
      const canonicalFinancialsResolved = canonicalSummary !== null
        && !depositBlocked;
      const storedInvoiceCurrency = appt.invoiceCurrency
        ?? appt.finalTaxSnapshot?.currency
        ?? appt.rescheduleTaxSnapshot?.currency
        ?? appt.bookingTaxSnapshot?.currency;
      const revenue = resolveCompletedAppointmentRevenue({
        status: appt.status,
        paymentStatus: appt.paymentStatus,
        finalPriceCents: appt.finalPriceCents,
        legacyBookedTotalCents: appt.totalPrice,
      });
      return {
        id: appt.id,
        startTime: appt.startTime.toISOString(),
        endTime: appt.endTime.toISOString(),
        status: appt.status,
        totalPrice: depositBlocked ? null : appt.totalPrice,
        currency: storedInvoiceCurrency ?? null,
        technician: appt.technicianId ? techMap.get(appt.technicianId) ?? null : null,
        location: appt.locationId ? locationMap.get(appt.locationId) ?? null : null,
        services: (appointmentServicesMap.get(appt.id) ?? []).map(service => ({
          ...service,
          price: depositBlocked ? null : service.price,
        })),
        addOns: (appointmentAddOnsMap.get(appt.id) ?? []).map(addOn => ({
          ...addOn,
          lineTotalCents: depositBlocked ? null : addOn.lineTotalCents,
        })),
        finalItems: (appointmentFinalItemsMap.get(appt.id) ?? []).map(item => ({
          ...item,
          lineTotalCents: depositBlocked ? null : item.lineTotalCents,
        })),
        notes: appt.notes,
        financial: {
          completedValueCents: canonicalFinancialsResolved
            && revenue.source !== 'excluded'
            ? revenue.amountCents
            : null,
          source: canonicalFinancialsResolved ? revenue.source : 'unresolved',
          discountCents: !canonicalFinancialsResolved
            ? null
            : Math.max(appt.finalDiscountCents ?? 0, 0),
          taxCents: !canonicalFinancialsResolved
            ? null
            : Math.max(appt.taxAmountCents ?? 0, 0),
          tipsCents: !canonicalFinancialsResolved
            ? null
            : Math.max(appt.tipCents ?? 0, 0),
          paymentsReceivedCents: depositBlocked ? null : paymentsReceivedCents,
          paymentLedgerState: paymentLedger.ok ? paymentLedger.state : 'blocked',
          paymentLedgerBlockCode: paymentLedger.ok ? null : paymentLedger.code,
          depositCollectedCents: depositBlocked
            ? null
            : canonicalSummary?.collectedDepositCents ?? 0,
          depositRefundedCents: depositBlocked
            ? null
            : canonicalSummary?.refundedDepositCents ?? 0,
          depositForfeitedCents: depositBlocked
            ? null
            : canonicalSummary?.forfeitedDepositCents ?? 0,
          depositCreditCents: depositBlocked
            ? null
            : canonicalSummary?.depositCreditAppliedCents ?? 0,
          depositState: canonicalSummary === null
            ? 'blocked'
            : canonicalSummary.depositBlockedCode === null
              ? 'resolved'
              : 'blocked',
          depositBlockCode: canonicalSummary?.depositBlockedCode
            ?? (paymentLedger.ok
              ? 'FINANCIAL_SNAPSHOT_RECONCILIATION_REQUIRED'
              : paymentLedger.code),
          depositPresentationState: canonicalFinancialsResolved
            ? canonicalSummary.depositPresentationState
            : 'blocked',
          amountAlreadyPaidCents: canonicalFinancialsResolved
            ? canonicalSummary.amountAlreadyPaidCents
            : null,
          payments: depositBlocked ? [] : payments,
          paymentStatus: appt.paymentStatus,
          completedOutstandingCents: canonicalFinancialsResolved
            && appt.status === 'completed'
            ? canonicalSummary.balanceCents
            : null,
          balanceCents: canonicalFinancialsResolved
            && ['completed', 'pending', 'confirmed'].includes(appt.status)
            ? canonicalSummary.balanceCents
            : null,
          balanceState: !canonicalFinancialsResolved
            ? 'unresolved'
            : appt.status === 'completed'
              ? 'completed_outstanding'
              : ['pending', 'confirmed'].includes(appt.status)
                  ? 'upcoming_balance'
                  : 'excluded',
        },
      };
    };

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
      completedFinancialRows,
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
          sql`UPPER(${appointmentSchema.invoiceCurrency}) = ${bookingConfig.currency}`,
          inArray(appointmentSchema.clientPhone, phoneVariants),
        )),
      db
        .select(revenueAggregate)
        .from(appointmentSchema)
        .where(and(
          eq(appointmentSchema.salonId, salon.id),
          sql`UPPER(${appointmentSchema.invoiceCurrency}) = ${bookingConfig.currency}`,
          inArray(appointmentSchema.clientPhone, phoneVariants),
          gte(appointmentSchema.startTime, monthToDate.start),
          lt(appointmentSchema.startTime, monthToDate.end),
        )),
      getFinancialBalanceSummary({
        salonId: salon.id,
        currency: bookingConfig.currency,
        asOf: now,
        clientPhoneVariants: phoneVariants,
      }),
      getCompletedFinancialRows({
        salonId: salon.id,
        currency: bookingConfig.currency,
        asOf: now,
        clientPhoneVariants: phoneVariants,
      }),
      db
        .select()
        .from(clientPreferencesSchema)
        .where(and(
          eq(clientPreferencesSchema.salonId, salon.id),
          eq(clientPreferencesSchema.normalizedClientPhone, normalizedPhone),
        ))
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
          inArray(appointmentSchema.clientPhone, phoneVariants),
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
    const settledFinancialRows = completedFinancialRows.filter(
      row => row.financiallySettled,
    );
    const monthSettledFinancialRows = settledFinancialRows.filter(
      row => row.startTime >= monthToDate.start && row.startTime < monthToDate.end,
    );
    const buildSettledSpendProvenance = (
      rows: typeof completedFinancialRows,
      unresolvedAppointmentCount: number,
    ) =>
      buildReportingProvenance({
        finalizedAppointmentCount: rows.filter(
          row => row.source === 'finalized',
        ).length,
        legacyAppointmentCount: rows.filter(row => row.source === 'legacy').length,
        unresolvedAppointmentCount,
        finalizedAmountCents: rows.filter(row => row.source === 'finalized')
          .reduce((sum, row) => sum + row.serviceValueCents, 0),
        legacyFallbackAmountCents: rows.filter(row => row.source === 'legacy')
          .reduce((sum, row) => sum + row.serviceValueCents, 0),
      });
    const lifetimeSettledSpendProvenance
      = buildSettledSpendProvenance(
        settledFinancialRows,
        balanceSummary.completedOutstandingProvenance.unresolvedAppointmentCount,
      );
    const monthSettledSpendProvenance
      = buildSettledSpendProvenance(
        monthSettledFinancialRows,
        monthToDateProvenance.unresolvedAppointmentCount,
      );
    const authoritativeTotalSpent
      = settledFinancialRows.reduce((sum, row) => sum + row.serviceValueCents, 0);
    const authoritativeSettledVisits
      = settledFinancialRows.length;
    const averageSpend = authoritativeSettledVisits > 0
      ? Math.round(authoritativeTotalSpent / authoritativeSettledVisits)
      : 0;
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

    const clientPhotos = await db.select({
      id: appointmentPhotoSchema.id,
      appointmentId: appointmentPhotoSchema.appointmentId,
      imageUrl: appointmentPhotoSchema.imageUrl,
      thumbnailUrl: appointmentPhotoSchema.thumbnailUrl,
      photoType: appointmentPhotoSchema.photoType,
      caption: appointmentPhotoSchema.caption,
      createdAt: appointmentPhotoSchema.createdAt,
    }).from(appointmentPhotoSchema).where(and(
      eq(appointmentPhotoSchema.salonId, salon.id),
      inArray(
        appointmentPhotoSchema.normalizedClientPhone,
        historicalPhones,
      ),
    )).orderBy(desc(appointmentPhotoSchema.createdAt)).limit(24);

    return privateJson({
      data: {
        client: {
          id: client.id,
          phone: client.phone,
          fullName: client.fullName,
          email: client.email,
          birthday: birthdayValue(client.birthday),
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
          totalSpent: authoritativeTotalSpent,
          averageSpend,
          noShowCount: client.noShowCount ?? 0,
          loyaltyPoints: client.loyaltyPoints ?? 0,
          hasGoogleReview: client.hasGoogleReview,
          googleReviewMarkedAt: client.googleReviewMarkedAt?.toISOString() ?? null,
          createdAt: client.createdAt.toISOString(),
          updatedAt: client.updatedAtVersion,
        },
        summary: {
          currency: bookingConfig.currency,
          timeZone: bookingConfig.timezone,
          lifetimeSpendCents:
            authoritativeTotalSpent,
          spendThisMonthCents:
            monthSettledFinancialRows.reduce(
              (sum, row) => sum + row.serviceValueCents,
              0,
            ),
          completedOutstandingCents: balanceSummary.completedOutstandingCents,
          completedVisits: numberValue(lifetimeRows[0]?.completedVisits),
          mostBookedService: mostBookedServiceRows[0] ?? null,
          rebooking,
          provenance: {
            lifetimeSpend: lifetimeSettledSpendProvenance,
            spendThisMonth: monthSettledSpendProvenance,
            completedOutstanding: balanceSummary.completedOutstandingProvenance,
          },
          earnedRevenueProvenance: {
            lifetime: lifetimeProvenance,
            monthToDate: monthToDateProvenance,
          },
          unknownCurrencyAppointmentCount:
            balanceSummary.unknownCurrencyAppointmentCount,
          excludedForeignCurrencyAppointmentCount:
            balanceSummary.excludedForeignCurrencyAppointmentCount,
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
      },
    });
  } catch {
    console.error('Error fetching client profile');
    return privateJson(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch client',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
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

    const validated = updateSchema.safeParse(body);
    if (!validated.success) {
      return privateJson(
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
      fullName,
      phone,
      email,
      birthday,
      ...updates
    } = validated.data;
    const proposedPhone = phone === undefined
      ? undefined
      : normalizeSalonClientIdentity({ phone }).phone!;
    const proposedEmail = email === undefined
      ? undefined
      : normalizeSalonClientIdentity({ email }).email;
    const proposedBirthday = birthday === undefined
      ? undefined
      : birthday || null;
    const proposedNotes = normalizeNullableText(updates.notes);
    const proposedSensitivities = normalizeNullableText(updates.sensitivities);
    const proposedFullName = firstName !== undefined
      ? [
          normalizeNamePart(firstName),
          normalizeNamePart(lastName!),
        ].filter(Boolean).join(' ')
      : fullName === undefined
        ? undefined
        : normalizeNamePart(fullName);

    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return withPrivateNoStore(error!);
    }

    if (updates.preferredTechnicianId) {
      const [tech] = await db
        .select({ id: technicianSchema.id })
        .from(technicianSchema)
        .where(
          and(
            eq(technicianSchema.id, updates.preferredTechnicianId),
            eq(technicianSchema.salonId, salon.id),
          ),
        )
        .limit(1);

      if (!tech) {
        return privateJson(
          {
            error: {
              code: 'INVALID_TECHNICIAN',
              message: 'Technician not found for this salon',
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }
    }

    const result = await withClientLifecycleTransactionRetry(() =>
      db.transaction(async (tx) => {
        const handle = tx as LifecycleSqlHandle;
        if (phone !== undefined || email !== undefined) {
          await setClientContactEditTransactionTimeoutsWithHandle(handle);
          await lockGlobalClientIdentityTablesWithHandle(handle);
        }
        const lockedClient = await lockTerminalSalonClientWithHandle(handle, {
          salonId: salon.id,
          clientId,
          allowArchived: true,
        });
        const [currentClient] = await tx
          .select({
            ...getTableColumns(salonClientSchema),
            updatedAtVersion: clientUpdatedAtVersionSql(),
          })
          .from(salonClientSchema)
          .where(and(
            eq(salonClientSchema.salonId, salon.id),
            eq(salonClientSchema.id, lockedClient.id),
          ))
          .limit(1);
        if (!currentClient || currentClient.mergedIntoClientId) {
          throw new ClientLifecycleStabilizationError('CLIENT_NOT_FOUND');
        }

        const updateValues: Partial<EditableClient> = {};
        const changedFields = new Set<EditableClientField>();
        const setChangedValue = <Key extends EditableClientField>(
          key: Key,
          value: EditableClient[Key],
          equal = (left: EditableClient[Key], right: EditableClient[Key]) =>
            left === right,
        ) => {
          if (!equal(currentClient[key], value)) {
            updateValues[key] = value;
            changedFields.add(key);
          }
        };

        if (proposedFullName !== undefined) {
          setChangedValue('fullName', proposedFullName);
        }
        const currentPhone = normalizeStoredPhone(currentClient.phone);
        if (proposedPhone !== undefined && proposedPhone !== currentPhone) {
          setChangedValue('phone', proposedPhone);
        }
        const currentEmail = normalizeStoredEmail(currentClient.email);
        if (proposedEmail !== undefined && proposedEmail !== currentEmail) {
          setChangedValue('email', proposedEmail);
        }
        if (
          proposedBirthday !== undefined
          && proposedBirthday !== birthdayValue(currentClient.birthday)
        ) {
          setChangedValue('birthday', proposedBirthday);
        }
        if (proposedNotes !== undefined) {
          setChangedValue('notes', proposedNotes);
        }
        if (updates.preferredTechnicianId !== undefined) {
          setChangedValue(
            'preferredTechnicianId',
            updates.preferredTechnicianId,
          );
        }
        if (proposedSensitivities !== undefined) {
          setChangedValue('sensitivities', proposedSensitivities);
        }
        if (updates.nailPreferences !== undefined) {
          setChangedValue(
            'nailPreferences',
            updates.nailPreferences,
            jsonEqual,
          );
        }
        if (updates.tags !== undefined) {
          const normalizedTags = [
            ...new Set(updates.tags.map(tag => tag.toLowerCase())),
          ];
          setChangedValue('tags', normalizedTags, jsonEqual);
        }
        if (updates.rebookIntervalDays !== undefined) {
          setChangedValue(
            'rebookIntervalDays',
            updates.rebookIntervalDays,
          );
          if (updates.rebookIntervalDays !== currentClient.rebookIntervalDays) {
            const nextRebookDueAt
              = updates.rebookIntervalDays && currentClient.lastVisitAt
                ? new Date(currentClient.lastVisitAt.getTime()
                  + updates.rebookIntervalDays * 86_400_000)
                : updates.rebookIntervalDays === null ? null : undefined;
            if (nextRebookDueAt !== undefined) {
              setChangedValue(
                'nextRebookDueAt',
                nextRebookDueAt,
                datesEqual,
              );
            }
          }
        }

        if (changedFields.size === 0) {
          return { client: currentClient, mutated: false };
        }
        if (currentClient.updatedAtVersion !== expectedUpdatedAt) {
          throw new ClientEditConflictError();
        }

        const contactChanged
          = changedFields.has('phone') || changedFields.has('email');
        const nextPhone = changedFields.has('phone')
          ? proposedPhone!
          : currentPhone;
        const nextEmail = changedFields.has('email')
          ? proposedEmail ?? null
          : currentEmail;
        if (contactChanged) {
          const lockedKeys = await lockSalonClientIdentityKeySetWithHandle(
            handle,
            {
              salonId: salon.id,
              contacts: [
                { phone: currentPhone, email: currentEmail },
                { phone: nextPhone, email: nextEmail },
              ],
            },
          );
          const reResolved = await resolveTerminalSalonClientWithHandle(
            handle,
            {
              salonId: salon.id,
              clientId,
              allowArchived: true,
            },
          );
          if (reResolved.id !== lockedClient.id) {
            throw new ClientLifecycleStabilizationError(
              'INVALID_CLIENT_STATE',
              'Client lifecycle state is unavailable.',
            );
          }

          let hasUnsafeExternalIdentity: boolean;
          try {
            hasUnsafeExternalIdentity
              = await hasUnsafeSalonClientExternalIdentityWithHandle(
                handle,
                {
                  salonId: salon.id,
                  terminalClientId: lockedClient.id,
                  proposedContact: {
                    phone: nextPhone,
                    email: nextEmail,
                  },
                },
              );
          } catch (error) {
            if (
              error instanceof ClientLifecycleStabilizationError
              || isClientLifecycleTransactionTimeoutError(error)
            ) {
              throw error;
            }
            throw new ClientLifecycleStabilizationError(
              'UNSUPPORTED_CLIENT_IDENTITY',
              'This contact change cannot be completed safely.',
            );
          }
          if (hasUnsafeExternalIdentity) {
            throw new ClientLifecycleStabilizationError(
              'UNSUPPORTED_CLIENT_IDENTITY',
              'This contact change cannot be completed safely.',
            );
          }

          for (const key of lockedKeys) {
            let identity;
            try {
              identity = await resolveCanonicalSalonClientIdentityWithHandle(
                handle,
                {
                  salonId: salon.id,
                  [key.kind]: key.normalizedValue,
                  allowArchived: true,
                },
              );
            } catch (error) {
              if (
                error instanceof ClientLifecycleStabilizationError
                || error instanceof TypeError
              ) {
                throw new ContactIdentityConflictError();
              }
              throw error;
            }
            if (identity && identity.terminal.id !== lockedClient.id) {
              throw new ContactIdentityConflictError();
            }
          }
        }

        const mutationAt = new Date(Math.max(
          Date.now(),
          currentClient.updatedAt.getTime() + 1,
        ));
        const [updatedClient] = await tx
          .update(salonClientSchema)
          .set({
            ...updateValues,
            updatedAt: mutationAt,
          })
          .where(and(
            eq(salonClientSchema.salonId, salon.id),
            eq(salonClientSchema.id, lockedClient.id),
            sql`${clientUpdatedAtVersionSql()} = ${expectedUpdatedAt}`,
          ))
          .returning();
        if (!updatedClient) {
          throw new ClientEditConflictError();
        }
        const [updatedVersion] = await tx
          .select({
            updatedAtVersion: clientUpdatedAtVersionSql(),
          })
          .from(salonClientSchema)
          .where(and(
            eq(salonClientSchema.salonId, salon.id),
            eq(salonClientSchema.id, lockedClient.id),
          ))
          .limit(1);
        if (!updatedVersion) {
          throw new ClientEditConflictError();
        }

        const aliases: Array<typeof salonClientContactAliasSchema.$inferInsert>
          = [];
        if (changedFields.has('phone') && currentPhone) {
          aliases.push({
            salonId: salon.id,
            salonClientId: lockedClient.id,
            kind: 'phone',
            normalizedValue: currentPhone,
          });
        }
        if (changedFields.has('email') && currentEmail) {
          aliases.push({
            salonId: salon.id,
            salonClientId: lockedClient.id,
            kind: 'email',
            normalizedValue: currentEmail,
          });
        }
        if (aliases.length > 0) {
          await tx
            .insert(salonClientContactAliasSchema)
            .values(aliases)
            .onConflictDoNothing();
        }

        await tx.insert(auditLogSchema).values({
          id: `audit_${crypto.randomUUID()}`,
          salonId: salon.id,
          actorType: 'admin',
          actorId: null,
          actorPhone: null,
          action: 'updated',
          entityType: 'salon_client',
          entityId: lockedClient.id,
          metadata: {
            terminalClientId: lockedClient.id,
            changedFields: [...changedFields].sort(),
            redirectedFromStaleSource:
              clientId !== lockedClient.id,
          },
          ip: null,
          userAgent: null,
        });

        return {
          client: {
            ...updatedClient,
            updatedAtVersion: updatedVersion.updatedAtVersion,
          },
          mutated: true,
        };
      }));

    return privateJson({
      data: {
        client: clientResponse(result.client),
      },
      meta: {
        timestamp: new Date().toISOString(),
        idempotent: !result.mutated,
      },
    });
  } catch (error) {
    if (error instanceof ContactIdentityConflictError) {
      return privateJson(
        {
          error: {
            code: 'CONTACT_IDENTITY_CONFLICT',
            message: 'Client contact information conflicts with another profile',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }
    if (error instanceof ClientEditConflictError) {
      return privateJson(
        {
          error: {
            code: 'CLIENT_EDIT_CONFLICT',
            message:
              'This client changed elsewhere. Refresh the profile and try again.',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }
    if (isClientLifecycleTransactionTimeoutError(error)) {
      return privateJson(
        {
          error: {
            code: 'CLIENT_EDIT_CONFLICT',
            message:
              'This client could not be updated right now. Try again in a moment.',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }
    if (error instanceof ClientLifecycleStabilizationError) {
      if (error.code === 'UNSUPPORTED_CLIENT_IDENTITY') {
        return privateJson(
          {
            error: {
              code: 'UNSUPPORTED_CLIENT_IDENTITY',
              message:
                'This contact change cannot be completed safely. Review the details or contact support.',
            },
          } satisfies ErrorResponse,
          { status: 409 },
        );
      }
      return clientNotFoundResponse();
    }
    if (isUniqueViolation(error)) {
      return privateJson(
        {
          error: {
            code: 'CONTACT_IDENTITY_CONFLICT',
            message: 'Client contact information conflicts with another profile',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }
    console.error('Error updating client profile');
    return privateJson(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update client',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
