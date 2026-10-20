/**
 * Explicit isolated fixture only: blank owner + synthetic recovery credit.
 * Never creates a service, schedule, source artifact, Stripe payment or budget.
 * All actual setup/design/publication actions must use the owner application.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

import pg from 'pg';

assert.equal(process.env.LUSTER_REAL_AI_TRIAL, 'true', 'Explicit isolated-trial opt-in is required.');
const label = process.argv[2];
assert(/^[a-z][a-z0-9-]{0,30}$/u.test(label ?? ''), 'Supply a short lowercase synthetic-trial label.');
const database = new pg.Client({ host: '127.0.0.1', port: 55432, user: 'luster_e2e_ci', database: 'luster_ai_setup_development', password: 'luster-e2e-ci-only-password' });
await database.connect();
try {
  const identity = (await database.query('SELECT current_database() AS name, inet_server_addr()::text AS host')).rows[0];
  assert.deepEqual(identity, { name: 'luster_ai_setup_development', host: '127.0.0.1/32' });
  assert.deepEqual((await database.query('SELECT environment FROM luster_environment LIMIT 2')).rows, [{ environment: 'development' }]);
  const budget = (await database.query(`SELECT b.cap_micro_cad, coalesce(sum(c.charged_micro_cad),0) charged_micro_cad,
    count(*) filter(where c.status='pending') pending FROM setup_ai_budget b LEFT JOIN setup_ai_call c ON c.budget_id=b.id
    WHERE b.id=$1 GROUP BY b.cap_micro_cad`, ['initial-custom-website-trial'])).rows[0];
  assert(budget && budget.cap_micro_cad <= 11_384_406, 'The reconciled local allocation is required; this script cannot create or raise it.');
  assert.equal(Number(budget.pending), 0, 'Finish the existing paid attempt before creating another trial.');
  assert(Number(budget.charged_micro_cad) < budget.cap_micro_cad, 'The local trial allocation is exhausted.');
  const token = randomUUID().replaceAll('-', '');
  const salonId = `paid_ai_trial_${token}`;
  const salonSlug = `paid-ai-${label}-${token.slice(0, 8)}`;
  const adminId = `paid_ai_owner_${token}`;
  const session = randomUUID();
  await database.query('BEGIN');
  try {
    await database.query('INSERT INTO admin_user(id,name,email) VALUES($1,$2,$3)', [adminId, 'Synthetic Owner', `${salonSlug}@example.invalid`]);
    await database.query(`INSERT INTO salon(id,slug,name,owner_name,publication_status,online_booking_enabled,sms_reminders_enabled,settings)
      VALUES($1,$2,'Untitled business','Synthetic Owner','draft',false,false,'{"rebookingPrompt":{"enabled":false}}'::jsonb)`, [salonId, salonSlug]);
    await database.query('INSERT INTO admin_salon_membership(admin_id,salon_id,role) VALUES($1,$2,$3)', [adminId, salonId, 'owner']);
    await database.query('INSERT INTO admin_session(id,admin_id,expires_at) VALUES($1,$2,now()+interval \'1 day\')', [session, adminId]);
    await database.query('INSERT INTO ai_credit_account(salon_id,plan_env) VALUES($1,$2)', [salonId, 'dev']);
    await database.query('INSERT INTO ai_credit_ledger(id,salon_id,plan_env,entry_key,kind,amount_micro_cad) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), salonId, 'dev', `synthetic-${label}-recovery`, 'recovery', 10_000_000]);
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
  const file = `/tmp/luster-paid-ai-${label}-${token.slice(0, 8)}-fixture.json`;
  fs.writeFileSync(file, JSON.stringify({ salonId, salonSlug, adminId, session, syntheticRecoveryCredit: true }, null, 2), { mode: 0o600, flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ fixture: file, salonId, salonSlug, seeded: 'Blank account and synthetic CAD10 recovery credit only; no Stripe purchase.' })}\n`);
} finally {
  await database.end();
}
