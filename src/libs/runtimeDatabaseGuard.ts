import 'server-only';

import { createHash } from 'node:crypto';

import {
  resolveRuntimeEnvironment,
  type RuntimeEnvironment,
} from './environmentIsolation';
import {
  type DatabaseQueryable,
  type DevelopmentDatabaseEnvironment,
  NonProductionDatabaseGuardError,
  type NonProductionDatabaseGuardErrorCode,
  rejectNonProductionMarkerForProduction,
  requireExactNonProductionDatabaseEnvironment,
  requireNonProductionDatabaseTarget,
  requirePostgresDatabaseTarget,
} from './nonProductionDatabaseGuard';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

export type RuntimeDatabaseGuardErrorCode =
  | 'CACHED_DATABASE_TARGET_MISMATCH'
  | 'CI_REMOTE_DATABASE_FORBIDDEN'
  | 'DATABASE_ATTESTATION_REJECTED'
  | 'DATABASE_UNAVAILABLE'
  | 'DATABASE_URL_REJECTED'
  | 'HOSTED_DATABASE_REQUIRED'
  | 'RUNTIME_ENVIRONMENT_AMBIGUOUS';

const ERROR_MESSAGES: Record<RuntimeDatabaseGuardErrorCode, string> = {
  CACHED_DATABASE_TARGET_MISMATCH:
    'Runtime database rejected: the cached pool belongs to a different target.',
  CI_REMOTE_DATABASE_FORBIDDEN:
    'Runtime database rejected: CI may use only an approved loopback PostgreSQL target.',
  DATABASE_ATTESTATION_REJECTED:
    'Runtime database rejected: live environment attestation failed.',
  DATABASE_UNAVAILABLE:
    'Runtime database rejected: the database is temporarily unavailable.',
  DATABASE_URL_REJECTED:
    'Runtime database rejected: DATABASE_URL is not an approved PostgreSQL target.',
  HOSTED_DATABASE_REQUIRED:
    'Runtime database rejected: hosted Preview and Production require DATABASE_URL.',
  RUNTIME_ENVIRONMENT_AMBIGUOUS:
    'Runtime database rejected: the application environment is ambiguous.',
};

// -----------------------------------------------------------------------------
// Classification (incident hotfix — see docs/adr for the full writeup).
//
// A failure during live attestation has exactly two distinct meanings, and
// collapsing them cost hours of misdirected diagnosis during a real Neon
// quota outage:
//
//   - SECURITY/INTEGRITY: the marker query ran and returned an answer that
//     proves the connected database is the WRONG one, or that identity can
//     never be established from what it returned (missing/duplicate marker
//     row, invalid marker value, missing marker table). This must stay
//     `DATABASE_ATTESTATION_REJECTED` and fail closed — a cooldown or retry
//     must never turn a wrong database into an accepted one.
//   - AVAILABILITY: the marker query itself could not be executed — quota
//     exhaustion (Postgres `53000`), connection refused, provider
//     suspension, timeout, or any other transient provider/network failure.
//     No identity claim was ever made, so this can never be reported as a
//     security/attestation mismatch. It is a distinct `DATABASE_UNAVAILABLE`
//     classification.
//
// `nonProductionDatabaseGuard.ts` already draws this exact line for us —
// `MARKER_QUERY_FAILED` / `PRODUCTION_MARKER_QUERY_FAILED` mean "could not
// read the marker", never "read a bad marker". This narrow lookup is the
// only piece that was missing; the rest of the vocabulary already existed.
// -----------------------------------------------------------------------------

const AVAILABILITY_MARKER_CODES = new Set<NonProductionDatabaseGuardErrorCode>([
  'MARKER_QUERY_FAILED',
  'PRODUCTION_MARKER_QUERY_FAILED',
]);

