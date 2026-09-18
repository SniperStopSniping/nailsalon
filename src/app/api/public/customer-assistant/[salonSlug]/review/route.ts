import { normalizeCustomerContact } from '@/libs/customerAssistant/contact';
import { CUSTOMER_NO_STORE, isCustomerSameOrigin, readCustomerJson, resolveCustomerAssistantSalon } from '@/libs/customerAssistant/http.server';
import { prepareCustomerAssistantReview } from '@/libs/customerAssistant/review.server';
import { customerReviewRequestSchema } from '@/libs/customerAssistant/reviewContracts';
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
  const body = customerReviewRequestSchema.safeParse(await readCustomerJson(request));
  if (!body.success) {
    return new Response(null, { status: 400, headers: CUSTOMER_NO_STORE });
  }
  const contact = normalizeCustomerContact(body.data.contact);
  if (!contact) {
    return new Response(null, { status: 400, headers: CUSTOMER_NO_STORE });
  }
  const response = await prepareCustomerAssistantReview({
    salon: {
      id: salon.id,
      slug: salon.slug,
      name: salon.name,
      settings: salon.settings,
      features: salon.features,
      plan: salon.plan,
      address: salon.address,
      city: salon.city,
      state: salon.state,
      zipCode: salon.zipCode,
    },
    features: salon.features as SalonFeatures | null,
    conversation: body.data.conversation,
    contact,
    clientIp: getPublicBookingClientIp(request),
  });
  return Response.json(response, { headers: CUSTOMER_NO_STORE });
}
