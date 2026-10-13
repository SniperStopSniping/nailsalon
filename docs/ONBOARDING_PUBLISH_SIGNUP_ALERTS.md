# Onboarding publication and signup alerts

The final founding-offer action reads **Publish my website & open dashboard**. It saves the existing lifetime claim, publishes through the existing owner-authorized endpoint, then redirects to the dashboard with the verified saved-site handoff. A failed publish keeps the same saved site and retry key. The button explains that the website becomes public. Opening the offer or signing in alone does not publish anything.

The first successful salon setup for a new owner queues an email to **support@lustergel.app** in the same database transaction as business creation. It includes the salon name, owner name/email, signup timestamp and authenticated workspace link. It contains no credentials. Replays and further salons for the same owner do not generate another signup email.

The existing integration outbox and Resend transport deliver the notification. Production is required: Preview, local and test jobs are cancelled without emailing the production inbox. The provider idempotency key is stable, and retries stop before Resend's deduplication window expires. Exhaustion is recorded and reported to monitoring rather than sending a misleading client-email failure notice to the salon owner.

## Deployment

No migration, new provider, subscription, pricing or environment variable is introduced. Existing production Resend configuration and the ordinary outbox worker must be healthy. Only future successful new-owner setups enqueue these alerts; there is no historical notification backfill.

## Verification

Targeted tests cover publish retry preservation, normal publication authorization/idempotency, first-owner queue deduplication, recipient/salon validation, escaping, transient email failures, retry expiry and non-production suppression. Mobile visual verification uses the real offer component in an isolated fixture; it is not a physical-device or live-provider claim.

After the protected-main release, verify an owner publication through the real app, then verify a subsequent genuine signup notification against the outbox/provider and support inbox. The pre-existing test account does not retroactively create an alert. Free-text eligibility and provider verification are unchanged; the owner has waived requesting another unused phone number for acceptance.
