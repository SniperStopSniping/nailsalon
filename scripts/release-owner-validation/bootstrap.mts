/** Execute only as the controller's owned, loopback-fenced child. Never log raw errors. */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.FRESH_OWNER_RUNTIME_COPY!;
const runTag = process.env.FRESH_OWNER_RUN_TAG!;
if (!root || !/^[a-z0-9-]{8,30}$/u.test(runTag)) {
  throw new Error('BOOTSTRAP_SCOPE_REQUIRED');
}
const require = createRequire(path.join(root, 'package.json'));
const { Client } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');

const load = (relative: string) => import(pathToFileURL(path.join(root, relative)).href);
const disposable = await load('src/libs/disposableDatabaseTarget.ts');
const marker = await load('src/libs/nonProductionDatabaseGuard.ts');
const security = await load('src/libs/lusterSecurity.ts');
const target = disposable.requireDisposableDatabaseTarget(process.env);
const client = new Client({ connectionString: target.connectionString, connectionTimeoutMillis: 3000, statement_timeout: 30_000 });
try {
  await client.connect();
  await disposable.attestDisposableDatabaseSession(client, target, disposable.resolveDisposableDatabaseServerExpectation(target));
  const identity = (await client.query(`SELECT current_setting('data_directory') AS directory,
    (pg_control_system()).system_identifier::text AS system_id,
    current_setting('server_version_num')::int AS version,
    (SELECT count(*)::int FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()) AS others`)).rows[0];
  if (identity.directory !== process.env.FRESH_OWNER_PGDATA || identity.system_id !== process.env.FRESH_OWNER_PG_SYSTEM_ID
    || identity.version < 160000 || identity.version >= 170000 || identity.others !== 0) {
    throw new Error('BOOTSTRAP_CLUSTER_IDENTITY_REJECTED');
  }
  // Native empty-database marker initialization, before the native migrator.
  await marker.initializeNonProductionDatabaseMarker(client, 'development');
  await migrate(drizzle(client), { migrationsFolder: path.join(root, 'migrations') });
  const count = Number((await client.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows[0].count);
  if (count !== 113) {
    throw new Error('BOOTSTRAP_113_MIGRATIONS_REQUIRED');
  }
  const occupied = await client.query('SELECT count(*)::int AS count FROM salon_signup_invite');
  if (occupied.rows[0].count !== 0) {
    throw new Error('BOOTSTRAP_EXPECTED_EMPTY_INVITATIONS');
  }
  const invitations: Record<string, { token: string;email: string;slug: string }> = {};
  await client.query('BEGIN');
  try {
    for (const suffix of ['desktop', 'iphone']) {
      const email = `luster.owner.${runTag}.${suffix}+clerk_test@example.com`;
      const created = security.createOpaqueToken();
      if (created.tokenHash !== security.hashOpaqueToken(created.token)) {
        throw new Error('BOOTSTRAP_NATIVE_TOKEN_CONTRACT');
      }
      await client.query(`INSERT INTO salon_signup_invite
        (id, token_hash, invited_email, intent, campaign_source, expires_at, email_delivery_status)
        VALUES ($1,$2,$3,'create_salon',$4,$5,'pending')`, [randomUUID(), created.tokenHash, email, `b811-local-${runTag}`, new Date(Date.now() + 48 * 60 * 60_000)]);
      invitations[suffix] = { token: created.token, email, slug: `rc-${runTag}-${suffix}` };
    }
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK');
    throw new Error('BOOTSTRAP_INVITATION_SEED_FAILED');
  }
  // This stdout is a PRIVATE in-memory controller pipe, never a log/file.
  process.stdout.write(JSON.stringify({ migrationCount: count, invitationCount: 2, nativeTokenHashUsed: true, invitations }));
} catch {
  process.exitCode = 1;
// no SQL, connection URL, password, key, or invite token in errors
} finally {
  await client.end().catch(() => undefined);
}
