/**
 * Unit tests for `scripts/billing-preview-rehearsal-seed.ts`.
 *
 * NO NETWORK, NO DATABASE, NO FILESYSTEM WRITES. Every test drives a
 * hand-written object satisfying `SeedDbClient` and nothing else; the real `pg`
 * `Client` is never constructed. `main()` is never called — it is gated behind
 * a direct-invocation check in the script, so importing the module runs no
 * argument parsing and opens no connection.
 *
 * The live plan enum and the live top-up-audience resolver ARE imported for
 * real (with `server-only` stubbed, the repo convention at
 * `src/libs/billing/promotions.test.ts:3`), so the script's local copies are
 * checked against the source of truth rather than against a second copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type {
  AdminUserInsertRow,
  ExistingAdminRow,
  ExistingSalonRow,
  SeedDbClient,
  SeedPlan,
  SeedQueryResult,
} from './billing-preview-rehearsal-seed';
import {
  applySeed,
  assertPlanTiersMatchSchema,
  assertPreviewMarker,
  buildConnectionRedactor,
  buildSeedPlan,
  classifyExistingAdmin,
  classifyExistingSalon,
  CONNECTION_ENV_VAR,
  deterministicIds,
  enforceReadOnlySession,
  EXIT,
  inspectPreconditions,
  isPlausibleEmail,
  MARKER_QUERY,
  normalizeHost,
  parseArguments,
  READ_ONLY_PROBE_QUERY,
  READ_ONLY_SESSION_STATEMENT,
  readAndAssertPreviewMarker,
  REHEARSAL_ID_PREFIX,
  REHEARSAL_MARKER,
  resolveConnectionTarget,
  resolveTopupAudience,
  runVerify,
  SALON_PLAN_TIERS,
  SeedError,
  USAGE,
} from './billing-preview-rehearsal-seed';

vi.mock('server-only', () => ({}));

const { SALON_PLANS } = await import('../src/models/Schema');
const { resolveTopupAudienceForLegacyPlan } = await import('../src/libs/billing/legacyPlanAdapter');

const HOST = 'ep-example-12345678-pooler.us-east-2.aws.neon.tech';

/**
 * Scanner-safe fake connection credentials.
 *
 * `scripts/check-secret-leaks.mjs` (the CI job "Scan built client assets and
 * runtime credentials") parses every `postgres://`-shaped literal it finds and
 * reports one with a non-empty password — it has no placeholder heuristic for
 * URLs, so an inline `user:pw@host` literal fails that job whatever the values
 * are. Keeping the `user:password` pair in a named constant means the literal
 * the scanner reads carries no password field, while the URL the tests build at
 * runtime is exactly the credentialed shape the guards must handle. Do NOT
 * inline these back into the URL strings.
 */
const FAKE_USER = 'placeholder_user';
const FAKE_PASSWORD = 'placeholder-password';
const FAKE_CREDENTIALS = `${FAKE_USER}:${FAKE_PASSWORD}`;
const FAKE_LEAK_USER = 'secretuser';
const FAKE_LEAK_PASSWORD = 'secretpw';
const FAKE_LEAK_CREDENTIALS = `${FAKE_LEAK_USER}:${FAKE_LEAK_PASSWORD}`;
/** Percent-encoded `ne@on` / `p/w` — the encoded-credential redaction case. */
const FAKE_ENCODED_CREDENTIALS = 'ne%40on:p%2Fw';
/** A password that CONTAINS the user name, for the longest-fragment-first case. */
const FAKE_OVERLAPPING_CREDENTIALS = 'ne:neonpassword';

const URL_FOR_HOST = `postgresql://${FAKE_CREDENTIALS}@${HOST}/neondb?sslmode=require`;

function baseArgv(extra: string[] = []): string[] {
  return ['--expect-host', HOST, ...extra];
}

// ---------------------------------------------------------------------------
// Mock client
// ---------------------------------------------------------------------------

type Responder = (text: string, values: unknown[] | undefined) => SeedQueryResult | Error;

class MockClient implements SeedDbClient {
  public readonly calls: Array<{ text: string; values: unknown[] | undefined }> = [];

  constructor(private readonly responder: Responder) {}

  async query(text: string, values?: unknown[]): Promise<SeedQueryResult> {
    this.calls.push({ text, values });
    const result = this.responder(text, values);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  }

  texts(): string[] {
    return this.calls.map(call => call.text.trim().split('\n')[0]?.trim() ?? '');
  }
}

const EMPTY: SeedQueryResult = { rows: [] };

function markerRows(environment = 'preview'): SeedQueryResult {
  return { rows: [{ environment }] };
}

/** Responder for the happy "nothing exists yet" apply path. */
function freshDatabaseResponder(): Responder {
  return (text) => {
    if (text === MARKER_QUERY) {
      return markerRows();
    }
    if (text.includes('pg_advisory_xact_lock')) {
      return { rows: [{ pg_advisory_xact_lock: null }] };
    }
    if (text.includes('FROM public.salon')) {
      return EMPTY;
    }
    if (text.includes('FROM public.admin_user')) {
      return EMPTY;
    }
    if (text.includes('FROM public.admin_salon_membership')) {
      return EMPTY;
    }
    if (text.includes('INSERT INTO public.salon')) {
      return { rows: [{ id: 'rehearsal-salon-isla-rehearsal' }] };
    }
    if (text.includes('INSERT INTO public.admin_user')) {
      return { rows: [{ id: 'rehearsal-admin-isla-rehearsal' }] };
    }
    if (text.includes('INSERT INTO public.admin_salon_membership')) {
      return { rows: [{ admin_id: 'rehearsal-admin-isla-rehearsal' }] };
    }
    return EMPTY;
  };
}

