import { clientDetail, clientList, emptyClientDetail } from './client-data';

const service = { id: 'svc_1', name: 'Russian Manicure', description: 'Detailed cuticle care, shaping and a clean natural finish.', price: 3500, durationMinutes: 35, preparationBufferMinutes: 10, cleanupBufferMinutes: 0, category: 'manicure', bookingCategory: 'manicure', imageUrl: null, isActive: true, addOns: [] };
const technician = { id: 'tech_1', name: 'Daniela', isActive: true, avatarUrl: null, weeklySchedule: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(day => [day, { start: '09:00', end: '18:00' }])) };
const today = new Date();
today.setHours(14, 0, 0, 0);
const scenario = new URLSearchParams(window.location.search).get('state');
export function installReviewApi() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.origin !== window.location.origin) {
      throw new Error('External calls are disabled in the isolated review.');
    }
    if (!url.pathname.startsWith('/api/')) {
      return originalFetch(input, init);
    }
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (method !== 'GET') {
      return Response.json({ error: { message: 'Writes are disabled in this visual review.' } }, { status: 403 });
    }
    const path = url.pathname;
    if (scenario === 'error' && ['/api/admin/clients', '/api/admin/appointments', '/api/salon/services'].includes(path)) {
      return Response.json({ error: { message: 'Synthetic connection failure' } }, { status: 503 });
    }
    if (path === '/api/admin/appointments') {
      return Response.json({ data: { appointments: scenario === 'empty' ? [] : [{ id: 'appt_review', clientName: 'Sofia Martin', startTime: today.toISOString(), endTime: new Date(today.getTime() + 35 * 60000).toISOString(), services: [{ name: 'Russian Manicure' }], technician, status: 'confirmed' }], schedule: { timeZone: 'America/Toronto', businessHours: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(day => [day, { open: '09:00', close: '18:00' }])), businessHoursSource: 'salon', technicians: [technician, { ...technician, id: 'tech_2', name: 'Emma' }], timeOff: [], blockedSlots: [] } }, meta: { timeZone: 'America/Toronto' } });
    }
    if (path === '/api/admin/calendar-blocks') {
      return Response.json({ data: { blocks: [], timeZone: 'America/Toronto' } });
    }
    if (path === '/api/integrations/google/events') {
      return Response.json({ data: { events: [] } });
    }
    if (path === '/api/admin/today') {
      return Response.json({ data: { timeZone: 'America/Toronto', integrationHealth: { google: { readiness: 'ready', status: 'connected' } }, links: { bookingUrl: `${window.location.origin}/book` } } });
    }
    if (path === '/api/admin/clients') {
      const query = url.searchParams.get('search')?.toLowerCase() ?? '';
      return Response.json(clientList(scenario === 'empty' || (query && !'sofia martin'.includes(query)) ? 'empty' : 'default'));
    }
    if (path === '/api/admin/clients/client_browser') {
      return Response.json(scenario === 'empty' ? emptyClientDetail() : clientDetail());
    }
    if (path === '/api/admin/settings/modules') {
      return Response.json({ data: { moduleReasons: { clientFlags: 'MODULE_DISABLED', clientBlocking: 'MODULE_DISABLED' } } });
    }
    if (path === '/api/admin/technicians') {
      return Response.json({ data: { technicians: [technician], pagination: { totalPages: 1 } } });
    }
    if (path === '/api/admin/client-insights') {
      return Response.json({ data: { generatedAt: new Date().toISOString(), timeZone: 'America/Toronto', rulesVersion: 'fixture', kpis: { active: 1, new_this_month: 0, due_to_return: 1, overdue: 0 }, segments: [], attention: { total: 0, items: [] } } });
    }
    if (path === '/api/salon/services') {
      return Response.json({ data: { services: scenario === 'empty' ? [] : [service, { ...service, id: 'svc_2', name: 'Gel Manicure + Gel Pedicure', price: 9000, durationMinutes: 150, category: 'combo', bookingCategory: 'combo' }], activeTechnicianCount: 1 } });
    }
    if (path === '/api/salon/add-ons') {
      return Response.json({ data: { addOns: [] } });
    }
    if (path === '/api/admin/salon/settings') {
      return Response.json({ merchandising: { lusterPromoDismissed: true, serviceLibraryIntroDismissed: true, showServiceImages: true, featureLusterManicure: false }, bookingConfig: { introPriceDefaultLabel: '', firstVisitDiscountEnabled: false } });
    }
    if (path === '/api/salon/services/from-templates') {
      return Response.json({ data: { ownedTemplateKeys: [] } });
    }
    if (/\/api\/salon\/services\/[^/]+\/add-ons/.test(path)) {
      return Response.json({ data: { addOns: [] } });
    }
    if (path === '/api/admin/clients/client_browser/flags') {
      return Response.json({ data: { client: { id: 'client_browser', phone: '4165550101', fullName: 'Sofia Martin', adminFlags: { isProblemClient: false, flagReason: '' }, isBlocked: false, blockedReason: '', noShowCount: 0, lateCancelCount: 0 } } });
    }
    if (path === '/api/admin/retention/settings') {
      return Response.json({ data: { settings: { defaultRebookDays: 21, reminderLeadHours: 24, googleReviewUrl: null, parkingInstructions: null } } });
    }
    if (path === '/api/admin/review-requests/settings') {
      return Response.json({ data: { googleReviewUrl: null, messageTemplate: '', businessName: null } });
    }
    if (path === '/api/admin/location') {
      return Response.json({ data: { location: null } });
    }
    if (path === '/api/admin/retention') {
      return Response.json({ data: { retention: [], appointmentReminders: [], history: [] } });
    }
    if (path.endsWith('/messages')) {
      return Response.json({ data: { sms: { manualAvailable: false, senderLabel: 'Synthetic fixture', senderMode: 'shared_luster', detail: 'Disabled in fixture' }, history: [] } });
    }
    if (path.endsWith('/review-requests')) {
      return Response.json({ data: { timeZone: 'America/Toronto', reviewRequestsSuppressed: false, history: [], hasMore: false } });
    }
    return Response.json({ error: { message: 'Unsupported isolated review endpoint' } }, { status: 404 });
  };
}
