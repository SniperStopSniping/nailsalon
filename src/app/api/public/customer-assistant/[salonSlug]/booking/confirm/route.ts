import { z } from 'zod';

import { getCustomerAssistantConfig } from '@/libs/customerAssistant/access.server';
import { confirmCustomerBooking } from '@/libs/customerAssistant/confirmBooking.server';
import { customerContactRequestSchema, normalizeCustomerContact } from '@/libs/customerAssistant/contact';
import { CUSTOMER_NO_STORE, isCustomerSameOrigin, readCustomerJson, resolveCustomerAssistantSalon } from '@/libs/customerAssistant/http.server';
import { CustomerBookingOperationError } from '@/libs/customerAssistant/operationStore.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const schema = z.object({
  action: z.literal('confirm_booking'),
  capability: z.string().min(1).max(200),
  revision: z.number().int().positive(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  contact: customerContactRequestSchema,
  policyAccepted: z.boolean(),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ salonSlug: string }> }): Promise<Response> {
  if (!isCustomerSameOrigin(request)) {
    return new Response(null, { status: 403, headers: CUSTOMER_NO_STORE });
  }
  const config = getCustomerAssistantConfig();
  const { salonSlug } = await context.params;
  const salon = await resolveCustomerAssistantSalon(salonSlug);
  if (!config || !salon) {
    return new Response(null, { status: 404, headers: CUSTOMER_NO_STORE });
  }
  const body = schema.safeParse(await readCustomerJson(request));
  const contact = body.success ? normalizeCustomerContact(body.data.contact) : null;
  if (!body.success || !contact) {
    return new Response(null, { status: 400, headers: CUSTOMER_NO_STORE });
  }
  try {
    return Response.json(await confirmCustomerBooking({
      request,
      salon: { id: salon.id, slug: salon.slug },
      secret: config.signingSecret,
      ...body.data,
      contact,
    }), { headers: CUSTOMER_NO_STORE });
  } catch (error) {
    return Response.json({ kind: 'recovery_unavailable' }, {
      status: error instanceof CustomerBookingOperationError ? 409 : 503,
      headers: CUSTOMER_NO_STORE,
    });
  }
}
