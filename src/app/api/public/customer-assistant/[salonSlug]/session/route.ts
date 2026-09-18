import { getCustomerAssistantConfig } from '@/libs/customerAssistant/access.server';
import { createCustomerConversation, signCustomerConversation } from '@/libs/customerAssistant/conversation.server';
import { CUSTOMER_NO_STORE, isCustomerSameOrigin, resolveCustomerAssistantSalon } from '@/libs/customerAssistant/http.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ salonSlug: string }> }): Promise<Response> {
  const { salonSlug } = await context.params;
  const salon = await resolveCustomerAssistantSalon(salonSlug);
  if (!salon) {
    return new Response(null, { status: 404, headers: CUSTOMER_NO_STORE });
  }
  if (!isCustomerSameOrigin(request)) {
    return new Response(null, { status: 403, headers: CUSTOMER_NO_STORE });
  }
  const config = getCustomerAssistantConfig()!;
  const conversation = signCustomerConversation(createCustomerConversation(salon.id, config.signingSecret), config.signingSecret);
  return Response.json({ conversation }, { headers: CUSTOMER_NO_STORE });
}
