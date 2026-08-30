/**
 * Deletes the disposable `+clerk_test` identities (and their per-run
 * organizations) that the live acceptance runs created on the Clerk
 * DEVELOPMENT instance. Refuses to run against a non-test key.
 */
import { createClerkClient } from '@clerk/backend';

async function cleanup() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey || !secretKey.startsWith('sk_test_')) {
    throw new Error('Refusing: CLERK_SECRET_KEY is not a test-instance key.');
  }
  const client = createClerkClient({ secretKey });
  const users = await client.users.getUserList({ limit: 100 });
  let removedUsers = 0;
  let removedOrgs = 0;
  for (const user of users.data) {
    const email = user.emailAddresses[0]?.emailAddress ?? '';
    if (!/^(isla\.owner|probe)\..*\+clerk_test@example\.com$/.test(email)) {
      continue;
    }
    const memberships = await client.users.getOrganizationMembershipList({
      limit: 20,
      userId: user.id,
    });
    for (const membership of memberships.data) {
      try {
        await client.organizations.deleteOrganization(membership.organization.id);
        removedOrgs += 1;
      } catch {
        // Organization may already be gone; user deletion below still runs.
      }
    }
    await client.users.deleteUser(user.id);
    removedUsers += 1;
  }
  console.log(`Removed ${removedUsers} disposable test users and ${removedOrgs} organizations.`);
}

cleanup().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