function applyPlan(): SeedPlan {
  return buildSeedPlan(parseArguments(baseArgv([
    '--apply',
    '--owner-clerk-user-id',
    'user_2abcDEF',
    '--owner-email',
    'Owner@Example.com',
  ])));
}

// ---------------------------------------------------------------------------

describe('parseArguments', () => {
  it('defaults to the read-only plan mode, the isla-rehearsal slug and the FREE tier', () => {
    const args = parseArguments(baseArgv());

    expect(args.mode).toBe('plan');
    expect(args.slug).toBe('isla-rehearsal');
    expect(args.planTier).toBe('free');
    expect(args.ownerClerkUserId).toBeNull();
  });

  it('requires --expect-host in every mode', () => {
    expect(() => parseArguments(['--verify'])).toThrowError(/EXPECT_HOST_REQUIRED/);
  });

  it('normalizes the typed host so case and a trailing dot cannot silently mismatch', () => {
    expect(parseArguments(['--expect-host', `${HOST.toUpperCase()}.`]).expectHost).toBe(HOST);
  });

  it('refuses two modes at once', () => {
    expect(() => parseArguments(baseArgv(['--plan', '--apply']))).toThrowError(/MODE_CONFLICT/);
  });

  it('refuses an unknown argument rather than ignoring it', () => {
    expect(() => parseArguments(baseArgv(['--force']))).toThrowError(/UNKNOWN_ARGUMENT/);
  });

  it('refuses a flag with no value', () => {
    expect(() => parseArguments(['--expect-host'])).toThrowError(/MISSING_VALUE/);
  });

  it('accepts every SALON_PLANS tier and refuses anything else', () => {
    for (const tier of SALON_PLAN_TIERS) {
      expect(parseArguments(baseArgv(['--plan-tier', tier])).planTier).toBe(tier);
    }

    expect(() => parseArguments(baseArgv(['--plan-tier', 'pro']))).toThrowError(/PLAN_TIER_UNKNOWN/);
  });

  it('requires both owner inputs for --apply but neither for --plan', () => {
    expect(() => parseArguments(baseArgv(['--apply']))).toThrowError(/OWNER_CLERK_USER_ID_REQUIRED/);
    expect(() => parseArguments(baseArgv(['--apply', '--owner-clerk-user-id', 'user_1'])))
      .toThrowError(/OWNER_EMAIL_REQUIRED/);
    expect(parseArguments(baseArgv(['--plan'])).ownerEmail).toBeNull();
  });

  it('rejects a malformed slug and a malformed email', () => {
    expect(() => parseArguments(baseArgv(['--slug', 'Isla Rehearsal']))).toThrowError(/SLUG_SHAPE/);
    expect(() => parseArguments(baseArgv(['--slug', '-leading']))).toThrowError(/SLUG_SHAPE/);
    expect(() => parseArguments(baseArgv(['--owner-email', 'nope']))).toThrowError(/OWNER_EMAIL_SHAPE/);
  });

  it('carries the usage exit code, distinct from a safety refusal', () => {
    try {
      parseArguments(['--verify']);

      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SeedError);
      expect((error as SeedError).exitCode).toBe(EXIT.usage);
    }
  });
});

describe('isPlausibleEmail', () => {
  it('matches what normalizeEmailForHmac can actually use', () => {
    expect(isPlausibleEmail('owner@example.com')).toBe(true);
    expect(isPlausibleEmail('owner+tag@sub.example.com')).toBe(true);
    expect(isPlausibleEmail('@example.com')).toBe(false);
    expect(isPlausibleEmail('owner@')).toBe(false);
    expect(isPlausibleEmail('owner example@x.com')).toBe(false);
  });
});

describe('normalizeHost', () => {
  it('lowercases, strips IPv6 brackets and one trailing dot', () => {
    expect(normalizeHost('  Example.NEON.tech. ')).toBe('example.neon.tech');
    expect(normalizeHost('[::1]')).toBe('::1');
  });
});

