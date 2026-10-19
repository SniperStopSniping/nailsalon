import 'server-only';

import { Client } from 'pg';

import type { RuntimeDatabaseVerificationCooldown } from './runtimeDatabasePoolRecovery';

/**
 * Keep pg's real Pool, clients and query builders. Guard the physical connect,
 * including clients created internally for requests already in pg-pool's queue.
 * A successful TCP connection is NOT an attestation: only the verifier may
 * clear the shared failure after checking that particular connection.
 */
export function createRuntimeDatabaseCooldownClient(
  cooldown: RuntimeDatabaseVerificationCooldown,
): typeof Client {
  return class RuntimeDatabaseCooldownClient extends Client {
    override connect(): Promise<void>;
    override connect(callback: (error: Error) => void): void;
    override connect(callback?: (error: Error) => void): Promise<void> | void {
      const failure = cooldown.getFailureDuringCooldown();
      if (failure) {
        if (callback) {
          queueMicrotask(() => callback(failure));
          return;
        }
        return Promise.reject(failure);
      }

      if (callback) {
        super.connect((error) => {
          callback(error ? cooldown.recordFailure(error) : error);
        });
        return;
      }

      return super.connect().catch((error: unknown) => {
        throw cooldown.recordFailure(error);
      });
    }
  };
}
