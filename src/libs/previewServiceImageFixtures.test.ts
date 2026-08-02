import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Socket } from 'node:net';
import path from 'node:path';
import { TLSSocket } from 'node:tls';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { vi } from 'vitest';

import { PREVIEW_SERVICE_IMAGE_FIXTURE as FIXTURE } from '../../scripts/fixtures/preview-service-image-fixtures';
import {
  PREVIEW_FIXTURE_TLS_ATTESTATIONS,
  PREVIEW_FIXTURE_TLS_TEST_ONLY,
  type PreviewFixtureTlsAttestation,
  type PreviewFixtureTlsEvidence,
} from '../../scripts/preview-fixture-tls-attestation';
import {
  normalizeIncomingForeignKeyEdge,
  PreviewFixtureError,
  runPreviewServiceImageFixture,
} from '../../scripts/preview-service-image-fixtures';
import { getFeaturedServices } from './bookingMerchandising';

type FixtureDatabase = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};
const pgHarness = vi.hoisted(() => ({ database: null as unknown, connections: 0 }));
const tlsHarness = vi.hoisted(() => ({
  attestation: 'client TLS verified; backend TLS visible' as PreviewFixtureTlsAttestation | null,
}));
vi.mock('../../scripts/preview-fixture-tls-attestation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../scripts/preview-fixture-tls-attestation')>();

  return {
    ...actual,
    createPreviewFixtureTlsBoundary: (expectedHost: string) => {
      const boundary = actual.createPreviewFixtureTlsBoundary(expectedHost);

      return Object.freeze({ ...boundary, attest: vi.fn(() => tlsHarness.attestation) });
    },
  };
});
vi.mock('pg', () => ({
  Client: class {
    async connect() {
      pgHarness.connections += 1;
      if (!pgHarness.database) {
        throw new Error('Missing local test database.');
      }
    }

    async query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) {
      return (pgHarness.database as FixtureDatabase).query<T>(text, values);
    }

    async end() {}
  },
}));

const SYNTHETIC_HOST = 'ep-fixture-direct.us-east-2.aws.neon.tech';
const SYNTHETIC_ROLE = 'preview_fixture_runtime';
const SYNTHETIC_PASSWORD = ['synthetic', 'placeholder', 'not', 'secret'].join('-');
const SYNTHETIC_CLERK_ID = ['user', 'SyntheticDevelopmentFixture0001'].join('_');

function fixtureEnvironment(overrides: Record<string, string | undefined> = {}) {
  const target = new URL('postgresql://placeholder.invalid');
  target.username = SYNTHETIC_ROLE;
  target.password = SYNTHETIC_PASSWORD;
  target.hostname = SYNTHETIC_HOST;
  target.port = '5432';
  target.pathname = '/luster_preview';
  target.searchParams.set('sslmode', 'require');
  const fingerprint = createHash('sha256')
    .update(`${SYNTHETIC_HOST}|5432|${SYNTHETIC_ROLE}|luster_preview`)
    .digest('hex');
  return {
    DATABASE_URL: target.toString(),
    LUSTER_PREVIEW_FIXTURE_ENV: 'preview',
    LUSTER_PREVIEW_EXPECTED_DATABASE: 'luster_preview',
    LUSTER_PREVIEW_EXPECTED_HOST: SYNTHETIC_HOST,
    LUSTER_PREVIEW_EXPECTED_SSL_MODE: 'require',
    LUSTER_PREVIEW_CONNECTION_MODE: 'direct',
    LUSTER_PREVIEW_APPLICATION_NAME: 'luster-preview-service-image-fixtures-v1',
    LUSTER_PREVIEW_FIXTURE_VERSION: 'service-images-v1',
    LUSTER_PREVIEW_FIXTURE_CONFIRM: 'CREATE_SYNTHETIC_PREVIEW_FIXTURES',
    LUSTER_PREVIEW_FIXTURE_RESET_CONFIRM: 'DELETE_SYNTHETIC_PREVIEW_FIXTURES',
    LUSTER_PREVIEW_TARGET_FINGERPRINT: fingerprint,
    ...overrides,
  };
}

class AttestedPGlite implements FixtureDatabase {
  readonly boundValues: unknown[] = [];
  readonly queries: string[] = [];
  readonly writes: string[] = [];
  failure: { pattern: RegExp; error: unknown } | null = null;
  foreignKeyRowsTransform: ((rows: Array<Record<string, unknown>>) => Array<Record<string, unknown>>) | null = null;
  session: Record<string, unknown> = {};
  transaction: Record<string, unknown> = {};
  hideIncomingReferences = false;
  lockChecks = 0;
  private mutationLockHeld = false;
  private readOnly = false;

  constructor(readonly client: PGlite) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    this.boundValues.push(...values);
    this.queries.push(text);
    if (text.includes('preview-fixture-session') || text.includes('preview-fixture-connection')) {
      return { rows: [{
        database_name: 'luster_preview',
        database_user: SYNTHETIC_ROLE,
        application_name: 'luster-preview-service-image-fixtures-v1',
        backend_tls: true,
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolbypassrls: false,
        rolcanlogin: true,
        ...this.session,
      } as unknown as T] };
    }
    if (text.includes('preview-fixture-transaction')) {
      return { rows: [{ isolation: 'serializable', read_only: this.readOnly ? 'on' : 'off', search_path: 'pg_catalog, public', row_security: 'off', ...this.transaction } as unknown as T] };
    }
    if (/^BEGIN ISOLATION LEVEL SERIALIZABLE/i.test(text)) {
      this.readOnly = text.includes('READ ONLY');
      this.mutationLockHeld = false;
      const result = await this.client.query('BEGIN');
      return { rows: result.rows as T[] };
    }
    if (/^(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(text.trim())) {
      this.writes.push(text);
    }
    if (this.failure?.pattern.test(text)) {
      throw this.failure.error;
    }
    if (this.hideIncomingReferences && text.includes('pg_catalog.pg_constraint')) {
      return { rows: [] };
    }
    if (!this.readOnly && text.includes('preview-fixture-incoming-foreign-keys')) {
      if (!this.mutationLockHeld) {
        throw new Error('Mutation catalog discovery was not protected by relation locks.');
      }
      this.lockChecks += 1;
    }
    const result = await this.client.query(text, values);
    if (text.includes('preview-fixture-relation-lock')) {
      this.mutationLockHeld = true;
    }
    if (/^(?:COMMIT|ROLLBACK)$/i.test(text.trim())) {
      this.mutationLockHeld = false;
    }
    if (this.foreignKeyRowsTransform && text.includes('preview-fixture-incoming-foreign-keys')) {
      return { rows: this.foreignKeyRowsTransform(result.rows as Array<Record<string, unknown>>) as T[] };
    }
    return { rows: result.rows as T[] };
  }
}

async function migratedDatabase() {
  const client = new PGlite();
  await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), 'migrations') });
  return { client, database: new AttestedPGlite(client) };
}

async function countRows(client: PGlite, text: string, values: unknown[] = []) {
  const result = await client.query<{ count: string }>(text, values);

  return Number(result.rows[0]!.count);
}

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error('Expected Preview fixture refusal.');
  } catch (error) {
    expect(error).toBeInstanceOf(PreviewFixtureError);
    expect((error as PreviewFixtureError).code).toBe(code);

    return error as PreviewFixtureError;
  }
}

