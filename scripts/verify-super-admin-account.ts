#!/usr/bin/env tsx
/* eslint-disable no-console */

import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
const configuredPhone = process.env.SUPER_ADMIN_TEST_PHONE;

if (!databaseUrl || !configuredPhone) {
  console.error('Super-admin account verification requires DATABASE_URL and SUPER_ADMIN_TEST_PHONE.');
  process.exit(1);
}

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    const result = await client.query<{
      matching_users: number;
      matching_super_admins: number;
    }>(`
    SELECT
      count(*)::int AS matching_users,
      count(*) FILTER (WHERE is_super_admin = true)::int AS matching_super_admins
    FROM admin_user
    WHERE phone_e164 = $1
  `, [configuredPhone]);

    const counts = result.rows[0];
    if (counts?.matching_users !== 1 || counts.matching_super_admins !== 1) {
      console.error('Super-admin account verification failed: expected exactly one existing privileged account.');
      process.exitCode = 1;
    } else {
      console.log('Super-admin account verification passed.');
    }
  } finally {
    await client.end();
  }
}

void main().catch(() => {
  console.error('Super-admin account verification could not reach the database.');
  process.exitCode = 1;
});
