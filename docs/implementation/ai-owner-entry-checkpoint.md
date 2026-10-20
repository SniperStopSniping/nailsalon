# AI owner-entry development checkpoint

This phase connects normal onboarding and More to the existing paid AI draft
builder. It is local, flag-disabled source work, not a production release or
proof of a completed paid AI journey.

## Delivered

- With self-service enrollment enabled, the existing starting-point screen
  offers Quick Book, Your Canva Design and Build with AI. Secondary manual full
  website setup remains available. Persisted manual starter identifiers and
  the Canva editor are unchanged; the flag-off chooser keeps its existing copy.
- `/ai-website` explains design, services, prices, hours and supported settings;
  shows CAD10/20/50 one-time credit choices; and leads to account creation or
  sign-in. The existing Clerk account widget and organization-task resolution
  are reused, including the requested return to the AI builder.
- The verified-email entry API reuses a single owned salon, asks when there are
  multiple, and rejects staff-only, other-owner and deleted businesses. With no
  owned business, it creates one private unpublished salon under an identity
  transaction lock. Repeated or concurrent requests return the same salon.
- New salons retain the existing free booking plan, closed/unconfirmed hours,
  private contact/address defaults, disabled bookings and disabled reminders.
  They receive no services, appointments, customer records, credits or external
  integrations from this entry. The original draft loader, review and publisher
  perform the remaining business setup.
- More offers a salon-specific Luster AI destination only to an owner with the
  server enrollment flag. A zero-balance builder opens the existing credit
  chooser before the owner tries a paid message. Opening it does not start a
  checkout or call the model.

## Enrollment and compatibility

`BUSINESS_SETUP_SELF_SERVE_ENABLED` defaults to false. Enrollment additionally
requires the existing onboarding integration, `BUSINESS_SETUP_AI_ENABLED`,
`AI_CREDITS_ENABLED` and `AI_CREDIT_METERING_ENABLED`. Purchases retain their
separate switch and payment configuration. Existing allowlisted pilots and
saved manual draft access remain available when enrollment is disabled.

`ai-website` is reserved as a system route and canonicalized on tenant hosts.
Entry and selection are reauthorized server-side; a browser slug does not grant
access. The builder still uses its existing exact review, draft/live boundary,
provider isolation and original booking system. This phase adds no migration.

## Evidence

- 212 root unit/integration/component tests passed, including existing
  onboarding account save/resume, dashboard navigation and builder recovery.
- 76 prototype tests passed across chooser, starting screens and onboarding
  app. The final copy adjustment was rechecked in 43 chooser/screen tests.
- Two new-owner races passed on attested disposable PostgreSQL with zero skips:
  simultaneous same-account creation and concurrent tenant separation.
- 17 native CI contract checks passed. CI now requires the two new PostgreSQL
  entry cases in addition to the existing seven wallet/metering cases.
- 14 desktop Chromium/iPhone WebKit browser checks passed, including preserved
  manual startup and interrupted-module recovery. The four new entry cases
  passed again after final copy and screenshot adjustments.
- TypeScript, scoped ESLint (existing nonblocking warnings) and secret scanning
  passed. No live provider/payment calls were made in this phase.

UI screenshots show real production UI components with synthetic account-entry
responses. They do not prove real Clerk signup, Stripe payment or AI output:

- [Desktop starter choices](../../artifacts/ai-credits/entry/choices-chromium.png)
- [iPhone starter choices](../../artifacts/ai-credits/entry/choices-webkit.png)
- [Desktop AI introduction](../../artifacts/ai-credits/entry/intro-chromium.png)
- [iPhone AI introduction](../../artifacts/ai-credits/entry/intro-webkit.png)

## Remaining release work

The signup-to-payment-to-real-AI-to-original-booking acceptance journey remains
unverified for this new route. Stripe sandbox configuration/trials, an actual
owner-workflow recording, friendly booking-address selection before first
publication, remaining staff/settings support, real-provider quality/cost
trials, hosted-preview isolation and remote CI/review/release gates remain.
No push, merge, deployment or production data changes occurred in this phase.
