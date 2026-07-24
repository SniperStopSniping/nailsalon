import 'server-only';

import { createHash } from 'node:crypto';

function hashScopePart(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/**
 * Isolate shared Cloudinary metadata and Redis counters by deployment.
 *
 * Production intentionally has one stable scope. Preview uses the Git branch
 * rather than the deployment URL so a later deployment of the same PR can
 * clean uploads abandoned by an earlier deployment without crossing into a
 * different preview database.
 */
export function serviceImageDeploymentScope(): string {
  if (process.env.VERCEL_ENV === 'production') {
    return 'prod';
  }

  if (process.env.VERCEL_ENV === 'preview') {
    const previewIdentity
      = process.env.VERCEL_GIT_COMMIT_REF
      || process.env.VERCEL_URL
      || 'unscoped-preview';
    return `preview_${hashScopePart(previewIdentity)}`;
  }

  if (process.env.APP_ENV === 'production') {
    return 'prod';
  }

  if (process.env.APP_ENV === 'staging') {
    return `preview_${hashScopePart(
      process.env.VERCEL_GIT_COMMIT_REF || 'unscoped-staging',
    )}`;
  }

  if (process.env.NODE_ENV === 'test') {
    return 'test';
  }

  return process.env.NODE_ENV === 'development' ? 'dev' : 'local';
}