// nonProductionDatabaseGuard.ts throws MARKER_QUERY_FAILED / PRODUCTION_
// MARKER_QUERY_FAILED for ANY error that isn't the specific 42P01 "table
// missing" case — that includes a genuine connection/timeout/quota failure,
// but ALSO a permission error (42501), a missing-column error on a
// reachable-but-wrong database (42703), or any other Postgres error that
// only happens once a real connection to a real server reached the query
// layer. Those are not availability — they are evidence the database IS
// reachable, just wrong or misconfigured, which is exactly the
// misclassification harm this hotfix exists to fix, just inverted. So the
// "_QUERY_FAILED" code alone is not enough: only an underlying failure whose
// own code is a recognized connection/timeout/quota-class code (or one that
// carries no code at all — the shape a raw network/DNS failure takes, never
// having reached Postgres's protocol layer to receive a SQLSTATE) may
// classify as availability. Anything else — including a code we don't
// recognize — fails closed as attestation-rejected. Never widen this set to
// "every non-42P01 code"; that is the bug being fixed here.
const AVAILABILITY_CONNECTION_CODES = new Set<string>([
  // Postgres SQLSTATE class 53 — Insufficient Resources. 53000 is the exact
  // "exceeded the compute time quota" error from the incident this fixes.
  '53000',
  '53100',
  '53200',
  '53300',
  '53400',
  // Postgres SQLSTATE class 08 — Connection Exception.
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  // Postgres 57P03 — cannot_connect_now (server starting up/shutting down;
  // what a suspended, waking Neon compute can surface).
  '57P03',
  // Postgres 57014 — query_canceled. A statement timeout on a trivial marker
  // query means the server was unresponsive, not that the query was wrong.
  '57014',
  // Node.js network/DNS-layer errors — never reached Postgres at all.
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNRESET',
  'EPIPE',
  'EAI_AGAIN',
]);

