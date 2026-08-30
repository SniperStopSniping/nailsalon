import { requireOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { onboardingDraftStatusRequestSchema } from '@/features/onboarding-v1-integration/contracts';
import { onboardingApiError } from '@/features/onboarding-v1-integration/http.server';
import { requireAuthenticatedOnboardingIdentity } from '@/features/onboarding-v1-integration/identity.server';
import { getOnboardingDraftClaimStatus } from '@/features/onboarding-v1-integration/persistence.server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    requireOnboardingV1IntegrationEnabled();
    const identity = await requireAuthenticatedOnboardingIdentity();
    const input = onboardingDraftStatusRequestSchema.parse(await request.json());
    const claim = await getOnboardingDraftClaimStatus(
      identity,
      input.anonymousDraftToken,
    );
    return Response.json(
      { data: { claim } },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return onboardingApiError(error);
  }
}
