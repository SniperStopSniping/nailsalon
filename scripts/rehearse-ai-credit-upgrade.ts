/**
 * Opt-in native PostgreSQL rehearsal for the pre-wallet AI pilot upgrade.
 * Creates and removes only its own scratch database on the attested local CI
 * server. Never reads hosted credentials, calls providers, or changes the CI DB.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '../src/libs/disposableDatabaseTarget';
import { initializeNonProductionDatabaseMarker } from '../src/libs/nonProductionDatabaseGuard';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let diagnosticDirectory: string | undefined;
const trackedTables = ['salon', 'service', 'technician', 'technician_services', 'client', 'appointment', 'appointment_services', 'custom_site_asset', 'custom_site_artifact', 'business_setup_workspace', 'business_setup_revision', 'business_setup_approval', 'business_setup_publication', 'setup_ai_budget', 'setup_ai_call'] as const;

async function fingerprints(client: Client) {
  const values: Record<string, string> = {};
  for (const table of trackedTables) {
    const result = await client.query(`SELECT md5(COALESCE(string_agg(row::text,'|' ORDER BY row::text),'')) AS hash FROM (SELECT to_jsonb(t) AS row FROM ${table} t) rows`);
    values[table] = result.rows[0].hash;
  }
  return values;
}

function runPreviewMigration(connectionString: string) {
  // Preview commands do not load repository dotenv files. Deliberately do not
  // forward process.env or any auth, payments, model, or outbound credentials.
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'NODE_OPTIONS'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/development-database-command.ts', 'migrate:preview'], {
    cwd: root,
    env: { ...env, NODE_ENV: 'production', APP_ENV: 'preview', BILLING_PLAN_ENV: 'test', DATABASE_URL: connectionString, LUSTER_NONPROD_DB_HOSTS: '127.0.0.1' },
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
    encoding: 'utf8',
  });
  if (diagnosticDirectory && result.status !== 0) {
    fs.writeFileSync(path.join(diagnosticDirectory, `command-${randomUUID()}.stderr-private.txt`), result.stderr, { mode: 0o600 });
  }
  assert(!result.error && !result.signal, 'The isolated migration command did not finish.');
  return { status: result.status, safeFailure: result.stderr.includes('Repository migrations failed on the attested non-Production database.') };
}

async function seedOldPilot(client: Client) {
  const id = randomUUID();
  const ids = { salon: `salon_${id}`, service: `service_${id}`, staff: `staff_${id}`, client: `client_${id}`, appointment: `appointment_${id}`, workspace: `workspace_${id}`, approval: `approval_${id}`, artifact: `artifact_${id}`, asset: `asset_${id}`, admin: `admin_${id}` };
  const source = { html: '<main><h1 data-luster-field="business.name">Synthetic upgrade fixture</h1></main>', css: 'body{color:#123;background:#fff}', javascript: '' };
  const document = { business: { name: 'Synthetic upgrade fixture', city: 'Toronto', locationDisplayMode: 'city_only', exactAddress: '123 Synthetic Lane', homeBased: true, workMode: 'solo' }, services: [{ id: ids.service, name: 'BIAB', priceCents: 7000, durationMinutes: 75, confirmed: true }], website: { config: { customFrontendId: ids.artifact }, content: {} } };
  await client.query('INSERT INTO admin_user(id) VALUES($1)', [ids.admin]);
  await client.query('INSERT INTO salon(id,name,slug,publication_status,online_booking_enabled,settings) VALUES($1,$2,$3,$4,$5,$6)', [ids.salon, 'Synthetic upgrade fixture', `synthetic-${id}`, 'published', true, { booking: { timezone: 'America/Toronto', currency: 'CAD' }, bookingPage: { live: document.website.config } }]);
  await client.query('INSERT INTO service(id,salon_id,name,price,duration_minutes,category,booking_category) VALUES($1,$2,$3,7000,75,$4,$5)', [ids.service, ids.salon, 'BIAB', 'builder_gel', 'manicure']);
  await client.query('INSERT INTO technician(id,salon_id,name) VALUES($1,$2,$3)', [ids.staff, ids.salon, 'Synthetic Artist']);
  await client.query('INSERT INTO technician_services(technician_id,service_id,enabled) VALUES($1,$2,true)', [ids.staff, ids.service]);
  await client.query('INSERT INTO client(id,phone,first_name) VALUES($1,$2,$3)', [ids.client, '+14165550198', 'Synthetic']);
  await client.query('INSERT INTO appointment(id,salon_id,technician_id,client_phone,client_name,start_time,end_time,total_price,total_duration_minutes) VALUES($1,$2,$3,$4,$5,\'2030-01-08T15:00:00Z\',\'2030-01-08T16:15:00Z\',6500,75)', [ids.appointment, ids.salon, ids.staff, '+14165550198', 'Synthetic Customer']);
  await client.query('INSERT INTO appointment_services(id,appointment_id,service_id,price_at_booking,duration_at_booking) VALUES($1,$2,$3,6500,75)', [randomUUID(), ids.appointment, ids.service]);
  await client.query('INSERT INTO custom_site_asset(id,salon_id,actor_id,role,name,mime_type,image_base64,byte_size,hash) VALUES($1,$2,$3,\'reference\',\'synthetic.webp\',\'image/webp\',$4,4,$5)', [ids.asset, ids.salon, ids.admin, 'dGVzdA==', 'a'.repeat(64)]);
  await client.query('INSERT INTO custom_site_artifact(id,salon_id,actor_id,source,source_hash,asset_ids,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [ids.artifact, ids.salon, ids.admin, source, createHash('sha256').update(JSON.stringify(source)).digest('hex'), JSON.stringify([ids.asset]), randomUUID()]);
  await client.query('INSERT INTO business_setup_workspace(id,salon_id,head_revision,baseline_hash,baseline,status) VALUES($1,$2,1,$3,$4,\'published\')', [ids.workspace, ids.salon, 'b'.repeat(64), document]);
  await client.query('INSERT INTO business_setup_revision(salon_id,workspace_id,revision,operation_id,operation_hash,document,actor_id,origin) VALUES($1,$2,1,$3,$4,$5,$6,\'owner\')', [ids.salon, ids.workspace, randomUUID(), 'c'.repeat(64), document, ids.admin]);
  await client.query('INSERT INTO business_setup_approval(id,salon_id,workspace_id,revision,manifest_hash,actor_id,expires_at) VALUES($1,$2,$3,1,$4,$5,\'2030-01-08T14:00:00Z\')', [ids.approval, ids.salon, ids.workspace, 'd'.repeat(64), ids.admin]);
  await client.query('INSERT INTO business_setup_publication(id,salon_id,workspace_id,revision,operation_id,approval_id,actor_id,service_ids,media_finalized) VALUES($1,$2,$3,1,$4,$5,$6,$7,true)', [randomUUID(), ids.salon, ids.workspace, randomUUID(), ids.approval, ids.admin, { draft_biab: ids.service }]);
  await client.query('INSERT INTO setup_ai_budget(id,cap_micro_cad) VALUES($1,68615594)', ['initial-custom-website-trial']);
  await client.query('INSERT INTO setup_ai_call(id,budget_id,salon_id,actor_id,operation_id,ordinal,model,provider,request_hash,reserved_micro_usd,charged_micro_cad,cost_micro_usd,status) VALUES($1,$2,$3,$4,$5,0,\'fixture-model\',\'fixture\',$6,100000,123456,61728,\'completed\')', [randomUUID(), 'initial-custom-website-trial', ids.salon, ids.admin, randomUUID(), 'e'.repeat(64)]);
}

async function main() {
  assert(process.env.LUSTER_AI_UPGRADE_REHEARSAL === 'true', 'Set the explicit local upgrade-rehearsal opt-in.');
  const target = requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: process.env.CONCURRENCY_TEST_DATABASE_URL });
  assert.equal(target.host, '127.0.0.1', 'This rehearsal uses only the IPv4 local disposable CI server.');
  const migrationSourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'migrations', 'scripts/development-database-command.ts', 'scripts/migrate-development.ts', 'src/libs/disposableDatabaseTarget.ts', 'src/libs/nonProductionDatabaseGuard.ts', 'src/libs/environmentIsolation.ts'], { cwd: root, stdio: 'pipe' });
  const control = new Client({ connectionString: target.connectionString });
  const scratchName = `luster_ai_upgrade_${randomUUID().replaceAll('-', '')}`;
  assert(/^luster_ai_upgrade_[a-f0-9]{32}$/u.test(scratchName));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'luster-ai-upgrade-'));
  fs.chmodSync(output, 0o700);
  diagnosticDirectory = output;
  let created = false;
  let scratch: Client | null = null;
  let sourceBefore: Record<string, string> | undefined;
  let proof: Record<string, unknown> | undefined;
  let cleanup = false;
  try {
    await control.connect();
    await attestDisposableDatabaseSession(control, target, resolveDisposableDatabaseServerExpectation(target));
    await control.query('SET statement_timeout=\'30s\'');
    sourceBefore = await fingerprints(control);
    const role = (await control.query('SELECT rolcreatedb OR rolsuper AS can_create FROM pg_roles WHERE rolname=current_user')).rows[0];
    assert(role?.can_create, 'The attested local CI role cannot create its disposable scratch database.');
    await control.query(`CREATE DATABASE "${scratchName}"`);
    created = true;
    const scratchUrl = new URL(target.connectionString);
    scratchUrl.pathname = `/${scratchName}`;
    scratch = new Client({ connectionString: scratchUrl.href });
    await scratch.connect();
    const identity = (await scratch.query('SELECT current_database() AS database,current_user AS role,inet_server_addr()::text AS address,inet_server_port() AS port')).rows[0];
    assert.equal(identity.database, scratchName);
    assert.equal(identity.role, target.databaseUser);
    assert.equal(identity.address, '127.0.0.1/32');
    assert.equal(identity.port, 55432);
    await initializeNonProductionDatabaseMarker(scratch, 'preview');
    const baselineDirectory = path.join(output, 'baseline');
    fs.mkdirSync(path.join(baselineDirectory, 'meta'), { recursive: true });
    const journal = JSON.parse(fs.readFileSync(path.join(root, 'migrations/meta/_journal.json'), 'utf8'));
    const baselineEntries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 105);
    assert.equal(baselineEntries.at(-1).tag, '0106_setup_shared_previews_cap_80');
    fs.writeFileSync(path.join(baselineDirectory, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: baselineEntries }));
    for (const entry of baselineEntries) {
      fs.copyFileSync(path.join(root, `migrations/${entry.tag}.sql`), path.join(baselineDirectory, `${entry.tag}.sql`));
    }
    await migrate(drizzle(scratch), { migrationsFolder: baselineDirectory });
    await seedOldPilot(scratch);
    const baseline = await fingerprints(scratch);
    const migrationsBefore = (await scratch.query('SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
    const trialBefore = (await scratch.query('SELECT to_jsonb(t) AS row FROM setup_ai_call t ORDER BY id')).rows.map(row => row.row);
    const receiptBefore = (await scratch.query('SELECT to_jsonb(t) AS row FROM business_setup_publication t')).rows.map(row => row.row);
    await scratch.query('CREATE TABLE ai_credit_ledger(synthetic_conflict boolean)');
    const interrupted = runPreviewMigration(scratchUrl.href);
    assert.equal(interrupted.status, 1);
    assert(interrupted.safeFailure);
    assert.equal((await scratch.query('SELECT to_regclass(\'public.ai_credit_account\') IS NULL AS absent')).rows[0].absent, true);
    assert.equal((await scratch.query('SELECT to_regclass(\'public.ai_credit_purchase\') IS NULL AS absent')).rows[0].absent, true);
    assert.deepEqual((await scratch.query('SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows, migrationsBefore);
    assert.deepEqual(await fingerprints(scratch), baseline);
    await scratch.query('DROP TABLE ai_credit_ledger');
    const upgrade = runPreviewMigration(scratchUrl.href);
    assert.equal(upgrade.status, 0);
    const upgraded = await fingerprints(scratch);
    // Added columns are expected; compare the old fields exactly below.
    for (const table of trackedTables.filter(table => table !== 'setup_ai_call' && table !== 'business_setup_publication')) {
      assert.equal(upgraded[table], baseline[table], `${table} changed during the additive upgrade.`);
    }
    const upgradedTrials = (await scratch.query('SELECT to_jsonb(t)-\'credit_reservation_id\'-\'credit_reserved_micro_cad\'-\'credit_cost_micro_cad\' AS row FROM setup_ai_call t ORDER BY id')).rows.map(row => row.row);
    assert.deepEqual(JSON.parse(JSON.stringify(upgradedTrials)), JSON.parse(JSON.stringify(trialBefore)));
    assert.deepEqual((await scratch.query('SELECT to_jsonb(t)-\'staff_ids\'-\'add_on_ids\' AS row FROM business_setup_publication t')).rows.map(row => row.row), receiptBefore);
    const receipt = (await scratch.query('SELECT staff_ids,add_on_ids,media_finalized,service_ids FROM business_setup_publication')).rows[0];
    assert.deepEqual(receipt.staff_ids, {});
    assert.deepEqual(receipt.add_on_ids, {});
    assert.equal(receipt.media_finalized, true);
    for (const table of ['ai_credit_account', 'ai_credit_purchase', 'ai_credit_ledger', 'ai_credit_reservation']) {
      assert.equal(Number((await scratch.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n), 0);
    }
    assert.equal((await scratch.query('SELECT price_at_booking FROM appointment_services')).rows[0].price_at_booking, 6500);
    assert.equal((await scratch.query('SELECT price FROM service')).rows[0].price, 7000);
    assert.equal((await scratch.query('SELECT cap_micro_cad FROM setup_ai_budget')).rows[0].cap_micro_cad, 68_615_594);
    const migrationRows = (await scratch.query('SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
    assert.equal(migrationRows.length, journal.entries.length);
    const retry = runPreviewMigration(scratchUrl.href);
    assert.equal(retry.status, 0);
    assert.deepEqual(await fingerprints(scratch), upgraded);
    assert.deepEqual((await scratch.query('SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows, migrationRows);
    proof = { passed: true, migrationSourceSha, rehearsalScriptSha256: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'), databaseKind: 'Fresh local scratch database on the attested disposable CI PostgreSQL server', sourceDatabaseUnchanged: true, baselineMigration: baselineEntries.at(-1).tag, baselineMigrationCount: baselineEntries.length, upgradedMigrationCount: migrationRows.length, appliedMigrations: journal.entries.slice(baselineEntries.length).map((entry: { tag: string }) => entry.tag), actualPreviewCommand: 'scripts/development-database-command.ts migrate:preview', forcedMidMigrationFailureRolledBack: true, failedAttemptMigrationLedgerUnchanged: true, retryAfterFailureSucceeded: true, successfulCommandRerunNoOp: true, originalTableFingerprintsPreserved: trackedTables.filter(table => table !== 'setup_ai_call' && table !== 'business_setup_publication'), originalTrialCallFieldsPreserved: true, oldPublicationIdentityPreserved: true, oldReceiptNewMaps: { staff: receipt.staff_ids, addOns: receipt.add_on_ids }, walletsCreatedEmpty: true, historicalAppointmentPriceCents: 6500, currentServicePriceCents: 7000, trialCapMicroCadUnchanged: 68_615_594, providerCalls: 0, providerCredentialsForwarded: false, hostedDatabaseAccessed: false, productionChanged: false };
  } finally {
    try {
      await scratch?.end();
      if (created) {
        await control.query(`DROP DATABASE "${scratchName}"`);
        cleanup = true;
      }
      if (sourceBefore) {
        assert.deepEqual(await fingerprints(control), sourceBefore, 'The existing disposable CI database changed during the rehearsal.');
      }
    } finally {
      await control.end();
      fs.rmSync(path.join(output, 'baseline'), { recursive: true, force: true });
    }
  }
  assert(proof && cleanup);
  fs.writeFileSync(path.join(output, 'proof.json'), `${JSON.stringify({ ...proof, scratchDatabaseRemoved: true }, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ passed: true, output, appliedMigrations: proof.appliedMigrations, scratchDatabaseRemoved: true, providerCalls: 0 })}\n`);
}

main().catch((error) => {
  if (diagnosticDirectory) {
    fs.writeFileSync(path.join(diagnosticDirectory, 'failure-private.txt'), String(error?.stack ?? error), { mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ passed: false, output: diagnosticDirectory })}\n`);
  }
  process.stderr.write('The local AI upgrade rehearsal failed. No hosted migration was attempted.\n');
  process.exitCode = 1;
});
