import { Client } from 'pg';

/** Fixed task-owned loopback database only. No environment URL fallback. */
export async function resetSyntheticSetup() {
  const database = new Client({ host: '127.0.0.1', port: 55432, user: 'luster_e2e_ci', database: 'luster_ai_setup_development' });
  await database.connect();
  try {
    const identity = (await database.query('SELECT current_database() AS name, inet_server_addr()::text AS host')).rows[0];
    const marker = (await database.query('SELECT environment FROM public.luster_environment LIMIT 2')).rows;
    if (identity.name !== 'luster_ai_setup_development' || identity.host !== '127.0.0.1/32' || marker.length !== 1 || marker[0].environment !== 'development') {
      throw new Error('The task-owned Development database is required.');
    }
    const ledger = (await database.query('SELECT to_regclass(\'public.setup_ai_call\') AS name')).rows[0];
    if (ledger.name && (await database.query('SELECT 1 FROM setup_ai_call WHERE salon_id=$1 AND provider=\'openai\' LIMIT 1', ['setup-synthetic-salon'])).rowCount) {
      throw new Error('This synthetic salon contains real-provider trial evidence. Preserve it and use a fresh isolated test database instead of resetting it.');
    }
    await database.query('BEGIN');
    await database.query('DELETE FROM appointment WHERE salon_id = $1', ['setup-synthetic-salon']);
    await database.query('DELETE FROM technician_services WHERE service_id IN (SELECT id FROM service WHERE salon_id = $1)', ['setup-synthetic-salon']);
    await database.query('DELETE FROM salon WHERE id = $1', ['setup-synthetic-salon']);
    await database.query('INSERT INTO admin_user(id, email) VALUES (\'setup-synthetic-owner\', \'setup-owner@example.invalid\') ON CONFLICT (id) DO NOTHING');
    await database.query(`INSERT INTO salon (id, slug, name, owner_name, publication_status, online_booking_enabled, sms_reminders_enabled, settings)
      VALUES ('setup-synthetic-salon', 'setup-synthetic-studio', 'Untitled business', 'Synthetic Owner', 'draft', false, false, '{"rebookingPrompt":{"enabled":false}}'::jsonb)`);
    await database.query('INSERT INTO admin_salon_membership (admin_id, salon_id, role) VALUES (\'setup-synthetic-owner\', \'setup-synthetic-salon\', \'owner\')');
    await database.query('INSERT INTO admin_session (id, admin_id, expires_at) VALUES (\'synthetic-local-setup-session-only\', \'setup-synthetic-owner\', now() + interval \'1 day\') ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at');
    await database.query('COMMIT');
  } finally {
    await database.end();
  }
}
