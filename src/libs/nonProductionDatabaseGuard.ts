const ALWAYS_ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost']);
const HOSTED_PROVIDER_SUFFIXES = [
  'aivencloud.com',
  'aws.neon.tech',
  'database.azure.com',
  'digitalocean.com',
  'heroku.com',
  'neon.tech',
  'railway.app',
  'render.com',
  'supabase.co',
];
const ROUTING_OVERRIDE_QUERY_KEYS = new Set([
  'database',
  'dbname',
  'host',
  'hostaddr',
  'password',
  'port',
  'user',
]);

const MARKER_QUERY
  = 'SELECT environment FROM public.luster_environment LIMIT 2';
const MARKER_TABLE_QUERY = `
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS marker
    INNER JOIN pg_catalog.pg_namespace AS marker_schema
      ON marker_schema.oid = marker.relnamespace
    WHERE marker_schema.nspname = 'public'
      AND marker.relname = 'luster_environment'
      AND marker.relkind IN ('r', 'p')
  ) AS marker_table_exists
`;
const USER_OBJECT_COUNT_QUERY = `
  SELECT COUNT(*)::integer AS user_object_count
  FROM (
    SELECT user_relation.oid
    FROM pg_catalog.pg_class AS user_relation
    INNER JOIN pg_catalog.pg_namespace AS user_schema
      ON user_schema.oid = user_relation.relnamespace
    WHERE user_schema.nspname <> 'information_schema'
      AND user_schema.nspname !~ '^pg_'

    UNION ALL

    SELECT user_function.oid
    FROM pg_catalog.pg_proc AS user_function
    INNER JOIN pg_catalog.pg_namespace AS user_schema
      ON user_schema.oid = user_function.pronamespace
    WHERE user_schema.nspname <> 'information_schema'
      AND user_schema.nspname !~ '^pg_'

    UNION ALL

    SELECT user_type.oid
    FROM pg_catalog.pg_type AS user_type
    INNER JOIN pg_catalog.pg_namespace AS user_schema
      ON user_schema.oid = user_type.typnamespace
    WHERE user_schema.nspname <> 'information_schema'
      AND user_schema.nspname !~ '^pg_'

    UNION ALL

    SELECT user_schema.oid
    FROM pg_catalog.pg_namespace AS user_schema
    WHERE user_schema.nspname <> 'public'
      AND user_schema.nspname <> 'information_schema'
      AND user_schema.nspname !~ '^pg_'
  ) AS user_object
`;

const CREATE_MARKER_TABLE_QUERY = `
  CREATE TABLE IF NOT EXISTS public.luster_environment (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    environment text NOT NULL CHECK (environment IN ('development', 'preview'))
  )
`;
const INSERT_MARKER_QUERY = `
  INSERT INTO public.luster_environment (singleton, environment)
  VALUES (true, $1)
  ON CONFLICT (singleton) DO NOTHING
`;

export type DevelopmentDatabaseEnvironment = 'development' | 'preview';

export type NonProductionDatabaseGuardErrorCode =
  | 'DATABASE_NOT_EMPTY'
  | 'FRAGMENT_FORBIDDEN'
  | 'HOST_ALLOWLIST_INVALID'
  | 'HOST_NOT_ALLOWED'
  | 'HOSTED_PROVIDER_NOT_ALLOWLISTED'
  | 'MALFORMED_URL'
  | 'MARKER_ENVIRONMENT_INVALID'
  | 'MARKER_ENVIRONMENT_MISMATCH'
  | 'MARKER_INITIALIZATION_FAILED'
  | 'MARKER_QUERY_FAILED'
  | 'MARKER_ROW_MISSING'
  | 'MARKER_ROW_MULTIPLE'
  | 'MARKER_TABLE_MISSING'
  | 'MIGRATION_INSPECTION_FAILED'
  | 'PROTOCOL_WRONG'
  | 'PRODUCTION_MARKER_INVALID'
  | 'PRODUCTION_MARKER_NONPRODUCTION'
  | 'PRODUCTION_MARKER_QUERY_FAILED'
  | 'ROUTING_OVERRIDE_FORBIDDEN'
  | 'URL_REQUIRED'
  | 'WHITESPACE_FORBIDDEN';

