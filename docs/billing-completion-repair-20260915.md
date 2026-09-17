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

## PR-6b (identity safety + hosted application origin) — 2026-09-16

Base `origin/main` `6c5167e9` (v1.112.0), branch `fix/billing-pr6b-identity-origin-20260916`. Only the
slices of PR-6 that need no owner decision. Billing stays dark: no migration, no `vercel.json` change, no
environment value, no Stripe or Vercel call, and nothing here performs a provider-side action.

### Y9 — an unverified email must never become a durable identity link

`src/libs/billing/starterGrantBackfill.ts` passed `verifiedEmail: salon.ownerEmail` into
`resolveOrCreateBusinessIdentity`. `salon.owner_email` is a free-text contact column that nothing verifies,
while `businessIdentity.ts:81-90` turns any non-empty `verifiedEmail` into a durable `email_hmac` link and
`billing_identity_link_value_uniq` makes one link value belong to exactly one identity globally. Two salons
that merely share an owner email were therefore merged into a single business identity, and because the
starter grant is fenced per identity, the second salon's grant silently returned `granted: false` — or the
resolution raised `IDENTITY_CONFLICT` (`businessIdentity.ts:140-145`), which the operator route masked as a
500. Live onboarding (`onboarding/luster/route.ts:418-421`,
`onboarding-v1-integration/persistence.server.ts:1979-1982`) passes a genuinely Clerk-verified address, so
the two call sites did not agree on what "verified" means.

The email signal now comes from the owner's `admin_user` row and only when that row's `email_verified_at`
is non-null — the single verified-email marker this schema has (`src/models/Schema.ts:2065`). It is that
row's own `email` that is passed, never `salon.owner_email`, because the marker attests the `admin_user`
address and the two can differ. The owner row is found by `admin_user.clerk_user_id =
salon.owner_clerk_user_id` (onboarding writes the same Clerk id to both columns), falling back for a legacy
phone-OTP salon to the `admin_salon_membership` row with `role = 'owner'`, ordered by `admin_user.created_at`
so a salon carrying two owner rows resolves deterministically. With no verified address the call passes
`verifiedEmail: null` and the `clerk_user`, `salon` and `stripe_customer` signals carry the resolution
unchanged — the grant still applies. `salon.ownerEmail` is gone from the module's salon projection entirely,
so a later edit cannot reintroduce it, and the read-only `plan` path uses the same gated signal: otherwise
`plan` could report an `alreadyGranted` belonging to a different salon that merely shares the address, and
then disagree with the identity `apply` resolves.

`src/app/api/super-admin/billing/starter-grant/route.ts` now answers a typed **409 `IDENTITY_CONFLICT`** for
`BusinessIdentityError` with that code, telling the operator that the salon's signals resolve to more than
one business identity and that the grant was **not** applied. The backfill runs in one transaction, so the
throw already rolled everything back: no credits moved, no `billing_starter_grant` row, no audit row. The
body carries the code and message only — no Stripe id, no amount, no fingerprint and no business-identity
id, since the thing that failed is deciding which identity this salon is. Everything else in that route is
untouched: auth first, then the rate limiter, then body parse, the typed confirmation, and a masked 500 with
a Sentry capture for anything unexpected. The other `BusinessIdentityError` code, `NO_IDENTITY_SIGNALS`, is
structurally unreachable here (the salon id is always supplied) and deliberately stays in the masked-500
bucket rather than being mislabelled a conflict. `plan` shares the same catch, so a future plan-side
conflict check answers 409 and not 500; it cannot raise the error today, because its read-only resolution
returns the first existing link match and never calls `resolveOrCreateBusinessIdentity`.

**Y9 was unreachable in production while it was live.** Both the defect and the fix depend on
`computeEmailFingerprint`, which fail-closes to `null` unless `BILLING_IDENTITY_HMAC_SECRET` and
`BILLING_IDENTITY_HMAC_VERSION` are both set — and they are unset in every environment today (final handoff
§6.2, HMAC configuration row). No `email_hmac` link has ever been written, so there is no data to repair;
the fix lands before the secret is ever provisioned. The tests set the secret explicitly, which is the only
way the regression is provable.

### X5 — a hosted deployment must never send a paying customer to `localhost`

