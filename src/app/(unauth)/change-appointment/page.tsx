import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { getServicesByIds, getTechnicianById } from '@/libs/queries';
import { getPublicPageContext } from '@/libs/tenant';

import ChangeAppointmentContent from './ChangeAppointmentContent';

/**
 * Change Appointment Page (Server Component)
 *
 * Fetches page appearance settings and conditionally wraps
 * the content with ThemeProvider if theme mode is enabled.
 */
export default async function ChangeAppointmentPage({
  searchParams,
  params,
}: {
  searchParams: {
    serviceIds?: string;
    techId?: string;
    locationId?: string;
    date?: string;
    time?: string;
    originalAppointmentId?: string;
    salonSlug?: string;
  };
  params?: { locale?: string; slug?: string };
}) {
  const context = await getPublicPageContext('book-confirm', searchParams, params);

  // Parse URL params
  const serviceIdList = searchParams.serviceIds?.split(',').filter(Boolean) || [];
  const techId = searchParams.techId || '';
  const locationId = searchParams.locationId || '';
  const dateStr = searchParams.date || '';
  const timeStr = searchParams.time || '';
  const originalAppointmentId = searchParams.originalAppointmentId || '';

  // Fetch the selected services from the database
  const dbServices = await getServicesByIds(serviceIdList, context.salon.id);

  // Fetch the selected technician (if not "any")
  let technician = null;
  if (techId && techId !== 'any') {
    const dbTech = await getTechnicianById(techId, context.salon.id);
    if (dbTech) {
      technician = {
        id: dbTech.id,
        name: dbTech.name,
        imageUrl: dbTech.avatarUrl || '/assets/images/tech-daniela.jpeg',
      };
    }
  }

  // Map DB services to the shape expected by the client component
  // Convert price from cents to dollars for display
  const services = dbServices.map(service => ({
    id: service.id,
    name: service.name,
    price: service.price / 100, // Convert cents to dollars
    duration: service.durationMinutes,
  }));

  return (
    <PublicSalonPageShell
      appearance={context.appearance}
      pageName="change-appointment"
      salon={context.salon}
    >
      <ChangeAppointmentContent
        services={services}
        technician={technician}
        locationId={locationId}
        dateStr={dateStr}
        timeStr={timeStr}
        originalAppointmentId={originalAppointmentId}
      />
    </PublicSalonPageShell>
  );
}
