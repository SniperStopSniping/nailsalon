import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import {
  getClientLifecycleSchemaReadiness,
  type LifecycleReadinessSqlHandle,
} from '@/libs/clientLifecycleSchemaCore';

const { Pool } = pg;

type VerificationOutput = {
  ready: boolean;
  failedCategories: string[];
  milliseconds: number;
};

function writeResult(output: VerificationOutput, error = false): void {
  const serialized = `${JSON.stringify(output)}\n`;
  if (error) {
    process.stderr.write(serialized);
  } else {
    process.stdout.write(serialized);
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    writeResult({
      ready: false,
      failedCategories: ['configuration'],
      milliseconds: 0,
    }, true);
    process.exitCode = 1;
    return;
  }

  const startedAt = performance.now();
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    application_name: 'client-lifecycle-readiness',
    connectionTimeoutMillis: 15_000,
    statement_timeout: 30_000,
  });

  try {
    const database = drizzle(pool);
    const readiness = await getClientLifecycleSchemaReadiness(
      database as LifecycleReadinessSqlHandle,
    );
    const failedCategories = Object.entries(readiness.categories)
      .filter(([, ready]) => !ready)
      .map(([category]) => category);

    writeResult({
      ready: readiness.ready,
      failedCategories,
      milliseconds: Number((performance.now() - startedAt).toFixed(2)),
    }, !readiness.ready);

    if (!readiness.ready) {
      process.exitCode = 1;
    }
  } catch {
    writeResult({
      ready: false,
      failedCategories: ['unavailable'],
      milliseconds: Number((performance.now() - startedAt).toFixed(2)),
    }, true);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

void main();
