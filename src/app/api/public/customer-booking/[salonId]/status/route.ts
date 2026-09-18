import { z } from 'zod';

import { getCustomerBookingRecoverySecret } from '@/libs/customerAssistant/access.server';
import { readCustomerBookingStatus } from '@/libs/customerAssistant/bookingStatus.server';
import { CUSTOMER_NO_STORE, isCustomerSameOrigin, readCustomerJson } from '@/libs/customerAssistant/http.server';
import { CustomerBookingOperationError, readCustomerBookingOperation } from '@/libs/customerAssistant/operationStore.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({ capability: z.string().min(1).max(200) }).strict();

/** Read-only recovery: no model admission, booking creation or provider calls. */
export async function POST(request: Request, context: { params: Promise<{ salonId: string }> }): Promise<Response> {
  if (!isCustomerSameOrigin(request)) {
    return new Response(null, { status: 403, headers: CUSTOMER_NO_STORE });
  }
  const body = schema.safeParse(await readCustomerJson(request));
  if (!body.success) {
    return new Response(null, { status: 400, headers: CUSTOMER_NO_STORE });
  }
  const secret = getCustomerBookingRecoverySecret();
  const { salonId } = await context.params;
  if (!secret) {
    return new Response(null, { status: 404, headers: CUSTOMER_NO_STORE });
  }
  try {
    const operation = await readCustomerBookingOperation({ salonId, capability: body.data.capability, secret });
    return Response.json(await readCustomerBookingStatus(operation, secret), { headers: CUSTOMER_NO_STORE });
  } catch (error) {
    // A database timeout is unresolved, never evidence that creation failed.
    return Response.json({ kind: 'recovery_unavailable' }, {
      status: error instanceof CustomerBookingOperationError ? 404 : 503,
      headers: CUSTOMER_NO_STORE,
    });
  }
}
