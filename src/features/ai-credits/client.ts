import type { AiCreditPackKey } from './catalog';

export const AI_CREDITS_CHANGED = 'luster-ai-credits-changed';
export type AiCreditsOverview = {
  data: {
    availableMicroCad: number;
    reservedMicroCad: number;
    debtMicroCad: number;
    history: { id: string; kind: 'purchase' | 'usage' | 'reversal' | 'recovery'; amountMicroCad: number; createdAt: string }[];
    pendingPurchase: { id: string; packKey: AiCreditPackKey; canManage: boolean } | null;
  };
  purchasesEnabled: boolean;
};

/** Only hosted Stripe Checkout may receive a payment redirect. */
export function safeAiCheckoutUrl(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' && !url.port && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export async function aiCreditRequest<T>(salonSlug: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(body ? '/api/admin/ai-credits' : `/api/admin/ai-credits?salonSlug=${encodeURIComponent(salonSlug)}`, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ salonSlug, ...body }), signal }
    : { cache: 'no-store', signal });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    throw new Error(result?.error?.message ?? 'Your AI credits could not be checked. Try again when you’re connected.');
  }
  return result;
}
