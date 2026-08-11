/**
 * The deposits migration-application probe (charter test 25).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import {
  DEPOSITS_MIGRATION_CREATED_AT,
  type DepositsReadinessSqlHandle,
  isDepositsSchemaReady,
} from './depositsSchema';

vi.mock('server-only', () => ({}));

let migrated: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  await client.waitReady;
  migrated = drizzle(client, { schema });
  await migrate(migrated, { migrationsFolder: path.join(process.cwd(), 'migrations') });
});

describe('test 25 — isDepositsSchemaReady', () => {
  it('is true against a fully migrated database', async () => {
    expect(await isDepositsSchemaReady(migrated as unknown as DepositsReadinessSqlHandle))
      .toBe(true);
  });

  it('NEVER throws — a failing handle resolves to false', async () => {
    // Every D2 route depends on this: the probe must be able to say "not ready"
    // rather than surfacing a raw Postgres error to a caller.
    const exploding: DepositsReadinessSqlHandle = {
      execute: async () => {
        throw new Error('relation "salon_stripe_account" does not exist');
      },
    };

    await expect(isDepositsSchemaReady(exploding)).resolves.toBe(false);
  });

  it('is false against a database that has not run 0065', async () => {
    const bare = new PGlite();
    await bare.waitReady;
    const bareDb = drizzle(bare, { schema });

    expect(await isDepositsSchemaReady(bareDb as unknown as DepositsReadinessSqlHandle))
      .toBe(false);

    await bare.close();
  });

  it('pins the 0065 journal timestamp', () => {
    // Matching the migrator's own ledger entry proves THIS migration ran, not
    // merely that tables of the same name exist.
    const journal = JSON.parse(
      readFileSync(path.join(process.cwd(), 'migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: { idx: number; when: number; tag: string }[] };
    const entry = journal.entries.find(candidate => candidate.tag === '0065_deposits_foundation');

    expect(entry?.when).toBe(DEPOSITS_MIGRATION_CREATED_AT);
  });
});