function runFixture(command: string, environment: Record<string, string | undefined>, database: FixtureDatabase, log?: (message: string) => void) {
  pgHarness.database = database;

  return runPreviewServiceImageFixture(command, environment, log);
}

afterEach(() => {
  tlsHarness.attestation = PREVIEW_FIXTURE_TLS_ATTESTATIONS.backendVisible;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Preview fixture client TLS attestation', () => {
  const evaluateTlsEvidence = (evidence: Partial<PreviewFixtureTlsEvidence> | null | undefined) => {
    expect(PREVIEW_FIXTURE_TLS_TEST_ONLY).not.toBeNull();

    return PREVIEW_FIXTURE_TLS_TEST_ONLY!.evaluateEvidence(evidence);
  };
  const verifiedEvidence: PreviewFixtureTlsEvidence = {
    transportKind: 'node-tls-socket',
    connected: true,
    encrypted: true,
    authorized: true,
    authorizationErrorPresent: false,
    peerCertificatePresent: true,
    peerIdentityVerified: true,
    protocol: 'TLSv1.3',
    cipherPresent: true,
    handshakeFinished: true,
    peerHandshakeFinished: true,
    secureClientConfiguration: true,
    insecureEnvironment: false,
    backendTls: true,
  };

  it('distinguishes backend-visible TLS from verified TLS terminated upstream or hidden by routing', () => {
    expect(evaluateTlsEvidence(verifiedEvidence)).toBe(PREVIEW_FIXTURE_TLS_ATTESTATIONS.backendVisible);
    expect(evaluateTlsEvidence({ ...verifiedEvidence, backendTls: false })).toBe(PREVIEW_FIXTURE_TLS_ATTESTATIONS.backendTerminatedUpstream);
    expect(evaluateTlsEvidence({ ...verifiedEvidence, backendTls: null })).toBe(PREVIEW_FIXTURE_TLS_ATTESTATIONS.backendTerminatedUpstream);
  });

  it.each([
    ['missing evidence', null],
    ['unsupported transport', { ...verifiedEvidence, transportKind: 'unsupported' }],
    ['disconnected transport', { ...verifiedEvidence, connected: false }],
    ['unencrypted transport', { ...verifiedEvidence, encrypted: false }],
    ['unauthorized certificate', { ...verifiedEvidence, authorized: false }],
    ['authorization error', { ...verifiedEvidence, authorizationErrorPresent: true }],
    ['missing peer certificate', { ...verifiedEvidence, peerCertificatePresent: false }],
    ['unverified peer identity', { ...verifiedEvidence, peerIdentityVerified: false }],
    ['unsupported TLS protocol', { ...verifiedEvidence, protocol: 'unsupported' }],
    ['missing cipher', { ...verifiedEvidence, cipherPresent: false }],
    ['unfinished local handshake', { ...verifiedEvidence, handshakeFinished: false }],
    ['unfinished peer handshake', { ...verifiedEvidence, peerHandshakeFinished: false }],
    ['insecure client configuration', { ...verifiedEvidence, secureClientConfiguration: false }],
    ['ambient certificate bypass', { ...verifiedEvidence, insecureEnvironment: true }],
    ['invalid backend evidence', { ...verifiedEvidence, backendTls: 'invalid' }],
    ['backend claim without client encryption', { ...verifiedEvidence, backendTls: true, encrypted: false }],
  ] as const)('rejects %s', (_name, evidence) => {
    expect(evaluateTlsEvidence(evidence)).toBeNull();
  });

  it('isolates the pg private-stream boundary and rejects duck objects, shape drift, and incomplete TLS sockets', async () => {
    const { createPreviewFixtureTlsBoundary: createActualBoundary } = await vi.importActual<typeof import('../../scripts/preview-fixture-tls-attestation')>('../../scripts/preview-fixture-tls-attestation');
    const boundary = createActualBoundary(SYNTHETIC_HOST);
    const ssl = boundary.clientConfiguration;
    const client = (stream: unknown, clientSsl: unknown = ssl) => ({ ssl: clientSsl, connection: { ssl: clientSsl, stream } }) as never;
    const secretBearingFailure = new Proxy({}, {
      get: () => {
        throw new Error(`private failure ${SYNTHETIC_PASSWORD} ${SYNTHETIC_HOST}`);
      },
    });
    const duck = { encrypted: true, authorized: true, authorizationError: null, connecting: false, destroyed: false, readyState: 'open', readable: true, writable: true };
    const prototypeSpoof = Object.create(TLSSocket.prototype);
    const incompleteSocket = new TLSSocket(new Socket());
    const accessorSsl = Object.create(null, {
      ca: { enumerable: true, get: () => ssl.ca },
      minVersion: { enumerable: true, get: () => 'TLSv1.2' },
      rejectUnauthorized: { enumerable: true, get: () => true },
      servername: { enumerable: true, get: () => SYNTHETIC_HOST },
    });
    try {
      expect(Object.isFrozen(boundary)).toBe(true);
      expect(Object.isFrozen(ssl)).toBe(true);
      expect(Object.isFrozen(ssl.ca)).toBe(true);
      expect(Reflect.ownKeys(ssl).sort()).toEqual(['ca', 'minVersion', 'rejectUnauthorized', 'servername']);
      expect(boundary.attest(client(new Socket()), true)).toBeNull();
      expect(boundary.attest(client(duck), true)).toBeNull();
      expect(boundary.attest(client(prototypeSpoof), true)).toBeNull();
      expect(boundary.attest(client(incompleteSocket), true)).toBeNull();
      expect(boundary.attest(secretBearingFailure as never, true)).toBeNull();
      expect(boundary.attest(client(incompleteSocket, { ...ssl }), true)).toBeNull();
      expect(boundary.attest(client(incompleteSocket, { ...ssl, rejectUnauthorized: false }), true)).toBeNull();
      expect(boundary.attest(client(incompleteSocket, { ...ssl, checkServerIdentity: () => undefined }), true)).toBeNull();
      expect(boundary.attest(client(incompleteSocket, accessorSsl), true)).toBeNull();
    } finally {
      incompleteSocket.destroy();
    }
  });

  it('rejects startup CA injection and uses only Node bundled roots in a fresh process', () => {
    const helperUrl = new URL('../../scripts/preview-fixture-tls-attestation.ts', import.meta.url).href;
    const probe = `
      import { rootCertificates } from 'node:tls';
      import helper from ${JSON.stringify(helperUrl)};
      const { createPreviewFixtureTlsBoundary, isPreviewFixtureTlsRuntimeEnvironmentSafe } = helper;
      const boundary = createPreviewFixtureTlsBoundary(${JSON.stringify(SYNTHETIC_HOST)});
      const ssl = boundary.clientConfiguration;
      const rootsMatch = ssl.ca.length === rootCertificates.length && ssl.ca.every((root, index) => root === rootCertificates[index]);
      if (isPreviewFixtureTlsRuntimeEnvironmentSafe(process.env) || !rootsMatch || !Object.isFrozen(ssl) || !Object.isFrozen(ssl.ca)) process.exit(1);
    `;
    const result = spawnSync(process.execPath, ['--import=tsx', '--input-type=module', '--eval', probe], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production', NODE_EXTRA_CA_CERTS: '/synthetic/untrusted/ca.pem' },
    });

    expect(result.status, result.stderr).toBe(0);
  });
});

