import { requireOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { onboardingDraftClaimRequestSchema } from '@/features/onboarding-v1-integration/contracts';
import { onboardingApiError } from '@/features/onboarding-v1-integration/http.server';
import { requireAuthenticatedOnboardingIdentity } from '@/features/onboarding-v1-integration/identity.server';
import { claimOnboardingDraft } from '@/features/onboarding-v1-integration/persistence.server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    requireOnboardingV1IntegrationEnabled();
    const identity = await requireAuthenticatedOnboardingIdentity();
    const input = onboardingDraftClaimRequestSchema.parse(
      await request.json().catch(() => null),
    );
    const result = await claimOnboardingDraft(identity, input);
    if (result.kind === 'conflict') {
      return Response.json({
        error: {
          code: result.conflict.code,
          conflict: result.conflict,
          message: result.conflict.code === 'BUSINESS_TARGET_REQUIRED'
            ? 'Choose where you want to save this site.'
            : 'This business already has a website.',
        },
      }, { status: 409 });
    }
    return Response.json({ data: result.data });
  } catch (error) {
    return onboardingApiError(error);
  }
}
