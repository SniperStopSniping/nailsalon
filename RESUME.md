# Twilio communications reliability — 2026-09-08

Branch: `codex/twilio-communications-reliability-20260908` from `origin/main` at `71f70ca`.
Worktree: `/Users/me/nailsalon-worktrees/twilio-communications-reliability-20260908`.

## Scope and safety

Repair the existing Twilio/communications system only. No broad product audit, production data mutations, real customer messages, automatic merge, or deployment. Preserve the original checkout and its user-owned changes. Node 20.19.4 and committed npm lockfile; test database is isolated PGlite, provider calls mocked.

## Checkpoint 0 — architecture audit

- Existing canonical storage: `communication_intent`, `notification_delivery`, salon `settings.communications`, shared consent/inbound tables and SMS credit ledger/reservations. Reuse them; no parallel inbox or billing system.
- Existing send paths diverge: shared sender dispatches intents; BYO and legacy `SMS.ts` send directly. Unify active appointment/manual sends through intents with mode-first sender resolution.
- Booking/request/approval/reschedule/cancel are incompletely wired. Pending bookings can use confirmed wording. Cancellation messages fail the dispatcher's blanket active-appointment check.
- Reminder reconciler can cancel overdue but unsent reminders; final dispatch lacks current state/contact/revision/settings/quiet-hours checks.
- Client Text opens a native Messages draft rather than sending through the configured Luster identity. Existing retention timeline records owner-marked outreach, not provider delivery.
- Usage/history reads intent status only, so later delivery failures appear sent. Retry must keep one intent/delivery and never resend ambiguous provider outcomes.
- Inbound BYO account-or-number selection is ambiguous; delivery callbacks need SID/account/service binding beyond signature verification.
- Integrations reflects old BYO/module readiness, ignoring shared sender, credits and actual communications preferences. Invalid settings can reset safety preferences.
- Inbound currently handles consent and metadata, not a two-way inbox. Preserve this scope and explain reply behavior honestly.

## Delivery scope completed

1. Provider/dispatcher, sender safety, callbacks and inbound regression tests.
2. Booking lifecycle, reminders and deterministic disposable-salon helper journey.
3. Manual composer/send/retry/history using existing intents and delivery records.
4. Settings/Integrations readiness and focused UI repairs.
5. Full suite, typecheck, branch-wide lint, appointment regressions, mobile component browser checks and real PostgreSQL SMS concurrency checks.

## Verification / release status

- `npm ci --no-audit --no-fund` succeeded with Node 20.19.4.
- No provider credentials copied into this worktree; no real messages sent.
- Code repairs and automated verification are complete. No push, preview deployment, merge or production deployment has been performed. Full authenticated owner browser verification and an approved-number carrier pilot remain release gates.

## Checkpoint 1 — truthful settings and integration readiness

- Added server-resolved shared/BYO SMS availability, worker configuration, credits, sender label, and manual/automatic/reminder state.
- Settings preserves explicit pauses and disabled preferences when stored data is malformed; BYO legacy defaults apply only when canonical SMS settings are absent.
- Removed contradictory native-only manual-text messaging. Usage reads provider delivery state and only counts settled shared-credit sends.
- Existing SMS event storage is unrestricted text; added the `manual_text` TypeScript event without a database migration.
- Settings/Integrations/settings API focused checks: 273 tests passed; new operational SMS health/history checks: 11 passed. Owned-file lint has no errors (pre-existing warnings remain).

## Additional verification in progress

- Manual API/service tests: 9 passed; composer + client/appointment actions: 34 passed.
- Unknown-outcome refund + appointment sheet + booking-page isolated rerun: 91 passed.
- `npm run check-types` passed using repository-approved CI placeholders and Node 20. Initial attempts correctly failed closed on incomplete environment markers; no guards were bypassed.
- First full suite during active migration: 630 files passed, 12 failed, 17 skipped; failures exposed obsolete direct-send expectations, token churn, and component test timing. Repairs and full rerun required before handoff.
- Disk filled during local browser verification. Stopped own browser/server, ran `npm run clean` in this task worktree, and replaced this task's fresh dependencies with a symlink to an existing installation only after verifying every dependency lock entry matched. Recovered 1.6 GiB without deleting user caches or changing the original checkout.
- Disposable browser data is `/tmp/luster-sms-lab-20260908`; server stopped. No real provider calls. Full browser journey not yet verified.

