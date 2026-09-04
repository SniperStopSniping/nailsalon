import { describe, expect, it } from 'vitest';

import { resolvePGliteRuntimeDataSource } from './pgliteRuntime';

describe('resolvePGliteRuntimeDataSource', () => {
  it('keeps the default local and test runtime in memory', () => {
    expect(resolvePGliteRuntimeDataSource({ cwd: '/workspace', nodeEnv: 'development' }))
      .toBeUndefined();
    expect(resolvePGliteRuntimeDataSource({
      configuredDataDirectory: '/tmp/luster-integration-db',
      cwd: '/workspace',
      nodeEnv: 'test',
      vitest: true,
    })).toBeUndefined();
  });

  it('returns an explicit file URL for a local directory outside the repository', () => {
    expect(resolvePGliteRuntimeDataSource({
      appEnv: 'development',
      configuredDataDirectory: '/tmp/luster-integration-db',
      cwd: '/workspace/luster',
      nodeEnv: 'development',
    })).toBe('file:///tmp/luster-integration-db');
  });

  it('rejects relative, in-repository, and hosted paths', () => {
    expect(() => resolvePGliteRuntimeDataSource({
      configuredDataDirectory: 'tmp/db',
      cwd: '/workspace/luster',
      nodeEnv: 'development',
    })).toThrow(/absolute path/);
    expect(() => resolvePGliteRuntimeDataSource({
      configuredDataDirectory: '/workspace/luster/.data',
      cwd: '/workspace/luster',
      nodeEnv: 'development',
    })).toThrow(/outside the repository/);
    expect(() => resolvePGliteRuntimeDataSource({
      appEnv: 'preview',
      configuredDataDirectory: '/tmp/luster-integration-db',
      cwd: '/workspace/luster',
      nodeEnv: 'production',
    })).toThrow(/only in local development/);
  });
});