describe('Preview service-image fixture FK normalization', () => {
  it('includes every required edge identity field and rejects unsupported actions', () => {
    const edge = { child_schema: 'public', child_table: 'child', constraint_name: 'child_parent_fkey', child_columns: ['parent_id'], parent_schema: 'public', parent_table: 'parent', parent_columns: ['id'], update_action: 'a', delete_action: 'a' };
    const variants = [
      { ...edge, child_schema: 'fixture_probe' },
      { ...edge, child_table: 'other_child' },
      { ...edge, constraint_name: 'other_constraint' },
      { ...edge, child_columns: ['other_parent_id'] },
      { ...edge, parent_schema: 'fixture_parent' },
      { ...edge, parent_table: 'other_parent' },
      { ...edge, parent_columns: ['slug'] },
      { ...edge, update_action: 'c' },
      { ...edge, update_action: 'r' },
      { ...edge, delete_action: 'n' },
      { ...edge, delete_action: 'd' },
    ];
    const identities = [edge, ...variants].map(normalizeIncomingForeignKeyEdge);

    expect(new Set(identities).size).toBe(identities.length);
    expect(normalizeIncomingForeignKeyEdge({ ...edge, update_action: 'r', delete_action: 'd' })).toContain('RESTRICT');
    expect(normalizeIncomingForeignKeyEdge({ ...edge, update_action: 'r', delete_action: 'd' })).toContain('SET DEFAULT');
    expect(() => normalizeIncomingForeignKeyEdge({ ...edge, delete_action: 'unknown' })).toThrowError(PreviewFixtureError);
  });
});

