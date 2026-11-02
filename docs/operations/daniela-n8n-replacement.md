# Private Daniela / Isla n8n replacement

This implements the two uses identified in the October 7 audit: incoming call/SMS booking-link replies and the scheduled booking-link promotion. It is disabled by default. Other salons cannot opt into it. No workflow, phone routing, credential, customer message or subscription is changed by this PR.

## Behavior

- The configured existing business number plays the configured greeting with the existing `Polly.Joanna` voice and hangs up on calls. SMS and calls queue one booking text per provider event, with a seven-day repeat-contact cooldown. `after()` dispatches promptly after acknowledging the webhook; the five-minute worker recovers pending work.
- Promotions select at most one recipient at 11:00, 11:30, …, 18:30 in `America/Toronto`. There is no catch-up burst. All existing attempted/sent markers, including unparseable nonempty legacy markers, prevent another campaign attempt. Preferred contacts retain priority and remaining contacts follow primary-sheet row order.
- Both Sheets are reconciled by normalized phone. The latest booking timestamp wins; any ambiguous imported suppression wins. Verified later STOP/START events control the provider preference independently. START does not grant marketing eligibility. Contacts first received through this feature are not automatically enrolled in promotions when mirrored into Sheets.
- The separate private queue uses Daniela's existing dedicated Twilio account/number. Twilio charges stay with that account; this does not consume platform shared-SMS credits or weaken the shared dispatcher's sender restrictions. It requires dedicated server configuration and signed receiving identity.
- Sheets updates and Telegram alerts have independent failure states. A sheet outage cannot resend a text. API acceptance and handset delivery are recorded separately. A timeout or interrupted send becomes `unknown` and is never automatically retried; a matching signed status callback can reconcile it.
- Sheets retains the existing human-readable contact source and booking-link outbound/context fields, including the 72-hour awaiting-reply deadline. That deadline remains metadata, not an automated conversation. Unknown imported source/outbound context is preserved until a verified event supplies it.
- Message bodies are scrubbed from the private database after 90 days. Consent, campaign-attempt and dedupe evidence remain. Existing Google Sheets/Telegram retention is unchanged. All private tables cascade on salon deletion.

The optional “Ring me first” addition is outside this replacement. The existing greeting behavior is retained.

## Server configuration

`DANIELA_AUTOMATION_MODE` is unset/off, `shadow`, or `live`. Live also requires `VERCEL_ENV=production`, `DANIELA_N8N_CUTOVER_CONFIRMED=true`, the initial complete Sheets import, and every integration credential below. Preview cannot send through these providers. Shadow stores synthetic activity but never sends SMS, writes Sheets, or posts Telegram alerts; use synthetic data to avoid mixing simulation with customer history.

`DANIELA_AUTOMATION_CONFIG` is server-only JSON with:

- `salonId`: the verified existing Isla salon ID, additionally checked against active slug `isla-nail-studio` at every admission/claim.
- `accountSid`, `fromNumber`, `publicOrigin`: verified dedicated Twilio account, existing E.164 business number, canonical HTTPS app origin without a trailing slash.
- `greeting`, `bookingMessage`, `promoMessage`: exact currently approved n8n templates, copied after checking its published definitions.
- `blockedPhones`, `preferredPhones`: the audited n8n lists, in E.164; no hardcoded customer numbers in source.
- `sheets`: two entries `{ spreadsheetId, tab, role }`, exactly one `primary` and one `inbound`. Match the real main CRM/Sheet1 and TEST CRM/CRM identifiers, not names alone.
- `telegramChatId`: the existing authorized destination.

Dedicated secret variables: `DANIELA_TWILIO_AUTH_TOKEN`, `DANIELA_TELEGRAM_BOT_TOKEN`, and one of these Google connections:

- Preferred for this private installation: `DANIELA_GOOGLE_SERVICE_ACCOUNT_JSON`, containing a dedicated Google service-account key. Grant that service account Editor access to the two named workbooks only, without domain-wide delegation, user impersonation or project IAM roles. Keep both workbooks private. The token request uses the fixed Google endpoint and Sheets scope; downloaded JSON cannot change that endpoint. Store the key as a sensitive Production-only Vercel variable. Never reuse the Calendar service account.
- Existing alternative: `DANIELA_GOOGLE_CLIENT_ID`, `DANIELA_GOOGLE_CLIENT_SECRET`, and `DANIELA_GOOGLE_REFRESH_TOKEN`. The refresh token must already grant Sheets access to both documents. n8n-managed OAuth credentials are not portable to Luster, and a Calendar-only token is insufficient.

