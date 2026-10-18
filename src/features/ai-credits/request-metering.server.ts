import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { SETUP_MODEL_RATES } from '@/features/business-setup/ai-models';
import { SetupError } from '@/features/business-setup/contracts';
import { loadSetupHead, lockSetupSalon, type SetupActor, setupHash, type SetupTransaction } from '@/features/business-setup/drafts.server';
import { db } from '@/libs/DB';
import { checkEndpointRateLimit } from '@/libs/rateLimit';
import { aiCreditLedgerSchema as ledger, aiCreditReservationSchema as reservations, businessSetupRevisionSchema as revisions, businessSetupTurnSchema as turns, customSiteGenerationSchema as designs, setupAiCallSchema as calls } from '@/models/Schema';

import { AI_REQUEST_CREDIT_LIMIT, type AiCreditPlanEnv, retailAiCredits } from './catalog';
import { aiCreditMeteringEnabled, aiCreditPlanEnv, aiCreditPricingPolicy, aiCreditsEnabled } from './config.server';
import { type AiCreditExecution, assertAiCreditExecution, currentAiCreditExecution, withAiCreditExecution } from './context.server';
import type { AiCreditRequestKind } from './pricing';
import { AiCreditError, lockAiCreditAccount, readAiCreditBalance } from './wallet.server';

type Hold = typeof reservations.$inferSelect;
type RequestIdentity = { operationId: string; expectedRevision: number };
const EXECUTION_LEASE_MS = 6 * 60_000;

async function appliedDesignReceipt(tx: SetupTransaction, hold: Hold, operationId: string, workspaceId?: string) {
  const [design] = await tx.select({ status: designs.status, artifactId: designs.artifactId }).from(designs).where(and(eq(designs.id, operationId), eq(designs.salonId, hold.salonId), eq(designs.actorId, hold.actorId)));
  if (design?.status === 'completed') {
    return true;
  }
  if (!design?.artifactId) {
    return false;
  }
  const [saved] = await tx.select({ artifactId: sql<string | null>`${revisions.document} #>> '{website,config,customFrontendId}'` }).from(revisions).where(and(eq(revisions.operationId, operationId), eq(revisions.salonId, hold.salonId), eq(revisions.actorId, hold.actorId), eq(revisions.origin, 'assistant'), workspaceId ? eq(revisions.workspaceId, workspaceId) : undefined)).limit(1);
  if (saved?.artifactId !== design.artifactId) {
    return false;
  }
  await tx.update(designs).set({ status: 'completed', phase: 'completed' }).where(and(eq(designs.id, operationId), eq(designs.salonId, hold.salonId), eq(designs.actorId, hold.actorId)));
  return true;
}

async function domainCompleted(tx: SetupTransaction, hold: Hold) {
  const [turn] = await tx.select({ status: turns.status, workspaceId: turns.workspaceId, designOperationId: turns.designOperationId, designRequest: turns.designRequest }).from(turns).where(and(eq(turns.id, hold.operationId), eq(turns.salonId, hold.salonId), eq(turns.actorId, hold.actorId)));
  if (turn && (turn.status === 'completed' || (hold.requestKind === 'extract' && ['upload_review', 'upload_applied', 'upload_dismissed'].includes(turn.status)))) {
    return true;
  }
  // The custom-design entry also routes narrow price edits through a saved
  // conversation. A direct source generation has no conversation record.
  if (hold.requestKind === 'design' && !turn) {
    return appliedDesignReceipt(tx, hold, hold.operationId);
  }
  if ((hold.requestKind !== 'conversation' && hold.requestKind !== 'design') || !turn || (turn.designRequest && !turn.designOperationId)) {
    return false;
  }
  const [saved] = turn.designOperationId ? [] : await tx.select({ revision: revisions.revision }).from(revisions).where(and(eq(revisions.operationId, hold.operationId), eq(revisions.salonId, hold.salonId), eq(revisions.workspaceId, turn.workspaceId), eq(revisions.actorId, hold.actorId), eq(revisions.origin, 'assistant'))).limit(1);
  const completed = turn.designOperationId ? await appliedDesignReceipt(tx, hold, turn.designOperationId, turn.workspaceId) : Boolean(saved);
  if (completed) {
    // The domain commit is durable even if its later status write/response was
    // interrupted. Partial business intake before an unfinished design does
    // not count: only that design's exact applied artifact is a final receipt.
    await tx.update(turns).set({ status: 'completed', reply: 'Your changes are saved in the draft. Review them before publishing.' }).where(and(eq(turns.id, hold.operationId), eq(turns.salonId, hold.salonId), eq(turns.actorId, hold.actorId)));
  }
  return completed;
}

