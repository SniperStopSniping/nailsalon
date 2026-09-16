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

## PR-2 (billing-endpoint foreign-event isolation) — 2026-09-16

The legacy `/api/webhooks/stripe` and the billing `/api/webhooks/stripe-billing` share one Stripe
platform account, and on test mode that account is also shared with every other deployment of this
codebase. PR-2 makes the billing endpoint's side of that isolation two-sided (D19c §2.3 items 1–5),
so it no longer depends on nobody ever editing metadata in the Stripe Dashboard.

**The rule, stated once.** An object is processed here **iff** it carries the new-track marker
(`metadata.purpose`, plus `metadata.luster_deployment` when `BILLING_DEPLOYMENT_MARKER` is set)
**and** resolves to a salon or row that exists in this database. A *definite* "not mine" is terminal
`ignored_foreign` — 200, no alert, no retry, `salon_id` left NULL. Only a *transient* inability to
decide stays retryable, bounded by the existing 8-attempt poison ladder. The endpoint fails toward
"not mine".

- **Item 1 — error-class taxonomy.** New `src/libs/billing/stripeFetchFailure.ts`: a decoded
  `StripeInvalidRequestError` (`resource_missing` and friends) about the object is `foreign`;
  everything else — 429, 5xx, connection resets, and deliberately also authentication/permission
  failures — is `retryable`. The old `isLocallyOwnedSubscription`'s `catch { return true }` is gone:
  a Stripe outage, or a wrong key, can no longer be read as evidence about ownership in either
  direction. The taxonomy is deposits' `classifyStripeFailure` reproduced faithfully rather than
  imported (that module reaches `@/libs/stripe`, which every suite driving this webhook mocks); the
  file says so and the two are pinned by their own suites.
- **Item 2 — invoices classify from the body first.** `invoice.subscription_details.metadata` is
  Stripe's immutable snapshot of the subscription's metadata at finalization, and every new-track
  invoice carries it. When present, ownership costs **zero Stripe calls**. `subscriptions.retrieve`
  runs only when that snapshot is absent, and is the one classification fetch §2.6 permits.
  `SUBSCRIPTION_NOT_PROJECTED` now has exactly two producers, both of them the
  ours-but-not-yet-projected case: the refund/dispute path
  (`resolveLocalSubscriptionByInvoiceId`) and the invoice path, which rethrows the projection's own
  anomaly. Both are retryable and bounded by the 8-attempt poison ladder, and neither fires for an
  object classified as foreign — where it previously stood in for every unresolved refund.