An explicitly supplied service account takes precedence; invalid service-account configuration fails closed without falling back to OAuth. Do not expose credentials in source, PRs, logs or screenshots. `DANIELA_CAMPAIGN_ENABLED=true` enables campaign admission; unset pauses it independently. The scheduled endpoint uses the existing `CRON_SECRET` bearer convention.

## Migration and acceptance

1. Recheck all n8n publication states, published templates, blocked/preferred contacts, Twilio number mapping, SMS Event Streams subscriptions, exact sheet columns and existing Telegram destination. Preserve workflow exports and both Sheets snapshots outside Git. The historical audit found two overlapping reply senders; do not copy their duplicate-send behavior.
2. Rehearse migration 0114 on an isolated database through the repository's guarded migration tooling. The checked-in Drizzle Kit version is incompatible with the repository's newer ORM, so this additive SQL/journal packet follows the hand-authored migration convention used by 0098–0113; package versions are unchanged. Apply Production schema only through the established protected release path.
3. Replay synthetic call/SMS, repeated events, cooldown boundaries, STOP/START, invalid caller, campaign exhaustion, existing attempts, failed/uncertain provider outcomes, and signed callbacks. Verify that unrelated salons, platform SMS credits and the other release candidate remain isolated.
4. Configure the verified templates and dedicated integrations in Production with mode unset and campaign paused. Do not connect Preview to real customer traffic. To import the current Sheets before enabling ingress, use the worker in `shadow` with campaign paused; it reads Sheets and marks the import complete without writing to external services. Clear any synthetic private test activity before the real cutover through an explicitly reviewed cleanup; do not delete migrated suppression or attempt state.
5. Cut over in one controlled window: pause n8n promotion and disable both overlapping reply paths/subscriptions; set live mode and cutover confirmation; route only the existing intended voice path and standard Twilio incoming-message webhook to `POST /api/private/daniela/inbound`. Preserve upstream call routing exactly. Status callbacks use `POST /api/private/daniela/status?id=...` and are supplied on every outgoing send. Confirm no duplicate Event Streams sink still sends via n8n.
6. With a specifically approved test handset, verify call greeting, prompt booking SMS, actual delivered callback, seven-day suppression, STOP/START, both Sheets and Telegram. Only then enable the promotional campaign and observe one controlled eligible recipient/slot. Monitor provider failures, `unknown` sends, stale imports and sheet/alert failures; never interpret queued/accepted as handset delivery.
7. Cancel the n8n subscription only after those results establish the replacement is working. Cancellation is not part of this source change.

`GET|POST /api/private/daniela/process` requires `Authorization: Bearer <CRON_SECRET>`. It reports counts and failure booleans without customer details. A worker lease prevents overlapping imports and sheet/Telegram writes. The contact and slot database constraints prevent duplicate admission and provider sends across processes.

## Rollback

Pause the campaign and set `DANIELA_AUTOMATION_MODE` off first. Reconcile any sending/unknown intents against Twilio before allowing another sender to handle the same contacts. Sync accepted reply timestamps, provider opt-outs and campaign attempts back to both Sheets. Restore the saved provider routing and enable exactly one elected n8n reply workflow plus the campaign if needed; do not re-enable both conflicting reply subscribers. Keep the private ledger and additive tables for reconciliation. Never retry unknown SMS solely because a webhook timed out.

## Verification status

Authenticated read-only n8n inspection on October 26 confirmed the same 12 workflows and three published definitions. The original reply version is `d0fa88b0-b910-48aa-a2c0-fd66c01b5af4`, the copy's published history revision is `4b55bf3a-2868-45e7-ad74-6eaa621ed117`, and the promotion is `060cdf5b-e2b6-43f2-97a9-35b3162885b6`. Fresh JSON snapshots are held outside Git. The copy's history export still carries its draft wrapper version ID; its 16 operational nodes and connections match the draft after removing one sticky note.

The inspection confirmed the greeting, messages, shared sender and Telegram destination, primary `Sheet1`/inbound `CRM` identifiers, one blocked contact, two preferred campaign contacts, and the existing Toronto schedule. Today's saved original reply execution 3621 and promotion execution 3619 show Twilio `queued` under the same account, not handset delivery. The original execution read 761 primary-sheet rows; a full migration snapshot of both Sheets must still be taken immediately before cutover. Do not infer recipient eligibility from that row count.

`Google Sheets account 2` is connected through n8n-managed OAuth2. Its managed authorization is not a portable app credential; Luster needs its own authorized Sheets grant. Dedicated provider credentials, live Twilio number routing and Event Streams verification, guarded schema/source delivery, handset/callback testing, live Sheets/Telegram outcomes and cancellation remain pending. No workflow was executed, retried, edited, disabled or published during this inspection, and development sends no real customer messages.
