const service = { id: 'svc_1', name: 'Russian Manicure', description: 'Detailed cuticle care and shaping.', price: 3500, durationMinutes: 35, preparationBufferMinutes: 10, cleanupBufferMinutes: 0, category: 'manicure', bookingCategory: 'manicure', imageUrl: null, isActive: true, addOns: [] };

/** Memory-only responses. No API write or external request reaches a server. */
export function installReviewApi() {
  const originalFetch = window.fetch.bind(window);
  const scenario = new URLSearchParams(window.location.search).get('state');
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.origin !== window.location.origin) {
      throw new Error('External requests are disabled in this isolated review.');
    }
    if (!url.pathname.startsWith('/api/')) {
      return originalFetch(input, init);
    }
    const path = url.pathname;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (method !== 'GET') {
      if (scenario === 'error') {
        return Response.json({ error: { code: 'INTERNAL_ERROR', message: 'Synthetic save failure. Please try again.' } }, { status: 503 });
      }
      if (path === '/api/admin/clients' && method === 'POST') {
        return Response.json({ data: { client: { id: 'fixture_client', fullName: 'Sofia Review', phone: '4165550101', email: null, archived: false }, created: true, message: 'Client added in isolated fixture.' } });
      }
      return Response.json({ error: { message: 'This isolated review does not save records.' } }, { status: 403 });
    }
    if (path === '/api/admin/calendar-blocks') {
      return Response.json({ data: { timeZone: 'America/Toronto', blocks: [{ id: 'block_fixture', technicianId: 'tech_1', label: 'Lunch break', startsAt: '2026-10-07T16:00:00.000Z', endsAt: '2026-10-07T16:30:00.000Z', updatedAt: '2026-10-07T12:00:00.000Z' }] } });
    }
    if (path === '/api/salon/services') {
      return Response.json({ data: { services: [service], activeTechnicianCount: 1 } });
    }
    if (path === '/api/salon/add-ons' || /\/api\/salon\/services\/[^/]+\/add-ons/.test(path)) {
      return Response.json({ data: { addOns: [] } });
    }
    if (path === '/api/admin/salon/settings') {
      return Response.json({ merchandising: { lusterPromoDismissed: true, serviceLibraryIntroDismissed: true, showServiceImages: true, featureLusterManicure: false }, bookingConfig: { introPriceDefaultLabel: '', firstVisitDiscountEnabled: false } });
    }
    if (path === '/api/salon/services/from-templates') {
      return Response.json({ data: { ownedTemplateKeys: [] } });
    }
    return Response.json({ error: { message: 'Unsupported isolated review endpoint.' } }, { status: 404 });
  };
}