describe('Preview service-image fixture target contract', () => {
  const neverConnect: FixtureDatabase = {
    query: async () => {
      throw new Error('Static refusal unexpectedly queried a database.');
    },
  };

  it('rejects Production, missing confirmation, wrong database, ambiguous target, unsafe TLS, and invalid admin input without connecting', async () => {
    const connectionsBefore = pgHarness.connections;
    const production = await expectCode(runFixture('plan', fixtureEnvironment({ LUSTER_PREVIEW_FIXTURE_ENV: 'production' }), neverConnect), 'PRODUCTION_REJECTED');
    await expectCode(runFixture('plan', fixtureEnvironment({ APP_ENV: 'production' }), neverConnect), 'PRODUCTION_REJECTED');
    await expectCode(runFixture('plan', fixtureEnvironment({ LUSTER_PREVIEW_FIXTURE_CONFIRM: undefined }), neverConnect), 'CONFIRMATION_REJECTED');
    await expectCode(runFixture('reset', fixtureEnvironment({ LUSTER_PREVIEW_FIXTURE_RESET_CONFIRM: undefined }), neverConnect), 'CONFIRMATION_REJECTED');
    await expectCode(runFixture('plan', fixtureEnvironment({ LUSTER_PREVIEW_APPLICATION_NAME: undefined }), neverConnect), 'TARGET_REJECTED');
    await expectCode(runFixture('plan', fixtureEnvironment({ LUSTER_PREVIEW_CONNECTION_MODE: undefined }), neverConnect), 'TARGET_REJECTED');
    const wrongDatabase = fixtureEnvironment();
    wrongDatabase.DATABASE_URL = wrongDatabase.DATABASE_URL.replace('/luster_preview', '/neondb');
    await expectCode(runFixture('plan', wrongDatabase, neverConnect), 'TARGET_REJECTED');
    await expectCode(runFixture('plan', fixtureEnvironment({ LUSTER_PREVIEW_TARGET_FINGERPRINT: '0'.repeat(64) }), neverConnect), 'FINGERPRINT_REJECTED');
    const noTls = fixtureEnvironment();
    noTls.DATABASE_URL = noTls.DATABASE_URL.replace(/\?.*$/, '');
    await expectCode(runFixture('plan', noTls, neverConnect), 'TARGET_REJECTED');
    await expectCode(runFixture('plan', fixtureEnvironment({ LUSTER_PREVIEW_EXPECTED_HOST: 'other.preview.invalid' }), neverConnect), 'TARGET_REJECTED');
    const pooledHost = 'ep-fixture-direct-pooler.us-east-2.aws.neon.tech';
    const pooledTarget = fixtureEnvironment();
    pooledTarget.DATABASE_URL = pooledTarget.DATABASE_URL.replace(SYNTHETIC_HOST, pooledHost);
    pooledTarget.LUSTER_PREVIEW_EXPECTED_HOST = pooledHost;
    pooledTarget.LUSTER_PREVIEW_TARGET_FINGERPRINT = createHash('sha256').update(`${pooledHost}|5432|${SYNTHETIC_ROLE}|luster_preview`).digest('hex');
    await expectCode(runFixture('plan', pooledTarget, neverConnect), 'TARGET_REJECTED');
    const nonNeonHost = 'ep-fixture-direct.preview.invalid';
    const nonNeonTarget = fixtureEnvironment();
    nonNeonTarget.DATABASE_URL = nonNeonTarget.DATABASE_URL.replace(SYNTHETIC_HOST, nonNeonHost);
    nonNeonTarget.LUSTER_PREVIEW_EXPECTED_HOST = nonNeonHost;
    nonNeonTarget.LUSTER_PREVIEW_TARGET_FINGERPRINT = createHash('sha256').update(`${nonNeonHost}|5432|${SYNTHETIC_ROLE}|luster_preview`).digest('hex');
    await expectCode(runFixture('plan', nonNeonTarget, neverConnect), 'TARGET_REJECTED');
    const productionLikeHost = 'ep-prod-fixture.us-east-2.aws.neon.tech';
    const productionHost = fixtureEnvironment();
    productionHost.DATABASE_URL = productionHost.DATABASE_URL.replace(SYNTHETIC_HOST, productionLikeHost);
    productionHost.LUSTER_PREVIEW_EXPECTED_HOST = productionLikeHost;
    productionHost.LUSTER_PREVIEW_TARGET_FINGERPRINT = createHash('sha256').update(`${productionLikeHost}|5432|${SYNTHETIC_ROLE}|luster_preview`).digest('hex');
    await expectCode(runFixture('plan', productionHost, neverConnect), 'TARGET_REJECTED');
    await expectCode(runFixture('plan', fixtureEnvironment({ LUSTER_PREVIEW_EXPECTED_SSL_MODE: 'verify-full' }), neverConnect), 'TARGET_REJECTED');
    await expectCode(runFixture('plan', fixtureEnvironment({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }), neverConnect), 'SESSION_REJECTED');
    for (const key of ['NODE_EXTRA_CA_CERTS', 'NODE_USE_SYSTEM_CA', 'OPENSSL_CONF', 'SSL_CERT_DIR', 'SSL_CERT_FILE']) {
      await expectCode(runFixture('plan', fixtureEnvironment({ [key]: '/synthetic/untrusted/ca' }), neverConnect), 'SESSION_REJECTED');
    }
    for (const nodeOption of ['--use-openssl-ca', '"--use-openssl-ca"', '--use-"openssl"-ca', '--use-openssl-ca=true', '--use-system-ca=true', '--no-use-bundled-ca', '--openssl-config=/synthetic/openssl.cnf', '--openssl-shared-config']) {
      await expectCode(runFixture('plan', fixtureEnvironment({ NODE_OPTIONS: nodeOption }), neverConnect), 'SESSION_REJECTED');
    }
    process.execArgv.push('--no-use-bundled-ca');
    try {
      await expectCode(runFixture('plan', fixtureEnvironment(), neverConnect), 'SESSION_REJECTED');
    } finally {
      process.execArgv.pop();
    }
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
    await expectCode(runFixture('plan', fixtureEnvironment(), neverConnect), 'SESSION_REJECTED');
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_EXTRA_CA_CERTS', '/synthetic/untrusted/ca');
    await expectCode(runFixture('plan', fixtureEnvironment(), neverConnect), 'SESSION_REJECTED');
    vi.unstubAllEnvs();
    await expectCode(runFixture('plan', fixtureEnvironment({ LUSTER_PREVIEW_CLERK_USER_ID: 'user_short', LUSTER_PREVIEW_ADMIN_CONFIRM: 'MAP_SYNTHETIC_DEVELOPMENT_USER', LUSTER_PREVIEW_CLERK_ENV: 'development' }), neverConnect), 'TARGET_REJECTED');
    const messages = [production.message].join(' ');
    for (const sensitive of [SYNTHETIC_PASSWORD, SYNTHETIC_HOST, SYNTHETIC_ROLE, fixtureEnvironment().DATABASE_URL]) {
      expect(messages).not.toContain(sensitive);
    }

    expect(pgHarness.connections).toBe(connectionsBefore);
  });

  it('normalizes empty optional Clerk IDs to absent and rejects every partial or non-Development mapping before connecting', async () => {
    const partialInputs = [
      { LUSTER_PREVIEW_CLERK_USER_ID: SYNTHETIC_CLERK_ID },
      { LUSTER_PREVIEW_ADMIN_CONFIRM: 'MAP_SYNTHETIC_DEVELOPMENT_USER' },
      { LUSTER_PREVIEW_CLERK_ENV: 'development' },
      { LUSTER_PREVIEW_CLERK_USER_ID: SYNTHETIC_CLERK_ID, LUSTER_PREVIEW_ADMIN_CONFIRM: 'MAP_SYNTHETIC_DEVELOPMENT_USER' },
      { LUSTER_PREVIEW_CLERK_USER_ID: SYNTHETIC_CLERK_ID, LUSTER_PREVIEW_CLERK_ENV: 'development' },
      { LUSTER_PREVIEW_ADMIN_CONFIRM: 'MAP_SYNTHETIC_DEVELOPMENT_USER', LUSTER_PREVIEW_CLERK_ENV: 'development' },
      { LUSTER_PREVIEW_CLERK_USER_ID: '', LUSTER_PREVIEW_ADMIN_CONFIRM: 'MAP_SYNTHETIC_DEVELOPMENT_USER', LUSTER_PREVIEW_CLERK_ENV: 'development' },
      { LUSTER_PREVIEW_CLERK_USER_ID: ' \t ', LUSTER_PREVIEW_ADMIN_CONFIRM: 'MAP_SYNTHETIC_DEVELOPMENT_USER', LUSTER_PREVIEW_CLERK_ENV: 'development' },
      { LUSTER_PREVIEW_CLERK_USER_ID: SYNTHETIC_CLERK_ID, LUSTER_PREVIEW_ADMIN_CONFIRM: 'MAP_SYNTHETIC_DEVELOPMENT_USER', LUSTER_PREVIEW_CLERK_ENV: 'production' },
    ];
    const connectionsBefore = pgHarness.connections;

    for (const inputs of partialInputs) {
      await expectCode(runFixture('plan', fixtureEnvironment(inputs), neverConnect), 'TARGET_REJECTED');
    }

    expect(pgHarness.connections).toBe(connectionsBefore);

    const { client, database } = await migratedDatabase();
    try {
      await runFixture('apply', fixtureEnvironment({ LUSTER_PREVIEW_CLERK_USER_ID: '' }), database);
      await runFixture('apply', fixtureEnvironment({ LUSTER_PREVIEW_CLERK_USER_ID: ' \t ' }), database);

      expect((await client.query<{ clerk_user_id: string | null }>('SELECT clerk_user_id FROM admin_user WHERE id = $1', [FIXTURE.admin.id])).rows[0]?.clerk_user_id).toBeNull();
      expect(database.boundValues).not.toContain('');
      expect(database.boundValues).not.toContain(' \t ');
    } finally {
      await client.close();
    }
  });

  it('rejects wrong live identity, elevated roles, wrong migration count, and wrong final migration', async () => {
    const { client, database } = await migratedDatabase();
    try {
      database.session = { database_name: 'neondb' };
      await expectCode(runFixture('plan', fixtureEnvironment(), database), 'SESSION_REJECTED');
      database.session = { rolsuper: true };
      await expectCode(runFixture('plan', fixtureEnvironment(), database), 'SESSION_REJECTED');
      database.session = { application_name: 'wrong-application' };
      await expectCode(runFixture('plan', fixtureEnvironment(), database), 'SESSION_REJECTED');
      database.session = {};
      database.transaction = { isolation: 'read committed' };
      await expectCode(runFixture('plan', fixtureEnvironment(), database), 'TRANSACTION_REJECTED');
      database.transaction = { row_security: 'on' };
      await expectCode(runFixture('plan', fixtureEnvironment(), database), 'TRANSACTION_REJECTED');
      database.transaction = {};
      const last = await client.query<{ id: number; hash: string; created_at: string }>('SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC, id DESC LIMIT 1');
      await client.query('DELETE FROM drizzle.__drizzle_migrations WHERE id = $1', [last.rows[0]!.id]);
      await expectCode(runFixture('plan', fixtureEnvironment(), database), 'MIGRATION_REJECTED');
      await client.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [last.rows[0]!.hash, last.rows[0]!.created_at]);
      await client.query('UPDATE drizzle.__drizzle_migrations SET hash = repeat(\'0\', 64) WHERE created_at = $1', [last.rows[0]!.created_at]);
      await expectCode(runFixture('plan', fixtureEnvironment(), database), 'MIGRATION_REJECTED');
    } finally {
      await client.close();
    }
  });

  it('rejects an unverified client transport before any query even when backend metadata would claim TLS', async () => {
    const { client, database } = await migratedDatabase();
    const logs: string[] = [];
    tlsHarness.attestation = null;
    try {
      const error = await expectCode(runFixture('plan', fixtureEnvironment(), database, message => logs.push(message)), 'SESSION_REJECTED');

      expect(error.message).toBe('Preview fixture session rejected: live target attestation failed.');
      expect(database.queries).toEqual([]);
      expect(database.writes).toEqual([]);
      expect(logs).toEqual([]);

      for (const sensitive of [SYNTHETIC_PASSWORD, SYNTHETIC_HOST, fixtureEnvironment().DATABASE_URL]) {
        expect(error.message).not.toContain(sensitive);
      }
    } finally {
      await client.close();
    }
  });
});

