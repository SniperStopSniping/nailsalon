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
    const allowance = new URLSearchParams(window.location.search).get('allowance') ?? 'verified';
    if (url.pathname === '/api/admin/salon/communications/starter-credits') {
      if (method === 'POST' && allowance === 'verification-required') {
        return json({ data: { status: 'verification_required' } });
      }
      if (method === 'GET') {
        return allowance === 'error'
          ? json({ error: 'Synthetic status failure' }, 503)
          : json({ data: { status: allowance === 'verified' ? 'verified' : 'unclaimed', canClaim: allowance !== 'owner-only' } });
      }
    }
    if (method !== 'GET') {
      return json({ error: 'Changes could not be saved. Try again.', message: 'Changes could not be saved. Try again.' }, 503);
    }
    if (url.pathname === '/api/admin/salon/communications/usage') {
      const balance = allowance === 'verified' ? 83 : 0;
      return json({ data: {
        salonId: 'salon_1',
        creditPurchasesAvailable: false,
        topupOffers: [],
        usage: { availableCredits: balance, starterCredits: balance, monthlyCredits: 0, purchasedCredits: 0, bonusCredits: 0, monthlyAllowance: 0, resetsAt: null, blockedMessages: 0, plan: null, coreAccess: { status: 'active', monthlySoftwarePriceCents: 0, expiresAt: null, usageBilledSeparately: true } },
        history: [{ id: 'review_message', channel: 'sms', eventType: 'booking_confirmation', recipient: '•••• 0199', status: 'delivered', scheduledFor: '2026-10-07T15:00:00Z', sentAt: '2026-10-07T15:00:01Z', creditsUsed: 1, reminderLeadMinutes: null, failureReason: null }],
        nextCursor: null,
      } });
    }
    if (url.pathname === '/api/billing/topups') {
      return json({ available: false, items: [], nextCursor: null });
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
      if (new URLSearchParams(window.location.search).get('app') === 'integrations') {
        const state = new URLSearchParams(window.location.search).get('google') ?? 'degraded';
        return json({ data: {
          availability: { google: true, email: true, twilio: false, photos: false },
          google: {
            status: state,
            readiness: state === 'reconnect_required' ? 'reconnect_required' : state === 'active' ? 'ready' : 'attention_required',
            email: 'calendar-review@example.invalid',
            lastError: state === 'reconnect_required' ? '[invalid_grant] Google authorization was revoked' : null,
            inboundSyncEnabled: true,
            inboundSyncedAt: '2026-10-08T10:00:00Z',
            inboundSyncError: state === 'degraded' ? 'GOOGLE_CALENDAR_CONNECTION_WRITE_FENCE_LOST' : null,
          },
          twilio: { status: 'disconnected' },
        } });
      }
      return json({ data: { stripeConnect: { salonId: 'salon_1', visible: true, status: 'onboarding_incomplete', chargeReady: false, payoutsPending: true, requirements: { currentlyDue: ['business_profile.url', 'external_account'] }, lastSyncedAt: null, hasBindingHistory: true } } });
    }
    if (url.pathname === '/api/integrations/google/calendars') {
      return json({ data: {
        calendars: [{ id: 'review-calendar', summary: 'Studio appointments', primary: true, accessRole: 'owner' }],
        selection: { destinationCalendarId: 'review-calendar', busyCalendarIds: ['review-calendar'] },
      } });
    }
    if (url.pathname.startsWith('/api/admin/owner-assistant')) {
      return json({}, 404);
    }
    return json({});
  };
}
