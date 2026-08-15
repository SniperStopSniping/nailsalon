import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { getClientInsightsDirectoryPage } from '@/libs/clientInsights.server';
import { getCompletedFinancialResolution } from '@/libs/financialReportingServer';
import { getSalonClients } from '@/libs/queries';
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
        notes: client.notes,
        createdAt: client.createdAt.toISOString(),
      };
    });
    const orderedClients = canonicalSpendSort
      ? allFormattedClients.toSorted((left, right) => {
          if (left.spendState !== right.spendState) {
            return left.spendState === 'under_review' ? 1 : -1;
          }
          const moneyOrder = sortOrder === 'asc'
            ? left.totalSpent - right.totalSpent
            : right.totalSpent - left.totalSpent;
          return moneyOrder || (left.fullName ?? '').localeCompare(right.fullName ?? '')
            || left.id.localeCompare(right.id);
        })
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