New `src/libs/billing/billingAppOrigin.ts` exports `resolveBillingAppOrigin(): string` and
`BillingAppOriginError` with the single code `APP_ORIGIN_UNCONFIGURED`. It returns the `URL.origin` of
`NEXT_PUBLIC_APP_URL` when that is set and parseable as an absolute `http(s)` URL — origin only, so a
deployment-protection bypass token left in the variable can never ride out to Stripe inside a redirect url.
When the value is unusable it throws on a hosted runtime (`process.env.VERCEL === '1'`) and returns
`http://localhost:3000` only off one. It deliberately does **not** reuse `getCanonicalAppOrigin()`
(`src/libs/publicUrl.ts:26-42`), whose `VERCEL_PROJECT_PRODUCTION_URL` fallback (`publicUrl.ts:30`) would
send a Preview customer's test-mode success/cancel redirect to the production domain; the file header says
so, and both the unit suite and the route suite pin it.

`src/app/api/billing/checkout/topup/route.ts` uses it in place of the inline
`Env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'` fallback. `NEXT_PUBLIC_APP_URL` is build-time inlined,
so a deployment built before the variable was provisioned dead-ended every post-payment redirect. The origin
is resolved **before TX1**, alongside the catalogue and `PRICE_UNCONFIGURED` checks, not at the
`checkout.sessions.create` call site: it is a pure environment read, so the refusal leaves no attempt row, no
`sms_topup_purchase` row and no Stripe session, exactly like every other pre-reservation refusal. Resolving
it later would have parked a durable attempt in `creating` — unresolvable until its TTL, blocking the salon's
next checkout — for a purely environmental fault. The throw is masked by the route's existing outer catch as
its existing 500 `CHECKOUT_ERROR` with a Sentry capture; no new public error vocabulary was invented.

`src/app/api/billing/checkout/topup/route.ts` is on the `src/app/api/billing` allowlist in
`.github/workflows/CI.yml` (`case` entry at `CI.yml:285`) but carries **no** reviewed-postimage blob pin —
only `checkout/route.ts` (`CI.yml:304-321`) and `portal/route.ts` (`CI.yml:324-333`) do — so this edit needs
no CI change, and none was made.

**What stays owner-gated (O10).** The subscription checkout (`checkout/route.ts:271`) and the Billing Portal
(`portal/route.ts:142`) keep their inline `localhost` fallback. Both files are pinned to reviewed-postimage
blobs, so editing either fails CI until the owner ratifies a new postimage — the same gate that holds the
portal's `returnUrl` same-origin validation and PR-3's response codes. The next PR that refreshes those pins
must delete both inline fallbacks; the helper's header comment records the obligation at the call sites.

### Deliberate non-changes recorded here

**1. R10 (§6.5a label vs eligibility) is accepted as a pilot limitation, not fixed.**
`describeSubscriptionEntitlement` (`src/libs/billing/subscriptionEntitlement.ts:90-102`) is a pure function
over `{status, paidThrough}`. The divergence is reachable only after a refund of a **non-latest** invoice,
where a newer paid invoice keeps `paid_through` ahead of the refunded window: the owner-facing label then
states coverage the refunded interval no longer earns. Making the label refund-aware would mean threading
refund evidence through `legacyPlanAdapter.ts` into the owner usage surface
(`src/app/api/admin/salon/communications/usage/route.ts`) — a database read in an owner-facing route, which
is well outside this PR and outside PR-6's mandate. The grant engine remains authoritative and is unaffected:
window grants and upgrade differences exclude refunded intervals independently of the mutable `paidThrough`
scalar, so credits are withheld correctly. Only the label over-states coverage. Handoff §3.4 explicitly
permits recording this rather than fixing it.

**2. Migration index collision — `0078` is already claimed.** The open Owner Assistant PR #223 claims
`migrations/0078_owner_assistant_menu_order.sql` and edits `migrations/meta/_journal.json`,
`src/models/Schema.ts`, `src/models/d6_1TaxSnapshotSchema.integration.test.ts`, `src/libs/Env.ts` and
`src/libs/adminAuth.ts`. Whichever of the two merges first takes index `0078`. The future `billing_customer`
migration (owner decision O12, PR-3) must therefore claim the next free index, re-base its `_journal.json`
entry on the merged tail, and re-base the preview-fixture ledger pin every migration has to re-base. This is
recorded here so the PR-3 author meets it before CI does, not after.

