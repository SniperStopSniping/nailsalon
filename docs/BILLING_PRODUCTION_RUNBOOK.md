# Luster billing — production activation runbook

Governing contract: [luster-billing-communications-rev-2-2.md](luster-billing-communications-rev-2-2.md) (Rev 2.2), specifically §3 (frozen commercial terms), §4 (Stripe id mapping), §7.3 (identity/HMAC), §8.1/§8.4 (webhook), §12 (dark switches/publication gates), §20 (activation order this runbook specialises), §21 (Isla pilot billing checks). Plan: [luster-billing-remaining-work-plan.md](luster-billing-remaining-work-plan.md) §5 "P8c", §6 (D2/D3/D7/D10/D11/D16), §9 (per-switch acceptance). Gate record: [billing-gate-c-record.md](billing-gate-c-record.md). Companion: [BILLING_IDENTITY_KEY_LIFECYCLE.md](BILLING_IDENTITY_KEY_LIFECYCLE.md). House style follows [TWILIO_COMMUNICATIONS_RUNBOOK.md](TWILIO_COMMUNICATIONS_RUNBOOK.md) / [TWILIO_PILOT_CHECKLIST.md](TWILIO_PILOT_CHECKLIST.md): every step names an owner, an exact command or dashboard action, a verification, and a rollback.

## 0. Status banner

**2026-09-15 repair checkpoint:** consult [billing-completion-repair-20260915.md](billing-completion-repair-20260915.md) before relying on historical completion claims. Legacy webhook isolation remains blocked on the §5/§8.1 contract exception (D19c), including subscription lifecycle events; checkout-event filtering alone does not close it. Refund facts in `audit_log` are financial entitlement evidence and must be retained for the subscription lifetime; purging raw webhook payloads must never remove them.

**Historical authoring record, not a current environment inventory.** See [the completion repair record](billing-completion-repair-20260915.md) for later verified code and CI evidence. Recheck the target environment before any separately authorized action.

**NOT executed. Nothing in this document has been run against production, staging, Preview, or any Stripe account — live or test — by Claude.** Every switch, every secret, and the Stripe price carrier are unset today (verified read-only while writing this document; see §1). Each section below requires its own **separate, explicit owner authorization** before anyone runs it — this runbook is the specification for that work, not a standing approval to perform it. Gate D (P8c) authorizes writing this document and the readiness harness; it does **not** authorize creating a single Stripe resource, setting a single environment variable, or flipping a single switch. Two owner decisions block parts of this runbook outright and are carried as **PENDING** throughout, never defaulted:

- **D10 (retention horizon)** — blocks §10.2 of [BILLING_IDENTITY_KEY_LIFECYCLE.md](BILLING_IDENTITY_KEY_LIFECYCLE.md); it does not block dark deploy, cron registration, or top-up/subscription activation.
- **D11 (seven §12 publication approvals)** — blocks step 7's `PUBLIC_PRICING_ENABLED` and `BILLING_TAX_COLLECTION_ENABLED` outright (§7 below). Top-ups and subscriptions can activate without D11; public pricing and tax collection cannot.

## 1. Preconditions verified read-only (before touching anything in §2 onward)

All four checks below were performed while writing this document, from the `agent/billing-p8c-runbook` worktree, using only `git`, file reads, and the local readiness CLI against a non-production env — no Stripe or Vercel API call, no production database query.

