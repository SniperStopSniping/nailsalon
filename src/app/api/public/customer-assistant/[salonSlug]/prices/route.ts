import { CUSTOMER_NO_STORE, resolveCustomerAssistantSalon } from '@/libs/customerAssistant/http.server';
import { loadCustomerPublicFacts } from '@/libs/customerAssistant/publicFacts.server';
import type { SalonFeatures } from '@/types/salonPolicy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Same public menu as the booking page. No session, model, or booking action. */
export async function GET(request: Request, context: { params: Promise<{ salonSlug: string }> }): Promise<Response> {
  const { salonSlug } = await context.params;
  const salon = await resolveCustomerAssistantSalon(salonSlug);
  if (!salon) {
    return new Response(null, { status: 404, headers: CUSTOMER_NO_STORE });
  }
  const locale = new URL(request.url).searchParams.get('locale') === 'fr' ? 'fr' : 'en';
  try {
    const facts = await loadCustomerPublicFacts({ salonId: salon.id, salonSlug: salon.slug, features: salon.features as SalonFeatures | null, locale });
    return Response.json({ salon: { name: facts.salon.name }, catalogue: { currency: facts.catalogue.currency, services: facts.catalogue.services } }, { headers: CUSTOMER_NO_STORE });
  } catch {
    return new Response(null, { status: 503, headers: CUSTOMER_NO_STORE });
  }
}
