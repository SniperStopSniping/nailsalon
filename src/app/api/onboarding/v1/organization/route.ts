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
    const { userId } = await auth();
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
