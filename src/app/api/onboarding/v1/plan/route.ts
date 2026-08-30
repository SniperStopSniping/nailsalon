import { requireOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { onboardingPlanIntentRequestSchema } from '@/features/onboarding-v1-integration/contracts';
import { onboardingApiError } from '@/features/onboarding-v1-integration/http.server';
import { requireAuthenticatedOnboardingIdentity } from '@/features/onboarding-v1-integration/identity.server';
import { saveOnboardingPlanIntent } from '@/features/onboarding-v1-integration/persistence.server';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request): Promise<Response> {
  try {
    requireOnboardingV1IntegrationEnabled();
    const identity = await requireAuthenticatedOnboardingIdentity();
    const input = onboardingPlanIntentRequestSchema.parse(
      await request.json().catch(() => null),
    );
    const data = await saveOnboardingPlanIntent(identity, input);
    return Response.json({ data });
  } catch (error) {
    return onboardingApiError(error);
  }
}
