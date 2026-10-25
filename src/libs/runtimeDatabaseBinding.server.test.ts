import { EventEmitter } from 'node:events';

import { parseExpectedDatabaseBinding, readRuntimeDatabaseBindingStatus } from './runtimeDatabaseBinding.server';

vi.mock('server-only', () => ({}));

const expected = { host: 'approved.example.test', port: 5432, database: 'approved_db', sessionUser: 'login_role', currentUser: 'effective_role' };
const descriptor = JSON.stringify(expected);
const identity = { database_name: expected.database, session_user_name: expected.sessionUser, current_user_name: expected.currentUser };

function lease() {
  const client = Object.assign(new EventEmitter(), {
    host: expected.host,
    port: expected.port,
    query: vi.fn().mockResolvedValue({ rows: [{ ...identity }] }),
    release: vi.fn(),
  });
  return { client, pool: { connect: vi.fn().mockResolvedValue(client) } };
}

describe('private database binding descriptor', () => {
  it('accepts only the independent five-field descriptor and normalizes DNS case', () => {
    expect(parseExpectedDatabaseBinding(descriptor)).toEqual(expected);
    expect(parseExpectedDatabaseBinding(JSON.stringify({ ...expected, host: 'APPROVED.EXAMPLE.TEST' }))).toEqual(expected);
  });

  it.each([
    undefined,
    '',
    'not-json',
    'null',
    '[]',
    'x'.repeat(2049),
    JSON.stringify('postgresql://unapproved.example.invalid/db'),
    JSON.stringify({ ...expected, password: 'secret' }),
    JSON.stringify({ ...expected, connectionString: 'postgresql://unapproved.example.invalid/db' }),
    JSON.stringify({ ...expected, host: 'postgresql://unapproved.example.test' }),
    JSON.stringify({ ...expected, host: '*.example.test' }),
    JSON.stringify({ ...expected, host: ' approved.example.test' }),
    JSON.stringify({ ...expected, port: '5432' }),
    JSON.stringify({ ...expected, port: 0 }),
    JSON.stringify({ ...expected, port: 65536 }),
    JSON.stringify({ ...expected, currentUser: '' }),
    JSON.stringify({ ...expected, database: 'db\nname' }),
  ])('rejects malformed or credential-bearing configuration case %#', (value) => {
    expect(parseExpectedDatabaseBinding(value)).toBeNull();
  });
});

describe('leased runtime database binding status', () => {
  it('uses one leased client for effective host/port and SQL identities, then releases it', async () => {
    const { client, pool } = lease();
    const status = await readRuntimeDatabaseBindingStatus(descriptor, pool);

    expect(status).toBe('matched');
    expect(pool.connect).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledExactlyOnceWith({
      text: 'SELECT current_database() AS database_name, session_user AS session_user_name, current_user AS current_user_name',
      query_timeout: 1000,
    });
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(client.listenerCount('error')).toBe(0);
  });

  it.each(['host', 'port', 'database', 'sessionUser', 'currentUser'] as const)('detects a %s mismatch without publishing the actual or expected identity', async (field) => {
    const { client, pool } = lease();
    const other = { ...expected, [field]: field === 'port' ? 5433 : 'other' };
    const status = await readRuntimeDatabaseBindingStatus(JSON.stringify(other), pool);

    expect(status).toBe('mismatched');
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(JSON.stringify(status)).not.toContain(expected.host);
    expect(JSON.stringify(status)).not.toContain(expected.database);
  });

  it.each([undefined, '', '{', JSON.stringify({ ...expected, password: 'private-secret' })])('does not lease or query for invalid/unset configuration case %#', async (value) => {
    const { client, pool } = lease();

    expect(await readRuntimeDatabaseBindingStatus(value, pool)).toBe('unavailable');
    expect(pool.connect).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
    expect(client.release).not.toHaveBeenCalled();
  });

  it('returns unavailable without PostgreSQL and without throwing query/provider details', async () => {
    const { client, pool } = lease();
    pool.connect.mockRejectedValue(new Error('private provider identity and credentials'));

    expect(await readRuntimeDatabaseBindingStatus(descriptor, null)).toBe('unavailable');
    expect(await readRuntimeDatabaseBindingStatus(descriptor, pool)).toBe('unavailable');
    expect(client.query).not.toHaveBeenCalled();
    expect(client.release).not.toHaveBeenCalled();
  });

  it('bounds a stalled guarded acquisition and discards a late lease without querying', async () => {
    vi.useFakeTimers();
    const { client, pool } = lease();
    let finish!: (value: typeof client) => void;
    pool.connect.mockReturnValue(new Promise((resolve) => {
      finish = resolve;
    }));
    try {
      const pending = readRuntimeDatabaseBindingStatus(descriptor, pool);
      await vi.advanceTimersByTimeAsync(2000);

      expect(await pending).toBe('unavailable');
      expect(client.release).not.toHaveBeenCalled();

      finish(client);
      await Promise.resolve();

      expect(client.query).not.toHaveBeenCalled();
      expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('absorbs a private acquisition rejection after its diagnostic deadline', async () => {
    vi.useFakeTimers();
    const { client, pool } = lease();
    let fail!: (error: Error) => void;
    pool.connect.mockReturnValue(new Promise((_resolve, reject) => {
      fail = reject;
    }));
    try {
      const pending = readRuntimeDatabaseBindingStatus(descriptor, pool);
      await vi.advanceTimersByTimeAsync(2000);

      expect(await pending).toBe('unavailable');

      fail(new Error('private late verifier error'));
      await Promise.resolve();

      expect(client.query).not.toHaveBeenCalled();
      expect(client.release).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('absorbs a leased client error event and discards the connection even if its query resolves', async () => {
    const { client, pool } = lease();
    client.query.mockImplementation(async () => {
      client.emit('error', new Error('private socket failure'));
      return { rows: [{ ...identity }] };
    });

    expect(await readRuntimeDatabaseBindingStatus(descriptor, pool)).toBe('unavailable');
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('discards a leased session on query failure, including timeout, without exposing errors', async () => {
    const { client, pool } = lease();
    client.query.mockRejectedValue(new Error('private query error'));

    expect(await readRuntimeDatabaseBindingStatus(descriptor, pool)).toBe('unavailable');
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it.each([{ rows: [] }, { rows: [{ ...identity }, { ...identity }] }, { rows: [{ ...identity, current_user_name: null }] }])('fails closed for malformed SQL identity case %#', async ({ rows }) => {
    const { client, pool } = lease();
    client.query.mockResolvedValue({ rows });

    expect(await readRuntimeDatabaseBindingStatus(descriptor, pool)).toBe('unavailable');
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('fails closed for absent effective client parameters and still releases', async () => {
    const { client, pool } = lease();
    client.host = '';

    expect(await readRuntimeDatabaseBindingStatus(descriptor, pool)).toBe('unavailable');
    expect(client.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('never reports matched when releasing the session fails', async () => {
    const { client, pool } = lease();
    client.release.mockImplementation(() => {
      throw new Error('private release error');
    });

    expect(await readRuntimeDatabaseBindingStatus(descriptor, pool)).toBe('unavailable');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
