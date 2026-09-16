# Billing completion repair — 2026-09-15

## Scope and authorization

Owner-authorized bounded code/readiness repairs, focused tests, disposable PostgreSQL,
independent payment-safety review, exact-head CI and normal green merge. Billing stays
dark. No Stripe/Vercel configuration, payments, secrets, switch activation, starter
grants, production migrations/data changes, or pilot execution.

## Refund invariant (§6.7)

A fully refunded invoice cannot fund future monthly grants or upgrade differences,
even after reconciliation, delayed paid events, replay, or concurrent processing.
Previously issued/consumed credits are not clawed back; purchased credits are unaffected.
A later disjoint paid renewal remains eligible. A late refund of an older invoice
must not erase that later coverage.

The repair stores invoice identity and half-open refunded period boundaries as ISO
strings in the existing transactional `billing_subscription_refund_applied` audit row.
It records the fact even if `paidThrough` was not advanced yet. All reads/writes use
the existing subscription row lock and scope facts by salon and subscription identity.
Payment projection rejects refunded coverage; both window grants and upgrade differences
exclude refunded intervals independently of the mutable `paidThrough` scalar. No schema
change is needed. These audit rows are financial state and must remain for the
subscription lifetime. Legacy/malformed refund facts fail closed pending review.

Refund events for an owned but not-yet-projected subscription remain retryable.
The parked refund-anomaly tests were copied into this repair; the original worktree
is preserved. Missing cumulative top-up refund evidence is held, never interpreted as zero.

## Delivery evidence

Refund repair local evidence: 144 focused tests across checkout/top-up, webhook,
subscription projection, reconciliation, and grants passed; eight real PostgreSQL 16
regressions passed against a private disposable loopback database. The new PG suite
is included in the existing CI financial concurrency job and accepts its guarded
loopback/disposable confirmation (it does not silently skip because of a local-only
DB name). Independent high-risk payment-safety review found no remaining static
blocker after malformed coverage, paid-period validation and terminal delayed-event
handling were repaired.

Broad local validation encountered resource failures: the full Vitest process
exhausted its heap (including timing failures during contention), and the Next build
reported ENOSPC. These runs are not counted as passes. Required exact-head CI,
including full-suite shards and both Node builds, remains the delivery gate. The
focused top-up suite was rerun cleanly after resource recovery. Immutable PR/CI
evidence is authoritative.

