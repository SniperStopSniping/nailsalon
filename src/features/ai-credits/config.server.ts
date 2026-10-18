import 'server-only';

import { z } from 'zod';

import { setupAiProviderConfigured } from '@/features/business-setup/ai-budget.server';
import { Env } from '@/libs/Env';
import { computeExpectedLivemode, expectedBillingPlanEnv, resolveRuntimeEnvironment } from '@/libs/environmentIsolation';

import type { AiCreditPackKey, AiCreditPlanEnv } from './catalog';
import { AiCreditError } from './wallet.server';

export function aiCreditsEnabled() {
  return process.env.AI_CREDITS_ENABLED === 'true';
}

export function aiCreditPurchasesEnabled() {
  return aiCreditMeteringEnabled() && process.env.AI_CREDIT_PURCHASES_ENABLED === 'true' && setupAiProviderConfigured();
}

export function aiCreditMeteringEnabled() {
  return aiCreditsEnabled() && process.env.AI_CREDIT_METERING_ENABLED === 'true';
}

export function aiCreditPlanEnv(): AiCreditPlanEnv {
  const mode = computeExpectedLivemode(process.env);
  const planEnv = Env.BILLING_PLAN_ENV;
  if (!mode.ok || mode.livemode !== (planEnv === 'prod') || expectedBillingPlanEnv(resolveRuntimeEnvironment(process.env)) !== planEnv) {
    throw new AiCreditError('NOT_CONFIGURED', 'AI credit purchases are not available in this environment.');
  }
  return planEnv;
}

const price = z.string().regex(/^price_[a-z0-9]{8,}$/iu);
const carrier = z.object({
  env: z.enum(['dev', 'test', 'prod']),
  packs: z.object({ ai_10_cad_v1: price, ai_20_cad_v1: price, ai_50_cad_v1: price }).strict(),
}).strict();

export function aiCreditStripePrice(packKey: AiCreditPackKey, planEnv: AiCreditPlanEnv) {
  try {
    const value = carrier.parse(JSON.parse(process.env.AI_CREDIT_STRIPE_PRICE_IDS ?? 'null'));
    if (value.env !== planEnv || new Set(Object.values(value.packs)).size !== 3) {
      throw new Error('environment');
    }
    return value.packs[packKey];
  } catch {
    throw new AiCreditError('NOT_CONFIGURED', 'AI credit packs are not connected yet. Please try again later.');
  }
}

/** A versioned accounting conversion; never present it as a live FX quote. */
export function aiCreditPricingPolicy() {
  const usdToCadMillionths = Number(process.env.AI_CREDIT_USD_TO_CAD_MILLIONTHS ?? 0);
  const version = process.env.AI_CREDIT_PRICING_VERSION ?? '';
  if (!Number.isSafeInteger(usdToCadMillionths) || usdToCadMillionths < 1_000_000 || usdToCadMillionths > 3_000_000 || !/^[\w.-]{1,64}$/u.test(version)) {
    throw new AiCreditError('NOT_CONFIGURED', 'AI usage pricing is temporarily unavailable. Your credits are safe.');
  }
  return { version, usdToCadMillionths };
}
