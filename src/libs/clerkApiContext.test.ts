import { describe, expect, it } from 'vitest';

import { apiPathNeedsClerkContext } from './clerkApiContext';

describe('apiPathNeedsClerkContext', () => {
  it.each([
    '/api/admin/appointments',
    '/api/admin/google-events/abc',
    '/api/salon/services',
    '/api/onboarding/complete',
    '/api/integrations/google/events',
    // The appointment routes authenticate owners via Clerk-backed guards:
    '/api/appointments',
    '/api/appointments/appt_1/manage',
    '/api/appointments/appt_1/cancel',
    '/api/appointments/appt_1/complete',
    '/api/appointments/appt_1/transition',
    '/api/appointments/appt_1/resend-confirmation',
    '/api/appointments/availability',
  ])('provides Clerk context for %s', (pathname) => {
    expect(apiPathNeedsClerkContext(pathname)).toBe(true);
  });

  it.each([
    '/api/public/appointments/recovery',
    '/api/public/appointments/manage/token123',
    '/api/reminders/process',
    '/api/webhooks/stripe',
    '/api/client/next-appointment',
    '/api/auth/otp',
    '/en/nail-salon-no5/book',
  ])('skips Clerk for %s', (pathname) => {
    expect(apiPathNeedsClerkContext(pathname)).toBe(false);
  });
});
