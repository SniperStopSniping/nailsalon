import { execFileSync } from 'node:child_process';
import { isIP } from 'node:net';

import type { Client, QueryResultRow } from 'pg';

export const DISPOSABLE_DATABASE_MARKER = 'LUSTER_DISPOSABLE_DATABASE';
export const DISPOSABLE_DATABASE_NAME = 'luster_e2e_ci_disposable';
export const DISPOSABLE_DATABASE_USER = 'luster_e2e_ci';
export const DISPOSABLE_DATABASE_APPLICATION_NAME = 'luster-e2e-ci-disposable';
export const DISPOSABLE_DATABASE_PORT = 55432;

const SERVICE_CONTAINER_ID_ENV = 'LUSTER_DISPOSABLE_POSTGRES_CONTAINER_ID';
const SERVICE_CONTAINER_NETWORK_ENV = 'LUSTER_DISPOSABLE_POSTGRES_NETWORK';
const POSTGRESQL_SERVER_PORT = 5432;
const APPROVED_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
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
const PRODUCTION_LIKE_IDENTIFIER
  = /(?:^|[_-])(?:main|primary|prod|production|live)(?:$|[_-])/i;

type DisposableDatabaseErrorCode =
  | 'APPLICATION_MISSING'
  | 'APPLICATION_WRONG'
  | 'CONTAINER_EVIDENCE_INVALID'
  | 'CONTAINER_INSPECTION_FAILED'
  | 'DATABASE_MISSING'
  | 'DATABASE_PRODUCTION_LIKE'
  | 'DATABASE_WRONG'
  | 'FRAGMENT_FORBIDDEN'
  | 'HOSTED_PROVIDER_FORBIDDEN'
  | 'LIVE_APPLICATION_MISMATCH'
  | 'LIVE_DATABASE_MISMATCH'
  | 'LIVE_QUERY_FAILED'
  | 'LIVE_SERVER_ADDRESS_MISMATCH'
  | 'LIVE_SERVER_PORT_MISMATCH'
  | 'LIVE_USER_MISMATCH'
  | 'LOOPBACK_FORM_UNSUPPORTED'
  | 'MALFORMED_URL'
  | 'MARKER_REQUIRED'
  | 'PASSWORD_REQUIRED'
  | 'PORT_WRONG'
  | 'PRIVATE_REMOTE_IP_FORBIDDEN'
  | 'PROTOCOL_WRONG'
  | 'PUBLIC_REMOTE_IP_FORBIDDEN'
  | 'REMOTE_HOST_FORBIDDEN'
  | 'UNEXPECTED_QUERY_PARAMETER'
  | 'URL_REQUIRED'
  | 'USER_PRODUCTION_LIKE'
  | 'USER_WRONG';

