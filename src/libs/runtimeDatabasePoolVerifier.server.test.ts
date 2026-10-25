import { EventEmitter } from 'node:events';

import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { RuntimeDatabaseGuardError, type RuntimePostgresTarget } from './runtimeDatabaseGuard';
import { createRuntimeDatabaseVerificationCooldown } from './runtimeDatabasePoolRecovery';
import { createGuardedRuntimeDatabasePoolVerifier, RUNTIME_DATABASE_READ_TIMEOUT_MS } from './runtimeDatabasePoolVerifier.server';

vi.mock('server-only', () => ({}));

const target: RuntimePostgresTarget = {
  connectionString: 'postgresql://example.invalid/runtime',
  environment: 'production',
  fingerprint: 'fixture',
  host: 'example.invalid',
};

function harness(query: ReturnType<typeof vi.fn>) {
  const client = Object.assign(new EventEmitter(), { query });
  const cooldown = createRuntimeDatabaseVerificationCooldown({
    classify: error => error instanceof RuntimeDatabaseGuardError
      ? error
      : new RuntimeDatabaseGuardError('DATABASE_UNAVAILABLE'),
    cooldownMs: 5000,
  });
  const verify = createGuardedRuntimeDatabasePoolVerifier(target, cooldown);
  const callback = vi.fn();
  const result = new Promise<Error | undefined>((resolve) => {
    verify(client as unknown as PoolClient, (error) => {
      callback(error);
      resolve(error);
    });
  });
  return { client, cooldown, callback, result };
}

describe('runtime PostgreSQL read verifier', () => {
  it('bounds the existing marker read and removes its error listener after success', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ environment: 'production' }] });
    const test = harness(query);

    expect(await test.result).toBeUndefined();
    expect(query).toHaveBeenCalledExactlyOnceWith({
      text: expect.stringContaining('environment'),
      values: undefined,
      query_timeout: RUNTIME_DATABASE_READ_TIMEOUT_MS,
    });
    expect(test.callback).toHaveBeenCalledOnce();
    expect(test.client.listenerCount('error')).toBe(0);
    expect(test.cooldown.getFailureDuringCooldown()).toBeUndefined();
  });

  it.each([
    [undefined, 'DATABASE_UNAVAILABLE'],
    ['42501', 'DATABASE_ATTESTATION_REJECTED'],
    ['42703', 'DATABASE_ATTESTATION_REJECTED'],
  ])('keeps code %s sanitized and correctly classified', async (code, expectedCode) => {
    const test = harness(vi.fn().mockRejectedValue(Object.assign(
      new Error('private postgresql://provider.invalid/secret'),
      { code },
    )));
    const error = await test.result;

    expect(error).toMatchObject({ name: 'RuntimeDatabaseGuardError', code: expectedCode });
    expect(error?.message).not.toContain('provider.invalid');
    expect(test.cooldown.getFailureDuringCooldown()).toBe(error);
    expect(test.client.listenerCount('error')).toBe(0);
  });

  it('keeps a wrong marker fail-closed', async () => {
    const test = harness(vi.fn().mockResolvedValue({ rows: [{ environment: 'development' }] }));

    expect(await test.result).toMatchObject({ code: 'DATABASE_ATTESTATION_REJECTED' });
  });

  it.each(['wrong-marker', 'permission-rejection'].flatMap(mode =>
    [0, 1, 2].map(gap => ({ mode, gap }))))('preserves $mode classification when a socket error arrives after $gap microtasks', async ({ mode, gap }) => {
    const query = mode === 'wrong-marker'
      ? vi.fn().mockResolvedValue({ rows: [{ environment: 'development' }] })
      : vi.fn().mockRejectedValue(Object.assign(new Error('private permission detail'), { code: '42501' }));
    const test = harness(query);
    for (let step = 0; step < gap; step++) {
      await Promise.resolve();
    }

    expect(() => test.client.emit('error', new Error('private socket detail'))).not.toThrow();

    const error = await test.result;

    expect(error).toMatchObject({ code: 'DATABASE_ATTESTATION_REJECTED' });
    expect(test.cooldown.getFailureDuringCooldown()).toBe(error);
    expect(error?.message).not.toContain('private');

    await Promise.resolve();
    await Promise.resolve();

    expect(test.callback).toHaveBeenCalledOnce();
    expect(test.client.listenerCount('error')).toBe(0);
  });

  it('handles socket errors during a pending query and settles once despite a late query result', async () => {
    let resolveQuery!: (value: unknown) => void;
    let rejectQuery!: (error: Error) => void;
    const test = harness(vi.fn(() => new Promise((resolve, reject) => {
      resolveQuery = resolve;
      rejectQuery = reject;
    })));

    expect(test.client.listenerCount('error')).toBe(1);
    expect(() => test.client.emit('error', new Error('private socket detail'))).not.toThrow();

    // Model pg's actual socket path: its client error event is accompanied
    // by rejection of the active query. The native suite exercises that path.
    rejectQuery(new Error('private socket detail'));

    const error = await test.result;

    expect(error).toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    expect(test.cooldown.getFailureDuringCooldown()).toBe(error);

    resolveQuery({ rows: [{ environment: 'production' }] });
    await Promise.resolve();
    await Promise.resolve();

    expect(test.callback).toHaveBeenCalledOnce();
    expect(test.client.listenerCount('error')).toBe(0);
  });

  it('rejects an error between successful query completion and pool handoff', async () => {
    const test = harness(vi.fn().mockResolvedValue({ rows: [{ environment: 'production' }] }));
    // The query's fulfillment is already queued, but the verifier has not
    // handed the connection back to pg-pool yet.
    await Promise.resolve();

    test.client.emit('error', new Error('private socket detail'));

    expect(await test.result).toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    expect(test.callback).toHaveBeenCalledOnce();
  });
});
