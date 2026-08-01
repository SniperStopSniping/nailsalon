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

export type PreviewFixtureCommand = 'plan' | 'apply' | 'verify' | 'reset';
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
const CLERK_USER_ID = /^user_[A-Za-z0-9]{20,64}$/;
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
  constructor(readonly code: ErrorCode) {
    super(MESSAGES[code]);
    this.name = 'PreviewFixtureError';
  }
}
function reject(code: ErrorCode): never {
  throw new PreviewFixtureError(code);
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
type Target = { clientConfig: ClientConfig; databaseUser: string; adminUserId: string | null };
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
  ensure(environment.LUSTER_PREVIEW_FIXTURE_VERSION === PREVIEW_FIXTURE_VERSION && environment.LUSTER_PREVIEW_FIXTURE_CONFIRM === CONFIRM, 'CONFIRMATION_REJECTED');
  ensure(command !== 'reset' || environment.LUSTER_PREVIEW_FIXTURE_RESET_CONFIRM === RESET_CONFIRM, 'CONFIRMATION_REJECTED');
  const adminUserId = environment.LUSTER_PREVIEW_CLERK_USER_ID ?? null;
  const adminInputsPresent = Boolean(adminUserId || environment.LUSTER_PREVIEW_ADMIN_CONFIRM || environment.LUSTER_PREVIEW_CLERK_ENV);
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
  ensure(host === expectedHost && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) && !PRODUCTION_LIKE.test(host), 'TARGET_REJECTED');
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
  return { adminUserId, databaseUser, clientConfig: { host, port: 5432, database, user: databaseUser, password, application_name: APPLICATION_NAME, ssl: { rejectUnauthorized: true, servername: host }, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 } };
}
async function assertSession(db: PreviewFixtureDatabase, target: Target) {
  const { rows } = await db.query<Row>(`/* preview-fixture-session */ SELECT pg_catalog.current_database() AS database_name, current_user AS database_user, pg_catalog.current_setting('application_name', true) AS application_name, ssl.ssl, role.rolsuper, role.rolcreaterole, role.rolcreatedb, role.rolbypassrls, role.rolcanlogin FROM pg_catalog.pg_roles role LEFT JOIN pg_catalog.pg_stat_ssl ssl ON ssl.pid = pg_catalog.pg_backend_pid() WHERE role.rolname = current_user`);
  const row = rows[0];
  ensure(rows.length === 1 && row?.database_name === DATABASE_NAME && row.database_user === target.databaseUser && row.application_name === APPLICATION_NAME && row.ssl === true, 'SESSION_REJECTED');
  ensure(!row.rolsuper && !row.rolcreaterole && !row.rolcreatedb && !row.rolbypassrls && row.rolcanlogin === true, 'SESSION_REJECTED');
}
async function assertTransaction(db: PreviewFixtureDatabase, readOnly: boolean) {
  const { rows } = await db.query<Row>(`/* preview-fixture-transaction */ SELECT pg_catalog.current_setting('transaction_isolation') AS isolation, pg_catalog.current_setting('transaction_read_only') AS read_only, pg_catalog.current_setting('search_path') AS search_path`);
  ensure(rows[0]?.isolation === 'serializable' && rows[0]?.read_only === (readOnly ? 'on' : 'off') && rows[0]?.search_path === 'pg_catalog, public', 'TRANSACTION_REJECTED');
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
const INCOMING_REFERENCE_COUNTS: Record<string, number> = { service: 4, add_on: 3, technician: 13, salon_location: 1, salon: 48, admin_user: 6 };
async function assertNoIncomingReferences(db: PreviewFixtureDatabase, parents: Record<string, string[]>) {
  const references = await db.query<Row>(`SELECT DISTINCT child.relname AS child_table, child_column.attname AS child_column, parent.relname AS parent_table FROM pg_catalog.pg_constraint fk JOIN pg_catalog.pg_class child ON child.oid = fk.conrelid JOIN pg_catalog.pg_namespace child_schema ON child_schema.oid = child.relnamespace JOIN pg_catalog.pg_class parent ON parent.oid = fk.confrelid JOIN pg_catalog.pg_namespace parent_schema ON parent_schema.oid = parent.relnamespace JOIN LATERAL unnest(fk.conkey, fk.confkey) AS keys(child_attnum, parent_attnum) ON true JOIN pg_catalog.pg_attribute child_column ON child_column.attrelid = child.oid AND child_column.attnum = keys.child_attnum JOIN pg_catalog.pg_attribute parent_column ON parent_column.attrelid = parent.oid AND parent_column.attnum = keys.parent_attnum WHERE fk.contype = 'f' AND child_schema.nspname = 'public' AND parent_schema.nspname = 'public' AND parent_column.attname = 'id' AND parent.relname = ANY($1::text[])`, [Object.keys(parents)]);
  ensure(!Object.keys(parents).some(parent => references.rows.filter(row => row.parent_table === parent).length !== INCOMING_REFERENCE_COUNTS[parent]), 'SESSION_REJECTED');
  for (const row of references.rows) {
    const child = String(row.child_table);
    const column = String(row.child_column);
    const ids = parents[String(row.parent_table)] ?? [];
    const result = await db.query<Row>(`SELECT count(*)::int AS count FROM public.${quote(child)} WHERE ${quote(column)} = ANY($1::text[])`, [ids]);
    ensure(Number(result.rows[0]?.count) === 0, 'COLLISION_REJECTED');
  }
}
async function resetFixture(db: PreviewFixtureDatabase) {
  await deleteRows(db, 'service_add_on', FIXTURE.rules, ['id']);
  await deleteRows(db, 'technician_services', FIXTURE.assignments, ['technician_id', 'service_id']);
  await deleteRows(db, 'admin_salon_membership', FIXTURE.memberships, ['admin_id', 'salon_id']);
  await assertNoIncomingReferences(db, { service: FIXTURE.services.map(row => row.id), add_on: FIXTURE.addOns.map(row => row.id), technician: FIXTURE.technicians.map(row => row.id) });
  await deleteRows(db, 'service', FIXTURE.services, ['id']);
  await deleteRows(db, 'add_on', FIXTURE.addOns, ['id']);
  await deleteRows(db, 'technician', FIXTURE.technicians, ['id']);
  await assertNoIncomingReferences(db, { salon_location: FIXTURE.locations.map(row => row.id) });
  await deleteRows(db, 'salon_location', FIXTURE.locations, ['id']);
  await assertNoIncomingReferences(db, { salon: FIXTURE.salons.map(row => row.id), admin_user: [FIXTURE.admin.id] });
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
async function withTransaction<T>(db: PreviewFixtureDatabase, target: Target, readOnly: boolean, commit: boolean, operation: () => Promise<T>): Promise<T> {
  await db.query(`BEGIN ISOLATION LEVEL SERIALIZABLE ${readOnly ? 'READ ONLY' : 'READ WRITE'}`);
  await db.query('SET LOCAL search_path = pg_catalog, public');
  try {
    await assertTransaction(db, readOnly);
    await assertSession(db, target);
    await assertMigrations(db);
    await assertSchema(db);
    await assertOwnership(db, target);
    const result = await operation();
    await db.query(commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
export async function runPreviewServiceImageFixture(commandValue: string | undefined, environment: Record<string, string | undefined> = process.env, log?: (message: string) => void) {
  const command = requireCommand(commandValue);
  const target = requireTarget(environment, command);
  const database = new Client(target.clientConfig);
  try {
    await database.connect();
    if (command === 'plan') {
      await withTransaction(database, target, true, false, async () => undefined);
    }
    if (command === 'apply') {
      await withTransaction(database, target, false, true, async () => {
        await applyFixture(database, target);
        await verifyFixture(database, target);
      });
    }
    if (command === 'verify') {
      await withTransaction(database, target, true, false, () => verifyFixture(database, target));
    }
    if (command === 'reset') {
      await withTransaction(database, target, false, true, async () => {
        await resetFixture(database);
        await verifyReset(database, target);
      });
    }
    log?.(`Preview fixture ${command} complete: salons=${PREVIEW_FIXTURE_COUNTS.salons}, services=${PREVIEW_FIXTURE_COUNTS.services}, technicians=${PREVIEW_FIXTURE_COUNTS.technicians}, add-ons=${PREVIEW_FIXTURE_COUNTS.addOns}, side-effects=0.`);
    return PREVIEW_FIXTURE_COUNTS;
  } catch (error) {
    if (error instanceof PreviewFixtureError) {
      throw error;
    }
    throw new PreviewFixtureError('OPERATION_FAILED');
  } finally {
    await database.end().catch(() => {});
  }
}
const entryPath = process.argv[1];
if (entryPath && fileURLToPath(import.meta.url) === path.resolve(entryPath)) {
  runPreviewServiceImageFixture(process.argv[2], process.env, message => process.stdout.write(`${message}\n`)).catch((error) => {
    console.error(error instanceof PreviewFixtureError ? error.message : MESSAGES.OPERATION_FAILED);
    process.exitCode = 1;
  });
}