## Checkpoint 2 — provider, delivery, callbacks and recovery

- One `messages.create` seam with bounded timeout, SDK retries disabled and explicit rejection versus uncertain outcome handling. No fallback onto a different texting identity.
- Shared/BYO dispatcher checks current settings, quiet hours, tenant/client/appointment state and contacts before provider invocation. Delivery evidence and transition to sending are atomic; rejected retries reuse the delivery record and ambiguous outcomes retain their credit hold.
- Signed inbound/status/deauthorization requests bind known account identity. Known connected-account signing tokens can be fetched with existing Connect authorization and held briefly server-side; no token is stored or logged. Missing access fails closed.
- Callback replay resumes idempotent refunds after interruption. Unknown-outcome adoption settles evidence and refunds an already-undelivered message once.
- Provider scope: 90 targeted tests passed; focused lint clean. Unknown-outcome resolver: 4 passed. No real Twilio API calls made during tests.

## Checkpoint 3 — appointment lifecycle, reminders and owner texting

- Appointment creation, request approval, deposit confirmation, private-link cancellation, expiry and reschedule persist canonical SMS events inside the business transaction. Instant bookings are stored as confirmed; explicit requests remain pending with matching wording.
- Replaced the separate direct-send reminder worker with canonical reminder rules. Current timezone, lead time, contact, rule/settings revision and appointment state are checked; old reminders are invalidated and concurrent workers cannot duplicate provider calls.
- Added tenant-authorized manual text/history/retry API and composer to existing client/appointment actions. Current canonical contact and appointment ownership are resolved server-side. Lost-response replays observe the original intent before mutable readiness checks; safe rejected retries reuse the original delivery.
- Explicit reminder resends carry an action key; ordinary repeated clicks retain deterministic dedupe. History separates provider delivery from owner-recorded native outreach.
- Final dispatcher checks also reject changed reminder rules, inactive salons and revoked BYO connections, with readable failure reasons.
- Lifecycle targeted verification: 12 suites / 259 tests passed. Manual queue-to-provider/tenant/contact/quiet/retry tests: 8 passed. Manual route: 6 passed. Dispatcher followup/email checks: 25 passed.
- Real PostgreSQL 16.15 verification: dispatcher concurrency 5/5 and SMS credit concurrency 9/9 passed against a new explicitly disposable localhost cluster. Provider mocked; cluster stopped and removed. Logs: `/tmp/luster-sms-pg-dispatcher-20260908.log`, `/tmp/luster-sms-pg-credits-20260908.log`.
- Production build passed with approved synthetic CI configuration and no external database/provider credentials. Task build artifacts cleaned afterward to restore scarce local disk space.
- Secret scan initially refused an unstaged tracked-file deletion; rerun after staging/commit is required. It did not report a credential value.

## Checkpoint 4 — mobile regression coverage and operational handoff

- Audit checkpoint: `891226f`; settings/usage: `4c394a1`; provider/callback recovery: `4c5574a`; lifecycle/manual texting: `6a1b813`.
- Added actual-component mobile browser fixture in `tests/browser/sms/` and `docs/TWILIO_COMMUNICATIONS_RUNBOOK.md` with configuration, exact Console setup, worker behavior, controlled activation and remaining verification gates.
- `npm run test:all -- --maxWorkers=3 --minWorkers=1`: **642 files passed, 17 skipped; 7,484 tests passed, 175 skipped, 1 TODO; no failures**. Log: `/tmp/luster-sms-final-all.log`.
- `npm run test:appointment-regression -- --maxWorkers=2 --minWorkers=1`: **8 files / 105 tests passed**. Final manual service/API/composer subset: **18 passed**. Forced-reminder action suite: **14 passed**.
- Mobile Playwright: **6/6 passed**, Pixel 7 Chromium and iPhone 13 WebKit, after final composer changes. Component APIs intercepted; no real SMS. Full authenticated Next owner journey was not completed because isolated auth/runtime prerequisites failed during the initial low-disk attempt. The PGlite journey exercises real business helpers and booking routes have separate integration coverage; neither substitutes for the missing full browser journey.
- `npm run check-types` passed in the final source checkpoint's required commit hook. `npm run lint` passed; explicit ESLint covered all **85 changed/untracked TS/TSX files**, zero errors and four existing warnings. `git diff --check` clean.
- Final-source `npm run build` passed after the resend changes, using synthetic CI credentials and isolated PGlite fallback. Log: `/tmp/luster-sms-final-build2.log`. Build output was cleaned to recover local disk space; no build was deployed.
- `npm run security:check-secrets` passed after the intentional test-file deletion was staged. No credential leak found.
- The general suite leaves external PostgreSQL suites and the live Redis check opt-in; the relevant dispatcher (5) and credit reservation (9) PostgreSQL tests were run separately and passed. Other skipped groups include booking/deposit/client lifecycle/integration outbox/entitlement/portfolio/Stripe concurrency and existing deletion/architecture skips. No shared database or external provider was used.
- Daniela is **not yet cleared for live customer SMS**. The code is ready for release review, but Twilio account/sender-pool/permissions, public signed callback reachability, Redis/cron execution, approved credits/consent and an authorized owner-number end-to-end pilot must be verified on the release environment. Ordinary inbound replies remain metadata/consent evidence, not a conversational inbox.

