import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('postponed social publishing', () => {
  it.each([undefined, 'false', '1', 'TRUE'])('does not enable a worker implicitly for %s', async (value) => {
    vi.stubEnv('ENABLE_AUTOPOST_GLOBAL', value);
    vi.resetModules();

    expect((await import('./flags')).FEATURE_FLAGS.ENABLE_AUTOPOST_GLOBAL).toBe(false);
  });

  it('preserves an explicit operator opt-in for future infrastructure', async () => {
    vi.stubEnv('ENABLE_AUTOPOST_GLOBAL', 'true');
    vi.resetModules();

    expect((await import('./flags')).FEATURE_FLAGS.ENABLE_AUTOPOST_GLOBAL).toBe(true);
  });
});
