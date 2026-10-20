import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, isNull, or, sql } from 'drizzle-orm';

import { retailAiCredits } from '@/features/ai-credits/catalog';
import { aiCreditMeteringEnabled, aiCreditsEnabled } from '@/features/ai-credits/config.server';
import { assertAiCreditExecution, currentAiCreditExecution } from '@/features/ai-credits/context.server';
import { measuredAiCost } from '@/features/ai-credits/pricing';
import { reserveAiCreditCall } from '@/features/ai-credits/request-metering.server';
import { AiCreditError } from '@/features/ai-credits/wallet.server';
import { createOpenAiResponsesProvider } from '@/libs/ai/openaiResponses.server';
import type { ModelProviderRequest, ModelProviderResponse, ModelProviderUsage, OwnerAssistantModelProvider } from '@/libs/ai/provider';
import { ModelProviderError } from '@/libs/ai/provider';
import { db } from '@/libs/DB';
import { resolveRuntimeEnvironment } from '@/libs/environmentIsolation';
import { aiCreditPurchaseSchema as purchases, setupAiBudgetSchema as budgets, setupAiCallSchema as calls } from '@/models/Schema';

import { setupAiExpensePolicy, setupAiProviderConfigured } from './ai-budget.server';
import type { SetupModel } from './ai-models';
import { isSetupModel, SETUP_AI_MODEL, SETUP_MODEL_RATES } from './ai-models';
import { SetupError } from './contracts';
import { loadSetupHead, lockSetupSalon, type SetupActor, setupHash, type SetupTransaction } from './drafts.server';

export { SETUP_AI_MODEL } from './ai-models';

// Deliberately conservative accounting allowance, NOT a claimed FX rate.
// USD 20 of provider usage consumes CAD 40, leaving room for FX/tax/fees.
export const TRIAL_CAD_PER_USD = 2;

export function setupAiConfigured() {
  try {
    if (resolveRuntimeEnvironment(process.env) === 'production') {
      return setupAiProviderConfigured() && aiCreditMeteringEnabled();
    }
  } catch {
    return false;
  }
  return setupAiProviderConfigured();
}

async function expenseUsed(tx: SetupTransaction | typeof db, policy: NonNullable<ReturnType<typeof setupAiExpensePolicy>>, salonId?: string) {
  // Paid-credit funding and older production calls have no fixed-budget ID.
  // Include their measured/unknown costs; switching policy never erases spend.
  const condition = policy.production ? or(eq(calls.budgetId, policy.id), isNull(calls.budgetId)) : eq(calls.budgetId, policy.id);
  const [row] = await tx.select({ amount: sql<string>`coalesce(sum(${calls.chargedMicroCad}), 0)` }).from(calls).where(salonId ? and(condition, eq(calls.salonId, salonId)) : condition);
  const used = Number(row?.amount ?? 0);
  if (!Number.isSafeInteger(used) || used < 0) {
    throw new SetupError('NOT_READY', 'AI is temporarily unavailable. Your saved draft and credits are safe.');
  }
  return used;
}

/** Caller holds the salon/account locks shared with verified payment refunds. */
async function assertPaidFunding(tx: SetupTransaction, actor: SetupActor, policy: NonNullable<ReturnType<typeof setupAiExpensePolicy>>, requiredMicroCad: number) {
  const [paid] = await tx.select({
    amount: sql<string>`coalesce(sum(case when ${purchases.disputed} then 0 else greatest(${purchases.creditMicroCad} - ${purchases.reversedMicroCad}, 0) end), 0)`,
  }).from(purchases).where(and(eq(purchases.salonId, actor.salonId), eq(purchases.planEnv, 'prod'), eq(purchases.status, 'paid'), sql`${purchases.stripePaymentIntentId} IS NOT NULL`));
  const netPaid = Number(paid?.amount ?? 0);
  if (!Number.isSafeInteger(netPaid) || netPaid < 0
    || await expenseUsed(tx, policy, actor.salonId) + requiredMicroCad > Math.floor(netPaid / 2)) {
    throw new SetupError('NOT_READY', 'AI is temporarily paused for your business. Your saved draft and credits are safe. Please contact support.');
  }
}

