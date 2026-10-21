import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = process.env.SSI_RUNTIME_COPY;
if (!root) throw new Error('SSI_BOOTSTRAP_SCOPE');
const require = createRequire(path.join(root, 'package.json'));
const { Client } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const load = (file: string) => import(pathToFileURL(path.join(root, file)).href);
const disposable = await load('src/libs/disposableDatabaseTarget.ts');
const marker = await load('src/libs/nonProductionDatabaseGuard.ts');
const target = disposable.requireDisposableDatabaseTarget(process.env);
const expectation = disposable.resolveDisposableDatabaseServerExpectation(target);
const client = new Client({ connectionString: target.connectionString, connectionTimeoutMillis: 3000, statement_timeout: 30000 });
try {
  await client.connect();
  await disposable.attestDisposableDatabaseSession(client, target, expectation);
  const row = (await client.query("SELECT (pg_control_system()).system_identifier::text AS system_id,current_setting('server_version_num')::int AS version,current_setting('max_connections')::int AS connections,current_setting('fsync') AS fsync,current_setting('full_page_writes') AS full_page_writes,(SELECT count(*)::int FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()) AS others")).rows[0];
  if (row.system_id !== process.env.SSI_PG_SYSTEM_ID || row.version < 160000 || row.version >= 170000 || row.connections !== 40 || row.fsync !== 'on' || row.full_page_writes !== 'on' || row.others !== 0) throw new Error('SSI_CLUSTER_ATTESTATION');
  await marker.initializeNonProductionDatabaseMarker(client, 'development');
  await migrate(drizzle(client), { migrationsFolder: path.join(root, 'migrations') });
  const count = Number((await client.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows[0].count);
  if (count !== 113) throw new Error('SSI_MIGRATION_COUNT');
  process.stdout.write(JSON.stringify({ migrationCount: count, ownedClusterAttested: true }));
} catch { process.exitCode = 1; } finally { await client.end().catch(() => undefined); }
