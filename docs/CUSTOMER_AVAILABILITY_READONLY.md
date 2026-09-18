# Customer availability: read-only boundary

`getAnonymousCustomerBookingAvailability` is the customer-assistant entry point for the existing public booking availability calculation. Its caller supplies a resolved `{ id, slug }` salon context; chat input cannot select a tenant. It accepts only service/location/technician/date selection fields, rejects reschedule and manage-token parameters, and never reads an ambient customer session or appointment history.

It reuses the same booking policy, quote validation, working hours, location, technician, buffer, notice, conflict, and slot calculation used by `GET /api/appointments/availability`. The assistant is required to revalidate its selection and availability again before a later booking-confirmation step; this module does not create an appointment or hold a slot.

## Google Calendar

The assistant uses `getGoogleCalendarBusyWindowsReadOnly`, which requires a salon id and uses only an explicit tenant OAuth connection. It returns anonymous busy windows, preserves cancelled-mirror ghost suppression, and has a bounded aggregate request deadline. It never writes connection health, token expiry, a rotated credential, an outbox record, or an owner alert.

OAuth token exchange itself is necessarily a provider request. Google's documented refresh-token grant response contains an access token, expiry, scope, and token type; it does not specify a replacement refresh token. The reader continues using the stored refresh token under that provider contract. If a provider response unexpectedly includes a replacement refresh token, the reader fails closed and does not write it; this request cannot guarantee recovery if that provider behavior invalidates the old credential. [Google OAuth offline access documentation](https://developers.google.com/identity/protocols/oauth2/web-server#offline)

## Legacy fallback activation gate

The legacy process-global Google Calendar configuration is intentionally never used by this reader. If a salon has no tenant-specific connection while that fallback exists, customer availability fails closed. Do not activate customer AI for a salon until its manual availability uses an explicit tenant Google connection as well, or the manual legacy fallback is retired; otherwise manual and assistant calendar parity cannot be claimed.

## Focused validation

- Route tests prove the anonymous adapter uses only the read-only reader and rejects reschedule parameters before a salon or appointment lookup.
- Google Calendar resilience tests prove success and all tested failure paths do not update or transact against connection state, persist credentials, or send alerts; they include rotated-token, already-aborted-source, and aggregate-deadline cases.
- Google Calendar tests prove a tenant-bound public read cannot fall back to the global calendar.
