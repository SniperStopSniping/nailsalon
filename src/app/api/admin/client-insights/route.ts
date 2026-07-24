import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { getClientInsightsSnapshot } from '@/libs/clientInsights.server';
import type { SalonSettings } from '@/types/salonPolicy';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  salonSlug: z.string().trim().min(1).max(200),
});

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
};

function withPrivateHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', PRIVATE_HEADERS['Cache-Control']);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function GET(request: Request): Promise<Response> {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return Response.json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid Client Insights query.',
        details: parsed.error.flatten(),
      },
    }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const { salon, error } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return withPrivateHeaders(error!);
  }

  try {
    const bookingConfig = resolveBookingConfigFromSettings(
      salon.settings as SalonSettings | null | undefined,
    );
    const snapshot = await getClientInsightsSnapshot({
      salonId: salon.id,
      timeZone: bookingConfig.timezone,
    });

    return Response.json({ data: snapshot.data }, {
      headers: PRIVATE_HEADERS,
    });
  } catch (loadError) {
    console.error('Error loading Client Insights:', loadError);
    return Response.json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Could not load Client Insights.',
      },
    }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