| Precondition | Owner | Command / action | Result at time of writing | Rollback |
|---|---|---|---|---|
| `BILLING_PLAN_ENV=prod` on Vercel Production, `test` on Preview | Owner (Vercel dashboard access) | `vercel env ls BILLING_PLAN_ENV` (or Vercel dashboard → Settings → Environment Variables), one row per environment | Not verified by Claude (no Vercel credential in this worktree) — **owner must confirm before §4** | N/A (read-only check) |
| Both billing crons registered in `vercel.json` | Anyone with repo access | `git show origin/main:vercel.json \| grep -A1 '/api/billing/'` | PR #216 (`agent/billing-p4b-cron-registration`) adds `/api/billing/windows/evaluate` (`*/15 * * * *`) and `/api/billing/reconcile` (`17 * * * *`); **MERGED** as #216 (4103c165) — registration is on `main` | N/A (read-only check); if unmerged, §5's cron-log proof will show no invocations yet |
| `/api/health` reports `billing.dark: true` and `billing.planEnvMatchesRuntime: true` | Anyone (public endpoint) | `curl -s https://www.lustergel.app/api/health \| jq .billing` | Not fetched by Claude (no outbound network call was made while producing this document); **owner runs this before §2** | N/A (read-only check) |
| Readiness harness green for the target | Anyone with repo access + the target's evidence | `npx tsx scripts/billing-readiness-check.ts --target <target> --env-source <source> …` — see the harness table below this one | Superseded (PR-4): the row's original evidence was a LOCAL shell, which proves nothing about a deployment. The historical run recorded `readyForDarkDeploy: true` / `readyForActivation: false` from a minimal dev-shaped env in the authoring worktree; that verdict shape no longer exists. Re-run per-target against the deployment before §2 | N/A (read-only check) |
| Billing integrity check clean | Owner (non-production DB target) | `npx tsx scripts/billing-integrity-check.ts` (implemented in #219 — see §6). To hand the result to the readiness harness, save the WRAPPER shape `{"exitCode": <process status>, "report": <the script's stdout JSON>}` — the script carries its exit code only as a process status, which a saved stdout file would lose. The flat `{"exitCode": n, "violations": []}` shape is still accepted, but never both at once (the harness refuses a file carrying two candidate violation lists). The harness also holds a wrapper to the script's own contract: `report.violationCount` must equal `report.violations.length`, and `exitCode` must be `3` when violations were found and `0` when clean | Not run against any shared database this session; the script landed on `main` in P8a (#219, b7797bde) — run it against the target DB immediately before §2 | N/A (read-only check) |

**Readiness harness — evidence source and expected exit code per target (PR-4).** `--target` and `--env-source` are both REQUIRED; the first output line always names the source, and the JSON `provenance` block names the exact URL or file every fact came from.

| `--target` | Required `--env-source` | Other required evidence | Exit 0 means |
|---|---|---|---|
| `dark` | `deployed` (or `env-file` supplemented by a saved health response) | `--environment preview\|production`, deployed `/api/health` of that origin, and — with `--env-source deployed` — `--cron-secret-env <NAME>`, because the CLI always reads `GET /api/billing/readiness` and has no secret without it | that deployment is dark, plan-env-consistent, and schema-ready |
| `rehearsal` | `deployed` **only** | `--environment preview` (**required, and pinned to the target**), `--cron-secret-env`, `--bypass-secret-env`, `--env-file` (+`--git-branch`), `--webhook-endpoint-file`, `--portal-config-file`, `--cron-proof-file`, `--integrity-report` | the Preview deployment is configured for the test-mode rehearsal |
| `activate-topups` | `deployed` **only** | same, with `--environment production` (**required**) and live-mode exports | Production is ready for the FIRST switch (all four switches still unset) |
| `activate-subscriptions` | `deployed` **only** | same | Production is ready for the subscriptions switch (`BILLING_TOPUPS_ENABLED` may already be `true`; D11 switches must not be) |

**`--environment` is not a label, it is a claim the deployment can contradict.** It is REQUIRED for every target and pinned to it (`rehearsal` ⇒ `preview`; `activate-*` ⇒ `production`; `dark` ⇒ either) — a mismatch is exit 6 before any evidence is read. It is also what unlocks the Preview-only allowance to read the billing block out of a 503/degraded health body, so an activation target can never be run with `--environment preview` to obtain that allowance. On top of the parse rule the harness compares it against the deployment's own `vercelEnv` (`environment_matches_deployment`), and requires `/api/health` and `/api/billing/readiness` to report the same `gitSha` (`deployment_sha_consistent`) — two reads that landed on different deployments are not evidence about one.

Exit codes: **0** target met · **4** target NOT met (evidence was readable and says so) · **5** evidence missing or unreadable (absent/invalid file, unreachable or 401 readiness endpoint, unreadable health URL, deployed commit not present locally) · **6** the evidence source cannot prove this target (`--env-source env-file`/`local` for any non-`dark` target, `--developer`, or an invocation that never establishes a target/source). The code latches upward only — a later "met" never erases an earlier unreadable-evidence finding. `--env-source local` requires `--developer`, prints `EVIDENCE SOURCE: local developer shell — NOT deployed proof`, and can never exit 0.

**Stop condition:** if any row above is not confirmed true immediately before starting §2, stop and resolve it first. Do not proceed on an assumption.

## 2. Stripe resources — test mode on Preview FIRST, live only after a full Preview rehearsal

**Owner:** the person with access to the Stripe account that owns the shared Luster billing product catalogue (same account as the existing legacy and Connect endpoints — verify with `stripe config --list`). **Do this twice**: once in Stripe **test mode** (used by Preview, `BILLING_PLAN_ENV=test`), and again in **live mode** (used by Production, `BILLING_PLAN_ENV=prod`) only after the test-mode rehearsal in §7 has fully passed. Every id below is captured into the `BILLING_STRIPE_PRICE_IDS` carrier in §4 — **never committed to git** (contract §4).

### 2.1 Products and Prices — monthly and annual, every paid plan

All amounts CAD, `tax_behavior: exclusive` (contract §3.7 — tax display is "plus applicable taxes"; live tax collection itself stays off per §7 until D11(2)). Source: `src/libs/billing/billingOffers.ts` (`BILLING_OFFERS`).

| Offer key | Plan | Cadence | Amount (CAD) | Stripe Price recurring interval |
|---|---|---|---:|---|
| `starter_2026_08_monthly` | Starter | monthly | $14.99 | month |
| `starter_2026_08_annual` | Starter | annual | $149.90 | year |
| `pro_2026_08_monthly` | Pro | monthly | $24.99 | month |
| `pro_2026_08_annual` | Pro | annual | $249.90 | year |
| `elite_2026_08_monthly` | Elite | monthly | $44.99 | month |
| `elite_2026_08_annual` | Elite | annual | $449.90 | year |

Command (repeat per row, live vs test mode selected by which API key you export):
```
stripe products create --name "Luster <Plan>" --description "Luster <Plan> plan"
stripe prices create --product <prod_id> --currency cad --unit-amount <cents> \
  --recurring[interval]=<month|year> --tax-behavior exclusive
```
**Verification:** `stripe prices list --product <prod_id>` shows exactly one active recurring Price at the amount above; `unit_amount` in cents matches the table exactly (e.g. `1499` for $14.99). Cross-check against `src/libs/billing/billingOffers.ts` — this table is generated from that file's committed values, not invented here.
**Rollback:** deactivate the Price (`stripe prices update <id> --active=false`); Stripe Prices cannot be deleted once used. An inactive Price still resolves for existing subscribers but cannot be selected for new Checkout Sessions.

### 2.2 Founding first-term Coupon — 40% off, `once`, against the standard ANNUAL Price only

**Contract §3.4 is binding and MUST NOT be violated:** the founding first annual term equals 6 monthly payments (60% of the standard annual Price), so the Stripe implementation is **40% off, duration `once`**, applied only to annual-cadence subscriptions. **Do NOT create a 50%-off coupon** — that produces $74.95 / $124.95 / $224.95, which the contract explicitly rejects (test vectors in `src/libs/billing/promotions.test.ts` assert the correct $89.94 / $149.94 / $269.94 instead).

Command — **the `--id` is mandatory** (X1):
```
stripe coupons create --id coupon_founding2026 --percent-off 40 --duration once --name "Founding annual (40% off, first term)"
```
**⚠️ Never let Stripe generate the coupon id.** The price-id carrier only accepts identifiers matching `^(?:price|coupon|promo)_[A-Za-z0-9]{8,}$` (`isConfiguredStripeId`, `src/libs/billing/stripePriceCarrier.ts`), and a Stripe-generated coupon id is a short random token that does not match. A carrier containing one is rejected wholesale at boot (`BILLING_STRIPE_PRICE_IDS_INVALID`), which fails the whole deployment — not just the coupon. Pass `--id coupon_<8+ alphanumeric characters you choose>` and validate the finished carrier with the readiness harness BEFORE deploying it.
**Verification:** `stripe coupons retrieve <coupon_id>` shows `percent_off: 40`, `duration: "once"`. Compute the discounted first-term amount for each annual Price and confirm it equals the table below — **reject the deploy if any amount does not match**:

| Plan | Standard annual | Founding first term (40% off) |
|---|---:|---:|
| Starter | $149.90 | $89.94 |
| Pro | $249.90 | $149.94 |
| Elite | $449.90 | $269.94 |

The promotion's redemption window (`startsAt`/`endsAt`/`maximumRedemptions` in `src/libs/billing/promotions.ts`) stays `null` (closed) until separately configured — creating the Stripe Coupon does not open the window; `billing_promotion_claim` (the transactional, authoritative gate) is what actually admits a redemption, and it reserves before Checkout regardless of any Stripe-side promotion-code limit.
**Rollback:** `stripe coupons delete <coupon_id>` (safe — Stripe permits deleting an unused Coupon; once redeemed, deactivate instead by removing it from the carrier so new Checkout Sessions stop referencing it).

### 2.3 Top-up one-time Prices — seven, versioned, never discounted by the promotion

Source: `src/libs/billing/topupOffers.ts` (`TOPUP_OFFERS`).

| Offer key | Audience | Credits | Amount (CAD) |
|---|---|---:|---:|
| `topup_100_free_2026_08` | Free plan | 100 | $6.99 |
| `topup_250_free_2026_08` | Free plan | 250 | $15.99 |
| `topup_500_free_2026_08` | Free plan | 500 | $29.99 |
| `topup_100_paid_2026_08` | Paid plans | 100 | $5.99 |
| `topup_250_paid_2026_08` | Paid plans | 250 | $13.99 |
| `topup_500_paid_2026_08` | Paid plans | 500 | $26.99 |
| `topup_1000_paid_2026_08` | Paid plans | 1,000 | $49.99 |

Command (one-time Price, no `recurring` block):
```
stripe prices create --product <topup_prod_id> --currency cad --unit-amount <cents> --tax-behavior exclusive
```
**Verification:** seven active one-time Prices exist, amounts match exactly; none carries a `recurring` object (a recurring top-up Price would silently create an unintended subscription at Checkout).
**Rollback:** deactivate (`--active=false`); never delete a Price already referenced by a completed purchase (`sms_topup_purchase` rows keep the price snapshot for history regardless).

### 2.4 `stripe-billing` webhook endpoint — EXACTLY the 13 contracted event types

**Do not create this endpoint until §2.1–§2.3 and §3 are complete.** Source of truth for the event list: `src/libs/billing/billingWebhookEvents.ts` (`BILLING_WEBHOOK_HANDLED_TYPES`), extracted in this same PR from `src/app/api/webhooks/stripe-billing/route.ts` so the list has exactly one owner. The endpoint's Stripe-side event selection MUST be narrowed to precisely these 13 — no broader "all events", no platform-wide `charge.*`/`invoice.*`:

```
checkout.session.completed
checkout.session.expired
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.payment_succeeded
invoice.payment_failed
charge.refunded
refund.updated
charge.dispute.created
charge.dispute.closed
```

Command:
```
stripe webhook_endpoints create \
  --url https://<app-origin>/api/webhooks/stripe-billing \
  --enabled-events checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.payment_succeeded,invoice.payment_failed,charge.refunded,refund.updated,charge.dispute.created,charge.dispute.closed
```
**Capture the signing secret immediately** (`whsec_...` shown once at creation, or `stripe webhook_endpoints retrieve <id>` in the dashboard) — this becomes `STRIPE_BILLING_WEBHOOK_SECRET` in §4. Store it only in the Vercel environment variable UI/CLI, never in a file, chat message, or this document.
**Verification:** `stripe webhook_endpoints list` shows the new endpoint's `enabled_events` array has exactly 13 entries matching the list above (order-independent) and no others. Save the **object export** of `stripe webhook_endpoints retrieve <id>` — a single JSON OBJECT containing `id`, `url`, `livemode`, `status`, and `enabled_events` — outside the repository (exclude the signing secret; keep any Preview bypass query private); §5 supplies it to the readiness harness via `--webhook-endpoint-file` as independent Stripe-side evidence. A bare array is rejected by the harness: a list export cannot say which endpoint the facts belong to. The source-code list alone cannot prove this dashboard configuration.

**Verifying that the secret is PROVISIONED — never by reading its value.** Two evidence forms, both value-free, and no other form is acceptable:
- `vercel env ls` for the target environment shows the NAME `STRIPE_BILLING_WEBHOOK_SECRET` (provisioning evidence), and the deployed readiness endpoint reports `webhookSecretConfigured: true` with `webhookSecretDistinct: true` (runtime evidence, computed in-process — the values never leave the deployment).
- An **unsigned POST probe** against the deployed webhook: `curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://<origin>/api/webhooks/stripe-billing -d '{}'`. `400` (`INVALID_SIGNATURE`) proves the secret IS set; `503` (`WEBHOOK_NOT_CONFIGURED`) proves it is NOT. The route mutates nothing on either path, so this probe is safe to run against a live deployment.

Never paste the `whsec_` value into a shell, a file, a PR, a chat message, or this document. The readiness harness no longer reads it and cannot be made to.
**Rollback:** `stripe webhook_endpoints update <id> --disabled` (endpoint stops receiving events; the route itself also fails closed the moment `STRIPE_BILLING_WEBHOOK_SECRET` is removed from Vercel — see §9).

### 2.5 Customer Portal configuration — D16: no plan/price switching

**D16 (plan §6) is binding:** the Stripe Customer Portal MUST NOT allow plan or price switching (that would bypass the catalogue's offer/promotion engine entirely and reintroduce G02 — an un-cross-checked price change with no local record). Configure the portal to expose ONLY:
- payment method update,
- invoice history,
- subscription cancellation.

Command (or Stripe Dashboard → Settings → Billing → Customer portal):
```
stripe billing_portal configurations create \
  --features[payment_method_update][enabled]=true \
  --features[invoice_history][enabled]=true \
  --features[subscription_cancel][enabled]=true \
  --features[subscription_update][enabled]=false \
  --features[subscription_pause][enabled]=false \
  --business-profile[headline]="Manage your Luster billing"
```
Mark this configuration as the account's **default/active** configuration for the mode you are in (test or live) — `src/app/api/billing/portal/route.ts` creates portal sessions without an explicit `configuration` id, so it always uses whatever is marked default for that mode.
**Verification:** `stripe billing_portal configurations list` shows the new configuration with `features.subscription_update.enabled: false`; open a portal session for a test customer (Preview, test mode only) and confirm no "Update plan" control is visible, only payment method / invoices / cancel.
**Rollback:** `stripe billing_portal configurations update <id> --active=false` and re-activate whatever configuration was previously default.

## 3. Legacy endpoint hygiene (D7, ops-only — read this section fully before acting)

**Updated 2026-09-16: the code-level isolation guard IS now in place.** The owner ratified the narrow D19c amendment and the legacy route carries the Rev 2.3 §5 isolation exception — a new-track Checkout Session or Subscription is never projected onto a salon row. G24 is closed in code. This section remains worth doing as defence in depth: ops-side event filtering means the legacy endpoint never even receives those events, so the guard is a backstop rather than the only line. Deleting retired legacy code remains separate P9 work, and the isolation exception does not advance it.**

**Verification command (corrected, PR-4):** `git grep -n 'checkout.sessions.create' -- src/`. The original command in this row (`grep -rl 'stripe.checkout.sessions.create' src/app/api`) searched only the route tree and therefore missed the DEPOSIT creators in `src/libs/depositCheckout.ts` and `src/libs/depositHoldReaper.ts`. Those two are **not** a legacy-plan Checkout path — they create Sessions **on the connected account** for appointment deposits — but any verification of "what creates a Checkout Session" must see them, or the next person re-derives a false inventory.

**What the corrected command shows (read-only, this worktree):** the only PLATFORM-account Checkout Session creators are `src/app/api/billing/checkout/route.ts` and `src/app/api/billing/checkout/topup/route.ts`, plus the two connected-account deposit creators named above — **no code path creates a new LEGACY plan Stripe Checkout Session any more.** Every `checkout.session.completed` event Stripe will ever emit going forward is a new-track (`plan_subscription` or `sms_topup`) session. The legacy handler (`src/app/api/webhooks/stripe/route.ts`, `handleCheckoutSessionCompleted`) is purpose-blind: it sets `salon.billingMode='STRIPE'`, `stripeCustomerId`, `stripeSubscriptionId`, `stripeCustomerEmail` for **any** session carrying `metadata.salonId` — which every new-track Checkout Session also carries.

**Step 3.1 — remove `checkout.session.completed` from the legacy endpoint's event selection.** Because nothing legitimate produces this event for the legacy endpoint any more, this is a full, safe closure of that specific exposure.
- **Owner:** same Stripe account owner as §2.
- **Command:** `stripe webhook_endpoints update <legacy_endpoint_id> --enabled-events <current list minus checkout.session.completed>` (Stripe's API requires the full replacement list — read the current list first with `stripe webhook_endpoints retrieve <legacy_endpoint_id>`).
- **Verification:** `stripe webhook_endpoints list` shows the legacy endpoint's `enabled_events` no longer includes `checkout.session.completed`. Provision the `stripe-billing` secret (§4) and, on a **test-mode** rehearsal, complete one new-track Checkout Session; confirm the legacy endpoint's delivery log (Stripe Dashboard → Developers → Webhooks → legacy endpoint → recent deliveries) shows no `checkout.session.completed` delivery for that session, while `stripe-billing`'s log shows it.
- **Rollback:** re-add `checkout.session.completed` to the legacy endpoint's `enabled_events` if a not-yet-identified legitimate legacy Checkout flow turns up (search the codebase again for `stripe.checkout.sessions.create` before assuming this is still true at rollback time — code can change between when this runbook was written and when it is executed).

**Step 3.2 — `customer.subscription.*` / `invoice.*`: do not remove them.** Existing legacy subscriptions require those lifecycle events. Stripe cannot filter them per subscription, so configuration-only filtering cannot isolate a new-track subscription. **For this class of event the code guard is the only line of defence** — step 3.1's endpoint filtering does not help here, so read that section's "defence in depth" framing as applying to `checkout.session.completed` only.
- **Status (2026-09-16): closed in code.** The owner ratified the narrow D19c amendment and `syncSubscription` now returns before any write for a subscription carrying `metadata.purpose = 'plan_subscription'` or having a `billing_subscription` row. This was previously an activation blocker; it is no longer one.
- **Residual risk, now bounded:** a new-track subscriber's salon row can gain stale legacy writes only if BOTH the marker is absent (stripped or dashboard-edited) AND no `billing_subscription` row exists for that subscription id. The second condition cannot hold for a subscription this track created.
- **Verification before activation:** confirm the deployed commit contains the guard (the route is pinned to a reviewed postimage in CI), and that migration `0069_billing_credit_foundation` has been applied in the target environment — the guard reads `billing_subscription`, so an environment deployed past it but not migrated would fail every legacy subscription and invoice event.

**Verify overall legacy endpoint state:** `stripe webhook_endpoints list` — the legacy endpoint's URL, and confirm its `enabled_events` no longer includes `checkout.session.completed` after step 3.1.

## 4. Environment provisioning on Vercel, per environment

**Owner:** whoever holds Vercel project access (`sniperstopsnipings-projects / isla-nail-studio`, per the vercel-mcp-connector memory — env provisioning is CLI/dashboard only, no MCP tool for this). Do this AFTER §2 and §3, and complete every row for one environment (Preview, test mode) before touching Production.

| Variable | Preview value | Production value | Command |
|---|---|---|---|
| `BILLING_STRIPE_PRICE_IDS` | JSON below, `env: "test"`, test-mode ids from §2 | JSON below, `env: "prod"`, live-mode ids from §2 | `vercel env add BILLING_STRIPE_PRICE_IDS preview` (paste JSON on prompt); repeat `... production` |
| `STRIPE_BILLING_WEBHOOK_SECRET` | test-mode endpoint secret from §2.4 | live-mode endpoint secret from §2.4 | `vercel env add STRIPE_BILLING_WEBHOOK_SECRET preview` / `... production` |
| `BILLING_IDENTITY_HMAC_SECRET` | fresh random secret, ≥32 bytes, generated locally (`openssl rand -base64 32`), never reused from Clerk/Stripe/OAuth | separate fresh secret from Preview's | `vercel env add BILLING_IDENTITY_HMAC_SECRET preview` / `... production` |
| `BILLING_IDENTITY_HMAC_VERSION` | `1` | `1` | `vercel env add BILLING_IDENTITY_HMAC_VERSION preview` / `... production` — see [BILLING_IDENTITY_KEY_LIFECYCLE.md](BILLING_IDENTITY_KEY_LIFECYCLE.md) |
| `CRON_SECRET` | already provisioned (shared by the other crons) | already provisioned | `vercel env ls CRON_SECRET` to confirm presence only — do not rotate this as part of billing activation |
| `BILLING_DEPLOYMENT_MARKER` | **optional** (but see the rehearsal note below); a short opaque label unique to this deployment — letters, digits, dot, underscore, hyphen; 1–64 characters, validated as `/^[\w.-]{1,64}$/` in `src/libs/Env.ts`, e.g. `preview-isla` | **optional**; a different label from Preview's | `vercel env add BILLING_DEPLOYMENT_MARKER preview` / `... production` — **set only after the stamping deploy** (see below) |

**`BILLING_DEPLOYMENT_MARKER` — set only after the stamping deploy.** Preview shares one test-mode Stripe account with every other deployment of this codebase, so two deployments can hold the same salon id and stamp the same `metadata.purpose`. When this variable is set, `/api/webhooks/stripe-billing` additionally requires every object it processes to carry `metadata.luster_deployment` equal to it; an **absent** marker counts as foreign too. The stamping side ships in PR-3 — until a deploy that stamps sessions, subscriptions and customers is live, setting this variable would make the endpoint classify its own in-flight objects as `ignored_foreign` and drop them. Order: deploy the stamping code → set the variable → redeploy. Leaving it unset is fully supported and is exactly the behaviour that existed before the variable (ownership then rests on `metadata.purpose` plus a local salon/row).

**A locally stored row outranks the marker**, so setting the variable for the first time does not strand objects this deployment already owns: a `billing_subscription` row for the subscription, or a `billing_checkout_attempt` bound to the session, is proof this deployment created and projected it, and such an event is processed even though its metadata carries no marker (or a different one). Only objects with no local row are classified `FOREIGN_DEPLOYMENT`. The `purpose` check still applies in every case.

**Required before the Isla Preview rehearsal on a SHARED Stripe test account.** With the marker unset, ownership rests on `metadata.purpose` plus a local salon id — and `purpose` is the same literal in every deployment of this codebase, so another deployment's marked subscription for a salon whose id also exists here would be projected locally (HANDOFF X2, a pre-existing hazard this PR narrows but cannot close on its own). Either set this marker on both deployments after their stamping deploys, or use a dedicated Stripe Sandbox for the rehearsal (owner decision O5). Production, which does not share its live-mode account, may leave it unset.
| `CRON_SECRET` | **NOT already provisioned on Preview** — provision it **branch-scoped** for the rehearsal branch | already provisioned (shared by the other crons) | Production: `vercel env ls CRON_SECRET` to confirm presence only — do not rotate this as part of billing activation. Preview: `vercel env add CRON_SECRET preview <branch>`. Correction (PR-4): the earlier "already provisioned" claim was true of Production only. `CRON_SECRET` is absent from `src/libs/Env.ts` entirely (it is read via bare `process.env`, and `src/libs/billing/cronAuth.ts` fails closed when unset), so a Preview deployment without it answers **401** to every manual cron invocation AND to `GET /api/billing/readiness` — the readiness harness reports exit 5, not a verdict |
| `NEXT_PUBLIC_APP_URL` | the Preview deployment's own origin | the production origin | `vercel env add NEXT_PUBLIC_APP_URL preview <branch>` / `... production`. **Set this BEFORE the build that will serve the rehearsal** — it is a `NEXT_PUBLIC_*` variable and is inlined at build time, so adding it after the build has no effect until a redeploy. All three billing routes fall back to `http://localhost:3000` unconditionally when it is unset, which would send a test-mode Checkout success/cancel and the portal return to localhost. Verify with the readiness endpoint's `appOrigin`, which must equal the deployment origin |
| `LUSTER_NONPROD_DB_HOSTS` | the Preview Neon host (local shell only, not a Vercel variable) | n/a | `export LUSTER_NONPROD_DB_HOSTS=<preview neon host>` in the shell that runs `scripts/billing-integrity-check.ts` against Preview. Without it the script's non-production database guard refuses the target (X6) and the `--integrity-report` evidence cannot be produced at all |
| `REDIS_URL` | required on the branch scope | already provisioned | `vercel env add REDIS_URL preview <branch>`. Super-admin login and rate limiting need it on any hosted deploy (§6), and `/api/health` counts redis in `criticalChecksPass` for hosted runtimes — without it Preview health is `degraded`/503 (the readiness harness reads the billing block out of that 503 only with `--environment preview`; see §5) |
| `SUPER_ADMIN_AUTH_MODE` + `SUPER_ADMIN_TEST_PHONE` / `SUPER_ADMIN_TEST_PASSWORD` / `SUPER_ADMIN_TEST_LOGIN_ENABLED` + `LEGACY_OTP_AUTH_ENABLED=false` | required on the branch scope for any step that needs a super-admin session (§6 starter grant) | already provisioned | `vercel env add <NAME> preview <branch>`. These are exactly the five variables `/api/health`'s `passwordAuthEnv` check requires; the phone must match a `super_admin` row in the PREVIEW database. The rehearsal seed deliberately never creates a super-admin |

`BILLING_STRIPE_PRICE_IDS` JSON shape (contract §4, `src/libs/billing/stripePriceCarrier.ts`) — **`env` MUST equal that environment's `BILLING_PLAN_ENV` exactly, or boot rejects it** (`environmentIsolation.ts`'s `assertProviderEnvironmentIsolation`, `BILLING_STRIPE_PRICE_IDS_ENV_MISMATCH`):
```json
{
  "env": "test",
  "offers": {
    "starter_2026_08_monthly": "price_...",
    "starter_2026_08_annual": "price_...",
    "pro_2026_08_monthly": "price_...",
    "pro_2026_08_annual": "price_...",
    "elite_2026_08_monthly": "price_...",
    "elite_2026_08_annual": "price_..."
  },
  "topups": {
    "topup_100_free_2026_08": "price_...",
    "topup_250_free_2026_08": "price_...",
    "topup_500_free_2026_08": "price_...",
    "topup_100_paid_2026_08": "price_...",
    "topup_250_paid_2026_08": "price_...",
    "topup_500_paid_2026_08": "price_...",
    "topup_1000_paid_2026_08": "price_..."
  },
  "coupons": {
    "founding_annual_2026": "coupon_..."
  }
}
```

**⚠️ BOLD WARNING — provisioning `STRIPE_BILLING_WEBHOOK_SECRET` makes the route LIVE immediately on the next deploy/redeploy that picks it up.** The route (`src/app/api/webhooks/stripe-billing/route.ts`) does **not** consult `BILLING_SUBSCRIPTIONS_ENABLED` or `BILLING_TOPUPS_ENABLED` at all — it is gated **only** by whether this secret is set (`if (!secret) return 503`). The moment this variable is present in a deployed environment and Stripe has a matching endpoint delivering events, the route processes them and grants credits in-process, regardless of the `BILLING_*_ENABLED` switches' state. Provision it deliberately, on purpose, as its own step — never as an incidental side effect of a bulk env sync.

**Verification (per environment, after deploy)** — see the per-target table in §1 for exit-code semantics:
```
npx tsx scripts/billing-readiness-check.ts --target dark --env-source deployed \
  --environment <preview|production> \
  --cron-secret-env <NAME OF THE ENV VAR HOLDING CRON_SECRET> \
  --health-url https://<that-environment-origin>/api/health
```
`--cron-secret-env` is required with `--env-source deployed` for **every** target, `dark` included: a deployed run always reads `GET /api/billing/readiness`, and without the secret that read is a 401 — exit 5, not a verdict. On Preview add `--bypass-secret-env <NAME>`. `--environment` is required for every run, deployed or not.
For the rehearsal or an activation target, `--env-source deployed` is the ONLY accepted source and the evidence set is larger:
```
npx tsx scripts/billing-readiness-check.ts --target rehearsal --env-source deployed \
  --environment preview --health-url https://<preview-origin>/api/health \
  --bypass-secret-env VERCEL_AUTOMATION_BYPASS_SECRET --cron-secret-env PREVIEW_CRON_SECRET \
  --env-file <vercel env pull output> --git-branch <branch> \
  --webhook-endpoint-file <endpoint object export> --portal-config-file <portal export> \
  --cron-proof-file <manual invocation proof> --integrity-report <integrity report>
```
`--bypass-secret-env` and `--cron-secret-env` take the NAME of an environment variable, never a value: the CLI reads the value from its own process environment and sends it as a header. Never paste an actual secret value into argv, a PR, a chat message, or this document; the CLI's output never includes one (see `readinessCheck.ts`'s header — checks report booleans, counts and catalogue KEY names only). The carrier is proven by a SHA-256 digest of its id list matching between the pulled env file and the deployment, so no Stripe id is transmitted either.
**Rollback:** `vercel env rm <VAR> <environment>` then redeploy; for `STRIPE_BILLING_WEBHOOK_SECRET` specifically, removing it is the fastest way to take the route back to fail-closed (503) — see §9's rollback priority, which leads with this.

## 5. Dark proofs after deploy

**Owner:** whoever deploys (release is automatic on merge to `main` per repo convention; Preview deploys per-PR).

| Check | Command | Expected |
|---|---|---|
| Health block | `curl -s https://<origin>/api/health \| jq .billing` | `dark: true` requires all four feature switches and `STRIPE_BILLING_WEBHOOK_SECRET` unset. Provisioning the billing secret makes `dark: false` even before feature switches are enabled; `planEnvMatchesRuntime` must remain true. |
| Cron logs (**Production only**) | Vercel Dashboard → project → Cron Jobs → `/api/billing/windows/evaluate` and `/api/billing/reconcile` → recent invocations | Both return `200`. While BOTH switches are off, both bodies are `{"skipped":"BILLING_DISABLED", ...}` (reconcile additionally reports `purged: <n>` — the G13 payload purge runs unconditionally even while dark). **Once `BILLING_TOPUPS_ENABLED` is `true` — which it already is at the `activate-subscriptions` gate, per the D11 switch order in §7 — `/api/billing/reconcile` no longer skips:** it reconciles held top-ups and answers a body with NO `skipped` key, e.g. `{"purged":0,"topups":{…}}`, and `--target activate-subscriptions` requires exactly that (a `skipped` reconcile body there would mean the top-up switch is not actually live on that deployment). `/api/billing/windows/evaluate` gates on `BILLING_SUBSCRIPTIONS_ENABLED` alone and must still answer the dark skip for both `activate-*` targets. Save these two invocations as the `--cron-proof-file` evidence, with top-level `origin` and `gitSha` copied from the same deployment's readiness evidence |
| Cron proof (**Preview**) | **Vercel does not schedule crons for Preview deployments at all**, so there is nothing to read from the dashboard. Invoke each job manually, once, and record the result: `curl -sS -X POST https://<preview-origin>/api/billing/windows/evaluate -H "Authorization: Bearer $CRON_SECRET" -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET"` and the same for `/api/billing/reconcile` | Both return `200`. **Registration in `vercel.json` is not proof on Preview** — a Preview deployment that lists both crons still never runs them, which is exactly why `--target rehearsal` requires this proof file in addition to the registration check. Save both as `{"origin":"https://<preview-origin>","gitSha":"<readiness gitSha>","invocations":[{"path":"…","status":200,"body":{…}}],"recordedAt":"<ISO>"}` for `--cron-proof-file`. `origin` and `gitSha` must match the current deployed evidence, so a proof saved from another deployment or commit is rejected. Every invocation must carry its response **body** (a bare status line cannot distinguish a dark skip from real billing work) and `recordedAt` must be a parseable timestamp. For the two `activate-*` targets the two jobs are held to DIFFERENT bodies, because they gate differently: `/api/billing/windows/evaluate` gates on `BILLING_SUBSCRIPTIONS_ENABLED` alone and must answer the dark skip `{"skipped":"BILLING_DISABLED"}` for both targets, while `/api/billing/reconcile` skips only when NEITHER switch is set — so it must answer the dark skip for `activate-topups`, but for `activate-subscriptions` (where `BILLING_TOPUPS_ENABLED` is already `true` under D11) it reconciles held top-ups and must answer a body with NO `skipped` key, e.g. `{"purged":0,"topups":{…}}`. A `skipped` reconcile body with top-ups on would mean the switch is not actually live on that deployment. A rehearsal, whose switches are deliberately on, requires only that each body be present. Run the commands from a shell whose `CRON_SECRET`/bypass values come from your password store, never typed into a shared terminal history |
| Readiness harness | `npx tsx scripts/billing-readiness-check.ts --target dark --env-source deployed --environment <preview\|production> --cron-secret-env <NAME> --health-url https://<origin>/api/health` (add `--bypass-secret-env <NAME>` on Preview). `--environment` and, for a deployed source, `--cron-secret-env` are both REQUIRED — a deployed run always reads `/api/billing/readiness`, which 401s without the secret. For the rehearsal/activation targets use the full command in §4. | Exit **0** only when every fact the named target requires is proven by the evidence supplied; **4/5/6** otherwise, per the table in §1. This is deployment evidence plus operator-saved provider exports — it is still not provider-account verification of anything outside those exports, and it is never owner authorization. A requested health URL that cannot be read is exit 5; skipped health is never proof. |
| Preview health is `degraded` by design | `curl -s https://<preview-origin>/api/health -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" \| jq '.status, .schemaDrift, .billing'` | A Preview deployment answers **HTTP 503 / `status: "degraded"`** whenever redis, the verified Resend sender or the Google Calendar configuration is absent on the branch scope — the body is complete and correct regardless. Pass `--environment preview` and the harness reads the billing block out of that 503 and reports the aggregate status as an informational check; without `--environment preview` a 503 is treated as unreadable evidence (exit 5), which is the correct behaviour for a Production target. |
| Deployed readiness evidence | `curl -s https://<origin>/api/billing/readiness -H "Authorization: Bearer $CRON_SECRET" \| jq .` (add the bypass header on Preview) | Presence booleans and non-secret facts only: `planEnv`, `planEnvMatchesRuntime`, `vercelEnv`, `gitSha`, `appOrigin`, the four `switches`, `webhookSecretConfigured`, `webhookSecretDistinct`, `stripeKeyMode`, `cronSecretConfigured`, `identityHmacConfigured`, `identityHmacVersion`, `carrier` (counts + SHA-256 digest, never ids), `deploymentMarker`, `timestamp`. The harness requires every one of these fields to be present and correctly typed — a body missing any of them is unreadable evidence (exit 5), not a verdict. **401 without the secret**, and 401 by construction if `CRON_SECRET` is unset on that deployment. Public `/api/health` is unchanged and still exposes exactly two billing booleans. |

**Rollback:** none needed — this section only reads state.

## 6. Isla starter grant (P8a super-admin endpoint; written owner authorization required for `mode: 'apply'`)

**P8a's original standalone CLI-script interface turned out to be structurally unrunnable under `tsx`:** the live credit module chain imports the top-level-await database module, and this repository is CommonJS-typed, so a bare `tsx` process cannot load it. P8a replaces it with an **authenticated super-admin API endpoint** instead: `POST /api/super-admin/billing/starter-grant`, JSON body `{ salonSlug, mode: 'plan' | 'apply', confirmation? }`. **This endpoint landed in #219 (`b7797bde`)** — verify the selected deployment contains it and matches this description (`requireSuperAdmin` guard, rate limit, typed confirmation, no `BILLING_*` switch gate) before relying on it.

- **Owner:** whoever holds written pilot authorization for Isla's starter grant (plan §9: "Isla starter grant via the P8a script" — now the P8a endpoint — is one of the activation-itself preconditions), AND holds a super-admin login.
- **`REDIS_URL` is required for the super-admin login itself on any hosted deployment** (§4 row). Without it the login rate limiter has no backing store and `/api/health`'s `redis` check reads false, so a Preview rehearsal cannot reach `/super-admin` at all — and this step is unreachable, not merely degraded. Provision it on the branch scope before attempting step 1.
- **Guards the endpoint is expected to enforce:** `requireSuperAdmin` (only an authenticated super-admin session can call it); a rate limit; a **typed confirmation** — `apply` mode is refused unless `confirmation` is exactly equal to `salonSlug` (not a boolean flag — the operator must type the slug). Deliberately **no `BILLING_*_ENABLED` switch gate**: granting a starter credit lot is a dark action under contract §20 step 6 (it happens before `platform_communication_control`/billing switches are ever touched), so this endpoint working while every switch is unset is expected, not a defect.
- **Step 1 — `mode: 'plan'` (read-only, always safe to run first):** log in at `/super-admin`, then from that authenticated page's own browser console (so the session cookie is attached automatically — never paste a super-admin session token elsewhere) run:
  ```js
  await fetch('/api/super-admin/billing/starter-grant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ salonSlug: 'isla-nail-studio', mode: 'plan' }),
  }).then(r => r.json());
  ```
  **Verification:** the response's resolved business identity and `alreadyGranted` boolean look correct for Isla's account (right identity, and — on a first run — `alreadyGranted: false`). Review this JSON before proceeding; `plan` mode makes no database write.
- **Step 2 — `mode: 'apply'` (writes, only with written authorization):** repeat with the typed confirmation:
  ```js
  await fetch('/api/super-admin/billing/starter-grant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ salonSlug: 'isla-nail-studio', mode: 'apply', confirmation: 'isla-nail-studio' }),
  }).then(r => r.json());
  ```
  This grants once via the unchanged `grantStarterCredits` (`src/libs/billing/creditGrants.ts`) — idempotent on the existing `starter-grant:{businessIdentityId}` key — and writes an audit row with actor `super_admin`. **Never call `mode: 'apply'` against production without the owner's written authorization recorded separately from this runbook** (plan §7: "never against production without written authorization").
  **Verification:** the response's `ledgerEvidence` (lot id, 100 credits, bucket `starter`) confirms the grant; run `npx tsx scripts/billing-integrity-check.ts` (still a working CLI — unlike the starter-grant script, it does not touch the top-level-await DB chain the same way) afterward and confirm it shows no violations (no duplicate lot, no negative balance, no orphan reservation). A second `mode: 'apply'` call returns `granted: false` — confirms the idempotency key held.
- **Rollback:** **none needed, and none exists by design.** A starter grant is an additive, append-only ledger lot (contract §7.1 — `UPDATE` forbidden by trigger); it is not reversible through this endpoint or any other. If a grant is made in error, correcting it requires the same manual, reviewed, tenant-scoped correction process the communications runbook already describes for missed allowances (`TWILIO_COMMUNICATIONS_RUNBOOK.md`, "Initial 100 free credits" section) — never a direct cache/ledger edit, and never a second call to this endpoint (which the idempotency key already refuses).

## 7. Switch order

Flip **one switch at a time**, in this order, each gated on the proof to its left. **`PUBLIC_PRICING_ENABLED` and `BILLING_TAX_COLLECTION_ENABLED` stay OFF regardless of how far the rest of this runbook proceeds — they are blocked on D11, listed as PENDING below, never defaulted.**

### 7.1 `BILLING_TOPUPS_ENABLED`

**Owner:** authorized to run a real (test-mode) purchase end-to-end.
**Precondition:** positive pre-activation readiness evidence, resolved webhook isolation, and separate written authorization for Preview-only test-mode switches. After enabling Preview, demonstrate Checkout → webhook (`checkout.session.completed`, purpose `sms_topup`) → fulfilment (`sms_credit_ledger` gains a `purchased` lot) → history (`GET /api/billing/topups` returns the purchase; P5a landed in #205). Production remains dark until that rehearsal is recorded as passed.
**Command:** `vercel env add BILLING_TOPUPS_ENABLED preview` (value `true`); after the Preview rehearsal fully passes, repeat for `production`.
**Verification:** before the flip, `npx tsx scripts/billing-readiness-check.ts --target activate-topups --env-source deployed --environment production --cron-secret-env <NAME> …` (full command in §4) must exit **0** — `activate-topups` accepts no other `--environment`. After the flip, the same command with `--target dark` is EXPECTED to exit 4 — that is the switch working, not a regression — and `curl .../api/health | jq .billing.dark` reads `false`. Run `scripts/billing-integrity-check.ts` (§6) — clean.
**Preview note:** flipping this on Preview does not establish that Vercel schedules production crons; Preview crons never run. Exercise `/api/billing/reconcile` manually per §5's Preview cron-proof row.
**Rollback:** `vercel env rm BILLING_TOPUPS_ENABLED <environment>`, redeploy; the route rejects new top-up Checkout attempts again before any Stripe call (`BILLING_TOPUPS_ENABLED !== 'true'`).

### 7.2 `BILLING_SUBSCRIPTIONS_ENABLED`

**Owner:** same, extended to a full subscription-cycle rehearsal.
**Precondition:** the separately authorized Preview-only subscription switch and a complete Preview rehearsal: Checkout → `invoice.payment_succeeded` → credit-window grant (invoke the authenticated evaluation route manually) → reconciliation (invoke its authenticated route manually) reports an EMPTY drift summary. Preview deployments do not establish that Vercel schedules production crons.
**Command:** `vercel env add BILLING_SUBSCRIPTIONS_ENABLED preview` (value `true`); repeat for `production` only after the Preview cycle fully passes.
**Verification:** before the flip, `npx tsx scripts/billing-readiness-check.ts --target activate-subscriptions --env-source deployed --environment production --cron-secret-env <NAME> …` must exit **0** — this target deliberately tolerates `BILLING_TOPUPS_ENABLED=true` (the documented order) while still requiring `PUBLIC_PRICING_ENABLED` and `BILLING_TAX_COLLECTION_ENABLED` to be unset (D11). After the flip: `billing_credit_window` shows one grant for the test subscription; `/api/billing/reconcile`'s next run reports `drift: []` for that subscription id; integrity check clean.
**Preview does not establish production crons.** On Preview, "its next run" means a manual invocation: `curl -sS -X POST https://<preview-origin>/api/billing/reconcile -H "Authorization: Bearer $CRON_SECRET" -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET"`. Record both cron invocations as the `--cron-proof-file` evidence (§5).
**Rollback:** `vercel env rm BILLING_SUBSCRIPTIONS_ENABLED <environment>`, redeploy; new subscription Checkout attempts reject before any Stripe call. Existing subscriptions already created keep their Stripe-side state (Stripe does not "un-create" a subscription because a switch flipped) — the cron simply stops evaluating new windows for them until re-enabled, which is the intended dark-rollback behaviour, not data loss.

### 7.3 `PUBLIC_PRICING_ENABLED` and `BILLING_TAX_COLLECTION_ENABLED` — BLOCKED on D11, PENDING

**Do not flip either of these as part of this runbook.** Contract §12 requires ALL SEVEN of the following approvals before `PUBLIC_PRICING_ENABLED` may be set; plan §6 D11 confirms none has an owner default. Status as recorded in the plan at time of writing:

| # | Approval | Status |
|---|---|---|
| 1 | Feature matrix (Starter/Pro/Elite non-communications differences) | **PENDING** — no artifact |
| 2 | Tax configuration (accountant sign-off) | **PENDING** — required before `BILLING_TAX_COLLECTION_ENABLED` too |
| 3 | Refund/cancellation terms | **PENDING** |
| 4 | Founding promotion window/cap | **PENDING** |
| 5 | Renewal-disclosure copy | **PENDING** |
| 6 | Shared-number consent/STOP copy | Ratified 2026-08-17 per contract lines 264/441 (`SHARED_SENDER_STOP_DISCLOSURE`) — owner should confirm this discharges the §12(6) condition specifically for billing publication, since it is not yet used by any live billing call site |
| 7 | Canada-only launch language | **PENDING** — no artifact anywhere |

Do not infer a start date, cap, or percentage for the founding promotion window (item 4) — `src/libs/billing/promotions.ts`'s `startsAt`/`endsAt`/`maximumRedemptions` stay `null` until the owner supplies them explicitly, at which point they are a values-only change to that file (no code/migration), separately reviewed.

## 8. Post-flip verification and §19 zero-tolerance budgets

**Owner:** whoever flips switches in §7, continuing responsibility afterward.

Contract §19 sets these budgets to **zero**, always, not just at flip time: duplicate starter/monthly/top-up grants; duplicate debits/refunds; unauthorized negative balance; cross-tenant credit/message access; reservation released after proven acceptance. Run `npx tsx scripts/billing-integrity-check.ts` (§6) on a **schedule**, not just once:
- **Daily**, for the first two weeks after any switch flips (manual cron entry or a manually-triggered run — this runbook does not itself add a new Vercel cron for the integrity check; that would be a separate, reviewed change).
- **Weekly** thereafter, indefinitely, while any billing switch is `true`.

**Verification:** each run's exit code is 0 and its output lists zero anomalies of every §19 category above. A non-zero exit or any listed anomaly is an incident — treat it exactly like the existing `Sentry.captureMessage('billing.event_held_anomaly', ...)` / `'billing.duplicate_remote_subscriptions'` alerts already wired into `stripe-billing/route.ts` and `reconcile/route.ts`: investigate before the next scheduled run, never silently re-run and ignore.
**Rollback:** an integrity-check failure is grounds to immediately execute §9 (switches off) while investigating — do not leave switches on while a §19 budget shows non-zero.

## 9. Rollback priority

In strict order — do not skip ahead:

1. **Switches off.** `vercel env rm BILLING_SUBSCRIPTIONS_ENABLED/BILLING_TOPUPS_ENABLED <environment>`, redeploy. Fastest, safest, reversible; new Checkout attempts reject before any Stripe call; existing subscriptions/top-ups already fulfilled are untouched.
2. **Remove or rotate the webhook secret.** `vercel env rm STRIPE_BILLING_WEBHOOK_SECRET <environment>`, redeploy — the route immediately returns `503 WEBHOOK_NOT_CONFIGURED` for every delivery (`stripe-billing/route.ts`'s first check). This is the single fastest way to fully silence the endpoint without touching Stripe's dashboard, and it is independent of the `BILLING_*_ENABLED` switches (§4's bold warning).
3. **Disable the endpoint in Stripe.** `stripe webhook_endpoints update <billing_endpoint_id> --disabled` — stops Stripe from even attempting delivery (reduces retry noise/Sentry alerts if step 2 alone leaves deliveries erroring for a while before someone notices).

**The two billing cron entries in `vercel.json` stay registered through any rollback** (plan §4 P4's "additive guard": `vercel.json` and the CI cron allowlist are additive-only — removing a cron line trips `CI.yml`'s ladder guard). This is intentional and safe: with switches off, both routes immediately return to `200 { skipped: 'BILLING_DISABLED' }` (reconcile still runs only its unconditional G13 payload purge). A registered-but-skipped cron is the same dark contract as an unregistered one from the app's perspective — do not attempt to remove the cron entries as part of a rollback.

## 10. Manual operations

These require a human, on an ongoing basis, once any switch is live — none of them are automated by this track, and none should be treated as "done" by deploying code:

| Queue | Where | What to do |
|---|---|---|
| Anomaly queue | `billing_stripe_event` rows with `status='held_anomaly'` and a populated `last_error` | Investigate each via its `last_error` and event type; most originate from `Sentry.captureMessage('billing.event_held_anomaly', ...)` in `stripe-billing/route.ts` — follow the Sentry alert, not a periodic table scan, as the primary signal |
| Held top-ups | `topups.unbound` array in `/api/billing/reconcile`'s response (when `BILLING_TOPUPS_ENABLED='true'`) | Rows here are `billing_checkout_attempt`s the reconciler could not resolve automatically (no bound Stripe session, or ambiguous state) — manual review against the Stripe Dashboard's Checkout Sessions list for that customer |
| D2 subscription disputes | `billing_stripe_event` rows for `charge.dispute.created`/`charge.dispute.closed` on subscription charges, held with `detail: 'CHARGE_EVENT_HELD_FOR_REVIEW'` / `'DISPUTE_CLOSED_FOR_REVIEW'` | Per contract §6.7 (MAY suspend), these are always a human call — the code never auto-reverses subscription access on a dispute the way it does for a full refund (D2's automated case, P3a) |
| Partial refunds | `billing_stripe_event` rows held with `detail: 'SUBSCRIPTION_CHARGE_PARTIAL_REFUND'` | §6.7's automated "future grants stop" only fires on a FULL refund; a partial refund is always held for a human decision on whether/how much access to adjust |
| Duplicate-remote-subscription alerts | `Sentry.captureMessage('billing.duplicate_remote_subscriptions', ...)` — its `extra` carries the DISTINCT `customers` and every `unprojected` subscription id — also surfaced as `duplicateRemoteCustomers` (a count of customers, not of findings) in `/api/billing/reconcile`'s summary, plus one `unprojected_remote_subscription` **drift** entry per finding (`local` = the Stripe customer id, `remote` = the remote subscription id, `repaired: false`) | Two shapes reach this alert. (1) Two local rows resolving to one Stripe customer — usually the benign cancel → resubscribe history. (2) **A LIVE remote subscription this database never projected**, found by the pass asking Stripe directly (one `subscriptions.list` per distinct local customer id, `status: 'all'`; live = any status other than `canceled`/`incomplete_expired`). Shape (2) is the dangerous one: that subscription is charging the customer while nothing here knows about it — open it in the Stripe Dashboard first. Per §8.5 the reconciler never silently picks one subscription over another and never projects the unknown one: a human must determine which Stripe subscription is authoritative and which to cancel, then let the next `customer.subscription.deleted` event settle the rest |
| Duplicate check unverifiable | `summary.notes` entries `duplicate_check_unverifiable` in `/api/billing/reconcile` (`local` and `stripeSubscriptionId` both carry the Stripe **customer** id, `remote: 'UNRETRIEVABLE'`) | Stripe could not be listed for that one customer this pass, so §8.5 was NOT evaluated for it — it is an absence of evidence, never an all-clear. The pass deliberately continues for every other customer. A single note after a rate-limited minute is expected; the SAME customer noted hour after hour is an investigation (bad customer id on the local row, or a persistent Stripe-side failure) |
| Refund coverage unknown | `billing_stripe_event` rows held with `detail: 'SUBSCRIPTION_REFUND_COVERAGE_UNKNOWN'` — a FULL refund whose invoice line set is STRUCTURALLY unreadable (the invoice carries no `lines.data` array, or a truncated page on an invoice with no id to page against). A transient Stripe paging failure is **not** this: it is retried, and only poisons after 8 attempts (handled through the Anomaly queue row above) | **Nothing was written** — `paid_through` and the §6.7 exclusions are exactly as they were. Retrying will not help: the invoice object itself is the problem. Read the invoice's lines in the Stripe Dashboard; if the refund is genuine, record it with the resolution endpoint: `POST /api/super-admin/billing/refund-evidence` `mode: 'plan'` first, then `mode: 'apply'` with `resolution: 'set'`, the invoice's real `periodStart`/`periodEnd`, and `confirmation` = the typed `invoiceId` |
| Refund of a proration-only invoice | `billing_stripe_event` rows held with `detail: 'SUBSCRIPTION_REFUND_PRORATION_ONLY'` (a FULL refund of an invoice that bills no non-proration subscription line) | Also **zero writes**. A refunded proration has no subscription coverage to exclude, so in most cases this is correctly a no-op and the row can be closed after confirming the invoice in Stripe. If the invoice really did fund a service period, record that period with `resolution: 'set'` via the resolution endpoint (same `plan` → `apply` procedure) |
| Invoice with no subscription lines | `billing_stripe_event` rows held with `detail: 'INVOICE_WITHOUT_SUBSCRIPTION_LINES'` (a paid invoice whose lines are readable but bill no non-proration subscription line for that subscription) | `paid_through` did not move. Confirm in Stripe what the invoice actually billed; a pure proration/invoice-item invoice is expected here and needs no action. If a subscription line was genuinely expected, fix it in Stripe and let the redelivery (or the hourly reconcile's `paid_through_behind` repair) apply it — never patch `paid_through` by hand |
| Invoice with unreadable lines | `billing_stripe_event` rows held with `detail: 'INVOICE_WITHOUT_LINE_PERIODS'` — a paid invoice whose line set is STRUCTURALLY unreadable (no `lines.data` array, or a truncated page with no invoice id to page against). Again **not** the transient case: a Stripe paging failure raises the handler error, so the row goes `failed_retryable` and Stripe redelivers, poisoning only after 8 attempts | `paid_through` did not move. Inspect the invoice object in Stripe — a redelivery cannot fix a malformed object. Once the invoice reads correctly, the hourly reconcile is the repair path: it re-reads the latest paid invoice and applies the same idempotent transition. A POISONED row after repeated paging failures is a Stripe-availability incident, not an invoice problem — work it through the Anomaly queue row above once Stripe is healthy |
| Payment held as already refunded | `billing_stripe_event` rows held with `detail: 'SUBSCRIPTION_PERIOD_REFUNDED'`, and `summary.notes` entries `paid_through_refunded_invoice` in `/api/billing/reconcile` | §6.7 working as designed when the refund is real: the invoice (or an overlapping period) is on record as refunded, so it may not fund coverage or grants. It is a DEFECT only when the refund was reversed or the evidence is wrong — in that case run the resolution endpoint (`plan`, then `apply` with `resolution: 'void'` and the typed `invoiceId`), which restores `paid_through` and re-evaluates windows through the ordinary payment transition. **Known limitation:** an operator `set` is durable only while the invoice's charge is fully refunded (or the invoice has no charge) — on a partially refunded charge the hourly safety net will void it again and alert, which is the automatic O2 behaviour, not a bug. Never hand-edit `audit_log` |
| Paid period start unknown | `billing_stripe_event` rows held with `detail: 'PAID_PERIOD_START_UNKNOWN'` (a paid invoice with refunds on record but no derivable coverage start) | The refund comparison is load-bearing and cannot be made without a start, so the payment is held rather than guessed. Establish the invoice's real period in Stripe; the redelivery (or hourly reconcile) then applies it. If the refund evidence itself is what is wrong, resolve it with the endpoint above first |
| Refund evidence voided | `Sentry.captureMessage('billing.subscription_refund_voided', ...)` — raised automatically when a charge's cumulative `amount_refunded` drops below its `amount`, either by the webhook (`charge.refunded`/`refund.updated`) or by the hourly reconcile safety net (`extra.source: 'reconcile'`, also a `refund_evidence_voided` note) | **Automatic, and always a human review item.** The §6.7 exclusion was voided and the coverage re-applied, so the salon's entitlement is restored — but the charge is now PARTIALLY refunded, which §6.7 leaves as a human decision. Check the charge in Stripe and decide whether any access adjustment is warranted. The void is append-only; nothing was deleted. `extra.reapplied: false` is **not** a problem to fix: after a void the invoice is simply not refunded, and it only means the voided row carried no usable bounds — such a row never lowered `paid_through` in the first place, so there is no coverage to restore and nothing further is required unless the next reconcile reports `paid_through_behind` |
| Foreign-event classifications | `billing_stripe_event` rows with `status='ignored_foreign'` and `last_error` in `FOREIGN_INVOICE` / `FOREIGN_CHARGE` / `FOREIGN_SALON` / `FOREIGN_DEPLOYMENT` | **No action, ever.** These are objects this deployment proved are not its own — a legacy-flow or deposits object (`FOREIGN_INVOICE`/`FOREIGN_CHARGE`), a salon that exists in no database here (`FOREIGN_SALON`), or another deployment's object under `BILLING_DEPLOYMENT_MARKER` (`FOREIGN_DEPLOYMENT`). They are terminal by design: 200 to Stripe, no retry, no Sentry alert, `salon_id` deliberately left NULL. A steady trickle is normal on a shared Stripe account. The only thing worth looking at is a **sudden** flood of `FOREIGN_DEPLOYMENT` right after a deploy — that means the marker was set before the stamping deploy went live (§4), so unset it, redeploy, and let Stripe redeliver |
| `billing.livemode_mismatch` alert | `Sentry.captureMessage('billing.livemode_mismatch', ...)` (rate-limited to one per process per 10 minutes), with `billing_stripe_event` rows in `status='ignored_livemode_mismatch'` | **A wrong-mode endpoint secret** — this deployment is being delivered events it holds no usable key for (a live-mode Stripe endpoint pointed at a test-mode deployment, or the reverse). Nothing was processed and nothing was lost: each delivery is parked in its own durable row. Fix the configuration — the endpoint secret in §4 must come from the Stripe endpoint whose mode matches this deployment's `STRIPE_SECRET_KEY` prefix — then **let Stripe redeliver**; the parked rows are reclaimed automatically on redelivery once the mode matches, and process normally. Never replay by hand (INV-A10), and never "clear" the rows |
| `billing.livemode_indeterminate` alert | `Sentry.captureMessage('billing.livemode_indeterminate', ...)`, with the endpoint answering **HTTP 503 `{ error: { code: 'MODE_INDETERMINATE' } }`** and writing **no row at all** | The deployment cannot decide which Stripe mode it is in: the runtime environment and the `STRIPE_SECRET_KEY` prefix disagree, or the runtime cannot be resolved. The boot-time isolation guard should make this unreachable, so seeing it means a deploy went out with mismatched markers. Fix the environment variables and redeploy; Stripe retries the 503s on its own schedule and nothing needs replaying |
| Reconcile notes | `summary.notes` in `/api/billing/reconcile`'s response — `paid_through_uncomparable`, `paid_through_refunded_invoice`, `refund_evidence_voided`, `refund_evidence_reasserted`, `refund_evidence_uncomparable`, `refund_evidence_unverifiable`, `duplicate_check_unverifiable` | Informational; **never counted as drift and never alerted on**. `paid_through_uncomparable` = the remote invoice's lines were truncated so no comparison was made; `paid_through_refunded_invoice` = the local row is behind because that invoice is refunded (correct, not drift); `refund_evidence_voided` = the safety net retracted evidence Stripe no longer backs (see the row above); `refund_evidence_reasserted` = the OPPOSITE correction — a machine `void` that Stripe now contradicts (the charge is fully refunded) was superseded by a fresh applied row **written by this pass**, so entitlement stops again and `billing.subscription_refunded` was raised with `extra.source: 'reconcile'`; a `super_admin` void is never re-asserted this way, and when a concurrent webhook had already written the same exclusion the pass stays silent (no note, no alert) rather than re-announcing someone else's correction every hour; `refund_evidence_uncomparable` = the re-assert was declined because the invoice's line set is STRUCTURALLY unreadable (`remote: 'LINES_UNREADABLE'` — no `lines.data` array, or a truncated page on an invoice with no id to page against); a merely TRUNCATED line set is no longer declined — the pass pages it through `invoices.listLineItems` and re-asserts on the FULL coverage; `refund_evidence_unverifiable` = the invoice could not be retrieved, or its lines could not be paged, or it bills no subscription line, this pass — re-checked next hour; `duplicate_check_unverifiable` = see its own row above. Only a note that repeats every hour for the same subscription warrants investigation |

## 11. Isla pilot billing checklist (contract §21 billing-relevant items)

Preparation only — this list does not authorize execution. Tick each only with recorded evidence, mirroring the SMS pilot checklist's format (`TWILIO_PILOT_CHECKLIST.md`).

| Done | Check | Evidence needed |
|---|---|---|
| [ ] | Billing APIs remain dark unless separately authorized | `/api/health` `billing.dark` snapshot immediately before and after any unrelated deploy during the pilot window |
| [ ] | Duplicate subscription Checkout reuses the active attempt | Two rapid Checkout attempts for the same salon → one `billing_checkout_attempt` row, second request reuses or returns `ACTIVE_SUBSCRIPTION_EXISTS` |
| [ ] | Live subscription cannot create another subscription | Attempt Checkout again after Isla has an active subscription → `ACTIVE_SUBSCRIPTION_EXISTS`, portal hand-off (P5b merged as #213, c29d8c29) |
| [ ] | Promotion claim cannot reserve twice | Two parallel founding-promotion Checkout attempts for Isla's business identity → exactly one `billing_promotion_claim` reaches `redeemed` |
| [ ] | Isla starter grant made exactly once | `sms_credit_ledger` has exactly one `starter_grant` row for Isla's business identity after §6's `mode: 'apply'` call; a second `mode: 'apply'` call returns `granted: false` |
| [ ] | Reconcile drift report empty for Isla's subscription | `/api/billing/reconcile` run (or its hourly cron) reports no entries in `summary.drift` for Isla's `stripeSubscriptionId` |
| [ ] | Integrity check clean throughout the pilot window | `scripts/billing-integrity-check.ts` run on the §8 schedule, zero anomalies for the whole pilot duration |
| [ ] | Cross-tenant isolation holds | A different salon's admin session cannot read Isla's usage/top-up history or trigger her Checkout/portal (existing `requireAdmin(salonId)` tenancy checks — reconfirm under real pilot traffic, not just the test suite) |
| [ ] | Top-up purchase end-to-end (if `BILLING_TOPUPS_ENABLED` for the pilot) | One real (or test-mode, per pilot authorization) top-up purchase: Checkout → webhook → fulfilment → visible in usage history, credits spend in the documented bucket order |
| [ ] | Subscription cycle end-to-end (if `BILLING_SUBSCRIPTIONS_ENABLED` for the pilot) | One real (or test-mode) subscription: Checkout → invoice → credit-window grant → reconcile empty |

---

**This runbook is a specification, not a log.** As each section is actually executed, the executing owner should record the date, the exact commands run, and their output in a SEPARATE operational record (following the pattern of [billing-gate-c-record.md](billing-gate-c-record.md) §3's reconciliation drift-report demonstration) — do not retroactively edit this document to claim a step was completed.
