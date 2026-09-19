# Review request automation settings

The canonical owner destination is Marketing & Messages → Reviews → Review Requests. The existing settings API and legacy navigation aliases remain compatible. This change supplies the policy editor; the navigation PR supplies its canonical entry point.

## Owner choices

- Manual only.
- Automatically after marked Completed.
- Automatically after scheduled appointment end. The editor explains that the owner must mark cancellations and no-shows before the request sends.
- Recommended setup: scheduled appointment end, 60 minutes, 90-day repeat cooldown. The recommendation changes the draft; saving is explicit. Missing settings never prove that a salon is new.
- Delay choices: immediately, 30 minutes, 1 hour, 2 hours, 4 hours and 24 hours. An existing custom delay remains editable without coercion. Twenty-four hours is elapsed time, not next morning.
- Advanced repeat choices: 90, 180 or 365 days, or never request again. Existing lifetime deduplication is preserved until the owner chooses otherwise.
- Google review link, salon-customized message and preview remain available. SMS delivery retains existing eligibility, STOP, provider and credit checks. There is no new email fallback.

Readiness reports missing link, inactive business and disabled salon texting. A configured policy is not a delivery guarantee or proof of provider availability.

## Compatible writes

The API accepts either the original strict boolean payload or the new strict mode/cooldown payload. It resolves the salon through existing owner authorization and does not accept a body-supplied salon identity. Public responses expose settings, normalized policy and readiness, not internal salon records.

Legacy enable/disable preserves a configured scheduled-end mode. Enabling an explicitly manual policy through the old boolean contract selects completion-triggered automation and persists it. Repeated equivalent saves do not reset the activation epoch.

The canonical editor and both retention-setting writers share one in-transaction policy transition. They take the existing review fence before the salon lock. Clearing a review link cancels only provably unsent requests. Restoring a usable link while automation is active establishes a fresh activation epoch and revision, so old appointments are not backfilled. Mode changes do the same. Message, delay, cooldown and unrelated retention edits do not independently reset the epoch.

Cancellation locks each intent at the dispatcher's existing TX1 boundary. Sending, unknown outcomes, and contradictory provider evidence retain their reservations. No message is sent by a settings request.

## Verification and release dependencies

The focused suite covers persisted policy, both legacy link writers, activation epochs, provider-evidence preservation, selected-salon API authorization, cross-salon response races and mobile draft/save behavior. The mobile harness rejects external requests and uses synthetic API responses.

This is not activation authorization. The additive review schema and scheduled-end worker are prerequisites. Finite-repeat production behavior additionally requires the coordinated Google-review writers and reviewed lifetime-index retirement. Existing booking, reminder, payment and AI behavior remains authoritative. Apply schema changes only through the documented environment-specific migration gate; do not send test messages through a live provider.
