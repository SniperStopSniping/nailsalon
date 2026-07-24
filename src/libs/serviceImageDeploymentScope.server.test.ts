import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/* eslint-disable import/first */
import { serviceImageDeploymentScope } from './serviceImageDeploymentScope.server';
/* eslint-enable import/first */

describe('service image deployment scope', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('APP_ENV', '');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', '');
    vi.stubEnv('VERCEL_URL', '');
  });

  it('uses one stable production scope', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'main');

    expect(serviceImageDeploymentScope()).toBe('prod');
  });

  it('uses a stable branch-hashed preview scope', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'feat/service-image-controls');

    const first = serviceImageDeploymentScope();

    expect(first).toMatch(/^preview_[a-f0-9]{12}$/);
    expect(serviceImageDeploymentScope()).toBe(first);

    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'another-preview');

    expect(serviceImageDeploymentScope()).not.toBe(first);
  });

  it('lets explicit Vercel Preview isolation win over a generic app environment', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'feat/service-image-controls');

    expect(serviceImageDeploymentScope()).toMatch(
      /^preview_[a-f0-9]{12}$/,
    );
  });

  it('keeps test and local development separate from hosted scopes', () => {
    vi.stubEnv('NODE_ENV', 'test');

    expect(serviceImageDeploymentScope()).toBe('test');

    vi.stubEnv('NODE_ENV', 'development');

    expect(serviceImageDeploymentScope()).toBe('dev');
  });
});
