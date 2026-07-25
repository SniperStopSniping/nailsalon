import { describe, expect, it, vi } from 'vitest';

import {
  buildSalonClientIdentityLockKeys,
  ClientLifecycleStabilizationError,
  getSalonClientLineageIdentityWithHandle,
  getSalonClientLineageIdsWithHandle,
  type LifecycleSqlHandle,
  lockSalonClientIdentityKeysWithHandle,
  normalizeClientIdentityInput,
  resolveCanonicalSalonClientIdentityWithHandle,
  resolveOperationalSalonClientByPhoneWithHandle,
  resolveOperationalSalonClientContactByPhoneWithHandle,
  resolveOperationalSalonClientContactWithHandle,
  resolveTerminalSalonClientWithHandle,
  withClientLifecycleTransactionRetry,
} from './clientLifecycleStabilization';

vi.mock('server-only', () => ({}));

function result(rows: Record<string, unknown>[]) {
  return { rows };
}

function databaseError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

describe('client lifecycle stabilization', () => {
  it('normalizes and deterministically orders supported identity keys', () => {
    expect(normalizeClientIdentityInput({
      phone: '+1 (416) 555-0101',
      email: '  Client@Example.COM ',
    })).toEqual([
      { kind: 'email', value: 'client@example.com' },
      { kind: 'phone', value: '4165550101' },
    ]);
    expect(buildSalonClientIdentityLockKeys({
      salonId: 'salon-a',
      phone: '+1 (416) 555-0101',
      email: 'Client@Example.COM',
    })).toEqual([
      {
        advisoryKey: '[\"salon-a\",\"email\",\"client@example.com\"]',
        kind: 'email',
        normalizedValue: 'client@example.com',
        salonId: 'salon-a',
      },
      {
        advisoryKey: '[\"salon-a\",\"phone\",\"4165550101\"]',
        kind: 'phone',
        normalizedValue: '4165550101',
        salonId: 'salon-a',
      },
    ]);
    expect(() => normalizeClientIdentityInput({ phone: '123' }))
      .toThrow('phone is invalid');
    expect(() => normalizeClientIdentityInput({ email: 'invalid' }))
      .toThrow('email is invalid');
  });

  it('takes every identity advisory lock in deterministic sorted order', async () => {
    const execute = vi.fn().mockResolvedValue(result([]));

    await expect(lockSalonClientIdentityKeysWithHandle(
      { execute } as LifecycleSqlHandle,
      {
        salonId: 'salon-a',
        phone: '4165550101',
        email: 'client@example.com',
      },
    )).resolves.toEqual({
      email: 'client@example.com',
      phone: '4165550101',
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('resolves a bounded same-salon chain to its active terminal client', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{
        id: 'source',
        salon_id: 'salon-a',
        merged_into_client_id: 'middle',
        archived_at: new Date(),
      }]))
      .mockResolvedValueOnce(result([{
        id: 'middle',
        salon_id: 'salon-a',
        merged_into_client_id: 'primary',
        archived_at: new Date(),
      }]))
      .mockResolvedValueOnce(result([{
        id: 'primary',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: null,
      }]));

    await expect(resolveTerminalSalonClientWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', clientId: 'source' },
    )).resolves.toMatchObject({
      id: 'primary',
      salonId: 'salon-a',
      redirectedFromClientId: 'source',
      lineagePath: ['source', 'middle', 'primary'],
    });
  });

  it('uses the same non-disclosing error for missing and foreign-salon IDs', async () => {
    const execute = vi.fn().mockResolvedValue(result([]));

    await expect(resolveTerminalSalonClientWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', clientId: 'foreign-client' },
    )).rejects.toEqual(
      new ClientLifecycleStabilizationError('CLIENT_NOT_FOUND'),
    );
  });

  it('rejects cycles and excessive depth', async () => {
    const cycleExecute = vi.fn()
      .mockResolvedValueOnce(result([{
        id: 'source',
        salon_id: 'salon-a',
        merged_into_client_id: 'middle',
        archived_at: new Date(),
      }]))
      .mockResolvedValueOnce(result([{
        id: 'middle',
        salon_id: 'salon-a',
        merged_into_client_id: 'source',
        archived_at: new Date(),
      }]));

    await expect(resolveTerminalSalonClientWithHandle(
      { execute: cycleExecute } as LifecycleSqlHandle,
      { salonId: 'salon-a', clientId: 'source' },
    )).rejects.toMatchObject({ code: 'INVALID_CLIENT_STATE' });

    const depthExecute = vi.fn();
    for (let index = 0; index < 16; index += 1) {
      depthExecute.mockResolvedValueOnce(result([{
        id: `client-${index}`,
        salon_id: 'salon-a',
        merged_into_client_id: `client-${index + 1}`,
        archived_at: new Date(),
      }]));
    }

    await expect(resolveTerminalSalonClientWithHandle(
      { execute: depthExecute } as LifecycleSqlHandle,
      { salonId: 'salon-a', clientId: 'client-0' },
    )).rejects.toMatchObject({ code: 'INVALID_CLIENT_STATE' });
  });

  it('allows archived terminals only when explicitly requested', async () => {
    const archived = {
      id: 'archived',
      salon_id: 'salon-a',
      merged_into_client_id: null,
      archived_at: new Date(),
    };

    await expect(resolveTerminalSalonClientWithHandle(
      { execute: vi.fn().mockResolvedValue(result([archived])) },
      { salonId: 'salon-a', clientId: 'archived' },
    )).rejects.toMatchObject({ code: 'CLIENT_ARCHIVED' });
    await expect(resolveTerminalSalonClientWithHandle(
      { execute: vi.fn().mockResolvedValue(result([archived])) },
      {
        salonId: 'salon-a',
        clientId: 'archived',
        allowArchived: true,
      },
    )).resolves.toMatchObject({ id: 'archived' });
  });

  it('resolves an operational phone alias through its active terminal without making it an auth alias', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{ id: 'source' }]))
      .mockResolvedValueOnce(result([{
        id: 'source',
        salon_id: 'salon-a',
        merged_into_client_id: 'primary',
        archived_at: new Date(),
      }]))
      .mockResolvedValueOnce(result([{
        id: 'primary',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: null,
      }]));

    await expect(resolveOperationalSalonClientByPhoneWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', phone: '+1 (416) 555-1212' },
    )).resolves.toMatchObject({
      id: 'primary',
      redirectedFromClientId: 'source',
    });
  });

  it('reads current operational contact from the terminal without changing source snapshots', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{
        id: 'source',
        salon_id: 'salon-a',
        merged_into_client_id: 'primary',
        archived_at: new Date(),
      }]))
      .mockResolvedValueOnce(result([{
        id: 'primary',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: null,
      }]))
      .mockResolvedValueOnce(result([{
        phone: '4165550198',
        email: 'current@example.test',
      }]));

    await expect(resolveOperationalSalonClientContactWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', clientId: 'source' },
    )).resolves.toMatchObject({
      id: 'primary',
      phone: '4165550198',
      email: 'current@example.test',
      redirectedFromClientId: 'source',
    });
  });

  it('reads current operational contact through a private historical phone alias', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{ id: 'source' }]))
      .mockResolvedValueOnce(result([{
        id: 'source',
        salon_id: 'salon-a',
        merged_into_client_id: 'primary',
        archived_at: new Date(),
      }]))
      .mockResolvedValueOnce(result([{
        id: 'primary',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: null,
      }]))
      .mockResolvedValueOnce(result([{
        phone: '4165550198',
        email: 'current@example.test',
      }]));

    await expect(resolveOperationalSalonClientContactByPhoneWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', phone: '4165550100' },
    )).resolves.toMatchObject({
      id: 'primary',
      phone: '4165550198',
      redirectedFromClientId: 'source',
    });
  });

  it('fails closed when one operational phone resolves to different terminals', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{ id: 'client-a' }, { id: 'client-b' }]))
      .mockResolvedValueOnce(result([{
        id: 'client-a',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: null,
      }]))
      .mockResolvedValueOnce(result([{
        id: 'client-b',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: null,
      }]));

    await expect(resolveOperationalSalonClientByPhoneWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', phone: '4165551212' },
    )).rejects.toMatchObject({ code: 'INVALID_CLIENT_STATE' });
  });

  it('resolves current and historical contacts to one same-salon terminal', async () => {
    const execute = vi.fn()
      // Candidate lookup by the supplied historical values.
      .mockResolvedValueOnce(result([{ id: 'source' }]))
      // Resolve source -> terminal.
      .mockResolvedValueOnce(result([{
        id: 'source',
        salon_id: 'salon-a',
        merged_into_client_id: 'terminal',
        archived_at: new Date(),
      }]))
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: null,
      }]))
      // Resolve and load the terminal operational contact.
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: null,
      }]))
      .mockResolvedValueOnce(result([{
        phone: '4165550200',
        email: 'current@example.com',
      }]))
      // Load complete lineage, current identities, and aliases.
      .mockResolvedValueOnce(result([{ id: 'source' }, { id: 'terminal' }]))
      .mockResolvedValueOnce(result([
        {
          id: 'source',
          phone: '4165550100',
          email: 'old@example.com',
          client_id: null,
        },
        {
          id: 'terminal',
          phone: '4165550200',
          email: 'current@example.com',
          client_id: null,
        },
      ]))
      .mockResolvedValueOnce(result([
        { kind: 'phone', normalized_value: '4165550100' },
        { kind: 'email', normalized_value: 'old@example.com' },
      ]));

    await expect(resolveCanonicalSalonClientIdentityWithHandle(
      { execute } as LifecycleSqlHandle,
      {
        salonId: 'salon-a',
        phone: '(416) 555-0100',
        email: 'OLD@example.com',
      },
    )).resolves.toMatchObject({
      terminal: {
        id: 'terminal',
        phone: '4165550200',
        email: 'current@example.com',
      },
      clientIds: ['source', 'terminal'],
      phones: ['4165550100', '4165550200'],
      emails: ['current@example.com', 'old@example.com'],
      matchedBy: [
        { kind: 'email', value: 'old@example.com' },
        { kind: 'phone', value: '4165550100' },
      ],
    });
  });

  it('fails closed when supplied identities resolve to different terminals', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{ id: 'client-a' }, { id: 'client-b' }]))
      .mockResolvedValueOnce(result([{
        id: 'client-a',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: null,
      }]))
      .mockResolvedValueOnce(result([{
        id: 'client-b',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: null,
      }]));

    await expect(resolveCanonicalSalonClientIdentityWithHandle(
      { execute } as LifecycleSqlHandle,
      {
        salonId: 'salon-a',
        phone: '4165550100',
        email: 'other@example.com',
      },
    )).rejects.toMatchObject({ code: 'INVALID_CLIENT_STATE' });
  });

  it('rejects a merged lineage carrying a source external identity link', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: null,
      }]))
      .mockResolvedValueOnce(result([{
        phone: '4165550200',
        email: 'current@example.com',
      }]))
      .mockResolvedValueOnce(result([{ id: 'source' }, { id: 'terminal' }]))
      .mockResolvedValueOnce(result([
        {
          id: 'source',
          phone: '4165550100',
          email: null,
          client_id: 'external-source',
        },
        {
          id: 'terminal',
          phone: '4165550200',
          email: null,
          client_id: null,
        },
      ]));

    await expect(getSalonClientLineageIdentityWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', terminalClientId: 'terminal' },
    )).rejects.toMatchObject({ code: 'INVALID_CLIENT_STATE' });
  });

  it('fails closed when reverse lineage traversal reaches its bound', async () => {
    const execute = vi.fn().mockResolvedValue(result([
      {
        depth: 0,
        has_cycle: false,
        has_unvisited_child: false,
        id: 'terminal',
      },
      {
        depth: 15,
        has_cycle: false,
        has_unvisited_child: true,
        id: 'source-15',
      },
    ]));

    await expect(getSalonClientLineageIdsWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', terminalClientId: 'terminal' },
    )).rejects.toMatchObject({ code: 'INVALID_CLIENT_STATE' });
  });

  it('fails closed when a same-salon identity candidate cannot resolve', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{ id: 'invalid-candidate' }]))
      .mockResolvedValueOnce(result([]));

    await expect(resolveCanonicalSalonClientIdentityWithHandle(
      { execute } as LifecycleSqlHandle,
      {
        salonId: 'salon-a',
        phone: '4165550100',
      },
    )).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
  });

  it.each(['40P01', '40001'])(
    'retries a complete transaction for %s',
    async (code) => {
      const operation = vi.fn()
        .mockRejectedValueOnce(databaseError(code))
        .mockResolvedValue('committed');
      const sleep = vi.fn().mockResolvedValue(undefined);

      await expect(withClientLifecycleTransactionRetry(operation, {
        sleep,
        random: () => 0,
      })).resolves.toBe('committed');
      expect(operation).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(25);
    },
  );

  it('exhausts retry and fails non-retryable errors immediately', async () => {
    const retryable = databaseError('40001');
    const retries = vi.fn().mockRejectedValue(retryable);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withClientLifecycleTransactionRetry(retries, {
      sleep,
      random: () => 1,
    })).rejects.toBe(retryable);
    expect(retries).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[75], [225]]);

    const validation = databaseError('23514');
    const validate = vi.fn().mockRejectedValue(validation);

    await expect(withClientLifecycleTransactionRetry(validate, {
      sleep,
    })).rejects.toBe(validation);
    expect(validate).toHaveBeenCalledTimes(1);
  });
});
