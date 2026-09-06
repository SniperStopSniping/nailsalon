import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { getAdminSession, requireAdminSalon } from '@/libs/adminAuth';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { getClientInsightsDirectoryPage } from '@/libs/clientInsights.server';
import {
  ClientLifecycleStabilizationError,
  isClientLifecycleTransactionTimeoutError,
  type LifecycleSqlHandle,
  lockSalonClientIdentityKeysWithHandle,
  normalizeSalonClientIdentity,
  resolveCanonicalSalonClientIdentityWithHandle,
  withClientLifecycleTransactionRetry,
} from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import { getCompletedFinancialResolution } from '@/libs/financialReportingServer';
import { getSalonClients } from '@/libs/queries';
import { auditLogSchema, salonClientSchema } from '@/models/Schema';
import { CLIENT_INSIGHT_SEGMENT_IDS } from '@/types/clientInsights';
import type { SalonSettings } from '@/types/salonPolicy';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
};

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const listQuerySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  search: z.string().optional(),
  sortBy: z.enum(['recent', 'visits', 'spent', 'name']).optional().default('recent'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  segment: z.enum(CLIENT_INSIGHT_SEGMENT_IDS).optional(),
});

const createBodySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  firstName: z.string().max(50),
  lastName: z.string().max(50).optional().default(''),
  phone: z.string().max(50),
  email: z.string().max(320).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
}).superRefine((value, context) => {
  if (!value.firstName.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'First name is required',
      path: ['firstName'],
    });
  }
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

const CANONICAL_SPEND_SORT_LIMIT = 10_000;

function normalizedPhoneKey(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, '') ?? '';
  if (digits.length === 10) {
    return digits;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return null;
}

type SpendOrderedClient = {
  id: string;
  fullName: string | null;
  totalSpent: number;
  totalVisits: number;
  spendState: 'canonical_settled' | 'under_review';
};

function compareByName<T extends SpendOrderedClient>(left: T, right: T): number {
  return (left.fullName ?? '').localeCompare(right.fullName ?? '')
    || left.id.localeCompare(right.id);
}

/**
 * Spend ordering with one explicit rule the list can explain on screen.
 *
 * Clients whose money is still unresolved carry no comparable amount, so they
 * are ranked as a labelled group instead of being coerced to $0 — but they are
 * never ranked BELOW a client who has genuinely spent nothing. Descending puts
 * them straight after the paying clients and ahead of the $0 run; ascending
 * (lowest value first) puts them past the highest settled amount. Either way
 * the group sits on the high-value side of the $0 clients.
 */
function orderBySpend<T extends SpendOrderedClient>(
  clients: T[],
  sortOrder: 'asc' | 'desc',
): T[] {
  const settled = clients.filter(client => client.spendState !== 'under_review');
  const underReview = clients
    .filter(client => client.spendState === 'under_review')
    // No comparable amount exists, so visits are the honest proxy.
    .toSorted((left, right) =>
      right.totalVisits - left.totalVisits || compareByName(left, right));
  const rankedSettled = settled.toSorted((left, right) => {
    const moneyOrder = sortOrder === 'asc'
      ? left.totalSpent - right.totalSpent
      : right.totalSpent - left.totalSpent;
    return moneyOrder || compareByName(left, right);
  });

  if (underReview.length === 0) {
    return rankedSettled;
  }
  if (sortOrder === 'asc') {
    return [...rankedSettled, ...underReview];
  }
  const paying = rankedSettled.filter(client => client.totalSpent > 0);
  const neverSpent = rankedSettled.filter(client => client.totalSpent <= 0);
  return [...paying, ...underReview, ...neverSpent];
}

