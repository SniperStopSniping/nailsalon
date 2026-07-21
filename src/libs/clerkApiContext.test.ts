import { describe, expect, it } from 'vitest';

import { apiPathNeedsClerkContext } from './clerkApiContext';

describe('apiPathNeedsClerkContext', () => {
  it.each([
    '/api/admin/appointments',
    '/api/admin/google-events/abc',
    '/api/salon/services',
    // The whole /api/salon subtree is owner-guarded. Leaving add-ons out of
    // this list showed a Clerk-authenticated owner "0 add-ons" while their 33
    // add-ons sat untouched in the database:
    '/api/salon/add-ons',
    '/api/salon/add-ons/addon_1',
    '/api/salon/page-appearance',
    '/api/onboarding/complete',
    '/api/integrations/google/events',
    // Owner-guarded despite their prefixes:
    '/api/billing/portal',
    '/api/billing/checkout',
    '/api/staff/time-off',
    '/api/staff/time-off/req_1',
    '/api/staff/client/%2B15550001111',
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
    // Staff-session (OTP) endpoints — no Clerk involvement:
    '/api/staff/me',
    '/api/staff/send-otp',
    // The subtree prefixes are slash-terminated so a sibling name cannot be
    // swallowed by startsWith:
    '/api/salons',
    '/api/salon-public',
  ])('skips Clerk for %s', (pathname) => {
    expect(apiPathNeedsClerkContext(pathname)).toBe(false);
  });
});
