import { auth, clerkClient } from '@clerk/nextjs/server';
import { z } from 'zod';

import { requireOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { onboardingApiError } from '@/features/onboarding-v1-integration/http.server';
import { OnboardingPersistenceError } from '@/features/onboarding-v1-integration/persistence.server';

export const dynamic = 'force-dynamic';

const organizationRequestSchema = z.object({
  businessName: z.string().trim().max(80).optional(),
}).strict();

const FALLBACK_ORGANIZATION_NAME = 'My nail studio';

/**
 * Resolves the Clerk "choose-organization" session task without a generic
 * Clerk screen. Luster's own salon/business tables stay the tenancy
 * authority; the Clerk organization is only a session formality demanded by
 * the instance's force-organization-selection setting, so it is created here
 * server-side — named after the owner's salon — and activated by the client.
 *
 * A pending session is deliberately accepted: the whole point is to complete
 * the task that keeps the session pending. Site claims remain guarded by the
 * separate verified-email identity boundary.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    requireOnboardingV1IntegrationEnabled();
    // This endpoint completes the task that keeps a valid session pending.
    // Other endpoints, including draft claims, retain their stricter boundary.
    const { userId } = await auth({ treatPendingAsSignedOut: false });
    if (!userId) {
      throw new OnboardingPersistenceError(
        'UNAUTHENTICATED',
        'Sign in to save your Luster site.',
        401,
      );
    }
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const input = organizationRequestSchema.parse(
      await request.json().catch(() => ({})),
    );
    const memberships = await client.users.getOrganizationMembershipList({
      limit: 20,
      userId: user.id,
    });
    if (memberships.data.length > 0) {
      return Response.json({
        data: {
          created: false,
          organizations: memberships.data.map(membership => ({
            id: membership.organization.id,
            name: membership.organization.name,
          })),
        },
      });
    }
    const organization = await client.organizations.createOrganization({
      createdBy: user.id,
      name: input.businessName?.trim() || FALLBACK_ORGANIZATION_NAME,
    }).catch((error: unknown) => {
      // A provider quota needs operator action, not another account or a
      // membership bypass. Keep the pending session and local draft intact.
      const providerError = error && typeof error === 'object'
        ? error as { status?: unknown; errors?: unknown }
        : null;
      if (
        providerError?.status === 403
        && Array.isArray(providerError.errors)
        && providerError.errors.some(item => item && typeof item === 'object'
          && 'code' in item && item.code === 'organization_quota_exceeded')
      ) {
        // Log only fixed classification metadata, never the provider payload.
        console.error('[onboarding-v1] organization setup unavailable', {
          operation: 'organization-create',
          providerStatus: 403,
          providerCode: 'organization_quota_exceeded',
        });
        throw new OnboardingPersistenceError(
          'ORGANIZATION_SETUP_UNAVAILABLE',
          'We couldn’t finish setting up your business right now. Your work is still safe on this device. Please contact Luster support.',
          503,
        );
      }
      throw error;
    });
    return Response.json({
      data: {
        created: true,
        organizations: [{ id: organization.id, name: organization.name }],
      },
    });
  } catch (error) {
    return onboardingApiError(error);
  }
}