const ERROR_MESSAGES: Record<DisposableDatabaseErrorCode, string> = {
  APPLICATION_MISSING:
    'Disposable database target rejected: the required application name is missing.',
  APPLICATION_WRONG:
    'Disposable database target rejected: the application name is not the approved CI value.',
  CONTAINER_EVIDENCE_INVALID:
    'Disposable database target rejected: service-container identity evidence is incomplete or invalid.',
  CONTAINER_INSPECTION_FAILED:
    'Disposable database target rejected: the local PostgreSQL service container could not be attested.',
  DATABASE_MISSING:
    'Disposable database target rejected: the database name is missing.',
  DATABASE_PRODUCTION_LIKE:
    'Disposable database target rejected: Production-like database names are forbidden.',
  DATABASE_WRONG:
    'Disposable database target rejected: the database name is not the approved CI value.',
  FRAGMENT_FORBIDDEN:
    'Disposable database target rejected: URL fragments are forbidden.',
  HOSTED_PROVIDER_FORBIDDEN:
    'Disposable database target rejected: hosted database providers are forbidden.',
  LIVE_APPLICATION_MISMATCH:
    'Disposable database session rejected: the live application name does not match.',
  LIVE_DATABASE_MISMATCH:
    'Disposable database session rejected: the live database name does not match.',
  LIVE_QUERY_FAILED:
    'Disposable database session rejected: live session attestation could not be completed.',
  LIVE_SERVER_ADDRESS_MISMATCH:
    'Disposable database session rejected: the live server address is not the attested local target.',
  LIVE_SERVER_PORT_MISMATCH:
    'Disposable database session rejected: the live server port does not match.',
  LIVE_USER_MISMATCH:
    'Disposable database session rejected: the live database user does not match.',
  LOOPBACK_FORM_UNSUPPORTED:
    'Disposable database target rejected: this loopback URL form is not supported safely by the database driver.',
  MALFORMED_URL:
    'Disposable database target rejected: DATABASE_URL is malformed.',
  MARKER_REQUIRED:
    `Disposable database target rejected: ${DISPOSABLE_DATABASE_MARKER}=true is required.`,
  PASSWORD_REQUIRED:
    'Disposable database target rejected: an explicit job-local password is required.',
  PORT_WRONG:
    'Disposable database target rejected: the port is not the approved CI value.',
  PRIVATE_REMOTE_IP_FORBIDDEN:
    'Disposable database target rejected: private-network remote addresses are forbidden.',
  PROTOCOL_WRONG:
    'Disposable database target rejected: only the PostgreSQL protocol is allowed.',
  PUBLIC_REMOTE_IP_FORBIDDEN:
    'Disposable database target rejected: public remote addresses are forbidden.',
  REMOTE_HOST_FORBIDDEN:
    'Disposable database target rejected: remote hostnames are forbidden.',
  UNEXPECTED_QUERY_PARAMETER:
    'Disposable database target rejected: unexpected or duplicate URL parameters are forbidden.',
  URL_REQUIRED:
    'Disposable database target rejected: DATABASE_URL is required.',
  USER_PRODUCTION_LIKE:
    'Disposable database target rejected: Production-like database roles are forbidden.',
  USER_WRONG:
    'Disposable database target rejected: the database user is not the approved CI value.',
};

export class DisposableDatabaseTargetError extends Error {
  readonly code: DisposableDatabaseErrorCode;

  constructor(code: DisposableDatabaseErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'DisposableDatabaseTargetError';
    this.code = code;
  }
}

type Environment = Record<string, string | undefined>;

type ServiceContainerEvidence = {
  containerId: string;
  network: string;
};

export type DisposableDatabaseTarget = {
  applicationName: typeof DISPOSABLE_DATABASE_APPLICATION_NAME;
  connectionString: string;
  databaseName: typeof DISPOSABLE_DATABASE_NAME;
  databaseUser: typeof DISPOSABLE_DATABASE_USER;
  host: '127.0.0.1' | 'localhost';
  port: typeof DISPOSABLE_DATABASE_PORT;
  serviceContainer: ServiceContainerEvidence | null;
};

export type DisposableDatabaseServerExpectation = {
  addresses: readonly string[];
  port: number;
};

export type DisposableDatabaseSession = {
  applicationName: string | null;
  databaseName: string | null;
  databaseUser: string | null;
  serverAddress: string | null;
  serverPort: number | string | null;
};

function reject(code: DisposableDatabaseErrorCode): never {
  throw new DisposableDatabaseTargetError(code);
}

function decodeUrlValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    reject('MALFORMED_URL');
  }
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

function isPrivateNetworkAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number);
    const [first, second] = octets;
    if (first === undefined || second === undefined) {
      return false;
    }
    return first === 10
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168);
  }

  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized);
  }

  return false;
}

function validateServiceContainerEvidence(
  environment: Environment,
): ServiceContainerEvidence | null {
  const containerId = environment[SERVICE_CONTAINER_ID_ENV];
  const network = environment[SERVICE_CONTAINER_NETWORK_ENV];

  if (!containerId && !network) {
    return null;
  }
  if (
    !containerId
    || !network
    || !/^[a-f0-9]{12,64}$/i.test(containerId)
    || !/^[\w.-]{1,128}$/.test(network)
  ) {
    reject('CONTAINER_EVIDENCE_INVALID');
  }

  return { containerId, network };
}

/**
 * Statically validates the only target that CI mutation commands may use.
 *
 * The explicit marker proves intent, but never relaxes any URL restriction.
 * In particular, a true marker cannot make a hosted or private-network target
 * safe. Query parameters are deliberately limited because node-postgres accepts
 * parameters that can override the URL host, user, and database.
 */