### Validation

`src/libs/billing/starterGrantBackfill.test.ts` 15 (8 pre-existing + 7 Y9, including the two-salons /
one-mailbox regression), `src/app/api/super-admin/billing/starter-grant/route.test.ts` 15 (11 pre-existing +
4), `src/libs/billing/billingAppOrigin.test.ts` 14 (new),
`src/app/api/billing/checkout/topup/route.test.ts` 50 (45 pre-existing + 5 X5), all green, with
`src/libs/architecturalInvariants.test.ts` and `src/libs/architectureClientServerBoundary.test.ts` re-run
clean. `npx tsc --noEmit` and `eslint --max-warnings 0` on every changed file are clean, and
`node scripts/check-secret-leaks.mjs --tree` passes. No existing assertion was weakened.
## PR-6a (pre-production correctness, unblocked subset) — 2026-09-16

Base `origin/main` `6c5167e9` (v1.112.0, containing PR-1 #226, PR-2 #227, PR-4 #228), branch
`fix/billing-pr6a-preprod-correctness-20260916`. Every item here needed **no owner decision**;
everything that did is listed as still-gated at the end. Billing stays dark: no migration, no
`vercel.json` change, no environment value, no Stripe or Vercel call, and no route becomes reachable
that was not reachable before.

- **OP-2 / Y2 — an attempt is reusable only for the SAME offer** (`src/libs/billing/checkoutAttempts.ts`).
  The `plan_subscription` reuse branch selected only `id` and `stripeIdempotencyKey` and reused ANY
  active attempt, unlike the top-up branch which has always compared `topupOfferKey`. Reuse hands the
  caller the attempt's existing Checkout Session, so a customer who abandoned offer A and returned for
  offer B inside the 1-hour TTL was shown A's session while the route rendered B's price and
  disclosure — and because `checkout/route.ts` reserves a capped promotion claim against the reused
  attempt, a promotion added on the retry burned a claim against a session that carries no discount.
  Both reuse sites (the ordinary branch and the insert-race fallback) now compare through one
  `attemptMatchesRequestedOffer` helper, purpose-scoped: `topupOfferKey` for `sms_topup`,
  `billingOfferKey` AND `promotionKey` for `plan_subscription`; a mismatch is the typed refusal
  `CHECKOUT_IN_PROGRESS`, never a reuse. The TTL sweep, `ACTIVE_SUBSCRIPTION_EXISTS`,
  `CHECKOUT_PENDING_RECONCILIATION`, the top-up grant/expired resolution and the targetless
  `onConflictDoNothing` are untouched.
  **Deliberate partial (O10).** `src/app/api/billing/checkout/route.ts:246-247` maps every attempt
  conflict to `409 ACTIVE_SUBSCRIPTION_EXISTS`, so a differing-offer refusal currently surfaces to the
  subscription caller under that code instead of `CHECKOUT_IN_PROGRESS`. Correcting the mapping means
  editing a reviewed-postimage-pinned route (owner decision O10) and is deferred; the money-safety
  half — never reusing a session created for a different offer or promotion — lands here in full. The
  top-up route already maps `CHECKOUT_IN_PROGRESS` correctly (`checkout/topup/route.ts:208`).
- **OP-4 — eligibility must judge ALL rows** (`classifySubscriptionEligibility`). It ordered by
  `createdAt` ASC and took ONE row, so with a cancel → resubscribe history the oldest row is an old
  `canceled` one whose `paidThrough` has passed and the function answered `{ eligible: true }` **while
  a live subscription existed**; the partial unique index `billing_subscription_live_salon_uniq`
  permits exactly that shape. It now reads every row under the same status filter and reduces
  most-restrictive-first: any live-set row decides (`ACTIVE_SUBSCRIPTION_EXISTS`, or
  `CANCELLATION_SCHEDULED` only when every live row is scheduled), else the MAXIMUM `paidThrough`
  among still-prepaid `canceled` rows gives `PREPAID_ENTITLEMENT_REMAINS`, else eligible. Ordered
  `updatedAt` DESC, `id` ASC so the (index-forbidden) multi-live case is still deterministic. The
  status filter and the return type are unchanged.
- **OP-5 — window-engine anomalies reach Sentry** (`src/libs/billing/creditGrants.ts`).
  `TRIALING_SUBSCRIPTION_ANOMALY` and `UNKNOWN_PLAN_DEFINITION` only ever reached
  `WindowEvaluationSummary`, whose sole consumer is the hourly cron's response body — which nothing
  reads. Both are currently unreachable, but a Price accidentally created with `trial_period_days`
  would grant nothing, silently, forever. Each push site now also raises
  `Sentry.captureMessage('billing.window_engine_anomaly', { level: 'warning', extra: { anomaly,
  subscriptionId, salonId } })`, so both callers (the hourly cron and the webhook's post-commit
  evaluation) alert. No summary field and no return shape changed.
- **Projection insert race — no more phantom audit rows** (`projectSubscriptionSnapshot`). The insert
  path used `onConflictDoNothing` and then wrote a `billing_subscription_projected` audit row
  UNCONDITIONALLY for the locally generated `bsub_…` id, returning `kind: 'created'`. When a
  concurrent delivery won the insert, the loser's audit row referenced an id that was never persisted
  and its snapshot was silently dropped. Refund evidence lives in the same `audit_log` table, so a
  false row there is a correctness-of-evidence defect, not a cosmetic one. The insert now
  `.returning()`s: zero rows ⇒ re-select the winner `FOR UPDATE` by `stripeSubscriptionId` and run the
  **existing** update path against it, which was moved verbatim into a module-private
  `applySnapshotToExisting` (the §8.3 stale fence, the upgrade/downgrade patch, `applyUpgradeDiff` and
  the audit row are the same statements in the same order, so the ordinary caller's behaviour is
  unchanged). A winner that cannot be re-selected — deleted in between — returns
  `{ applied: false, anomaly: 'SUBSCRIPTION_PROJECTION_RACE' }`.
- **Y5 — the §8.5 duplicate-remote alert can finally fire** (`src/app/api/billing/reconcile/route.ts`).
  The alert only ever compared subscriptions this database already knows (`customersSeen`), so the
  documented case — a second LIVE subscription on a customer we bill that was never projected here —
  could not be detected at all; it could only produce a benign false positive after cancel →
  resubscribe. The pass now builds `customerToLocalSubscriptionIds` from the LOCAL rows while
  iterating (so a subscription whose remote retrieve failed still contributes its customer) and, after
  the main loop, issues exactly ONE `stripe.subscriptions.list({ customer, status: 'all', limit: 100 })`
  per distinct non-empty customer id. A remote subscription counts as live unless its status is
  `canceled` or `incomplete_expired`; every live remote id absent from that customer's local set
  becomes a drift entry `unprojected_remote_subscription` (`local` = the customer id, `remote` = the
  remote subscription id, `stripeSubscriptionId` = the remote subscription id, `repaired: false`) and
  records the customer for the alert. The existing `customersSeen` comparison is kept. One
  `billing.duplicate_remote_subscriptions` message per pass now carries the DISTINCT `customers` plus
  every `unprojected` id, and `summary.duplicateRemoteCustomers` counts distinct customers rather than
  observations. Nothing is repaired: projecting the unknown subscription would mean CHOOSING which one
  is authoritative, which §8.5 reserves for a human. A failing list call pushes the informational note
  `duplicate_check_unverifiable` (`local` and `stripeSubscriptionId` = the customer id, `remote:
  'UNRETRIEVABLE'`) and never aborts the pass. All of it sits inside the section gated on
  `BILLING_SUBSCRIPTIONS_ENABLED`, so it costs nothing in production today.
- **PR-1 reviewer follow-up 1 — the `written` flag.** `applySubscriptionFullRefund` answered
  `{ applied: true, lowered: false }` both when it inserted a new applied row and when it deduped on
  an effective state that already carried the exclusion. Its return gains `written: boolean`, true
  only when the audit row was actually inserted. `reconcileStaleVoids` now gates BOTH the
  `billing.subscription_refunded` Sentry call and the `refund_evidence_reasserted` note on `written`,
  so an exclusion a concurrent webhook delivery already wrote is not re-announced by the hourly pass —
  once an hour, forever. The webhook caller is untouched and still gates on `lowered`.
- **PR-1 reviewer follow-up 2 — paging in the re-assert direction.** `reconcileStaleVoids` noted
  `refund_evidence_uncomparable` whenever `invoice.lines.has_more`, so a >10-line invoice with a stale
  machine void could never be re-asserted — precisely the invoices carrying the most line items. It
  now calls `loadInvoiceLines(invoice)`, which pages through `invoices.listLineItems` and THROWS on a
  Stripe failure; the surrounding try/catch turns that into the existing `refund_evidence_unverifiable`
  note and the pass continues. `refund_evidence_uncomparable` is kept for the one case retrying cannot
  fix — a structurally unreadable line set (`remote: 'LINES_UNREADABLE'`).

**Tests.** `src/app/api/billing/reconcile/route.test.ts` 32 (10 new: five for Y5 — the unprojected
live remote, terminated remotes, every non-terminal status, a failing list absorbed into a note with
the next customer still checked, and one list per distinct customer even when the subscription itself
is unretrievable; one for the `written` gate under a webhook that wins the race; three for the paging
direction — paged-and-re-asserted, paging failure, structurally unreadable; plus the dark contract
extended to cover the new list call). `src/libs/billing/checkoutAttempts.test.ts`,
`src/libs/billing/billingSubscriptionProjection.test.ts` and `src/libs/billing/creditGrants.test.ts`
cover A–D. The real-PostgreSQL refund suite gains RT-20 — two concurrent `projectSubscriptionSnapshot`
calls for one brand-new subscription leave exactly one `billing_subscription` row, exactly one
`created` audit row, one `updated` audit row, both attributed to the row that exists, both calls
`applied: true`, and zero `audit_log` rows whose `entity_id` names no subscription — and now executes
**18** tests with zero skips (`EXPECTED_EXECUTED_TESTS` and the matching
`BILLING_REFUND_POSTGRES_TESTS_EXECUTED=18` grep in `.github/workflows/CI.yml`; that one count is the
only CI change).

**Documentation corrected, never trimmed.** Runbook §5's cron-log row no longer implies
`/api/billing/reconcile` answers `{"skipped":"BILLING_DISABLED"}` at the `activate-subscriptions`
gate — with `BILLING_TOPUPS_ENABLED` already `true` under D11 it reconciles held top-ups and answers a
body with NO `skipped` key, which is exactly what the readiness harness requires there (a skip would
mean the switch is not live). Runbook §8 gains the two shapes behind the duplicate-remote alert, the
new `unprojected_remote_subscription` drift entry, a row for `duplicate_check_unverifiable`, and a
corrected reading of `refund_evidence_uncomparable` (structurally unreadable only — truncation is now
paged). `scripts/billing-readiness-check.ts`'s USAGE loses the stale "`--env-file` without
`--environment`" exit-6 case: `--environment` is required for every run. The `classifyCheckoutSession`
doc comment in `src/app/api/webhooks/stripe-billing/route.ts` no longer claims "zero database reads" —
it reads the bound `billing_checkout_attempt` row when the deployment marker disagrees, because a
local attempt is proof we created the session; comment only, no behaviour change.

**Still owner-gated, deliberately untouched:** O1/D19c (`src/app/api/webhooks/stripe/route.ts`), O7,
O10 (the reviewed-postimage-pinned `checkout/route.ts` and `portal/route.ts`, hence the OP-2 response
code above), and O12/O13 (anything creating a Stripe customer or a `billing_customer` table).

### PR-6a — accepted consequences and queued follow-ups

**Switching offers inside the attempt window is now refused, deliberately.** Closing OP-2 means a
salon that opens checkout for one offer, abandons it, and returns for a different offer inside the
attempt TTL is refused until the old attempt expires (the session TTL is 55 minutes, the attempt
TTL 60). Until owner decision O10 allows the pinned checkout route to change, that refusal also
surfaces under the wrong code and message (`409 ACTIVE_SUBSCRIPTION_EXISTS`, "Manage it in the
Billing Portal") because the route maps every attempt conflict to that response.

Automatically releasing the superseded attempt was considered and rejected as unsafe: the old
Stripe Checkout Session stays payable until it expires, so releasing the slot and issuing a second
attempt admits a window in which a customer pays BOTH sessions, producing two live subscriptions
for one salon — a double charge and a `billing_subscription_live_salon_uniq` violation. Refusing is
the conservative outcome, and it is bounded and self-releasing. The complete fix belongs with O10,
where the route can expire the superseded session server-side first and then start a fresh attempt;
note that approving O10 for the response code alone does not remove the wait.

**Queued, not done (estate-scale, irrelevant at pilot scale of one salon):**
- The window-engine anomaly alert and the `unprojected_remote_subscription` alert both fire once
  per affected subscription per hourly pass, with no acknowledgement path, so a persistent
  condition repeats indefinitely. The repository already has the idiom for this
  (`logSubscriptionPriceCrossCheckSkippedOnce`). Suppression needs a deliberate design — keyed on
  what, for how long — because a too-broad guard would hide a genuine second occurrence.
- `unprojected_remote_subscription` can also fire legitimately and forever for a salon holding a
  grandfathered legacy subscription on the same Stripe customer; §8.5 says to alert rather than
  choose, so this needs an operator acknowledgement marker rather than a code change.

## PR-A (legacy / new-track isolation + the settings & Portal companion) — 2026-09-16

Owner-ratified narrow D19c amendment (`docs/billing-owner-decisions-20260916.md` §5): isolate
new-track checkout/subscription/invoice events from legacy mutation, preserve genuine legacy
behaviour, and ship the settings/Portal companion. No migration, no `vercel.json`, no env value, no
Stripe or Vercel call, no switch. Billing stays dark.

**The two guards, inside the byte-frozen legacy route.** `src/app/api/webhooks/stripe/route.ts`
gains exactly two early returns and one indexed read:

- **Guard A**, in `handleCheckoutSessionCompleted` immediately after `const salonId =
  session.metadata?.salonId`, returns on `metadata.purpose ∈ {plan_subscription, sms_topup}` before
  the subscription/customer id extraction, before the salon update, before `logBillingModeChange`
  and before `syncSubscription`. In `syncSubscription`, immediately after the existing
  `stripe.subscriptions.retrieve` — whose result already carries the metadata, so no second Stripe
  call is made — it returns on `metadata.purpose === 'plan_subscription'` before salon resolution
  and before every write. That single point covers `customer.subscription.*` **and** both
  `invoice.payment_*` types, because all of them funnel through that function.
- **Guard B**, immediately after Guard A in `syncSubscription`, is one indexed read against
  `billing_subscription_stripe_sub_uniq`. A row means this track already owns the subscription, so
  the route returns. It is provably a no-op for genuine legacy subscriptions — such a row is only
  ever inserted for marker-carrying objects — and exists so that a dashboard-edited or stripped
  `metadata.purpose` cannot re-open the leak for a subscription the new track owns.

**Ambiguity rule (now in the route's header comment and in Rev 2.3 §5):** an object is new-track iff
Guard A or Guard B fires; otherwise the route behaves byte-identically to Rev 2.2. Fail toward
legacy. A skipped event writes no salon row and no audit row, is logged without PII (session or
subscription id plus the reason), and still answers HTTP 200 so Stripe does not retry it. A thrown
error still answers 500 with the same Sentry shape. Neither side writes `salon.plan` or
`salon.features`.

**Freeze mechanics.** The `CI.yml` zero-diff pin on the route is replaced by a reviewed-postimage
`case` block byte-mirroring the Billing Portal block, accepting exactly
`85990776e5a63a04397c6958092be0ec660f109c` (recomputed after the review fixes below) and failing with
`must match a reviewed postimage.`
otherwise. Nothing else in `CI.yml` changed.

**Companion — owner-facing billing display.** Without it, Guard A would silently show a paying
new-track subscriber "Cash / Offline billing enabled" and remove the Manage-billing button, because
both settings routes read the legacy columns only. `src/libs/billing/salonBillingDisplay.ts`
(`server-only`) resolves a live `billing_subscription` row — `status NOT IN ('canceled',
'incomplete_expired')`, most recently updated among ties, the exact predicate the communications
usage route already encodes — to `{ billingMode: 'STRIPE', subscriptionStatus: row.status,
billingSource: 'billing_subscription' }`, and otherwise returns today's legacy values with
`billingSource: 'legacy'`. It is wired into all three response sites of the admin settings route and
all three of the super-admin route, and `billingSource` is added to those responses. The read is
display-only: `canEditBillingMode` stays `false`, `billingMode` stays in `FORBIDDEN_FIELDS`, and the
super-admin PATCH keeps writing the legacy column. The two surfaces report it differently, for the
reason recorded in the review section below: the owner-facing route returns the derived value as
`billingMode`, because nothing echoes it back, while the super-admin route keeps `settings.billingMode`
as the STORED column and reports the derived value separately as `derivedBillingMode`, because its
panel's editable select is seeded from that field and submits it on every save.

**Deliberate non-changes.** No `billing_customer` table is created or referenced (that is PR-3).

The stale citations and stale NORMATIVE statements in `docs/luster-billing-remaining-work-plan.md` were
initially left uncorrected as out of scope. That was reversed after review: a tracked document asserting
that this guard is BLOCKED, and a runbook telling the reader not to activate until it exists, are worse
than a scope deviation. They are corrected in the review section below.

### Independent review of PR-A, and what it changed (2026-09-16)

An independent reviewer checked head `d3f0781d` from a clean clone and returned **BLOCK** on one finding,
confirming independently that all six handled event types reach a salon write only through the two guarded
functions, that neither guard can fire on genuine legacy traffic, that the liveness predicate matches the
usage route, the portal route, the partial unique index and reconcile's terminal-status set with no drift,
that all six response sites were updated, and that the pinned blob matched.

**The blocker: the derived display was being round-tripped back into the legacy column.**
`SalonDetailPanel` seeds an *editable* Billing Mode select from `settings.billingMode` and its Save button
submits `{reviewsEnabled, rewardsEnabled, billingMode}` whether or not the operator touched that control.
Returning the derived value there meant a super-admin toggling rewards on a new-track salon would write
`STRIPE` into the legacy column — invisibly, because the response re-derives the same answer — falsifying
the Rev 2.3 §5 clause "the legacy column itself is not rewritten by the new track". The original test passed
only because it PATCHed `{reviewsEnabled: false}`, a body the real client never sends.

Fixed by splitting the two meanings apart: `settings.billingMode` is now the **stored** column at all three
super-admin sites, the derived value is reported alongside as read-only `derivedBillingMode` plus
`billingSource`, and the panel renders it as an explanatory line beside the unchanged select. A new test
PATCHes exactly the body the panel sends after a GET and asserts both that the legacy column is untouched
and that no `billingMode` audit entry is written for a field nobody edited. The owner-side admin route
needed no change: `billingMode` is in `FORBIDDEN_FIELDS` and `SettingsModal` never echoes it back.

Three further corrections:

- **Guard B backs up `syncSubscription` only.** An unmarked Checkout Session still takes the full legacy
  projection, so the single most damaging write has no ownership backstop. That is deliberate — a
  checkout-time ownership read would race the sibling endpoint's own insert — and the contract text was
  already accurate, scoping condition (b) to Subscriptions. The route comment now says so plainly.
- **Guard B's no-op proof cited the wrong marker.** The insert is gated on `billingOfferKey` plus `salonId`
  resolving to a known offer, not on `metadata.purpose`. The conclusion is unchanged; the stated proof now
  matches the code.
- **Deploy-order precondition, newly recorded.** This route postimage depends on the `billing_subscription`
  table, so migration `0069_billing_credit_foundation` is a precondition for deploying it. An environment
  deployed past this commit but not migrated would 500 on every legacy subscription and invoice event, and
  Stripe would retry them for its full window. Production is well past 0069, but this repository has a
  documented history of production running behind the migration tail because deploys never migrate.
  Catching the error and falling through to legacy would be worse — it would reopen the leak.

Stale normative statements in tracked documents were corrected rather than left contradicting the merged
result: the D7 row, the D18 row and the D19 row of the remaining-work plan, the G24 mitigation cell, the
frozen-surface row, the Gate C section title, and the runbook's §3 preamble, which told the reader not to
activate until a guard existed. The contract header is now Revision 2.3, with the filename unchanged so
existing citations keep resolving.

Legacy route postimage after these edits: `85990776e5a63a04397c6958092be0ec660f109c`.