## Checkpoint 5 — provider setup, 2026-09-08

- User requested setup of the completed implementation, with no purchases, charges, sends, deployments, protected-main merges, or irreversible provider changes without approval. User privately signed into the correct Twilio account in Chrome; its Account SID was compared exactly with production. No password or secret value was requested or printed.
- The configured Twilio account is active and Full. Its existing Toronto Canadian local number ending **9444** supports SMS/MMS. Both messaging and voice currently route to an n8n workflow. Preserve that workflow until the user explicitly authorizes repurposing the number; attaching it to a Messaging Service also changes opt-out scope.
- Created the free, empty **Luster appointment texts** Messaging Service in that account. Staged inbound POST `https://islanailsalon.com/api/integrations/twilio/inbound`, with service webhook routing. Generic status callback is blank because Luster supplies the delivery-specific URL per message. No number was attached and no SMS activation flag changed.
- Advanced Opt-Out remains disabled. Twilio documents that disabling it after activation requires Support; explicit approval is required before enabling. The runbook now records this restriction. New Console service pages loaded blank during inspection; no STOP/START/HELP copy save is claimed.
- Production Vercel project is `isla-nail-studio`. Latest inspected production SHA remains **71f70ca**, while the completed repair is **b64802b**. No release has been performed.
- Existing production configuration present: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, legacy `TWILIO_PHONE_NUMBER`, `NEXT_PUBLIC_APP_URL`, `DATABASE_URL`, `REDIS_URL`, and `CRON_SECRET`. Added and read-verified production-only Vercel settings `TWILIO_MESSAGING_SERVICE_SID` for the empty Luster service and `COMMUNICATIONS_SMS_ENABLED=false`. These are staged for a future release; the active production deployment remains unchanged. `SMS_PILOT_ENABLED` and `SMS_PILOT_SALON_ALLOWLIST` remain absent. Short-link/sender-identity overrides are absent but existing defaults match the production origin and stable identity. No credentials or local environment files changed.
- Public production health returned database/Redis connectivity and configured cron secret. Read-only runtime logs showed successful dispatcher and reminder invocations at the configured five/fifteen-minute intervals. The mutating worker endpoints were not invoked manually. Health's `twilioEnv` field checks Connect onboarding and is not evidence that shared account credentials are invalid.
- Daniela's actual saved preferences, reminder rules, platform controls, sender connection, Luster credit balances and queued work remain unverified. Production database credentials are sensitive/redacted; no production SQL or automated test used them. Existing browser tabs did not establish an authenticated production owner view.
- Added `docs/TWILIO_PILOT_CHECKLIST.md` for all twelve requested outcomes and evidence. No recipient is approved. The salon-only pilot allowlist is not a recipient restriction: prepare an isolated disposable salon containing only approved contacts, and do not enable Daniela's real customer queue for a test.
- Remaining gates: number-use/cutover decision; explicit Advanced Opt-Out approval; approved release; actual salon/platform/credits/queue verification; isolated pilot configuration; recipient and send approval; carrier/callback/STOP/START/history/credit evidence. No pilot has run. This checkpoint changes documentation only; prior implementation test results remain unchanged.

## Checkpoint 6 — old n8n SMS connections and protected active number

