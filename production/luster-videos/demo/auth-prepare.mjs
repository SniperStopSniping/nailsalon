import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

import { createClerkClient } from '@clerk/backend';
import { config } from 'dotenv';

config({ path: '.env.development.local', quiet: true });
const email = 'atelier-video-20260930+clerk_test@example.com';
const identity = 'luster-video-atelier-20260930';
async function main() {
  if (process.env.APP_ENV !== 'development' || process.env.VERCEL
    || !process.env.CLERK_SECRET_KEY?.startsWith('sk_test_')) {
    throw new Error('A local Clerk Development instance is required.');
  }
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const result = await clerk.users.getUserList({ emailAddress: [email], limit: 2 });
  if (result.data.length > 1) {
    throw new Error('Ambiguous synthetic owner identity.');
  }
  let user = result.data[0];
  if (user && user.externalId !== identity) {
    throw new Error('Existing identity is not owned by this demo.');
  }
  if (!user) {
    if (!process.argv.includes('--apply')) {
      process.stdout.write('Development credentials verified. A dedicated synthetic Clerk test owner is needed; rerun with --apply.\n');
      return;
    }
    user = await clerk.users.createUser({
      emailAddress: [email],
      firstName: 'Maya',
      lastName: 'Demo',
      externalId: identity,
      password: randomBytes(32).toString('base64url'),
      privateMetadata: { purpose: 'Luster video demo', fictional: true },
    });
  }
  await mkdir('local/video-runtime', { recursive: true, mode: 0o700 });
  await writeFile('local/video-runtime/clerk-user.json', JSON.stringify({ userId: user.id, email }), { mode: 0o600 });
  process.stdout.write('Dedicated Clerk Development owner ready; identity stored privately. No app authentication bypass.\n');
}
main().catch((error) => {
  process.stderr.write(`Demo auth preflight failed safely (${error.status ?? 'configuration'}). No credentials logged.\n`);
  process.exitCode = 1;
});
