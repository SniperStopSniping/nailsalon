import { z } from 'zod';

import { getCustomerBookingRecoverySecret } from '@/libs/customerAssistant/access.server';
import { confirmCustomerBooking } from '@/libs/customerAssistant/confirmBooking.server';
import { customerContactRequestSchema, normalizeCustomerContact } from '@/libs/customerAssistant/contact';
import { CUSTOMER_NO_STORE, isCustomerSameOrigin, readCustomerJson } from '@/libs/customerAssistant/http.server';
import { getSalonById } from '@/libs/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({ capability: z.string().min(1).max(200), revision: z.number().int().positive(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/u), contact: customerContactRequestSchema, policyAccepted: z.boolean() }).strict();

export async function POST(request: Request, context: { params: Promise<{ salonId: string }> }): Promise<Response> {
  if (!isCustomerSameOrigin(request)) {
    return new Response(null, { status: 403, headers: CUSTOMER_NO_STORE });
  }
  const body = schema.safeParse(await readCustomerJson(request));
  const { salonId } = await context.params;
  const secret = getCustomerBookingRecoverySecret();
  const salon = await getSalonById(salonId);
  const contact = body.success ? normalizeCustomerContact(body.data.contact) : null;
  if (!body.success || !contact) {
    return new Response(null, { status: 400, headers: CUSTOMER_NO_STORE });
  }
  if (!secret || !salon) {
    return new Response(null, { status: 404, headers: CUSTOMER_NO_STORE });
  }
  try {
    return Response.json(await confirmCustomerBooking({ request, salon: { id: salon.id, slug: salon.slug }, secret, ...body.data, contact }), { headers: CUSTOMER_NO_STORE });
  } catch {
    return new Response(null, { status: 409, headers: CUSTOMER_NO_STORE });
  }
}
