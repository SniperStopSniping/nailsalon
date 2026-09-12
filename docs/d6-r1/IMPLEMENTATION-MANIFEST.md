# D6-R1 implementation manifest — recorded before code edits

Authority: Owner ratified R0-v2 and authorized local R1 only on 2026-09-12.
Specification SHA256 c38ea39fe4bc9f3fb449f5db8ec5c191d23def73ca1e2010d6d3dae4c7463f50.
Gate map SHA256 c2950b2b6ba30558bf142a9e54e9e367d30b24b29790bfeaace05d3762636173.
Review record SHA256 13c90e6c034b133c17902006d04eb90af221b84e6b31185075ebc43a22680df9.
Independent READY review: local thread 01a09684-2048-7f80-8699-629baf3c509d.
Base: 1a5cc8403ab17f79646f95dc967d450a3ff2f871 (origin/main fetched).
Review base c0dcda9df61a72100e4efc24ea3eb6a2b3379615 differs only in release metadata (1.95.1).
Branch: agent/d6-r1-inactive-20260912.
Worktree: /Users/me/nailsalon-worktrees/d6-r1-inactive-20260912.

## Data and ownership

- Add migration 0076 (current main journal ends 0075); preserve all existing SQL.
- `deposit_shadow_state`: trusted tenant/deposit/appointment/original account/mode/PI identity, learned charge identity, fixed legacy financial owner, generation/version, complete observation certificate, due/lease/fence/class and progress. No financial projection is consumed by existing code.
- `deposit_shadow_receipt`: immutable minimized signed event identity/snapshot; independent shadow progress. No FK to legacy event rows; legacy processing and retention cannot erase it. Deficiencies remain enumerable. No raw payload or customer metadata.
- `deposit_shadow_command` / `deposit_shadow_attempt`: immutable evidence of known legacy command/key/request shape, nullable historical unknowns, never executable. No creator or dispatch transition is supplied in R1.
- `deposit_shadow_object`: provider namespace identity and current accepted normalized refund/collection/dispute evidence, with tenant/payment binding. Refund IDs are distinct; no max-partial summary.
- `deposit_shadow_observation`: append-only cycle/receipt provenance, full accepted normalized evidence, reason and version. Mandatory evidence and state progress commit atomically.
- No new foreign key/cascade from live salon/appointment/deposit deletion to evidence. Runtime appointment-first validation plus internal composite identity constraints protect linkage. Evidence remains diagnostic if its live row is later removed; R1 does not change purge decisions. R3/R5 own protection/retention policy before activation.

## Events and consumers

Signed route captures before legacy claim/dispatch; capture failure cannot acknowledge acceptance. Existing account, Checkout and synthetic handling remains unchanged.
Refund families: refund.created, refund.updated, refund.failed, charge.refund.updated; unsupported refund.* remains deficient/refreshable.
Charge discovery: charge.refunded. Dispute refresh: charge.dispute.created, updated, closed, funds_withdrawn, funds_reinstated; unknown charge.dispute.* remains deficient/refreshable.
Refund error/failure evidence charge_for_pending_refund_disputed, charge_disputed, refund_disputed_payment schedules original collection/dispute refresh, as does every refund receipt.
Legacy owns stripe_webhook_event status/attempts and existing money effects. Shadow owns only deposit_shadow_* progress. Neither acknowledges the other. Immutable receipts survive legacy projection/raw-payload retention.
No hosted scheduler/configuration/activation is added. Explicit local worker entry points perform receipt replay, cohort enrollment, fair claim and observation. Diagnostics expose bounded pages and aggregate counts, ages and progress.

## Protocol and file responsibility

Implement focused modules under src/libs/deposits/shadow*, typed model support under src/models, signed route capture hook, additive journal/migration, focused tests and reproducible local evidence scripts/docs. Existing money modules remain unchanged.
Enrollment resolves existing deposit and exact original-account binding; unknown identity stays deficient. Provider reads run outside depositsTransaction. Claim filters due/leases before limits and rotates tenants/accounts/classes using persisted due times and fair shares. Finalization locks appointment, deposit, then shadow state; compares full legacy row fingerprint, financial owner/version, generation, fence, lease, original binding and cycle deadline. New dirty receipts invalidate the certificate atomically. All pages and known refund identities participate; incomplete/contradictory/unsupported/dispute-ambiguous observations cannot certify. Complete unchanged observations advance due time; failures back off while preserving unresolved age. Evidence corrections append observations; no historical success or dispute principal is invented.

## Acceptance and stop