Refund repair [PR #224](https://github.com/SniperStopSniping/nailsalon/pull/224)
merged as `fd1058c1c4e8e9f30e39be05e090e64250df9bd5` after exact-head CI
`35016462439` passed every gate. Its SMS-credit PostgreSQL job ran all eight
refund regressions as part of 20 passing tests with zero skips. This supersedes
the pending delivery gate above; it does not establish a pilot pass.

The follow-on readiness repair separates dark deployment from pre-activation
configuration evidence. Missing/malformed credentials, incomplete carriers,
wrong-mode/disabled/wrong-target endpoints, and failed requested health checks
cannot yield activation readiness. Supplying the correct dedicated webhook
secret makes billing non-dark without incorrectly failing pre-activation evidence.
49 focused readiness tests pass locally, including CLI output and safe diagnostics.
The original Preview tooling remains parked; only its useful protected-health
access pattern was salvaged. Provider resource authenticity, account ownership,
catalogue amounts, portal settings, and legacy isolation are still manual rehearsal
prerequisites; this offline checker does not prove them or authorize activation.

## Open decisions and rehearsal gates

- D19c: explicitly amend §5/§8.1's byte-identical legacy webhook restriction to permit
  ignoring new-track checkout sessions **and subscription/invoice lifecycle events**,
  preserving legacy processing and keeping endpoint deduplication separate. The current
  conditional instruction does not ratify that amendment. P9 boilerplate deletion is
  separate and unnecessary for this fix.
- D10: anti-abuse retention/deletion policy; separate from retaining financial refund facts.
- D11: seven publication approvals remain outstanding; public pricing/tax/promotion stay off.
- P8b operations panel remains optional.
- Before any rehearsal: reviewed code SHA, passing required CI/review, explicit Preview-only
  authorization, isolated Preview DB/Clerk test owner, exact Stripe test catalogue and
  portal configuration, webhook legacy isolation and event selection, branch-scoped
  configuration, positive readiness evidence, and manually verified scheduler execution
  on Preview. Never infer deployed cron execution from entries in `vercel.json` alone.
- Rehearsal evidence must cover duplicate checkout, refund/reconcile/grant ordering,
  one-time starter grant, top-up history, subscription cycle, tenant isolation, clean
  integrity/drift reports, and the deployed SHA. None has been executed by this repair.

## PR-1 (refund completion) — 2026-09-15

At the merge of [#224](https://github.com/SniperStopSniping/nailsalon/pull/224), HANDOFF §3.3 items 1
and 3–10 plus the new N1 proration veto were still outstanding. PR-1 closes them:

- **R-1** — a full refund whose invoice coverage cannot be derived now writes NOTHING and holds the
  event (`SUBSCRIPTION_REFUND_COVERAGE_UNKNOWN` / `SUBSCRIPTION_REFUND_PRORATION_ONLY`). The former
  null-bound `billing_subscription_refund_applied` row made every later evidence read `incomplete`,
  failing all future grants closed with no automated way back.
- **R-2** — refund evidence becomes CORRECTABLE without deleting anything: a second append-only
  action, `billing_subscription_refund_evidence_resolved`, records a `void` or an authoritative
  `set` for one invoice, and the highest `seq` across both actions is the effective state. Three
  writers use it — the webhook, the hourly reconcile safety net, and the new super-admin endpoint
  `/api/super-admin/billing/refund-evidence` (`plan`, then `apply` with a typed `invoiceId`).
  Per §8.3 the webhook decides from an AUTHORITATIVE re-fetch of the charge, never from the
  `charge.refunded` event body: that body is a snapshot at event time, and Stripe guarantees no
  delivery order, so an out-of-order partial body would otherwise void correct evidence (and a
  stale full body would assert a refund that no longer holds). The hourly safety net closes the
  same hazard at the commit boundary and runs in BOTH directions: it voids evidence Stripe no
  longer backs, and it RE-ASSERTS a machine `void` that Stripe now contradicts (a void committed
  from a stale read can land at a higher `seq` than the applied row it supersedes, and nothing
  else would ever correct it). A `super_admin` void is never re-asserted automatically — the
  reader reports each void with the actor type that wrote it precisely so an operator's decision
  stands.
- **R-3** — an unknown paid-period start is no longer defaulted to the epoch minimum (which made
  EVERY refund overlap and turned legitimate renewals into permanent holds); it is its own anomaly,
  `PAID_PERIOD_START_UNKNOWN`.
- **R-4** — a parked downgrade applies through `applyPendingOfferAtRenewal`, so the reconcile repair
  no longer depends on the latest invoice's status or periods (Y7).
- **R-5** — invoice events are fenced by STATUS: a payment resumes service only from
  `past_due`/`unpaid`/`incomplete`, a failure only dunns `active`/`unpaid`/`trialing`, and neither
  ever writes the SUBSCRIPTION event watermark.
- **R-6** — one shared reading of invoice coverage (`invoiceLinePeriods.ts`): non-proration
  subscription lines only, paged when `has_more`, with `unknown` kept distinct from
  `no_subscription_lines` (`INVOICE_WITHOUT_LINE_PERIODS` vs `INVOICE_WITHOUT_SUBSCRIPTION_LINES`).
  A Stripe failure while paging PROPAGATES (retryable, bounded by the 8-attempt poison ladder)
  rather than collapsing into a terminal hold; `unknown` is reserved for structurally unreadable
  line sets, which no retry could change.
- **R-7** — the real-PostgreSQL refund suite proves its executed count with zero skips in CI.
- **R-8** — refund metadata is versioned (`evidenceVersion: 2`) with `seq`, `invoiceId`, `refundIds`
  and ISO bounds; the audit sanitizer serialises `Date` values instead of flattening them.

Owner decision **O2 is approved and implemented**: a charge whose cumulative `amount_refunded` falls
below its `amount` automatically voids the §6.7 exclusion recorded for its invoice, restores the
coverage through the ordinary payment transition, and alerts
(`Sentry.captureMessage('billing.subscription_refund_voided', ...)`) — written by the webhook when
the reversal is delivered and by the hourly reconcile regardless. The resulting partial refund
remains a human review item (§10).

Billing stays dark: no environment, switch, migration, Stripe or Vercel change.

Still outstanding for the pilot: PR-2 through PR-5 per the final implementation handoff, plus the
open decisions and rehearsal gates above.

## PR-4 (per-target readiness + reviewed Preview rehearsal tooling) — 2026-09-16

Base `origin/main` `6999d87d`. Two lanes, disjoint files, one PR. Billing stays dark: no environment,
switch, migration, Stripe or Vercel change, and nothing in this PR performs a provider-side action.

### Lane B — rehearsal tooling salvage and the rehearsal document

The local-only branch `agent/billing-preview-rehearsal-tooling` (6 commits, never pushed) is salvaged
**file by file**: only `scripts/billing-stripe-test-provision.ts`, `scripts/billing-preview-rehearsal-seed.ts`
and their two test files are taken. That branch's `scripts/billing-readiness-check.ts` changes are
deliberately **dropped** — main's copy is newer and merging the branch's would regress PR #225.

Every hard property the architecture review credited is preserved and still pinned by tests: the key source
is `STRIPE_TEST_SECRET_KEY` with an `sk_test_`/`rk_test_` gate; `BILLING_PLAN_ENV` must be exactly `test`;
every Stripe object is asserted `livemode === false`; there is no `child_process`, no `@/libs/DB` and no
Vercel SDK import (now pinned by a source-text test); dry run is the default; nothing is ever deleted or
archived; the carrier is written before the two steps that can refuse; `enabled_events` is exactly the 13
handled types. The seed keeps its dedicated connection variable, its typed `--expect-host`, the `preview`
marker re-checked **inside** the write transaction, a `READ ONLY` session for non-`--apply` modes,
`ON CONFLICT DO NOTHING`, and its refusal to create a super-admin.

The review's tooling gaps (HANDOFF §7 T1–T7, final handoff §6 row X8) are closed:

- **T1 (documentation, not code)** — the seed still refuses to create a super-admin. The real bootstrap
  mechanisms are documented in `docs/BILLING_PREVIEW_REHEARSAL.md` §5.1 exactly as they exist: the password
  login authenticates a **pre-existing** super-admin row and never creates one, and the only in-app creator
  is the `SUPER_ADMIN_BOOTSTRAP_PHONE` OTP path — which the rehearsal's `LEGACY_OTP_AUTH_ENABLED=false`
  closes. Both honest options are written down; neither is invented.
- **T2** — `--allow-host <hostname>` is required with any webhook url and must match it; the four known
  production hosts are refused outright, with no flag that unlocks them.
- **T3** — every OTHER test-mode endpoint on the account is listed at `--plan` and `--apply` (id, origin +
  path, event count, Connect flag, status); `--apply` refuses unless `--acknowledge-shared-account` is
  passed. A dedicated Sandbox (owner decision O5) lists none and needs no flag.
- **T4** — the tool prints the exact url it will register (bypass token masked) and the host it was allowed
  for, before any write, together with the branch-alias rule (the Vercel git-branch alias truncates at 14
  characters, so every `agent/billing-*` branch collides).
- **T5** — the bypass-token exposure inside the Stripe endpoint url, and the O6 options, are stated in the
  rehearsal document.
- **T6** — endpoint creation now requires `--create-webhook`. Without it `--apply` provisions the catalogue,
  coupon and portal, prints the staging sequence and stops, so the endpoint is never armed before its secret
  is staged.
- **T7** — `--print-webhook-secret` prints **before** `--webhook-secret-out` can refuse; a write refusal is
  only fatal when nothing else holds the value.

`docs/BILLING_PREVIEW_REHEARSAL.md` is new and mirrors the final handoff's §9 phase by phase, with the exact
commands, curls and expected exit codes, the proof-artifact list, the stop conditions, the teardown in
runbook §9 order on the branch scope, and an explicit statement of what reading it does **not** authorize.
Four stale `CI.yml:219-221` citations in `docs/luster-billing-remaining-work-plan.md` are corrected to the
current zero-diff pin (`CI.yml:249-250`), which PR-5 will replace with a reviewed postimage.

### PR-4 — readiness half

# PR-4 — readiness half

> **Where this belongs and why it is here.** This paragraph is Lane A's entry for
> `docs/billing-completion-repair-20260915.md`, under a heading `## PR-4 — readiness half`,
> to be appended at the very end of that file *after* Lane B's dated PR-4 section exists.
> At the time Lane A finished (2026-09-15), that file's last heading was
> `## PR-1 (refund completion) — 2026-09-15` and no PR-4 section had been written yet, so
> per the lane rules the text was written here instead of being appended to a section that
> does not exist. Whoever lands Lane B's section should move the block below into the doc
> verbatim.

---

## PR-4 — readiness half

**2026-09-15, branch `feat/billing-pr4-readiness-rehearsal-tooling-20260916` (base `origin/main` `6999d87d`).** The pre-activation readiness verdict is no longer computed from the operator's own shell. `scripts/billing-readiness-check.ts` now takes a required `--target dark | rehearsal | activate-topups | activate-subscriptions` and a required `--env-source deployed | env-file | local`, and `src/libs/billing/readinessCheck.ts` gains `evaluateBillingReadiness({ target, evidence })` — pure over an explicit evidence bundle — which replaces the two old `readyForDarkDeploy`/`readyForActivation` verdicts with the per-target conjunction handoff §5.1 specifies. The trusted facts come from a new `GET /api/billing/readiness` (allowlisted in `CI.yml`), authorized by the same `isAuthorizedCronRequest` Bearer `CRON_SECRET` the billing crons accept — no cookie, no super-admin dependency, 401 by construction when the secret is unset — which publishes presence booleans and non-secret facts only: `planEnv`, `planEnvMatchesRuntime`, `vercelEnv`, `gitSha`, `appOrigin`, the four `switches`, `webhookSecretConfigured`, `webhookSecretDistinct` (computed in-process against the legacy and Connect secrets), `stripeKeyMode`, `cronSecretConfigured`, `identityHmacConfigured`, `identityHmacVersion`, `carrier` (section counts plus a SHA-256 digest of the sorted id list, never an id), `deploymentMarker`, `timestamp`. Public `/api/health` is unchanged and still carries exactly its two billing booleans. Four #225 defects close with it: the `whsec_` **value** regex is deleted in favour of presence evidence (B4 — the activation verdict no longer requires the deployment's secret to exist in the operator's shell); `checkActivationSwitches` becomes target-aware, so `activate-subscriptions` with `BILLING_TOPUPS_ENABLED` already `true` is provable while `PUBLIC_PRICING_ENABLED`/`BILLING_TAX_COLLECTION_ENABLED` stay blocked per D11 (B2); crons are read from `vercel.json` **at the deployed `gitSha`** (`git show <sha>:vercel.json`) and Preview additionally requires a `--cron-proof-file`, because Vercel never schedules Preview crons at all (B5/X4); and a Preview `/api/health` 503 body is read — its `degraded` status reported as an informational check, never as a billing-verdict term — only under `--environment preview` (B6/X7). Exit codes are 0 met / 4 not met / 5 evidence missing or unreadable / 6 evidence source insufficient, latched upward only, so a "met" computed after an unreadable evidence file cannot erase it; `--env-source local` requires `--developer`, prints `EVIDENCE SOURCE: local developer shell — NOT deployed proof`, and can never exit 0. Every #225 hardening is preserved verbatim: HTTPS-only evidence URLs with no credentials/query/fragment, redirects refused so an automation-bypass header is never replayed to a redirect target, a 10 s deadline, strict endpoint-**object** validation (a bare array is rejected), and no transport or JSON error detail in any message. Carrier parity is proven by digest equality between the pulled env file and the deployment, so no Stripe id is transmitted in either direction; secrets are named on argv only as environment-variable NAMES (`--bypass-secret-env`, `--cron-secret-env`) and sent as headers. `--health-file`/`--readiness-file` accept a *saved* response as recorded evidence — refused outright with `--env-source deployed`, and useless for any non-`dark` target, which still requires `deployed` — with the JSON `provenance` block naming the exact URL or file every fact was read from. `docs/BILLING_PRODUCTION_RUNBOOK.md` is corrected, never trimmed: §1 gains the per-target evidence-source/exit-code table; §2.2 makes `stripe coupons create --id coupon_<8+ alnum>` mandatory (a Stripe-generated coupon id fails the carrier regex and therefore the whole deployment at boot); §2.4/§4 replace value-reading with the endpoint object export plus `vercel env ls` names or the unsigned-POST probe (`400 INVALID_SIGNATURE` = set, `503 WEBHOOK_NOT_CONFIGURED` = unset); §3's verification command becomes `git grep -n 'checkout.sessions.create' -- src/`, which — unlike the old `src/app/api`-only grep — also surfaces the two connected-account deposit creators in `src/libs`; §4 corrects the false "CRON_SECRET already provisioned" claim for Preview and adds rows for `NEXT_PUBLIC_APP_URL` (set **before** the build; build-time inlined), `LUSTER_NONPROD_DB_HOSTS`, `REDIS_URL`, the five `SUPER_ADMIN_*`/`LEGACY_OTP_AUTH_ENABLED` variables, and the optional `BILLING_DEPLOYMENT_MARKER`; §5/§7 add the exact Preview manual-cron curl (Bearer `CRON_SECRET` + `x-vercel-protection-bypass`) and state plainly that Preview does not establish production crons; §6 records that `REDIS_URL` is required for super-admin login on hosted deploys. Tests: `src/libs/billing/readinessCheck.test.ts` 75, `scripts/billing-readiness-check.test.ts` 38, `src/app/api/billing/readiness/route.test.ts` 10 (RD-1 … RD-8 covered), with `reconcile` 22 and `windows/evaluate` 7 re-run green; `tsc --noEmit` and `eslint --max-warnings 0` clean. No Stripe call, no Vercel call, no migration, no `vercel.json` change, and production billing stays dark throughout.
