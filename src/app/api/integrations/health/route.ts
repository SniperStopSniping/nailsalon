import { requireAdminSalon } from '@/libs/adminAuth';
import { getSalonIntegrationHealth } from '@/libs/integrationHealth';

export async function GET(request: Request) {
  const salonSlug = new URL(request.url).searchParams.get('salonSlug');
  if (!salonSlug) {
    return Response.json({ error: 'salonSlug is required' }, { status: 400 });
  }
  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error || Response.json({ error: 'Salon not found' }, { status: 404 });
  }
  const data = await getSalonIntegrationHealth(salon.id);
  return Response.json({ data });
}
