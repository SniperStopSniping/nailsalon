import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parse } from 'dotenv';

import { assertLocalAcceptanceEnvironment } from './safety';

const action = process.argv[2];
if (action !== 'server' && action !== 'test' && action !== 'test-setup') {
  throw new Error('Choose the fixed server, test, or test-setup acceptance action.');
}
if (['.env', '.env.local', '.env.development', '.env.development.local'].some(file => existsSync(file))) {
  throw new Error('Use a clean acceptance worktree without local dotenv files; credentials are read only from the external Development source.');
}
const sourcePath = process.env.LIVE_DEVELOPMENT_ENV_FILE ?? '';
if (!path.isAbsolute(sourcePath) || !/^\.env\.development(?:\.local)?$/.test(path.basename(sourcePath))) {
  throw new Error('Provide an absolute Development-only credential source path.');
}
const source = parse(readFileSync(sourcePath));
const localPostgresURL = process.env.LIVE_LOCAL_POSTGRES_URL ?? '';
if (localPostgresURL && (!process.env.LIVE_RUNTIME_DIR || !process.env.LIVE_RUN_SUFFIX)) {
  throw new Error('Local PostgreSQL acceptance requires an explicit shared runtime directory and run scope.');
}
const runtimeDirectory = process.env.LIVE_RUNTIME_DIR
  ?? (action === 'server' ? mkdtempSync(path.join(tmpdir(), 'luster-live-acceptance-')) : '');
if (!runtimeDirectory || !path.isAbsolute(runtimeDirectory)) {
  throw new Error('The test action requires the server’s explicit disposable LIVE_RUNTIME_DIR.');
}
const runId = process.env.LIVE_RUN_SUFFIX ?? `acceptance-${randomUUID()}`;
const project = process.env.LIVE_BROWSER_PROJECT ?? 'chromium-live';
if (!['chromium-live', 'webkit-live'].includes(project)) {
  throw new Error('Choose chromium-live or webkit-live for local acceptance.');
}
const baseURL = 'http://localhost:4211';
// Only the Clerk pair is imported from dotenv. The optional database URL uses
// a separate explicit input and must pass the exact loopback/run/role guard.
// Inherited DATABASE_URL and external provider configuration are never copied.
const environment: NodeJS.ProcessEnv = {
  APP_ENV: 'development',
  BILLING_PLAN_ENV: 'dev',
  CLERK_PUBLISHABLE_KEY: source.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  CLERK_SECRET_KEY: source.CLERK_SECRET_KEY,
  DATABASE_URL: localPostgresURL,
  HOME: process.env.HOME,
  LANG: process.env.LANG,
  LEGACY_OTP_AUTH_ENABLED: 'false',
  LIVE_BASE_URL: baseURL,
  // Set to the exact run ID only after explicit irreversible-cleanup consent.
  LIVE_CLERK_CLEANUP_CONFIRMED: process.env.LIVE_CLERK_CLEANUP_CONFIRMED,
  LIVE_DISPOSABLE_LOCAL_CONFIRMED: 'true',
  LIVE_EVIDENCE_DIR: path.join(runtimeDirectory, 'evidence'),
  LIVE_LOCAL_POSTGRES_CONFIRMED: process.env.LIVE_LOCAL_POSTGRES_CONFIRMED,
  LIVE_RUN_SUFFIX: runId,
  LUSTER_ONBOARDING_MEDIA_DIR: path.join(runtimeDirectory, 'media'),
  LUSTER_ONBOARDING_V1_INTEGRATION_ENABLED: 'true',
  LUSTER_PGLITE_DATA_DIR: path.join(runtimeDirectory, 'database'),
  LUSTER_SECTION_LIBRARY_V1_ENABLED: 'true',
  NEXT_PUBLIC_APP_URL: baseURL,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: source.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/owner-sign-in',
  NEXT_PUBLIC_DEV_MODE: 'false',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_local_acceptance_no_provider',
  NODE_ENV: 'development',
  PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ''}`,
  PUBLIC_APP_URL: baseURL,
  STRIPE_SECRET_KEY: 'sk_test_local_acceptance_no_provider',
  STRIPE_WEBHOOK_SECRET: 'whsec_local_acceptance_no_provider',
  TENANT_SUBDOMAINS_ENABLED: 'false',
  TERM: process.env.TERM,
  TMPDIR: process.env.TMPDIR,
};
assertLocalAcceptanceEnvironment(environment);
mkdirSync(environment.LIVE_EVIDENCE_DIR!, { recursive: true, mode: 0o700 });
process.stdout.write(`Disposable acceptance ${action}: ${baseURL}\nRuntime directory: ${runtimeDirectory}\nRun scope: ${runId}\n`);
const args = action === 'server'
  ? ['node_modules/next/dist/bin/next', 'dev', '--hostname', 'localhost', '--port', '4211']
  : ['node_modules/@playwright/test/cli.js', 'test', '--config=live-acceptance/playwright.live.config.ts', `--project=${project}`];
if (action === 'test-setup') {
  args.push('--grep=Clerk setup propagates|obtain a Clerk development testing token');
}
const child = spawn(process.execPath, args, { env: environment, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', code => process.exit(code ?? 1));
