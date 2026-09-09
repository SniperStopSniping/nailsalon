# Luster SMS pilot checklist

Preparation only. No recipient is approved, no pilot has run, and this checklist does not authorize configuration changes, deployment, credits, or sends. Follow the [SMS runbook](TWILIO_COMMUNICATIONS_RUNBOOK.md) for the implementation and Console settings.

## Current blockers

**Identity correction:** the user disputes the earlier `isla-nail-studio` selection. Do not apply its balances or preferences to Daniela until the saved business matches her reference: 880 Ellesmere Road, inside TB Nails Unit 2; Monday–Friday 10:00–19:00, Saturday 11:00–17:00, Sunday closed. The other accessible same-named workspace is `isla-nail-studios`. The previously quoted 21:00–09:00 window was SMS quiet hours, not business hours. The earlier selection claim below is superseded.

**Business-model correction:** new eligible businesses now receive the existing one-time, non-expiring 100-credit grant during authenticated initial setup. Existing businesses are not silently backfilled. Salon-owned Twilio onboarding and sending are permanently retired in the follow-up repair, including with stale enable flags; historical records remain intact. These changes require fresh release checks after the green `9304885` baseline. No production grant or send has occurred.

- Reviewed repair commit: `b64802b`; PostgreSQL fixture follow-up: `1e631bb`. All GitHub CI passed at `623b0de` in [PR #170](https://github.com/SniperStopSniping/nailsalon/pull/170). Built Preview `34b1101` is READY and serves the app, with matching Clerk Development and Stripe Test-mode pairs scoped only to this branch. The approved guarded Preview update passed: its attested database now has 76 migrations through exact `0075`, and schema readiness passes. No SMS migration was added. Overall Preview health is still degraded by existing unconfigured password-auth/Redis/email/Calendar checks; do not enable retired auth or real senders merely to clear that aggregate. Full authenticated disposable owner verification remains outstanding. Latest inspected production commit remains `71f70ca`, health ready. Production release requires separate approval before repaired production behavior can be tested.
- No test recipient has been selected or approved. Keep phone numbers, credentials and message bodies out of this document.
- Use an **isolated disposable salon containing only approved test contacts**, with no customer appointments or copied customer data. `SMS_PILOT_SALON_ALLOWLIST` restricts salons, not recipients. Do not allowlist or activate Daniela's real salon or any existing customer queue for this pilot; verify salon identity through authorized owner access.
- Earlier inspection of the disputed `isla-nail-studio` workspace showed SMS off/unavailable, email on, a 24-hour reminder, quiet hours 21:00–09:00 and `America/Toronto`; owner SMS alerts were off with a missing phone. The September 9 01:23:40 UTC read-only query confirmed zero available/reserved credits, zero pending/due/blocked/in-flight/unknown SMS intents and no BYO rows **for that workspace only**. The platform SMS switch was off and a separate global count found zero active BYO connections. The 30-day SMS history result was truncated, so do not certify that no messages exist. Reconfirm Daniela's intended salon and its saved state; no production data, credit or setting was changed.
- Production health reported working database/Redis connections and a configured cron secret. These checks do not prove repaired code, signed callbacks or carrier delivery. Twilio's account dollar balance is separate from Luster SMS credits.
- The Canadian number ending 9444 is now the sole sender in **Luster appointment texts**, with the service inbound POST pointing to Luster; Canada geographic permission is enabled. Approved old n8n SMS subscriptions were removed and the direct n8n SMS webhook cleared at **2026-09-08 22:04:09 UTC**. Voice, all n8n workflows and the active different-account number ending 9891 remain untouched. Verify no old SMS forwarding has been recreated before the pilot. Allow for the prior-event retry horizon through **2026-09-09 02:04:09 UTC**; no backlog flush or carrier delivery has been tested.
- STOP/START/HELP wording is saved and **Advanced Opt-Out is enabled with explicit user approval**, verified after a Console reload on 2026-09-08 at 22:12:54 UTC. Provider configuration does not substitute for deploying and verifying the repaired application, or for actual approved-device keyword/callback tests.

## Readiness and future activation order

Perform these steps only after their required authorization; stop at an unmet gate.

1. Keep `COMMUNICATIONS_SMS_ENABLED` and `platform_communication_control.smsEnabled` off during setup. Verify actual values through authorized operator access; do not infer the platform value from an environment flag.
2. Release the reviewed repair with sending still disabled and verify the expected deployed SHA. Use a dedicated pilot environment/salon; do not import production customers or point automated tests at production or shared development databases.
3. Verify the shared account/token, `TWILIO_MESSAGING_SERVICE_SID`, SMS-capable sender pool, approved recipient and provider restrictions. Resolve the existing inbound dependency, then configure the pilot origin's `/api/integrations/twilio/inbound` POST webhook. Obtain explicit approval before enabling Advanced Opt-Out because disabling it requires Twilio Support. Luster supplies each delivery-specific status-callback URL itself; leave the service's generic status callback blank.
4. Verify `NEXT_PUBLIC_APP_URL`, an explicit environment-correct `LUSTER_SHORT_LINK_ORIGIN`, stable `LUSTER_SMS_SENDER_IDENTITY`, Redis and cron configuration. Verify the short link and public HTTPS webhook routes resolve to the pilot release. Never expose credentials or repurpose a salon custom domain for the shared short-link origin.
5. Set `SMS_PILOT_ENABLED=true` and `SMS_PILOT_SALON_ALLOWLIST` to only the approved disposable salon slug. The repaired release permanently retires salon-owned Twilio onboarding and sending. Historical connections stay blocked without silently changing their sender or consent identity.
6. Through existing controls, configure the disposable salon's SMS master, event preferences, timezone, quiet hours, owner/technician notification preferences and reminder rules. Add only legitimate, explicitly authorized pilot credits. Verify consent and the exact client/appointment ownership. Confirm every sendable contact belongs to an approved participant and there is no unrelated queued work.
7. Record starting available/reserved credits and queue counts. Obtain explicit approval for the recipient and bounded pilot sends. Enable the environment switch only when ready; **enable platform control last**, for the isolated approved pilot.
8. Execute the checks below. After collecting evidence, disable the pilot's sending controls and inspect remaining queued work before removing any fixture. Keep Daniela's customer rollout separately gated.

The dispatcher runs every five minutes and reminder reconciliation every fifteen minutes; quiet hours can defer messages further. Choose future appointments with enough lead time for the configured rule and worker intervals. Do not force a stale reminder or bypass quiet hours to make a check pass.

## Twelve required outcomes

All checks remain open. Use synthetic appointment details and only approved test participants.

| Done | Outcome | Required evidence |
| --- | --- | --- |
| [ ] | 1. Manual SMS | Send from the real client/appointment workflow; one queued intent uses the salon identity and current canonical client. Observe provider acceptance and receipt on the approved device. |
| [ ] | 2. Delivery callback | The authentic signed callback updates the same delivery to delivered, failed or undelivered. Repeated/out-of-order evidence cannot regress state or create another send. |
| [ ] | 3. Customer booking/request SMS | Verify instant booking is confirmed and explicit approval mode stays pending. SMS wording, owner appointment state, customer manage page and calendar invitation agree. |
| [ ] | 4. Owner confirmation SMS | Approve the pending request in the owner UI; the customer receives the confirmed message. Also verify the new-booking owner alert follows its saved preference and approved owner contact. |
| [ ] | 5. Reminder | Verify the intended salon-local time, lead window and current phone. Observe one reminder; a quiet-hours case defers within a useful pre-appointment window. Unapproved requests and terminal appointments receive none. |
| [ ] | 6. Reschedule | Move the appointment through Luster. The old reminder is canceled, the new revision has the correct reminder, and the change notice uses the new time. |
| [ ] | 7. Cancellation | Cancel through Luster. One appropriate cancellation event appears and no reminder survives or sends afterward. |
| [ ] | 8. STOP | Send STOP from the approved device. Record signed, correctly scoped opt-out evidence; further SMS is suppressed. The appointment itself remains unchanged. |
| [ ] | 9. START | Send START from the same device. Record restored consent for the intended identity; a separately approved new action can send. Do not resurrect previously suppressed messages. |
| [ ] | 10. Credit accounting | Compare starting/ending available and reserved Luster credits with actual segments. A hold settles once; a verified failed/undelivered case refunds once. Duplicate callbacks do not duplicate debit/refund. Unknown outcomes retain evidence and are not blindly retried. |
| [ ] | 11. No duplicate sends | Repeat the same action/request key and allow normal worker retries. Confirm one intent, one delivery and one accepted provider message for that action. Explicit **Send again** creates a new action only after confirmation; its network retry reuses its key. |
| [ ] | 12. Communication history/status | Client and appointment history agree on queued/sent/delivered/failure/canceled state and offer recovery only when safe. Verify the full booking → approval → manual text → reminder → reschedule → cancellation sequence. |

## Evidence and stop conditions

- In protected operational records, capture release SHA, disposable salon/appointment IDs, event type, intent/delivery IDs, request identity, provider message ID, timestamps, status/error code, segment count and credit deltas. Reference those records here without copying recipient numbers or message bodies.
- Verify another salon is excluded and cannot read or send through the pilot's client/appointment. Check missing/invalid contact and disabled-configuration responses without targeting a customer. Use existing isolated tests for deliberately invalid signatures, callback replay and induced failures; do not fabricate live provider outcomes or disrupt production to manufacture a failure.
- Stop sending on a wrong recipient/tenant, unexpected queued work, duplicate provider acceptance, unexplained credit change, stale reminder, unverifiable callback or unknown outcome. Pause delivery, preserve evidence and investigate; never reset an uncertain intent to pending without proof of non-send.
- Passing prior mocked/PGlite/component/concurrency tests is supporting evidence. It does not check off this live pilot, the full authenticated owner journey, or Daniela's customer rollout.
