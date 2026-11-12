import { createHash } from 'node:crypto';

import { z } from 'zod';

import { readCustomerJson } from '@/libs/customerAssistant/http.server';
import { verifyPaymentReturnToken } from '@/libs/customerPayments/server/paymentReturnToken';
import { workspaceOriginAllowed } from '@/libs/customerPayments/server/workspaceHttp';
import { checkEndpointRateLimit, getClientIp } from '@/libs/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
const bodySchema = z.object({ token: z.string().min(1).max(2048) }).strict();

/** Read only: redirects, amounts and success query strings never settle money. */
export async function POST(request: Request) {
  if (!workspaceOriginAllowed(request)) {
    return Response.json({ error: 'PAYMENT_STATUS_UNAVAILABLE' }, { status: 403, headers });
  }
  const ipLimit = checkEndpointRateLimit('payment-return-ip', getClientIp(request), 'GENERAL');
  if (!ipLimit.allowed) {
    return Response.json({ error: 'PAYMENT_STATUS_RATE_LIMITED' }, { status: 429, headers });
  }
  try {
    const input = bodySchema.safeParse(await readCustomerJson(request));
    const origin = new URL(request.url).origin;
    if (!input.success || !verifyPaymentReturnToken(input.data.token, origin)) {
      return Response.json({ error: 'PAYMENT_STATUS_UNAVAILABLE' }, { status: 404, headers });
    }
    const digest = createHash('sha256').update(input.data.token).digest('hex');
    if (!checkEndpointRateLimit('payment-return-token', digest, 'GENERAL').allowed) {
      return Response.json({ error: 'PAYMENT_STATUS_RATE_LIMITED' }, { status: 429, headers });
    }
    const [{ db }, { createPaymentWorkspaceRepository }] = await Promise.all([import('@/libs/DB'), import('@/libs/customerPayments/server/workspaceRepository')]);
    const data = await createPaymentWorkspaceRepository(db).readReturnStatus(input.data.token, origin);
    return Response.json(data ? { data } : { error: 'PAYMENT_STATUS_UNAVAILABLE' }, { status: data ? 200 : 404, headers });
  } catch {
    return Response.json({ error: 'PAYMENT_STATUS_UNAVAILABLE' }, { status: 503, headers });
  }
}
