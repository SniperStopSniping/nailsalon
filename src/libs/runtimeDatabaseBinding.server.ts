import 'server-only';

import { isIP } from 'node:net';

import { z } from 'zod';

export type RuntimeDatabaseBindingStatus = 'matched' | 'mismatched' | 'unavailable';

const identifier = z.string().min(1).max(63).refine(value =>
  value === value.trim()
  && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  && !value.includes('://'));
const host = z.string().min(1).max(253).refine(value =>
  isIP(value) !== 0 || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(value))
  .transform(value => value.toLowerCase());
const port = z.number().int().min(1).max(65535);

// An independently provisioned expectation, never a connection string or a
// source of connection options. Only these five identity fields are accepted.
const expectedBindingSchema = z.object({
  host,
  port,
  database: identifier,
  sessionUser: identifier,
  currentUser: identifier,
}).strict();

const identityRowSchema = z.object({
  database_name: identifier,
  session_user_name: identifier,
  current_user_name: identifier,
}).strict();

export function parseExpectedDatabaseBinding(value: string | undefined) {
  // Bound JSON parsing, including for malformed private configuration. No
  // parse errors, supplied values, identifiers or fingerprints are logged.
  if (!value || value.length > 2048) {
    return null;
  }
  try {
    const result = expectedBindingSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

type BindingClient = {
  // pg sets these from the connection's effective parameters on the Client.
  // They intentionally do not come from a freshly read environment URL.
  host?: unknown;
  port?: unknown;
  query: (config: { text: string; query_timeout: number }) => Promise<{ rows: unknown[] }>;
  release: (destroy?: boolean) => void;
  on: (event: 'error', listener: (error: Error) => void) => unknown;
  removeListener: (event: 'error', listener: (error: Error) => void) => unknown;
};

type BindingPool = { connect: () => Promise<BindingClient> };

// pg's connect timeout ends before the guarded verifier completes. Bound the
// whole lease wait separately; a late lease must be discarded, never leaked.
async function acquireBindingClient(pool: BindingPool): Promise<BindingClient | null> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = pool.connect().then((client) => {
    if (expired) {
      try {
        client.release(true);
      } catch {
        // Never publish private release errors from a late lease.
      }
      return null;
    }
    return client;
  });
  try {
    return await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          expired = true;
          resolve(null);
        }, 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Internal server-only seam. DB.ts supplies its already-guarded runtime pool. */
export async function readRuntimeDatabaseBindingStatus(
  expectedDescriptor: string | undefined,
  pool: BindingPool | null,
): Promise<RuntimeDatabaseBindingStatus> {
  const expected = parseExpectedDatabaseBinding(expectedDescriptor);
  if (!expected || !pool) {
    return 'unavailable';
  }

  let client: BindingClient | undefined;
  let destroyClient = false;
  let status: RuntimeDatabaseBindingStatus = 'unavailable';
  const onClientError = () => {
    destroyClient = true;
    status = 'unavailable';
  };
  try {
    client = await acquireBindingClient(pool) ?? undefined;
    if (!client) {
      return 'unavailable';
    }
    client.on('error', onClientError);
    const actualHost = host.safeParse(client.host);
    const actualPort = port.safeParse(client.port);
    if (actualHost.success && actualPort.success) {
      const result = await client.query({
        text: 'SELECT current_database() AS database_name, session_user AS session_user_name, current_user AS current_user_name',
        query_timeout: 1000,
      });
      const identity = result.rows.length === 1 ? identityRowSchema.safeParse(result.rows[0]) : null;
      if (identity?.success && !destroyClient) {
        status = actualHost.data === expected.host
        && actualPort.data === expected.port
        && identity.data.database_name === expected.database
        && identity.data.session_user_name === expected.sessionUser
        && identity.data.current_user_name === expected.currentUser
          ? 'matched'
          : 'mismatched';
      }
    }
  } catch {
    // A query timeout may leave a query pending. Discard that leased client
    // instead of returning a potentially busy session to the shared pool.
    destroyClient = true;
  } finally {
    if (client) {
      try {
        client.release(destroyClient);
      } catch {
        status = 'unavailable';
      } finally {
        client.removeListener('error', onClientError);
      }
    }
  }
  return status;
}
