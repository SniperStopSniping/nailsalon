import { requireOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { onboardingSiteSlugAvailabilityRequestSchema } from '@/features/onboarding-v1-integration/contracts';
import { onboardingApiError } from '@/features/onboarding-v1-integration/http.server';
import { getOnboardingSiteSlugAvailability } from '@/features/onboarding-v1-integration/persistence.server';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';

export const dynamic = 'force-dynamic';

const noStore = (response: Response): Response => {
  response.headers.set('Cache-Control', 'no-store');
  return response;
};

/**
 * Public by design because owners choose their URL before authentication.
 * The response exposes no salon or owner metadata, only whether the candidate
 * is available in the same global namespace enforced during account claim.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    requireOnboardingV1IntegrationEnabled();
    const rateLimit = checkEndpointRateLimit(
      'onboarding/v1/slug-availability',
      getClientIp(request),
      'GENERAL',
    );
    if (!rateLimit.allowed) {
      return noStore(rateLimitResponse(rateLimit.retryAfterMs));
    }
    const input = onboardingSiteSlugAvailabilityRequestSchema.parse(
      await request.json().catch(() => null),
    );
    const availability = await getOnboardingSiteSlugAvailability(input.slug);
    return noStore(Response.json({ data: availability }));
  } catch (error) {
    return noStore(onboardingApiError(error));
  }
}
