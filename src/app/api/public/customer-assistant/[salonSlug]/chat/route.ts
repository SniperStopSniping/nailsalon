import { customerChatRequestSchema } from '@/libs/customerAssistant/contracts';
import { CUSTOMER_NO_STORE, isCustomerSameOrigin, readCustomerJson, resolveCustomerAssistantSalon } from '@/libs/customerAssistant/http.server';
import { runCustomerAssistantTurn } from '@/libs/customerAssistant/turn.server';
import { getPublicBookingClientIp } from '@/libs/publicBookingRateLimit.server';
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
  const body = customerChatRequestSchema.safeParse(await readCustomerJson(request));
  if (!body.success) {
    return new Response(null, { status: 400, headers: CUSTOMER_NO_STORE });
  }
  const response = await runCustomerAssistantTurn({
    ...body.data,
    salonId: salon.id,
    features: salon.features as SalonFeatures | null,
    clientIp: getPublicBookingClientIp(request),
  });
  return Response.json(response, { headers: CUSTOMER_NO_STORE });
}
