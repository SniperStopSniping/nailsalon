import { requireOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { onboardingDraftClaimRequestSchema } from '@/features/onboarding-v1-integration/contracts';
import { onboardingApiError } from '@/features/onboarding-v1-integration/http.server';
import { requireAuthenticatedOnboardingIdentity } from '@/features/onboarding-v1-integration/identity.server';
import { ONBOARDING_MEDIA_MAX_REQUEST_BYTES } from '@/features/onboarding-v1-integration/media-limits';
import { claimOnboardingDraft } from '@/features/onboarding-v1-integration/persistence.server';
import { resolveClerkAdmin } from '@/libs/adminAuth';
import { readBoundedJsonBody, RequestBodyTooLarge } from '@/libs/boundedJsonBody';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    requireOnboardingV1IntegrationEnabled();
    const identity = await requireAuthenticatedOnboardingIdentity();
    const input = onboardingDraftClaimRequestSchema.parse(
      // Bound rich document/media metadata with the existing onboarding
      // transport allowance, below the hosting request ceiling.
      await readBoundedJsonBody(request, ONBOARDING_MEDIA_MAX_REQUEST_BYTES),
    );
    // The identity comes only from the verified server session. Reuse the
    // dashboard's guarded stale-link recovery before persistence checks it;
    // existing live identities and provider failures still fail closed.
    await resolveClerkAdmin(identity.clerkUserId);
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
    if (error instanceof RequestBodyTooLarge) {
      return Response.json({ error: { code: 'REQUEST_TOO_LARGE', message: 'This site is too large to save. Reduce its content and try again.' } }, { status: 413 });
    }
    return onboardingApiError(error);
  }
}
