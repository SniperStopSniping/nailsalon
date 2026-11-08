import '@/styles/global.css';

import { createRoot } from 'react-dom/client';

import { ScheduleCalendarModal } from '@/components/admin/ScheduleCalendarModal';

// Screenshot-only fixture. No credentials, database, or real customer records.
window.fetch = async (input) => {
  const url = String(input);
  if (url.includes('/api/admin/calendar-openings')) {
    return Response.json({ data: { openings: [{ technicianId: 'sample-tech', technicianName: 'Nail artist', startTime: '2026-11-10T13:00:00-05:00', endTime: '2026-11-10T15:00:00-05:00', durationMinutes: 120 }], timeZone: 'America/Toronto' } });
  }
  if (url.includes('/api/admin/today')) {
    return Response.json({ data: { integrationHealth: { google: { status: 'disconnected', readiness: 'not_connected' } } } });
  }
  if (url.includes('/api/integrations/google/events')) {
    return Response.json({ data: { events: [] } });
  }
  if (url.includes('/api/admin/appointments')) {
    const appointments = [
      ['10', 'Gel Manicure', 'Sample client A'],
      ['12', 'Builder Gel', 'Sample client B'],
      ['15', 'Gel-X Extensions', 'Sample client C'],
    ].map(([hour, name, clientName], index) => ({
      id: `sample-${index}`,
      clientName,
      startTime: `2026-11-10T${hour}:00:00-05:00`,
      endTime: `2026-11-10T${Number(hour) + 1}:00:00-05:00`,
      status: 'confirmed',
      services: [{ name }],
      technician: { id: 'sample-tech', name: 'Nail artist' },
    }));
    return Response.json({ data: { appointments }, meta: { timeZone: 'America/Toronto' } });
  }
  throw new Error(`Unexpected screenshot fixture request: ${url}`);
};
createRoot(document.getElementById('root')!).render(<div className="owner-workspace-theme"><ScheduleCalendarModal salonSlug="sample-studio" onClose={() => {}} /></div>);
