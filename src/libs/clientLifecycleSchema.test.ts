import { afterEach, describe, expect, it, vi } from 'vitest';

import { isClientLifecycleSchemaReady } from './clientLifecycleSchema';
import type { LifecycleReadinessSqlHandle } from './clientLifecycleSchemaCore';

vi.mock('server-only', () => ({}));

describe('client lifecycle schema readiness wrapper', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('caches a successful complete proof for the same database handle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-25T00:00:00.000Z'));
    const handle = {
      execute: vi.fn().mockResolvedValue({ rows: [{ ok: true }] }),
    } satisfies LifecycleReadinessSqlHandle;

    await expect(isClientLifecycleSchemaReady(handle)).resolves.toBe(true);
    expect(handle.execute).toHaveBeenCalledTimes(9);

    await expect(isClientLifecycleSchemaReady(handle)).resolves.toBe(true);
    expect(handle.execute).toHaveBeenCalledTimes(9);

    vi.advanceTimersByTime(30_001);

    await expect(isClientLifecycleSchemaReady(handle)).resolves.toBe(true);
    expect(handle.execute).toHaveBeenCalledTimes(18);
  });

  it('does not cache a failed proof', async () => {
    const handle = {
      execute: vi.fn().mockResolvedValue({ rows: [{ ok: false }] }),
    } satisfies LifecycleReadinessSqlHandle;

    await expect(isClientLifecycleSchemaReady(handle)).resolves.toBe(false);
    await expect(isClientLifecycleSchemaReady(handle)).resolves.toBe(false);
    expect(handle.execute).toHaveBeenCalledTimes(18);
  });

  it('returns false without leaking a query failure', async () => {
    const handle = {
      execute: vi.fn().mockRejectedValue(
        new Error('private catalog detail must not escape'),
      ),
    } satisfies LifecycleReadinessSqlHandle;

    await expect(isClientLifecycleSchemaReady(handle)).resolves.toBe(false);
  });
});
