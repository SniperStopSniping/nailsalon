import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { serializeOwnerFinancialSummary } from '@/libs/financialReportingSerializer';
import { getCurrentFinancialReportingSummaries } from '@/libs/financialReportingServer';
import type { OwnerFinancialSummaryResponse } from '@/types/ownerFinancialSummary';

export const dynamic = 'force-dynamic';

const PRIVATE_NO_STORE = 'private, no-store, max-age=0';

const querySchema = z.object({
  salonSlug: z.string().trim().min(1),
});

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

function privateJson(
  body: OwnerFinancialSummaryResponse | ErrorResponse,
  init?: ResponseInit,
): Response {
  const headers = new Headers(init?.headers);
  headers.set('Cache-Control', PRIVATE_NO_STORE);
  return Response.json(body, { ...init, headers });
}

function withPrivateNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', PRIVATE_NO_STORE);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Salon is required.',
            details: parsed.error.flatten(),
          },
        },
        { status: 400 },
      );
    }

    const { salon, error } = await requireAdminSalon(parsed.data.salonSlug);
    if (error || !salon) {
      return withPrivateNoStore(error!);
    }

    // Core owner financials are intentionally not gated by the optional
    // Analytics module. Authentication and tenant ownership are still enforced
    // by requireAdminSalon, and every reporting query receives the owned ID.
    const bookingConfig = resolveBookingConfigFromSettings(
      (salon.settings as Parameters<
        typeof resolveBookingConfigFromSettings
      >[0]) ?? null,
    );
    const summaries = await getCurrentFinancialReportingSummaries({
      salonId: salon.id,
      timeZone: bookingConfig.timezone,
    });

    return privateJson({
      data: serializeOwnerFinancialSummary({
        summaries,
        currency: bookingConfig.currency,
        timeZone: bookingConfig.timezone,
      }),
    });
  } catch (error) {
    console.error('Error fetching owner financial summary:', error);
    return privateJson(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch financial summary',
        },
      },
      { status: 500 },
    );
  }
}
