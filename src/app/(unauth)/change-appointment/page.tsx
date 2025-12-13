import { PageThemeWrapper } from '@/components/PageThemeWrapper';
import { getPageAppearance } from '@/libs/pageAppearance';
import { getSalonBySlug, getServicesByIds, getTechnicianById } from '@/libs/queries';

import ChangeAppointmentContent from './ChangeAppointmentContent';

// Demo salon ID - in production, this would come from auth context or subdomain
const DEMO_SALON_ID = 'salon_nail-salon-no5';
const DEFAULT_SALON_SLUG = 'nail-salon-no5';

/**
 * Change Appointment Page (Server Component)
 *
 * Fetches page appearance settings and conditionally wraps
 * the content with ThemeProvider if theme mode is enabled.
 */
export default async function ChangeAppointmentPage({
  searchParams,
}: {
  searchParams: { serviceIds?: string; techId?: string; date?: string; time?: string; clientPhone?: string; originalAppointmentId?: string };
}) {
  const { mode, themeKey } = await getPageAppearance(DEMO_SALON_ID, 'book-confirm');

  // Parse URL params
  const serviceIdList = searchParams.serviceIds?.split(',').filter(Boolean) || [];
  const techId = searchParams.techId || '';
  const dateStr = searchParams.date || '';
  const timeStr = searchParams.time || '';
  const clientPhone = searchParams.clientPhone || '';
  const originalAppointmentId = searchParams.originalAppointmentId || '';

  // Fetch salon data
  const salon = await getSalonBySlug(DEFAULT_SALON_SLUG);

  if (!salon) {
    return (
      <PageThemeWrapper mode={mode} themeKey={themeKey} pageName="change-appointment">
        <ChangeAppointmentContent
          services={[]}
          technician={null}
          dateStr={dateStr}
          timeStr={timeStr}
          clientPhone={clientPhone}
          originalAppointmentId={originalAppointmentId}
        />
      </PageThemeWrapper>
    );
  }

  // Fetch the selected services from the database
  const dbServices = await getServicesByIds(serviceIdList, salon.id);

  // Fetch the selected technician (if not "any")
  let technician = null;
  if (techId && techId !== 'any') {
    const dbTech = await getTechnicianById(techId, salon.id);
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
    <PageThemeWrapper mode={mode} themeKey={themeKey} pageName="change-appointment">
      <ChangeAppointmentContent
        services={services}
        technician={technician}
        dateStr={dateStr}
        timeStr={timeStr}
        clientPhone={clientPhone}
        originalAppointmentId={originalAppointmentId}
      />
    </PageThemeWrapper>
  );
}
