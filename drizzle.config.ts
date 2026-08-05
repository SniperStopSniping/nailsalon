import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './migrations',
  schema: './src/models/Schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    // Database-bearing Drizzle commands must enter through
    // scripts/database-command.ts. That wrapper performs the appropriate
    // Production confirmation or non-Production marker attestation before it
    // supplies this one-process-only value. An ambient DATABASE_URL is never
    // accepted here, so `npx drizzle-kit migrate|studio` fails closed.
    url: process.env.LUSTER_GUARDED_DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
