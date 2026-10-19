import { Client } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuntimeDatabaseGuardError } from './runtimeDatabaseGuard';
import { createRuntimeDatabaseCooldownClient } from './runtimeDatabasePoolClient';
import { createRuntimeDatabaseVerificationCooldown } from './runtimeDatabasePoolRecovery';

vi.mock('server-only', () => ({}));

function createCooldown(now = () => 0) {
  return createRuntimeDatabaseVerificationCooldown({
    cooldownMs: 5000,
    now,
    classify: error => error instanceof RuntimeDatabaseGuardError
      ? error
      : new RuntimeDatabaseGuardError('DATABASE_UNAVAILABLE'),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('physical runtime database connection cooldown', () => {
  it('rejects a cached failure before the real Promise connect is called', async () => {
    const connect = vi.spyOn(Client.prototype, 'connect').mockImplementation(() => Promise.resolve());
    const cooldown = createCooldown();
    const failure = cooldown.recordFailure(new Error('private connection diagnostic'));
    const GuardedClient = createRuntimeDatabaseCooldownClient(cooldown);

    await expect(new GuardedClient().connect()).rejects.toBe(failure);
    expect(connect).not.toHaveBeenCalled();
  });

  it('preserves the asynchronous callback form without connecting during cooldown', async () => {
    const connect = vi.spyOn(Client.prototype, 'connect').mockImplementation(() => Promise.resolve());
    const cooldown = createCooldown();
    const failure = cooldown.recordFailure(new Error('provider unavailable'));
    const GuardedClient = createRuntimeDatabaseCooldownClient(cooldown);
    const callback = vi.fn();

    expect(new GuardedClient().connect(callback)).toBeUndefined();
    expect(callback).not.toHaveBeenCalled();

    await Promise.resolve();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(failure);
    expect(connect).not.toHaveBeenCalled();
  });

  it('caches and sanitizes an actual Promise connection failure', async () => {
    const connect = vi.spyOn(Client.prototype, 'connect').mockImplementation(() => Promise.reject(new Error('private provider diagnostic')));
    const cooldown = createCooldown();
    const GuardedClient = createRuntimeDatabaseCooldownClient(cooldown);

    await expect(new GuardedClient().connect()).rejects.toMatchObject({
      name: 'RuntimeDatabaseGuardError',
      code: 'DATABASE_UNAVAILABLE',
    });

    const failure = cooldown.getFailureDuringCooldown();

    expect(failure?.message).not.toContain('private provider diagnostic');
    await expect(new GuardedClient().connect()).rejects.toBe(failure);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('caches an actual callback connection failure and returns the typed error', async () => {
    const connect = vi.spyOn(Client.prototype, 'connect').mockImplementation((callback) => {
      queueMicrotask(() => callback(new Error('private callback diagnostic')));
    });
    const cooldown = createCooldown();
    const GuardedClient = createRuntimeDatabaseCooldownClient(cooldown);
    const callback = vi.fn();

    new GuardedClient().connect(callback);
    await Promise.resolve();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      name: 'RuntimeDatabaseGuardError',
      code: 'DATABASE_UNAVAILABLE',
    }));
    await expect(new GuardedClient().connect()).rejects.toBe(cooldown.getFailureDuringCooldown());
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('does not extend cooldown when more requests receive the cached failure', async () => {
    const connect = vi.spyOn(Client.prototype, 'connect').mockImplementation(() => Promise.resolve());
    let now = 0;
    const cooldown = createCooldown(() => now);
    const failure = cooldown.recordFailure(new Error('provider unavailable'));
    const GuardedClient = createRuntimeDatabaseCooldownClient(cooldown);

    now = 4999;
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => new GuardedClient().connect()));

    expect(results.every(result => result.status === 'rejected' && result.reason === failure)).toBe(true);
    expect(connect).not.toHaveBeenCalled();

    now = 5000;

    await expect(new GuardedClient().connect()).resolves.toBeUndefined();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('does not clear another connection failure merely because an in-flight TCP connect succeeds', async () => {
    let finishConnect!: () => void;
    const connecting = new Promise<void>((resolve) => {
      finishConnect = resolve;
    });
    vi.spyOn(Client.prototype, 'connect').mockImplementation(() => connecting);
    const cooldown = createCooldown();
    const GuardedClient = createRuntimeDatabaseCooldownClient(cooldown);
    const attempt = new GuardedClient().connect();
    const failure = cooldown.recordFailure(new RuntimeDatabaseGuardError('DATABASE_ATTESTATION_REJECTED'));

    finishConnect();
    await attempt;

    expect(cooldown.getFailureDuringCooldown()).toBe(failure);
    await expect(new GuardedClient().connect()).rejects.toBe(failure);
  });

  it('leaves concurrent healthy physical connections independent', async () => {
    const connect = vi.spyOn(Client.prototype, 'connect').mockImplementation(() => Promise.resolve());
    const cooldown = createCooldown();
    const GuardedClient = createRuntimeDatabaseCooldownClient(cooldown);

    await Promise.all([new GuardedClient().connect(), new GuardedClient().connect()]);

    expect(connect).toHaveBeenCalledTimes(2);
  });
});
