import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { AI_CREDIT_PACKS, isAiCreditPackKey } from '@/features/ai-credits/catalog';
import { cancelAiCreditCheckout, createAiCreditCheckout, reconcileAiCreditSession } from '@/features/ai-credits/checkout.server';
import { aiCreditPlanEnv, aiCreditPurchasesEnabled, aiCreditsEnabled } from '@/features/ai-credits/config.server';
import { AiCreditError, aiCreditOverview } from '@/features/ai-credits/wallet.server';
import { SetupError } from '@/features/business-setup/contracts';
import { requireAdminSalonForSlug, requireRealSalonOwner } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { aiCreditPurchaseSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const slugSchema = z.string().min(1).max(100);
const base = { salonSlug: slugSchema };
const requestSchema = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('checkout'), operationId: z.string().uuid(), packKey: z.string().refine(isAiCreditPackKey), locale: z.enum(['en', 'fr']) }).strict(),
  z.object({ ...base, action: z.literal('reconcile'), purchaseId: z.string().uuid() }).strict(),
  z.object({ ...base, action: z.literal('cancel'), purchaseId: z.string().uuid() }).strict(),
]);

async function owner(salonSlug: string) {
  const result = await requireAdminSalonForSlug(salonSlug, { persistActiveSalon: false });
  if (result.error || !result.salon) {
    return { response: result.error ?? new Response(null, { status: 404, headers }) };
  }
  const guard = await requireRealSalonOwner(result.salon.id);
  if (!guard.ok) {
    return { response: guard.response };
  }
  return { actor: { salonId: result.salon.id, adminId: guard.admin.id } };
}

function failure(error: unknown) {
  if (error instanceof SetupError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : 409, headers });
  }
  if (error instanceof AiCreditError) {
    const status = { INVALID: 400, INSUFFICIENT_CREDITS: 402, CHECKOUT_PENDING: 409, PAYMENT_MISMATCH: 409, NOT_CONFIGURED: 503, NOT_FOUND: 404, STALE: 409 }[error.code];
    return Response.json({ error: { code: error.code, message: error.message } }, { status, headers });
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return Response.json({ error: { code: 'INVALID', message: 'Check your credit purchase and try again.' } }, { status: 400, headers });
  }
  return Response.json({ error: { code: 'NOT_READY', message: 'Your credit purchase could not be confirmed yet. Please try again; avoid starting another payment.' } }, { status: 503, headers });
}

export async function GET(request: Request) {
  if (!aiCreditsEnabled()) {
    return new Response(null, { status: 404, headers });
  }
  try {
    const salonSlug = slugSchema.parse(new URL(request.url).searchParams.get('salonSlug'));
    const access = await owner(salonSlug);
    if (access.response) {
      return access.response;
    }
    return Response.json({ data: await aiCreditOverview(access.actor, aiCreditPlanEnv()), packs: Object.values(AI_CREDIT_PACKS), purchasesEnabled: aiCreditPurchasesEnabled() }, { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  if (!aiCreditsEnabled()) {
    return new Response(null, { status: 404, headers });
  }
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return new Response(null, { status: 403, headers });
  }
  const limit = checkEndpointRateLimit('billing/ai-credits', getClientIp(request), 'BILLING');
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterMs);
  }
  if (Number(request.headers.get('content-length') ?? 0) > 4096) {
    return new Response(null, { status: 413, headers });
  }
  try {
    const text = await request.text();
    if (text.length > 4096) {
      return new Response(null, { status: 413, headers });
    }
    const input = requestSchema.parse(JSON.parse(text));
    const access = await owner(input.salonSlug);
    if (access.response) {
      return access.response;
    }
    if (input.action === 'checkout') {
      return Response.json({ data: await createAiCreditCheckout(access.actor, input) }, { headers });
    }
    const planEnv = aiCreditPlanEnv();
    const [purchase] = await db.select({ id: aiCreditPurchaseSchema.id }).from(aiCreditPurchaseSchema).where(and(eq(aiCreditPurchaseSchema.id, input.purchaseId), eq(aiCreditPurchaseSchema.salonId, access.actor.salonId), eq(aiCreditPurchaseSchema.planEnv, planEnv)));
    if (!purchase) {
      return new Response(null, { status: 404, headers });
    }
    const data = input.action === 'cancel'
      ? await cancelAiCreditCheckout(access.actor, purchase.id, planEnv)
      : await reconcileAiCreditSession(purchase.id, planEnv);
    return Response.json({ data }, { headers });
  } catch (error) {
    return failure(error);
  }
}