// =============================================================================
// GET /api/admin/clients - List salon clients with stats
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    // Validate query params
    const validated = listQuerySchema.safeParse(queryParams);
    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: validated.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }

    const { salonSlug, search, sortBy, sortOrder, page, limit, segment } = validated.data;

    // Verify user owns this salon
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      error!.headers.set('Cache-Control', PRIVATE_HEADERS['Cache-Control']);
      return error!;
    }

    const bookingConfig = resolveBookingConfigFromSettings(
      salon.settings as SalonSettings | null | undefined,
    );
    const canonicalSpendSort = sortBy === 'spent';
    const directoryPage = canonicalSpendSort ? 1 : page;
    const directoryLimit = canonicalSpendSort
      ? CANONICAL_SPEND_SORT_LIMIT
      : limit;
    const directoryPromise = segment
      ? getClientInsightsDirectoryPage({
        salonId: salon.id,
        currency: bookingConfig.currency,
        timeZone: bookingConfig.timezone,
        segment,
        search,
        sortBy,
        sortOrder,
        page: directoryPage,
        limit: directoryLimit,
      })
      : getSalonClients(salon.id, {
        search,
        sortBy: canonicalSpendSort ? 'recent' : sortBy,
        sortOrder,
        page: directoryPage,
        limit: directoryLimit,
      });

    const [directory, completedFinancialResolution] = await Promise.all([
      directoryPromise,
      getCompletedFinancialResolution({
        salonId: salon.id,
        currency: bookingConfig.currency,
        asOf: new Date(),
      }),
    ]);
    const { clients: directoryClients, total } = directory;
    const completedFinancialRows = completedFinancialResolution.resolvedRows;
    if (canonicalSpendSort && total > CANONICAL_SPEND_SORT_LIMIT) {
      return Response.json({
        error: {
          code: 'CANONICAL_SPEND_SORT_LIMIT_EXCEEDED',
          message: 'Spend sorting is temporarily unavailable for this directory size.',
        },
      } satisfies ErrorResponse, { status: 409, headers: PRIVATE_HEADERS });
    }

    const spendByClientId = new Map<string, number>();
    const spendByLegacyPhone = new Map<string, number>();
    const unresolvedClientIds = new Set<string>();
    const unresolvedLegacyPhones = new Set<string>();
    for (const row of completedFinancialResolution.unresolvedRows) {
      if (row.salonClientId) {
        unresolvedClientIds.add(row.salonClientId);
        continue;
      }
      const phoneKey = normalizedPhoneKey(row.clientPhone);
      if (phoneKey) {
        unresolvedLegacyPhones.add(phoneKey);
      }
    }
    for (const row of completedFinancialRows) {
      if (!row.financiallySettled) {
        continue;
      }
      if (row.salonClientId) {
        spendByClientId.set(
          row.salonClientId,
          (spendByClientId.get(row.salonClientId) ?? 0) + row.serviceValueCents,
        );
        continue;
      }
      const phoneKey = normalizedPhoneKey(row.clientPhone);
      if (phoneKey) {
        spendByLegacyPhone.set(
          phoneKey,
          (spendByLegacyPhone.get(phoneKey) ?? 0) + row.serviceValueCents,
        );
      }
    }

    // Format response
    const allFormattedClients = directoryClients.map((client) => {
      const phoneKey = normalizedPhoneKey(client.phone) ?? '';
      const spendUnderReview = unresolvedClientIds.has(client.id)
        || unresolvedLegacyPhones.has(phoneKey);
      return {
        id: client.id,
        phone: client.phone,
        fullName: client.fullName,
        email: client.email,
        preferredTechnician: client.preferredTechnician ?? null,
        lastVisitAt: client.lastVisitAt?.toISOString() ?? null,
        totalVisits: client.totalVisits ?? 0,
        totalSpent: spendByClientId.get(client.id)
          ?? spendByLegacyPhone.get(phoneKey)
          ?? 0,
        spendCurrency: bookingConfig.currency,
        spendState: spendUnderReview
          ? 'under_review' as const
          : 'canonical_settled' as const,
        noShowCount: client.noShowCount ?? 0,
        loyaltyPoints: client.loyaltyPoints ?? 0,
        createdAt: client.createdAt.toISOString(),
      };
    });
    const orderedClients = canonicalSpendSort
      ? orderBySpend(allFormattedClients, sortOrder)
      : allFormattedClients;
    const formattedClients = canonicalSpendSort
      ? orderedClients.slice((page - 1) * limit, page * limit)
      : orderedClients;

    return Response.json({
      data: {
        clients: formattedClients,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        filter: {
          segment: segment ?? null,
          rulesVersion: 'rulesVersion' in directory ? directory.rulesVersion : null,
          generatedAt: 'generatedAt' in directory
            ? directory.generatedAt.toISOString()
            : null,
        },
      },
    }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('Error fetching clients:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch clients',
        },
      } satisfies ErrorResponse,
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}

// =============================================================================
// POST /api/admin/clients - Record a walk-in or phone client
// =============================================================================

