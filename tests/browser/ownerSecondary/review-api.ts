import { BOOKING_EXPERIENCE_DEFAULTS } from '@/libs/bookingExperience';

export function installReviewApi() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.origin !== window.location.origin) {
      throw new Error('External requests are disabled in the isolated review.');
    }
    if (!url.pathname.startsWith('/api/')) {
      return nativeFetch(input, init);
    }
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    if (method !== 'GET') {
      return json({ error: 'Changes could not be saved. Try again.', message: 'Changes could not be saved. Try again.' }, 503);
    }
    if (url.pathname === '/api/admin/salon/settings') {
      return json({ reviewsEnabled: true, rewardsEnabled: true, billingMode: 'STRIPE', subscriptionStatus: 'active', bookingExperience: BOOKING_EXPERIENCE_DEFAULTS, bookingConfig: { bufferMinutes: 10, slotIntervalMinutes: 15, currency: 'CAD', timezone: 'America/Toronto', minimumNoticeMinutes: 120, clientChangeCutoffHours: 24, confirmationMode: 'instant' }, payments: { tax: { enabled: false, name: '', ratePercent: 0 }, deposit: { enabled: false } }, communications: {} });
    }
    if (url.pathname === '/api/admin/profile') {
      return json({ user: { name: 'Review owner', email: 'review@example.com' } });
    }
    if (url.pathname === '/api/admin/settings/modules') {
      return json({ data: { modules: {}, entitledModules: {}, moduleReasons: {} } });
    }
    if (url.pathname === '/api/admin/settings/visibility') {
      return json({ data: { visibility: { staff: {} }, entitled: false } });
    }
    if (url.pathname === '/api/admin/settings/booking-flow') {
      return json({ data: { bookingFlowCustomizationEnabled: false, bookingFlow: null } });
    }
    if (url.pathname === '/api/integrations/health') {
      return json({ data: { stripeConnect: { salonId: 'salon_1', visible: true, status: 'onboarding_incomplete', chargeReady: false, payoutsPending: true, requirements: { currentlyDue: ['business_profile.url', 'external_account'] }, lastSyncedAt: null, hasBindingHistory: true } } });
    }
    if (url.pathname.startsWith('/api/admin/owner-assistant')) {
      return json({}, 404);
    }
    return json({});
  };
}
