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
| Readiness harness green for dark deploy | Anyone with repo access | `npx tsx scripts/billing-readiness-check.ts` (no env needed beyond what the shell already has) | Run locally in this worktree against a minimal dev-shaped env: `readyForDarkDeploy: true`, `readyForActivation: false` (carrier and webhook secret unset, as expected while dark; crons are registered on `main` since #216) — see §5 for the same command run post-deploy | N/A (read-only check) |
| Billing integrity check clean | Owner (non-production DB target) | `npx tsx scripts/billing-integrity-check.ts` (implemented in #219 — see §6) | Not run against any shared database this session; the script landed on `main` in P8a (#219, b7797bde) — run it against the target DB immediately before §2 | N/A (read-only check) |

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

Command:
```
stripe coupons create --percent-off 40 --duration once --name "Founding annual (40% off, first term)"
```
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
**Verification:** `stripe webhook_endpoints list` shows the new endpoint's `enabled_events` array has exactly 13 entries matching the list above (order-independent) and no others. Save an endpoint JSON export containing `id`, `url`, `livemode`, `status`, and `enabled_events` outside the repository (exclude the signing secret; keep any Preview bypass query private); §5 supplies it to the readiness harness as independent Stripe-side evidence. The source-code list alone cannot prove this dashboard configuration.
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

**This section does not close G24. The code-level isolation guard requires owner ratification of D19 because the legacy webhook's byte-frozen checkout and subscription/invoice lifecycle behaviour is part of the approved contract. Do not activate new-track subscriptions until that guard or an owner-approved equivalent is in place; deleting retired legacy code remains separate P9 work.**

**What was verified while writing this document (read-only, this worktree):** `grep -rl 'stripe.checkout.sessions.create' src/app/api` returns only `src/app/api/billing/checkout/route.ts` and `src/app/api/billing/checkout/topup/route.ts` — **no code path creates a new LEGACY Stripe Checkout Session any more.** Every `checkout.session.completed` event Stripe will ever emit going forward is a new-track (`plan_subscription` or `sms_topup`) session. The legacy handler (`src/app/api/webhooks/stripe/route.ts`, `handleCheckoutSessionCompleted`) is purpose-blind: it sets `salon.billingMode='STRIPE'`, `stripeCustomerId`, `stripeSubscriptionId`, `stripeCustomerEmail` for **any** session carrying `metadata.salonId` — which every new-track Checkout Session also carries.

**Step 3.1 — remove `checkout.session.completed` from the legacy endpoint's event selection.** Because nothing legitimate produces this event for the legacy endpoint any more, this is a full, safe closure of that specific exposure.
- **Owner:** same Stripe account owner as §2.
- **Command:** `stripe webhook_endpoints update <legacy_endpoint_id> --enabled-events <current list minus checkout.session.completed>` (Stripe's API requires the full replacement list — read the current list first with `stripe webhook_endpoints retrieve <legacy_endpoint_id>`).
- **Verification:** `stripe webhook_endpoints list` shows the legacy endpoint's `enabled_events` no longer includes `checkout.session.completed`. Provision the `stripe-billing` secret (§4) and, on a **test-mode** rehearsal, complete one new-track Checkout Session; confirm the legacy endpoint's delivery log (Stripe Dashboard → Developers → Webhooks → legacy endpoint → recent deliveries) shows no `checkout.session.completed` delivery for that session, while `stripe-billing`'s log shows it.
- **Rollback:** re-add `checkout.session.completed` to the legacy endpoint's `enabled_events` if a not-yet-identified legitimate legacy Checkout flow turns up (search the codebase again for `stripe.checkout.sessions.create` before assuming this is still true at rollback time — code can change between when this runbook was written and when it is executed).

**Step 3.2 — `customer.subscription.*` / `invoice.*`: do not remove them.** Existing legacy subscriptions require those lifecycle events. Stripe cannot filter them per subscription, so configuration-only filtering cannot isolate a new-track subscription. This is an activation blocker, not an operational monitoring task.
- **Residual risk:** a new-track subscriber's salon row may also gain stale/incorrect legacy `stripeSubscriptionId`/`billingMode` writes from the legacy endpoint, independent of (and inconsistent with) the authoritative `billing_subscription` row the new `stripe-billing` endpoint maintains.
- **Required decision:** ratify a narrowly scoped purpose/isolation guard for both checkout and subscription/invoice lifecycle handling, or approve another contract-compatible isolation design. Monitoring may help detect a breach but cannot make activation safe.
- **Full closure:** only the code-level purpose guard (ignore `metadata.purpose ∈ {plan_subscription, sms_topup}` inside `handleCheckoutSessionCompleted`/`syncSubscription`, contract amendment 'c') closes this completely — that requires owner ratification of D19 and is out of scope for P8c.

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

**Verification (per environment, after deploy):** `npx tsx scripts/billing-readiness-check.ts --health-url https://<that-environment-origin>/api/health` proves only the local dark-deploy configuration plus the observed health response. For activation evidence, use `--mode activation --webhook-event-types-file <redacted Stripe endpoint JSON export>`; its exit code then requires a complete carrier, a distinct billing secret, registered crons, and the exact remote event selection. Never paste the actual secret values into a PR, chat, or this document; the CLI's output never includes them (see readinessCheck.ts's header — checks report booleans/counts/key names only).
**Rollback:** `vercel env rm <VAR> <environment>` then redeploy; for `STRIPE_BILLING_WEBHOOK_SECRET` specifically, removing it is the fastest way to take the route back to fail-closed (503) — see §9's rollback priority, which leads with this.

## 5. Dark proofs after deploy

**Owner:** whoever deploys (release is automatic on merge to `main` per repo convention; Preview deploys per-PR).

| Check | Command | Expected |
|---|---|---|
| Health block | `curl -s https://<origin>/api/health \| jq .billing` | `dark: true` requires all four feature switches and `STRIPE_BILLING_WEBHOOK_SECRET` unset. Provisioning the billing secret makes `dark: false` even before feature switches are enabled; `planEnvMatchesRuntime` must remain true. |
| Cron logs | Vercel Dashboard → project → Cron Jobs → `/api/billing/windows/evaluate` and `/api/billing/reconcile` → recent invocations | Both return `200`, body `{"skipped":"BILLING_DISABLED", ...}` (reconcile additionally reports `purged: <n>` — the G13 payload purge runs unconditionally even while dark) |
| Readiness harness | Dark proof: `npx tsx scripts/billing-readiness-check.ts --health-url https://<origin>/api/health`. Activation evidence: `npx tsx scripts/billing-readiness-check.ts --mode activation --webhook-event-types-file <redacted Stripe endpoint JSON export> --health-url https://<origin>/api/health`. | Dark proof reports `readyForDarkDeploy: true` only while the webhook secret remains unset. This is offline configuration evidence, not provider-account verification or owner authorization. Activation mode exits successfully only with `readyForActivation: true`: a complete carrier, distinct billing secret, registered crons, feature switches still unset, and exact Stripe-side event selection. A requested health URL that cannot be read fails the command; skipped health is not proof. |

**Rollback:** none needed — this section only reads state.

## 6. Isla starter grant (P8a super-admin endpoint; written owner authorization required for `mode: 'apply'`)

**P8a's original standalone CLI-script interface turned out to be structurally unrunnable under `tsx`:** the live credit module chain imports the top-level-await database module, and this repository is CommonJS-typed, so a bare `tsx` process cannot load it. P8a replaces it with an **authenticated super-admin API endpoint** instead: `POST /api/super-admin/billing/starter-grant`, JSON body `{ salonSlug, mode: 'plan' | 'apply', confirmation? }`. **This endpoint landed in #219 (`b7797bde`)** — verify the selected deployment contains it and matches this description (`requireSuperAdmin` guard, rate limit, typed confirmation, no `BILLING_*` switch gate) before relying on it.

- **Owner:** whoever holds written pilot authorization for Isla's starter grant (plan §9: "Isla starter grant via the P8a script" — now the P8a endpoint — is one of the activation-itself preconditions), AND holds a super-admin login.
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
**Verification:** `npx tsx scripts/billing-readiness-check.ts --health-url https://<origin>/api/health` — `dark_switches_unset: false` is now EXPECTED (that is the flip working); `curl .../api/health | jq .billing.dark` reads `false`. Run `scripts/billing-integrity-check.ts` (§6) — clean.
**Rollback:** `vercel env rm BILLING_TOPUPS_ENABLED <environment>`, redeploy; the route rejects new top-up Checkout attempts again before any Stripe call (`BILLING_TOPUPS_ENABLED !== 'true'`).

### 7.2 `BILLING_SUBSCRIPTIONS_ENABLED`

**Owner:** same, extended to a full subscription-cycle rehearsal.
**Precondition:** the separately authorized Preview-only subscription switch and a complete Preview rehearsal: Checkout → `invoice.payment_succeeded` → credit-window grant (invoke the authenticated evaluation route manually) → reconciliation (invoke its authenticated route manually) reports an EMPTY drift summary. Preview deployments do not establish that Vercel schedules production crons.
**Command:** `vercel env add BILLING_SUBSCRIPTIONS_ENABLED preview` (value `true`); repeat for `production` only after the Preview cycle fully passes.
**Verification:** `billing_credit_window` shows one grant for the test subscription; `/api/billing/reconcile`'s next run reports `drift: []` for that subscription id; integrity check clean.
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
| Duplicate-remote-subscription alerts | `Sentry.captureMessage('billing.duplicate_remote_subscriptions', ...)`, also surfaced as `duplicateRemoteCustomers` in `/api/billing/reconcile`'s summary | Per §8.5, the reconciler never silently picks one subscription over another — a human must determine which Stripe subscription is authoritative and which to cancel, then let the next `customer.subscription.deleted` event settle the rest |
| Refund coverage unknown | `billing_stripe_event` rows held with `detail: 'SUBSCRIPTION_REFUND_COVERAGE_UNKNOWN'` — a FULL refund whose invoice line set is STRUCTURALLY unreadable (the invoice carries no `lines.data` array, or a truncated page on an invoice with no id to page against). A transient Stripe paging failure is **not** this: it is retried, and only poisons after 8 attempts (handled through the Anomaly queue row above) | **Nothing was written** — `paid_through` and the §6.7 exclusions are exactly as they were. Retrying will not help: the invoice object itself is the problem. Read the invoice's lines in the Stripe Dashboard; if the refund is genuine, record it with the resolution endpoint: `POST /api/super-admin/billing/refund-evidence` `mode: 'plan'` first, then `mode: 'apply'` with `resolution: 'set'`, the invoice's real `periodStart`/`periodEnd`, and `confirmation` = the typed `invoiceId` |
| Refund of a proration-only invoice | `billing_stripe_event` rows held with `detail: 'SUBSCRIPTION_REFUND_PRORATION_ONLY'` (a FULL refund of an invoice that bills no non-proration subscription line) | Also **zero writes**. A refunded proration has no subscription coverage to exclude, so in most cases this is correctly a no-op and the row can be closed after confirming the invoice in Stripe. If the invoice really did fund a service period, record that period with `resolution: 'set'` via the resolution endpoint (same `plan` → `apply` procedure) |
| Invoice with no subscription lines | `billing_stripe_event` rows held with `detail: 'INVOICE_WITHOUT_SUBSCRIPTION_LINES'` (a paid invoice whose lines are readable but bill no non-proration subscription line for that subscription) | `paid_through` did not move. Confirm in Stripe what the invoice actually billed; a pure proration/invoice-item invoice is expected here and needs no action. If a subscription line was genuinely expected, fix it in Stripe and let the redelivery (or the hourly reconcile's `paid_through_behind` repair) apply it — never patch `paid_through` by hand |
| Invoice with unreadable lines | `billing_stripe_event` rows held with `detail: 'INVOICE_WITHOUT_LINE_PERIODS'` — a paid invoice whose line set is STRUCTURALLY unreadable (no `lines.data` array, or a truncated page with no invoice id to page against). Again **not** the transient case: a Stripe paging failure raises the handler error, so the row goes `failed_retryable` and Stripe redelivers, poisoning only after 8 attempts | `paid_through` did not move. Inspect the invoice object in Stripe — a redelivery cannot fix a malformed object. Once the invoice reads correctly, the hourly reconcile is the repair path: it re-reads the latest paid invoice and applies the same idempotent transition. A POISONED row after repeated paging failures is a Stripe-availability incident, not an invoice problem — work it through the Anomaly queue row above once Stripe is healthy |
| Payment held as already refunded | `billing_stripe_event` rows held with `detail: 'SUBSCRIPTION_PERIOD_REFUNDED'`, and `summary.notes` entries `paid_through_refunded_invoice` in `/api/billing/reconcile` | §6.7 working as designed when the refund is real: the invoice (or an overlapping period) is on record as refunded, so it may not fund coverage or grants. It is a DEFECT only when the refund was reversed or the evidence is wrong — in that case run the resolution endpoint (`plan`, then `apply` with `resolution: 'void'` and the typed `invoiceId`), which restores `paid_through` and re-evaluates windows through the ordinary payment transition. Never hand-edit `audit_log` |
| Paid period start unknown | `billing_stripe_event` rows held with `detail: 'PAID_PERIOD_START_UNKNOWN'` (a paid invoice with refunds on record but no derivable coverage start) | The refund comparison is load-bearing and cannot be made without a start, so the payment is held rather than guessed. Establish the invoice's real period in Stripe; the redelivery (or hourly reconcile) then applies it. If the refund evidence itself is what is wrong, resolve it with the endpoint above first |
| Refund evidence voided | `Sentry.captureMessage('billing.subscription_refund_voided', ...)` — raised automatically when a charge's cumulative `amount_refunded` drops below its `amount`, either by the webhook (`charge.refunded`/`refund.updated`) or by the hourly reconcile safety net (`extra.source: 'reconcile'`, also a `refund_evidence_voided` note) | **Automatic, and always a human review item.** The §6.7 exclusion was voided and the coverage re-applied, so the salon's entitlement is restored — but the charge is now PARTIALLY refunded, which §6.7 leaves as a human decision. Check the charge in Stripe and decide whether any access adjustment is warranted. The void is append-only; nothing was deleted, and `extra.reapplied: false` means there was no usable coverage to restore (repair it with `resolution: 'set'`) |
| Reconcile notes | `summary.notes` in `/api/billing/reconcile`'s response — `paid_through_uncomparable`, `paid_through_refunded_invoice`, `refund_evidence_voided`, `refund_evidence_unverifiable` | Informational; **never counted as drift and never alerted on**. `paid_through_uncomparable` = the remote invoice's lines were truncated so no comparison was made; `paid_through_refunded_invoice` = the local row is behind because that invoice is refunded (correct, not drift); `refund_evidence_voided` = writer 3 corrected retracted evidence (see the row above); `refund_evidence_unverifiable` = the invoice could not be retrieved this pass and will be re-checked next hour. Only a note that repeats every hour for the same subscription warrants investigation |

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