describe('resolveConnectionTarget', () => {
  it('reads only PREVIEW_REHEARSAL_DATABASE_URL and never DATABASE_URL', () => {
    const env = { DATABASE_URL: `postgresql://${FAKE_CREDENTIALS}@production.example.com/neondb` };

    expect(() => resolveConnectionTarget(env, HOST)).toThrowError(/CONNECTION_ENV_MISSING/);
  });

  it('returns the hostname when the typed --expect-host matches exactly', () => {
    const target = resolveConnectionTarget({ [CONNECTION_ENV_VAR]: URL_FOR_HOST }, HOST);

    expect(target.host).toBe(HOST);
    expect(target.connectionString).toBe(URL_FOR_HOST);
  });

  it('refuses when the URL points somewhere other than the typed host', () => {
    const env = { [CONNECTION_ENV_VAR]: `postgresql://${FAKE_CREDENTIALS}@other.neon.tech/neondb` };

    expect(() => resolveConnectionTarget(env, HOST)).toThrowError(/HOST_MISMATCH/);
  });

  it('never leaks the credential half of the URL in the mismatch message', () => {
    const env = { [CONNECTION_ENV_VAR]: `postgresql://${FAKE_LEAK_CREDENTIALS}@other.neon.tech/neondb` };

    try {
      resolveConnectionTarget(env, HOST);

      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain(FAKE_LEAK_PASSWORD);
      expect((error as Error).message).not.toContain(FAKE_LEAK_USER);
    }
  });

  it('refuses a non-postgres protocol, a fragment and whitespace', () => {
    expect(() => resolveConnectionTarget({ [CONNECTION_ENV_VAR]: `mysql://user@${HOST}/db` }, HOST))
      .toThrowError(/PROTOCOL_WRONG/);
    expect(() => resolveConnectionTarget({ [CONNECTION_ENV_VAR]: `${URL_FOR_HOST}#frag` }, HOST))
      .toThrowError(/FRAGMENT_FORBIDDEN/);
    expect(() => resolveConnectionTarget({ [CONNECTION_ENV_VAR]: `${URL_FOR_HOST} ` }, HOST))
      .toThrowError(/CONNECTION_MALFORMED/);
  });

  it.each(['host', 'hostaddr', 'port', 'user', 'password', 'database', 'dbname'])(
    'refuses the routing-override query key %s, which could redirect the driver off the attested host',
    (key) => {
      const env = { [CONNECTION_ENV_VAR]: `${URL_FOR_HOST}&${key}=elsewhere` };

      expect(() => resolveConnectionTarget(env, HOST)).toThrowError(/ROUTING_OVERRIDE_FORBIDDEN/);
    },
  );

  it('carries the refusal exit code', () => {
    try {
      resolveConnectionTarget({}, HOST);

      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as SeedError).exitCode).toBe(EXIT.refusal);
    }
  });
});

