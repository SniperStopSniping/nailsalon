# Luster SMS operation and verification

This pass repairs communications only. It does not enable production SMS, change credentials, provision numbers, run production migrations, or authorize customer sends. The current code and deployment configuration govern behavior; older Gate A/B descriptions of a future dispatcher or native-only manual texting are obsolete.

Operational follow-up: the existing Canadian sender and approved opt-out routing are configured. The repair is under review in [PR #170](https://github.com/SniperStopSniping/nailsalon/pull/170); production still runs `71f70ca`. All GitHub CI passed at `1e631bb`. The authorized Preview passed its corrected Clerk guard but is blocked by mismatched Stripe test keys. See `RESUME.md` checkpoints 5–10 and the [pilot checklist](TWILIO_PILOT_CHECKLIST.md) for authenticated salon findings and remaining gates. No live SMS pilot or production release has been authorized or performed.

## Architecture and audit findings

| Area | Existing foundation | Defect repaired / operational boundary |
| --- | --- | --- |
| Configuration | Server-only `Env`, `smsSender`, guarded environments | Mode-first shared/BYO readiness; no fallback to a platform bare number when a salon connection is absent. |
| Number identity | Luster shared Messaging Service; existing `salon_twilio_connection` | Existing BYO remains supported. New Connect/provisioning remains gated by `SMS_BYO_MODE_ENABLED`. Ordinary owners use the shared sender without entering secrets. |
| Outbound | `communication_intent` and `notification_delivery` | Appointment lifecycle and owner texts use durable intents; `twilioMessagingSend` is the single `messages.create` boundary. |
| Booking | Transactional appointment writes, canonical management capabilities | Request, approval, confirmation, reschedule and cancellation have distinct SMS events/copy; texts are enqueued with business mutations. |
| Reminders | Timezone/DST scheduling, stable rule IDs, cron | Canonical rules replace the separate BYO dual-window worker. Due-but-unsent reminders survive reconciliation; changed appointment/contact/settings are checked before send. |
| Manual text | Client/appointment actions and retention records | Text opens a Luster composer. Server resolves salon/client/appointment; the browser cannot choose a recipient or sender. Explicit native promotional/directions drafts remain owner-recorded outreach. |
| History | Usage intentions and native outreach timeline | Client and appointment SMS history shows provider status, readable failure, queue time, and safe retry. Usage distinguishes shared credits from BYO provider billing. |
| Delivery callbacks | Signed Twilio endpoint, monotonic status ranks | Account, message, recipient and sender are bound to delivery evidence; terminal failure refunds are idempotent. |
| Inbound | Consent events and inbound metadata | Signed account/number/service attribution and provider-SID replay protection. STOP/START/HELP are supported; ordinary replies are not a two-way inbox. |
| Recovery | Leases, unknown-outcome reconciliation, credit reservations | Retry reuses the original intent/delivery. Provider acceptance uncertainty never becomes an automatic resend. Callback evidence can settle and refund an unknown send. |
| Settings | Existing communications JSON and Integrations | Shared/BYO identity, manual/automatic/reminder availability, pause, credits, quiet hours and blockers are shown from actual server gates. |

Every queued text carries salon, optional appointment, canonical client ID in variables when applicable, type, recipient, dedupe identity, schedule and expiry. Rendering records the body, fingerprint, encoding and segment count; delivery records sender identity, provider SID, status, timestamps, error and credit settlement. No schema migration is required for this repair.

## Owner workflow

1. In Settings → Client texts & reminders, enable text messages. Check the reminder rules, salon timezone and quiet hours, then save. Existing per-event preferences remain respected by the server.
2. In Integrations, check the texting identity and any blocker. A saved preference alone does not mean the sender, worker, or credits are ready.
3. Open a client or appointment and choose **Text**. Review the appointment-related text and segment count, then **Send text**. Queued means waiting for the worker; it does not claim the client has received it.
4. SMS history updates for queued messages and supports **Refresh delivery status**. Native drafts and owner-marked outreach remain distinguishable from Luster delivery evidence.
5. Retry only when **Retry text** is offered. A network-uncertain submit retains its send identifier; **Retry same request** cannot create a second intent. **Checking delivery** requires provider evidence and is never blindly resent.

For an appointment reminder already recorded in history, **Resend reminder → Send again** is an explicit new action. Its request identifier survives a lost response or server error, so retrying that action observes the same queued reminder. After the server acknowledges acceptance, a later confirmed resend receives a new identifier.

The configured production schedule runs `/api/communications/dispatch` every five minutes and `/api/reminders/process` every fifteen minutes (`vercel.json`). Both routes require `CRON_SECRET` as a Bearer token or `x-cron-secret`; a local development server does not run this schedule automatically. A present secret does not verify that the deployed scheduler is executing. Quiet hours can defer sends further. Immediate client-triggered booking acknowledgements follow the existing confirmation exception; owner-initiated messages and reminders respect quiet hours. Expired or superseded reminders are not sent late.

## Twilio Console setup for the shared Luster sender

Use the account that owns the shared Luster sender. Do not put credentials in a browser, client field, public environment variable, screenshot, or commit.

1. Under **Phone Numbers → Manage → Active numbers**, ensure an SMS-capable Canadian number is available. Under **Messaging → Services**, create/open the intended Luster Messaging Service and add that number to its **Sender Pool**. An `MG…` environment value alone does not verify that a number is attached.
2. In the Messaging Service **Integration** settings, select the option that sends incoming messages to a webhook, rather than deferring to each sender or dropping messages. Set POST to `https://<production-app-origin>/api/integrations/twilio/inbound`.
3. Stage **Advanced Opt-Out** wording for the Messaging Service, then obtain explicit approval before enabling it: [Twilio requires Support to disable it afterward](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out). Preserve STOP/START/HELP behavior and configure STOP wording to explain that opting out does not cancel the appointment. The reviewed copy is `ADVANCED_OPT_OUT_COPY` in `src/libs/communicationTemplates.ts`. `CANCEL` is an opt-out keyword; it never cancels an appointment in Luster.
4. Delivery callbacks are supplied per message by Luster as `https://<production-app-origin>/api/integrations/twilio/status?deliveryId=<generated-id>`. Do not invent or hard-code a delivery ID in Console. The application's `NEXT_PUBLIC_APP_URL` must match the public HTTPS origin used to receive and validate these signed requests. This origin is public configuration, never a credential.
5. Confirm the account can send to the intended Canadian destination. Trial restrictions and provider sender registration/verification must be satisfied in Twilio before a real delivery pilot.

Twilio references: [Messaging Services](https://www.twilio.com/docs/messaging/services), [incoming webhook fields](https://www.twilio.com/docs/messaging/guides/webhook-request), [status callbacks](https://www.twilio.com/docs/usage/webhooks/messaging-webhooks), [Advanced Opt-Out webhook behavior](https://help.twilio.com/articles/31560110671259).

Canada guidance checked September 8, 2026: domestic long codes and two-way SMS are supported. Canadian carriers can filter application-generated texts; Twilio recommends verified toll-free numbers or short codes for optimal delivery, but a configured local sender is not itself a carrier-delivery guarantee. Use the existing Canadian number for the separately approved, bounded pilot before considering any purchase. Follow daytime sending and HELP/STOP guidance. [Twilio Canada SMS guidelines](https://www.twilio.com/en-us/guidelines/ca/sms).

Keep consent evidence for the intended appointment-text use and identify the sender clearly. Appointment details or a phone number alone are not proof of permission for unrelated promotional messaging. Honor opt-outs before any further send. [Twilio Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy).

Before reusing an existing number, inspect its current messaging and voice routing. Attaching a number to a service can change inbound routing and opt-out scope, including when outbound application sending is disabled. Prepare an empty service first; obtain approval for any cutover that affects an existing workflow. Preserve the prior configuration for rollback and leave voice routing unchanged unless explicitly authorized.

Also inspect account-wide Event Streams subscriptions. An n8n Twilio Trigger can receive incoming SMS through Event Streams independently of the number's SMS webhook. Changing only that webhook does not remove this duplicate automation path. Scope any authorized pause to the verified account and SMS event type; preserve other accounts, call routing, subscription/sink resources, and the event's schema version for restoration. [Twilio's Subscribed Event API](https://www.twilio.com/docs/events/event-streams/subscription/subscribed-event-api) supports removing and restoring an event type on the same subscription. Never unpublish an entire n8n workflow merely because its name resembles the old integration; it may serve another active number or also handle calls.

In the 2026-09-08 setup, Twilio rejected removing a subscription's sole event with HTTP 409 and left it unchanged. Do not silently replace that failed pause with deletion of the parent subscription. Obtain explicit approval for parent deletion, preserve its configuration and sink, and document that restoration creates a new subscription identity. Account-wide event deliveries already queued may still retry for [up to four hours](https://www.twilio.com/docs/events/event-delivery-and-duplication); configuration inspection alone does not prove that backlog is empty.

## Application configuration and controlled activation

Configure these values on the intended environment: server-only `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `LUSTER_SHORT_LINK_ORIGIN`, `REDIS_URL`, and `CRON_SECRET`, plus the public origin `NEXT_PUBLIC_APP_URL`. Shared texting needs a reachable Redis rate limiter and sufficient shared SMS credits. Keep `LUSTER_SMS_SENDER_IDENTITY` stable across phone-number changes; consent is keyed to the logical identity. Set `LUSTER_SHORT_LINK_ORIGIN` to a Luster-controlled origin serving this environment's `/a/<token>` route; it must not be a salon custom domain. The legacy fallback is `https://islanailsalon.com`, so disposable verification must explicitly override it. Production short-link origin length must fit the existing 31-character origin budget.

Keep `COMMUNICATIONS_SMS_ENABLED` and `platform_communication_control.smsEnabled` off while setting up. Configure `SMS_PILOT_ENABLED=true` and `SMS_PILOT_SALON_ALLOWLIST` for the exact approved salon slug. Configure salon preferences and provide legitimate test credits through existing billing controls. Enable the environment switch only when setup is ready; enable platform control last, for the approved pilot. New BYO onboarding is independent and stays disabled unless deliberately needed.

Existing BYO connections use the connected Account SID with the application's Twilio Connect Auth Token; they do not consume shared Luster credits or depend on the shared sender/pilot switch. Their own opt-out namespace remains isolated. [Twilio Connect authentication](https://www.twilio.com/docs/iam/connect).

For existing BYO connections, configure the connected Messaging Service's incoming webhook and Advanced Opt-Out as above. A phone-number-only connection needs the number's incoming-message webhook set to the same inbound endpoint. Webhook validation may need to retrieve the known connected account's signing token through Connect authorization; revoked access or insufficient account-read permission fails closed. A failed or incomplete BYO connection remains attached to its own identity and never switches automatically to the shared sender.

### What blocks texting

Settings and Integrations return the first applicable blocker; resolving it may reveal the next one.

| Gate | Required condition |
| --- | --- |
| Shared sender | `COMMUNICATIONS_SMS_ENABLED=true`, enabled platform control, account/token/`MG…` values, and pilot eligibility when `SMS_PILOT_ENABLED=true`. An enabled pilot with an empty allowlist admits no salon. |
| Connected sender | Existing connection is `active`, has a valid `AC…` account SID and a Messaging Service or number, and the application has its Connect Auth Token. New onboarding additionally requires `SMS_BYO_MODE_ENABLED=true` and the existing Connect app/redirect configuration. |
| Delivery callbacks | `NEXT_PUBLIC_APP_URL` is an absolute HTTPS origin; HTTP is accepted only for localhost or `127.0.0.1` development. Missing or invalid configuration blocks the provider send. |
| Shared sending controls | `REDIS_URL` is present; the rate limiter must also work when the dispatcher runs. |
| Message worker | `CRON_SECRET` is present, and the deployed cron invokes the configured routes successfully. |
| Salon preferences | Communications are not paused and the SMS master is enabled. Reminders also need an enabled appointment-reminder event and at least one enabled SMS/both reminder rule. |
| Shared usage | Available credits are positive. Individual messages still need enough credits for their actual segment count. |
| Individual events and recipients | Platform/event preferences, current appointment/client contact, recipient consent/STOP state, supported destination, quiet hours, and expiry are checked at send time. Platform pauses can separately stop manual texts or reminders. |

Operational readiness is a configuration and saved-state check. It does not call Twilio, verify that the sender pool contains a number, test Connect permissions, prove Redis connectivity, check callback reachability, or prove the cron has run. Those are separate checks in the approved delivery pilot. This repair did not inspect or change live Twilio Console configuration.

## Verification and remaining release gate

Final verification on this branch: the full Vitest suite passed 7,484 tests across 642 files, with 175 skipped tests and one existing TODO; the appointment regression suite passed 105 tests. Typecheck, production build, secret scan and explicit lint of all 85 changed TypeScript files passed (zero lint errors, four existing warnings). General-suite skips include opt-in external-database/Redis checks; the relevant SMS PostgreSQL suites were run separately as described below. No deployment or live Twilio send occurred.

Automated tests use isolated PGlite, mocked provider calls, and generated signed callback requests. They must not connect to a shared development/production database or text customer numbers. Twilio test credentials do not support `MessagingServiceSid` and do not trigger delivery callbacks, so they cannot prove this complete production path. [Twilio test-credential limitations](https://www.twilio.com/docs/iam/test-credentials).

The disposable database journey in `src/libs/communicationMaterialization.test.ts` seeds a test salon/client/appointment and invokes the real lifecycle, manual enqueue and history helpers for request receipt, approval, reminders, manual texting, reschedule, cancellation and coherent history. It verifies stored business state and communication events without calling a provider. Separate booking-route tests cover booking entry points; this helper journey does not itself navigate the owner UI or verify carrier delivery.

The mobile browser suite in `tests/browser/sms/` mounts the actual `LusterClientSms` component with production CSS and intercepted message APIs. All six Chromium/WebKit cases passed, covering repeated taps, queue/history feedback, retry of the same failed intent, setup blockers, focus and touch geometry. Run it with Node 20 using `node node_modules/@playwright/test/cli.js test --config tests/browser/sms/playwright.config.ts`. This is component browser verification, not a full authenticated owner booking journey. The attempted full local Next/PGlite browser journey stopped after disk exhaustion and PGlite runtime errors; no full owner browser result is claimed.

PGlite cannot establish behavior under genuine concurrent PostgreSQL connections. The opt-in suite `src/libs/communicationDispatcher.concurrency.integration.test.ts` was also run against a new disposable local PostgreSQL 16.15 database: all five dispatcher concurrency cases passed, alongside all nine credit concurrency cases. The local cluster was then stopped and removed. These suites still mock provider calls.

`npm run lint` passed, but its local changed-file graph defaults to the last committed range (`HEAD~1..HEAD`) and omits uncommitted/untracked code. Explicit ESLint additionally covered all 85 changed and untracked TypeScript files from branch base `71f70ca`: zero errors, with four existing Fast Refresh/hook-dependency warnings in Settings and Usage. The appointment resend UI's targeted suite passed all fourteen tests, including response-loss, repeated-tap and appointment-switch cases.

Before Daniela starts customer SMS, deploy the reviewed commits through the approved release path and run a separately authorized pilot using her own approved test number: booking/request, approval, delivery status, reminder, manual text, reschedule, cancellation, STOP, START, and credit debit/refund. Confirm another salon cannot send through the pilot, and that no reminder survives cancellation. Inspect Twilio logs if a result remains unknown; never reset an unknown intent to pending without proof of non-send. No customer rollout is certified merely by passing mocked tests or seeing “sender configured.”

For ordinary incoming replies, Luster currently records metadata/consent evidence and deliberately does not store or display a conversation body. A two-way inbox remains separate product work. Clients should use their secure appointment link or call the salon for changes.
