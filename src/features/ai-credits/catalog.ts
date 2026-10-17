/** Public package facts. Credits represent CAD retail value, not provider cost. */
export const AI_CREDIT_PACKS = {
  ai_10_cad_v1: { key: 'ai_10_cad_v1', priceCents: 1000, creditMicroCad: 10_000_000, currency: 'cad' },
  ai_20_cad_v1: { key: 'ai_20_cad_v1', priceCents: 2000, creditMicroCad: 20_000_000, currency: 'cad' },
  ai_50_cad_v1: { key: 'ai_50_cad_v1', priceCents: 5000, creditMicroCad: 50_000_000, currency: 'cad' },
} as const;

export type AiCreditPackKey = keyof typeof AI_CREDIT_PACKS;
export type AiCreditPlanEnv = 'dev' | 'test' | 'prod';

export function isAiCreditPackKey(value: string): value is AiCreditPackKey {
  return Object.hasOwn(AI_CREDIT_PACKS, value);
}

export function formatAiCredits(microCad: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(microCad / 1_000_000);
}

/** Integer micro-CAD prevents rounding each tiny edit up to a whole cent. */
export function retailAiCredits(providerMicroUsd: number, usdToCadMillionths: number) {
  if (!Number.isSafeInteger(providerMicroUsd) || providerMicroUsd < 0
    || !Number.isSafeInteger(usdToCadMillionths) || usdToCadMillionths < 1_000_000 || usdToCadMillionths > 3_000_000) {
    throw new Error('INVALID_AI_PRICE');
  }
  const amount = (BigInt(providerMicroUsd) * BigInt(usdToCadMillionths) * BigInt(2) + BigInt(999_999)) / BigInt(1_000_000);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('INVALID_AI_PRICE');
  }
  return Number(amount);
}