describe('assertPreviewMarker', () => {
  it('accepts exactly one row equal to preview', () => {
    expect(() => assertPreviewMarker([{ environment: 'preview' }])).not.toThrow();
  });

  it('refuses zero rows, several rows and any other environment', () => {
    expect(() => assertPreviewMarker([])).toThrowError(/MARKER_ROW_MISSING/);
    expect(() => assertPreviewMarker([{ environment: 'preview' }, { environment: 'preview' }]))
      .toThrowError(/MARKER_ROW_MULTIPLE/);
    expect(() => assertPreviewMarker([{ environment: 'development' }]))
      .toThrowError(/MARKER_ENVIRONMENT_MISMATCH/);
    expect(() => assertPreviewMarker([{ environment: 'production' }]))
      .toThrowError(/MARKER_ENVIRONMENT_MISMATCH/);
  });

  it('classifies a missing marker table distinctly from a failed query', async () => {
    const missing = new MockClient(() => Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    const broken = new MockClient(() => new Error('connection reset'));

    await expect(readAndAssertPreviewMarker(missing)).rejects.toThrowError(/MARKER_TABLE_MISSING/);
    await expect(readAndAssertPreviewMarker(broken)).rejects.toThrowError(/MARKER_QUERY_FAILED/);
  });
});

describe('deterministicIds', () => {
  it('prefixes both ids so authorship is provable from the id alone', () => {
    const ids = deterministicIds('isla-rehearsal');

    expect(ids.salonId).toBe('rehearsal-salon-isla-rehearsal');
    expect(ids.adminId).toBe('rehearsal-admin-isla-rehearsal');
    expect(ids.salonId.startsWith(REHEARSAL_ID_PREFIX)).toBe(true);
    expect(ids.adminId.startsWith(REHEARSAL_ID_PREFIX)).toBe(true);
  });
});

describe('SALON_PLAN_TIERS / resolveTopupAudience', () => {
  it('is byte-identical to the live SALON_PLANS enum', () => {
    expect([...SALON_PLAN_TIERS]).toEqual([...SALON_PLANS]);
  });

  it('passes the Schema.ts text drift check, and fails on a drifted file', async () => {
    const good = async () => `export const SALON_PLANS = ['free', 'single_salon', 'multi_salon', 'enterprise'] as const;\n`;
    const drifted = async () => `export const SALON_PLANS = ['free', 'single_salon'] as const;\n`;
    const absent = async () => 'export const NOTHING = 1;\n';

    await expect(assertPlanTiersMatchSchema(good, 'Schema.ts')).resolves.toBeUndefined();
    await expect(assertPlanTiersMatchSchema(drifted, 'Schema.ts')).rejects.toThrowError(/SCHEMA_PLAN_ENUM_DRIFT/);
    await expect(assertPlanTiersMatchSchema(absent, 'Schema.ts')).rejects.toThrowError(/SCHEMA_PLAN_ENUM_NOT_FOUND/);
  });

  it('agrees with the live resolveTopupAudienceForLegacyPlan for every tier and for NULL', () => {
    for (const tier of SALON_PLANS) {
      expect(resolveTopupAudience(tier)).toBe(resolveTopupAudienceForLegacyPlan(tier));
    }

    expect(resolveTopupAudience(null)).toBe(resolveTopupAudienceForLegacyPlan(null));
    expect(resolveTopupAudience('unrecognized')).toBe(resolveTopupAudienceForLegacyPlan('unrecognized'));
  });

  it('puts the default FREE tier in the free_plan audience and a paid tier in paid_plan', () => {
    expect(resolveTopupAudience('free')).toBe('free_plan');
    expect(resolveTopupAudience('single_salon')).toBe('paid_plan');
  });
});

describe('buildSeedPlan', () => {
  it('builds a live, non-deleted, marker-stamped salon row with the requested tier', () => {
    const plan = buildSeedPlan(parseArguments(baseArgv([
      '--apply',
      '--slug',
      'isla-rehearsal-paid',
      '--name',
      'Isla Rehearsal Paid',
      '--plan-tier',
      'single_salon',
      '--owner-clerk-user-id',
      'user_2abcDEF',
      '--owner-email',
      'owner@example.com',
    ])));

    expect(plan.salon).toEqual({
      id: 'rehearsal-salon-isla-rehearsal-paid',
      name: 'Isla Rehearsal Paid',
      slug: 'isla-rehearsal-paid',
      plan: 'single_salon',
      billing_mode: 'NONE',
      status: 'active',
      publication_status: 'published',
      is_active: true,
      free_solo_enabled: false,
      owner_email: 'owner@example.com',
      owner_clerk_user_id: 'user_2abcDEF',
      internal_notes: REHEARSAL_MARKER,
    });
    expect(plan.topupAudience).toBe('paid_plan');
  });

  it('creates the owner as a NON-super-admin with an owner membership', () => {
    const plan = applyPlan();

    expect(plan.adminUser.is_super_admin).toBe(false);
    expect(plan.adminUser.clerk_user_id).toBe('user_2abcDEF');
    expect(plan.membership).toEqual({
      admin_id: plan.ids.adminId,
      salon_id: plan.ids.salonId,
      role: 'owner',
    });
  });

  it('never plans a stripe customer id, a billing row or an sms credit account', () => {
    const plan = applyPlan();
    const serialized = JSON.stringify(plan);

    expect(Object.keys(plan.salon)).not.toContain('stripe_customer_id');
    expect(Object.keys(plan)).toEqual(['ids', 'salon', 'adminUser', 'membership', 'topupAudience']);
    expect(serialized).not.toContain('sms_credit');
    expect(serialized).not.toContain('billing_starter_grant');
  });
});

describe('classifyExistingSalon', () => {
  const expectedId = 'rehearsal-salon-isla-rehearsal';

  function row(overrides: Partial<ExistingSalonRow> = {}): ExistingSalonRow {
    return {
      id: expectedId,
      slug: 'isla-rehearsal',
      internal_notes: REHEARSAL_MARKER,
      deleted_at: null,
      ...overrides,
    };
  }

  it('reports absent when the slug is free', () => {
    expect(classifyExistingSalon(undefined, expectedId, 'isla-rehearsal')).toBe('absent');
  });

  it('reports owned for its own marker-stamped, prefixed row', () => {
    expect(classifyExistingSalon(row(), expectedId, 'isla-rehearsal')).toBe('owned');
  });

  it('refuses a foreign salon squatting on the slug', () => {
    expect(() => classifyExistingSalon(row({ id: 'salon_nail-salon-no5' }), expectedId, 'isla-rehearsal'))
      .toThrowError(/SALON_SLUG_TAKEN_BY_FOREIGN_ROW/);
  });

  it('refuses a prefixed row whose id is not the deterministic one', () => {
    expect(() => classifyExistingSalon(row({ id: 'rehearsal-salon-something-else' }), expectedId, 'isla-rehearsal'))
      .toThrowError(/SALON_SLUG_TAKEN_BY_FOREIGN_ROW/);
  });

  it('refuses its own id without the internal_notes marker', () => {
    expect(() => classifyExistingSalon(row({ internal_notes: null }), expectedId, 'isla-rehearsal'))
      .toThrowError(/SALON_MARKER_MISSING/);
  });

  it('refuses a soft-deleted row, which the starter grant would 409 on', () => {
    expect(() => classifyExistingSalon(row({ deleted_at: new Date('2026-01-01') }), expectedId, 'isla-rehearsal'))
      .toThrowError(/SALON_SOFT_DELETED/);
  });
});

describe('classifyExistingAdmin', () => {
  const expected: AdminUserInsertRow = {
    id: 'rehearsal-admin-isla-rehearsal',
    name: 'Isla Rehearsal (Preview) owner',
    email: 'Owner@Example.com',
    clerk_user_id: 'user_2abcDEF',
    is_super_admin: false,
  };

  function row(overrides: Partial<ExistingAdminRow> = {}): ExistingAdminRow {
    return {
      id: expected.id,
      email: 'owner@example.com',
      clerk_user_id: 'user_2abcDEF',
      is_super_admin: false,
      ...overrides,
    };
  }

  it('reports absent with no collisions', () => {
    expect(classifyExistingAdmin([], expected)).toBe('absent');
  });

  it('reports owned for an identical re-run, case-insensitively on email', () => {
    expect(classifyExistingAdmin([row()], expected)).toBe('owned');
  });

  it('refuses a foreign admin already holding the email or the Clerk user id', () => {
    expect(() => classifyExistingAdmin([row({ id: 'synthetic-pr193-preview-super-admin' })], expected))
      .toThrowError(/ADMIN_IDENTITY_COLLISION/);
  });

  it('refuses re-running with different owner inputs instead of silently re-pointing the row', () => {
    expect(() => classifyExistingAdmin([row({ email: 'someone.else@example.com' })], expected))
      .toThrowError(/ADMIN_ROW_DIVERGED/);
    expect(() => classifyExistingAdmin([row({ clerk_user_id: 'user_other' })], expected))
      .toThrowError(/ADMIN_ROW_DIVERGED/);
  });

  it('refuses to adopt a super-admin row as the salon owner', () => {
    expect(() => classifyExistingAdmin([row({ is_super_admin: true })], expected))
      .toThrowError(/ADMIN_ROW_DIVERGED/);
  });
});

describe('inspectPreconditions', () => {
  it('is read-only — it issues no INSERT, UPDATE, DELETE or transaction control', async () => {
    const client = new MockClient(freshDatabaseResponder());

    await inspectPreconditions(client, applyPlan());

    for (const call of client.calls) {
      expect(call.text).not.toMatch(/\b(INSERT|UPDATE|DELETE|BEGIN|COMMIT)\b/);
    }
  });

  it('passes the email and the Clerk user id as bound parameters, never interpolated', async () => {
    const client = new MockClient(freshDatabaseResponder());

    await inspectPreconditions(client, applyPlan());
    const adminCall = client.calls.find(call => call.text.includes('FROM public.admin_user'));

    expect(adminCall?.values).toEqual([
      'rehearsal-admin-isla-rehearsal',
      'Owner@Example.com',
      'user_2abcDEF',
    ]);
    expect(adminCall?.text).not.toContain('Owner@Example.com');
  });
});

describe('applySeed', () => {
  it('re-checks the preview marker INSIDE the transaction, before any write', async () => {
    const client = new MockClient(freshDatabaseResponder());

    await applySeed(client, applyPlan());
    const texts = client.texts();
    const beginIndex = texts.indexOf('BEGIN');
    const markerIndex = texts.indexOf(MARKER_QUERY);
    const firstInsert = texts.findIndex(text => text.startsWith('INSERT INTO'));

    expect(beginIndex).toBe(0);
    expect(markerIndex).toBeGreaterThan(beginIndex);
    expect(markerIndex).toBeLessThan(firstInsert);
  });

  it('takes a transaction-scoped advisory lock on the slug before reading it', async () => {
    const client = new MockClient(freshDatabaseResponder());

    await applySeed(client, applyPlan());
    const lockIndex = client.calls.findIndex(call => call.text.includes('pg_advisory_xact_lock'));
    const readIndex = client.calls.findIndex(call => call.text.includes('FROM public.salon'));

    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(readIndex);
    expect(client.calls[lockIndex]?.values).toEqual(['rehearsal-seed:isla-rehearsal']);
  });

  it('inserts exactly three rows and commits', async () => {
    const client = new MockClient(freshDatabaseResponder());

    const outcome = await applySeed(client, applyPlan());
    const inserts = client.texts().filter(text => text.startsWith('INSERT INTO'));

    expect(inserts).toEqual([
      'INSERT INTO public.salon (',
      'INSERT INTO public.admin_user (id, name, email, clerk_user_id, is_super_admin, email_verified_at)',
      'INSERT INTO public.admin_salon_membership (admin_id, salon_id, role)',
    ]);
    expect(client.texts().at(-1)).toBe('COMMIT');
    expect(outcome).toEqual({
      salonInserted: true,
      adminInserted: true,
      membershipInserted: true,
      ids: {
        salonId: 'rehearsal-salon-isla-rehearsal',
        adminId: 'rehearsal-admin-isla-rehearsal',
      },
    });
  });

  it('references no billing_* or sms_* TABLE (salon.billing_mode is a column, not a table)', async () => {
    const client = new MockClient(freshDatabaseResponder());

    await applySeed(client, applyPlan());

    for (const call of client.calls) {
      expect(call.text).not.toContain('public.billing_');
      expect(call.text).not.toContain('public.sms_');
    }
    // Every table this script names, in full.
    const tables = new Set(
      client.calls.flatMap(call => [...call.text.matchAll(/public\.(\w+)/g)].map(match => match[1] as string)),
    );

    expect([...tables].sort()).toEqual(['admin_salon_membership', 'admin_user', 'luster_environment', 'salon']);
  });

  it('is idempotent: a replay inserts nothing and still reports the same ids', async () => {
    const plan = applyPlan();
    const client = new MockClient((text) => {
      if (text === MARKER_QUERY) {
        return markerRows();
      }
      if (text.includes('pg_advisory_xact_lock')) {
        return { rows: [{ pg_advisory_xact_lock: null }] };
      }
      if (text.includes('FROM public.salon')) {
        return {
          rows: [{
            id: plan.ids.salonId,
            slug: plan.salon.slug,
            internal_notes: REHEARSAL_MARKER,
            deleted_at: null,
          }],
        };
      }
      if (text.includes('FROM public.admin_user')) {
        return {
          rows: [{
            id: plan.ids.adminId,
            email: 'owner@example.com',
            clerk_user_id: 'user_2abcDEF',
            is_super_admin: false,
          }],
        };
      }
      if (text.includes('FROM public.admin_salon_membership')) {
        return { rows: [{ role: 'owner' }] };
      }
      // ON CONFLICT DO NOTHING returns no row.
      return EMPTY;
    });

    const outcome = await applySeed(client, plan);

    expect(outcome.salonInserted).toBe(false);
    expect(outcome.adminInserted).toBe(false);
    expect(outcome.membershipInserted).toBe(false);
    expect(outcome.ids).toEqual(plan.ids);
    expect(client.texts().at(-1)).toBe('COMMIT');
  });

  it('rolls back and never commits when the in-transaction marker is wrong', async () => {
    const client = new MockClient((text) => {
      if (text === MARKER_QUERY) {
        return markerRows('production');
      }
      return EMPTY;
    });

    await expect(applySeed(client, applyPlan())).rejects.toThrowError(/MARKER_ENVIRONMENT_MISMATCH/);
    expect(client.texts()).toContain('ROLLBACK');
    expect(client.texts()).not.toContain('COMMIT');
    expect(client.texts().some(text => text.startsWith('INSERT INTO'))).toBe(false);
  });

  it('rolls back when a foreign salon holds the slug', async () => {
    const client = new MockClient((text) => {
      if (text === MARKER_QUERY) {
        return markerRows();
      }
      if (text.includes('pg_advisory_xact_lock')) {
        return EMPTY;
      }
      if (text.includes('FROM public.salon')) {
        return { rows: [{ id: 'salon_nail-salon-no5', slug: 'isla-rehearsal', internal_notes: null, deleted_at: null }] };
      }
      return EMPTY;
    });

    await expect(applySeed(client, applyPlan())).rejects.toThrowError(/SALON_SLUG_TAKEN_BY_FOREIGN_ROW/);
    expect(client.texts()).toContain('ROLLBACK');
    expect(client.texts()).not.toContain('COMMIT');
  });
});

describe('runVerify', () => {
  function verifyResponder(overrides: Record<string, unknown> = {}): Responder {
    return (text) => {
      if (text.includes('FROM public.salon')) {
        return {
          rows: [{
            id: 'rehearsal-salon-isla-rehearsal',
            slug: 'isla-rehearsal',
            plan: 'free',
            billing_mode: 'NONE',
            status: 'active',
            publication_status: 'published',
            is_active: true,
            deleted_at: null,
            owner_email: 'owner@example.com',
            owner_clerk_user_id: 'user_2abcDEF',
            stripe_customer_id: null,
            internal_notes: REHEARSAL_MARKER,
            ...overrides,
          }],
        };
      }
      if (text.includes('FROM public.admin_salon_membership')) {
        return {
          rows: [{
            admin_id: 'rehearsal-admin-isla-rehearsal',
            role: 'owner',
            is_super_admin: false,
            clerk_user_id: 'user_2abcDEF',
          }],
        };
      }
      if (text.includes('billing_business_identity_link')) {
        return {
          rows: [{
            id: 'bil_1',
            link_type: 'salon',
            business_identity_id: 'bid_1',
            hmac_key_version: null,
          }],
        };
      }
      if (text.includes('billing_starter_grant')) {
        return {
          rows: [{
            billing_starter_grant: '1',
            billing_subscription: '0',
            billing_checkout_attempt: '0',
            billing_promotion_claim: '0',
            sms_credit_account: '1',
            sms_credit_ledger: '1',
            sms_topup_purchase: '0',
          }],
        };
      }
      return EMPTY;
    };
  }

  it('is read-only — no write and no transaction control', async () => {
    const client = new MockClient(verifyResponder());

    await runVerify(client, 'isla-rehearsal');

    for (const call of client.calls) {
      expect(call.text).not.toMatch(/\b(INSERT|UPDATE|DELETE|BEGIN|COMMIT|pg_advisory)\b/);
    }
  });

  it('reports the salon summary, the admin link, the identity link and the billing counts', async () => {
    const client = new MockClient(verifyResponder());

    const report = await runVerify(client, 'isla-rehearsal');

    expect(report.salon.id).toBe('rehearsal-salon-isla-rehearsal');
    expect(report.salon.authoredByThisScript).toBe(true);
    expect(report.salon.deletedAt).toBe(false);
    expect(report.salon.stripeCustomerId).toBeNull();
    expect(report.admins).toEqual([{
      adminId: 'rehearsal-admin-isla-rehearsal',
      role: 'owner',
      isSuperAdmin: false,
      clerkUserId: 'user_2abcDEF',
    }]);
    expect(report.identityLinks).toEqual([{
      linkId: 'bil_1',
      linkType: 'salon',
      businessIdentityId: 'bid_1',
      hmacKeyVersion: null,
    }]);
    expect(report.billingCounts).toEqual({
      billing_starter_grant: 1,
      billing_subscription: 0,
      billing_checkout_attempt: 0,
      billing_promotion_claim: 0,
      sms_credit_account: 1,
      sms_credit_ledger: 1,
      sms_topup_purchase: 0,
    });
  });

  it('reports owner_email as a boolean, never the address itself', async () => {
    const client = new MockClient(verifyResponder());

    const report = await runVerify(client, 'isla-rehearsal');

    expect(report.salon.ownerEmailSet).toBe(true);
    expect(JSON.stringify(report)).not.toContain('owner@example.com');
  });

  it('flags a salon this script did not author', async () => {
    const client = new MockClient(verifyResponder({ internal_notes: null }));

    const report = await runVerify(client, 'isla-rehearsal');

    expect(report.salon.authoredByThisScript).toBe(false);
  });

  it('fails with the verification exit code when the slug is not on this database', async () => {
    const client = new MockClient(() => EMPTY);

    try {
      await runVerify(client, 'isla-rehearsal');

      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as SeedError).code).toBe('SALON_NOT_FOUND');
      expect((error as SeedError).exitCode).toBe(EXIT.verification);
    }
  });
});