const ERROR_MESSAGES: Record<NonProductionDatabaseGuardErrorCode, string> = {
  DATABASE_NOT_EMPTY:
    'Development migration rejected: an unmarked database already contains user objects.',
  FRAGMENT_FORBIDDEN:
    'Non-Production database target rejected: URL fragments are forbidden.',
  HOST_ALLOWLIST_INVALID:
    'Non-Production database target rejected: LUSTER_NONPROD_DB_HOSTS is invalid.',
  HOST_NOT_ALLOWED:
    'Non-Production database target rejected: the hostname is not explicitly allowed.',
  HOSTED_PROVIDER_NOT_ALLOWLISTED:
    'Non-Production database target rejected: the hosted database hostname is not explicitly allowed.',
  MALFORMED_URL:
    'Non-Production database target rejected: DATABASE_URL is malformed.',
  MARKER_ENVIRONMENT_INVALID:
    'Development database rejected: the environment marker must be exactly development or preview.',
  MARKER_ENVIRONMENT_MISMATCH:
    'Non-Production database rejected: the environment marker does not match the required runtime environment.',
  MARKER_INITIALIZATION_FAILED:
    'Non-Production database marker initialization failed safely.',
  MARKER_QUERY_FAILED:
    'Development database rejected: the environment marker could not be read.',
  MARKER_ROW_MISSING:
    'Development database rejected: the environment marker row is missing.',
  MARKER_ROW_MULTIPLE:
    'Development database rejected: the environment marker must contain exactly one row.',
  MARKER_TABLE_MISSING:
    'Development database rejected: the environment marker table is missing.',
  MIGRATION_INSPECTION_FAILED:
    'Development migration rejected: database state could not be safely inspected.',
  PROTOCOL_WRONG:
    'Non-Production database target rejected: only PostgreSQL URLs are allowed.',
  PRODUCTION_MARKER_INVALID:
    'Production database rejected: the environment marker is invalid.',
  PRODUCTION_MARKER_NONPRODUCTION:
    'Production database rejected: a non-Production environment marker is present.',
  PRODUCTION_MARKER_QUERY_FAILED:
    'Production database rejected: the environment marker could not be inspected safely.',
  ROUTING_OVERRIDE_FORBIDDEN:
    'Non-Production database target rejected: routing override query parameters are forbidden.',
  URL_REQUIRED:
    'Non-Production database target rejected: DATABASE_URL is required.',
  WHITESPACE_FORBIDDEN:
    'Non-Production database target rejected: DATABASE_URL must not contain whitespace.',
};

export class NonProductionDatabaseGuardError extends Error {
  readonly code: NonProductionDatabaseGuardErrorCode;

  constructor(code: NonProductionDatabaseGuardErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'NonProductionDatabaseGuardError';
    this.code = code;
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

export type NonProductionDatabaseTarget = {
  connectionString: string;
  host: string;
};

/** The common query surface exposed by pg Client, pg Pool, and PGlite. */
export type DatabaseQueryable = {
  query: (queryText: string, values?: unknown[]) => Promise<unknown>;
};

export type MarkerInitializationOptions = {
  /** Use when the caller already owns the surrounding transaction. */
  transaction?: 'existing' | 'managed';
};

type UnknownRow = Record<string, unknown>;

function reject(code: NonProductionDatabaseGuardErrorCode): never {
  throw new NonProductionDatabaseGuardError(code);
}

function normalizeUrlHost(hostname: string): string {
  const normalized = hostname.toLowerCase();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function isHostedProviderHostname(hostname: string): boolean {
  return HOSTED_PROVIDER_SUFFIXES.some(suffix => (
    hostname === suffix || hostname.endsWith(`.${suffix}`)
  ));
}

function allowedHosts(environment: Environment): Set<string> {
  const hosts = new Set(ALWAYS_ALLOWED_HOSTS);
  const configuredHosts = environment.LUSTER_NONPROD_DB_HOSTS;
  if (configuredHosts === undefined || configuredHosts === '') {
    return hosts;
  }

  for (const entry of configuredHosts.split(',')) {
    const host = normalizeUrlHost(entry.trim());
    if (
      !host
      || /\s/.test(host)
      || host.includes('*')
      || /[/:@?#\\]/.test(host)
    ) {
      reject('HOST_ALLOWLIST_INVALID');
    }
    hosts.add(host);
  }

  return hosts;
}

/**
 * Rejects a database URL before a client is created unless its hostname is an
 * exact non-Production allowlist entry. The returned string is never logged by
 * this module and errors deliberately contain no parsed URL values.
 */
export function requirePostgresDatabaseTarget(
  environment: Environment = process.env,
): NonProductionDatabaseTarget {
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) {
    reject('URL_REQUIRED');
  }
  if (/\s/.test(connectionString)) {
    reject('WHITESPACE_FORBIDDEN');
  }

  let parsed: URL;
  try {
    // URL accepts malformed percent escapes that database drivers may parse
    // differently. Decoding once is validation only; the original string is
    // returned unchanged.
    decodeURI(connectionString);
    parsed = new URL(connectionString);
  } catch {
    reject('MALFORMED_URL');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    reject('PROTOCOL_WRONG');
  }
  if (connectionString.includes('#')) {
    reject('FRAGMENT_FORBIDDEN');
  }
  if (!parsed.hostname) {
    reject('MALFORMED_URL');
  }

  for (const key of parsed.searchParams.keys()) {
    if (ROUTING_OVERRIDE_QUERY_KEYS.has(key.toLowerCase())) {
      reject('ROUTING_OVERRIDE_FORBIDDEN');
    }
  }

  return {
    connectionString,
    host: normalizeUrlHost(parsed.hostname),
  };
}

export function requireNonProductionDatabaseTarget(
  environment: Environment = process.env,
): NonProductionDatabaseTarget {
  const target = requirePostgresDatabaseTarget(environment);
  const host = target.host;
  if (!allowedHosts(environment).has(host)) {
    reject(
      isHostedProviderHostname(host)
        ? 'HOSTED_PROVIDER_NOT_ALLOWLISTED'
        : 'HOST_NOT_ALLOWED',
    );
  }

  return target;
}

function isUnknownRow(value: unknown): value is UnknownRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rowsFromResult(result: unknown): UnknownRow[] | null {
  if (!isUnknownRow(result) || !Array.isArray(result.rows)) {
    return null;
  }
  if (!result.rows.every(isUnknownRow)) {
    return null;
  }
  return result.rows;
}

function postgresErrorCode(error: unknown): string | undefined {
  if (!isUnknownRow(error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

/**
 * Requires the authoritative in-database environment marker. Merely reaching
 * an allowlisted host is never enough to authorize mutation.
 */
async function readNonProductionDatabaseEnvironment(
  queryable: DatabaseQueryable,
): Promise<DevelopmentDatabaseEnvironment> {
  let result: unknown;
  try {
    result = await queryable.query(MARKER_QUERY);
  } catch (error) {
    if (postgresErrorCode(error) === '42P01') {
      reject('MARKER_TABLE_MISSING');
    }
    reject('MARKER_QUERY_FAILED');
  }

  const rows = rowsFromResult(result);
  if (!rows) {
    reject('MARKER_QUERY_FAILED');
  }
  if (rows.length === 0) {
    reject('MARKER_ROW_MISSING');
  }
  if (rows.length > 1) {
    reject('MARKER_ROW_MULTIPLE');
  }

  const environment = rows[0]?.environment;
  if (environment !== 'development' && environment !== 'preview') {
    reject('MARKER_ENVIRONMENT_INVALID');
  }
  return environment;
}

/** Legacy Development tooling is bound to Development, never Preview. */
export async function requireDevelopmentDatabase(
  queryable: DatabaseQueryable,
): Promise<'development'> {
  const environment = await readNonProductionDatabaseEnvironment(queryable);
  if (environment !== 'development') {
    reject('MARKER_ENVIRONMENT_MISMATCH');
  }
  return environment;
}

/** Requires an exact Development or Preview marker, never either one. */
export async function requireExactNonProductionDatabaseEnvironment(
  queryable: DatabaseQueryable,
  expectedEnvironment: DevelopmentDatabaseEnvironment,
): Promise<DevelopmentDatabaseEnvironment> {
  const environment = await readNonProductionDatabaseEnvironment(queryable);
  if (environment !== expectedEnvironment) {
    reject('MARKER_ENVIRONMENT_MISMATCH');
  }
  return environment;
}

/**
 * Production does not need a marker. If the operational marker exists, it may
 * only contain the exact value `production`; Development/Preview or malformed
 * marker state fails closed.
 */
export async function rejectNonProductionMarkerForProduction(
  queryable: DatabaseQueryable,
): Promise<void> {
  let result: unknown;
  try {
    result = await queryable.query(MARKER_QUERY);
  } catch (error) {
    if (postgresErrorCode(error) === '42P01') {
      return;
    }
    reject('PRODUCTION_MARKER_QUERY_FAILED');
  }

  const rows = rowsFromResult(result);
  if (!rows || rows.length !== 1) {
    reject('PRODUCTION_MARKER_INVALID');
  }

  const environment = rows[0]?.environment;
  if (environment === 'development' || environment === 'preview') {
    reject('PRODUCTION_MARKER_NONPRODUCTION');
  }
  if (environment !== 'production') {
    reject('PRODUCTION_MARKER_INVALID');
  }
}

function exactlyOneRow(result: unknown): UnknownRow | null {
  const rows = rowsFromResult(result);
  return rows?.length === 1 ? rows[0] ?? null : null;
}

async function inspectMigrationDatabase(
  queryable: DatabaseQueryable,
  query: string,
): Promise<UnknownRow> {
  let result: unknown;
  try {
    result = await queryable.query(query);
  } catch {
    reject('MIGRATION_INSPECTION_FAILED');
  }

  const row = exactlyOneRow(result);
  if (!row) {
    reject('MIGRATION_INSPECTION_FAILED');
  }
  return row;
}

function parseObjectCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) {
    const count = Number(value);
    return Number.isSafeInteger(count) ? count : null;
  }
  return null;
}

/**
 * Allows the normal marker path, plus one bootstrap case: the marker table is
 * absent and the database catalog proves that no user objects exist. Every
 * inspection failure rejects; it can never be interpreted as an empty target.
 */
export async function requireDevelopmentMigrationDatabase(
  queryable: DatabaseQueryable,
  expectedEnvironment?: DevelopmentDatabaseEnvironment,
): Promise<DevelopmentDatabaseEnvironment | null> {
  const markerTable = await inspectMigrationDatabase(
    queryable,
    MARKER_TABLE_QUERY,
  );
  if (markerTable.marker_table_exists === true) {
    return expectedEnvironment
      ? requireExactNonProductionDatabaseEnvironment(
        queryable,
        expectedEnvironment,
      )
      : requireDevelopmentDatabase(queryable);
  }
  if (markerTable.marker_table_exists !== false) {
    reject('MIGRATION_INSPECTION_FAILED');
  }

  const objectCount = await inspectMigrationDatabase(
    queryable,
    USER_OBJECT_COUNT_QUERY,
  );
  const count = parseObjectCount(objectCount.user_object_count);
  if (count === null) {
    reject('MIGRATION_INSPECTION_FAILED');
  }
  if (count !== 0) {
    reject('DATABASE_NOT_EMPTY');
  }

  return null;
}

async function initializeMarkerInsideTransaction(
  queryable: DatabaseQueryable,
  expectedEnvironment: DevelopmentDatabaseEnvironment,
): Promise<DevelopmentDatabaseEnvironment> {
  const existingEnvironment = await requireDevelopmentMigrationDatabase(
    queryable,
    expectedEnvironment,
  );
  if (existingEnvironment) {
    return existingEnvironment;
  }

  try {
    await queryable.query(CREATE_MARKER_TABLE_QUERY);
    await queryable.query(INSERT_MARKER_QUERY, [expectedEnvironment]);
  } catch {
    reject('MARKER_INITIALIZATION_FAILED');
  }

  return requireExactNonProductionDatabaseEnvironment(
    queryable,
    expectedEnvironment,
  );
}

/**
 * Creates the operational non-Production marker only when the catalog proves
 * the database is empty. Re-running against the same exact marker is a no-op;
 * a conflicting marker or any unmarked user object is always rejected.
 */
export async function initializeNonProductionDatabaseMarker(
  queryable: DatabaseQueryable,
  expectedEnvironment: DevelopmentDatabaseEnvironment,
  options: MarkerInitializationOptions = {},
): Promise<DevelopmentDatabaseEnvironment> {
  if (options.transaction === 'existing') {
    return initializeMarkerInsideTransaction(queryable, expectedEnvironment);
  }

  let transactionOpen = false;
  try {
    await queryable.query('BEGIN');
    transactionOpen = true;
    const environment = await initializeMarkerInsideTransaction(
      queryable,
      expectedEnvironment,
    );
    await queryable.query('COMMIT');
    transactionOpen = false;
    return environment;
  } catch (error) {
    if (transactionOpen) {
      await queryable.query('ROLLBACK').catch(() => undefined);
    }
    if (error instanceof NonProductionDatabaseGuardError) {
      throw error;
    }
    reject('MARKER_INITIALIZATION_FAILED');
  }
}
