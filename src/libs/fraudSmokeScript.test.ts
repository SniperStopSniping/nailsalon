import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type FraudSmokePoolFactory,
  runFraudSmokeTests,
} from '../../scripts/smoke-test-fraud-system';

type MarkerBehavior
  = | { kind: 'environment'; value: string }
  | { kind: 'failure' }
  | { kind: 'missing' };

function smokeDatabase(marker: MarkerBehavior = { kind: 'environment', value: 'development' }) {
  const configurations: Parameters<FraudSmokePoolFactory>[0][] = [];
  const queries: string[] = [];
  let endCount = 0;
  const smokeResponses = [
    { rows: [{ count: '0' }] },
    { rows: [{ indexname: 'fraud_signal_appt_type_unique' }] },
    { rows: [] },
    { rows: [{ count: '0' }] },
    { rows: [] },
    { rows: [{ count: '0' }] },
    { rows: [{ count: '0' }] },
    { rows: [{ total: '0', resolved: '0', with_resolved_by: '0' }] },
    { rows: [{ indexname: 'fraud_signal_unresolved_idx' }] },
  ];

  const createPool: FraudSmokePoolFactory = (configuration) => {
    configurations.push(configuration);

    return {
      async end() {
        endCount += 1;
      },
      async query(queryText: string) {
        queries.push(queryText);
        if (queries.length === 1) {
          if (marker.kind === 'failure') {
            throw new Error('synthetic marker query failure');
          }
          if (marker.kind === 'missing') {
            return { rows: [] };
          }
          return { rows: [{ environment: marker.value }] };
        }

        const response = smokeResponses.shift();
        if (!response) {
          throw new Error('Unexpected fraud smoke query.');
        }
        return response;
      },
    } as never;
  };

  return {
    configurations,
    createPool,
    get endCount() {
      return endCount;
    },
    queries,
  };
}

describe('fraud smoke database guards', () => {
  let loggedValues: unknown[];

  beforeEach(() => {
    loggedValues = [];
    vi.spyOn(console, 'log').mockImplementation((...values) => {
      loggedValues.push(...values);
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows a loopback disposable database only after Development attestation', async () => {
    const database = smokeDatabase();
    const connectionString
      = 'postgresql://127.0.0.1:55432/luster_fraud_smoke';

    await expect(runFraudSmokeTests(
      { DATABASE_URL: connectionString },
      database.createPool,
    )).resolves.toBe(0);

    expect(database.configurations).toEqual([{
      connectionString,
      ssl: undefined,
    }]);
    expect(database.queries).toHaveLength(10);
    expect(database.queries[0]).toContain('public.luster_environment');
    expect(database.queries[1]).toContain('fraud_signal');
    expect(database.endCount).toBe(1);
  });

  it('allows an exact allowlisted remote host with the correct marker', async () => {
    const database = smokeDatabase();
    const connectionString
      = 'postgresql://ep-development.aws.neon.tech/luster_development?sslmode=require';

    await expect(runFraudSmokeTests({
      DATABASE_URL: connectionString,
      LUSTER_NONPROD_DB_HOSTS: ' EP-DEVELOPMENT.AWS.NEON.TECH ',
    }, database.createPool)).resolves.toBe(0);

    expect(database.configurations).toEqual([{
      connectionString,
      ssl: { rejectUnauthorized: false },
    }]);
    expect(database.queries[0]).toContain('public.luster_environment');
  });

  it('never logs the validated connection string or request data', async () => {
    const database = smokeDatabase();
    const password = ['never', 'print', 'part@after', 'password'].join('-');
    const querySecret = ['never', 'print', 'query'].join('-');
    const target = new URL('postgresql://localhost/luster_private');
    target.username = 'synthetic';
    target.password = password;
    target.searchParams.set('token', querySecret);
    const connectionString = target.toString();

    await expect(runFraudSmokeTests(
      { DATABASE_URL: connectionString },
      database.createPool,
    )).resolves.toBe(0);

    const output = loggedValues.join('\n');

    expect(output).toContain('Database host: localhost');
    expect(output).not.toContain(connectionString);
    expect(output).not.toContain(password);
    expect(output).not.toContain(querySecret);
    expect(output).not.toContain('synthetic');
    expect(output).not.toContain('luster_private');
    expect(database.configurations[0]?.connectionString).toBe(connectionString);
  });

  it.each([
    [
      'Production host',
      { DATABASE_URL: 'postgresql://ep-production.aws.neon.tech/luster' },
      'HOSTED_PROVIDER_NOT_ALLOWLISTED',
    ],
    [
      'malformed URL',
      { DATABASE_URL: 'postgresql://localhost/luster%ZZ' },
      'MALFORMED_URL',
    ],
    [
      'routing override',
      { DATABASE_URL: 'postgresql://localhost/luster?host=production.invalid' },
      'ROUTING_OVERRIDE_FORBIDDEN',
    ],
  ])('rejects a %s before pool creation', async (_name, environment, code) => {
    const database = smokeDatabase();

    await expect(runFraudSmokeTests(
      environment,
      database.createPool,
    )).rejects.toMatchObject({ code });

    expect(database.configurations).toEqual([]);
    expect(database.queries).toEqual([]);
  });

  it.each([
    ['missing marker', { kind: 'missing' } as const],
    ['wrong marker', { kind: 'environment', value: 'production' } as const],
    ['marker query failure', { kind: 'failure' } as const],
  ])('rejects a %s before any fraud query or write', async (_name, marker) => {
    const database = smokeDatabase(marker);

    await expect(runFraudSmokeTests(
      { DATABASE_URL: 'postgresql://localhost/luster_fraud_smoke' },
      database.createPool,
    )).resolves.toBe(1);

    expect(database.queries).toHaveLength(1);
    expect(database.queries[0]).toContain('public.luster_environment');
    expect(database.queries.some(query => /\b(?:delete|insert|truncate|update)\b/i.test(query))).toBe(false);
    expect(database.endCount).toBe(1);
  });
});