describe('enforceReadOnlySession (gate 6)', () => {
  it('issues the SET first and then proves it with SHOW, in that order', async () => {
    const client = new MockClient(text => (
      text === READ_ONLY_PROBE_QUERY ? { rows: [{ transaction_read_only: 'on' }] } : EMPTY
    ));

    await enforceReadOnlySession(client);

    expect(client.texts()).toEqual([READ_ONLY_SESSION_STATEMENT, READ_ONLY_PROBE_QUERY]);
  });

  it('uses the session-wide form, so a later transaction cannot silently be read-write', () => {
    expect(READ_ONLY_SESSION_STATEMENT).toBe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    expect(READ_ONLY_PROBE_QUERY).toBe('SHOW transaction_read_only');
  });

  it('refuses when the server reports the session is still read-write', async () => {
    const client = new MockClient(text => (
      text === READ_ONLY_PROBE_QUERY ? { rows: [{ transaction_read_only: 'off' }] } : EMPTY
    ));

    await expect(enforceReadOnlySession(client)).rejects.toThrow(/READ_ONLY_SESSION_NOT_ESTABLISHED/);
    await expect(enforceReadOnlySession(client)).rejects.toMatchObject({ exitCode: EXIT.refusal });
  });

  it('refuses when the probe returns nothing at all, rather than assuming success', async () => {
    const client = new MockClient(() => EMPTY);

    await expect(enforceReadOnlySession(client)).rejects.toThrow(/READ_ONLY_SESSION_NOT_ESTABLISHED/);
  });

  it('refuses when the server rejects the SET, and when the probe cannot be read back', async () => {
    const rejectsSet = new MockClient(text => (
      text === READ_ONLY_SESSION_STATEMENT ? new Error('permission denied') : EMPTY
    ));
    const rejectsProbe = new MockClient(text => (
      text === READ_ONLY_PROBE_QUERY ? new Error('pooler ate it') : EMPTY
    ));

    await expect(enforceReadOnlySession(rejectsSet)).rejects.toThrow(/READ_ONLY_SESSION_REFUSED/);
    await expect(enforceReadOnlySession(rejectsProbe)).rejects.toThrow(/READ_ONLY_SESSION_UNVERIFIABLE/);
  });

  it('never names the connection string — the refusal quotes only the statement', async () => {
    const client = new MockClient(text => (
      text === READ_ONLY_PROBE_QUERY ? { rows: [{ transaction_read_only: 'off' }] } : EMPTY
    ));

    const error = await enforceReadOnlySession(client).then(() => null, (thrown: unknown) => thrown as Error);

    expect(error?.message).not.toContain(HOST);
    expect(error?.message).not.toContain('user');
  });
});

