# AI Business Setup: foundation checkpoint

Status: **incomplete development pilot; do not enable for customers or merge as the essential release.**

Started from `origin/main` at `650ffa917ba9844c4c29db665e721d0d6f755542` in the isolated `codex/ai-business-setup` worktree. The original checkout and its untracked work were preserved. Since the planning snapshot, the relevant main change was onboarding header/recovery positioning; no competing builder implementation was found.

## Working locally

- An authorized salon owner can save business details, address privacy, solo/team choice, hours, currency, time zone, booking notice/buffer, services, prices, durations, and a supported visual direction in a private draft.
- The assistant adapter uses the existing OpenAI Responses integration. Structured, validated operations update the same draft as manual controls. Deterministic tests cover multi-action messages, duplicate requests, scope restrictions, invalid output and forbidden approval actions. **No real-provider trial has run.**
- Production website components render the proposed catalog. Booking preview identities cannot resolve into actual services. Server CSP blocks scripts/forms. A collapsed details panel explains proposed booking rules and simulated availability computed by the original availability engine; customer appointments, time off and external calendars are explicitly excluded from that illustration.
- Review is deterministic and approval binds the owner, exact revision, baseline fingerprint and document. Canonical service/location/staff/configuration writes and the publication receipt commit together. The draft cannot independently publish through the old website lifecycle.
- New solo publication creates one canonical technician with the approved weekly schedule and service assignments. It creates no appointments or customer communications.
- The original public booking flow reads those canonical records. An actual local customer booking returned HTTP 201 and persisted the approved $65 / 60-minute appointment. A later approved $70 service change kept the existing appointment at $65.
- The existing website configuration/content and cover editors participate in the shared draft while it is active. Unrelated canonical changes invalidate its baseline instead of being overwritten. A later editing session reloads current canonical service IDs/settings.
- Turning off AI preserves existing setups' manual controls. Publication has a separate kill switch. Ordinary published sites and booking routes do not depend on the AI provider.

## Verification evidence

All accounts, appointments and credentials used here are synthetic. PostgreSQL is task-owned on loopback port 55432; the browser app uses the separately marked `luster_ai_setup_development` database. SMS/email/payment/calendar provider credentials are absent or synthetic; no hosted preview or production operations ran.

Commands:

```sh
npx vitest run src/features/business-setup/drafts.integration.test.ts src/app/api/admin/business-setup/route.test.ts src/libs/bookingPageLifecycle.test.ts src/app/api/admin/booking-page/route.test.ts src/app/api/admin/salon/publish/route.test.ts src/app/api/admin/booking-page/cover/route.test.ts

# Only with the existing disposable-target guard and live server attestation:
LUSTER_DISPOSABLE_DATABASE=true CONCURRENCY_TEST_DATABASE_URL='<attested disposable loopback URL>' npx vitest run --no-file-parallelism src/features/business-setup/publication.concurrency.integration.test.ts

# Requires this task's local synthetic Development fixture/app; no remote fallback:
E2E_BASE_URL=http://localhost:3197 E2E_SALON_SLUG=setup-synthetic-studio npx playwright test --config tests/browser/businessSetup/playwright.config.ts
```

Observed: 87 unit/integration/route tests passed, three PostgreSQL concurrency tests passed, four desktop/mobile browser cases passed. The strengthened publication case also passed on both sizes with a deliberately dropped post-commit HTTP response, exact-request replay, rejection of preview service IDs, an original customer booking, and preservation of historical appointment totals after a later price publication. The optimized Next.js build (including type validation), scoped source lint and secret scan passed. The browser-test file retains three nonblocking control-flow lint warnings.

Screenshots:

- [Editable business draft](../../artifacts/business-setup/checkpoint-1/editable-setup.png)
- [Working website preview](../../artifacts/business-setup/checkpoint-1/working-draft.png)
- [Exact review](../../artifacts/business-setup/checkpoint-1/exact-review.png)
- [Published result](../../artifacts/business-setup/checkpoint-1/published.png)
- [Original booking review](../../artifacts/business-setup/checkpoint-1/original-booking-review.png)
- [Confirmed original booking](../../artifacts/business-setup/checkpoint-1/original-booking-confirmed.png)
- [Phone preview](../../artifacts/business-setup/checkpoint-1/mobile-draft.png)
- [Phone booking confirmation](../../artifacts/business-setup/checkpoint-1/mobile-booking-confirmed.png)

The conversation tests inject a scripted provider at the internal provider boundary. Browser tests use the real local application and database; they do not fake publication or appointment success. The complete real-AI checkpoint is **not** verified. An isolated provider-key configuration location and an authorized trial spending limit are still needed. Do not reuse production credentials to fill that gap.

The existing adapter/model supports Responses and structured output according to [OpenAI's GPT-5.4 mini documentation](https://developers.openai.com/api/docs/models/gpt-5.4-mini), checked October 14, 2026. The recorded cost calculation uses published standard token rates ($0.75 input, $0.075 cached input, $4.50 output per million tokens). It is a cost estimate from token usage, not a measured invoice or an approved trial spend. Actual real-provider usage to date: **no calls**.

## Essential work still outstanding

This is a delivery record, not a replacement implementation plan. Continue the approved direction with these release gates still open:

1. New-owner authentication/bootstrap and replacement of the onboarding card; persistent entry links for existing salons.
2. Real-provider evaluation, conservative total-context cost admission, recoverable jobs/cancellation, accurate generated-change summaries and full value provenance.
3. Private menu/document/image uploads, extraction/review, inspiration/reference handling, asset ownership/promotion/cleanup and the complete design experience. Pending onboarding media is deliberately **not** promoted by this foundation's publisher because its identities have not been incorporated into the approved draft.
4. Team/staff authoring and assignment review, advanced service/add-on cases, supported policy/deposit/reminder prerequisites and truthful previews for those settings. Initial publication supports a new solo business; existing business-hours changes currently fail closed pending appointment-impact review.
5. Stale-baseline reconciliation, history/undo/restoration and complete manual-editor interaction regression coverage. Current stale conflicts are detected but not merged automatically. Multiple locations/custom presentations require explicit preservation/switch behavior before enrollment.
6. Retention/deletion, broader authorization/security/concurrency/operational tests, telemetry and CI wiring, isolated real-provider cost measurements, and a production-ready rollout/rollback runbook.

Migration `0098_business_setup_drafts.sql` is additive and must be applied to an isolated target before this code runs there. No production migration was applied. Flags remain false in the checked-in example and enrollment requires explicit salon IDs. The existing booking/public renderer has no AI runtime dependency.

Hosted delivery was withheld: read-only Vercel metadata showed a connected project and Preview configuration but did not establish isolation of all database/credentials/jobs/integrations for this branch. Do not trigger an automatic Git preview until that isolation is verified. No merge or deployment is authorized by this checkpoint.