function underlyingErrorCode(cause: unknown): string | undefined {
  if (typeof cause !== 'object' || cause === null) {
    return undefined;
  }
  const code = (cause as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Classifies a failure raised while attesting a connection. Never inspects or
 * forwards the underlying error's message — only typed codes — so a
 * provider's raw error text (which can carry connection metadata) never
 * reaches a caller.
 */
function classifyAttestationFailure(error: unknown): RuntimeDatabaseGuardErrorCode {
  if (
    error instanceof NonProductionDatabaseGuardError
    && AVAILABILITY_MARKER_CODES.has(error.code)
  ) {
    const underlyingCode = underlyingErrorCode(error.cause);
    if (underlyingCode === undefined || AVAILABILITY_CONNECTION_CODES.has(underlyingCode)) {
      return 'DATABASE_UNAVAILABLE';
    }
    // A recognized-but-different code (42501, 42703, ...) reached a real
    // server — fail closed rather than guess.
  }
  return 'DATABASE_ATTESTATION_REJECTED';
}

export class RuntimeDatabaseGuardError extends Error {
  readonly code: RuntimeDatabaseGuardErrorCode;

  constructor(code: RuntimeDatabaseGuardErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'RuntimeDatabaseGuardError';
    this.code = code;
  }
}

type Environment = Readonly<Record<string, string | undefined>>;
type ResolvedRuntimeEnvironment = Exclude<RuntimeEnvironment, 'unknown'>;

export type RuntimePostgresTarget = {
  connectionString: string;
  environment: ResolvedRuntimeEnvironment;
  fingerprint: string;
  host: string;
};

export type RuntimePoolVerifier = (
  client: DatabaseQueryable,
  callback: (error?: Error) => void,
) => void;

function reject(code: RuntimeDatabaseGuardErrorCode): never {
  throw new RuntimeDatabaseGuardError(code);
}

function fingerprintTarget(
  environment: ResolvedRuntimeEnvironment,
  connectionString: string,
): string {
  return createHash('sha256')
    .update(environment)
    .update('\0')
    .update(connectionString)
    .digest('hex');
}

function requiredPostgresTarget(
  environment: Environment,
  runtimeEnvironment: ResolvedRuntimeEnvironment,
  nonProduction: boolean,
): RuntimePostgresTarget {
  try {
    const target = nonProduction
      ? requireNonProductionDatabaseTarget(environment)
      : requirePostgresDatabaseTarget(environment);
    return {
      ...target,
      environment: runtimeEnvironment,
      fingerprint: fingerprintTarget(
        runtimeEnvironment,
        target.connectionString,
      ),
    };
  } catch {
    reject('DATABASE_URL_REJECTED');
  }
}

/**
 * Selects PGlite only for explicit local/test/CI environments. Any configured
 * PostgreSQL target is validated before a Pool can be constructed.
 */
export function requireRuntimeDatabaseTarget(
  environment: Environment = process.env,
): RuntimePostgresTarget | null {
  let runtimeEnvironment: RuntimeEnvironment;
  try {
    runtimeEnvironment = resolveRuntimeEnvironment(environment);
  } catch {
    reject('RUNTIME_ENVIRONMENT_AMBIGUOUS');
  }
  const hasDatabaseUrl = Boolean(environment.DATABASE_URL);

  if (runtimeEnvironment === 'unknown') {
    reject('RUNTIME_ENVIRONMENT_AMBIGUOUS');
  }

  if (!hasDatabaseUrl) {
    if (
      runtimeEnvironment === 'preview'
      || runtimeEnvironment === 'production'
    ) {
      reject('HOSTED_DATABASE_REQUIRED');
    }
    return null;
  }

  if (
    runtimeEnvironment === 'development'
    || runtimeEnvironment === 'preview'
  ) {
    return requiredPostgresTarget(environment, runtimeEnvironment, true);
  }

  const target = requiredPostgresTarget(
    environment,
    runtimeEnvironment,
    false,
  );
  if (
    (runtimeEnvironment === 'ci' || runtimeEnvironment === 'test')
    && !LOOPBACK_HOSTS.has(target.host)
  ) {
    reject('CI_REMOTE_DATABASE_FORBIDDEN');
  }
  return target;
}

/** Attests a connected client before the pool may lease it to application code. */
export async function verifyRuntimeDatabaseConnection(
  queryable: DatabaseQueryable,
  target: RuntimePostgresTarget,
): Promise<void> {
  if (
    target.environment === 'development'
    || target.environment === 'preview'
  ) {
    try {
      await requireExactNonProductionDatabaseEnvironment(
        queryable,
        target.environment as DevelopmentDatabaseEnvironment,
      );
      return;
    } catch (error) {
      reject(classifyAttestationFailure(error));
    }
  }

  if (target.environment === 'production') {
    try {
      await rejectNonProductionMarkerForProduction(queryable);
      return;
    } catch (error) {
      reject(classifyAttestationFailure(error));
    }
  }

  // CI/test targets are already restricted to loopback by static policy —
  // there is no marker/identity claim left to verify here, only whether the
  // connection is live. Any failure is therefore always availability, never
  // a security mismatch.
  try {
    await queryable.query('SELECT 1');
  } catch {
    reject('DATABASE_UNAVAILABLE');
  }
}

/** pg-pool invokes this for every newly connected client before first use. */
export function createRuntimeDatabasePoolVerifier(
  target: RuntimePostgresTarget,
): RuntimePoolVerifier {
  return (client, callback) => {
    void verifyRuntimeDatabaseConnection(client, target).then(
      () => callback(),
      error => callback(
        error instanceof RuntimeDatabaseGuardError
          ? error
          // Defensive fallback only — verifyRuntimeDatabaseConnection above
          // always rejects with a RuntimeDatabaseGuardError. Never let an
          // unrecognized failure be reported as ready.
          : new RuntimeDatabaseGuardError('DATABASE_ATTESTATION_REJECTED'),
      ),
    );
  };
}

export function requireMatchingCachedDatabaseTarget(
  cachedFingerprint: string | undefined,
  target: RuntimePostgresTarget,
): void {
  if (cachedFingerprint !== target.fingerprint) {
    reject('CACHED_DATABASE_TARGET_MISMATCH');
  }
}