describe('buildConnectionRedactor (gate 6b)', () => {
  const redact = buildConnectionRedactor(URL_FOR_HOST);

  it('redacts the role name out of a pg 28P01 message', () => {
    // The literal text PostgreSQL produces for a wrong credential.
    const redacted = redact(`password authentication failed for user "${FAKE_USER}"`);

    expect(redacted).not.toContain(`"${FAKE_USER}"`);
    expect(redacted).toContain('[redacted:user]');
  });

  it('redacts the password and the host as well', () => {
    const redacted = redact(`could not connect to ${HOST} as ${FAKE_USER} with password ${FAKE_PASSWORD}`);

    expect(redacted).not.toContain(HOST);
    expect(redacted).not.toContain(FAKE_PASSWORD);
    expect(redacted).toContain('[redacted:host]');
  });

  it('redacts the whole connection string if an error ever echoes it', () => {
    const redacted = redact(`invalid dsn: ${URL_FOR_HOST}`);

    expect(redacted).toBe('invalid dsn: [redacted:connection-string]');
    expect(redacted).not.toContain(FAKE_PASSWORD);
  });

  it('redacts a percent-encoded credential in either form', () => {
    const encoded = buildConnectionRedactor(`postgresql://${FAKE_ENCODED_CREDENTIALS}@${HOST}/neondb`);

    expect(encoded('failed for user "ne@on"')).toContain('[redacted:user]');
    expect(encoded('failed for user "ne%40on"')).toContain('[redacted:user]');
    expect(encoded('failed for user "ne@on"')).not.toContain('ne@on');
  });

  it('leaves an unrelated message untouched and survives an unset or unparseable variable', () => {
    expect(redact('ECONNREFUSED')).toBe('ECONNREFUSED');
    expect(buildConnectionRedactor(undefined)('anything at all')).toBe('anything at all');
    expect(buildConnectionRedactor('')('anything at all')).toBe('anything at all');
    expect(buildConnectionRedactor('not a url')('saw: not a url')).toBe('saw: [redacted:connection-string]');
  });

  it('redacts the longest fragment first, so no tail of a credential survives', () => {
    // A password that CONTAINS the user name: a naive shortest-first pass would
    // leave the rest of the password behind.
    const overlapping = buildConnectionRedactor(`postgresql://${FAKE_OVERLAPPING_CREDENTIALS}@${HOST}/db`);
    const redacted = overlapping('password authentication failed: ne / neonpassword');

    expect(redacted).not.toContain('neonpassword');
  });
});

