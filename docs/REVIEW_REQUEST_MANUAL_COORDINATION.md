# Manual Google review compatibility

Client profiles and the Marketing composer already offered a Google review preset without requiring a completed appointment. This capability is retained. The explicit preset now identifies its purpose to the existing client-message endpoint and enters the review coordinator; arbitrary free-text messages are never classified by their contents.

## Preserved behavior

- Owners can edit the preset text. The durable intent retains that exact authored text, and final dispatch checks use it rather than replacing it with the current salon template.
- Client-targeted review presets do not attach the client's incidental upcoming appointment. Appointment-specific Request review remains its own existing workflow.
- The existing SMS intent/dispatcher, quiet hours, sender readiness, credits, consent, STOP and unknown-outcome rules remain authoritative. There is no new provider call, email fallback, AI-specific rule or booking/reminder/payment path.
- The existing request-ID namespace handles lost-response retries. Purpose, client lineage and message must match; a late insert collision rolls back instead of linking to another action.

## Shared review history

All explicit Google-review producers now share the salon review fence and client-lineage/normalized-recipient history checks. A pending manual client request prevents a duplicate automatic request, and pending automatic work prevents a second client-targeted manual request. Final dispatch revalidates current eligibility and the shared history.

Migration 0083 permits only the additional manual, appointmentless, triggerless, null-completion record shape. It invents no completion timestamp and retains the lifetime uniqueness indexes. Null appointment IDs do not count as the same appointment for repeat cooldown calculations.

Owner-recorded Google sends in the retention endpoint join the same fence before locking the client. A first marked-send record captures its normalized recipient and cancels provably unsent work. Replaying that record preserves its original recipient and time and does not cancel later work. Historical missing destinations are not fabricated. Recording an actual send remains possible even when it reveals a cooldown conflict.

The legacy appointment follow-up endpoint still only prepares text/records an action; its timestamp is not send or delivery evidence. Its already-reviewed action now reconciles unsent review requests. An explicitly cleared review URL stays cleared, without falling back to the old salon field.

## Release gate

This slice prepares coordinated writers. It does not authorize retiring lifetime indexes or activating finite-repeat behavior. Index retirement requires a separately reviewed migration, true PostgreSQL race evidence and the environment-specific migration gate. Migration 0083 must precede deployment of the appointmentless producer. No production schema, provider, salon configuration or customer messages were changed while developing this slice.
