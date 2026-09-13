import 'server-only';

import { type SQL, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { db } from '@/libs/DB';
import * as schema from '@/models/Schema';

import { depositsTransaction, type DepositsTransactionHandle } from './depositsTransaction';

export type ShadowExecutor = { execute: (query: SQL) => PromiseLike<{ rows: unknown[] }> };

export function shadowDeadlineError(): Error & { code: string } {
  return Object.assign(new Error('shadow_worker_deadline'), { code: '57014' });
}

export function isShadowDeadlineError(error: unknown): boolean {
  for (let cause = error, depth = 0; cause && typeof cause === 'object' && depth < 4; depth += 1) {
    const detail = cause as { code?: string; cause?: unknown };
    if (['57014', '25P03'].includes(detail.code ?? '')) {
      return true;
    }
    cause = detail.cause;
  }
  return false;
}

/**
 * PostgreSQL 16 has no transaction_timeout. Bound both idle gaps surrounding
 * each active statement, so none can retain acquired locks past the deadline.
 * Settings are LOCAL and the server computes remaining time when it receives them.
 */
async function armDeadline(tx: ShadowExecutor, deadline: number) {
  if (Date.now() >= deadline) {
    throw shadowDeadlineError();
  }
  await tx.execute(sql`WITH budget AS MATERIALIZED (
    SELECT greatest(1,floor(extract(epoch FROM (to_timestamp(${deadline / 1000})-clock_timestamp()))*1000/3))::int AS ms
  ) SELECT set_config('statement_timeout',ms::text,true),
    set_config('idle_in_transaction_session_timeout',ms::text,true) FROM budget`);
  if (Date.now() >= deadline) {
    throw shadowDeadlineError();
  }
}

/**
 * Shadow-only checkout: a terminated idle client must leave the pool even if
 * its application callback is still paused. Do not alter the shared pool or
 * legacy transaction behavior, and never access private Drizzle session fields.
 */
export async function boundedShadowTransaction<T>(deadline: number, work: (tx: ShadowExecutor) => Promise<T>): Promise<T> {
  let deadlineFailure: unknown;
  const run = async (tx: DepositsTransactionHandle) => {
    const timed: ShadowExecutor = {
      async execute(query) {
        try {
          await armDeadline(tx, deadline);
          return await tx.execute(query);
        } catch (error) {
          if (isShadowDeadlineError(error)) {
            deadlineFailure ??= error;
          }
          throw error;
        }
      },
    };
    try {
      const result = await work(timed);
      // Cover the callback-to-COMMIT idle gap as well; no setting escapes COMMIT.
      await armDeadline(tx, deadline);
      return result;
    } catch (error) {
      if (isShadowDeadlineError(error)) {
        deadlineFailure ??= error;
      }
      throw error;
    }
  };
  if (Date.now() >= deadline) {
    throw shadowDeadlineError();
  }
  const transport = (db as typeof db & { $client?: unknown }).$client;
  if (!(transport instanceof Pool)) {
    return depositsTransaction(db, run);
  }
  const client = await transport.connect();
  let released = false;
  let terminated: Error | undefined;
  const release = (destroy: boolean) => {
    if (!released) {
      released = true;
      client.release(destroy);
    }
  };
  const onError = (error: Error) => {
    terminated ??= error;
    release(true);
  };
  client.on('error', onError);
  try {
    // An expired queued checkout may not start SQL after finally acquiring a slot.
    if (Date.now() >= deadline) {
      throw shadowDeadlineError();
    }
    return await depositsTransaction(drizzle(client, { schema }), run);
  } catch (error) {
    // Drizzle's ROLLBACK on a terminated connection can mask the server SQLSTATE.
    throw deadlineFailure ?? terminated ?? error;
  } finally {
    release(!!terminated);
    client.removeListener('error', onError);
  }
}