- User authorized stopping old n8n SMS interception and confirmed **647-584-9444 is unused** and available for Luster. **647-250-9891 is active on a different Twilio account and must remain untouched.** Do not disable any n8n workflow by name or change that other account. The scoped account's fresh complete inventory contains only the number ending 9444, and each inspected subscription explicitly belongs to that account.
- Read-only n8n inspection found the published `Appointment Booking AI Agent new number` workflow contains both an SMS Event Streams trigger and a Calls webhook. Neither of its inspected webhook addresses matches 9444's configured routes or the two scoped Event Streams sinks. No workflow, node, credential, execution or publication was changed.
- The 9444 account has two old n8n Event Streams subscriptions, each containing only `com.twilio.messaging.inbound-message.received`, schema version 6. One destination matches the number's direct SMS webhook. These streams can forward incoming SMS independently of the direct number webhook and must be addressed before the pilot.
- Attempted the documented reversible event-type removal on the first subscription. Twilio returned **HTTP 409**; readback confirmed the event remains. No successful provider mutation occurred in this attempt. Both subscriptions and sinks, number SMS/voice routing, and the empty Luster sender pool remain unchanged. Do not claim n8n interception has stopped or the number is attached. Parent subscription deletion requires the user's next explicit approval.
- The full route/event rollback snapshot is stored privately with mode 0600 outside the repository; the sanitized inventory remains `/tmp/luster-twilio-inventory-20260908.json`. Restoring a deleted parent subscription would create a new SID; retain the sinks and do not remove or republish unrelated n8n workflows. Previously queued Event Streams deliveries may retry for up to four hours.
- Saved and read-verified Luster's STOP and HELP copy from the implementation, plus START copy, in the correct Messaging Service Console. Preserved standard opt-out alternatives; Console now shows CANCEL/END/OPTOUT/QUIT/REVOKE/STOP/STOPALL/UNSUBSCRIBE, START/UNSTOP/YES, and HELP/INFO. **Enable advanced opt-out** remains available: activation is still off and awaits explicit approval because disabling it requires Twilio Support.
- Read-only Console verification confirms **Canada (+1) geographic messaging permission is enabled**. No geographic permissions changed. Production SMS remains disabled, and no SMS, purchase, billing change, deployment, push or merge occurred.
- Release inspection found remote `main` still at 71f70ca, no pushed repair branch and no PR. Required main checks and review gates therefore have no remote evidence for this repair yet. A future branch push would need approval for any resulting Vercel preview deployment under the user's no-deploy instruction.
- Low disk space interrupted Chrome. Removed only the stopped disposable test database at `/tmp/luster-sms-lab-20260908/data` after confirming no process held it open; retained its seed script and logs. Dismissed Chrome's storage warning without clearing any website data, credentials, or user files.

## Checkpoint 7 — approved SMS cutover completed

- User explicitly approved permanent removal of the two old n8n SMS subscriptions for **647-584-9444**, while preserving **647-250-9891**, all n8n workflows and call routing.
- Completed at **2026-09-08 22:04:09 UTC / 18:04:09 Toronto**. Fresh account/number/subscription checks passed; both approved subscription deletions were verified absent, and the complete scoped account subscription list is now empty. Both original sinks remain unchanged for reference/restoration. No other account or n8n workflow was changed.
- Cleared only 9444's direct SMS webhook and attached its existing number to **Luster appointment texts** as the sole sender. API readback and Console's Sender Pool both confirm the intended Canadian SMS/MMS number. The owned number was reused without a purchase.
- Effective inbound routing is the service's POST `https://islanailsalon.com/api/integrations/twilio/inbound`, with `useInboundWebhookOnNumber=false`. Generic service status callback remains blank; Luster supplies delivery-specific callbacks. All voice settings and other number properties were preserved, apart from the provider's update timestamp.
- The newly approved cutover backup/result is private, mode 0600, outside the repository. The sanitized inventory is updated. Restoration of deleted subscriptions requires creating new subscription identities using the preserved configuration; no n8n workflow should be republished casually to restore them.
- This removes the configured forwarding paths for new SMS. Previously queued Event Streams deliveries were not inspected and may retry for up to four hours; use **2026-09-09 02:04:09 UTC / September 8 22:04:09 Toronto** as a conservative pre-cutover retry horizon, not proof that a queue was flushed.
- Advanced Opt-Out copy is saved but activation remains **off**. The user's deletion approval does not authorize that separate provider change. Next approval is enabling Advanced Opt-Out, which requires Twilio Support to disable later. Production SMS remains disabled; release, actual salon/platform/credits/queue access, isolated pilot setup and explicit recipient/send approval are still pending. No SMS, deployment, purchase or environment activation occurred.
