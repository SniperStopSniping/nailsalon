import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSchemaDriftStatus } from './schemaReadiness';
import type { SchemaReadinessSqlHandle } from './schemaReadinessCore';

vi.mock('server-only', () => ({}));

describe('schema-drift readiness wrapper (public status)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports "ready" and caches a successful proof for the same handle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T00:00:00.000Z'));
    const execute = vi.fn().mockResolvedValue([{ applied_count: 74 }]);
    const handle: SchemaReadinessSqlHandle = { execute };

    await expect(getSchemaDriftStatus(handle)).resolves.toBe('ready');
    expect(execute).toHaveBeenCalledTimes(1);

    await expect(getSchemaDriftStatus(handle)).resolves.toBe('ready');
    expect(execute).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_001);

    await expect(getSchemaDriftStatus(handle)).resolves.toBe('ready');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('reports "not_ready" without caching a behind reading', async () => {
    const execute = vi.fn().mockResolvedValue([{ applied_count: 1 }]);
    const handle: SchemaReadinessSqlHandle = { execute };

    await expect(getSchemaDriftStatus(handle)).resolves.toBe('not_ready');
    await expect(getSchemaDriftStatus(handle)).resolves.toBe('not_ready');
    // Not cached: every call re-queries, so a database that becomes ready
    // reports it on the very next call.
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('reports "not_ready" for a database that has applied MORE migrations than expected (ahead)', async () => {
    const execute = vi.fn().mockResolvedValue([{
      applied_count: 999_999,
    }]);
    const handle: SchemaReadinessSqlHandle = { execute };

    await expect(getSchemaDriftStatus(handle)).resolves.toBe('not_ready');
  });

  it('reports "unavailable", not "not_ready" nor "ready", when the query fails — and never throws', async () => {
    const handle: SchemaReadinessSqlHandle = {
      execute: vi.fn().mockRejectedValue(
        new Error('private connection detail must not escape'),
      ),
    };

    await expect(getSchemaDriftStatus(handle)).resolves.toBe('unavailable');
  });
});
