import { createHash } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { vi } from 'vitest';

import { PREVIEW_SERVICE_IMAGE_FIXTURE as FIXTURE } from '../../scripts/fixtures/preview-service-image-fixtures';
import {
  PreviewFixtureError,
  runPreviewServiceImageFixture,
} from '../../scripts/preview-service-image-fixtures';
import { getFeaturedServices } from './bookingMerchandising';

type FixtureDatabase = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};
const pgHarness = vi.hoisted(() => ({ database: null as unknown, connections: 0 }));
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

const SYNTHETIC_HOST = 'fixture-db.preview.invalid';
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
    LUSTER_PREVIEW_APPLICATION_NAME: 'luster-preview-service-image-fixtures-v1',
    LUSTER_PREVIEW_FIXTURE_VERSION: 'service-images-v1',
    LUSTER_PREVIEW_FIXTURE_CONFIRM: 'CREATE_SYNTHETIC_PREVIEW_FIXTURES',
    LUSTER_PREVIEW_FIXTURE_RESET_CONFIRM: 'DELETE_SYNTHETIC_PREVIEW_FIXTURES',
    LUSTER_PREVIEW_TARGET_FINGERPRINT: fingerprint,
    ...overrides,
  };
}

class AttestedPGlite implements FixtureDatabase {
  readonly writes: string[] = [];
  failOn: RegExp | null = null;
  session: Record<string, unknown> = {};
  transaction: Record<string, unknown> = {};
  hideIncomingReferences = false;
  private readOnly = false;

  constructor(readonly client: PGlite) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    if (text.includes('preview-fixture-session')) {
      return { rows: [{
        database_name: 'luster_preview',
        database_user: SYNTHETIC_ROLE,
        application_name: 'luster-preview-service-image-fixtures-v1',
        ssl: true,
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolbypassrls: false,
        rolcanlogin: true,
        ...this.session,
      } as unknown as T] };
    }
    if (text.includes('preview-fixture-transaction')) {
      return { rows: [{ isolation: 'serializable', read_only: this.readOnly ? 'on' : 'off', search_path: 'pg_catalog, public', ...this.transaction } as unknown as T] };
    }
    if (/^BEGIN ISOLATION LEVEL SERIALIZABLE/i.test(text)) {
      this.readOnly = text.includes('READ ONLY');
      const result = await this.client.query('BEGIN');
      return { rows: result.rows as T[] };
    }
    if (/^(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(text.trim())) {
      this.writes.push(text);
    }
    if (this.failOn?.test(text)) {
      throw new Error(`driver failure ${SYNTHETIC_PASSWORD} ${SYNTHETIC_HOST}`);
    }
    if (this.hideIncomingReferences && text.includes('pg_catalog.pg_constraint')) {
      return { rows: [] };
    }
    const result = await this.client.query(text, values);
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
    const wrongDatabase = fixtureEnvironment();
    wrongDatabase.DATABASE_URL = wrongDatabase.DATABASE_URL.replace('/luster_preview', '/neondb');
    await expectCode(runFixture('plan', wrongDatabase, neverConnect), 'TARGET_REJECTED');
    await expectCode(runFixture('plan', fixtureEnvironment({ LUSTER_PREVIEW_TARGET_FINGERPRINT: '0'.repeat(64) }), neverConnect), 'FINGERPRINT_REJECTED');
    const noTls = fixtureEnvironment();
    noTls.DATABASE_URL = noTls.DATABASE_URL.replace(/\?.*$/, '');
    await expectCode(runFixture('plan', noTls, neverConnect), 'TARGET_REJECTED');
    await expectCode(runFixture('plan', fixtureEnvironment({ LUSTER_PREVIEW_EXPECTED_HOST: 'other.preview.invalid' }), neverConnect), 'TARGET_REJECTED');
    const productionHost = fixtureEnvironment();
    productionHost.DATABASE_URL = productionHost.DATABASE_URL.replace(SYNTHETIC_HOST, 'db.prod.preview.invalid');
    productionHost.LUSTER_PREVIEW_EXPECTED_HOST = 'db.prod.preview.invalid';
    productionHost.LUSTER_PREVIEW_TARGET_FINGERPRINT = createHash('sha256').update(`db.prod.preview.invalid|5432|${SYNTHETIC_ROLE}|luster_preview`).digest('hex');
    await expectCode(runFixture('plan', productionHost, neverConnect), 'TARGET_REJECTED');
    await expectCode(runFixture('plan', fixtureEnvironment({ LUSTER_PREVIEW_EXPECTED_SSL_MODE: 'verify-full' }), neverConnect), 'TARGET_REJECTED');
    await expectCode(runFixture('plan', fixtureEnvironment({ LUSTER_PREVIEW_CLERK_USER_ID: 'user_short', LUSTER_PREVIEW_ADMIN_CONFIRM: 'MAP_SYNTHETIC_DEVELOPMENT_USER', LUSTER_PREVIEW_CLERK_ENV: 'development' }), neverConnect), 'TARGET_REJECTED');
    const messages = [production.message].join(' ');
    for (const sensitive of [SYNTHETIC_PASSWORD, SYNTHETIC_HOST, SYNTHETIC_ROLE, fixtureEnvironment().DATABASE_URL]) {
      expect(messages).not.toContain(sensitive);
    }

    expect(pgHarness.connections).toBe(connectionsBefore);
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
      database.session = { ssl: false };
      await expectCode(runFixture('plan', fixtureEnvironment(), database), 'SESSION_REJECTED');
      database.session = {};
      database.transaction = { isolation: 'read committed' };
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
});

describe('Preview service-image fixture behavior', () => {
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

      const mappedEnv = fixtureEnvironment({ LUSTER_PREVIEW_CLERK_USER_ID: SYNTHETIC_CLERK_ID, LUSTER_PREVIEW_ADMIN_CONFIRM: 'MAP_SYNTHETIC_DEVELOPMENT_USER', LUSTER_PREVIEW_CLERK_ENV: 'development' });
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
      expect(database.writes.filter(sql => /^(?:INSERT|UPDATE|DELETE)/i.test(sql.trim())).every(sql => /\bpublic\./.test(sql))).toBe(true);

      for (const sensitive of [SYNTHETIC_PASSWORD, SYNTHETIC_HOST, SYNTHETIC_ROLE, SYNTHETIC_CLERK_ID, FIXTURE.salons[0]!.slug, FIXTURE.admin.email]) {
        expect(output).not.toContain(sensitive);
      }
    } finally {
      await client.close();
    }
  });

  it('rolls back a partially applied fixture and sanitizes the driver failure', async () => {
    const { client, database } = await migratedDatabase();
    try {
      database.failOn = /INSERT INTO public\."add_on"/;
      const error = await expectCode(runFixture('apply', fixtureEnvironment(), database), 'OPERATION_FAILED');

      expect(await countRows(client, 'SELECT count(*) FROM salon WHERE id = ANY($1::text[])', [FIXTURE.salons.map(row => row.id)])).toBe(0);
      expect(error.message).not.toContain(SYNTHETIC_PASSWORD);
      expect(error.message).not.toContain(SYNTHETIC_HOST);
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
