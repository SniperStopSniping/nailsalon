import { createHash } from 'node:crypto';
import path from 'node:path';

type AcceptanceEnvironment = Record<string, string | undefined>;

const FORBIDDEN_PROVIDER_KEYS = [
  'RESEND_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_MESSAGING_SERVICE_SID',
  'CLOUDINARY_API_SECRET',
  'GOOGLE_OAUTH_CLIENT_SECRET',
] as const;

/** Local-only acceptance is intentionally stricter than the Preview E2E gate. */
export function assertLocalAcceptanceEnvironment(
  environment: AcceptanceEnvironment,
  repositoryRoot = process.cwd(),
): { baseURL: string; evidenceDirectory: string; runId: string } {
  const url = new URL(environment.LIVE_BASE_URL ?? '');
  if (
    environment.LIVE_DISPOSABLE_LOCAL_CONFIRMED !== 'true'
    || environment.APP_ENV !== 'development'
    || environment.NODE_ENV === 'production'
    || environment.VERCEL
    || environment.VERCEL_ENV
    || url.protocol !== 'http:'
    || !['localhost', '127.0.0.1'].includes(url.hostname)
    || !url.port
    || url.pathname !== '/'
    || url.username || url.password || url.search || url.hash
  ) {
    throw new Error('Live acceptance requires an explicitly confirmed disposable loopback target.');
  }
  if (
    !environment.CLERK_SECRET_KEY?.startsWith('sk_test_')
    || !environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_')
    || environment.CLERK_PUBLISHABLE_KEY !== environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    || FORBIDDEN_PROVIDER_KEYS.some(key => environment[key]?.trim())
    || (environment.STRIPE_SECRET_KEY && environment.STRIPE_SECRET_KEY !== 'sk_test_local_acceptance_no_provider')
  ) {
    throw new Error('Live acceptance requires paired Clerk test keys and disabled external data/message/media providers.');
  }
  const runId = environment.LIVE_RUN_SUFFIX ?? '';
  if (!/^acceptance-[a-z0-9-]{12,80}$/.test(runId)) {
    throw new Error('Live acceptance requires a unique run-scoped identity suffix.');
  }
  if (environment.DATABASE_URL || environment.LIVE_LOCAL_POSTGRES_CONFIRMED) {
    const database = new URL(environment.DATABASE_URL ?? '');
    const expected = runScopedPostgresName(runId);
    if (
      environment.LIVE_LOCAL_POSTGRES_CONFIRMED !== 'true'
      || !['postgres:', 'postgresql:'].includes(database.protocol)
      || !['localhost', '127.0.0.1'].includes(database.hostname)
      || database.port !== '55441'
      || database.username !== expected
      || database.pathname !== `/${expected}`
      || database.search || database.hash
    ) {
      throw new Error('Acceptance PostgreSQL requires the exact run-scoped loopback database and role on port 55441.');
    }
  }
  let runtimeDirectory: string | undefined;
  for (const [key, child] of [
    ['LUSTER_PGLITE_DATA_DIR', 'database'],
    ['LUSTER_ONBOARDING_MEDIA_DIR', 'media'],
    ['LIVE_EVIDENCE_DIR', 'evidence'],
  ] as const) {
    const directory = environment[key] ?? '';
    const relative = path.relative(path.resolve(repositoryRoot), path.resolve(directory));
    const parent = path.dirname(directory);
    if (
      !path.isAbsolute(directory)
      || !relative.startsWith(`..${path.sep}`)
      || path.basename(directory) !== child
      || !/^luster-live-acceptance-[a-z0-9]+$/i.test(path.basename(parent))
      || (runtimeDirectory && runtimeDirectory !== parent)
    ) {
      throw new Error('Live acceptance storage and evidence must share one disposable runtime directory outside the repository.');
    }
    runtimeDirectory = parent;
  }
  return { baseURL: url.origin, evidenceDirectory: environment.LIVE_EVIDENCE_DIR!, runId };
}

export function runScopedPostgresName(runId: string): string {
  if (!/^acceptance-[a-z0-9-]{12,80}$/.test(runId)) {
    throw new Error('Invalid live acceptance database scope.');
  }
  return `luster_acceptance_${createHash('sha256').update(runId).digest('hex').slice(0, 16)}`;
}

export function runCleanupIsConfirmed(environment: AcceptanceEnvironment, runId: string): boolean {
  return /^acceptance-[a-z0-9-]{12,80}$/.test(runId)
    && environment.LIVE_CLERK_CLEANUP_CONFIRMED === runId;
}

export function runScopedEmail(runId: string, projectName: string): string {
  if (!/^acceptance-[a-z0-9-]{12,80}$/.test(runId) || !/^(?:chromium|webkit)-live$/.test(projectName)) {
    throw new Error('Invalid live acceptance identity scope.');
  }
  // Keep the local part below RFC's 64-byte limit even with a long run ID.
  const identity = createHash('sha256').update(`${runId}:${projectName}`).digest('hex').slice(0, 32);
  return `luster.${identity}+clerk_test@example.com`;
}
