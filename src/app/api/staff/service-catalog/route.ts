import { getActiveAddOnsBySalonId, getServicesBySalonId } from '@/libs/queries';
import { requireStaffSession } from '@/libs/staffAuth';

// =============================================================================
// GET /api/staff/service-catalog
// =============================================================================
// Staff-scoped active service + add-on catalog for the Complete Appointment
// form (what was actually performed). Derives the salon from the staff session.
// =============================================================================

export async function GET(): Promise<Response> {
  const auth = await requireStaffSession();
  if (!auth.ok) {
    return auth.response;
  }

  const [services, addOns] = await Promise.all([
    getServicesBySalonId(auth.session.salonId),
    getActiveAddOnsBySalonId(auth.session.salonId),
  ]);

  return Response.json({
    data: {
      services: services.map(s => ({
        id: s.id,
        name: s.name,
        category: s.category,
        priceCents: s.price,
        durationMinutes: s.durationMinutes,
      })),
      addOns: addOns.map(a => ({
        id: a.id,
        name: a.name,
        category: a.category,
        priceCents: a.priceCents,
        durationMinutes: a.durationMinutes,
      })),
    },
  });
}