async function stopUnfinishedExecution(tx: SetupTransaction, hold: Hold) {
  const [turn] = await tx.select({ designOperationId: turns.designOperationId }).from(turns).where(and(eq(turns.id, hold.operationId), eq(turns.salonId, hold.salonId), eq(turns.actorId, hold.actorId)));
  await tx.update(turns).set({ status: 'failed', reply: 'This attempt stopped. Any AI credits set aside for it are available again. Your saved changes are safe.' }).where(and(eq(turns.id, hold.operationId), eq(turns.salonId, hold.salonId), eq(turns.actorId, hold.actorId), inArray(turns.status, ['pending', 'generated'])));
  const designIds = [...new Set([hold.operationId, turn?.designOperationId].filter((id): id is string => Boolean(id)))];
  await tx.update(designs).set({ status: 'failed', phase: 'failed' }).where(and(inArray(designs.id, designIds), eq(designs.salonId, hold.salonId), eq(designs.actorId, hold.actorId), inArray(designs.status, ['pending', 'generated'])));
  // This marks abandoned work, NOT a provider refund. Retain the entire
  // conservative expense when usage is unknown. A late provider response may
  // still record actual usage, but the revoked execution cannot edit a draft.
  await tx.update(calls).set({ status: 'failed', validation: 'interrupted_unknown_usage' }).where(and(eq(calls.creditReservationId, hold.id), eq(calls.salonId, hold.salonId), eq(calls.actorId, hold.actorId), eq(calls.status, 'pending')));
}

async function resolveHold(tx: SetupTransaction, hold: Hold, completed: boolean) {
  if (hold.status !== 'held') {
    if (hold.status === 'released' && hold.resolution === 'platform_failure') {
      await stopUnfinishedExecution(tx, hold);
    }
    return hold;
  }
  const evidence = await tx.select({ status: calls.status, cost: calls.creditCostMicroCad }).from(calls).where(and(eq(calls.creditReservationId, hold.id), eq(calls.salonId, hold.salonId), eq(calls.actorId, hold.actorId)));
  const measured = evidence.every(call => call.status !== 'pending' && call.cost !== null);
  const total = measured ? evidence.reduce((sum, call) => sum + call.cost!, 0) : 0;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new AiCreditError('INVALID', 'AI usage could not be resolved safely. Your credits are held for review.');
  }
  // Missing provider usage is an operator expense, never an invented customer
  // charge. A provider overrun also cannot increase the accepted owner limit.
  const actual = completed && measured ? Math.min(total, hold.reservedMicroCad) : 0;
  if (actual) {
    await tx.insert(ledger).values({ id: randomUUID(), salonId: hold.salonId, planEnv: hold.planEnv, entryKey: `usage:${hold.id}`, kind: 'usage', amountMicroCad: -actual, operationId: hold.operationId });
  }
  const [resolved] = await tx.update(reservations).set({ status: completed ? 'settled' : 'released', settledMicroCad: actual, resolvedAt: new Date(), resolution: !completed ? 'platform_failure' : !measured ? 'unknown_usage' : total > hold.reservedMicroCad ? 'capped_usage' : 'completed' }).where(eq(reservations.id, hold.id)).returning();
  if (!completed) {
    // Revoke the execution before marking the old attempt failed. A late
    // worker may record expense evidence but cannot apply another draft edit.
    await stopUnfinishedExecution(tx, hold);
  }
  return resolved!;
}

/**
 * Financial finalization is bound to a server-created execution token. It can
 * refund an admitted failed operation even if its owner's membership changed.
 */