describe('Preview service-image fixture behavior', () => {
  it('documents the exact migration-ledger SELECT-only role contract without ownership or role membership', async () => {
    const client = new PGlite();
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), 'migrations') });
    try {
      await client.query('CREATE ROLE fixture_ledger_migrator NOLOGIN');
      await client.query('CREATE ROLE fixture_ledger_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT');
      await client.query('GRANT USAGE ON SCHEMA drizzle TO fixture_ledger_reader');
      await client.query('GRANT SELECT ON TABLE drizzle.__drizzle_migrations TO fixture_ledger_reader');
      await client.query('SET ROLE fixture_ledger_reader');

      const privileges = await client.query<Record<string, boolean>>(`SELECT
        has_table_privilege(current_user, 'drizzle.__drizzle_migrations', 'SELECT') AS can_select,
        has_table_privilege(current_user, 'drizzle.__drizzle_migrations', 'INSERT') AS can_insert,
        has_table_privilege(current_user, 'drizzle.__drizzle_migrations', 'UPDATE') AS can_update,
        has_table_privilege(current_user, 'drizzle.__drizzle_migrations', 'DELETE') AS can_delete,
        has_table_privilege(current_user, 'drizzle.__drizzle_migrations', 'TRUNCATE') AS can_truncate,
        has_table_privilege(current_user, 'drizzle.__drizzle_migrations', 'REFERENCES') AS can_reference,
        has_table_privilege(current_user, 'drizzle.__drizzle_migrations', 'TRIGGER') AS can_trigger`);

      expect(privileges.rows[0]).toEqual({ can_select: true, can_insert: false, can_update: false, can_delete: false, can_truncate: false, can_reference: false, can_trigger: false });
      expect((await client.query('SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id')).rows).toHaveLength(64);

      for (const statement of [
        'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (\'denied\', 0)',
        'UPDATE drizzle.__drizzle_migrations SET hash = hash WHERE false',
        'DELETE FROM drizzle.__drizzle_migrations WHERE false',
        'TRUNCATE TABLE drizzle.__drizzle_migrations',
      ]) {
        await expect(client.query(statement)).rejects.toMatchObject({ code: '42501' });
      }

      const roleContract = await client.query<{ owns_table: boolean; protected_memberships: number }>(`SELECT
        ledger.relowner = reader.oid AS owns_table,
        (SELECT count(*)::int FROM pg_catalog.pg_auth_members membership
          WHERE membership.member = reader.oid AND membership.roleid = migrator.oid) AS protected_memberships
        FROM pg_catalog.pg_class ledger
        JOIN pg_catalog.pg_namespace namespace ON namespace.oid = ledger.relnamespace
        CROSS JOIN pg_catalog.pg_roles reader
        CROSS JOIN pg_catalog.pg_roles migrator
        WHERE namespace.nspname = 'drizzle' AND ledger.relname = '__drizzle_migrations'
          AND reader.rolname = 'fixture_ledger_reader' AND migrator.rolname = 'fixture_ledger_migrator'`);

      expect(roleContract.rows[0]).toEqual({ owns_table: false, protected_memberships: 0 });
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.close();
    }
  });

  it('sanitizes missing ledger SELECT for every command, rolls back, and performs no writes', async () => {
    const { client, database } = await migratedDatabase();
    const rawUrl = fixtureEnvironment().DATABASE_URL;
    const rawMessage = `ledger denied ${rawUrl} password=${SYNTHETIC_PASSWORD}`;
    try {
      for (const command of ['plan', 'apply', 'verify', 'reset'] as const) {
        const logs: string[] = [];
        const queryOffset = database.queries.length;
        const writesBefore = database.writes.length;
        database.failure = {
          pattern: /^SELECT hash, created_at FROM drizzle\.__drizzle_migrations ORDER BY created_at, id$/,
          error: Object.assign(new Error(rawMessage), { code: '42501', detail: rawMessage, stack: `raw ${SYNTHETIC_HOST}` }),
        };

        const error = await expectCode(runFixture(command, fixtureEnvironment(), database, message => logs.push(message)), 'OPERATION_FAILED');
        const queries = database.queries.slice(queryOffset);
        const ledgerIndex = queries.findIndex(query => query === 'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id');

        expect(error.stage).toBe(command);
        expect(error.diagnosticCode).toBe('42501');
        expect(error.message).toBe(`Preview fixture operation failed safely on the attested target. Stage: ${command}. Code: 42501.`);
        expect(Object.hasOwn(error, 'cause')).toBe(false);
        expect(logs).toEqual([]);
        expect(database.writes).toHaveLength(writesBefore);
        expect(ledgerIndex).toBeGreaterThan(-1);
        expect(queries.slice(ledgerIndex + 1).map(query => query.trim())).toEqual(['ROLLBACK']);

        for (const sensitive of [rawUrl, rawMessage, SYNTHETIC_PASSWORD, SYNTHETIC_HOST]) {
          expect(error.message).not.toContain(sensitive);
          expect(error.stack).not.toContain(sensitive);
        }
      }
    } finally {
      database.failure = null;
      await client.close();
    }
  });

  it('rejects a reserved identifier collision without changing the unrelated row', async () => {
    const { client, database } = await migratedDatabase();
    try {
      await client.query('INSERT INTO salon (id, name, slug, internal_notes) VALUES ($1, $2, $3, $4)', [FIXTURE.salons[0]!.id, 'Synthetic Unrelated Test Row', 'synthetic-unrelated-test-row', 'not-the-fixture']);
      await expectCode(runFixture('apply', fixtureEnvironment(), database), 'COLLISION_REJECTED');
      const row = await client.query<{ slug: string }>('SELECT slug FROM salon WHERE id = $1', [FIXTURE.salons[0]!.id]);

      expect(row.rows[0]?.slug).toBe('synthetic-unrelated-test-row');
    } finally {
      await client.close();
    }
  });

  it('refuses unexpected partitioned cross-schema CASCADE edges before changing fixture or unrelated rows', async () => {
    const { client, database } = await migratedDatabase();
    try {
      await runFixture('apply', fixtureEnvironment(), database);
      await client.query('INSERT INTO salon (id, name, slug, internal_notes) VALUES ($1, $2, $3, $4)', ['e8d92d3d-cb45-4c66-a538-3044ff173f3d', 'Synthetic FK Survivor', 'synthetic-fk-survivor-cascade', 'unrelated-test']);
      await client.query('CREATE SCHEMA fixture_probe');
      await client.query('CREATE TABLE fixture_probe.cross_schema_reference (id text PRIMARY KEY, salon_id text NOT NULL, payload text NOT NULL, CONSTRAINT cross_schema_salon_fkey FOREIGN KEY (salon_id) REFERENCES public.salon(id) ON DELETE CASCADE) PARTITION BY HASH (id)');
      await client.query('CREATE TABLE fixture_probe.cross_schema_reference_p0 PARTITION OF fixture_probe.cross_schema_reference FOR VALUES WITH (MODULUS 1, REMAINDER 0)');
      await client.query('INSERT INTO fixture_probe.cross_schema_reference (id, salon_id, payload) VALUES ($1, $2, $3)', ['cross-schema-sentinel', FIXTURE.salons[0]!.id, 'synthetic unchanged payload']);
      const writesBefore = database.writes.length;

      await expectCode(runFixture('reset', fixtureEnvironment(), database), 'SESSION_REJECTED');

      expect(database.writes).toHaveLength(writesBefore);
      expect(await countRows(client, 'SELECT count(*) FROM salon WHERE id = ANY($1::text[])', [FIXTURE.salons.map(row => row.id)])).toBe(2);
      expect((await client.query('SELECT salon_id, payload FROM fixture_probe.cross_schema_reference WHERE id = $1', ['cross-schema-sentinel'])).rows[0]).toEqual({ salon_id: FIXTURE.salons[0]!.id, payload: 'synthetic unchanged payload' });
      expect(await countRows(client, 'SELECT count(*) FROM salon WHERE slug = $1', ['synthetic-fk-survivor-cascade'])).toBe(1);
    } finally {
      await client.close();
    }
  });

  it('refuses an unexpected public SET NULL edge to salon.slug before changing fixture or unrelated rows', async () => {
    const { client, database } = await migratedDatabase();
    try {
      await runFixture('apply', fixtureEnvironment(), database);
      await client.query('INSERT INTO salon (id, name, slug, internal_notes) VALUES ($1, $2, $3, $4)', ['6a89a8c8-a32d-4a6b-bf2e-20d5dcc937f4', 'Synthetic Slug Survivor', 'synthetic-fk-survivor-set-null', 'unrelated-test']);
      await client.query('CREATE TABLE public.slug_reference_probe (id text PRIMARY KEY, salon_slug text, payload text NOT NULL, CONSTRAINT slug_reference_salon_fkey FOREIGN KEY (salon_slug) REFERENCES public.salon(slug) ON DELETE SET NULL)');
      await client.query('INSERT INTO public.slug_reference_probe (id, salon_slug, payload) VALUES ($1, $2, $3)', ['slug-reference-sentinel', FIXTURE.salons[1]!.slug, 'synthetic unchanged payload']);
      const writesBefore = database.writes.length;

      await expectCode(runFixture('reset', fixtureEnvironment(), database), 'SESSION_REJECTED');

      expect(database.writes).toHaveLength(writesBefore);
      expect(await countRows(client, 'SELECT count(*) FROM service WHERE salon_id = ANY($1::text[])', [FIXTURE.salons.map(row => row.id)])).toBe(12);
      expect((await client.query('SELECT salon_slug, payload FROM public.slug_reference_probe WHERE id = $1', ['slug-reference-sentinel'])).rows[0]).toEqual({ salon_slug: FIXTURE.salons[1]!.slug, payload: 'synthetic unchanged payload' });
      expect(await countRows(client, 'SELECT count(*) FROM salon WHERE slug = $1', ['synthetic-fk-survivor-set-null'])).toBe(1);
    } finally {
      await client.close();
    }
  });

  it('fails closed on one missing edge, same-count identity drift, and complete discovery suppression before a normal idempotent reset', async () => {
    const { client, database } = await migratedDatabase();
    try {
      await runFixture('apply', fixtureEnvironment(), database);
      const lockIndex = database.queries.findIndex(query => query.includes('preview-fixture-relation-lock'));
      const graphIndex = database.queries.findIndex(query => query.includes('preview-fixture-incoming-foreign-keys'));
      const transactionIndex = database.queries.findIndex(query => query.includes('preview-fixture-transaction'));
      const sessionIndex = database.queries.findIndex(query => query.includes('preview-fixture-session'));
      const beginIndex = database.queries.findIndex(query => query.startsWith('BEGIN ISOLATION LEVEL SERIALIZABLE'));
      const lockSql = database.queries[lockIndex] ?? '';

      expect(lockIndex).toBeGreaterThan(-1);
      expect(lockIndex).toBeGreaterThan(beginIndex);
      expect(database.queries.slice(beginIndex + 1, lockIndex).some(query => /\bSELECT\b/i.test(query))).toBe(false);
      expect(transactionIndex).toBeGreaterThan(lockIndex);
      expect(sessionIndex).toBeGreaterThan(lockIndex);
      expect(graphIndex).toBeGreaterThan(lockIndex);
      expect(lockSql).toContain('"public"."salon"');
      expect(lockSql).toContain('"public"."audit_log"');
      expect(lockSql).toContain('"public"."service_add_on"');
      expect(database.lockChecks).toBe(1);

      await client.query('INSERT INTO salon (id, name, slug, internal_notes) VALUES ($1, $2, $3, $4)', ['81a156f0-18df-402b-857f-08cf7fd75698', 'Synthetic Discovery Survivor', 'synthetic-discovery-survivor', 'unrelated-test']);
      const writesBefore = database.writes.length;
      const assertRefusalPreservedState = async () => {
        await expectCode(runFixture('reset', fixtureEnvironment(), database), 'SESSION_REJECTED');

        expect(database.writes).toHaveLength(writesBefore);
        expect(await countRows(client, 'SELECT count(*) FROM service WHERE salon_id = ANY($1::text[])', [FIXTURE.salons.map(row => row.id)])).toBe(12);
        expect(await countRows(client, 'SELECT count(*) FROM salon WHERE slug = $1', ['synthetic-discovery-survivor'])).toBe(1);
      };

      database.foreignKeyRowsTransform = rows => rows.slice(1);
      await assertRefusalPreservedState();
      database.foreignKeyRowsTransform = rows => rows.map((row, index) => index === 0 ? { ...row, constraint_name: 'same_count_unexpected_fkey' } : row);
      await assertRefusalPreservedState();
      database.foreignKeyRowsTransform = () => [];
      await assertRefusalPreservedState();
      database.foreignKeyRowsTransform = null;

      await runFixture('reset', fixtureEnvironment(), database);
      await runFixture('reset', fixtureEnvironment(), database);

      expect(await countRows(client, 'SELECT count(*) FROM salon WHERE id = ANY($1::text[])', [FIXTURE.salons.map(row => row.id)])).toBe(0);
      expect(await countRows(client, 'SELECT count(*) FROM salon WHERE slug = $1', ['synthetic-discovery-survivor'])).toBe(1);
    } finally {
      await client.close();
    }
  });

  it('fails closed when row-level security could hide an expected dependent row', async () => {
    const { client, database } = await migratedDatabase();
    try {
      await runFixture('apply', fixtureEnvironment(), database);
      await client.query('INSERT INTO audit_log (id, salon_id, actor_type, actor_id, action) VALUES ($1, $2, $3, $4, $5)', ['fixture-rls-audit-test', FIXTURE.salons[0]!.id, 'admin', FIXTURE.admin.id, 'settings_updated']);
      await client.query('CREATE ROLE fixture_rls_runtime NOLOGIN');
      await client.query('GRANT USAGE ON SCHEMA public, drizzle TO fixture_rls_runtime');
      await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fixture_rls_runtime');
      await client.query('GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO fixture_rls_runtime');
      await client.query('ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY');
      await client.query('CREATE POLICY fixture_hidden_audit ON public.audit_log TO fixture_rls_runtime USING (false)');
      await client.query('SET ROLE fixture_rls_runtime');
      const writesBefore = database.writes.length;

      const error = await expectCode(runFixture('reset', fixtureEnvironment(), database), 'OPERATION_FAILED');

      expect(error.stage).toBe('reset');
      expect(error.diagnosticCode).toBe('42501');
      expect(database.writes).toHaveLength(writesBefore);

      await client.query('RESET ROLE');

      expect(await countRows(client, 'SELECT count(*) FROM audit_log WHERE id = $1', ['fixture-rls-audit-test'])).toBe(1);
      expect(await countRows(client, 'SELECT count(*) FROM salon WHERE id = ANY($1::text[])', [FIXTURE.salons.map(row => row.id)])).toBe(2);
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.close();
    }
  });

  it('reports verified client TLS with backend visibility terminated upstream and still runs every plan check', async () => {
    const { client, database } = await migratedDatabase();
    const logs: string[] = [];
    tlsHarness.attestation = PREVIEW_FIXTURE_TLS_ATTESTATIONS.backendTerminatedUpstream;
    database.session = { backend_tls: false };
    try {
      await runFixture('plan', fixtureEnvironment(), database, message => logs.push(message));

      expect(database.writes).toEqual([]);
      expect(database.queries).toContain('SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id');
      expect(database.queries.some(query => query.includes('preview-fixture-incoming-foreign-keys'))).toBe(true);
      expect(logs).toEqual([expect.stringContaining(PREVIEW_FIXTURE_TLS_ATTESTATIONS.backendTerminatedUpstream)]);
    } finally {
      await client.close();
    }
  });

  it('plans without writes, applies idempotently, verifies variants, maps an optional Development owner, and resets exactly', async () => {
    const { client, database } = await migratedDatabase();
    const logs: string[] = [];
    const env = fixtureEnvironment();
    try {
      await client.query('INSERT INTO salon (id, name, slug, internal_notes) VALUES ($1, $2, $3, $4)', ['4df571c3-f8c8-4991-a5ce-e0ad1f66d638', 'Synthetic Unrelated Survivor', 'synthetic-unrelated-survivor', 'unrelated-test']);
      await runFixture('plan', env, database, message => logs.push(message));

      expect(database.writes).toHaveLength(0);

      await runFixture('apply', env, database, message => logs.push(message));
      const snapshot = await client.query('SELECT id, settings, updated_at FROM salon WHERE id = ANY($1::text[]) ORDER BY id', [FIXTURE.salons.map(row => row.id)]);
      await runFixture('apply', env, database);

      expect((await client.query('SELECT id, settings, updated_at FROM salon WHERE id = ANY($1::text[]) ORDER BY id', [FIXTURE.salons.map(row => row.id)])).rows).toEqual(snapshot.rows);

      await runFixture('verify', env, database);

      await client.query('UPDATE public.service SET description = \'drifted synthetic test value\' WHERE id = $1', [FIXTURE.services[0]!.id]);
      await expectCode(runFixture('verify', env, database), 'STATE_REJECTED');
      await runFixture('apply', env, database);

      const salons = await client.query<{ id: string; settings: { merchandising: Record<string, unknown> } }>('SELECT id, settings FROM salon WHERE id = ANY($1::text[])', [FIXTURE.salons.map(row => row.id)]);
      const settingsById = new Map(salons.rows.map(row => [row.id, row.settings]));

      expect(Object.hasOwn(settingsById.get(FIXTURE.salons[0]!.id)!.merchandising, 'showServiceImages')).toBe(false);
      expect(settingsById.get(FIXTURE.salons[0]!.id)!.merchandising.showServiceImages !== false).toBe(true);
      expect(settingsById.get(FIXTURE.salons[1]!.id)!.merchandising.showServiceImages).toBe(false);

      const serviceState = await client.query<{ count: number; images: number; combos: number; featured: number; intro: number; long_names: number }>(`SELECT count(*)::int AS count, count(image_url)::int AS images, count(*) FILTER (WHERE booking_category = 'combo')::int AS combos, count(*) FILTER (WHERE featured_order IS NOT NULL)::int AS featured, count(*) FILTER (WHERE is_intro_price)::int AS intro, count(*) FILTER (WHERE length(name) > 60)::int AS long_names FROM service WHERE salon_id = ANY($1::text[])`, [FIXTURE.salons.map(row => row.id)]);

      expect(serviceState.rows[0]).toEqual({ count: 12, images: 12, combos: 2, featured: 4, intro: 2, long_names: 2 });
      expect(await countRows(client, 'SELECT count(*) FROM technician WHERE salon_id = ANY($1::text[]) AND avatar_url IS NOT NULL AND weekly_schedule IS NOT NULL', [FIXTURE.salons.map(row => row.id)])).toBe(2);
      expect(await countRows(client, 'SELECT count(*) FROM add_on WHERE salon_id = ANY($1::text[])', [FIXTURE.salons.map(row => row.id)])).toBe(2);
      expect(await countRows(client, 'SELECT count(*) FROM service_add_on WHERE salon_id = ANY($1::text[])', [FIXTURE.salons.map(row => row.id)])).toBe(2);
      expect(await countRows(client, 'SELECT count(*) FROM technician_services WHERE technician_id = ANY($1::text[]) AND enabled', [FIXTURE.technicians.map(row => row.id)])).toBe(12);

      const sideEffects = await client.query<{ count: number }>(`SELECT ((SELECT count(*) FROM client) + (SELECT count(*) FROM salon_client WHERE salon_id = ANY($1::text[])) + (SELECT count(*) FROM appointment WHERE salon_id = ANY($1::text[])) + (SELECT count(*) FROM appointment_payment) + (SELECT count(*) FROM client_communication WHERE salon_id = ANY($1::text[])) + (SELECT count(*) FROM notification_delivery WHERE salon_id = ANY($1::text[])) + (SELECT count(*) FROM integration_outbox WHERE salon_id = ANY($1::text[])) + (SELECT count(*) FROM salon_google_calendar_connection WHERE salon_id = ANY($1::text[])) + (SELECT count(*) FROM salon_twilio_connection WHERE salon_id = ANY($1::text[])))::int AS count`, [FIXTURE.salons.map(row => row.id)]);

      expect(sideEffects.rows[0]?.count).toBe(0);

      const mappedEnv = fixtureEnvironment({ LUSTER_PREVIEW_CLERK_USER_ID: `  ${SYNTHETIC_CLERK_ID}\t`, LUSTER_PREVIEW_ADMIN_CONFIRM: 'MAP_SYNTHETIC_DEVELOPMENT_USER', LUSTER_PREVIEW_CLERK_ENV: 'development' });
      await runFixture('apply', mappedEnv, database, message => logs.push(message));
      await runFixture('verify', mappedEnv, database);

      expect((await client.query<{ clerk_user_id: string | null }>('SELECT clerk_user_id FROM admin_user WHERE id = $1', [FIXTURE.admin.id])).rows[0]?.clerk_user_id).toBe(SYNTHETIC_CLERK_ID);

      await expectCode(runFixture('apply', fixtureEnvironment({ LUSTER_PREVIEW_CLERK_USER_ID: 'user_SyntheticDevelopmentFixture0002', LUSTER_PREVIEW_ADMIN_CONFIRM: 'MAP_SYNTHETIC_DEVELOPMENT_USER', LUSTER_PREVIEW_CLERK_ENV: 'development' }), database), 'COLLISION_REJECTED');

      await client.query('INSERT INTO audit_log (id, salon_id, actor_type, actor_id, action) VALUES (\'fixture-reset-audit-test\', $1, \'admin\', $2, \'settings_updated\')', [FIXTURE.salons[0]!.id, FIXTURE.admin.id]);
      await expectCode(runFixture('reset', env, database), 'COLLISION_REJECTED');

      expect(await countRows(client, 'SELECT count(*) FROM service WHERE salon_id = ANY($1::text[])', [FIXTURE.salons.map(row => row.id)])).toBe(12);

      await client.query('DELETE FROM audit_log WHERE id = \'fixture-reset-audit-test\'');
      await client.query('INSERT INTO admin_session (id, admin_id, expires_at) VALUES (\'fixture-reset-session-test\', $1, now() + interval \'1 day\')', [FIXTURE.admin.id]);
      await expectCode(runFixture('reset', env, database), 'COLLISION_REJECTED');

      expect(await countRows(client, 'SELECT count(*) FROM service WHERE salon_id = ANY($1::text[])', [FIXTURE.salons.map(row => row.id)])).toBe(12);

      await client.query('DELETE FROM admin_session WHERE id = \'fixture-reset-session-test\'');

      database.hideIncomingReferences = true;
      await expectCode(runFixture('reset', env, database), 'SESSION_REJECTED');
      database.hideIncomingReferences = false;

      await runFixture('reset', env, database);
      await runFixture('reset', env, database);

      expect(await countRows(client, 'SELECT count(*) FROM salon WHERE id = ANY($1::text[])', [FIXTURE.salons.map(row => row.id)])).toBe(0);
      expect(await countRows(client, 'SELECT count(*) FROM salon WHERE slug = \'synthetic-unrelated-survivor\'')).toBe(1);

      const output = logs.join('\n');

      expect(output).toMatch(/salons=2, services=12, technicians=2, add-ons=2, side-effects=0/);
      expect(output).toContain(PREVIEW_FIXTURE_TLS_ATTESTATIONS.backendVisible);
      expect(database.writes.filter(sql => /^(?:INSERT|UPDATE|DELETE)/i.test(sql.trim())).every(sql => /\bpublic\./.test(sql))).toBe(true);

      for (const sensitive of [SYNTHETIC_PASSWORD, SYNTHETIC_HOST, SYNTHETIC_ROLE, SYNTHETIC_CLERK_ID, FIXTURE.salons[0]!.slug, FIXTURE.admin.email]) {
        expect(output).not.toContain(sensitive);
      }
    } finally {
      await client.close();
    }
  });

  it('rolls back partial writes and emits only bounded SQLSTATE or system diagnostics', async () => {
    const { client, database } = await migratedDatabase();
    const rawUrl = fixtureEnvironment().DATABASE_URL;
    const rawMessage = `driver failure ${rawUrl} password=${SYNTHETIC_PASSWORD} host=${SYNTHETIC_HOST}`;
    const rawStack = `RAW_STACK ${SYNTHETIC_ROLE}`;
    const sqlStateError = Object.assign(new Error(rawMessage), { code: '23505', detail: rawMessage, hint: rawMessage, stack: rawStack });
    const systemError = Object.assign(new Error(rawMessage), { code: 'ECONNREFUSED', address: SYNTHETIC_HOST, stack: rawStack });
    const malformedError = Object.assign(new Error(rawMessage), { code: 'bad-code-password', cause: Object.assign(new Error(rawMessage), { code: '23503' }), stack: rawStack });
    const unlistedSqlStateError = Object.assign(new Error(rawMessage), { code: 'ZZZZZ', stack: rawStack });
    const unlistedSystemError = Object.assign(new Error(rawMessage), { code: 'EPRIVATE_VALUE', stack: rawStack });
    const forgedFixtureError = Object.assign(new PreviewFixtureError('STATE_REJECTED'), { message: rawMessage, cause: new Error(rawMessage), stack: rawStack });
    const hostileError = new Proxy({}, {
      get: () => {
        throw new Error(rawMessage);
      },
      getPrototypeOf: () => {
        throw new Error(rawMessage);
      },
    });
    const cases: Array<{ thrown: unknown; diagnostic: string | null }> = [
      { thrown: sqlStateError, diagnostic: '23505' },
      { thrown: systemError, diagnostic: 'ECONNREFUSED' },
      { thrown: malformedError, diagnostic: null },
      { thrown: unlistedSqlStateError, diagnostic: null },
      { thrown: unlistedSystemError, diagnostic: null },
      { thrown: forgedFixtureError, diagnostic: null },
      { thrown: hostileError, diagnostic: null },
      { thrown: rawMessage, diagnostic: null },
      { thrown: null, diagnostic: null },
    ];
    try {
      for (const { thrown, diagnostic } of cases) {
        const logs: string[] = [];
        database.failure = { pattern: /INSERT INTO public\."add_on"/, error: thrown };
        const error = await expectCode(runFixture('apply', fixtureEnvironment(), database, message => logs.push(message)), 'OPERATION_FAILED');

        expect(error.stage).toBe('apply');
        expect(error.diagnosticCode).toBe(diagnostic);
        expect(error.message).toBe(`Preview fixture operation failed safely on the attested target. Stage: apply.${diagnostic ? ` Code: ${diagnostic}.` : ''}`);
        expect(logs).toEqual([]);
        expect(Object.hasOwn(error, 'cause')).toBe(false);
        expect(await countRows(client, 'SELECT count(*) FROM salon WHERE id = ANY($1::text[])', [FIXTURE.salons.map(row => row.id)])).toBe(0);

        for (const sensitive of [rawUrl, rawMessage, rawStack, SYNTHETIC_PASSWORD, SYNTHETIC_HOST, SYNTHETIC_ROLE]) {
          expect(error.message).not.toContain(sensitive);
          expect(error.stack).not.toContain(sensitive);
        }
      }
    } finally {
      await client.close();
    }
  });

  it('contains only deterministic synthetic identities and fixture-owned static assets', () => {
    const entityIds = [...FIXTURE.salons, ...FIXTURE.locations, ...FIXTURE.services, ...FIXTURE.technicians, ...FIXTURE.addOns, ...FIXTURE.rules, FIXTURE.admin].map(row => row.id);

    expect(new Set(entityIds).size).toBe(entityIds.length);
    expect(entityIds.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);

    const emails = [...FIXTURE.salons, ...FIXTURE.locations, ...FIXTURE.technicians, FIXTURE.admin].map(row => row.email);

    expect(emails.every(email => email.endsWith('.invalid'))).toBe(true);

    const phones = [...FIXTURE.salons, ...FIXTURE.locations, ...FIXTURE.technicians, FIXTURE.admin].map(row => 'phone' in row ? row.phone : row.phone_e164);

    expect(phones.every(phone => /^\+120255501\d{2}$/.test(phone))).toBe(true);
    expect(FIXTURE.services.every(service => service.image_url.startsWith('/assets/images/services/'))).toBe(true);
    expect(FIXTURE.technicians.every(technician => technician.avatar_url === '/assets/images/fixtures/preview-technician-avatar.svg')).toBe(true);

    const featured = getFeaturedServices(FIXTURE.services.filter(service => service.salon_id === FIXTURE.salons[0]!.id).map(service => ({ ...service, sortOrder: service.sort_order, featuredOrder: service.featured_order, templateKey: service.template_key, isActive: service.is_active })), { lusterFeaturingEnabled: false });

    expect(featured.map(service => service.id)).toEqual([FIXTURE.services[0]!.id, FIXTURE.services[1]!.id, FIXTURE.services[3]!.id]);
    expect(featured[0]!.booking_category).toBe('combo');
  });
});
