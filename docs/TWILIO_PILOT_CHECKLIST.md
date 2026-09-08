# Luster SMS pilot checklist

Preparation only. No recipient is approved, no pilot has run, and this checklist does not authorize configuration changes, deployment, credits, or sends. Follow the [SMS runbook](TWILIO_COMMUNICATIONS_RUNBOOK.md) for the implementation and Console settings.

## Current blockers

- Reviewed repair commit: `b64802b`. Latest inspected production commit: `71f70ca`. Release the reviewed repair through the existing approved deployment process before testing the repaired behavior.
- No test recipient has been selected or approved. Keep phone numbers, credentials and message bodies out of this document.
- Use an **isolated disposable salon containing only approved test contacts**, with no customer appointments or copied customer data. `SMS_PILOT_SALON_ALLOWLIST` restricts salons, not recipients. Do not allowlist or activate Daniela's real salon or any existing customer queue for this pilot; verify salon identity through authorized owner access.
- Daniela's saved communications preferences, reminder rules, platform control, sender connection, available/reserved Luster credits and queued-message counts remain **unverified**. No production SQL was executed; Vercel intentionally redacts its sensitive database credential.
- Production health reported working database/Redis connections and a configured cron secret. These checks do not prove repaired code, signed callbacks or carrier delivery. Twilio's account dollar balance is separate from Luster SMS credits.
- Complete shared Messaging Service/sender-pool configuration and verify account identity and destination eligibility. The inspected number's existing inbound route points to n8n; resolve that dependency before an authorized webhook cutover. Do not silently replace it.

## Readiness and future activation order

Perform these steps only after their required authorization; stop at an unmet gate.

1. Keep `COMMUNICATIONS_SMS_ENABLED` and `platform_communication_control.smsEnabled` off during setup. Verify actual values through authorized operator access; do not infer the platform value from an environment flag.
2. Release the reviewed repair with sending still disabled and verify the expected deployed SHA. Use a dedicated pilot environment/salon; do not import production customers or point automated tests at production or shared development databases.
3. Verify the shared account/token, `TWILIO_MESSAGING_SERVICE_SID`, SMS-capable sender pool, approved recipient and provider restrictions. Resolve the existing inbound dependency, then configure the pilot origin's `/api/integrations/twilio/inbound` POST webhook. Obtain explicit approval before enabling Advanced Opt-Out because disabling it requires Twilio Support. Luster supplies each delivery-specific status-callback URL itself; leave the service's generic status callback blank.
4. Verify `NEXT_PUBLIC_APP_URL`, an explicit environment-correct `LUSTER_SHORT_LINK_ORIGIN`, stable `LUSTER_SMS_SENDER_IDENTITY`, Redis and cron configuration. Verify the short link and public HTTPS webhook routes resolve to the pilot release. Never expose credentials or repurpose a salon custom domain for the shared short-link origin.
5. Set `SMS_PILOT_ENABLED=true` and `SMS_PILOT_SALON_ALLOWLIST` to only the approved disposable salon slug. Keep new BYO onboarding disabled. The shared allowlist does not constrain existing BYO senders; exclude them from this pilot.
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
