import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSchemaDriftStatus } from './schemaReadiness';
import { DEFAULT_JOURNAL_ENTRIES, type SchemaReadinessSqlHandle } from './schemaReadinessCore';

vi.mock('server-only', () => ({}));

// Derived, not hardcoded: the journal grows by one entry with every merged
// migration, so a literal count here would turn the very next migration into
// a spurious "behind" failure on an unrelated PR.
const EXPECTED_APPLIED_COUNT = DEFAULT_JOURNAL_ENTRIES.length;
const EXPECTED_TAIL_MILLIS = DEFAULT_JOURNAL_ENTRIES[DEFAULT_JOURNAL_ENTRIES.length - 1]!.when;

describe('schema-drift readiness wrapper (public status)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports "ready" and caches a successful proof for the same handle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T00:00:00.000Z'));
    const execute = vi.fn().mockResolvedValue([{
      applied_count: EXPECTED_APPLIED_COUNT,
      applied_tail_millis: EXPECTED_TAIL_MILLIS,
    }]);
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
    const execute = vi.fn().mockResolvedValue([{ applied_count: 1, applied_tail_millis: 1 }]);
    const handle: SchemaReadinessSqlHandle = { execute };

    await expect(getSchemaDriftStatus(handle)).resolves.toBe('not_ready');
    await expect(getSchemaDriftStatus(handle)).resolves.toBe('not_ready');
    // Not cached: every call re-queries, so a database that becomes ready
    // reports it on the very next call.
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('reports "not_ready" (not "ready") for equal counts with a divergent tail timestamp', async () => {
    // The false-match case MAJOR-1 closes: same length, different content.
    const execute = vi.fn().mockResolvedValue([{
      applied_count: EXPECTED_APPLIED_COUNT,
      applied_tail_millis: EXPECTED_TAIL_MILLIS + 1,
    }]);
    const handle: SchemaReadinessSqlHandle = { execute };

    await expect(getSchemaDriftStatus(handle)).resolves.toBe('not_ready');
  });

  it('reports "ahead" — distinct from "not_ready" — for a database that has applied MORE migrations than expected', async () => {
    // "ahead" is broken out from the generic "not_ready" bucket so it stays
    // visible and diagnosable in the response body (see ADR 0007). Gating
    // (whether it pages production) is a route-level decision, not this
    // wrapper's — see route.test.ts.
    const execute = vi.fn().mockResolvedValue([{
      applied_count: 999_999,
      applied_tail_millis: 999_999,
    }]);
    const handle: SchemaReadinessSqlHandle = { execute };

    await expect(getSchemaDriftStatus(handle)).resolves.toBe('ahead');
  });

  it('reports "unavailable", not "not_ready" nor "ready" nor "ahead", when the query fails — and never throws', async () => {
    const handle: SchemaReadinessSqlHandle = {
      execute: vi.fn().mockRejectedValue(
        new Error('private connection detail must not escape'),
      ),
    };

    await expect(getSchemaDriftStatus(handle)).resolves.toBe('unavailable');
  });
});
