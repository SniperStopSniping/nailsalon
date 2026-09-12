import 'server-only';

import { type SQL, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';

import { depositsTransaction } from './depositsTransaction';
import { assessObservation, type Observation, type ReceiptProjection } from './shadowProjection';

type Executor = { execute: (query: SQL) => PromiseLike<{ rows: unknown[] }> };
async function rows<T>(executor: Executor, query: SQL): Promise<T[]> {
  return (await executor.execute(query)).rows as T[];
}
const json = (value: unknown) => value === null ? sql`NULL` : sql`${JSON.stringify(value)}::jsonb`;

type Binding = {
  id: string;
  salon_id: string;
  appointment_id: string;
  stripe_account_id: string;
  stripe_payment_intent_id: string | null;
  amount_cents: number;
  currency: string;
  stripe_refund_id: string | null;
  prior_refund_ids: string[];
  refund_requested_at: Date | null;
  refund_status: string | null;
  status: string;
  refunded_at: Date | null;
  refund_key_epoch: number;
  refund_requested_by: string | null;
  refund_requested_by_role: string | null;
  fingerprint: string;
};
export type ShadowClaim = {
  deposit_id: string;
  salon_id: string;
  appointment_id: string;
  account: string;
  livemode: boolean;
  payment_intent_id: string | null;
  charge_id: string | null;
  generation: number;
  version: number;
  fence: number;
  legacy_fingerprint: string | null;
  deadline: number;
  cursor: import('./shadowProgress').ShadowProgress | null;
};

// Missing payment identities still share this evidence-admission lock. All shadow
// receipt/finalization paths acquire it before appointment/deposit locks; legacy never uses it.
async function lockEvidenceAccount(tx: Executor, account: string | null, livemode: boolean, lockTimeoutMs = 1000) {
  await tx.execute(sql`SELECT set_config('lock_timeout',${String(lockTimeoutMs)},true)`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`d6r1:${account ?? 'unknown'}`} || ${String(livemode)},0))`);
}

async function lockPayment(tx: Executor, salonId: string, depositId: string): Promise<Binding | null> {
  const [selector] = await rows<{ appointment_id: string }>(tx, sql`
    SELECT appointment_id FROM appointment_deposit WHERE salon_id=${salonId} AND id=${depositId}`);
  if (!selector) {
    return null;
  }
  await tx.execute(sql`SELECT id FROM appointment WHERE salon_id=${salonId}
    AND id=${selector.appointment_id} FOR UPDATE`);
  const [binding] = await rows<Binding>(tx, sql`SELECT d.*, md5(to_jsonb(d)::text) AS fingerprint
    FROM appointment_deposit d WHERE salon_id=${salonId} AND id=${depositId} FOR UPDATE`);
  return binding ?? null;
}

/** Explicit observation enrollment only; never a financial ownership transfer. */
export async function enrollShadowDeposit(salonId: string, depositId: string, livemode: boolean): Promise<boolean> {
  return depositsTransaction(db, async (tx) => {
    const d = await lockPayment(tx, salonId, depositId);
    if (!d) {
      return false;
    }
    const binding = await rows(tx, sql`SELECT id FROM salon_stripe_account
      WHERE salon_id=${salonId} AND stripe_account_id=${d.stripe_account_id} AND livemode=${livemode}
        AND NOT EXISTS (SELECT 1 FROM salon_stripe_account other WHERE other.salon_id=${salonId}
          AND other.stripe_account_id=${d.stripe_account_id} AND other.livemode<>${livemode})`);
    if (!binding.length) {
      return false;
    }
    await tx.execute(sql`INSERT INTO deposit_shadow_state
      (deposit_id,salon_id,appointment_id,account,livemode,payment_intent_id,legacy_fingerprint)
      VALUES (${depositId},${salonId},${d.appointment_id},${d.stripe_account_id},${livemode},
        ${d.stripe_payment_intent_id},${d.fingerprint}) ON CONFLICT (deposit_id) DO NOTHING`);
    const [state] = await rows<ShadowClaim>(tx, sql`SELECT * FROM deposit_shadow_state
      WHERE deposit_id=${depositId} AND salon_id=${salonId} AND account=${d.stripe_account_id}
        AND livemode=${livemode} AND payment_intent_id IS NOT DISTINCT FROM ${d.stripe_payment_intent_id}`);
    return !!state;
  });
}

function hasLegacyRefundEvidence(d: Binding): boolean {
  return d.refund_requested_at !== null || d.refund_status !== null
    || d.stripe_refund_id !== null
    || d.status === 'refunded' || d.refunded_at !== null;
}

async function retainLegacyShadowCommand(tx: Executor, d: Binding, livemode: boolean) {
  const id = `legacy:${d.id}`;
  await tx.execute(sql`INSERT INTO deposit_shadow_command
      (id,salon_id,deposit_id,account,livemode,payment_intent_id,currency,requested_at,actor_id,actor_role,evidence)
      VALUES (${id},${d.salon_id},${d.id},${d.stripe_account_id},${livemode},${d.stripe_payment_intent_id},
        ${d.currency},${d.refund_requested_at},${d.refund_requested_by},${d.refund_requested_by_role},
        ${json({ source: 'legacy_columns', status: d.refund_status, providerRefundId: d.stripe_refund_id, depositStatus: d.status, refundedAt: d.refunded_at })})
      ON CONFLICT(id) DO NOTHING`);
  await tx.execute(sql`INSERT INTO deposit_shadow_attempt
      (id,command_id,ordinal,provider_refund_id,evidence)
      VALUES (${`${id}:${d.refund_key_epoch}`},${id},${d.refund_key_epoch},${d.stripe_refund_id},
        ${json({ source: 'legacy_columns', requestShape: 'unknown', keyEpoch: d.refund_key_epoch, priorRefundIds: d.prior_refund_ids, status: d.refund_status })})
      ON CONFLICT(command_id,ordinal) DO NOTHING`);
}

/** Preserve known legacy provenance without guessing an omitted request body or authorizing execution. */
export async function importLegacyShadowCommand(salonId: string, depositId: string, livemode: boolean) {
  if (!await enrollShadowDeposit(salonId, depositId, livemode)) {
    return false;
  }
  return depositsTransaction(db, async (tx) => {
    const d = await lockPayment(tx, salonId, depositId);
    if (!d || !hasLegacyRefundEvidence(d)) {
      return false;
    }
    const [s] = await rows(tx, sql`SELECT deposit_id FROM deposit_shadow_state WHERE salon_id=${salonId}
      AND deposit_id=${depositId} AND account=${d.stripe_account_id} AND livemode=${livemode} AND engine='legacy' FOR UPDATE`);
    if (!s) {
      return false;
    }
    await retainLegacyShadowCommand(tx, d, livemode);
    await tx.execute(sql`UPDATE deposit_shadow_state SET certificate=NULL,cursor=NULL,generation=generation+1,
      reason='legacy_operation_unknown',next_due_at=now() WHERE salon_id=${salonId} AND deposit_id=${depositId}`);
    return true;
  });
}

export type ShadowReceipt = {
  eventId: string;
  eventType: string;
  account: string | null;
  livemode: boolean;
  providerCreated: number | null;
  apiVersion: string | null;
  projection: ReceiptProjection;
};

async function routeReceipt(tx: Executor, receipt: ShadowReceipt): Promise<ShadowClaim | null> {
  const p = receipt.projection;
  const found = await rows<ShadowClaim>(tx, sql`SELECT s.* FROM deposit_shadow_state s
    WHERE s.account=${receipt.account} AND s.livemode=${receipt.livemode}
      AND ((${p.paymentIntentId}::text IS NOT NULL AND s.payment_intent_id=${p.paymentIntentId})
        OR (${p.chargeId}::text IS NOT NULL AND s.charge_id=${p.chargeId})
        OR EXISTS (SELECT 1 FROM deposit_shadow_object o WHERE o.account=s.account
          AND o.livemode=s.livemode AND o.salon_id=s.salon_id AND o.deposit_id=s.deposit_id
          AND o.object_id=${p.objectId})) LIMIT 2`);
  return found.length === 1 ? found[0]! : null;
}

async function invalidateReceipt(tx: Executor, receipt: ShadowReceipt): Promise<void> {
  const state = await routeReceipt(tx, receipt);
  if (!state || !await lockPayment(tx, state.salon_id, state.deposit_id)) {
    await tx.execute(sql`UPDATE deposit_shadow_receipt SET reason=COALESCE(reason,'unattributed'),
      attempts=attempts+1,next_due_at=now()+interval '1 hour' WHERE event_id=${receipt.eventId}`);
    return;
  }
  const [updated] = await rows<{ generation: number }>(tx, sql`UPDATE deposit_shadow_state
    SET generation=generation+1,certificate=NULL,cursor=NULL,reason='receipt_dirty',
      oldest_unresolved_at=COALESCE(oldest_unresolved_at,now()), next_due_at=now(),work_class='receipt'
    WHERE deposit_id=${state.deposit_id} AND salon_id=${state.salon_id}
      AND account=${receipt.account} AND livemode=${receipt.livemode} AND engine='legacy'
    RETURNING generation`);
  if (updated) {
    await tx.execute(sql`UPDATE deposit_shadow_receipt SET deposit_id=${state.deposit_id},
      salon_id=${state.salon_id},generation=${updated.generation},reason=${receipt.projection.deficiency}
      WHERE event_id=${receipt.eventId} AND generation IS NULL`);
  }
}

/** Independent dispatchable receipt, committed before legacy claim or acknowledgement. */
export async function captureShadowReceipt(receipt: ShadowReceipt): Promise<void> {
  await depositsTransaction(db, async (tx) => {
    await lockEvidenceAccount(tx, receipt.account, receipt.livemode);
    // Lock common payment first when already attributable. The insert alone is dispatchable otherwise.
    const state = await routeReceipt(tx, receipt);
    if (state) {
      await lockPayment(tx, state.salon_id, state.deposit_id);
    }
    const inserted = await rows(tx, sql`INSERT INTO deposit_shadow_receipt
      (event_id,event_type,account,livemode,provider_created,api_version,projection,reason)
      VALUES (${receipt.eventId},${receipt.eventType},${receipt.account},${receipt.livemode},
        ${receipt.providerCreated},${receipt.apiVersion},${json(receipt.projection)},${receipt.projection.deficiency})
      ON CONFLICT(event_id) DO NOTHING RETURNING event_id`);
    if (!inserted.length) {
      const [same] = await rows(tx, sql`SELECT event_id FROM deposit_shadow_receipt
        WHERE event_id=${receipt.eventId} AND account IS NOT DISTINCT FROM ${receipt.account}
          AND livemode=${receipt.livemode} AND event_type=${receipt.eventType}
          AND projection=${json(receipt.projection)}`);
      if (!same) {
        throw new Error('shadow_receipt_identity_conflict');
      }
      return;
    }
    await invalidateReceipt(tx, receipt);
  });
}

function retryableContention(error: unknown): boolean {
  // Drizzle may wrap the driver error. Never treat an arbitrary persistence or
  // admission error as successfully replayed work.
  for (let cause = error, depth = 0; cause && typeof cause === 'object' && depth < 4; depth += 1) {
    const detail = cause as { code?: string; cause?: unknown };
    if (['55P03', '40P01', '40001', '57014'].includes(detail.code ?? '')) {
      return true;
    }
    cause = detail.cause;
  }
  return false;
}

/** Each worker statement uses the remaining shared budget, including lock waits. */
async function boundedShadowTransaction<T>(deadline: number, work: (tx: Executor) => Promise<T>): Promise<T> {
  return depositsTransaction(db, async (tx) => {
    const timed: Executor = {
      async execute(query) {
        if (Date.now() >= deadline) {
          throw Object.assign(new Error('shadow_worker_deadline'), { code: '57014' });
        }
        await tx.execute(sql`SELECT set_config('statement_timeout',${String(Math.max(1, deadline - Date.now()))},true)`);
        return tx.execute(query);
      },
    };
    const result = await work(timed);
    if (Date.now() >= deadline) {
      throw Object.assign(new Error('shadow_worker_deadline'), { code: '57014' });
    }
    return result;
  });
}

/** Local recovery does not depend on Stripe event retention or legacy status. */
export async function replayShadowReceipts(limit = 50, deadline = Date.now() + 10_000): Promise<number> {
  if (Date.now() >= deadline) {
    return 0;
  }
  const pending = await boundedShadowTransaction(deadline, async (tx) => {
    return rows<{
      event_id: string;
      event_type: string;
      account: string | null;
      livemode: boolean;
      provider_created: number | null;
      api_version: string | null;
      projection: ReceiptProjection;
    }>(tx, sql`SELECT * FROM (SELECT r.*,row_number() OVER
      (PARTITION BY account,livemode ORDER BY next_due_at,event_id) AS fair_rank
    FROM deposit_shadow_receipt r WHERE generation IS NULL AND next_due_at<=now()) due
    ORDER BY fair_rank,next_due_at,event_id LIMIT ${Math.min(200, Math.max(1, limit))}`);
  }).catch((error: unknown) => {
    if (!retryableContention(error)) {
      throw error;
    }
    return [];
  });
  let attempted = 0;
  for (const r of pending) {
    if (Date.now() >= deadline) {
      break;
    }
    attempted += 1;
    try {
      await boundedShadowTransaction(deadline, async (tx) => {
        await lockEvidenceAccount(tx, r.account, r.livemode, Math.min(100, Math.max(1, deadline - Date.now())));
        const state = await routeReceipt(tx, {
          eventId: r.event_id,
          eventType: r.event_type,
          account: r.account,
          livemode: r.livemode,
          providerCreated: r.provider_created,
          apiVersion: r.api_version,
          projection: r.projection,
        });
        if (state) {
          await lockPayment(tx, state.salon_id, state.deposit_id);
        }
        const locked = await rows(tx, sql`SELECT event_id FROM deposit_shadow_receipt
        WHERE event_id=${r.event_id} AND generation IS NULL FOR UPDATE SKIP LOCKED`);
        if (locked.length) {
          await invalidateReceipt(tx, {
            eventId: r.event_id,
            eventType: r.event_type,
            account: r.account,
            livemode: r.livemode,
            providerCreated: r.provider_created,
            apiVersion: r.api_version,
            projection: r.projection,
          });
        }
      });
    } catch (error) {
      if (!retryableContention(error)) {
        throw error;
      }
      // The admission row is already durable. Defer its consumer progress only;
      // no evidence lock, completion or legacy-event mutation belongs here.
      // If even the receipt row is locked, leave it due for the next invocation.
      if (Date.now() < deadline) {
        try {
          await boundedShadowTransaction(deadline, async (tx) => {
            await tx.execute(sql`WITH available AS (SELECT event_id FROM deposit_shadow_receipt
              WHERE event_id=${r.event_id} AND generation IS NULL FOR UPDATE SKIP LOCKED)
              UPDATE deposit_shadow_receipt r SET attempts=attempts+1,
                next_due_at=now()+interval '1 second',reason=COALESCE(reason,'replay_contention')
              FROM available a WHERE r.event_id=a.event_id AND r.generation IS NULL`);
          });
        } catch (deferError) {
          if (!retryableContention(deferError)) {
            throw deferError;
          }
        }
      }
    }
  }
  return attempted;
}

/** Filter before LIMIT, take fair rounds across tenants/accounts/classes, then SKIP LOCKED. */
export async function claimShadowWork(limit: number, deadline: number, observationReserveMs = 0): Promise<ShadowClaim[]> {
  const claimDeadline = deadline - observationReserveMs;
  if (deadline - Date.now() < 1000 || Date.now() >= claimDeadline) {
    return [];
  }
  return boundedShadowTransaction(claimDeadline, async (tx) => {
    const claims = await rows<ShadowClaim>(tx, sql`
    WITH service AS (
      SELECT salon_id,account,livemode,work_class,max(last_claimed_at) AS class_served
      FROM deposit_shadow_state GROUP BY salon_id,account,livemode,work_class
    ), tenant_service AS (
      SELECT salon_id,account,livemode,max(class_served) AS tenant_served
      FROM service GROUP BY salon_id,account,livemode
    ), ranked AS (
      SELECT s.deposit_id,s.next_due_at,t.tenant_served,row_number() OVER
        (PARTITION BY s.salon_id,s.account,s.livemode
          ORDER BY c.class_served NULLS FIRST,s.next_due_at,s.deposit_id) AS fair_rank
      FROM deposit_shadow_state s JOIN service c USING(salon_id,account,livemode,work_class)
        JOIN tenant_service t USING(salon_id,account,livemode)
      WHERE s.engine='legacy' AND s.next_due_at<=now()
        AND (s.lease_until IS NULL OR s.lease_until<=now())
    ), candidates AS (
      SELECT s.deposit_id FROM deposit_shadow_state s JOIN ranked r USING(deposit_id)
      WHERE s.engine='legacy' AND s.next_due_at<=now() AND (s.lease_until IS NULL OR s.lease_until<=now())
      ORDER BY r.fair_rank,r.tenant_served NULLS FIRST,r.next_due_at,s.deposit_id
      FOR UPDATE OF s SKIP LOCKED LIMIT ${Math.min(100, Math.max(1, limit))}
    ) UPDATE deposit_shadow_state s SET fence=fence+1,last_claimed_at=now(),
      lease_until=to_timestamp(${deadline / 1000}),next_due_at=to_timestamp(${deadline / 1000}),
      attempts=attempts+1
      FROM candidates c WHERE s.deposit_id=c.deposit_id
        AND s.engine='legacy' AND s.next_due_at<=now() AND (s.lease_until IS NULL OR s.lease_until<=now()) RETURNING s.*`);
    // Read legacy state without financial row locks; finalization checks it under
    // the common lock. A claim deadline failure rolls back service accounting too.
    for (const claim of claims) {
      const [d] = await rows<{ fingerprint: string }>(tx, sql`SELECT md5(to_jsonb(d)::text) AS fingerprint
      FROM appointment_deposit d WHERE salon_id=${claim.salon_id} AND id=${claim.deposit_id}`);
      claim.legacy_fingerprint = d?.fingerprint ?? null;
      if (claim.cursor?.legacyFingerprint !== claim.legacy_fingerprint || claim.cursor?.generation !== claim.generation) {
        claim.cursor = null;
      }
      claim.deadline = deadline;
    }
    return claims;
  }).catch((error: unknown) => {
    if (!retryableContention(error)) {
      throw error;
    }
    return [];
  });
}

export async function knownShadowRefundIds(claim: ShadowClaim): Promise<string[]> {
  const found = await rows<{ object_id: string }>(db, sql`SELECT object_id FROM deposit_shadow_object
    WHERE salon_id=${claim.salon_id} AND deposit_id=${claim.deposit_id} AND account=${claim.account}
      AND livemode=${claim.livemode} AND kind='refund'`);
  const [legacy] = await rows<{ stripe_refund_id: string | null; prior_refund_ids: string[] }>(db, sql`
    SELECT stripe_refund_id,prior_refund_ids FROM appointment_deposit
    WHERE salon_id=${claim.salon_id} AND id=${claim.deposit_id}`);
  const receipts = await rows<{ object_id: string }>(db, sql`SELECT projection->>'objectId' AS object_id
    FROM deposit_shadow_receipt WHERE salon_id=${claim.salon_id} AND deposit_id=${claim.deposit_id}
      AND account=${claim.account} AND livemode=${claim.livemode} AND projection->>'kind'='refund'
      AND projection->>'objectId' IS NOT NULL`);
  return [...new Set([...receipts.map(r => r.object_id), ...found.map(r => r.object_id), ...(legacy?.prior_refund_ids ?? []), ...(legacy?.stripe_refund_id ? [legacy.stripe_refund_id] : [])])];
}

export async function finalizeShadowObservation(
  claim: ShadowClaim,
  observation: Observation | null,
  failure: string | null = null,
): Promise<'accepted' | 'incomplete' | 'stale'> {
  return boundedShadowTransaction(claim.deadline, async (tx) => {
    await lockEvidenceAccount(tx, claim.account, claim.livemode);
    const d = await lockPayment(tx, claim.salon_id, claim.deposit_id);
    const [s] = await rows<ShadowClaim & { engine: string; lease_valid: boolean }>(tx, sql`
      SELECT *,lease_until>now() AS lease_valid FROM deposit_shadow_state
      WHERE deposit_id=${claim.deposit_id} AND salon_id=${claim.salon_id} FOR UPDATE`);
    // Binding writers do not take our advisory lock. SHARE blocks both their
    // updates and insert phantoms until this short finalization commits; row
    // locks alone cannot protect a historical-only account from reassignment.
    // No provider calls occur here. lock_timeout bounds binding DML contention.
    await tx.execute(sql`LOCK TABLE salon_stripe_account IN SHARE MODE`);
    const bindings = await rows<{ salon_id: string; livemode: boolean; revoked_at: Date | null; revocation_cause: string | null }>(tx, sql`
      SELECT salon_id,livemode,revoked_at,revocation_cause FROM salon_stripe_account
      WHERE stripe_account_id=${claim.account}`);
    // Match the original-account lifecycle rule across ALL history, including
    // rebound and deauthorization. A legitimate live reauthorization may recover
    // the same pair; a historical local unlink cannot mask deauthorization.
    const bindingValid = bindings.length > 0
      && bindings.every(b => b.salon_id === claim.salon_id && b.livemode === claim.livemode)
      && (bindings.some(b => b.revoked_at === null)
        || (!bindings.some(b => b.revocation_cause === 'deauthorized')
          && bindings.some(b => b.revocation_cause === 'revoked_local')));
    const valid = d && s && bindingValid && s.engine === 'legacy' && s.fence === claim.fence
      && s.generation === claim.generation && s.version === claim.version && s.lease_valid
      && Date.now() < claim.deadline && d.fingerprint === claim.legacy_fingerprint
      && d.stripe_account_id === claim.account && d.stripe_payment_intent_id === claim.payment_intent_id
      && s.account === claim.account && s.livemode === claim.livemode
      && s.payment_intent_id === claim.payment_intent_id && s.charge_id === claim.charge_id;
    if (!valid) {
      if (s && s.account === claim.account && s.livemode === claim.livemode) {
        await tx.execute(sql`INSERT INTO deposit_shadow_observation
          (id,salon_id,deposit_id,account,livemode,cycle_id,generation,version,fence,reason,evidence)
          VALUES (${crypto.randomUUID()},${claim.salon_id},${claim.deposit_id},${claim.account},${claim.livemode},
            ${observation?.cycleId ?? crypto.randomUUID()},${claim.generation},${claim.version},${claim.fence},
            'stale_observation',${json({ accepted: false, observation, failure })})`);
      }
      // Never clear a newer worker's lease/work. A same-fence invalidation stays explicitly dirty.
      await tx.execute(sql`UPDATE deposit_shadow_state SET certificate=NULL,reason='stale_observation',
        lease_until=NULL,next_due_at=now(),oldest_unresolved_at=COALESCE(oldest_unresolved_at,now())
        WHERE deposit_id=${claim.deposit_id} AND salon_id=${claim.salon_id} AND fence=${claim.fence}`);
      return 'stale';
    }
    // Receipt arrival may predate enrollment/charge discovery. Rebind it under this same
    // payment lock before a certificate can overlook it, regardless of its retry due time.
    if (observation && observation.account === claim.account && observation.livemode === claim.livemode
      && observation.collection.paymentIntentId === claim.payment_intent_id
      && (!claim.charge_id || observation.collection.id === claim.charge_id)) {
      const attached = await rows(tx, sql`UPDATE deposit_shadow_receipt SET salon_id=${claim.salon_id},
        deposit_id=${claim.deposit_id},generation=${claim.generation + 1},reason=projection->>'deficiency'
        WHERE generation IS NULL AND account=${claim.account} AND livemode=${claim.livemode}
          AND (projection->>'paymentIntentId'=${claim.payment_intent_id}
            OR projection->>'chargeId'=${observation.collection.id}) RETURNING event_id`);
      if (attached.length) {
        await tx.execute(sql`UPDATE deposit_shadow_state SET generation=generation+1,certificate=NULL,cursor=NULL,
          lease_until=NULL,next_due_at=now(),reason='receipt_dirty',oldest_unresolved_at=COALESCE(oldest_unresolved_at,now())
          WHERE salon_id=${claim.salon_id} AND deposit_id=${claim.deposit_id}`);
        return 'stale';
      }
    }
    const accountDeficiencies = await rows(tx, sql`SELECT event_id FROM deposit_shadow_receipt
      WHERE account=${claim.account} AND livemode=${claim.livemode} AND generation IS NULL
        AND completed_at IS NULL AND projection->>'paymentIntentId' IS NULL AND projection->>'chargeId' IS NULL LIMIT 1`);
    const known = await rows<{ object_id: string }>(tx, sql`SELECT object_id FROM deposit_shadow_object
      WHERE deposit_id=${claim.deposit_id} AND salon_id=${claim.salon_id} AND account=${claim.account}
        AND livemode=${claim.livemode} AND kind='refund'`);
    // Discovery of an ID-less historical return must survive future legacy
    // column changes or purge, even when explicit import was never invoked.
    // This is the same immutable, non-dispatchable legacy evidence record.
    if (!d.stripe_refund_id && (d.status === 'refunded' || d.refunded_at !== null)) {
      await retainLegacyShadowCommand(tx, d, claim.livemode);
    }
    const uncertain = await rows(tx, sql`SELECT id FROM deposit_shadow_command
      WHERE salon_id=${claim.salon_id} AND deposit_id=${claim.deposit_id}
        AND obligation_state<>'satisfied_by_verified_returns' LIMIT 1`);
    const receiptFacts = await rows<{ object_id: string; kind: string }>(tx, sql`
      SELECT projection->>'objectId' AS object_id,projection->>'kind' AS kind FROM deposit_shadow_receipt
      WHERE salon_id=${claim.salon_id} AND deposit_id=${claim.deposit_id}
        AND account=${claim.account} AND livemode=${claim.livemode} AND generation<=${claim.generation}
      UNION SELECT object_id,kind FROM deposit_shadow_object WHERE salon_id=${claim.salon_id}
        AND deposit_id=${claim.deposit_id} AND account=${claim.account} AND livemode=${claim.livemode}`);
    const missingEvidence = receiptFacts.some(r => r.kind === 'refund'
      ? !observation?.refunds.some(o => o.id === r.object_id)
      : r.kind === 'dispute'
        ? !observation?.disputes.some(o => o.id === r.object_id)
        : observation?.collection.id !== r.object_id);
    const deficient = await rows(tx, sql`SELECT event_id FROM deposit_shadow_receipt
      WHERE salon_id=${claim.salon_id} AND deposit_id=${claim.deposit_id} AND completed_at IS NULL
        AND generation<=${claim.generation} AND (reason IS NOT NULL
          OR (projection->>'chargeId' IS NOT NULL AND projection->>'chargeId'<>${observation?.collection.id ?? ''})
          OR (projection->>'paymentIntentId' IS NOT NULL AND projection->>'paymentIntentId'<>${claim.payment_intent_id})) LIMIT 1`);
    const assessment = observation && claim.payment_intent_id
      ? assessObservation({ observation, paymentIntentId: claim.payment_intent_id, chargeId: claim.charge_id, amount: d.amount_cents, currency: d.currency, knownRefundIds: [...new Set([...known.map(r => r.object_id), ...d.prior_refund_ids, ...(d.stripe_refund_id ? [d.stripe_refund_id] : [])])], unresolvedCommand: uncertain.length > 0 || d.refund_requested_at !== null || d.refund_status !== null })
      : { reason: failure ?? 'missing_payment_identity', succeeded: 0, reserved: 0, identityValid: false };
    const reason = failure ?? (observation && (observation.account !== claim.account || observation.livemode !== claim.livemode)
      ? 'provider_scope_conflict'
      : deficient.length
        ? 'receipt_deficient'
        : missingEvidence ? 'known_evidence_missing' : accountDeficiencies.length ? 'unattributed_account_evidence' : assessment.reason);
    const cycleId = observation?.cycleId ?? crypto.randomUUID();
    const version = s.version + 1;
    // Mandatory append-only evidence. Failure rolls back object, certificate, receipt and scheduling changes.
    await tx.execute(sql`INSERT INTO deposit_shadow_observation
      (id,salon_id,deposit_id,account,livemode,cycle_id,generation,version,fence,reason,evidence)
      VALUES (${crypto.randomUUID()},${claim.salon_id},${claim.deposit_id},${claim.account},${claim.livemode},
        ${cycleId},${claim.generation},${version},${claim.fence},${reason},
        ${json({ observation, failure, legacyFingerprint: d.fingerprint, legacyRefundEvidence: { depositStatus: d.status, refundedAt: d.refunded_at, refundStatus: d.refund_status, providerRefundId: d.stripe_refund_id } })})`);
    const identityConflict = !assessment.identityValid || reason === 'provider_scope_conflict';
    if (observation && !identityConflict) {
      const objects = [
        { id: observation.collection.id, kind: 'charge', facts: observation.collection },
        ...observation.refunds.map(facts => ({ id: facts.id, kind: 'refund', facts })),
        ...observation.disputes.map(facts => ({ id: facts.id, kind: 'dispute', facts })),
      ];
      for (const object of objects) {
        const written = await rows(tx, sql`INSERT INTO deposit_shadow_object
          (account,livemode,object_id,salon_id,deposit_id,kind,facts,version,cycle_id)
          VALUES (${claim.account},${claim.livemode},${object.id},${claim.salon_id},${claim.deposit_id},
            ${object.kind},${json(object.facts)},${version},${cycleId})
          ON CONFLICT(account,livemode,object_id) DO UPDATE SET facts=excluded.facts,
            version=excluded.version,cycle_id=excluded.cycle_id
          WHERE deposit_shadow_object.salon_id=excluded.salon_id
            AND deposit_shadow_object.deposit_id=excluded.deposit_id AND deposit_shadow_object.kind=excluded.kind
          RETURNING object_id`);
        if (!written.length) {
          throw new Error('shadow_object_scope_conflict');
        }
      }
    }
    const certificate = reason === null && observation
      ? { cycleId, version, generation: claim.generation, observedAt: new Date().toISOString(), succeeded: assessment.succeeded, reserved: assessment.reserved, original: observation.collection.amount, financialAuthority: false }
      : null;
    if (Date.now() >= claim.deadline) {
      throw new Error('observation_deadline');
    }
    await tx.execute(sql`UPDATE deposit_shadow_state SET version=${version},certificate=${json(certificate)},
      cursor=${json(identityConflict ? null : observation?.progress ?? null)},
      reason=${reason},charge_id=COALESCE(charge_id,${identityConflict ? null : observation?.collection.id ?? null}),
      legacy_fingerprint=${d.fingerprint},lease_until=NULL,last_checked_at=now(),
      last_complete_at=CASE WHEN ${reason === null} THEN now() ELSE last_complete_at END,
      oldest_unresolved_at=CASE WHEN ${reason === null} THEN NULL ELSE COALESCE(oldest_unresolved_at,now()) END,
      next_due_at=now()+CASE WHEN ${!!observation?.progress} THEN interval '1 second'
        WHEN ${reason === null} THEN interval '15 minutes'
        ELSE LEAST(interval '1 hour',interval '1 minute'*power(2,LEAST(attempts,6))) END
      WHERE deposit_id=${claim.deposit_id} AND salon_id=${claim.salon_id}`);
    // Incomplete transport must replay; authoritative unresolved evidence is durably covered but still scheduled.
    if (observation?.pagesComplete && observation.disputePagesComplete && !identityConflict && !deficient.length && !missingEvidence && !accountDeficiencies.length) {
      await tx.execute(sql`UPDATE deposit_shadow_receipt SET completed_at=now()
        WHERE salon_id=${claim.salon_id} AND deposit_id=${claim.deposit_id} AND generation<=${claim.generation}
          AND completed_at IS NULL`);
    }
    if (Date.now() >= claim.deadline) {
      throw new Error('observation_deadline');
    }
    return reason === null ? 'accepted' : 'incomplete';
  });
}

/** Private server diagnostic; no public route or provider access. Cursor never hides aggregate backlog. */
export async function shadowDiagnostics(salonId: string, after = '', limit = 50) {
  const [counts] = await rows(db, sql`SELECT count(*)::int AS total,
    count(*) FILTER(WHERE certificate IS NULL)::int AS incomplete,
    count(*) FILTER(WHERE next_due_at<=now())::int AS overdue,
    min(oldest_unresolved_at) AS oldest_unresolved_at,min(next_due_at) AS oldest_due_at,
    max(last_checked_at) AS last_checked_at,max(last_complete_at) AS last_complete_at
    FROM deposit_shadow_state WHERE salon_id=${salonId}`);
  // Original recorded principal is diagnostic context, never an outstanding/creditable balance.
  const principal = sql`SELECT s.*,
    COALESCE((o.facts->>'amount')::bigint,d.amount_cents::bigint) AS original_recorded_amount_cents,
    COALESCE(o.facts->>'currency',d.currency) AS recorded_currency,
    CASE WHEN o.object_id IS NOT NULL THEN 'accepted_collection'
      WHEN d.id IS NOT NULL THEN 'legacy_deposit' ELSE 'unknown' END AS amount_source
    FROM deposit_shadow_state s
    LEFT JOIN deposit_shadow_object o ON o.salon_id=s.salon_id AND o.deposit_id=s.deposit_id
      AND o.account=s.account AND o.livemode=s.livemode AND o.object_id=s.charge_id AND o.kind='charge'
    LEFT JOIN appointment_deposit d ON d.id=s.deposit_id AND d.salon_id=s.salon_id
      AND d.stripe_account_id=s.account AND d.stripe_payment_intent_id=s.payment_intent_id
    WHERE s.salon_id=${salonId}`;
  const items = await rows(db, sql`WITH principal AS (${principal}) SELECT deposit_id,reason,generation,version,next_due_at,
    oldest_unresolved_at,last_checked_at,last_complete_at,work_class,attempts,
    original_recorded_amount_cents,recorded_currency,amount_source,
    'implementation_reviewer' AS action_owner,'inspect_retained_evidence_no_financial_action' AS next_safe_step
    FROM principal WHERE deposit_id>${after} ORDER BY deposit_id LIMIT ${Math.min(200, Math.max(1, limit))}`);
  const principalByCurrency = await rows(db, sql`WITH principal AS (${principal})
    SELECT recorded_currency,count(*)::int AS deposits,
      count(*) FILTER(WHERE original_recorded_amount_cents IS NULL)::int AS unknown_amounts,
      sum(original_recorded_amount_cents)::text AS original_recorded_amount_cents
    FROM principal GROUP BY recorded_currency ORDER BY recorded_currency NULLS LAST`);
  const receiptScope = sql`r.salon_id=${salonId} OR (r.salon_id IS NULL
    AND EXISTS (SELECT 1 FROM salon_stripe_account b WHERE b.salon_id=${salonId}
      AND b.stripe_account_id=r.account AND b.livemode=r.livemode)
    AND NOT EXISTS (SELECT 1 FROM salon_stripe_account b WHERE b.stripe_account_id=r.account
      AND (b.salon_id<>${salonId} OR b.livemode<>r.livemode)))`;
  const [receiptCounts] = await rows(db, sql`SELECT count(*)::int AS total,
    count(*) FILTER(WHERE completed_at IS NULL)::int AS pending,min(received_at) FILTER(WHERE completed_at IS NULL) AS oldest_pending_at
    FROM deposit_shadow_receipt r WHERE ${receiptScope}`);
  const receipts = await rows(db, sql`SELECT event_id,event_type,reason,received_at,next_due_at,completed_at,
      projection->>'amount' AS reported_amount_cents,projection->>'currency' AS reported_currency,
      'signed_receipt_unverified_principal' AS amount_source,
      'implementation_reviewer' AS action_owner,'inspect_retained_evidence_no_financial_action' AS next_safe_step
    FROM deposit_shadow_receipt r WHERE r.event_id>${after} AND (${receiptScope})
    ORDER BY event_id LIMIT ${Math.min(200, Math.max(1, limit))}`);
  return { counts, items, principalByCurrency, receiptCounts, receipts };
}

/** Unattributed evidence for a future guarded super-admin diagnostic caller; never public. */
export async function shadowUnattributedDiagnostics(after = '', limit = 50) {
  const [counts] = await rows(db, sql`SELECT count(*)::int AS total,min(received_at) AS oldest_received_at,
    count(*) FILTER(WHERE next_due_at<=now())::int AS overdue FROM deposit_shadow_receipt WHERE generation IS NULL`);
  const items = await rows(db, sql`SELECT event_id,event_type,account,livemode,received_at,reason,next_due_at,
      projection->>'amount' AS reported_amount_cents,projection->>'currency' AS reported_currency,
      'signed_receipt_unverified_principal' AS amount_source,
      'implementation_reviewer' AS action_owner,'inspect_retained_evidence_no_financial_action' AS next_safe_step
    FROM deposit_shadow_receipt WHERE generation IS NULL AND event_id>${after}
    ORDER BY event_id LIMIT ${Math.min(200, Math.max(1, limit))}`);
  return { counts, items };
}
