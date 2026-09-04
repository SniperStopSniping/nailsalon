import { createClerkClient } from '@clerk/backend';

import { assertLocalAcceptanceEnvironment, runCleanupIsConfirmed, runScopedEmail } from './safety';

/** Never enumerates or deletes historical test users. All targets belong to one run. */
export async function cleanupRunIdentity(input: {
  organizationIds: string[];
  projectName: string;
  startedAt: number;
  userId?: string;
}): Promise<{ organizationsRemoved: number; retainedPendingConfirmation?: boolean; usersRemoved: number }> {
  const scope = assertLocalAcceptanceEnvironment(process.env);
  if (!runCleanupIsConfirmed(process.env, scope.runId)) {
    return { organizationsRemoved: 0, retainedPendingConfirmation: true, usersRemoved: 0 };
  }
  const email = runScopedEmail(scope.runId, input.projectName);
  const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const matches = input.userId
    ? [await client.users.getUser(input.userId)]
    : (await client.users.getUserList({ emailAddress: [email], limit: 2 })).data;
  if (matches.length === 0) {
    return { organizationsRemoved: 0, usersRemoved: 0 };
  }
  if (matches.length !== 1) {
    throw new Error('Acceptance cleanup refused ambiguous exact-email identity.');
  }
  const user = matches[0]!;
  if (
    user.createdAt < input.startedAt - 10_000
    || user.emailAddresses.length !== 1
    || user.emailAddresses[0]?.emailAddress !== email
  ) {
    throw new Error('Acceptance cleanup refused an identity outside this exact run.');
  }
  let organizationsRemoved = 0;
  for (const organizationId of new Set(input.organizationIds)) {
    const organization = await client.organizations.getOrganization({ organizationId });
    const memberships = await client.organizations.getOrganizationMembershipList({ organizationId, limit: 2 });
    if (
      organization.createdBy !== user.id
      || organization.createdAt < input.startedAt - 10_000
      || memberships.totalCount !== 1
      || memberships.data[0]?.publicUserData?.userId !== user.id
    ) {
      throw new Error('Acceptance cleanup refused an organization outside this exact run.');
    }
    await client.organizations.deleteOrganization(organizationId);
    organizationsRemoved += 1;
  }
  await client.users.deleteUser(user.id);
  return { organizationsRemoved, usersRemoved: 1 };
}
