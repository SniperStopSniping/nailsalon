# Google Calendar OAuth verification

This document prepares Luster's owner-connected Google Calendar flow for Google's OAuth review. It describes the current application flow and the evidence still required from the production Google Cloud project.

## Source review — 10 October 2026

Rechecked against protected main `8a194effd6c8fbb20ec0209d47e79a3983f061e3`. This is a factual disclosure and review-preparation update, not a change to OAuth permissions, event synchronization, or data retention. It does not claim Google approval.

- `src/app/api/integrations/google/connect/route.ts` defines the owner scope list.
- `src/libs/googleCalendar.ts` reads selected events, including title, description, location and attendee contact details.
- `src/libs/googleCalendarInbound.ts` persists event details and extracted contact fields for review and linked-appointment synchronization.
- `src/app/api/integrations/google/disconnect/route.ts` requests token revocation and deletes the connection record; it does not delete synchronized event or appointment records. A request to revoke is not a guarantee that the provider accepted it.

## Owner OAuth scopes

The authorization request is defined in `src/app/api/integrations/google/connect/route.ts`:

- `openid` and `email` identify which Google account the salon owner connected.
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly` lists the calendars the owner can access so the owner can choose an appointment destination and calendars to check for conflicts. Luster does not add, remove, or change calendar subscriptions.
- `https://www.googleapis.com/auth/calendar.freebusy` queries only free/busy time for booking conflict checks. It does not provide event titles or descriptions through that endpoint.
- `https://www.googleapis.com/auth/calendar.events` reads event details from calendars selected by the owner, supports the event review/import flow and inbound appointment synchronization, and creates, updates, or deletes Luster-linked appointment events. Luster supports calendars shared with the owner, including writable appointment destinations and other selected calendars used for conflict checks, so `calendar.events.owned` would exclude supported calendars. `calendar.events.readonly` would not permit Luster to keep appointment mirrors synchronized.

The `calendar.events` permission itself covers calendars accessible to the connected Google account. Luster’s selected-calendar behavior is an application rule, not a narrower Google-issued permission.

The owner OAuth flow does not request `https://www.googleapis.com/auth/calendar` (the broader scope that can view, edit, share, and permanently delete every calendar the user can access). Do not add that scope to the production OAuth consent configuration.

Google's [Calendar scope reference](https://developers.google.com/workspace/calendar/api/auth) and [sensitive-scope verification guide](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) are the source for scope descriptions and verification requirements.

`src/libs/googleCalendar.ts` also contains a separate service-account scope for a legacy server configuration. That credential flow is not the salon owner's OAuth consent flow and must not be presented as an owner OAuth scope in the verification request or demonstration.

## Scope justification for Google's review

> Luster is an appointment scheduling and salon-management service. A salon owner can choose a Google Calendar for Luster appointment events and choose calendars whose busy times should prevent double-booking. Luster uses `calendar.calendarlist.readonly` to show the owner's available calendar choices without changing calendar subscriptions. It uses `calendar.freebusy` to check availability without retrieving event details through the free/busy request. It uses `calendar.events` to display event information from calendars the owner selected, let the owner review or convert selected events, apply incoming changes to Luster-linked appointments, and synchronize Luster appointment events. Read-only event access cannot support appointment synchronization. The narrower `calendar.events.owned` scope would not support shared calendars selected by the owner, which Luster explicitly supports. Luster does not request the full `calendar` scope. Google account identifiers and event information are scoped to the connected salon and handled as described in the public privacy policy.

The justification must match the exact scope list configured in Google Cloud Console. If the project uses different scopes, update this document and the video before submitting.

## Demonstration video recording outline

Record the real deployed Luster app and its real OAuth consent flow. Use a demo salon with synthetic data and a dedicated Google test account/calendar. Do not include production customer data, private calendar contents, real bookings, or outbound messages.

1. Show the public Luster identity and the Google Calendar connection entry point.
2. Start the normal **Connect Google Calendar** action and show the complete Google sign-in/consent flow in English. Keep the app name, requested permissions, and OAuth client ID in the browser address bar legible.
3. Grant access and return to Luster. Show the calendar list and select the dedicated demo calendar as the appointment destination and a demo calendar for conflict checks.
4. Show a synthetic busy event blocking a test time without exposing its details through the free/busy result.
5. Show the selected calendar's event appearing in Luster's schedule/review flow. Demonstrate an owner review action, then show a synthetic Luster appointment being created or updated in the selected Google Calendar.
6. Show an incoming change to that Luster-linked event reflected in Luster, demonstrating the two-way sync supported by `calendar.events`.

Upload the finished recording as an **Unlisted** YouTube video and confirm a reviewer can open the link. The recording must show the same app name, OAuth client, scopes, and user flow as the verification request; narration is helpful but optional.

## Production Google Cloud Console checklist

- Verify ownership of every authorized domain in Search Console.
- Use a publicly accessible homepage and set the matching privacy-policy and terms URLs. Current public routes are `https://www.lustergel.app/`, `https://www.lustergel.app/privacy`, and `https://www.lustergel.app/terms`.
- Confirm the app name, user support email, and developer contact email are current and monitored. The public support address is `support@lustergel.app`.
- In Data Access, declare the exact scopes used by the production OAuth client and remove obsolete or broader Calendar scopes that the app no longer requests.
- Confirm the redirect URI is the deployed production callback and that the consent screen uses the same production client ID shown in the video.
- Submit the sensitive-scope justifications and the accessible video link through Google's Verification Center, then answer any follow-up email from Google's review team.

The repository cannot confirm the current Google Cloud Console scope list, authorized-domain ownership, verification status, or YouTube link. Those items must be checked against the live production project before submission.