async function finalizeExecution(context: AiCreditExecution) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM salon WHERE id = ${context.salonId} FOR UPDATE`);
    await lockAiCreditAccount(tx, context.salonId, context.planEnv);
    const [hold] = await tx.select().from(reservations).where(and(eq(reservations.id, context.reservationId), eq(reservations.salonId, context.salonId), eq(reservations.planEnv, context.planEnv))).for('update');
    if (!hold || hold.actorId !== context.adminId || hold.executionToken !== context.token) {
      throw new AiCreditError('NOT_FOUND', 'This AI request is unavailable.');
    }
    return resolveHold(tx, hold, await domainCompleted(tx, hold));
  });
}

/** Safe receipt recovery; never replays a provider call or starts more work. */
export async function reconcileAiCreditRequests(actor: SetupActor, planEnv: AiCreditPlanEnv) {
  return db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    await lockAiCreditAccount(tx, actor.salonId, planEnv);
    const held = await tx.select().from(reservations).where(and(eq(reservations.salonId, actor.salonId), eq(reservations.planEnv, planEnv), eq(reservations.status, 'held'), sql`${reservations.requestKind} IS NOT NULL`)).limit(10).for('update');
    for (const hold of held) {
      const completed = await domainCompleted(tx, hold);
      if (completed || (hold.leaseExpiresAt && hold.leaseExpiresAt.getTime() <= Date.now())) {
        await resolveHold(tx, hold, completed);
      }
    }
    // Converge older interrupted records through normal owner receipt reads.
    // Only pending calls attached to this salon's refunded platform failure are
    // eligible; budget amounts, completed results and other salons are untouched.
    const older = await tx.select().from(reservations).where(and(eq(reservations.salonId, actor.salonId), eq(reservations.planEnv, planEnv), eq(reservations.status, 'released'), eq(reservations.resolution, 'platform_failure'), sql`EXISTS (SELECT 1 FROM ${calls} WHERE ${calls.creditReservationId} = ${reservations.id} AND ${calls.salonId} = ${reservations.salonId} AND ${calls.actorId} = ${reservations.actorId} AND ${calls.status} = 'pending')`)).limit(10).for('update');
    for (const hold of older) {
      await resolveHold(tx, hold, false);
    }
  });
}

async function beginRequest(actor: SetupActor, kind: AiCreditRequestKind, input: RequestIdentity, acceptedLimit: number | undefined) {
  if (!aiCreditMeteringEnabled()) {
    throw new AiCreditError('NOT_CONFIGURED', 'AI credit usage is not available yet. Your saved website and balance are safe.');
  }
  if (acceptedLimit !== AI_REQUEST_CREDIT_LIMIT) {
    throw new AiCreditError('INVALID', 'Review the AI credit limit before sending this request.');
  }
  const planEnv = aiCreditPlanEnv();
  await reconcileAiCreditRequests(actor, planEnv);
  const hash = setupHash({ kind, input });
  const outcome = await db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    await lockAiCreditAccount(tx, actor.salonId, planEnv);
    const head = await loadSetupHead(tx, actor.salonId);
    if (input.expectedRevision < (head.revision.document.sessionStartRevision ?? 1)) {
      throw new SetupError('STALE', 'You started over since this request. Send it in your new conversation instead.');
    }
    const [prior] = await tx.select().from(reservations).where(and(eq(reservations.salonId, actor.salonId), eq(reservations.planEnv, planEnv), eq(reservations.operationId, input.operationId))).for('update');
    if (prior) {
      if (prior.actorId !== actor.adminId || prior.requestHash !== hash || prior.requestKind !== kind || prior.acceptedLimitMicroCad !== acceptedLimit) {
        throw new AiCreditError('INVALID', 'This request was already used for another AI change.');
      }
      if (prior.status === 'settled' && await domainCompleted(tx, prior)) {
        return { replay: true as const, hold: prior };
      }
      if (prior.status === 'released') {
        throw new AiCreditError('STALE', 'That attempt stopped and its unused credits are available again. Send a new message to retry.');
      }
      throw new SetupError('NOT_READY', 'Your earlier request is still working. Its result will appear here when it is ready.');
    }
    if (head.workspace.status !== 'editing' || head.revision.revision !== input.expectedRevision) {
      throw new SetupError('STALE', 'Your saved details changed. Reload them before sending this request.');
    }
    if (!checkEndpointRateLimit('ai-setup', `${actor.salonId}:${actor.adminId}`, 'GENERAL').allowed) {
      throw new SetupError('NOT_READY', 'You’ve sent several requests quickly. Wait a minute, then try again. Your saved work is safe.');
    }
    if (planEnv === 'prod') {
      // Refunded/unknown provider work still costs the operator. Bound repeated
      // failures without charging customers for unavailable or broken results.
      const failures = await tx.execute(sql`SELECT COUNT(*) AS count FROM ai_credit_reservation r
        WHERE r.salon_id = ${actor.salonId} AND r.plan_env = ${planEnv}
          AND r.resolved_at > ${new Date(Date.now() - 86400_000)}
          AND r.resolution IN ('platform_failure','unknown_usage','capped_usage')
          AND EXISTS (SELECT 1 FROM setup_ai_call c WHERE c.credit_reservation_id = r.id AND c.salon_id = r.salon_id)`);
      if (Number(failures.rows[0]?.count ?? 0) >= 10) {
        throw new SetupError('NOT_READY', 'AI has had trouble finishing several requests. Please try again later. Your credits and saved website are safe.');
      }
    }
    const balance = await readAiCreditBalance(tx, actor.salonId, planEnv);
    if (balance.availableMicroCad <= 0) {
      throw new AiCreditError('INSUFFICIENT_CREDITS', 'Add AI credits to continue. Your saved website and bookings are safe.');
    }
    const pricing = { ...aiCreditPricingPolicy(), rates: structuredClone(SETUP_MODEL_RATES) };
    const [hold] = await tx.insert(reservations).values({ id: randomUUID(), salonId: actor.salonId, planEnv, actorId: actor.adminId, operationId: input.operationId, requestHash: hash, reservedMicroCad: Math.min(balance.availableMicroCad, acceptedLimit), status: 'held', requestKind: kind, expectedRevision: input.expectedRevision, acceptedLimitMicroCad: acceptedLimit, pricing, executionToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + EXECUTION_LEASE_MS) }).returning();
    return { replay: false as const, hold: hold! };
  });
  return outcome;
}

export async function runWithAiCredits<T>(actor: SetupActor, kind: AiCreditRequestKind, input: RequestIdentity, acceptedLimit: number | undefined, work: () => Promise<T>): Promise<T> {
  if (!aiCreditsEnabled()) {
    return work(); // Existing bounded non-production trial, never a paid bypass.
  }
  const admitted = await beginRequest(actor, kind, input, acceptedLimit);
  if (admitted.replay) {
    return work(); // Domain handlers return their durable saved receipt.
  }
  const hold = admitted.hold;
  const context: AiCreditExecution = { reservationId: hold.id, operationId: hold.operationId, salonId: actor.salonId, adminId: actor.adminId, planEnv: hold.planEnv, token: hold.executionToken!, pricing: hold.pricing! };
  let result: T;
  try {
    result = await withAiCreditExecution(context, work);
  } catch (cause) {
    const resolved = await finalizeExecution(context);
    if (resolved.status === 'settled') {
      return work(); // Verified durable receipt; domain replay cannot call AI again.
    }
    throw cause;
  }
  // Deliberately outside the catch: a post-save financial write failure must
  // keep its hold for receipt recovery, not refund successful saved work.
  const resolved = await finalizeExecution(context);
  if (resolved.status !== 'settled') {
    throw new SetupError('NOT_READY', 'That request did not finish saving. Your unused AI credits are available again.');
  }
  return result;
}

/** Called before inserting the provider call, in the same admission transaction. */
export async function reserveAiCreditCall(tx: SetupTransaction, actor: SetupActor, reservedMicroUsd: number) {
  const context = currentAiCreditExecution();
  if (!context) {
    if (aiCreditsEnabled()) {
      throw new AiCreditError('INVALID', 'This AI request needs an approved credit limit.');
    }
    return { creditReservationId: null, creditReservedMicroCad: 0 };
  }
  if (!aiCreditMeteringEnabled()) {
    throw new AiCreditError('NOT_CONFIGURED', 'AI credit usage is temporarily unavailable.');
  }
  await lockAiCreditAccount(tx, actor.salonId, context.planEnv);
  const hold = (await assertAiCreditExecution(tx, actor))!;
  const evidence = await tx.select({ reserved: calls.creditReservedMicroCad, actual: calls.creditCostMicroCad }).from(calls).where(and(eq(calls.creditReservationId, hold.id), eq(calls.salonId, actor.salonId)));
  const used = evidence.reduce((sum, call) => sum + (call.actual ?? call.reserved), 0);
  const maximum = retailAiCredits(reservedMicroUsd, context.pricing.usdToCadMillionths);
  if (!Number.isSafeInteger(used) || used + maximum > hold.reservedMicroCad) {
    throw new SetupError('NOT_READY', hold.reservedMicroCad < AI_REQUEST_CREDIT_LIMIT
      ? 'Your remaining AI credits could not cover this request safely. Add credits or try a smaller change. Your saved draft is safe.'
      : 'This request needs fewer images or a smaller change to stay within your AI credit limit. Your saved draft is safe.');
  }
  return { creditReservationId: hold.id, creditReservedMicroCad: maximum };
}
