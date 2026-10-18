import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Test harness only. It never creates a login, salon, session or membership. */
export function aiTrialAuth(fixture, env = process.env) {
  if (!fixture.clerkStorageState) {
    assert.match(fixture.salonId, /^paid_ai_trial_[a-f0-9]{32}$/u);
    assert.match(fixture.salonSlug, /^paid-ai-[a-z0-9-]+$/u);
    assert.equal(typeof fixture.session, 'string');
    return { kind: 'synthetic-session' };
  }
  assert.equal(env.APP_ENV, 'development', 'Real Clerk trials require the isolated Development environment.');
  assert(!fixture.session, 'A real Clerk trial must not also use a seeded admin session.');
  assert.equal(fixture.emailVerified, true);
  assert.equal(fixture.sessionStatus, 'active');
  assert.match(fixture.email, /\+clerk_test@example\.com$/u);
  assert.match(fixture.clerkUserId, /^user_[a-zA-Z0-9]+$/u);
  const suffix = createHash('sha256').update(fixture.clerkUserId).digest('hex').slice(0, 32);
  assert.equal(fixture.salonId, `ai_setup_${suffix}`, 'Use the salon created by actual owner entry.');
  assert.match(fixture.salonSlug, /^[a-z0-9-]{1,90}$/u);
  assert.equal(typeof fixture.adminId, 'string');
  assert.match(env.CLERK_SECRET_KEY ?? '', /^sk_test_/u, 'Only a Development secret is allowed.');
  assert.match(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '', /^pk_test_/u);
  const frontendApi = Buffer.from(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.slice(8), 'base64').toString().replace(/\$$/u, '');
  assert.match(frontendApi, /^[a-z0-9-]+\.clerk\.accounts\.dev$/u);
  assert.equal(frontendApi, fixture.clerkFrontendApi, 'The saved login must belong to the configured Development instance.');
  return { kind: 'clerk-development', frontendApi };
}

export function privateClerkStorageState(file) {
  assert(path.isAbsolute(file), 'Use the private absolute path saved by the real signup trial.');
  const directory = path.dirname(file);
  assert(directory.startsWith('/tmp/luster-real-clerk-'), 'Keep authentication state outside the repository.');
  assert(!fs.lstatSync(file).isSymbolicLink() && !fs.lstatSync(directory).isSymbolicLink());
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'Clerk session files must be private.');
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700, 'Clerk session directories must be private.');
  return file;
}

export async function assertClerkTrialActor(database, fixture) {
  const rows = (await database.query(`SELECT a.id AS admin_id, a.clerk_user_id, s.owner_clerk_user_id, m.role
    FROM admin_user a JOIN admin_salon_membership m ON m.admin_id=a.id JOIN salon s ON s.id=m.salon_id
    WHERE a.id=$1 AND s.id=$2`, [fixture.adminId, fixture.salonId])).rows;
  assert.deepEqual(rows, [{ admin_id: fixture.adminId, clerk_user_id: fixture.clerkUserId, owner_clerk_user_id: fixture.clerkUserId, role: 'owner' }], 'A genuine owner membership created by the app is required.');
}
