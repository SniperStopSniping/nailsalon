import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { createOpenAiResponsesProvider } from '@/libs/ai/openaiResponses.server';
import type { ModelProviderRequest, ModelProviderResponse, ModelProviderUsage, OwnerAssistantModelProvider } from '@/libs/ai/provider';
import { ModelProviderError } from '@/libs/ai/provider';
import { db } from '@/libs/DB';
import { setupAiBudgetSchema as budgets, setupAiCallSchema as calls } from '@/models/Schema';

import type { SetupModel } from './ai-models';
import { APPROVED_TRIAL_CAP_CAD, isSetupModel, SETUP_AI_MODEL, SETUP_MODEL_RATES } from './ai-models';
import { SetupError } from './contracts';
import type { SetupActor } from './drafts.server';
import { loadSetupHead, lockSetupSalon, setupHash } from './drafts.server';

export { SETUP_AI_MODEL } from './ai-models';

// Approved initial trial, not a per-salon allowance. Changing an environment
// variable cannot start a fresh ledger or raise the approved CAD ceiling.
const BUDGET_ID = 'initial-custom-website-trial';
// Deliberately conservative accounting allowance, NOT a claimed FX rate.
// USD 20 of provider usage consumes CAD 40, leaving room for FX/tax/fees.
export const TRIAL_CAD_PER_USD = 2;

export function setupAiConfigured() {
  const cap = Number(process.env.CUSTOM_SITE_TRIAL_BUDGET_CAD ?? 0);
  return Boolean(process.env.OPENAI_API_KEY_CUSTOM_SITES) && Number.isFinite(cap) && cap > 0 && cap <= APPROVED_TRIAL_CAP_CAD;
}

export function estimateSetupAiCost(usage: ModelProviderUsage | null, model: SetupModel = SETUP_AI_MODEL) {
  if (!usage) {
    return null;
  }
  const rates = SETUP_MODEL_RATES[model];
  return Math.ceil((usage.inputTokens - usage.cachedInputTokens - (usage.cacheWriteInputTokens ?? 0)) * rates.input
    + usage.cachedInputTokens * rates.cached + (usage.cacheWriteInputTokens ?? 0) * rates.cacheWrite + usage.outputTokens * rates.output);
}

export async function runSetupModel(actor: SetupActor, input: {
  operationId: string;
  ordinal: number;
  expectedRevision: number;
  request: ModelProviderRequest;
  deadlineAt?: number;
}, override?: OwnerAssistantModelProvider): Promise<{ result: ModelProviderResponse; callId: string }> {
  if (!override && !setupAiConfigured()) {
    throw new SetupError('NOT_READY', 'AI is not connected yet. Your draft is saved, and you can keep editing.');
  }
  if (!isSetupModel(input.request.model)) {
    throw new SetupError('INVALID', 'This model is not enabled for the website builder.');
  }
  const model = input.request.model;
  const rates = SETUP_MODEL_RATES[model];
  const request = { ...input.request, model };
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
  const cap = override ? APPROVED_TRIAL_CAP_CAD : Number(process.env.CUSTOM_SITE_TRIAL_BUDGET_CAD);
  const call = await db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, actor.salonId);
    if (head.workspace.status !== 'editing' || head.revision.revision !== input.expectedRevision) {
      throw new SetupError('STALE', 'Your saved changes were updated while AI prepared this request. Reload before continuing.');
    }
    await tx.insert(budgets).values({ id: BUDGET_ID, capMicroCad: Math.floor(cap * 1000000) }).onConflictDoNothing();
    // Serializes reservations across ALL salons and all concurrent requests.
    const [budget] = await tx.select().from(budgets).where(eq(budgets.id, BUDGET_ID)).for('update');
    const [prior] = await tx.select().from(calls).where(and(eq(calls.operationId, input.operationId), eq(calls.ordinal, input.ordinal)));
    if (prior) {
      // Never replay a paid call after an ambiguous network/process failure.
      throw new SetupError('NOT_READY', 'This AI request was already sent. Reload the saved result before trying again.');
    }
    const history = await tx.select({ charged: calls.chargedMicroCad }).from(calls).where(eq(calls.budgetId, BUDGET_ID));
    if (history.reduce((sum, c) => sum + c.charged, 0) + reserved * TRIAL_CAD_PER_USD > Math.min(budget!.capMicroCad, cap * 1000000)) {
      throw new SetupError('NOT_READY', 'This request would exceed the approved AI trial budget. Your saved draft is unchanged.');
    }
    const [row] = await tx.insert(calls).values({ id: randomUUID(), budgetId: BUDGET_ID, salonId: actor.salonId, actorId: actor.adminId, operationId: input.operationId, ordinal: input.ordinal, model, provider: override ? 'test-double' : 'openai', requestHash, reservedMicroUsd: reserved, chargedMicroCad: reserved * TRIAL_CAD_PER_USD, status: 'pending' }).returning();
    return row!;
  });
  const started = Date.now();
  try {
    const result = await provider.createResponse(request);
    const costMicroUsd = estimateSetupAiCost(result.usage, model);
    const rawOutput = result.partialText ?? result.items.filter(i => i.type === 'message').map(i => i.type === 'message' ? i.text : '').join('');
    // Raw output stays private in the DB, never in diagnostic logs or a frame.
    // Even invalid first output is retained for honest trial evaluation.
    await db.update(calls).set({ status: result.status, rawOutput: rawOutput.slice(0, 200000), elapsedMs: Date.now() - started, inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens, costMicroUsd, chargedMicroCad: (costMicroUsd ?? reserved) * TRIAL_CAD_PER_USD }).where(eq(calls.id, call.id));
    return { result, callId: call.id };
  } catch (error) {
    const costMicroUsd = error instanceof ModelProviderError ? estimateSetupAiCost(error.usage, model) : null;
    await db.update(calls).set({ status: 'failed', elapsedMs: Date.now() - started, costMicroUsd, chargedMicroCad: (costMicroUsd ?? reserved) * TRIAL_CAD_PER_USD }).where(eq(calls.id, call.id));
    throw error;
  }
}
