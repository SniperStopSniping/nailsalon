import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { classifyBootstrapFailure } = createRequire(import.meta.url)('./bootstrap-diagnostics.cjs');
let phase = 'STARTUP';
let client;
try {
  const root = process.env.SSI_RUNTIME_COPY;
  if (!root) throw Object.assign(new Error(), { code: 'SSI_BOOTSTRAP_SCOPE' });
  phase = 'LOAD_DEPENDENCIES';
  const require = createRequire(path.join(root, 'package.json'));
  const { Client } = require('pg');
  const { drizzle } = require('drizzle-orm/node-postgres');
  const { migrate } = require('drizzle-orm/node-postgres/migrator');
  const load = (file: string) => import(pathToFileURL(path.join(root, file)).href);
  phase = 'LOAD_GUARDS';
  const disposable = await load('src/libs/disposableDatabaseTarget.ts');
  const marker = await load('src/libs/nonProductionDatabaseGuard.ts');
  phase = 'STATIC_TARGET';
  const target = disposable.requireDisposableDatabaseTarget(process.env);
  phase = 'CONTAINER_ATTESTATION';
  const expectation = disposable.resolveDisposableDatabaseServerExpectation(target);
  client = new Client({ connectionString: target.connectionString, connectionTimeoutMillis: 3000, statement_timeout: 30000 });
  phase = 'CONNECT';
  await client!.connect();
  phase = 'SESSION_ATTESTATION';
  await disposable.attestDisposableDatabaseSession(client, target, expectation);
  phase = 'CLUSTER_ATTESTATION';
  const row = (await client!.query("SELECT (pg_control_system()).system_identifier::text AS system_id,current_setting('server_version_num')::int AS version,current_setting('max_connections')::int AS connections,current_setting('fsync') AS fsync,current_setting('full_page_writes') AS full_page_writes,(SELECT count(*)::int FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()) AS others")).rows[0];
  if (row.system_id !== process.env.SSI_PG_SYSTEM_ID || row.version < 160000 || row.version >= 170000 || row.connections !== 40 || row.fsync !== 'on' || row.full_page_writes !== 'on' || row.others !== 0) throw Object.assign(new Error(), { code: 'SSI_CLUSTER_ATTESTATION' });
  phase = 'MARKER';
  await marker.initializeNonProductionDatabaseMarker(client, 'development');
  phase = 'MIGRATIONS';
  await migrate(drizzle(client), { migrationsFolder: path.join(root, 'migrations') });
  phase = 'MIGRATION_COUNT';
  const count = Number((await client!.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows[0].count);
  if (count !== 113) throw Object.assign(new Error(), { code: 'SSI_MIGRATION_COUNT' });
  phase = 'COMPLETE';
  process.stdout.write(JSON.stringify({ migrationCount: count, ownedClusterAttested: true }));
} catch (error) {
  process.stdout.write(JSON.stringify(classifyBootstrapFailure(phase, error)));
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => undefined);
}
