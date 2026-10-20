import { setupPreviewTrialEnabled } from '@/features/business-setup/access.server';
import { SetupError } from '@/features/business-setup/contracts';
import { openPreviewTrial } from '@/features/business-setup/preview-trial.server';
import { requireAuthenticatedOnboardingIdentity } from '@/features/onboarding-v1-integration/identity.server';
import { OnboardingPersistenceError } from '@/features/onboarding-v1-integration/persistence.server';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function POST(request: Request) {
  if (!setupPreviewTrialEnabled()) {
    return new Response(null, { status: 404, headers });
  }
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return new Response(null, { status: 403, headers });
  }
  try {
    // No client identity or salon parameters. Every retry resolves the same
    // private salon from the verified server identity under a transaction lock.
    const identity = await requireAuthenticatedOnboardingIdentity();
    return Response.json({ data: { slug: await openPreviewTrial(identity) } }, { headers });
  } catch (cause) {
    if (cause instanceof OnboardingPersistenceError) {
      return Response.json({ error: { message: cause.message } }, { status: cause.status, headers });
    }
    if (cause instanceof SetupError) {
      return Response.json({ error: { message: cause.message } }, { status: cause.code === 'FORBIDDEN' ? 403 : 404, headers });
    }
    return Response.json({ error: { message: 'We could not open your saved test. Please try again.' } }, { status: 503, headers });
  }
}
