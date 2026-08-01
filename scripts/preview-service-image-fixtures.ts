import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readMigrationFiles } from 'drizzle-orm/migrator';
import { Client, type ClientConfig, type QueryResultRow } from 'pg';

import {
  PREVIEW_FIXTURE_COUNTS,
  PREVIEW_FIXTURE_VERSION,
  PREVIEW_SERVICE_IMAGE_FIXTURE as FIXTURE,
} from './fixtures/preview-service-image-fixtures';
import {
  createPreviewFixtureTlsBoundary,
  isPreviewFixtureTlsRuntimeEnvironmentSafe,
  type PreviewFixtureTlsAttestation,
  type PreviewFixtureTlsBoundary,
} from './preview-fixture-tls-attestation';

export type PreviewFixtureCommand = 'plan' | 'apply' | 'verify' | 'reset';
type FailureStage = 'configuration' | 'connection' | PreviewFixtureCommand;
type Row = Record<string, unknown>;
type PreviewFixtureDatabase = {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};
const APPLICATION_NAME = 'luster-preview-service-image-fixtures-v1';
const DATABASE_NAME = 'luster_preview';
const FINAL_MIGRATION = '0063_booking_policy_acknowledgments';
const MIGRATION_COUNT = 64;
const CONFIRM = 'CREATE_SYNTHETIC_PREVIEW_FIXTURES';
const RESET_CONFIRM = 'DELETE_SYNTHETIC_PREVIEW_FIXTURES';
const ADMIN_CONFIRM = 'MAP_SYNTHETIC_DEVELOPMENT_USER';
const PRODUCTION_LIKE = /(?:^|[._-])(?:main|primary|prod|production|live)(?:$|[._-])/i;
const POOLED_HOST = /(?:^|[.-])(?:pgbouncer|pooled|pooler)(?:[.-]|$)/i;
const CLERK_USER_ID = /^user_[A-Za-z0-9]{20,64}$/;
const SAFE_SQLSTATES = new Set(['08000', '08001', '08003', '08004', '08006', '0A000', '23503', '23505', '25006', '25P02', '3D000', '3F000', '40001', '42501', '42P01', '42703', '53300', '55P03', '57014', '57P01']);
const SAFE_SYSTEM_ERROR_CODES = new Set(['EACCES', 'EADDRINUSE', 'EADDRNOTAVAIL', 'EAI_AGAIN', 'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EPERM', 'EPIPE', 'ETIMEDOUT']);
const MESSAGES = {
  PRODUCTION_REJECTED: 'Preview fixture target rejected: the application environment is not Preview.',
  CONFIRMATION_REJECTED: 'Preview fixture target rejected: required confirmation is absent.',
  TARGET_REJECTED: 'Preview fixture target rejected: target metadata is incomplete or ambiguous.',
  FINGERPRINT_REJECTED: 'Preview fixture target rejected: the independently supplied target marker does not match.',
  SESSION_REJECTED: 'Preview fixture session rejected: live target attestation failed.',
  TRANSACTION_REJECTED: 'Preview fixture session rejected: transaction isolation could not be established.',
  MIGRATION_REJECTED: 'Preview fixture target rejected: the migration ledger differs from the frozen contract.',
  COLLISION_REJECTED: 'Preview fixture refused: a reserved fixture identifier is owned by unexpected data.',
  STATE_REJECTED: 'Preview fixture verification failed: synthetic state differs from the specification.',
  OPERATION_FAILED: 'Preview fixture operation failed safely on the attested target.',
} as const;
type ErrorCode = keyof typeof MESSAGES;
export class PreviewFixtureError extends Error {
  constructor(readonly code: ErrorCode, readonly stage: FailureStage | null = null, readonly diagnosticCode: string | null = null) {
    super(`${MESSAGES[code]}${stage ? ` Stage: ${stage}.` : ''}${diagnosticCode ? ` Code: ${diagnosticCode}.` : ''}`);
    this.name = 'PreviewFixtureError';
  }
}
const trustedErrors = new WeakSet<PreviewFixtureError>();
function fixtureError(code: ErrorCode, stage: FailureStage | null = null, diagnosticCode: string | null = null) {
  const error = new PreviewFixtureError(code, stage, diagnosticCode);
  trustedErrors.add(error);
  return error;
}
function reject(code: ErrorCode): never {
  throw fixtureError(code);
}
function ensure(condition: unknown, code: ErrorCode): asserts condition {
  if (!condition) {
    reject(code);
  }
}
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    reject('TARGET_REJECTED');
  }
}
function safeDiagnosticCode(error: unknown): string | null {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) {
    return null;
  }
  try {
    const code = Reflect.get(error, 'code');
    return typeof code === 'string' && ((/^[A-Z0-9]{5}$/.test(code) && SAFE_SQLSTATES.has(code)) || (/^E[A-Z0-9_]{1,31}$/.test(code) && SAFE_SYSTEM_ERROR_CODES.has(code))) ? code : null;
  } catch {
    return null;
  }
}
type Target = { clientConfig: ClientConfig; databaseUser: string; adminUserId: string | null; tlsBoundary: PreviewFixtureTlsBoundary };
function requireCommand(value: string | undefined): PreviewFixtureCommand {
  if (value === 'plan' || value === 'apply' || value === 'verify' || value === 'reset') {
    return value;
  }
  return reject('TARGET_REJECTED');
}
function requireTarget(environment: Record<string, string | undefined>, command: PreviewFixtureCommand): Target {
  const deployment = environment.VERCEL_ENV?.toLowerCase();
  const applicationEnvironment = environment.APP_ENV?.toLowerCase();
  ensure(environment.LUSTER_PREVIEW_FIXTURE_ENV === 'preview' && (!deployment || deployment === 'preview') && (!applicationEnvironment || !PRODUCTION_LIKE.test(applicationEnvironment)), 'PRODUCTION_REJECTED');
  ensure(environment.LUSTER_PREVIEW_EXPECTED_DATABASE === DATABASE_NAME, 'TARGET_REJECTED');
  ensure(environment.LUSTER_PREVIEW_APPLICATION_NAME === APPLICATION_NAME, 'TARGET_REJECTED');
  ensure(environment.LUSTER_PREVIEW_CONNECTION_MODE === 'direct', 'TARGET_REJECTED');
  ensure(environment.LUSTER_PREVIEW_FIXTURE_VERSION === PREVIEW_FIXTURE_VERSION && environment.LUSTER_PREVIEW_FIXTURE_CONFIRM === CONFIRM, 'CONFIRMATION_REJECTED');
  ensure(isPreviewFixtureTlsRuntimeEnvironmentSafe(environment) && isPreviewFixtureTlsRuntimeEnvironmentSafe(process.env), 'SESSION_REJECTED');
  ensure(command !== 'reset' || environment.LUSTER_PREVIEW_FIXTURE_RESET_CONFIRM === RESET_CONFIRM, 'CONFIRMATION_REJECTED');
  const adminUserId = environment.LUSTER_PREVIEW_CLERK_USER_ID?.trim() || null;
  const adminInputsPresent = adminUserId !== null || environment.LUSTER_PREVIEW_ADMIN_CONFIRM !== undefined || environment.LUSTER_PREVIEW_CLERK_ENV !== undefined;
  ensure(!adminInputsPresent || (adminUserId && CLERK_USER_ID.test(adminUserId) && environment.LUSTER_PREVIEW_ADMIN_CONFIRM === ADMIN_CONFIRM && environment.LUSTER_PREVIEW_CLERK_ENV === 'development'), 'TARGET_REJECTED');
  let parsed: URL;
  try {
    parsed = new URL(environment.DATABASE_URL ?? '');
  } catch {
    reject('TARGET_REJECTED');
  }
  ensure(parsed.protocol === 'postgresql:' && !parsed.hash && parsed.port === '5432' && parsed.password, 'TARGET_REJECTED');
  const host = parsed.hostname.toLowerCase();
  const expectedHost = environment.LUSTER_PREVIEW_EXPECTED_HOST?.toLowerCase() ?? '';
  const hostLabels = host.split('.');
  const endpointLabel = hostLabels[0] ?? '';
  const directNeonHost = hostLabels.length >= 5
    && hostLabels.at(-2) === 'neon'
    && hostLabels.at(-1) === 'tech'
    && /^ep-[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(endpointLabel)
    && !endpointLabel.endsWith('-pooler');
  ensure(host === expectedHost && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) && directNeonHost && !PRODUCTION_LIKE.test(host) && !POOLED_HOST.test(host), 'TARGET_REJECTED');
  const sslModes = parsed.searchParams.getAll('sslmode');
  const allowedKeys = new Set(['sslmode']);
  ensure(![...parsed.searchParams.keys()].some(key => !allowedKeys.has(key)) && sslModes.length === 1 && ['require', 'verify-full'].includes(sslModes[0]!) && environment.LUSTER_PREVIEW_EXPECTED_SSL_MODE === sslModes[0], 'TARGET_REJECTED');
  const databaseUser = decode(parsed.username);
  const password = decode(parsed.password);
  const database = decode(parsed.pathname.slice(1));
  ensure(databaseUser && password && database === DATABASE_NAME && !database.includes('/') && !PRODUCTION_LIKE.test(databaseUser), 'TARGET_REJECTED');
  const expectedFingerprint = environment.LUSTER_PREVIEW_TARGET_FINGERPRINT ?? '';
  const actualFingerprint = createHash('sha256').update(`${host}|5432|${databaseUser}|${database}`).digest('hex');
  ensure(/^[a-f0-9]{64}$/.test(expectedFingerprint) && timingSafeEqual(Buffer.from(actualFingerprint), Buffer.from(expectedFingerprint)), 'FINGERPRINT_REJECTED');
  const tlsBoundary = createPreviewFixtureTlsBoundary(host);
  return { adminUserId, databaseUser, tlsBoundary, clientConfig: { host, port: 5432, database, user: databaseUser, password, application_name: APPLICATION_NAME, ssl: tlsBoundary.clientConfiguration, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 } };
}
async function assertSession(db: Client, target: Target, phase: 'connection' | 'session' = 'session'): Promise<PreviewFixtureTlsAttestation> {
  const { rows } = await db.query<Row>(`/* preview-fixture-${phase} */ SELECT pg_catalog.current_database() AS database_name, current_user AS database_user, pg_catalog.current_setting('application_name', true) AS application_name, ssl.ssl AS backend_tls, role.rolsuper, role.rolcreaterole, role.rolcreatedb, role.rolbypassrls, role.rolcanlogin FROM pg_catalog.pg_roles role LEFT JOIN pg_catalog.pg_stat_ssl ssl ON ssl.pid = pg_catalog.pg_backend_pid() WHERE role.rolname = current_user`);
  const row = rows[0];
  ensure(rows.length === 1 && row?.database_name === DATABASE_NAME && row.database_user === target.databaseUser && row.application_name === APPLICATION_NAME, 'SESSION_REJECTED');
  ensure(!row.rolsuper && !row.rolcreaterole && !row.rolcreatedb && !row.rolbypassrls && row.rolcanlogin === true, 'SESSION_REJECTED');
  const tlsAttestation = target.tlsBoundary.attest(db, row.backend_tls);
  ensure(tlsAttestation, 'SESSION_REJECTED');
  return tlsAttestation;
}
async function assertTransaction(db: PreviewFixtureDatabase, readOnly: boolean) {
  const { rows } = await db.query<Row>(`/* preview-fixture-transaction */ SELECT pg_catalog.current_setting('transaction_isolation') AS isolation, pg_catalog.current_setting('transaction_read_only') AS read_only, pg_catalog.current_setting('search_path') AS search_path, pg_catalog.current_setting('row_security') AS row_security`);
  ensure(rows[0]?.isolation === 'serializable' && rows[0]?.read_only === (readOnly ? 'on' : 'off') && rows[0]?.search_path === 'pg_catalog, public' && rows[0]?.row_security === 'off', 'TRANSACTION_REJECTED');
}
async function assertMigrations(db: PreviewFixtureDatabase) {
  let expected: ReturnType<typeof readMigrationFiles>;
  let journal: { entries: Array<{ tag: string; when: number }> };
  try {
    const folder = path.join(process.cwd(), 'migrations');
    expected = readMigrationFiles({ migrationsFolder: folder });
    journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8'));
  } catch {
    return reject('MIGRATION_REJECTED');
  }
  ensure(journal.entries.length === MIGRATION_COUNT && expected.length === MIGRATION_COUNT, 'MIGRATION_REJECTED');
  ensure(journal.entries.at(-1)?.tag === FINAL_MIGRATION, 'MIGRATION_REJECTED');
  const { rows } = await db.query<Row>('SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id');
  ensure(rows.length === MIGRATION_COUNT, 'MIGRATION_REJECTED');
  const last = rows.at(-1);
  ensure(last?.hash === expected.at(-1)?.hash && Number(last?.created_at) === expected.at(-1)?.folderMillis, 'MIGRATION_REJECTED');
  ensure(!rows.some((row, index) => row.hash !== expected[index]?.hash || Number(row.created_at) !== expected[index]?.folderMillis), 'MIGRATION_REJECTED');
}
const REQUIRED_SCHEMA: Record<string, string[]> = {
  salon: ['id', 'slug', 'settings', 'internal_notes'],
  salon_location: ['id', 'salon_id'],
  service: ['id', 'salon_id', 'image_url', 'featured_order'],
  technician: ['id', 'salon_id', 'avatar_url', 'weekly_schedule'],
  technician_services: ['technician_id', 'service_id'],
  add_on: ['id', 'salon_id'],
  service_add_on: ['id', 'salon_id'],
  admin_user: ['id', 'clerk_user_id'],
  admin_salon_membership: ['admin_id', 'salon_id'],
};
async function assertSchema(db: PreviewFixtureDatabase) {
  const { rows } = await db.query<Row>('SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = \'public\' AND table_name = ANY($1::text[])', [Object.keys(REQUIRED_SCHEMA)]);
  const available = new Set(rows.map(row => `${row.table_name}.${row.column_name}`));
  ensure(!Object.entries(REQUIRED_SCHEMA).some(([table, columns]) => columns.some(column => !available.has(`${table}.${column}`))), 'SESSION_REJECTED');
}
function canonical(value: unknown): string {
  if (value instanceof Date) {
    return JSON.stringify(new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const quote = (name: string) => /^[a-z][a-z0-9_]*$/.test(name) ? `"${name}"` : reject('SESSION_REJECTED');
async function assertOwnedEntities(db: PreviewFixtureDatabase, table: string, expected: readonly Row[], markers: string[], options: { salon?: boolean; slug?: boolean } = {}) {
  const values: unknown[] = [expected.map(row => row.id)];
  const clauses = ['id = ANY($1::text[])'];
  if (options.salon) {
    values.push(FIXTURE.salons.map(row => row.id));
    clauses.push(`salon_id = ANY($${values.length}::text[])`);
  }
  if (options.slug) {
    values.push(expected.map(row => row.slug));
    clauses.push(`slug = ANY($${values.length}::text[])`);
  }
  const columns = ['id', ...markers];
  const { rows } = await db.query<Row>(`SELECT ${columns.map(quote).join(', ')} FROM public.${quote(table)} WHERE ${clauses.join(' OR ')}`, values);
  const byId = new Map(expected.map(row => [row.id, row]));
  ensure(!rows.some(row => !byId.get(row.id) || markers.some(column => canonical(row[column]) !== canonical(byId.get(row.id)![column]))), 'COLLISION_REJECTED');
}
async function assertOwnership(db: PreviewFixtureDatabase, target: Target) {
  await assertOwnedEntities(db, 'salon', FIXTURE.salons, ['slug', 'email', 'internal_notes'], { slug: true });
  await assertOwnedEntities(db, 'salon_location', FIXTURE.locations, ['salon_id'], { salon: true });
  await assertOwnedEntities(db, 'service', FIXTURE.services, ['salon_id', 'slug'], { salon: true, slug: true });
  await assertOwnedEntities(db, 'technician', FIXTURE.technicians, ['salon_id', 'email'], { salon: true });
  await assertOwnedEntities(db, 'add_on', FIXTURE.addOns, ['salon_id', 'slug'], { salon: true, slug: true });
  await assertOwnedEntities(db, 'service_add_on', FIXTURE.rules, ['salon_id', 'service_id', 'add_on_id'], { salon: true });
  const assignments = await db.query<Row>('SELECT technician_id, service_id FROM public.technician_services WHERE technician_id = ANY($1::text[]) OR service_id = ANY($2::text[])', [FIXTURE.technicians.map(row => row.id), FIXTURE.services.map(row => row.id)]);
  const assignmentKeys = new Set(FIXTURE.assignments.map(row => `${row.technician_id}|${row.service_id}`));
  ensure(!assignments.rows.some(row => !assignmentKeys.has(`${row.technician_id}|${row.service_id}`)), 'COLLISION_REJECTED');
  const memberships = await db.query<Row>('SELECT admin_id, salon_id, role FROM public.admin_salon_membership WHERE admin_id = $1 OR salon_id = ANY($2::text[])', [FIXTURE.admin.id, FIXTURE.salons.map(row => row.id)]);
  const membershipKeys = new Set(FIXTURE.memberships.map(row => `${row.admin_id}|${row.salon_id}|${row.role}`));
  ensure(!memberships.rows.some(row => !membershipKeys.has(`${row.admin_id}|${row.salon_id}|${row.role}`)), 'COLLISION_REJECTED');
  const adminValues: unknown[] = [FIXTURE.admin.id, FIXTURE.admin.email, FIXTURE.admin.phone_e164];
  const adminClerkClause = target.adminUserId ? ` OR clerk_user_id = $${adminValues.push(target.adminUserId)}` : '';
  const admins = await db.query<Row>(`SELECT id, email, phone_e164, clerk_user_id, is_super_admin FROM public.admin_user WHERE id = $1 OR email = $2 OR phone_e164 = $3${adminClerkClause}`, adminValues);
  const invalidAdmin = admins.rows.some(row => row.id !== FIXTURE.admin.id || row.email !== FIXTURE.admin.email || row.phone_e164 !== FIXTURE.admin.phone_e164 || row.is_super_admin !== false || (row.clerk_user_id != null && (!CLERK_USER_ID.test(String(row.clerk_user_id)) || Boolean(target.adminUserId && row.clerk_user_id !== target.adminUserId))));
  ensure(!invalidAdmin, 'COLLISION_REJECTED');
  const known = new Set(['salon_location', 'service', 'technician', 'add_on', 'service_add_on', 'admin_salon_membership']);
  const tenantTables = await db.query<Row>('SELECT table_name FROM information_schema.columns WHERE table_schema = \'public\' AND column_name = \'salon_id\'');
  for (const { table_name: table } of tenantTables.rows) {
    if (typeof table !== 'string' || known.has(table)) {
      continue;
    }
    const result = await db.query<Row>(`SELECT count(*)::int AS count FROM public.${quote(table)} WHERE salon_id = ANY($1::text[])`, [FIXTURE.salons.map(row => row.id)]);
    ensure(Number(result.rows[0]?.count) === 0, 'COLLISION_REJECTED');
  }
}
const sqlValue = (value: unknown) => value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
async function upsert(db: PreviewFixtureDatabase, table: string, rows: readonly Row[], keys: string[]) {
  const columns = Object.keys(rows[0]!);
  const values = rows.flatMap(row => columns.map(column => sqlValue(row[column])));
  const tuples = rows.map((_row, rowIndex) => `(${columns.map((_column, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(', ')})`);
  const updates = columns.filter(column => !keys.includes(column)).map(column => `${quote(column)} = EXCLUDED.${quote(column)}`);
  await db.query(`INSERT INTO public.${quote(table)} (${columns.map(quote).join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT (${keys.map(quote).join(', ')}) DO UPDATE SET ${updates.join(', ')}`, values);
}
async function applyFixture(db: PreviewFixtureDatabase, target: Target) {
  const existing = await db.query<Row>('SELECT clerk_user_id FROM public.admin_user WHERE id = $1', [FIXTURE.admin.id]);
  const admin = { ...FIXTURE.admin, clerk_user_id: target.adminUserId ?? existing.rows[0]?.clerk_user_id ?? null };
  await upsert(db, 'salon', FIXTURE.salons, ['id']);
  await upsert(db, 'salon_location', FIXTURE.locations, ['id']);
  await upsert(db, 'service', FIXTURE.services, ['id']);
  await upsert(db, 'add_on', FIXTURE.addOns, ['id']);
  await upsert(db, 'technician', FIXTURE.technicians, ['id']);
  await upsert(db, 'service_add_on', FIXTURE.rules, ['id']);
  await upsert(db, 'technician_services', FIXTURE.assignments, ['technician_id', 'service_id']);
  await upsert(db, 'admin_user', [admin], ['id']);
  await upsert(db, 'admin_salon_membership', FIXTURE.memberships, ['admin_id', 'salon_id']);
}
async function assertStateRows(db: PreviewFixtureDatabase, table: string, expected: readonly Row[], keys: string[], columns: string[], where: string, values: unknown[]) {
  const selected = [...new Set([...keys, ...columns])];
  const { rows } = await db.query<Row>(`SELECT ${selected.map(quote).join(', ')} FROM public.${quote(table)} WHERE ${where}`, values);
  const keyOf = (row: Row) => keys.map(key => row[key]).join('|');
  const expectedByKey = new Map(expected.map(row => [keyOf(row), row]));
  ensure(rows.length === expected.length && !rows.some(row => !expectedByKey.get(keyOf(row)) || columns.some(column => canonical(row[column]) !== canonical(expectedByKey.get(keyOf(row))![column]))), 'STATE_REJECTED');
}
const stateColumns = (row: Row, keys: string[], tolerated: string[] = []) => Object.keys(row).filter(column => !keys.includes(column) && !tolerated.includes(column) && column !== 'created_at' && column !== 'updated_at');
async function verifyFixture(db: PreviewFixtureDatabase, target: Target) {
  await assertOwnership(db, target);
  const salonIds = FIXTURE.salons.map(row => row.id);
  await assertStateRows(db, 'salon', FIXTURE.salons, ['id'], stateColumns(FIXTURE.salons[0]!, ['id']), 'id = ANY($1::text[])', [salonIds]);
  const imageStates = await db.query<Row>(`SELECT id, COALESCE(settings #>> '{merchandising,showServiceImages}', 'true') AS resolved FROM public.salon WHERE id = ANY($1::text[])`, [salonIds]);
  ensure(imageStates.rows.find(row => row.id === FIXTURE.salons[0]!.id)?.resolved === 'true' && imageStates.rows.find(row => row.id === FIXTURE.salons[1]!.id)?.resolved === 'false', 'STATE_REJECTED');
  await assertStateRows(db, 'salon_location', FIXTURE.locations, ['id'], stateColumns(FIXTURE.locations[0]!, ['id']), 'salon_id = ANY($1::text[])', [salonIds]);
  await assertStateRows(db, 'service', FIXTURE.services, ['id'], stateColumns(FIXTURE.services[0]!, ['id']), 'salon_id = ANY($1::text[])', [salonIds]);
  await assertStateRows(db, 'technician', FIXTURE.technicians, ['id'], stateColumns(FIXTURE.technicians[0]!, ['id']), 'salon_id = ANY($1::text[])', [salonIds]);
  await assertStateRows(db, 'technician_services', FIXTURE.assignments, ['technician_id', 'service_id'], stateColumns(FIXTURE.assignments[0]!, ['technician_id', 'service_id']), 'technician_id = ANY($1::text[])', [FIXTURE.technicians.map(row => row.id)]);
  await assertStateRows(db, 'add_on', FIXTURE.addOns, ['id'], stateColumns(FIXTURE.addOns[0]!, ['id']), 'salon_id = ANY($1::text[])', [salonIds]);
  await assertStateRows(db, 'service_add_on', FIXTURE.rules, ['id'], stateColumns(FIXTURE.rules[0]!, ['id']), 'salon_id = ANY($1::text[])', [salonIds]);
  await assertStateRows(db, 'admin_salon_membership', FIXTURE.memberships, ['admin_id', 'salon_id'], stateColumns(FIXTURE.memberships[0]!, ['admin_id', 'salon_id']), 'admin_id = $1', [FIXTURE.admin.id]);
  await assertStateRows(db, 'admin_user', [FIXTURE.admin], ['id'], stateColumns(FIXTURE.admin, ['id'], ['clerk_user_id']), 'id = $1', [FIXTURE.admin.id]);
  const admin = await db.query<Row>('SELECT clerk_user_id FROM public.admin_user WHERE id = $1', [FIXTURE.admin.id]);
  ensure((!target.adminUserId || admin.rows[0]?.clerk_user_id === target.adminUserId) && (target.adminUserId || admin.rows[0]?.clerk_user_id == null || CLERK_USER_ID.test(String(admin.rows[0].clerk_user_id))), 'STATE_REJECTED');
  const sessions = await db.query<Row>('SELECT count(*)::int AS count FROM public.admin_session WHERE admin_id = $1', [FIXTURE.admin.id]);
  ensure(Number(sessions.rows[0]?.count) === 0, 'STATE_REJECTED');
}
async function deleteRows(db: PreviewFixtureDatabase, table: string, rows: readonly Row[], keys: string[]) {
  const values: unknown[] = [];
  const predicates = rows.map(row => `(${keys.map((key) => {
    values.push(row[key]);
    return `${quote(key)} = $${values.length}`;
  }).join(' AND ')})`);
  await db.query(`DELETE FROM public.${quote(table)} WHERE ${predicates.join(' OR ')}`, values);
}
const FOREIGN_KEY_ACTIONS = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' } as const;
type ForeignKeyAction = typeof FOREIGN_KEY_ACTIONS[keyof typeof FOREIGN_KEY_ACTIONS];
type IncomingForeignKeyIdentity = readonly [childSchema: string, childTable: string, constraintName: string, childColumns: readonly string[], parentSchema: string, parentTable: string, parentColumns: readonly string[], updateAction: ForeignKeyAction, deleteAction: ForeignKeyAction];
const EXPECTED_INCOMING_FOREIGN_KEYS = [
  ['public', 'appointment_add_on', 'appointment_add_on_add_on_id_fkey', ['add_on_id'], 'public', 'add_on', ['id'], 'NO ACTION', 'NO ACTION'],
  ['public', 'appointment_final_item', 'appointment_final_item_catalog_add_on_id_fkey', ['catalog_add_on_id'], 'public', 'add_on', ['id'], 'NO ACTION', 'NO ACTION'],
  ['public', 'service_add_on', 'service_add_on_add_on_id_fkey', ['add_on_id'], 'public', 'add_on', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'admin_invite', 'admin_invite_created_by_fkey', ['created_by'], 'public', 'admin_user', ['id'], 'NO ACTION', 'NO ACTION'],
  ['public', 'admin_salon_membership', 'admin_salon_membership_admin_id_fkey', ['admin_id'], 'public', 'admin_user', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'admin_session', 'admin_session_admin_id_fkey', ['admin_id'], 'public', 'admin_user', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'salon_signup_invite', 'salon_signup_invite_consumed_by_admin_id_fkey', ['consumed_by_admin_id'], 'public', 'admin_user', ['id'], 'NO ACTION', 'NO ACTION'],
  ['public', 'salon_signup_invite', 'salon_signup_invite_created_by_admin_id_fkey', ['created_by_admin_id'], 'public', 'admin_user', ['id'], 'NO ACTION', 'NO ACTION'],
  ['public', 'time_off_request', 'time_off_request_decided_by_admin_id_fkey', ['decided_by_admin_id'], 'public', 'admin_user', ['id'], 'NO ACTION', 'NO ACTION'],
  ['public', 'add_on', 'add_on_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'admin_invite', 'admin_invite_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'admin_salon_membership', 'admin_salon_membership_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'appointment', 'appointment_salon_id_salon_id_fk', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'appointment_access_token', 'appointment_access_token_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'appointment_audit_log', 'appointment_audit_log_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'appointment_booking_policy_acknowledgment', 'appointment_booking_policy_ack_salon_fk', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'appointment_final_item', 'appointment_final_item_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'appointment_payment', 'appointment_payment_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'appointment_payment_link', 'appointment_payment_link_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'appointment_photo', 'appointment_photo_salon_id_salon_id_fk', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'audit_log', 'audit_log_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'SET NULL'],
  ['public', 'autopost_queue', 'autopost_queue_salon_id_salon_id_fk', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'client_communication', 'client_communication_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'client_preferences', 'client_preferences_salon_id_salon_id_fk', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'communication_consent', 'communication_consent_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'fraud_signal', 'fraud_signal_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'google_calendar_draft', 'google_calendar_draft_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'google_calendar_event', 'google_calendar_event_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'google_event_review_pattern', 'google_event_review_pattern_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'integration_outbox', 'integration_outbox_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'notification', 'notification_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'notification_delivery', 'notification_delivery_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'referral', 'referral_salon_id_salon_id_fk', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'retention_campaign', 'retention_campaign_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'retention_campaign_redemption', 'retention_campaign_redemption_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'review', 'review_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'reward', 'reward_salon_id_salon_id_fk', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'salon_audit_log', 'salon_audit_log_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'salon_client', 'salon_client_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'salon_client_contact_alias', 'salon_client_contact_alias_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'salon_client_note', 'salon_client_note_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'salon_google_calendar_connection', 'salon_google_calendar_connection_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'salon_location', 'salon_location_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'salon_page_appearance', 'salon_page_appearance_salon_id_salon_id_fk', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'salon_policies', 'salon_policies_salon_id_salon_id_fk', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'salon_retention_settings', 'salon_retention_settings_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'salon_signup_invite', 'salon_signup_invite_result_salon_id_salon_id_fk', ['result_salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'SET NULL'],
  ['public', 'salon_signup_invite', 'salon_signup_invite_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'salon_twilio_connection', 'salon_twilio_connection_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'service', 'service_salon_id_salon_id_fk', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'service_add_on', 'service_add_on_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'staff_session', 'staff_session_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'technician', 'technician_salon_id_salon_id_fk', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'technician_blocked_slot', 'technician_blocked_slot_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'technician_schedule_override', 'technician_schedule_override_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'technician_time_off', 'technician_time_off_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'time_off_request', 'time_off_request_salon_id_fkey', ['salon_id'], 'public', 'salon', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'technician', 'technician_location_fk', ['primary_location_id'], 'public', 'salon_location', ['id'], 'NO ACTION', 'SET NULL'],
  ['public', 'appointment_final_item', 'appointment_final_item_catalog_service_id_fkey', ['catalog_service_id'], 'public', 'service', ['id'], 'NO ACTION', 'NO ACTION'],
  ['public', 'appointment_services', 'appointment_services_service_id_service_id_fk', ['service_id'], 'public', 'service', ['id'], 'NO ACTION', 'NO ACTION'],
  ['public', 'service_add_on', 'service_add_on_service_id_fkey', ['service_id'], 'public', 'service', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'technician_services', 'technician_services_service_id_service_id_fk', ['service_id'], 'public', 'service', ['id'], 'NO ACTION', 'NO ACTION'],
  ['public', 'appointment', 'appointment_review_followup_sent_by_technician_id_fk', ['review_followup_sent_by'], 'public', 'technician', ['id'], 'NO ACTION', 'NO ACTION'],
  ['public', 'appointment', 'appointment_technician_id_technician_id_fk', ['technician_id'], 'public', 'technician', ['id'], 'NO ACTION', 'NO ACTION'],
  ['public', 'appointment_photo', 'appointment_photo_uploaded_by_tech_id_technician_id_fk', ['uploaded_by_tech_id'], 'public', 'technician', ['id'], 'NO ACTION', 'NO ACTION'],
  ['public', 'client_preferences', 'client_preferences_favorite_tech_id_technician_id_fk', ['favorite_tech_id'], 'public', 'technician', ['id'], 'NO ACTION', 'NO ACTION'],
  ['public', 'notification', 'notification_recipient_technician_id_fkey', ['recipient_technician_id'], 'public', 'technician', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'review', 'review_technician_id_fkey', ['technician_id'], 'public', 'technician', ['id'], 'NO ACTION', 'NO ACTION'],
  ['public', 'salon_client', 'salon_client_preferred_technician_id_fkey', ['preferred_technician_id'], 'public', 'technician', ['id'], 'NO ACTION', 'NO ACTION'],
  ['public', 'staff_session', 'staff_session_technician_id_fkey', ['technician_id'], 'public', 'technician', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'technician_blocked_slot', 'technician_blocked_slot_technician_id_fkey', ['technician_id'], 'public', 'technician', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'technician_schedule_override', 'technician_schedule_override_technician_id_fkey', ['technician_id'], 'public', 'technician', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'technician_services', 'technician_services_technician_id_technician_id_fk', ['technician_id'], 'public', 'technician', ['id'], 'NO ACTION', 'NO ACTION'],
  ['public', 'technician_time_off', 'technician_time_off_technician_id_fkey', ['technician_id'], 'public', 'technician', ['id'], 'NO ACTION', 'CASCADE'],
  ['public', 'time_off_request', 'time_off_request_technician_id_fkey', ['technician_id'], 'public', 'technician', ['id'], 'NO ACTION', 'CASCADE'],
] as const satisfies readonly IncomingForeignKeyIdentity[];
const FIXTURE_TARGET_ROWS: Record<string, readonly Row[]> = { salon: FIXTURE.salons, salon_location: FIXTURE.locations, service: FIXTURE.services, add_on: FIXTURE.addOns, technician: FIXTURE.technicians, admin_user: [FIXTURE.admin], service_add_on: FIXTURE.rules, technician_services: FIXTURE.assignments, admin_salon_membership: FIXTURE.memberships };
function uniqueRelations(relations: ReadonlyArray<readonly [string, string]>): Array<readonly [string, string]> {
  return [...new Map(relations.map(relation => [JSON.stringify(relation), relation])).values()].sort(([schemaA, tableA], [schemaB, tableB]) => `${schemaA}.${tableA}`.localeCompare(`${schemaB}.${tableB}`));
}
const MUTATION_LOCK_RELATIONS = uniqueRelations([
  ...Object.keys(FIXTURE_TARGET_ROWS).map(table => ['public', table] as const),
  ...EXPECTED_INCOMING_FOREIGN_KEYS.map(([childSchema, childTable]) => [childSchema, childTable] as const),
]);
async function lockMutationRelations(db: PreviewFixtureDatabase) {
  await db.query(`/* preview-fixture-relation-lock */ LOCK TABLE ${MUTATION_LOCK_RELATIONS.map(([schema, table]) => `${quote(schema)}.${quote(table)}`).join(', ')} IN EXCLUSIVE MODE NOWAIT`);
}
function foreignKeyIdentity(row: Row): IncomingForeignKeyIdentity {
  const childColumns = row.child_columns;
  const parentColumns = row.parent_columns;
  const updateAction = typeof row.update_action === 'string' ? FOREIGN_KEY_ACTIONS[row.update_action as keyof typeof FOREIGN_KEY_ACTIONS] : undefined;
  const deleteAction = typeof row.delete_action === 'string' ? FOREIGN_KEY_ACTIONS[row.delete_action as keyof typeof FOREIGN_KEY_ACTIONS] : undefined;
  ensure(typeof row.child_schema === 'string' && typeof row.child_table === 'string' && typeof row.constraint_name === 'string' && Array.isArray(childColumns) && childColumns.length > 0 && childColumns.every(column => typeof column === 'string') && typeof row.parent_schema === 'string' && typeof row.parent_table === 'string' && Array.isArray(parentColumns) && parentColumns.length === childColumns.length && parentColumns.every(column => typeof column === 'string') && updateAction && deleteAction, 'SESSION_REJECTED');
  return [row.child_schema, row.child_table, row.constraint_name, childColumns, row.parent_schema, row.parent_table, parentColumns, updateAction, deleteAction];
}
const normalizeForeignKeyIdentity = (identity: IncomingForeignKeyIdentity) => JSON.stringify(identity);
export function normalizeIncomingForeignKeyEdge(row: Row): string {
  return normalizeForeignKeyIdentity(foreignKeyIdentity(row));
}
async function assertIncomingForeignKeyContract(db: PreviewFixtureDatabase): Promise<IncomingForeignKeyIdentity[]> {
  const references = await db.query<Row>(`/* preview-fixture-incoming-foreign-keys */ SELECT child_schema.nspname AS child_schema, child.relname AS child_table, fk.conname AS constraint_name, array_agg(child_column.attname ORDER BY keys.ordinality) AS child_columns, parent_schema.nspname AS parent_schema, parent.relname AS parent_table, array_agg(parent_column.attname ORDER BY keys.ordinality) AS parent_columns, fk.confupdtype AS update_action, fk.confdeltype AS delete_action FROM pg_catalog.pg_constraint fk JOIN pg_catalog.pg_class child ON child.oid = fk.conrelid JOIN pg_catalog.pg_namespace child_schema ON child_schema.oid = child.relnamespace JOIN pg_catalog.pg_class parent ON parent.oid = fk.confrelid JOIN pg_catalog.pg_namespace parent_schema ON parent_schema.oid = parent.relnamespace JOIN LATERAL unnest(fk.conkey, fk.confkey) WITH ORDINALITY AS keys(child_attnum, parent_attnum, ordinality) ON true JOIN pg_catalog.pg_attribute child_column ON child_column.attrelid = child.oid AND child_column.attnum = keys.child_attnum JOIN pg_catalog.pg_attribute parent_column ON parent_column.attrelid = parent.oid AND parent_column.attnum = keys.parent_attnum WHERE fk.contype = 'f' AND parent_schema.nspname = 'public' AND parent.relname = ANY($1::text[]) GROUP BY child_schema.nspname, child.relname, fk.conname, parent_schema.nspname, parent.relname, fk.confupdtype, fk.confdeltype`, [Object.keys(FIXTURE_TARGET_ROWS)]);
  const identities = references.rows.map(foreignKeyIdentity);
  const actual = identities.map(normalizeForeignKeyIdentity).sort();
  const expected = EXPECTED_INCOMING_FOREIGN_KEYS.map(normalizeForeignKeyIdentity).sort();
  ensure(actual.length === expected.length && actual.every((identity, index) => identity === expected[index]), 'SESSION_REJECTED');
  return identities;
}
async function assertNoIncomingReferences(db: PreviewFixtureDatabase, references: readonly IncomingForeignKeyIdentity[], parentTables: readonly string[]) {
  const requested = new Set(parentTables);
  for (const [childSchema, childTable, , childColumns, , parentTable, parentColumns] of references) {
    if (!requested.has(parentTable)) {
      continue;
    }
    const parents = FIXTURE_TARGET_ROWS[parentTable];
    ensure(parents && parents.length > 0, 'SESSION_REJECTED');
    const values: unknown[] = [];
    const predicates = parents.map(parent => `(${childColumns.map((childColumn, index) => {
      const parentColumn = parentColumns[index];
      ensure(parentColumn && Object.hasOwn(parent, parentColumn), 'SESSION_REJECTED');
      values.push(parent[parentColumn]);
      return `${quote(childColumn)} IS NOT DISTINCT FROM $${values.length}`;
    }).join(' AND ')})`);
    const result = await db.query<Row>(`SELECT count(*)::int AS count FROM ${quote(childSchema)}.${quote(childTable)} WHERE ${predicates.join(' OR ')}`, values);
    ensure(Number(result.rows[0]?.count) === 0, 'COLLISION_REJECTED');
  }
}
async function resetFixture(db: PreviewFixtureDatabase, references: readonly IncomingForeignKeyIdentity[]) {
  await deleteRows(db, 'service_add_on', FIXTURE.rules, ['id']);
  await deleteRows(db, 'technician_services', FIXTURE.assignments, ['technician_id', 'service_id']);
  await deleteRows(db, 'admin_salon_membership', FIXTURE.memberships, ['admin_id', 'salon_id']);
  await assertNoIncomingReferences(db, references, ['service', 'add_on', 'technician']);
  await deleteRows(db, 'service', FIXTURE.services, ['id']);
  await deleteRows(db, 'add_on', FIXTURE.addOns, ['id']);
  await deleteRows(db, 'technician', FIXTURE.technicians, ['id']);
  await assertNoIncomingReferences(db, references, ['salon_location']);
  await deleteRows(db, 'salon_location', FIXTURE.locations, ['id']);
  await assertNoIncomingReferences(db, references, ['salon', 'admin_user']);
  await deleteRows(db, 'salon', FIXTURE.salons, ['id']);
  await deleteRows(db, 'admin_user', [FIXTURE.admin], ['id']);
}
async function verifyReset(db: PreviewFixtureDatabase, target: Target) {
  await assertOwnership(db, target);
  const checks: Array<[string, string, unknown[]]> = [
    ['salon', 'id = ANY($1::text[])', [FIXTURE.salons.map(row => row.id)]],
    ['service', 'id = ANY($1::text[])', [FIXTURE.services.map(row => row.id)]],
    ['technician', 'id = ANY($1::text[])', [FIXTURE.technicians.map(row => row.id)]],
    ['add_on', 'id = ANY($1::text[])', [FIXTURE.addOns.map(row => row.id)]],
    ['salon_location', 'id = ANY($1::text[])', [FIXTURE.locations.map(row => row.id)]],
    ['admin_user', 'id = $1', [FIXTURE.admin.id]],
  ];
  for (const [table, where, values] of checks) {
    const result = await db.query<Row>(`SELECT count(*)::int AS count FROM public.${quote(table)} WHERE ${where}`, values);
    ensure(Number(result.rows[0]?.count) === 0, 'STATE_REJECTED');
  }
}
async function withTransaction<T>(db: Client, target: Target, readOnly: boolean, commit: boolean, operation: (references: readonly IncomingForeignKeyIdentity[]) => Promise<T>): Promise<T> {
  let transactionOpen = false;
  try {
    await db.query(`BEGIN ISOLATION LEVEL SERIALIZABLE ${readOnly ? 'READ ONLY' : 'READ WRITE'}`);
    transactionOpen = true;
    await db.query('SET LOCAL search_path = pg_catalog, public');
    await db.query('SET LOCAL row_security = off');
    if (!readOnly) {
      await lockMutationRelations(db);
    }
    await assertTransaction(db, readOnly);
    await assertSession(db, target);
    await assertMigrations(db);
    await assertSchema(db);
    const references = await assertIncomingForeignKeyContract(db);
    await assertOwnership(db, target);
    const result = await operation(references);
    await db.query(commit ? 'COMMIT' : 'ROLLBACK');
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      await db.query('ROLLBACK').catch(() => {});
    }
    throw error;
  }
}
export async function runPreviewServiceImageFixture(commandValue: string | undefined, environment: Record<string, string | undefined> = process.env, log?: (message: string) => void) {
  let database: Client | undefined;
  let stage: FailureStage = 'configuration';
  try {
    const command = requireCommand(commandValue);
    const target = requireTarget(environment, command);
    stage = 'connection';
    const client = new Client(target.clientConfig);
    database = client;
    await client.connect();
    ensure(target.tlsBoundary.attest(client, null), 'SESSION_REJECTED');
    const tlsAttestation = await assertSession(client, target, 'connection');
    stage = command;
    if (command === 'plan') {
      await withTransaction(client, target, true, false, async () => undefined);
    }
    if (command === 'apply') {
      await withTransaction(client, target, false, true, async () => {
        await applyFixture(client, target);
        await verifyFixture(client, target);
      });
    }
    if (command === 'verify') {
      await withTransaction(client, target, true, false, () => verifyFixture(client, target));
    }
    if (command === 'reset') {
      await withTransaction(client, target, false, true, async (references) => {
        await resetFixture(client, references);
        await verifyReset(client, target);
      });
    }
    log?.(`Preview fixture ${command} complete: salons=${PREVIEW_FIXTURE_COUNTS.salons}, services=${PREVIEW_FIXTURE_COUNTS.services}, technicians=${PREVIEW_FIXTURE_COUNTS.technicians}, add-ons=${PREVIEW_FIXTURE_COUNTS.addOns}, side-effects=0. TLS: ${tlsAttestation}.`);
    return PREVIEW_FIXTURE_COUNTS;
  } catch (error) {
    if (typeof error === 'object' && error !== null && trustedErrors.has(error as PreviewFixtureError)) {
      throw fixtureError((error as PreviewFixtureError).code);
    }
    throw fixtureError('OPERATION_FAILED', stage, safeDiagnosticCode(error));
  } finally {
    try {
      await database?.end();
    } catch {
      // Connection cleanup must not replace the already sanitized operation result.
    }
  }
}
const entryPath = process.argv[1];
if (entryPath && fileURLToPath(import.meta.url) === path.resolve(entryPath)) {
  runPreviewServiceImageFixture(process.argv[2], process.env, message => process.stdout.write(`${message}\n`)).catch((error) => {
    console.error(error instanceof PreviewFixtureError ? error.message : MESSAGES.OPERATION_FAILED);
    process.exitCode = 1;
  });
}
