import 'server-only';

import type { Pool, PoolClient, QueryConfig } from 'pg';

import {
  createRuntimeDatabasePoolVerifier,
  RuntimeDatabaseGuardError,
  type RuntimePostgresTarget,
} from './runtimeDatabaseGuard';
import type { RuntimeDatabaseVerificationCooldown } from './runtimeDatabasePoolRecovery';

// Only read-only runtime attestation and liveness queries use this deadline.
// Keep it separate from the 15s physical connection window for cold starts;
// never impose a global timeout on business queries or transaction commits.
export const RUNTIME_DATABASE_READ_TIMEOUT_MS = 5_000;

// pg supports query_timeout per query; the installed @types/pg declares it
// only on ClientConfig. Keep that missing option local to these read queries.
type RuntimeReadQueryConfig = QueryConfig & { query_timeout: number };

/** pool.query destroys a client after a timed-out read instead of reusing it. */
export async function pingRuntimePostgres(pool: Pick<Pool, 'query'>): Promise<void> {
  const query: RuntimeReadQueryConfig = { text: 'SELECT 1', query_timeout: RUNTIME_DATABASE_READ_TIMEOUT_MS };
  await pool.query(query);
}

/** The same cooldown must also be supplied to the physical pre-connect Client. */
export function createGuardedRuntimeDatabasePoolVerifier(
  target: RuntimePostgresTarget,
  cooldown: RuntimeDatabaseVerificationCooldown,
): (client: PoolClient, callback: (error?: Error) => void) => void {
  const verify = createRuntimeDatabasePoolVerifier(target);

  return (client, callback) => {
    let socketFailure: RuntimeDatabaseGuardError | undefined;
    const onError = () => {
      // Never forward private socket/provider error text.
      socketFailure = new RuntimeDatabaseGuardError('DATABASE_UNAVAILABLE');
      // The native driver rejects an active query on a socket failure, and
      // query_timeout bounds the fallback. Do not race that guard result:
      // an already-returned wrong marker or 42501 must retain its existing
      // attestation classification even if a socket error arrives meanwhile.
    };
    // pg-pool removes its idle error listener before invoking verify, and its
    // physical connection timer has already ended. Own errors during that gap.
    client.on('error', onError);
    const finish = (error?: Error) => {
      try {
        // On failure pg-pool's callback calls release(error), destroying the
        // client even if the timed-out server query has not stopped yet.
        callback(error);
      } finally {
        client.removeListener('error', onError);
      }
    };

    void cooldown.guard(() => new Promise<void>((resolve, reject) => {
      verify({
        query: (text, values) => {
          const query: RuntimeReadQueryConfig = {
            text,
            values,
            query_timeout: RUNTIME_DATABASE_READ_TIMEOUT_MS,
          };
          return client.query(query);
        },
      }, error => error ? reject(error) : resolve());
    })).then(
      () => finish(socketFailure ? cooldown.recordFailure(socketFailure) : undefined),
      (error: unknown) => finish(error instanceof RuntimeDatabaseGuardError
        ? error
        : new RuntimeDatabaseGuardError('DATABASE_UNAVAILABLE')),
    );
  };
}
