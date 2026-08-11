import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import {
  buildSalonClientIdentityLockKeys,
  buildSalonClientIdentityLockKeySet,
  ClientLifecycleStabilizationError,
  getSalonClientHistoricalPhoneHintsWithHandle,
  getSalonClientLineageIdentityWithHandle,
  getSalonClientLineageIdsWithHandle,
  getZeroCandidateOrphanRecoveryAppointmentsWithHandle,
  hasUnsafeSalonClientExternalIdentityWithHandle,
  isClientLifecycleTransactionTimeoutError,
  type LifecycleSqlHandle,
  lockSalonClientIdentityKeySetWithHandle,
  lockSalonClientIdentityKeysWithHandle,
  normalizeClientIdentityInput,
  resolveAppointmentOperationalEmailRecipientWithHandle,
  resolveCanonicalSalonClientIdentityOutcomeWithHandle,
  resolveCanonicalSalonClientIdentityWithHandle,
  resolveOperationalSalonClientByPhoneWithHandle,
  resolveOperationalSalonClientContactByPhoneWithHandle,
  resolveOperationalSalonClientContactWithHandle,
  resolveTerminalSalonClientWithHandle,
  setClientContactEditTransactionTimeoutsWithHandle,
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

    for (const invalidEmail of [
      '.local@example.com',
      'a..b@example.com',
      'a@example..com',
    ]) {
      expect(() => normalizeClientIdentityInput({ email: invalidEmail }))
        .toThrow('email is invalid');
    }
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

  it('deduplicates every old/new contact and locks the complete set in one sorted order', async () => {
    expect(buildSalonClientIdentityLockKeySet({
      salonId: 'salon-a',
      contacts: [
        {
          phone: '(416) 555-0101',
          email: 'Old@Example.com',
        },
        {
          phone: '+1 647 555 0102',
          email: 'new@example.com',
        },
        {
          phone: '4165550101',
          email: ' old@example.com ',
        },
      ],
    }).map(key => [key.kind, key.normalizedValue])).toEqual([
      ['email', 'new@example.com'],
      ['email', 'old@example.com'],
      ['phone', '4165550101'],
      ['phone', '6475550102'],
    ]);

    const execute = vi.fn().mockResolvedValue(result([]));

    await expect(lockSalonClientIdentityKeySetWithHandle(
      { execute } as LifecycleSqlHandle,
      {
        salonId: 'salon-a',
        contacts: [
          { phone: '4165550101', email: 'old@example.com' },
          { phone: '6475550102', email: 'new@example.com' },
        ],
      },
    )).resolves.toHaveLength(4);
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it('sets transaction-local contact edit timeouts in deterministic order', async () => {
    const execute = vi.fn().mockResolvedValue(result([]));

    await expect(setClientContactEditTransactionTimeoutsWithHandle({
      execute,
    })).resolves.toBeUndefined();

    const queries = execute.mock.calls.map(([query]) =>
      new PgDialect().sqlToQuery(query as SQL).sql);

    expect(queries).toEqual([
      expect.stringContaining('set local lock_timeout = \'3s\''),
      expect.stringContaining('set local statement_timeout = \'10s\''),
    ]);
  });

  it('returns only valid same-salon lineage and alias phone hints for snapshot reads', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: null,
      }]))
      .mockResolvedValueOnce(result([
        {
          id: 'source',
          depth: 1,
          has_unvisited_child: false,
          has_cycle: false,
        },
        {
          id: 'terminal',
          depth: 0,
          has_unvisited_child: true,
          has_cycle: false,
        },
      ]))
      .mockResolvedValueOnce(result([
        { phone: '+1 (416) 555-0101' },
        { phone: '6475550102' },
      ]))
      .mockResolvedValueOnce(result([
        { normalized_value: '9055550103' },
        { normalized_value: 'invalid' },
      ]));

    await expect(getSalonClientHistoricalPhoneHintsWithHandle(
      { execute } as LifecycleSqlHandle,
      {
        salonId: 'salon-a',
        clientId: 'terminal',
        allowArchived: true,
      },
    )).resolves.toEqual({
      terminal: expect.objectContaining({ id: 'terminal' }),
      phones: ['4165550101', '6475550102', '9055550103'],
    });
  });

  it('detects direct and contact-derived global login relationships without promoting aliases to auth', async () => {
    const linkedExecute = vi.fn()
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        depth: 0,
        has_unvisited_child: false,
        has_cycle: false,
      }]))
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        phone: '4165550101',
        email: 'client@example.com',
        client_id: 'global-client',
      }]));

    await expect(hasUnsafeSalonClientExternalIdentityWithHandle(
      { execute: linkedExecute } as LifecycleSqlHandle,
      {
        salonId: 'salon-a',
        terminalClientId: 'terminal',
      },
    )).resolves.toBe(true);
    expect(linkedExecute).toHaveBeenCalledTimes(2);

    const sessionExecute = vi.fn()
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        depth: 0,
        has_unvisited_child: false,
        has_cycle: false,
      }]))
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        phone: '4165550101',
        email: null,
        client_id: null,
      }]))
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{
        kind: 'phone',
        normalized_value: '6475550102',
      }]))
      .mockResolvedValueOnce(result([{
        has_unsafe_identity: true,
      }]));

    await expect(hasUnsafeSalonClientExternalIdentityWithHandle(
      { execute: sessionExecute } as LifecycleSqlHandle,
      {
        salonId: 'salon-a',
        terminalClientId: 'terminal',
        proposedContact: {
          phone: '9055550103',
          email: 'new@example.com',
        },
      },
    )).resolves.toBe(true);
    expect(sessionExecute).toHaveBeenCalledTimes(5);

    const lineageQuery = new PgDialect().sqlToQuery(
      sessionExecute.mock.calls[1]![0] as SQL,
    );
    const identityTableLock = new PgDialect().sqlToQuery(
      sessionExecute.mock.calls[2]![0] as SQL,
    );

    expect(lineageQuery.sql).toContain('for share');
    expect(identityTableLock.sql).toContain(
      'lock table client, client_session in share mode',
    );
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

  it('distinguishes zero candidates from resolved and invalid identity state', async () => {
    const zeroExecute = vi.fn().mockResolvedValue(result([]));

    await expect(resolveCanonicalSalonClientIdentityOutcomeWithHandle(
      { execute: zeroExecute } as LifecycleSqlHandle,
      {
        salonId: 'salon-a',
        email: 'orphan@example.com',
      },
    )).resolves.toEqual({ status: 'zero_identity_candidates' });
    expect(zeroExecute).toHaveBeenCalledTimes(1);

    const invalidExecute = vi.fn();

    await expect(resolveCanonicalSalonClientIdentityOutcomeWithHandle(
      { execute: invalidExecute } as LifecycleSqlHandle,
      { salonId: 'salon-a' },
    )).resolves.toEqual({
      status: 'invalid_or_ambiguous_identity',
      reason: 'INVALID_CLIENT_STATE',
    });
    expect(invalidExecute).not.toHaveBeenCalled();

    const ambiguousExecute = vi.fn()
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

    await expect(resolveCanonicalSalonClientIdentityOutcomeWithHandle(
      { execute: ambiguousExecute } as LifecycleSqlHandle,
      {
        salonId: 'salon-a',
        phone: '4165550100',
        email: 'other@example.com',
      },
    )).resolves.toEqual({
      status: 'invalid_or_ambiguous_identity',
      reason: 'INVALID_CLIENT_STATE',
    });
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

  it('uses the current terminal email for an appointment owned by a merged source', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{
        salon_client_id: 'source',
        client_phone: '4165550100',
        client_email: 'snapshot@example.com',
      }]))
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
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: null,
      }]))
      .mockResolvedValueOnce(result([{
        phone: '4165550200',
        email: ' Current@Example.COM ',
      }]))
      .mockResolvedValueOnce(result([
        {
          id: 'source',
          depth: 1,
          has_cycle: false,
          has_unvisited_child: false,
        },
        {
          id: 'terminal',
          depth: 0,
          has_cycle: false,
          has_unvisited_child: false,
        },
      ]))
      .mockResolvedValueOnce(result([
        {
          id: 'source',
          phone: '4165550100',
          email: 'snapshot@example.com',
          client_id: null,
        },
        {
          id: 'terminal',
          phone: '4165550200',
          email: 'current@example.com',
          client_id: null,
        },
      ]))
      .mockResolvedValueOnce(result([]));

    await expect(resolveAppointmentOperationalEmailRecipientWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', appointmentId: 'appointment-a' },
    )).resolves.toEqual({
      status: 'terminal_current',
      email: 'current@example.com',
      terminalClientId: 'terminal',
    });
  });

  it('uses a valid immutable snapshot only when an unambiguous terminal has no email', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{
        salon_client_id: null,
        client_phone: '4165550100',
        client_email: ' Snapshot@Example.COM ',
      }]))
      .mockResolvedValueOnce(result([{ id: 'source' }]))
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
        archived_at: new Date(),
      }]))
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: new Date(),
      }]))
      .mockResolvedValueOnce(result([{
        phone: '4165550200',
        email: null,
      }]))
      .mockResolvedValueOnce(result([
        {
          id: 'source',
          depth: 1,
          has_cycle: false,
          has_unvisited_child: false,
        },
        {
          id: 'terminal',
          depth: 0,
          has_cycle: false,
          has_unvisited_child: false,
        },
      ]))
      .mockResolvedValueOnce(result([
        {
          id: 'source',
          phone: '4165550100',
          email: 'snapshot@example.com',
          client_id: null,
        },
        {
          id: 'terminal',
          phone: '4165550200',
          email: null,
          client_id: null,
        },
      ]))
      .mockResolvedValueOnce(result([]));

    await expect(resolveAppointmentOperationalEmailRecipientWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', appointmentId: 'appointment-a' },
    )).resolves.toEqual({
      status: 'appointment_snapshot',
      email: 'snapshot@example.com',
      terminalClientId: 'terminal',
    });
  });

  it('uses a valid immutable snapshot for an explicitly zero-candidate orphan', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{
        salon_client_id: null,
        client_phone: '4165550100',
        client_email: ' Orphan@Example.COM ',
      }]))
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{
        has_unsupported_identity: false,
      }]));

    await expect(resolveAppointmentOperationalEmailRecipientWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', appointmentId: 'orphan-appointment' },
    )).resolves.toEqual({
      status: 'appointment_snapshot',
      email: 'orphan@example.com',
      terminalClientId: null,
      identityResolution: 'zero_identity_candidates',
    });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('selects only active future null-owned orphan recovery appointments after a zero-candidate recheck', async () => {
    const startTime = new Date('2099-07-01T18:00:00Z');
    const endTime = new Date('2099-07-01T19:00:00Z');
    const execute = vi.fn()
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{
        has_unsupported_identity: false,
      }]))
      .mockResolvedValueOnce(result([{
        id: 'orphan-appointment',
        start_time: startTime,
        end_time: endTime,
      }]));

    await expect(getZeroCandidateOrphanRecoveryAppointmentsWithHandle(
      { execute } as LifecycleSqlHandle,
      {
        salonId: 'salon-a',
        phone: '+1 (416) 555-0100',
        email: ' ORPHAN@Example.com ',
        now: new Date('2099-06-01T00:00:00Z'),
      },
    )).resolves.toEqual([{
      id: 'orphan-appointment',
      startTime,
      endTime,
    }]);
    expect(execute).toHaveBeenCalledTimes(3);

    const rendered = new PgDialect().sqlToQuery(
      execute.mock.calls[2]![0] as SQL,
    );
    const compactSql = rendered.sql.replace(/\s+/g, '');

    expect(rendered.sql).toContain('appointment.salon_id =');
    expect(rendered.sql).toContain('appointment.salon_client_id is null');
    // The status list is now BOUND rather than inlined (it is sourced from
    // SLOT_OCCUPYING_CLIENT_STATUSES instead of being retyped here), so assert
    // on the bound values — which also pins that a deposit hold is selected.
    expect(rendered.sql).toContain('appointment.status in (');
    expect(rendered.params).toEqual(
      expect.arrayContaining(['pending', 'confirmed', 'in_progress', 'awaiting_payment']),
    );
    expect(rendered.sql).toContain('appointment.deleted_at is null');
    expect(rendered.sql).toContain('appointment.end_time >');
    expect(compactSql).toContain(
      'regexp_replace(appointment.client_phone,\'[^0-9]\',\'\',\'g\')',
    );
    expect(rendered.sql).toContain(
      'lower(btrim(appointment.client_email)) =',
    );
    expect(rendered.sql).toContain('limit 26');
    expect(rendered.params).toContain('salon-a');
    expect(rendered.params).toContain('4165550100');
    expect(rendered.params).toContain('orphan@example.com');
  });

  it('fails orphan recovery closed when more than the bounded complete set matches', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{
        has_unsupported_identity: false,
      }]))
      .mockResolvedValueOnce(result(Array.from({ length: 26 }, (_, index) => ({
        id: `orphan-${index}`,
        start_time: new Date('2099-07-01T18:00:00Z'),
        end_time: new Date('2099-07-01T19:00:00Z'),
      }))));

    await expect(getZeroCandidateOrphanRecoveryAppointmentsWithHandle(
      { execute } as LifecycleSqlHandle,
      {
        salonId: 'salon-a',
        email: 'orphan@example.com',
      },
    )).resolves.toEqual([]);
  });

  it('does not unlock orphan snapshot fallback for an invalid snapshot email', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{
        salon_client_id: null,
        client_phone: '4165550100',
        client_email: 'not-an-email',
      }]))
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{
        has_unsupported_identity: false,
      }]));

    await expect(resolveAppointmentOperationalEmailRecipientWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', appointmentId: 'orphan-appointment' },
    )).resolves.toEqual({
      status: 'unavailable',
      reason: 'email_unavailable',
    });
  });

  it('does not unlock orphan snapshot fallback for an unsupported global customer identity', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{
        salon_client_id: null,
        client_phone: '4165550100',
        client_email: 'snapshot@example.com',
      }]))
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{
        has_unsupported_identity: true,
      }]));

    await expect(resolveAppointmentOperationalEmailRecipientWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', appointmentId: 'unsupported-orphan' },
    )).resolves.toEqual({
      status: 'unavailable',
      reason: 'unsupported_client_identity',
    });
  });

  it('fails closed instead of falling back when the current terminal email is invalid', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{
        salon_client_id: 'terminal',
        client_phone: '4165550100',
        client_email: 'snapshot@example.com',
      }]))
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: null,
      }]))
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: null,
      }]))
      .mockResolvedValueOnce(result([{
        phone: '4165550100',
        email: 'not-an-email',
      }]))
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        depth: 0,
        has_cycle: false,
        has_unvisited_child: false,
      }]))
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        phone: '4165550100',
        email: 'not-an-email',
        client_id: null,
      }]))
      .mockResolvedValueOnce(result([]));

    await expect(resolveAppointmentOperationalEmailRecipientWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', appointmentId: 'appointment-a' },
    )).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid_terminal_email',
    });
  });

  it('keeps stable ownership authoritative and fails closed for unsupported identities', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{
        salon_client_id: 'terminal',
        client_phone: '4165550999',
        client_email: 'alias@example.com',
      }]))
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: null,
      }]))
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        salon_id: 'salon-a',
        merged_into_client_id: null,
        archived_at: null,
      }]))
      .mockResolvedValueOnce(result([{
        phone: '4165550100',
        email: 'current@example.com',
      }]))
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        depth: 0,
        has_cycle: false,
        has_unvisited_child: false,
      }]))
      .mockResolvedValueOnce(result([{
        id: 'terminal',
        phone: '4165550100',
        email: 'current@example.com',
        client_id: 'unsupported-global-client',
      }]))
      .mockResolvedValueOnce(result([]));

    await expect(resolveAppointmentOperationalEmailRecipientWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', appointmentId: 'appointment-a' },
    )).resolves.toEqual({
      status: 'unavailable',
      reason: 'unsupported_client_identity',
    });
    expect(execute).toHaveBeenCalledTimes(7);
  });

  it('keeps non-null stable ownership authoritative when its owner is missing', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{
        salon_client_id: 'missing-owner',
        client_phone: '4165550100',
        client_email: 'snapshot@example.com',
      }]))
      .mockResolvedValueOnce(result([]));

    await expect(resolveAppointmentOperationalEmailRecipientWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', appointmentId: 'stable-owner-missing' },
    )).resolves.toEqual({
      status: 'unavailable',
      reason: 'client_identity_unavailable',
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: 'cycle',
      rows: [
        {
          id: 'source',
          salon_id: 'salon-a',
          merged_into_client_id: 'target',
          archived_at: new Date(),
        },
        {
          id: 'target',
          salon_id: 'salon-a',
          merged_into_client_id: 'source',
          archived_at: new Date(),
        },
      ],
    },
    {
      name: 'missing merge target',
      rows: [
        {
          id: 'source',
          salon_id: 'salon-a',
          merged_into_client_id: 'missing',
          archived_at: new Date(),
        },
        null,
      ],
    },
    {
      name: 'cross-salon merge target',
      rows: [
        {
          id: 'source',
          salon_id: 'salon-a',
          merged_into_client_id: 'foreign-target',
          archived_at: new Date(),
        },
        null,
      ],
    },
  ])('blocks valid snapshot fallback for $name lineage state', async ({ rows }) => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{
        salon_client_id: null,
        client_phone: '4165550100',
        client_email: 'snapshot@example.com',
      }]))
      .mockResolvedValueOnce(result([{ id: 'source' }]));
    for (const row of rows) {
      execute.mockResolvedValueOnce(result(row ? [row] : []));
    }

    await expect(resolveAppointmentOperationalEmailRecipientWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', appointmentId: 'invalid-lineage' },
    )).resolves.toEqual({
      status: 'unavailable',
      reason: 'client_identity_unavailable',
    });
  });

  it('blocks valid snapshot fallback when terminal traversal exceeds its bound', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result([{
        salon_client_id: null,
        client_phone: '4165550100',
        client_email: 'snapshot@example.com',
      }]))
      .mockResolvedValueOnce(result([{ id: 'source-0' }]));
    for (let depth = 0; depth < 16; depth += 1) {
      execute.mockResolvedValueOnce(result([{
        id: `source-${depth}`,
        salon_id: 'salon-a',
        merged_into_client_id: `source-${depth + 1}`,
        archived_at: new Date(),
      }]));
    }

    await expect(resolveAppointmentOperationalEmailRecipientWithHandle(
      { execute } as LifecycleSqlHandle,
      { salonId: 'salon-a', appointmentId: 'excessive-lineage' },
    )).resolves.toEqual({
      status: 'unavailable',
      reason: 'client_identity_unavailable',
    });
  });

  it('returns safe unavailable results for missing and ambiguous appointment ownership', async () => {
    await expect(resolveAppointmentOperationalEmailRecipientWithHandle(
      {
        execute: vi.fn().mockResolvedValue(result([])),
      } as LifecycleSqlHandle,
      { salonId: 'salon-a', appointmentId: 'missing' },
    )).resolves.toEqual({
      status: 'unavailable',
      reason: 'appointment_not_found',
    });

    const ambiguous = vi.fn()
      .mockResolvedValueOnce(result([{
        salon_client_id: null,
        client_phone: '4165550100',
        client_email: 'snapshot@example.com',
      }]))
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

    await expect(resolveAppointmentOperationalEmailRecipientWithHandle(
      { execute: ambiguous } as LifecycleSqlHandle,
      { salonId: 'salon-a', appointmentId: 'ambiguous' },
    )).resolves.toEqual({
      status: 'unavailable',
      reason: 'client_identity_unavailable',
    });
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

    for (const code of ['55P03', '57014']) {
      const timeout = databaseError(code);
      const timedOutOperation = vi.fn().mockRejectedValue(timeout);

      expect(isClientLifecycleTransactionTimeoutError({
        cause: timeout,
      })).toBe(true);
      await expect(withClientLifecycleTransactionRetry(timedOutOperation, {
        sleep,
      })).rejects.toBe(timeout);
      expect(timedOutOperation).toHaveBeenCalledTimes(1);
    }

    expect(isClientLifecycleTransactionTimeoutError(
      databaseError('23514'),
    )).toBe(false);
  });
});