class SalonClientIdentityAppearedError extends Error {
  constructor() {
    super('SALON_CLIENT_IDENTITY_APPEARED');
    this.name = 'SalonClientIdentityAppearedError';
  }
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

function createdClientResponse(client: {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  archivedAt: Date | null;
  totalVisits: number | null;
  createdAt: Date;
}) {
  return {
    id: client.id,
    phone: client.phone,
    fullName: client.fullName,
    email: client.email,
    archived: client.archivedAt !== null,
    totalVisits: client.totalVisits ?? 0,
    createdAt: client.createdAt.toISOString(),
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => null);
    // Authenticate BEFORE validating the payload so an anonymous caller is
    // refused (401/404) rather than told which fields were wrong.
    const requestedSlug = typeof (body as { salonSlug?: unknown } | null)?.salonSlug === 'string'
      ? (body as { salonSlug: string }).salonSlug
      : '';
    const { error: authError, salon: authSalon } = await requireAdminSalon(requestedSlug);
    if (authError || !authSalon) {
      authError!.headers.set('Cache-Control', PRIVATE_HEADERS['Cache-Control']);
      return authError!;
    }
    const validated = createBodySchema.safeParse(body);
    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Review the highlighted fields and try again.',
            details: validated.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }

    const { firstName, lastName, phone, email, notes } = validated.data;
    const salon = authSalon;

    // The booking path's identity rules are the canonical ones. Reusing them
    // keeps ONE writer per client record: an owner typing a number that is
    // already in the book attaches to that client instead of forking a second
    // row the booking funnel would never find.
    const normalized = normalizeSalonClientIdentity({ phone, email });
    const normalizedPhone = normalized.phone!;
    const normalizedEmail = normalized.email;
    const fullName = [firstName, lastName ?? '']
      .map(part => part.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .join(' ');
    const normalizedNotes = notes?.trim() ? notes.trim() : null;
    const actorAdmin = await getAdminSession();

    const outcome = await withClientLifecycleTransactionRetry(() =>
      db.transaction(async (tx) => {
        const handle = tx as unknown as LifecycleSqlHandle;
        await lockSalonClientIdentityKeysWithHandle(handle, {
          salonId: salon.id,
          phone: normalizedPhone,
          email: normalizedEmail,
        });
        const existingIdentity
          = await resolveCanonicalSalonClientIdentityWithHandle(handle, {
            salonId: salon.id,
            phone: normalizedPhone,
            email: normalizedEmail,
            allowArchived: true,
          });
        if (existingIdentity) {
          const [existing] = await tx
            .select()
            .from(salonClientSchema)
            .where(and(
              eq(salonClientSchema.salonId, salon.id),
              eq(salonClientSchema.id, existingIdentity.terminal.id),
            ))
            .limit(1);
          if (!existing) {
            throw new SalonClientIdentityAppearedError();
          }
          return { created: false as const, client: existing };
        }

        const [created] = await tx
          .insert(salonClientSchema)
          .values({
            id: `sc_${crypto.randomUUID()}`,
            salonId: salon.id,
            phone: normalizedPhone,
            fullName: fullName || null,
            email: normalizedEmail,
            notes: normalizedNotes,
          })
          .onConflictDoNothing()
          .returning();
        if (!created) {
          throw new SalonClientIdentityAppearedError();
        }

        await tx.insert(auditLogSchema).values({
          id: `audit_${crypto.randomUUID()}`,
          salonId: salon.id,
          actorType: 'admin',
          actorId: actorAdmin?.id ?? null,
          actorPhone: actorAdmin?.phoneE164 ?? null,
          action: 'created',
          entityType: 'salon_client',
          entityId: created.id,
          metadata: { source: 'admin_clients_directory' },
          ip: null,
          userAgent: null,
        });

        return { created: true as const, client: created };
      }));

    return Response.json(
      {
        data: {
          client: createdClientResponse(outcome.client),
          created: outcome.created,
          message: outcome.created
            ? 'Client added to your book.'
            : outcome.client.archivedAt
              ? 'That number is already in your book, on an archived client.'
              : 'That number is already in your book — opening the client you already have.',
        },
      },
      { status: outcome.created ? 201 : 200, headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    if (
      error instanceof SalonClientIdentityAppearedError
      || isUniqueViolation(error)
      || isClientLifecycleTransactionTimeoutError(error)
    ) {
      return Response.json(
        {
          error: {
            code: 'CLIENT_IDENTITY_BUSY',
            message:
              'This client was being updated elsewhere. Try adding them again.',
          },
        } satisfies ErrorResponse,
        { status: 409, headers: PRIVATE_HEADERS },
      );
    }
    if (error instanceof ClientLifecycleStabilizationError) {
      return Response.json(
        {
          error: {
            code: 'UNSUPPORTED_CLIENT_IDENTITY',
            message:
              'This phone number is already used by more than one client record here. Open the existing client instead.',
          },
        } satisfies ErrorResponse,
        { status: 409, headers: PRIVATE_HEADERS },
      );
    }
    console.error('Error creating client:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to add this client',
        },
      } satisfies ErrorResponse,
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