export function requireDisposableDatabaseTarget(
  environment: Environment = process.env,
): DisposableDatabaseTarget {
  if (environment[DISPOSABLE_DATABASE_MARKER] !== 'true') {
    reject('MARKER_REQUIRED');
  }

  const connectionString = environment.DATABASE_URL;
  if (!connectionString) {
    reject('URL_REQUIRED');
  }
  if (connectionString !== connectionString.trim()) {
    reject('MALFORMED_URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    reject('MALFORMED_URL');
  }

  if (parsed.protocol !== 'postgresql:') {
    reject('PROTOCOL_WRONG');
  }
  if (parsed.hash) {
    reject('FRAGMENT_FORBIDDEN');
  }

  const host = normalizeUrlHost(parsed.hostname);
  if (isHostedProviderHostname(host)) {
    reject('HOSTED_PROVIDER_FORBIDDEN');
  }
  if (host === '::1') {
    reject('LOOPBACK_FORM_UNSUPPORTED');
  }
  if (!APPROVED_LOOPBACK_HOSTS.has(host)) {
    if (isIP(host)) {
      reject(
        isPrivateNetworkAddress(host)
          ? 'PRIVATE_REMOTE_IP_FORBIDDEN'
          : 'PUBLIC_REMOTE_IP_FORBIDDEN',
      );
    }
    reject('REMOTE_HOST_FORBIDDEN');
  }

  if (parsed.port !== String(DISPOSABLE_DATABASE_PORT)) {
    reject('PORT_WRONG');
  }
  if (!parsed.password) {
    reject('PASSWORD_REQUIRED');
  }

  const databaseUser = decodeUrlValue(parsed.username);
  if (PRODUCTION_LIKE_IDENTIFIER.test(databaseUser)) {
    reject('USER_PRODUCTION_LIKE');
  }
  if (databaseUser !== DISPOSABLE_DATABASE_USER) {
    reject('USER_WRONG');
  }

  const encodedDatabaseName = parsed.pathname.startsWith('/')
    ? parsed.pathname.slice(1)
    : '';
  const databaseName = decodeUrlValue(encodedDatabaseName);
  if (!databaseName || databaseName.includes('/')) {
    reject('DATABASE_MISSING');
  }
  if (PRODUCTION_LIKE_IDENTIFIER.test(databaseName)) {
    reject('DATABASE_PRODUCTION_LIKE');
  }
  if (databaseName !== DISPOSABLE_DATABASE_NAME) {
    reject('DATABASE_WRONG');
  }

  const applicationNames = parsed.searchParams.getAll('application_name');
  if (applicationNames.length === 0) {
    reject('APPLICATION_MISSING');
  }
  const queryEntries = [...parsed.searchParams.entries()];
  if (
    queryEntries.length !== 1
    || queryEntries[0]?.[0] !== 'application_name'
    || applicationNames.length !== 1
  ) {
    reject('UNEXPECTED_QUERY_PARAMETER');
  }
  if (applicationNames[0] !== DISPOSABLE_DATABASE_APPLICATION_NAME) {
    reject('APPLICATION_WRONG');
  }

  return {
    applicationName: DISPOSABLE_DATABASE_APPLICATION_NAME,
    connectionString,
    databaseName: DISPOSABLE_DATABASE_NAME,
    databaseUser: DISPOSABLE_DATABASE_USER,
    host: host as DisposableDatabaseTarget['host'],
    port: DISPOSABLE_DATABASE_PORT,
    serviceContainer: validateServiceContainerEvidence(environment),
  };
}

type DockerPortBinding = {
  HostIp?: unknown;
  HostPort?: unknown;
};

function inspectServiceContainer(
  evidence: ServiceContainerEvidence,
): DisposableDatabaseServerExpectation {
  try {
    const image = execFileSync(
      'docker',
      ['inspect', '--format', '{{.Config.Image}}', evidence.containerId],
      { encoding: 'utf8', timeout: 10_000 },
    ).trim();
    if (image !== 'postgres:16-alpine') {
      reject('CONTAINER_INSPECTION_FAILED');
    }

    const portJson = execFileSync(
      'docker',
      ['inspect', '--format', '{{json .NetworkSettings.Ports}}', evidence.containerId],
      { encoding: 'utf8', timeout: 10_000 },
    ).trim();
    const ports = JSON.parse(portJson) as Record<string, DockerPortBinding[] | null>;
    const bindings = ports[`${POSTGRESQL_SERVER_PORT}/tcp`];
    if (
      !bindings
      || bindings.length !== 1
      || bindings[0]?.HostIp !== '127.0.0.1'
      || bindings[0].HostPort !== String(DISPOSABLE_DATABASE_PORT)
    ) {
      reject('CONTAINER_INSPECTION_FAILED');
    }

    const addressTemplate
      = `{{(index .NetworkSettings.Networks "${evidence.network}").IPAddress}}`;
    const serverAddress = execFileSync(
      'docker',
      ['inspect', '--format', addressTemplate, evidence.containerId],
      { encoding: 'utf8', timeout: 10_000 },
    ).trim();
    if (
      !isIP(serverAddress)
      || (
        !APPROVED_LOOPBACK_HOSTS.has(serverAddress)
        && !isPrivateNetworkAddress(serverAddress)
      )
    ) {
      reject('CONTAINER_INSPECTION_FAILED');
    }

    return {
      addresses: [serverAddress],
      port: POSTGRESQL_SERVER_PORT,
    };
  } catch (error) {
    if (error instanceof DisposableDatabaseTargetError) {
      throw error;
    }
    reject('CONTAINER_INSPECTION_FAILED');
  }
}

/**
 * Resolves the address PostgreSQL itself must report.
 *
 * A GitHub service is reached through a loopback-only Docker port mapping, but
 * PostgreSQL sees its own bridge address. That address is accepted only when it
 * comes from the exact PostgreSQL 16 service container and network managed for
 * this job; arbitrary private addresses are never accepted.
 */
export function resolveDisposableDatabaseServerExpectation(
  target: DisposableDatabaseTarget,
): DisposableDatabaseServerExpectation {
  if (target.serviceContainer) {
    return inspectServiceContainer(target.serviceContainer);
  }

  return {
    addresses: target.host === 'localhost'
      ? ['127.0.0.1', '::1']
      : [target.host],
    port: DISPOSABLE_DATABASE_PORT,
  };
}

export function assertDisposableDatabaseSession(
  target: DisposableDatabaseTarget,
  expectedServer: DisposableDatabaseServerExpectation,
  session: DisposableDatabaseSession,
): void {
  if (session.databaseName !== target.databaseName) {
    reject('LIVE_DATABASE_MISMATCH');
  }
  if (session.databaseUser !== target.databaseUser) {
    reject('LIVE_USER_MISMATCH');
  }
  if (
    !session.serverAddress
    || !expectedServer.addresses.includes(session.serverAddress)
  ) {
    reject('LIVE_SERVER_ADDRESS_MISMATCH');
  }
  if (Number(session.serverPort) !== expectedServer.port) {
    reject('LIVE_SERVER_PORT_MISMATCH');
  }
  if (session.applicationName !== target.applicationName) {
    reject('LIVE_APPLICATION_MISMATCH');
  }
}

type DisposableSessionRow = QueryResultRow & {
  application_name: string | null;
  database_name: string | null;
  database_user: string | null;
  server_address: string | null;
  server_port: number | null;
};

/**
 * Live attestation prevents DNS, driver parsing, proxying, or configuration
 * drift from turning a statically safe-looking URL into a different session.
 * It must complete before migrations or fixture mutations begin.
 */
export async function attestDisposableDatabaseSession(
  client: Pick<Client, 'query'>,
  target: DisposableDatabaseTarget,
  expectedServer: DisposableDatabaseServerExpectation,
): Promise<void> {
  let row: DisposableSessionRow | undefined;
  try {
    const result = await client.query<DisposableSessionRow>(`
      SELECT
        current_database() AS database_name,
        current_user AS database_user,
        host(inet_server_addr()) AS server_address,
        inet_server_port() AS server_port,
        current_setting('application_name', true) AS application_name
    `);
    row = result.rows[0];
  } catch {
    reject('LIVE_QUERY_FAILED');
  }

  if (!row) {
    reject('LIVE_QUERY_FAILED');
  }

  assertDisposableDatabaseSession(target, expectedServer, {
    applicationName: row.application_name,
    databaseName: row.database_name,
    databaseUser: row.database_user,
    serverAddress: row.server_address,
    serverPort: row.server_port,
  });
}