Run R1 T01–03, T05/T09/T10 data/observation legs, T17–18/T20–21/T25; real guarded disposable PostgreSQL races, signed real routes, scripted provider, discriminating mutants with restored re-green. Run named legacy deposit/refund/calendar concurrency suites, applicable full tests, appointment regression, types, lint, build, secrets and assess mobile gate. Record actual failures/skips. Independent final diff review followed by local commit only. No push, merge, deployment, activation, Stripe account access, shared database access, R2 execution, R3 booking/tender changes or R4 workflows.

## Final implementation refinements

The initial manifest above is preserved. Finalization/capture/replay first acquire a transaction-scoped account+mode evidence advisory lock, then the existing appointment/deposit lock order, then shadow rows, followed by the original account-binding row under `FOR SHARE` during finalization. This closes the first-charge/charge-only receipt race without adding locks to legacy financial processing. Finalization checks receipts even when deferred replay is not yet due. Stale results append diagnostic observations but cannot replace current facts/certificates.

A durable cycle cursor stores completed pages, exact request provenance, generation/fingerprint, and listing discrepancies. Each claim has a four-page/read allowance and a shared deadline. Resumption rechecks the original collection; exact retrieval cannot erase a listing discrepancy. All known refund/dispute identities must remain represented. Principal debit/reimbursement/restoration and fees stay separate nullable fields; a closed dispute never invents reimbursement. Any unresolved dispute blocks a certificate.

Fair selection filters eligibility before limits, then rotates tenant/account/mode/class cohorts using persisted last-claim service history over all rows. Finalization preserves that class history and advances due time, including unchanged or blocked observations. Tests cover a continuously replenished noisy backlog as well as finite cohorts across batches. This is simulated bounded-progress evidence, not a hosted capacity claim.

The pinned Stripe Refund DTO has no `livemode` field. The adapter uses the original connected-account request plus the cycle's verified PI/charge mode; any contradictory returned mode is rejected. Raw SDK DTO projection is separately tested. Provider code contains retrieve/list only; no hosted worker or scheduler invokes it. The signed webhook capture hook is the sole application integration and writes only independent evidence.

### Final file ownership

- Data: `migrations/0076_deposit_shadow_evidence.sql`, journal entry, `src/models/depositShadowSchema.ts`, model re-export.
- Evidence/protocol: `shadowProjection.ts`, `shadowProgress.ts`, `shadowStore.ts`, `shadowObserver.ts` under `src/libs/deposits/`.
- Receipt integration: `src/app/api/webhooks/stripe-connect/route.ts` (post-signature, pre-legacy-claim hook only).
- Acceptance: `shadow.concurrency.integration.test.ts`, `shadowObserver.test.ts`, `shadowAuthorityRoutes.test.ts`, `scripts/d6-r1-mutations.mjs`, this directory.
- Exact compatibility pins: CI migration allowlist/required PostgreSQL suites, hold-writer boundary allowlist, D6.1 journal census, preview fixture ledger count/tag and its test. No preview service was called.

Migration 0076 is additive, has no provider calls or live-row backfill, and keeps historical unknowns null. All six tables retain evidence independently of legacy event cleanup/live-row deletion. Internal composite constraints and immutability triggers protect identity and provenance. Evidence retention policy and compatible integrated rollback remain R5 prerequisites; this implementation does not alter existing purge eligibility.

Private diagnostics also expose original recorded amount/currency with source (`accepted_collection`, `legacy_deposit`, or unknown), currency-separated totals, and implementation-reviewer ownership with an evidence-inspection-only next step. These are diagnostic principal amounts, never outstanding obligation/refundable/creditable balances. Signed receipt amounts are explicitly unverified principal. Missing retained evidence stays null; scoped joins and pagination do not hide aggregate counts. Existing CAD-only principal constraints remain intact.

A final origin/main fetch on 2026-09-12 found 58c49c98201a7de67181db4b146cc5a2e393f324 (booking palette continuity, PR 185) after the implementation base. Its 34 changed files are booking presentation/browser evidence only; no payment, migration, CI or R1 file overlaps. This local branch remains based on the verified latest main at start, 1a5cc840. Migration 0076 remains unallocated on that refreshed main. No unrelated booking-theme changes were imported into this R1 delivery.

Final regression maintenance: the public manage-link integration fixture used September 2026 appointment dates and its retry case expired at 18:00UTC during this task. The same timeout was reproduced on unchanged base 1a5cc840. Only that test helper’s year moves to 2099, preserving the intended future-appointment prerequisite, all assertions, provider barrier and timeout. No production booking/email/R3 behavior changed. The real-route authority matrix was independently reviewed after correcting staff and impersonation fixtures.

A second regression-only correction wraps the existing reminder-banner disappearance assertion in `waitFor`: observing request dispatch did not guarantee response handling/React state had completed. The expected result, request assertions, timeout and production `UpcomingAppointmentActions` component remain unchanged. This fixes acceptance-test sequencing rather than adding R3/R4 behavior.
