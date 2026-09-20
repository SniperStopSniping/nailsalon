import { z } from 'zod';

import { getCustomerAssistantConfig } from '@/libs/customerAssistant/access.server';
import { createCustomerConversation, signCustomerConversation } from '@/libs/customerAssistant/conversation.server';
import { CUSTOMER_NO_STORE, isCustomerSameOrigin, readCustomerJson, resolveCustomerAssistantSalon } from '@/libs/customerAssistant/http.server';
import { resolveNextVisitOfferPreview } from '@/libs/nextVisitOffer.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const sessionRequestSchema = z.object({
  campaignToken: z.string().regex(/^[\w-]{32,200}$/).nullable().optional(),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ salonSlug: string }> }): Promise<Response> {
  const { salonSlug } = await context.params;
  const salon = await resolveCustomerAssistantSalon(salonSlug);
  if (!salon) {
    return new Response(null, { status: 404, headers: CUSTOMER_NO_STORE });
  }
  if (!isCustomerSameOrigin(request)) {
    return new Response(null, { status: 403, headers: CUSTOMER_NO_STORE });
  }
  // Preserve the existing empty POST contract for callers already on the
  // public booking page; only campaign-aware callers send a small JSON body.
  const body = sessionRequestSchema.safeParse((await readCustomerJson(request)) ?? {});
  if (!body.success) {
    return new Response(null, { status: 400, headers: CUSTOMER_NO_STORE });
  }
  const config = getCustomerAssistantConfig()!;
  let nextVisitOffer: { campaignId: string; entitlementId: string } | undefined;
  if (body.data.campaignToken) {
    const preview = await resolveNextVisitOfferPreview({
      salonId: salon.id,
      token: body.data.campaignToken,
      services: [],
    });
    // Any same-salon, resolved next-visit capability is safe as an opaque
    // presentation reference. It is never booking authority and every turn
    // revalidates it, but lets the assistant explain expired/used offers.
    if (preview) {
      nextVisitOffer = preview.reference;
    }
  }
  const conversation = signCustomerConversation(createCustomerConversation(salon.id, config.signingSecret, Date.now(), nextVisitOffer), config.signingSecret);
  return Response.json({ conversation }, { headers: CUSTOMER_NO_STORE });
}