- **Item 3 — a local salon is required before any write.** `projectSubscriptionSnapshot` looks the
  salon up inside its transaction on the INSERT path and returns `{applied:false,
  anomaly:'SALON_NOT_LOCAL'}` rather than raising a foreign-key error into the retry ladder; the
  route maps it to `ignored_foreign` `FOREIGN_SALON`, never `held_anomaly`. The top-up completion and
  expiry paths apply the same rule: a local salon keeps today's retryable throw (the genuine TX2
  race), a non-local one is terminal. `applyTopupSessionExpired` keeps its throwing contract for the
  callers that cannot classify (the checkout reuse path, P4's reconciler); the classifying form is
  the new `resolveTopupSessionExpiry`.
- **Ordering — classify before spending.** The top-up completion path now looks up the bound
  purchase row *before* retrieving the session from Stripe, so a foreign session costs zero Stripe
  calls and never gets a `price_id` written onto its own `ignored_foreign` row. A
  `plan_subscription` session is attributed from its `billing_checkout_attempt` rather than only
  from an expanded `session.subscription`, which Stripe supplies only sometimes.
- **Item 4 — `billing_stripe_event.salon_id` attribution.** Deliberately NOT written at claim time
  from the raw body: the column carries a real foreign key, so a foreign salon id would turn a
  terminal classification into a retry loop. `recordBillingEventSalonId` is called only after a
  handler has established the object is ours and local, with an id that came from a locally stored
  row, and carries an `EXISTS` fence as defence in depth. `ignored_foreign` rows stay NULL.
- **Item 5 — livemode (Y12).** The expectation now comes from `computeExpectedLivemode` (runtime ×
  key prefix), not from `BILLING_PLAN_ENV`, which is a plan-catalogue selector and says nothing about
  which mode the key we hold can act in. Indeterminate ⇒ **503 `MODE_INDETERMINATE`** with no row and
  a `billing.livemode_indeterminate` alert. A mismatch still parks the event terminally, now with a
  rate-limited `billing.livemode_mismatch` alert (one per process per 10 minutes — the fault is
  standing, not per-event), and the parked row is **reclaimable**: once the configuration is
  corrected, Stripe's own redelivery re-claims and processes it. Recovery is a redelivery, never a
  replay tool (INV-A10).

**New, optional `BILLING_DEPLOYMENT_MARKER`.** Unset ⇒ behaviour identical to before the variable
existed. Set ⇒ an absent or different `metadata.luster_deployment` is definitely foreign, with zero
Stripe calls — **unless this database already holds a row for the object** (`billing_subscription`
for a subscription or invoice, `billing_checkout_attempt` for a session), which is direct proof this
deployment created and projected it and therefore outranks the marker. Without that override,
configuring the marker for the first time would classify every in-flight subscription stamped before
the stamping deploy as foreign and silently stop projecting existing subscribers' renewals. The
`purpose` check is never bypassed, and the local-row read happens only when the marker is configured
and disagrees. PR-2 only *honours* the marker; PR-3 stamps it. The runbook §4 row says, in bold, to
set it only after the stamping deploy, and records that the marker (or a dedicated Sandbox, O5) is
required before the Isla Preview rehearsal on a shared test account.

Billing stays dark: no environment value, no switch, no migration, no CI change, no Stripe or Vercel
change. The real-PostgreSQL refund suite still executes 17 tests with zero skips.

Not done, deliberately: `reconcile/route.ts` is untouched — it only ever projects subscriptions read
out of this database, so the projection's INSERT path (and `SALON_NOT_LOCAL` with it) is unreachable
there, and a non-applied outcome already reports `repaired:false` without throwing. Its suite gained
a test pinning both halves of that claim, including that remote metadata can never re-tenant a local
row.
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

- **T1 (documentation, not code)** — the seed still refuses to create a super-admin. `docs/BILLING_PREVIEW_REHEARSAL.md`
  §5.1 documents the mechanism exactly as it exists: the password login authenticates a **pre-existing**
  `admin_user` row (`is_super_admin = true`, `phone_e164 = SUPER_ADMIN_TEST_PHONE`) and never creates one.
  The `SUPER_ADMIN_BOOTSTRAP_PHONE` OTP path is documented as **not usable** here and is not offered as an
  option: `LEGACY_OTP_AUTH_ENABLED=false` closes it, and even enabled it would need Twilio Verify, because
  the non-Twilio fixture path requires `!isHostedDeployment()` and `VERCEL_ENV` is always set on Preview.
  Creating the first super-admin row on the Preview database is therefore an owner-executed step outside
  every script in the document.
- **T2** — `--allow-host <hostname>` is required with any webhook url and must match it. Production hosts are
  refused outright with no flag that unlocks them: `lustergel.app` / `islanailsalon.com` and anything beneath
  them, the Vercel production alias `isla-nail-studio.vercel.app`, and this project's
  `isla-nail-studio-git-main-*.vercel.app` alias — but deliberately NOT the other
  `isla-nail-studio-*.vercel.app` hosts, which are the Preview deployment URLs the rehearsal registers
  against.
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

**2026-09-15, branch `feat/billing-pr4-readiness-rehearsal-tooling-20260916` (base `origin/main` `6999d87d`).** The pre-activation readiness verdict is no longer computed from the operator's own shell. `scripts/billing-readiness-check.ts` now takes a required `--target dark | rehearsal | activate-topups | activate-subscriptions` and a required `--env-source deployed | env-file | local`, and `src/libs/billing/readinessCheck.ts` gains `evaluateBillingReadiness({ target, evidence })` — pure over an explicit evidence bundle — which replaces the two old `readyForDarkDeploy`/`readyForActivation` verdicts with the per-target conjunction handoff §5.1 specifies. The trusted facts come from a new `GET /api/billing/readiness` (allowlisted in `CI.yml`), authorized by the same `isAuthorizedCronRequest` Bearer `CRON_SECRET` the billing crons accept — no cookie, no super-admin dependency, 401 by construction when the secret is unset — which publishes presence booleans and non-secret facts only: `planEnv`, `planEnvMatchesRuntime`, `vercelEnv`, `gitSha`, `appOrigin`, the four `switches`, `webhookSecretConfigured`, `webhookSecretDistinct` (computed in-process against the legacy and Connect secrets), `stripeKeyMode`, `cronSecretConfigured`, `identityHmacConfigured`, `identityHmacVersion`, `carrier` (section counts plus a SHA-256 digest of the sorted id list, never an id), `deploymentMarker`, `timestamp`. Public `/api/health` is unchanged and still carries exactly its two billing booleans. Four #225 defects close with it: the `whsec_` **value** regex is deleted in favour of presence evidence (B4 — the activation verdict no longer requires the deployment's secret to exist in the operator's shell); `checkActivationSwitches` becomes target-aware, so `activate-subscriptions` with `BILLING_TOPUPS_ENABLED` already `true` is provable while `PUBLIC_PRICING_ENABLED`/`BILLING_TAX_COLLECTION_ENABLED` stay blocked per D11 (B2); crons are read from `vercel.json` **at the deployed `gitSha`** (`git show <sha>:vercel.json`) and Preview additionally requires a `--cron-proof-file`, because Vercel never schedules Preview crons at all (B5/X4); and a Preview `/api/health` 503 body is read — its `degraded` status reported as an informational check, never as a billing-verdict term — only under `--environment preview` (B6/X7). Exit codes are 0 met / 4 not met / 5 evidence missing or unreadable / 6 evidence source insufficient, latched upward only, so a "met" computed after an unreadable evidence file cannot erase it; `--env-source local` requires `--developer`, prints `EVIDENCE SOURCE: local developer shell — NOT deployed proof`, and can never exit 0. Every #225 hardening is preserved verbatim: HTTPS-only evidence URLs with no credentials/query/fragment, redirects refused so an automation-bypass header is never replayed to a redirect target, a 10 s deadline, strict endpoint-**object** validation (a bare array is rejected), and no transport or JSON error detail in any message. Carrier parity is proven by digest equality between the pulled env file and the deployment, so no Stripe id is transmitted in either direction; secrets are named on argv only as environment-variable NAMES (`--bypass-secret-env`, `--cron-secret-env`) and sent as headers. `--health-file`/`--readiness-file` accept a *saved* response as recorded evidence — refused outright with `--env-source deployed`, and useless for any non-`dark` target, which still requires `deployed` — with the JSON `provenance` block naming the exact URL or file every fact was read from. `docs/BILLING_PRODUCTION_RUNBOOK.md` is corrected, never trimmed: §1 gains the per-target evidence-source/exit-code table; §2.2 makes `stripe coupons create --id coupon_<8+ alnum>` mandatory (a Stripe-generated coupon id fails the carrier regex and therefore the whole deployment at boot); §2.4/§4 replace value-reading with the endpoint object export plus `vercel env ls` names or the unsigned-POST probe (`400 INVALID_SIGNATURE` = set, `503 WEBHOOK_NOT_CONFIGURED` = unset); §3's verification command becomes `git grep -n 'checkout.sessions.create' -- src/`, which — unlike the old `src/app/api`-only grep — also surfaces the two connected-account deposit creators in `src/libs`; §4 corrects the false "CRON_SECRET already provisioned" claim for Preview and adds rows for `NEXT_PUBLIC_APP_URL` (set **before** the build; build-time inlined), `LUSTER_NONPROD_DB_HOSTS`, `REDIS_URL`, the five `SUPER_ADMIN_*`/`LEGACY_OTP_AUTH_ENABLED` variables, and the optional `BILLING_DEPLOYMENT_MARKER`; §5/§7 add the exact Preview manual-cron curl (Bearer `CRON_SECRET` + `x-vercel-protection-bypass`) and state plainly that Preview does not establish production crons; §6 records that `REDIS_URL` is required for super-admin login on hosted deploys. Three couplings close the gap a trust-boundary review found in the first cut, where `--environment` was a free-floating label: it is now REQUIRED and pinned to the target (`rehearsal` ⇒ `preview`, `activate-*` ⇒ `production`, `dark` ⇒ either, exit 6 otherwise), so an activation target can no longer be labelled `preview` to unlock the Preview-only 503 allowance; `environment_matches_deployment` makes the deployment's own `vercelEnv` able to contradict the label; and `deployment_sha_consistent` requires `/api/health` and `/api/billing/readiness` to report the same commit, since two reads that landed on different deployments are not evidence about one. Nine narrower rules land with them: an `env-file` source requires an actual `--env-file` (an empty variable-name list is not provisioning evidence); a saved `--health-file` obeys the same 503 gate as the live fetch; `--readiness-url` must share the health origin; each cron invocation must carry a response body and a parseable `recordedAt`, and the two jobs are held to DIFFERENT bodies for the `activate-*` targets because they gate differently — `/api/billing/windows/evaluate` gates on `BILLING_SUBSCRIPTIONS_ENABLED` alone and must answer the dark `{"skipped":"BILLING_DISABLED"}`, while `/api/billing/reconcile` skips only when NEITHER switch is set (`reconcile/route.ts:605-609`), so it must answer the dark skip for `activate-topups` but a body with NO `skipped` key (`{purged, topups}`) for `activate-subscriptions`, where `BILLING_TOPUPS_ENABLED` is already true under D11; demanding a skip from both would have refused the documented activation order; a supplied `--vercel-json-at-sha` must be byte-identical to `<sha>:vercel.json` whenever that commit IS in the checkout (the flag exists only for the case where it is not, and `provenance` records which situation applied); portal export entries must carry a `livemode` marker that matches the target's mode; the endpoint export's URL must carry no query string, so a deployment-protection bypass token cannot be stored in — and displayed by — the shared Stripe dashboard (O6); `validateIntegrityReport` accepts both the flat `{exitCode, violations}` shape and the `{exitCode, report}` wrapper the rehearsal document prescribes (because `scripts/billing-integrity-check.ts` carries its exit code only as a process status that a saved stdout file loses), refuses a file carrying both at once, and holds a wrapper to that script's own contract — `report.violationCount === report.violations.length`, and `exitCode === 3` exactly when violations were found (`billing-integrity-check.ts:145`); `deployment_sha_consistent` fails rather than skips when exactly one of the two deployed surfaces names a commit, since on one deployment both read the same `VERCEL_GIT_COMMIT_SHA`; and the route clamps `BILLING_PLAN_ENV` to the enum, sends `Cache-Control: no-store` on the 401 as well, and normalises `appOrigin` through `URL.origin` so a bypass token in `NEXT_PUBLIC_APP_URL` can never ride out on the body. The exit code is now computed before serialization and printed INSIDE the JSON beside `met`, so `met: true` can never be read without the `exitCode: 5` that qualifies it. Tests: `src/libs/billing/readinessCheck.test.ts` 120, `scripts/billing-readiness-check.test.ts` 55, `src/app/api/billing/readiness/route.test.ts` 12 (RD-1 … RD-8 plus one explicit failing path per check id), with `reconcile` 22 and `windows/evaluate` 7 re-run green; `tsc --noEmit` and `eslint --max-warnings 0` clean; `node scripts/check-secret-leaks.mjs --tree` and `node --test scripts/check-secret-leaks.node-test.mjs` both pass. No Stripe call, no Vercel call, no migration, no `vercel.json` change, and production billing stays dark throughout.