/** Read-only purchase readiness; generation separately locks and reserves. */
export async function setupAiExpenseAvailable(production: boolean) {
  const policy = setupAiExpensePolicy(production);
  if (!policy) {
    return false;
  }
  // The first verified purchase funds this mode. Requiring an existing balance
  // here would prevent the first customer from buying credits at all.
  if (policy.funding === 'paid_credits') {
    return true;
  }
  const [budget] = await db.select().from(budgets).where(eq(budgets.id, policy.id));
  return await expenseUsed(db, policy) < Math.min(budget?.capMicroCad ?? policy.capMicroCad, policy.capMicroCad);
}

export function estimateSetupAiCost(usage: ModelProviderUsage | null, model: SetupModel = SETUP_AI_MODEL) {
  return measuredAiCost(usage, SETUP_MODEL_RATES[model]);
}

export async function runSetupModel(actor: SetupActor, input: {
  operationId: string;
  ordinal: number;
  expectedRevision: number;
  request: ModelProviderRequest;
  deadlineAt?: number;
}, override?: OwnerAssistantModelProvider): Promise<{ result: ModelProviderResponse; callId: string }> {
  const creditContext = currentAiCreditExecution();
  if (aiCreditsEnabled() && !creditContext) {
    throw new AiCreditError('INVALID', 'This AI request needs an approved credit limit.');
  }
  if (!override && !setupAiConfigured()) {
    throw new SetupError('NOT_READY', 'AI is not connected yet. Your draft is saved, and you can keep editing.');
  }
  if (!isSetupModel(input.request.model)) {
    throw new SetupError('INVALID', 'This model is not enabled for the website builder.');
  }
  const model = input.request.model;
  const rates = creditContext?.pricing.rates[model] ?? SETUP_MODEL_RATES[model];
  const request: ModelProviderRequest = { ...input.request, model, serviceTier: 'default' };
  if (request.tools.length || request.maxOutputTokens > 14000 || request.maxOutputTokens < 1) {
    throw new SetupError('INVALID', 'This AI request exceeds the supported trial limits.');
  }
  // Verify tenant permission before transmitting even a token-count request.
  await db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, actor.salonId);
    if (head.workspace.status !== 'editing' || head.revision.revision !== input.expectedRevision) {
      throw new SetupError('STALE', 'Your saved changes were updated elsewhere. Reload before continuing.');
    }
    await assertAiCreditExecution(tx, actor);
  });
  const provider = override ?? createOpenAiResponsesProvider({ apiKey: process.env.OPENAI_API_KEY_CUSTOM_SITES! });
  if (input.deadlineAt !== undefined && input.deadlineAt - Date.now() < 30000) {
    throw new SetupError('NOT_READY', 'There was not enough time to finish this design safely. Your saved design is unchanged. Please try again.');
  }
  const counted = provider.countInputTokens ? await provider.countInputTokens(request) : override ? 10000 : null;
  if (counted === null || !Number.isSafeInteger(counted) || counted < 0 || counted > 150000) {
    throw new SetupError('NOT_READY', 'These references could not be measured safely. Try fewer pages or images.');
  }
  // Token counting can itself take twenty seconds. Bound the paid call only
  // after counting, leaving time to record usage and save a validated result.
  if (input.deadlineAt !== undefined) {
    request.timeoutMs = Math.min(request.timeoutMs, input.deadlineAt - Date.now() - 5000);
    if (request.timeoutMs < 30000) {
      throw new SetupError('NOT_READY', 'There was not enough time to finish this design safely. Your saved design is unchanged. Please try again.');
    }
  }
  const reserved = Math.ceil((counted * rates.cacheWrite + request.maxOutputTokens * rates.output) * 1.1);
  const requestHash = setupHash(request);
  const policy = setupAiExpensePolicy(creditContext?.planEnv === 'prod', Boolean(override));
  if (!policy) {
    throw new SetupError('NOT_READY', 'AI is temporarily unavailable. Your saved draft and credits are safe.');
  }
  const expenseCharge = (microUsd: number) => policy.funding === 'paid_credits' && creditContext
    ? Math.ceil(retailAiCredits(microUsd, creditContext.pricing.usdToCadMillionths) / 2)
    : microUsd * TRIAL_CAD_PER_USD;
  const call = await db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, actor.salonId);
    if (head.workspace.status !== 'editing' || head.revision.revision !== input.expectedRevision) {
      throw new SetupError('STALE', 'Your saved changes were updated while AI prepared this request. Reload before continuing.');
    }
    const credits = await reserveAiCreditCall(tx, actor, reserved);
    const [prior] = await tx.select().from(calls).where(and(eq(calls.operationId, input.operationId), eq(calls.ordinal, input.ordinal)));
    if (prior) {
      // Never replay a paid call after an ambiguous network/process failure.
      throw new SetupError('NOT_READY', 'This AI request was already sent. Reload the saved result before trying again.');
    }
    // Production can be funded by each salon's verified net purchases. Its
    // existing salon lock serializes admissions and refunds without pooling
    // another business's money or resetting historical/unknown expense.
    let budgetId: string | null = null;
    if (policy.funding === 'paid_credits') {
      await assertPaidFunding(tx, actor, policy, expenseCharge(reserved));
    } else {
      // Preserve the original fixed trial/optional fixed production ceilings.
      budgetId = policy.id;
      await tx.insert(budgets).values({ id: budgetId, capMicroCad: policy.capMicroCad }).onConflictDoNothing();
      const [budget] = await tx.select().from(budgets).where(eq(budgets.id, budgetId)).for('update');
      if (await expenseUsed(tx, policy) + expenseCharge(reserved) > Math.min(budget!.capMicroCad, policy.capMicroCad)) {
        throw new SetupError('NOT_READY', policy.production
          ? 'AI is temporarily unavailable. Your saved draft and credits are safe. Please try again later.'
          : 'This request would exceed the approved AI trial budget. Your saved draft is unchanged.');
      }
    }
    const [row] = await tx.insert(calls).values({ id: randomUUID(), budgetId, ...credits, salonId: actor.salonId, actorId: actor.adminId, operationId: input.operationId, ordinal: input.ordinal, model, provider: override ? 'test-double' : 'openai', requestHash, reservedMicroUsd: reserved, chargedMicroCad: expenseCharge(reserved), status: 'pending' }).returning();
    return row!;
  });
  const started = Date.now();
  try {
    const result = await provider.createResponse(request);
    const costMicroUsd = measuredAiCost(result.usage, rates);
    const creditCostMicroCad = creditContext && costMicroUsd !== null ? retailAiCredits(costMicroUsd, creditContext.pricing.usdToCadMillionths) : null;
    const rawOutput = result.partialText ?? result.items.filter(i => i.type === 'message').map(i => i.type === 'message' ? i.text : '').join('');
    // Raw output stays private in the DB, never in diagnostic logs or a frame.
    // Even invalid first output is retained for honest trial evaluation.
    await db.update(calls).set({ status: result.status, rawOutput: rawOutput.slice(0, 200000), elapsedMs: Date.now() - started, inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens, costMicroUsd, creditCostMicroCad, chargedMicroCad: expenseCharge(costMicroUsd ?? reserved) }).where(eq(calls.id, call.id));
    return { result, callId: call.id };
  } catch (error) {
    const costMicroUsd = error instanceof ModelProviderError ? measuredAiCost(error.usage, rates) : null;
    const creditCostMicroCad = creditContext && costMicroUsd !== null ? retailAiCredits(costMicroUsd, creditContext.pricing.usdToCadMillionths) : null;
    await db.update(calls).set({ status: 'failed', elapsedMs: Date.now() - started, costMicroUsd, creditCostMicroCad, chargedMicroCad: expenseCharge(costMicroUsd ?? reserved) }).where(eq(calls.id, call.id));
    throw error;
  }
}