// ---------------------------------------------------------------------------
// Flag surface and structural gates
// ---------------------------------------------------------------------------

describe('USAGE stays accurate', () => {
  it('documents every flag the parser accepts, and accepts every flag it documents', () => {
    const documented = [...USAGE.matchAll(/^\s{2}(--[a-z-]+)/gm)].map(match => match[1] as string);
    const expected = [
      '--plan',
      '--apply',
      '--verify',
      '--expect-host',
      '--slug',
      '--name',
      '--plan-tier',
      '--owner-clerk-user-id',
      '--owner-email',
    ];

    expect(documented).toEqual(expected);

    const companions: Record<string, string[]> = {
      '--expect-host': [HOST],
      '--slug': ['isla-rehearsal'],
      '--name': ['Isla Rehearsal (Preview)'],
      '--plan-tier': ['free'],
      '--owner-clerk-user-id': ['user_rehearsal'],
      '--owner-email': ['owner@example.com'],
    };
    const standalone: Record<string, string[]> = {
      // --apply is the one mode whose owner identity is mandatory.
      '--apply': [
        '--expect-host',
        HOST,
        '--apply',
        '--owner-clerk-user-id',
        'user_rehearsal',
        '--owner-email',
        'owner@example.com',
      ],
    };
    for (const flag of expected) {
      const argv = standalone[flag] ?? ['--expect-host', HOST, flag, ...(companions[flag] ?? [])];

      expect(() => parseArguments(argv)).not.toThrow();
    }
  });

  it('names the connection variable, the preview marker and the super-admin refusal', () => {
    expect(USAGE).toContain(CONNECTION_ENV_VAR);
    expect(USAGE).toContain('never DATABASE_URL');
    expect(USAGE).toContain('preview');
    expect(USAGE).toContain('NEVER creates a super-admin');
    expect(USAGE).toContain('docs/BILLING_PREVIEW_REHEARSAL.md');
  });

  it('carries no connection string, password or host of its own', () => {
    expect(USAGE).not.toMatch(/postgres(?:ql)?:\/\//);
    expect(USAGE).not.toMatch(/neon\.tech/);
  });
});

describe('structural gates hold in the source text', () => {
  const source = fs.readFileSync(
    path.join(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
      'scripts',
      'billing-preview-rehearsal-seed.ts',
    ),
    'utf8',
  );

  it('imports no child_process, no Drizzle pool and no server-only module', () => {
    const imports = [...source.matchAll(/^import[^;]*?from\s+'([^']+)';/gm)].map(match => match[1] as string);

    expect(imports).not.toContain('node:child_process');
    expect(imports).not.toContain('child_process');
    expect(imports).not.toContain('server-only');
    expect(imports.some(specifier => specifier.includes('libs/DB'))).toBe(false);
    expect(imports.some(specifier => specifier.includes('libs/Env'))).toBe(false);
    expect(imports.some(specifier => specifier.startsWith('@vercel/'))).toBe(false);
    expect(source).not.toMatch(/\bexecSync\b|\bspawnSync\b/);

    // A DYNAMIC import would slip past the static allowlist above. This script
    // does use `await import('node:fs/promises')`, so the containment is aimed
    // at the three modules that would reintroduce a pool, the validated Env or
    // a Stripe client.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/import\(['"][^'"]*libs\/(DB|Env|stripe)/);
  });

  it('imports ONLY from the allowlist, so a new dependency cannot slip past the denylist', () => {
    // The positive form of the gate above: Node builtins and the raw `pg`
    // client, and nothing else. Anything from `src/` would drag in either
    // `server-only` or a Drizzle pool built from DATABASE_URL.
    const allowed = /^node:|^pg$/;
    const imports = [...source.matchAll(/^import[^;]*?from\s+'([^']+)';/gm)].map(match => match[1] as string);

    expect(imports.length).toBeGreaterThan(0);

    for (const specifier of imports) {
      expect(specifier).toMatch(allowed);
    }
  });

  it('reads the connection string from one variable only, never DATABASE_URL', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).toContain('CONNECTION_ENV_VAR');
    expect(code).not.toMatch(/process\.env\.DATABASE_URL/);
  });

  it('writes with ON CONFLICT DO NOTHING only, and never UPDATEs or DELETEs a row', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const inserts = [...code.matchAll(/INSERT INTO[\s\S]*?RETURNING/g)].map(match => match[0]);

    expect(inserts).toHaveLength(3);

    for (const statement of inserts) {
      expect(statement).toContain('ON CONFLICT');
      expect(statement).toContain('DO NOTHING');
    }

    expect(code).not.toMatch(/\bUPDATE public\./);
    expect(code).not.toMatch(/\bDELETE FROM\b/);
    expect(code).not.toMatch(/\bDROP\b|\bTRUNCATE\b/);
  });

  it('hard-codes is_super_admin false in the only admin_user insert', () => {
    expect(source).toMatch(/INSERT INTO public\.admin_user[\s\S]*?VALUES \(\$1, \$2, \$3, \$4, false,/);
  });
});
