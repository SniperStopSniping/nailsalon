import { customerHandoffRequestSchema } from '@/libs/customerAssistant/contracts';
import { runCustomerHandoff } from '@/libs/customerAssistant/handoff.server';
import { CUSTOMER_NO_STORE, isCustomerSameOrigin, readCustomerJson, resolveCustomerAssistantSalon } from '@/libs/customerAssistant/http.server';
import type { SalonFeatures } from '@/types/salonPolicy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request, context: { params: Promise<{ salonSlug: string }> }): Promise<Response> {
  const { salonSlug } = await context.params;
  const salon = await resolveCustomerAssistantSalon(salonSlug);
  if (!salon) {
    return new Response(null, { status: 404, headers: CUSTOMER_NO_STORE });
  }
  if (!isCustomerSameOrigin(request)) {
    return new Response(null, { status: 403, headers: CUSTOMER_NO_STORE });
  }
  const body = customerHandoffRequestSchema.safeParse(await readCustomerJson(request));
  if (!body.success) {
    return new Response(null, { status: 400, headers: CUSTOMER_NO_STORE });
  }
  const response = await runCustomerHandoff({
    salon: { id: salon.id, slug: salon.slug },
    features: salon.features as SalonFeatures | null,
    conversation: body.data.conversation,
    fingerprint: body.data.fingerprint,
    flowToken: body.data.flowToken,
    operationCapability: body.data.operationCapability,
  });
  return Response.json(response, { headers: CUSTOMER_NO_STORE });
}
