/** Synthetic isolated owner/account only. Does not write setup or design data. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import pg from 'pg';

assert.equal(process.env.LUSTER_REAL_AI_TRIAL, 'true', 'Explicit isolated real-AI trial opt-in is required.');
const label = process.argv[2];
assert.match(label ?? '', /^[a-z]{3,20}$/u, 'Supply a short synthetic trial label.');
const suffix = randomUUID().replaceAll('-', '');
const fixture = {
  salonId: `paid_ai_trial_${suffix}`,
  salonSlug: `paid-ai-${label}-${suffix.slice(0, 8)}`,
  adminId: `paid_ai_owner_${suffix}`,
  session: randomBytes(32).toString('hex'),
  syntheticCreditMicroCad: 10_000_000,
  planEnv: 'dev',
  createdAt: new Date().toISOString(),
};
const file = path.join('/tmp', `luster-paid-ai-${label}-${suffix.slice(0, 8)}-fixture.json`);
const database = new pg.Client({ host: '127.0.0.1', port: 55432, user: 'luster_e2e_ci', database: 'luster_ai_setup_development', password: 'luster-e2e-ci-only-password' });
await database.connect();
try {
  const identity = (await database.query('SELECT current_database() AS name,inet_server_addr()::text AS host')).rows[0];
  const markers = (await database.query('SELECT environment FROM luster_environment LIMIT 2')).rows;
  assert.equal(identity.name, 'luster_ai_setup_development');
  assert.equal(identity.host, '127.0.0.1/32');
  assert.deepEqual(markers, [{ environment: 'development' }]);
  const allocation = (await database.query('SELECT cap_micro_cad FROM setup_ai_budget WHERE id=$1', ['initial-custom-website-trial'])).rows[0];
  assert(allocation && allocation.cap_micro_cad <= 11_384_406, 'An existing reconciled local trial allowance is required.');
  await database.query('BEGIN');
  await database.query('INSERT INTO admin_user(id,email) VALUES($1,$2)', [fixture.adminId, `${label}-${suffix.slice(0, 8)}@example.invalid`]);
  await database.query(`INSERT INTO salon(id,slug,name,owner_name,publication_status,online_booking_enabled,sms_reminders_enabled,settings)
    VALUES($1,$2,'Untitled business','Synthetic Owner','draft',false,false,'{"rebookingPrompt":{"enabled":false}}'::jsonb)`, [fixture.salonId, fixture.salonSlug]);
  await database.query('INSERT INTO admin_salon_membership(admin_id,salon_id,role) VALUES($1,$2,\'owner\')', [fixture.adminId, fixture.salonId]);
  await database.query('INSERT INTO admin_session(id,admin_id,expires_at) VALUES($1,$2,now()+interval \'1 day\')', [fixture.session, fixture.adminId]);
  await database.query('INSERT INTO ai_credit_account(salon_id,plan_env) VALUES($1,\'dev\')', [fixture.salonId]);
  // Explicit synthetic funding, never represented as a Stripe purchase.
  await database.query(`INSERT INTO ai_credit_ledger(id,salon_id,plan_env,entry_key,kind,amount_micro_cad)
    VALUES($1,$2,'dev','synthetic-ui-trial-funding-v1','recovery',10000000)`, [randomUUID(), fixture.salonId]);
  fs.writeFileSync(file, JSON.stringify(fixture, null, 2), { mode: 0o600, flag: 'wx' });
  await database.query('COMMIT');
  process.stdout.write(`${JSON.stringify({ fixtureFile: file, salonSlug: fixture.salonSlug, funding: 'Synthetic CAD10 recovery grant; no Stripe purchase.' })}\n`);
} catch {
  await database.query('ROLLBACK').catch(() => {});
  throw new Error('The isolated synthetic owner could not be created. No provider call was attempted.');
} finally {
  await database.end();
}
