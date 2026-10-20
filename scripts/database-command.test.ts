import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  end: vi.fn(),
  query: vi.fn(),
  createClient: vi.fn(),
  drizzle: vi.fn(),
  migrate: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('pg', () => ({
  Client: class {
    constructor(config: unknown) {
      mocks.createClient(config);
    }

    connect = mocks.connect;
    end = mocks.end;
    query = mocks.query;
  },
}));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: mocks.drizzle }));
vi.mock('drizzle-orm/node-postgres/migrator', () => ({ migrate: mocks.migrate }));
vi.mock('node:child_process', () => ({ spawnSync: mocks.spawn }));

const syntheticUrl = 'postgresql://fixture@localhost/isolated_fixture';
const adapter = { fixture: true };
let stderr: ReturnType<typeof vi.spyOn>;
let savedArgv: string[];
let savedExitCode: typeof process.exitCode;

async function invoke(command = 'migrate'): Promise<void> {
  process.argv = ['node', 'scripts/database-command.ts', 'production', command];
  await import('./database-command');
  // The executable owns its top-level async main; wait for its bounded work.
  await vi.waitFor(() => {
    expect(mocks.end.mock.calls.length + stderr.mock.calls.length).toBeGreaterThan(0);
  });
}

describe('guarded Production database executable', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    savedArgv = [...process.argv];
    savedExitCode = process.exitCode;
    process.exitCode = 0;
    vi.stubEnv('CI', 'false');
    vi.stubEnv('GITHUB_ACTIONS', 'false');
    vi.stubEnv('DATABASE_URL', syntheticUrl);
    const now = new Date();
    vi.stubEnv('LUSTER_PRODUCTION_CONFIRM', [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-'));
    mocks.connect.mockResolvedValue(undefined);
    mocks.end.mockResolvedValue(undefined);
    mocks.query.mockResolvedValue({ rows: [{ environment: 'production' }] });
    mocks.drizzle.mockReturnValue(adapter);
    mocks.migrate.mockResolvedValue(undefined);
    mocks.spawn.mockReturnValue({ status: 0 });
    stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    process.argv = savedArgv;
    process.exitCode = savedExitCode;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('runs the pinned migrator on the attested client without invoking the old CLI', async () => {
    await invoke();

    expect(mocks.createClient).toHaveBeenCalledWith({ connectionString: syntheticUrl });
    expect(mocks.query).toHaveBeenCalledOnce();

    const client = mocks.drizzle.mock.calls[0]?.[0];

    expect(client).toMatchObject({ connect: mocks.connect, query: mocks.query, end: mocks.end });
    expect(mocks.migrate).toHaveBeenCalledWith(adapter, {
      migrationsFolder: path.resolve(import.meta.dirname, '../migrations'),
    });
    expect(mocks.query.mock.invocationCallOrder[0]).toBeLessThan(mocks.migrate.mock.invocationCallOrder[0]!);
    expect(mocks.migrate.mock.invocationCallOrder[0]).toBeLessThan(mocks.end.mock.invocationCallOrder[0]!);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it.each(['CI', 'GITHUB_ACTIONS'])('rejects %s before opening a connection', async (key) => {
    vi.stubEnv(key, 'true');
    await invoke();

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.migrate).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('requires the exact current-date confirmation before opening a connection', async () => {
    vi.stubEnv('LUSTER_PRODUCTION_CONFIRM', 'not-confirmed');
    await invoke();

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.migrate).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('rejects a non-Production marker and closes the connection', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ environment: 'preview' }] });
    await invoke();

    expect(mocks.migrate).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  it('preserves the legacy absent-marker path without bypassing other failures', async () => {
    mocks.query.mockRejectedValueOnce({ code: '42P01' });
    await invoke();

    expect(mocks.migrate).toHaveBeenCalledOnce();
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(stderr).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it('does not migrate when target attestation fails', async () => {
    mocks.query.mockRejectedValue(new Error(`private-value connection detail: ${syntheticUrl}`));
    await invoke();

    expect(mocks.migrate).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(stderr.mock.calls.flat().join(' ')).not.toContain('private-value');
    expect(process.exitCode).toBe(1);
  });

  it('closes the attested connection and sanitizes migration failures', async () => {
    mocks.migrate.mockRejectedValue(new Error(`private-value SQL connection detail: ${syntheticUrl}`));
    await invoke();

    expect(mocks.end).toHaveBeenCalledOnce();
    expect(stderr.mock.calls.flat().join(' ')).not.toContain('private-value');
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('retains the existing guarded Studio path', async () => {
    await invoke('studio');

    expect(mocks.migrate).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    const [executable, args, options] = mocks.spawn.mock.calls[0]!;

    expect(executable).toMatch(/drizzle-kit(?:\.cmd)?$/);
    expect(args).toEqual(['studio']);
    expect(options.env.DATABASE_URL).toBeUndefined();
    expect(options.env.LUSTER_GUARDED_DATABASE_URL).toBe(syntheticUrl);
  });
});
