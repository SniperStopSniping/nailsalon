# Luster Billing, Founding Plans, Shared SMS Credits & Communications
# Canonical Architecture and Implementation Contract — Revision 2.2

---

## 1. Status and scope

This document is the governing contract for the billing / founding-plans / shared-SMS-credits / transactional-communications track. Revision 2 is the accepted base; Revision 2.1 added the review amendments (paid-through window boundary, subscription-status entitlement table, durable credit-window/checkout-attempt/promotion-claim state, durable business identity, HMAC rotation safety, founding rate protection, destination-country resolution); Revision 2.2 completes the omitted amendments (sender-mode-first resolution with BYO continuity, three-case segment reconciliation, expired-lot refund recovery, honest STOP/kill-switch race semantics, server-side billing dark switches, durable low-balance-warning state, corrected production activation order, linear-by-gate PR execution, expanded pilot checks). Every decision not explicitly amended remains unchanged. This supersedes the Rev 1 draft and every prior conflicting statement. Normative keywords MUST / SHOULD / MAY are used in their RFC-2119 sense.

Scope: versioned plan+offer+promotion catalogue, Stripe subscription billing (monthly + annual + founding promotion), append-only SMS credit ledger with concurrency-safe reservations, shared Luster-owned sender, durable communication intents, configurable reminders, shared-number consent, usage/history/ops surfaces, Isla pilot readiness. Out of scope: §24.

**Implementation authorization status: NOT AUTHORIZED.** No application code, migration, branch, PR, provider configuration or production data may change until the owner approves Revision 2.2 and then authorizes each gate (§16) individually. All implementation PRs remain draft until separately reviewed and authorized.

## 2. Current repository baseline (verified read-only against origin/main, 2026-08-16)

| Fact | Value |
|---|---|
| `origin/main` SHA | `29332f9d54351f9d95098dcba43d9b6b0cd134be` |
| Release | v1.55.1 (local checkout is stale at v1.46.0 / `95a6f3a` — MUST NOT be used for implementation) |
| Migration tail | `0068_deposit_credit_tax_snapshots`; ledger pin `FINAL_MIGRATION='0068_deposit_credit_tax_snapshots'`, `MIGRATION_COUNT=69` (`scripts/preview-service-image-fixtures.ts:29-30`) |
| Deposits track | LANDED on main: migrations 0066–0068, ORM mappings (`appointmentDepositSchema`, `salonStripeAccountSchema`, `stripeWebhookEventSchema` in Schema.ts:3240-3449), `/api/webhooks/stripe-connect` route, `/api/integrations/stripe-connect/*` routes, `STRIPE_CONNECT_WEBHOOK_SECRET` env, two deposits crons in vercel.json |
| `awaiting_payment` | EXISTS in `APPOINTMENT_STATUSES` (Schema.ts:2492, migration 0066), deliberately NOT in `ACTIVE_APPOINTMENT_STATUSES`; `depositHoldExpiresAt` column exists. Rev 1's "awaiting_payment missing" conflict is resolved by repo movement. |
| vercel.json | 5 crons (reminders */15, outbox */5, image cleanup, deposits holds/reap */5, deposits reconcile */5). No CI guard on vercel.json exists (deposits track modified it freely). |
| Comms files | `appointmentReminders.ts`, `integrationOutbox.ts`, consent/delivery schemas UNCHANGED 1.46→1.55. `SMS.ts` grew 978→1099 lines (added `SmsSendOptions`, `buildBookingFinancialSmsLines` for deposits, referralId-based claim URLs). Call-site inventory MUST be re-counted at Gate B/C implementation time. |
| Concurrent work | Open PRs #89–93 = L-track booking-page work (UI-scoped, no migrations observed). Release bot pushes to main. Another agent may use the shared local checkout. |
| Rev 1 verified findings that still hold | Stripe subscription webhook at `/api/webhooks/stripe` (no idempotency, full-overwrite sync, never writes plan/features); `PricingPlanList`/`PLAN_ID`/`Subscription.ts`/`organizationSchema` = dead boilerplate; billing checkout route has zero UI callers; `ComparePlansModal` shows fake pricing; three disconnected entitlement resolvers; `guardBillingOr402` unwired; no credit/ledger concepts anywhere; migrations hand-authored (NEVER `drizzle-kit generate`); PGlite 3-layer test isolation; concurrency proofs need the opt-in throwaway-Postgres suite pattern; changed-file test selection maps only sibling tests. |

## 3. Frozen commercial terms (normative)

### 3.1 Monthly plans (CAD, tax-exclusive)

| Plan | Monthly | Monthly SMS credits | Starter credits | Email |
|---|---:|---:|---:|---|
| Free | $0 | 0 | 100 once | Included |
| Starter | $14.99 | 200 | 100 once per eligible business | Included |
| Pro | $24.99 | 400 | 100 once per eligible business | Included |
| Elite | $44.99 | 800 | 100 once per eligible business | Included |

The one-time 100-credit starter grant MUST NOT be re-granted due to: upgrade, downgrade, cancellation, resubscription, settings edits, provider reconnection, settings-row deletion, webhook replay, additional staff users, or a new salon under the same durable business identity. A paid salon that never received it MAY receive it.

### 3.2 Standard annual offers (= ten monthly payments; "Pay annually and get two months free.")

| Plan | Standard annual | 
|---|---:|
| Starter | $149.90 |
| Pro | $249.90 |
| Elite | $449.90 |

### 3.3 Founding annual first-term promotion

| Plan | Founding first annual term | 
|---|---:|
| Starter | $89.94 |
| Pro | $149.94 |
| Elite | $269.94 |

First annual term only; renews at the standard annual price; underlying founding base rate protected 24 months while the subscription is uninterrupted; configurable start date, end date, max redemptions; redeemable once per durable business identity; not regainable via cancel/resubscribe; does not stack with other subscription discounts; does not discount top-ups; renewal amount MUST be disclosed before Checkout; no automatic prorated refund on cancelling renewal — prepaid access continues through `paid_through` subject to the published refund policy and applicable law.

### 3.4 Stripe promotion math (binding)

The annual Price = 10 monthly payments. The founding first term = 6 monthly payments. Therefore the Stripe implementation is **40% off, duration `once`, against the standard annual Price** (6/10 = 60% of annual). Marketing MAY truthfully say "50% off your first year compared with paying monthly." Implementations MUST NOT create a 50%-off annual coupon; test vectors MUST reject $74.95 / $124.95 / $224.95 outcomes and require $89.94 / $149.94 / $269.94.

### 3.5 Top-up offers (Rev 2 prices; Rev 1 prices are stale and void)

| Audience | Credits | Price CAD |
|---|---:|---:|
| Free plan | 100 | $6.99 |
| Free plan | 250 | $15.99 |
| Free plan | 500 | $29.99 |
| Paid plans | 100 | $5.99 |
| Paid plans | 250 | $13.99 |
| Paid plans | 500 | $26.99 |
| Paid plans | 1,000 | $49.99 |

Top-ups: versioned; never discounted by the annual promotion; roll over; spent after expiring allowances and starter value; granted only from verified Stripe payment evidence; replay-safe; retain original offer/price snapshot.

### 3.6 Email policy
"Email confirmations and reminders included." Transactional email consumes no salon SMS credits, is independently configurable, continues when SMS is unavailable/out of credits, is internally tracked (usage, failures, abuse), and is platform rate-limited.

### 3.7 Taxes
Prices display "in CAD, plus applicable taxes." Architecture MUST support Stripe automatic tax across monthly/annual/founding/top-ups with billing country + postal code and tax-exclusive CAD pricing, including invoice-failure states. Live tax collection MUST NOT be enabled until the owner's accountant confirms registrations, jurisdictions, product tax code, treatment and invoice wording (publication gate §12).

### 3.8 Founding acquisition offer
50% off first annual term (vs monthly), free booking-page setup, free service-menu migration, 100 starter credits, email included, 24-month rate protection. Free setup/migration is an operational customer-success promise, not an automated product in this track. No 60-day trials, bonus credits, or coupon stacking unless separately approved.

### 3.9 Founding rate protection (DISTINCT from the first-term promotion)
Two separate concepts that MUST be stored and displayed separately (promotion / rate protection / renewal price — never conflated):
- **First annual promotion**: first annual term only; 40%-off-once against the standard annual Price (§3.4).
- **Founding base-rate protection**: applies to eligible paid Founding customers on monthly OR annual. Store `rate_protected_through` on the billing subscription; the clock begins at the first successfully paid Founding subscription activation instant. Rule: any subscription service period whose START instant is strictly before `rate_protected_through` uses the protected Founding base offer. Consequences: a monthly founder keeps the protected monthly rate throughout the 24-month window; annual term 1 (month 0) and term 2 (month 12) are protected; term 3 (month 24) is not automatically protected; a service period beginning at/after protection end MAY move to then-current pricing after required advance notice; cancellation, lapse, or unpaid termination breaks continuous protection; later resubscription uses current eligible pricing unless separately approved.

## 4. Plan / offer / promotion model

Plan identity, billing cadence/price, and promotions are SEPARATE concepts. Server-only modules under `src/libs/billing/`:

- **`planDefinitions.ts`** — `PlanDefinition { key: 'free_2026_08'|'starter_2026_08'|'pro_2026_08'|'elite_2026_08', family, displayName, monthlySmsCredits, featureBundleKey, active, successorKey? }`. Immutable keys; repricing/reshaping = new key + `active:false` + successor on the old.
- **`billingOffers.ts`** — `BillingOffer { key: '{plan}_{ver}_monthly'|'{plan}_{ver}_annual', planDefinitionKey, cadence: 'monthly'|'annual', priceCents, currency:'cad', activeForNewSubscriptions }`. Free has no offers.
- **`promotions.ts`** — `PromotionDefinition { key: 'founding_annual_2026', eligibleOfferKeys (annual only), percentOffAgainstAnnualPrice: 40, duration: 'once', startsAt, endsAt, maximumRedemptions, rateProtectionMonths: 24 }`.
- **`topupOffers.ts`** — per §3.5, keyed `topup_{credits}_{free|paid}_2026_08`, audience-resolved from the salon's current plan family.
- **`stripePriceMap.ts`** (`server-only`) — offerKey/topupOfferKey/promotionKey → env-specific Stripe Price/Coupon IDs via `BILLING_PLAN_ENV` (dev/test/prod); throws `PRICE_UNCONFIGURED` on empty (all IDs are `''`/`null` placeholders in draft PRs — **no live Price, Coupon or Promotion Code IDs may be committed**); reverse lookups for the webhook.
- Public projections (`getPublicPlanCatalog()`, `getPublicOffers()`) MUST contain no Stripe IDs.

## 5. Legacy entitlement compatibility

The new billing domain MUST NOT write `salon.plan`, `salon.features`, module entitlements, location/staff limits, or any existing production feature access. `legacyPlanAdapter.ts` exposes read-only `describeBillingState()` combining legacy plan (still authoritative for features via the three existing resolvers) with the new `billing_subscription` state. A salon MAY simultaneously be `starter_2026_08` (billing) and legacy `single_salon` (features). Feature-matrix migration is a separately approved future track. Legacy salon Stripe columns (`stripeCustomerId` etc.) remain compatibility projections owned by the existing `/api/webhooks/stripe` route, which stays byte-identical this track.

## 6. Subscription and annual-credit-window state machine

### 6.1 Billing cadence vs credit cadence
`billingCadence: 'monthly'|'annual'`; `smsGrantCadence: 'monthly'` always. Annual subscribers MUST NOT receive one annual grant, 12 months upfront, or invoice-only grants.

### 6.2 `billing_subscription` (Migration A) — key fields
`id, salon_id (FK CASCADE), stripe_subscription_id (UNIQUE), stripe_customer_id, plan_definition_key, billing_offer_key, pending_offer_key, promotion_key, rate_protected_through, status, cancel_at_period_end, paid_through, credit_cycle_anchor, credit_cycle_index, current_credit_window_start, current_credit_window_end, next_credit_grant_at, last_event_created, last_event_id, created_at, updated_at`. Partial unique: one live subscription per salon (`status NOT IN ('canceled','incomplete_expired')`). CHECKs: status vocabulary, key formats, window ordering.

### 6.3 Credit-window algorithm (one deterministic engine for monthly AND annual)
Anchor = original activation instant (day + time preserved). Window N start = anchor + N months computed **always from the original anchor**, clamping day-of-month independently to the target month's final valid day. Jan 31 anchor ⇒ Feb 28/29, Mar 31, Apr 30 — never permanent drift to the 28th. Persist absolute instants (`timestamptz`).

### 6.4 Grants — paid-through boundary (BINDING Rev 2.1 correction)
Credit windows use **half-open interval semantics `[start, end)`**. A window may be granted ONLY when paid entitlement covers the ENTIRE window: **`paid_through >= current_credit_window_end`** (the Rev 2 `paid_through >= window_start` rule is void — equality at window start with an unpaid renewal must not authorize the new month). Grant = the plan's monthly allowance as a `monthly` lot expiring at `current_credit_window_end`, idempotency key **`monthly-grant:{stripeSubscriptionId}:{creditCycleIndex}:{planDefinitionKey}`**. The window engine (dispatch/reconcile cron) is the ONLY granter; Stripe events maintain `paid_through`/status/plan only. Upgrade mid-window: `max(0, newAllowance − alreadyGrantedThisWindow)`, key `upgrade-diff:{subscriptionId}:{creditCycleIndex}:{fromPlanKey}:{toPlanKey}`. Downgrade: `pending_offer_key`, applied at next renewal; no clawback.

### 6.5 Late payment and missed windows
Payment succeeding after the current window began but before it ends: update `paid_through`; if entitlement now covers the FULL current window, grant it exactly once (full allowance, original window start/end preserved, anchor unshifted, no proration in Founding v1). Payment succeeding only after a complete window ended: record that historical window as skipped; never backfill or stack its allowance; grant only the currently active covered window. Monthly included credits never roll over.

### 6.5a Subscription-status entitlement table (normative; drives the credit-window scheduler, billing-status API, sender plan-eligibility, usage UI, and billing reconciliation)

| Stripe status | Entitlement semantics |
|---|---|
| `active` | Paid entitlement through `paid_through`; fully covered windows may be granted |
| `past_due` | Already-prepaid entitlement remains through verified `paid_through`; NO window extending beyond it may be granted; later success follows §6.5 |
| `unpaid` | No new paid windows; entitlement ends per verified Stripe state + `paid_through` |
| `incomplete` | No paid SMS allowance; no assumption of successful payment |
| `incomplete_expired` | No paid allowance; no active paid entitlement |
| `paused` | No new paid allowance absent a separately approved paused-subscription policy |
| `canceled`, prepaid time remaining | Access continues through `paid_through`; windows granted only where fully covered; no renewal |
| `canceled`, past `paid_through` | Paid entitlement ended; no further monthly allowances; starter + purchased credits persist; settings remain saved |
| `trialing` | Founding v1 has no trial product: record anomaly, grant NO paid allowances, require an explicitly approved future trial contract |

### 6.5b Durable credit-window history — `billing_credit_window` (Migration A)
`id, billing_subscription_id, credit_cycle_index, plan_definition_key, window_start, window_end, status (pending|granted|skipped_unpaid|skipped_missed|reversed), grant_ledger_id NULL, idempotency_key UNIQUE, created_at, resolved_at`. This is the durable evidence for exactly-once grants, annual/monthly parity, late-payment behavior, skipped windows, reconciliation and audit/support. Historical grant state MUST NOT be inferred solely from mutable `billing_subscription` fields.

### 6.6 Annual cancellation
Renewal cancellation does not end prepaid access: monthly grants continue through `paid_through`, then stop. Purchased + unused starter credits persist. No automatic prorated refund.

### 6.7 Refunds and disputes (subscription)
Full refund ⇒ future grants stop; unused included credits for no-longer-entitled periods MAY be expired/reversed; consumed credits are never clawed back from sent messages; purchased credits unaffected unless their own purchase is refunded/disputed; a dispute MAY suspend sending and create negative effective availability pending review; self-service partial annual refunds are out of scope.

### 6.8 Required tests
Jan 31 / Feb 28 / Feb 29 / Mar-after-Feb-clamp anchors; leap-year February; DST transitions; monthly and annual subscriber parity; scheduler replay; fully missed window; scheduler outage spanning multiple complete windows; cancel-at-period-end; annual cancellation with prepaid windows remaining; full refund (after prior windows consumed; with current unused allowance); dispute during prepaid annual term; annual renewal failure; **boundary vectors: `paid_through == window_start`, `== window_end`, `== window_end − 1s`, `== window_end + 1s`; late payment during current window; payment after entire window expired**.

## 7. SMS ledger and reservation state machine

### 7.1 Core (carried from Rev 1, still normative)
1 credit = 1 outbound billable SMS segment. Append-only **lot ledger** `sms_credit_ledger`: positive rows = lots with own `expires_at`; negative rows reference `consumed_from_ledger_id`; `idempotency_key UNIQUE` is the financial backbone; UPDATE forbidden by trigger (DELETE only via salon-purge cascade). `sms_credit_account` = per-salon `SELECT … FOR UPDATE` serialization anchor + non-authoritative cache, **plus durable low-balance-warning dedupe state (Rev 2.2): `warning_epoch`, `last_warning_tier`, `last_warning_at`** — grants/top-ups/balance recovery increment `warning_epoch`, deterministically resetting warning eligibility; C4 implements warning dedupe against these Migration-A columns and MUST NOT require a third migration. `sms_credit_reservation` + `_lot` child table. Buckets: starter/monthly/purchased/promotional/administrative/delivery_recovery.

### 7.2 Spending order (locked)
monthly → promotional → delivery_recovery → administrative → starter → purchased; within a class: earliest expiry first, then oldest grant. Expired lots excluded virtually in the reserve query (correctness never depends on the expiry sweep).

### 7.3 Durable business identity, starter grants, and promotion claims (Rev 2.1 restructure)

**Canonical durable business identity.** Current owner email alone is never "the business." Migration A creates **`billing_business_identity`** (`id, created_at, notes`) plus **`billing_business_identity_link`** (`identity_id FK, link_type ('clerk_user'|'salon'|'stripe_customer'|'email_hmac_v{N}'|future verified business identifiers), link_value, UNIQUE (link_type, link_value)`). Resolution preference order when attaching links: (1) verified Clerk owner ID; (2) durable verified business/salon identity; (3) Stripe Customer ID where relevant; (4) versioned keyed HMAC email fingerprint as fallback. Starter-credit grants and founding-promotion claims attach to the business identity, as SEPARATE records sharing resolution logic. Starter key: `starter-grant:{businessIdentityId}`.

- **Owner transfer**: a legitimate transfer MUST NOT reset starter or promotion eligibility; the identity persists unless an audited super-admin business-split decision explicitly creates a new one.
- **Multiple salons**: salons under one durable business do not repeat business-level starter/founding offers.
- **Email normalization for the HMAC fallback**: trim ASCII whitespace; normalize Unicode consistently; lowercase the domain; use the verified mailbox address as supplied by the identity provider; **never strip `+tag`; never remove dots from local parts; no provider-specific equivalence guessing**; one canonical IDNA representation for internationalized domains where library support exists; HMAC the canonical verified representation. Raw email is never stored in anti-abuse tables.
- **HMAC rotation MUST NOT reset eligibility**: a new `BILLING_IDENTITY_HMAC_VERSION` attaches a NEW versioned fingerprint link to the EXISTING identity (old-version fingerprints retained verifiable for the anti-duplication retention horizon); rotation never creates a second business identity. Document key version, activation date, retirement date, retained verification period, deletion process. Secret: dedicated `BILLING_IDENTITY_HMAC_SECRET` (never a reused OAuth/Clerk/Stripe/integration secret; never unkeyed SHA-256).
- **Retention**: starter/promotion anti-abuse records are retained for the minimum period necessary to enforce the published once-per-business offers and financial/audit obligations, with a documented horizon and deletion process.

**Founding-promotion claim lifecycle — `billing_promotion_claim` (Migration A; replaces the Rev 2 redemption-only model).** Fields: `promotion_key, business_identity_id, salon_id, billing_checkout_attempt_id, status (reserved|redeemed|released|expired|rejected), reserved_at, expires_at, redeemed_at, released_at, stripe_checkout_session_id`. Behavior: (1) eligibility is **transactionally reserved BEFORE Stripe Checkout creation**; (2) at most one live-or-redeemed claim per (promotion, business identity); (3) the maximum-redemption cap is enforced transactionally at reserve time; (4) Checkout-creation failure releases the claim; (5) `checkout.session.completed` moves reserved → redeemed; (6) `checkout.session.expired` releases; (7) abandoned claims expire; (8) cancel/resubscribe cannot recreate founding eligibility. Stripe Coupon/Promotion-Code limits MAY serve as a second defense; Luster's transactional claim is authoritative.

### 7.4 Reservation lifecycle (REVISED — settle on acceptance)
```
render final body → calculate predicted segments → verify destination + consent + eligibility
→ atomically reserve credits → COMMIT → call Twilio messages.create()
   ├─ throws before acceptance        → release reservation (no debit)
   └─ returns Message SID             → record SID → SETTLE IMMEDIATELY (debit predicted segments)
        └─ later terminal failed/undelivered/canceled callback → idempotent per-lot refund into
           original buckets w/ preserved expiry semantics (`sms-refund:{resId}:{lotId}`), exactly once
```
Commercial rule: **"Accepted by Twilio consumes the credit; a later terminal delivery failure returns it."** Ordinary accepted sends MUST NOT sit in held reservations awaiting delivery callbacks. `delivered`/`read` callbacks trigger no ledger action. Refundable terminal statuses: `failed`, `undelivered`, `canceled`. Luster absorbs provider cost on refunded sends. Settle keys `sms-settle:{resId}:{lotId}`; refund guard `refunded_at IS NULL` + idempotency keys make replay/reorder safe.

**Refunds after lot expiry (Rev 2.2)**: if the original debited lot is still valid at refund time, refund to the original bucket with its original expiry (key `sms-refund:{reservationId}:{lotId}`). If the source lot EXPIRED before the terminal failure: monthly/starter/promotional/administrative value returns as a **`delivery_recovery`** lot (new bucket value) expiring **30 calendar days after the refund** (key `sms-refund-recovery:{reservationId}:{lotId}`); purchased-credit refunds always return as purchased/non-expiring. A refund MUST never exceed the original debit. `delivery_recovery` slots into the spend order immediately after `promotional` (expiring value spent before starter/purchased).

### 7.5 Unknown send outcome
Worker crash between `messages.create()` and SID record ⇒ intent `send_outcome_unknown`; NEVER re-send. The ordinary reaper MUST skip these. Resolution: (1) adopt SID from a signed status callback carrying the delivery identity; (2) else narrow reconciliation query (recipient + Messaging Service + time window + body fingerprint + delivery identity where available); never guess between plausible messages; settle only on proven acceptance; release only on proven non-send.

### 7.6 Reservation reaper
Releases ONLY clearly pre-send abandoned holds (>15 min, no SID, no delivery row in settling/settled, not `send_outcome_unknown`, no active reconciliation).

### 7.7 Segment reconciliation (Rev 2.2 — complete case set)
When the provider's actual `num_segments` is reconciled against predicted:
- **actual == predicted**: no adjustment.
- **actual > predicted**: the salon is NOT charged additional credits; Luster absorbs the difference; record `segment_mismatch_underpredicted`; immediate operator alert during the pilot; systematic underprediction blocks rollout expansion (§22).
- **actual < predicted**: refund exactly `predicted − actual` credits, exactly once, back to the original valid source lots (per-lot keys **`segment-overpredict-refund:{reservationId}:{lotId}`**); record `segment_mismatch_overpredicted`.
- **actual missing / zero / unusable**: mark the reconciliation unresolved; retry on the reconciliation job's backoff; alert when the unresolved age exceeds the §19 operational budget.
Credits are never adjusted upward post-send in any case.

### 7.8 Top-up fulfillment and reversals
`topup-grant:{stripeCheckoutSessionId}` (purchased lot, no expiry). Refund: reverse `min(unused, refunded)` capped at remaining (`topup-reversal:{refundId}:{lotId}`); partial usage = audited adjustment. Dispute: full reversal (`dispute-reversal:{disputeId}:{lotId}`), MAY go negative; negative availability blocks reservations but a send is never authorized below zero.

## 8. Stripe billing-event state machine

### 8.1 Endpoint and secret
New route **`/api/webhooks/stripe-billing`** (sibling naming per the landed `stripe-connect` convention) with dedicated **`STRIPE_BILLING_WEBHOOK_SECRET`**. The legacy `/api/webhooks/stripe` route and the deposits `stripe-connect` route are untouched. Own idempotency table `billing_stripe_event` (Migration A) — the deposits `stripe_webhook_event` table and its closed status vocabulary MUST NOT be reused.

### 8.2 Event claim and idempotency
Signature verify → livemode gate vs `BILLING_PLAN_ENV` → `INSERT … ON CONFLICT (event_id) DO NOTHING RETURNING` claim → reclaim `failed_retryable` past backoff → else 200. Handler error ⇒ `failed_retryable` + exponential `available_at` + 500 (Stripe retries); ≥8 attempts ⇒ `poisoned` + Sentry + 200. Replay MUST NOT double-grant monthly/upgrade/top-up, double-redeem a promotion, or double-reverse.

### 8.3 Same-second events (binding correction)
Staleness comparison uses **`event.created < last_event_created`** (strictly less), and only after type-specific analysis. Distinct events sharing a `created` second MUST remain eligible. Event IDs provide idempotency, not ordering, and MUST NOT be assumed time-sortable. Ambiguous equal-second or conflicting state ⇒ retrieve the authoritative current Stripe subscription/invoice before projecting local state. Financial effects rely on idempotent keys, never on ordering.

### 8.4 Canonical source + events handled
`billing_subscription` is authoritative for plan definition, offer, cadence, promotion, `paid_through`, credit windows, pending change, cancellation state. Handled: `checkout.session.completed` (subscription-mode `metadata.purpose='plan_subscription'` ⇒ upsert subscription + transition the already-reserved `billing_promotion_claim` to `redeemed` (§7.3), NO grant; payment-mode `purpose='sms_topup'` ⇒ verify paid ⇒ fulfill), `checkout.session.expired`, `customer.subscription.created/updated/deleted` (type-specific monotonic projection; upgrade ⇒ window-diff grant; downgrade ⇒ `pending_offer_key`), `invoice.payment_succeeded` (extend `paid_through` per line-item period; NEVER grants credits directly), `invoice.payment_failed`, `charge.refunded`/`refund.updated`, `charge.dispute.created/closed`. Unknown price / metadata mismatch ⇒ `held_anomaly` + Sentry, no state write.

### 8.5 Checkout contracts with durable attempt state (Rev 2.1)
**`billing_checkout_attempt` (Migration A)**: `id, salon_id, purpose (plan_subscription|sms_topup), billing_offer_key NULL, topup_offer_key NULL, promotion_key NULL, status (creating|checkout_created|completed|expired|failed|superseded), stripe_checkout_session_id NULL, stripe_subscription_id NULL, stripe_payment_intent_id NULL, stripe_idempotency_key, expires_at, created_at, updated_at`. Invariants: at most one ACTIVE subscription attempt per salon (partial unique); a repeated request for a still-active attempt returns/reuses the existing Checkout Session; the Stripe idempotency key derives from the persisted attempt ID and is NEVER browser-supplied; expired/failed attempts may be replaced; webhook replay cannot complete an attempt twice. This protects against double-click, browser retry, simultaneous requests, duplicate open Sessions, and duplicate remote subscriptions created before webhooks arrive.

**Parallel-subscription prevention**: a salon with a live paid subscription MUST NOT create another new-subscription Checkout — return typed `ACTIVE_SUBSCRIPTION_EXISTS` and direct the owner to the Billing Portal or a separately approved plan-change flow. Upgrades are never implemented as a second Stripe subscription. Because local uniqueness cannot see not-yet-webhooked remote subscriptions, checkout-attempt serialization protects the pre-provider call, and billing reconciliation (§8.6) MUST detect unexpected duplicate remote subscriptions and ALERT — never silently choose one and ignore another.

`POST /api/billing/checkout` body `{salonId, billingOfferKey, promotionKey?}` — client never sends Stripe IDs; `requireAdmin(salonId)`; active-offer validation; **promotion claim reserved transactionally per §7.3 BEFORE session creation**; renewal-amount + rate-protection disclosure data returned for the UI; metadata `{salonId, billingOfferKey, planDefinitionKey, promotionKey?, purpose:'plan_subscription'}` on session + subscription; `checkout_session_created` audit. `POST /api/billing/checkout/topup` `{salonId, topupOfferKey}` analogous (`mode:'payment'`, precreates `sms_topup_purchase`, its own attempt row). Success URLs are never authoritative.

### 8.6 Periodic billing reconciliation
Read-only job comparing Stripe subscription state vs local `billing_subscription` vs last processed event vs `paid_through` / `next_credit_grant_at` / plan+offer / pending change; reports drift; repairs only via explicit idempotent transitions. Two Stripe endpoints MUST NOT become two divergent billing systems.

## 9. Sender and destination policy

### 9.1 Launch sender
One Luster-owned Canadian local long-code inside one Luster-owned Messaging Service; one **logical sender identity** (`LUSTER_SMS_SENDER_IDENTITY`, default `luster_shared_v1`) independent of the phone number. `SmsSender` carries no phone number; all sends address `messagingServiceSid`. Dedicated per-salon numbers are out of scope.

### 9.2 Toll-free readiness
A future verified toll-free sender replaces the local number without changing credit balances, consent, dedupe identities, booking routes, or message history (suppression + identities key on the logical sender, never the number). The migration itself is out of scope.

### 9.3 Twilio Connect (BYO) dormancy
All existing `salon_twilio_connection` rows and the six `/api/integrations/twilio/*` routes are preserved; `connect`+`provision` gain a 503 guard unless `SMS_BYO_MODE_ENABLED='true'`; `callback`/`deauthorize` stay open; ordinary salons never see Authorize Twilio / SIDs / tokens / provisioning / Twilio billing. `connected_byo` is a sender MODE, never a `salon_twilio_connection.status` value.

### 9.4 Sender resolution — MODE FIRST, then mode-specific validation (Rev 2.2 correction)

**Step 1 — resolve the candidate mode** before any environment checks: a salon with an ACTIVE `salon_twilio_connection` carrying a `messagingServiceSid` resolves `connected_byo`; otherwise `shared_luster`; per-salon disablement resolves `disabled`.

**Step 2 — validate ONLY that mode's provider configuration:**
- `shared_luster` gates: `COMMUNICATIONS_SMS_ENABLED='true'` (unset = dark — deploy-day silence is structural); `platform_communication_control.smsEnabled` + per-event disable; pilot allowlist when `SMS_PILOT_ENABLED='true'`; shared env complete (`TWILIO_MESSAGING_SERVICE_SID` etc.) else `SENDER_NOT_READY`; plan eligibility; destination policy §9.5; platform rate limits; global suppression (§10.1); credit reservation.
- `connected_byo` gates: the salon's own active connection + legacy-derived enablement ONLY. **Existing BYO continuity MUST NOT depend on `TWILIO_MESSAGING_SERVICE_SID`, the shared-pilot allowlist, `COMMUNICATIONS_SMS_ENABLED`, or any shared-sender configuration** — live BYO salons keep sending exactly as today. Global suppression, shared rate limits, destination policy and credit reservation are NOT applied to BYO (own number, own opt-out namespace, salon pays Twilio directly).
- **BYO continuity vs BYO onboarding are separate permissions**: `SMS_BYO_MODE_ENABLED` gates only the INITIATION of new Connect/provisioning (503 guards on `connect`/`provision`); it never affects already-connected salons. New BYO onboarding remains disabled by default.

**Step 3 — common per-salon gates (both modes)**: salon active/not-deleted; `settings.communications.killSwitch`; `sms.enabled` (legacy-derived for BYO per §Rev 1 compat); per-event toggle; salon transactional consent (always). `freeSoloEnabled` and `isSmsEnabled()`/`checkFeatureEntitlement` MUST NOT be consulted (test-enforced).

**Step 4 — final pre-provider suppression/consent re-check**: see §10.9 race semantics.

### 9.5 Canada-only pilot destination policy (RESOLVED in Rev 2.1)
Pilot destinations: `CA` only. `+1` is NOT proof of Canada (shared NANP). Resolution mechanism (decided; verified against the repo — no phone library exists today, only hand-rolled `src/libs/phone.ts` `normalizePhone`, and no country field on client/contact records):
1. Store an **explicit `country` field on client/contact records** (new-entry paths default `CA` for the pilot), carried onto the intent as `destination_country`.
2. Normalize numbers with a proper phone-number library — the repo lacks one, so Gate A specifies the **smallest safe dependency** (recommended: `libphonenumber-js` metadata-min build) rather than inventing parsing.
3. A **maintained, vendored Canadian NANP area-code dataset** serves as SECONDARY validation of the stored country — never a paid external lookup on every send.
Unknown/unsupported/conflicting destination ⇒ typed `DESTINATION_NOT_SUPPORTED`, no reservation, no send. US sending is barred until US registration/pricing/consent/compliance are separately approved.
Persisted country columns (client/contact records and `communication_intent.destination_country`) are **Gate B / Migration B** work, taken up after fresh schema inspection — Gate A ships only the pure types, resolver, vendored validation data, tests and preview behavior, and adds no database columns.

### 9.6 Unavailability reason enum (final)
`SMS_DISABLED | GLOBAL_SMS_DISABLED | NO_CREDITS | SENDER_NOT_READY | CONSENT_REQUIRED | GLOBAL_OPT_OUT | PLAN_NOT_ELIGIBLE | PROVIDER_UNAVAILABLE | RATE_LIMITED | DESTINATION_NOT_SUPPORTED`.

## 10. Consent and inbound-reply contract

### 10.1 Global STOP
Suppression key = **logical sender identity + recipient** (`sms_global_consent_event`, append-only, `seq bigserial` ordering, partial unique on provider SID, no salon_id). STOP suppresses every salon on the shared sender immediately. START restores global eligibility only — the per-salon `communication_consent` row must independently be `granted`; both gates always.

### 10.2 Transparent consent copy (publication-gated)
Owner/client-facing policy MUST state: "Replying STOP unsubscribes you from appointment texts sent through Luster's shared number, including texts from other businesses using Luster." Requires explicit owner/product/legal sign-off before the consent PR (B3) is approved.

### 10.3 Outbound copy
Every client message begins `"{salonDisplayName} via Luster: "` (display name capped ~24 chars, word-boundary truncation) and ends with the manage link + "Reply STOP to opt out." "Do not reply" is forbidden. Five existing templates currently saying "Reply to this text…"/"Reply or call us" (verified at SMS.ts) MUST be rewritten.

### 10.4 CANCEL
CANCEL is an opt-out keyword ONLY; it never cancels an appointment (test asserts the appointment row is byte-identical). Opt-out confirmation copy (configured in Twilio Advanced Opt-Out, mirrored as a reviewed constant): "You have unsubscribed from Luster appointment texts. Your appointment was not cancelled. Use your appointment link or contact the salon to make changes."

### 10.5 Ordinary replies
Consume no credits (inbound cost tracked internally); never modify appointments; never trigger an automatic paid response; never promise salon receipt; attributed only deterministically; never exposed to the wrong salon.

### 10.6 Attribution
Recent-send context (shared-sender intents to that recipient, 72h): exactly one salon ⇒ attribute; zero ⇒ unattributed; multiple ⇒ ambiguous. Never guess.

### 10.7 Inbound retention
`sms_inbound_event` stores: provider SID (unique), from, to, sender identity, timestamp, segment count, provider cost fields, keyword classification, attribution state, body-present indicator. **Ordinary message bodies are not retained** (no body column). 90-day purge in worker housekeeping. Exact-body storage for any future support feature requires a separate privacy/retention decision.

### 10.8 Webhook topology
Single existing inbound path `/api/integrations/twilio/inbound`, branching shared vs BYO on `MessagingServiceSid === TWILIO_MESSAGING_SERVICE_SID` (BYO Messaging Services have this URL baked in). Signature validation precedes any mutation. With Advanced Opt-Out enabled, Twilio auto-replies; the route always returns empty TwiML.

### 10.9 STOP / kill-switch race semantics (Rev 2.2 — honest linearization)
The dispatcher performs a **final suppression/consent check immediately before the provider call**. A STOP committed before that final check ⇒ the reservation is released and the provider is never called. If Twilio acceptance occurs first, the accepted message cannot be recalled — STOP then suppresses all SUBSEQUENT shared-sender messages to that recipient. Tests MUST establish an observable linearization order (STOP-before-final-check prevents the send; STOP-after-acceptance suppresses the next send) and MUST NOT claim retroactive cancellation. The same semantics apply to emergency kill switches: a switch flipped before the final check defers/blocks the send; one flipped after acceptance affects only subsequent dispatches.

## 11. Reminder and timezone contract

### 11.1 Carried from Rev 1 (normative)
Durable `communication_intent` rows (new table; `integration_outbox` rejected for intents — GCal-coupled worker, owner-email-on-failure branch, missing notAfter/lease/body/segment/reservation columns, closed status vocabulary; outbox IS reused for cost reconciliation). Up to 3 configurable reminder rules (stable stored UUIDs, never regenerated defaults); per-rule email/SMS/both; defaults = immediate confirmation on, 24h rule on (`both`), 2h rule ABSENT. Pre-materialized intents in the appointment mutation transaction (precedent: `appointmentManage.ts` in-tx outbox enqueues) + idempotent reconciler sweep (72h horizon, ON CONFLICT DO NOTHING + orphan cancellation). Absolute instants; `notAfter NOT NULL` on every row (§Rev 1 policy table stands); reschedule invalidates + rematerializes (rule id + start revision in dedupe identity); cancellation suppresses; no confirmed-booking messaging while a deposit hold is unpaid — with `awaiting_payment` now landed, gating reads appointment status directly, and confirmation enqueues exactly once from the authoritative `awaiting_payment→confirmed` (deposit paid) or direct-confirm transition, keyed on that event's identity. Dedupe identity table from Rev 1 stands.

### 11.2 Scheduling revision (binding addition)
Every intent stores a deterministic `scheduling_revision` (fingerprint over: salon timezone, quiet-hours config, the rule's id+offset+channels, appointment start, enabled channels). When ANY scheduling-relevant setting changes — salon timezone, quiet hours, reminder rules, appointment start, channels — the reconciler MUST invalidate and rematerialize affected FUTURE intents. A timezone change must not leave stale quiet-hours decisions attached to future reminders.

### 11.3 DST test matrix
Spring forward; fall back; nonexistent local time; repeated local time; timezone changed after booking; quiet-hour shift across DST; shift past notAfter.

### 11.4 Quiet hours
Salon-configurable (default 21:00–09:00, enabled). Applied at materialization (shift) and re-checked at claim. If shifting lands after notAfter, after the appointment, or too close to be useful ⇒ expire as stale (`QUIET_HOURS_STALE`), never send late. Immediate client-triggered confirmations use `bypass`.

## 12. Tax, feature and promotion publication gates

**Server-side billing dark switches (Rev 2.2)** — all default disabled/unset: **`BILLING_SUBSCRIPTIONS_ENABLED`**, **`BILLING_TOPUPS_ENABLED`**, **`PUBLIC_PRICING_ENABLED`**. Hiding the pricing page is presentation, NOT the security/control boundary: subscription Checkout MUST reject before any Stripe call while `BILLING_SUBSCRIPTIONS_ENABLED` is not `'true'`; top-up Checkout MUST reject before Stripe while `BILLING_TOPUPS_ENABLED` is not `'true'`; missing/placeholder Stripe IDs ALWAYS reject (`PRICE_UNCONFIGURED`); preview/local environments MUST be unable to resolve production price mappings (`BILLING_PLAN_ENV` scoping).

The public pricing route is built behind `PUBLIC_PRICING_ENABLED` (unset = 404/hidden) and MUST NOT be published until ALL of: (1) approved Starter/Pro/Elite non-communications feature matrix (Claude MUST NOT invent staff/location limits, Smart Fit/analytics/deposit/branding/domain/support/migration/multi-location differences — legacy tiers stay authoritative meanwhile); (2) approved tax configuration (accountant sign-off §3.7); (3) approved refund/cancellation terms; (4) approved founding promotion start/end/redemption cap; (5) approved renewal disclosure; (6) approved shared-number consent/STOP copy; (7) approved Canada-only launch language. The catalogue engine, Checkout contracts, and internal projections MAY be built before publication.

## 13. Database / migration design

**Exactly two migration carriers.** (Every prior statement that PR4/Migration A is "the only migration" is void.)

- **Migration A — `0069_billing_credit_foundation.sql`** (number provisional against verified tail 0068/count 69; re-verified at the migration gate) — the COMPLETE billing/credit primitive set (Rev 2.2 reconciled): `billing_subscription` (§6.2, + `rate_protected_through`), `billing_credit_window` (§6.5b), `billing_checkout_attempt` (§8.5), `billing_business_identity` + `billing_business_identity_link` (§7.3), `billing_promotion_claim` (§7.3), durable starter-grant evidence (attached to business identity), `sms_credit_ledger` (bucket CHECK includes `delivery_recovery`), `sms_credit_account` (including low-balance-warning dedupe state §7.1), `sms_credit_reservation` + `sms_credit_reservation_lot`, `billing_stripe_event`, `sms_topup_purchase`. **There remain exactly TWO migration carriers.**
- **Migration B — `0070_communications_pipeline.sql`**: `communication_intent` (+ `destination_country`, `scheduling_revision` per Rev 2), `sms_global_consent_event`, `sms_inbound_event`, `platform_communication_control` (singleton: smsEnabled default false, disabled_event_types, batch limits, daily_send_limit, anomaly threshold), `notification_delivery` ALTERs (intent/segment/sender/status_rank/settlement/reconciliation columns + FX fields: `provider_price_raw, provider_currency, provider_segments, fx_rate, fx_rate_source, fx_converted_at, provider_cost_cad_micros`).

Conventions (binding, per repo evidence): hand-written SQL in 0065–0068 style (named CHECKs, partial uniques, why-comments, `--> statement-breakpoint`, own trigger functions); journal entry appended (`idx`, `version:"7"`, epoch-ms `when`, tag, `breakpoints:true`); **NEVER `drizzle-kit generate`**; ledger-pin bumps (`FINAL_MIGRATION`, `MIGRATION_COUNT`, `EXPECTED_INCOMING_FOREIGN_KEYS`) + `toHaveLength` in the same commit; every salon FK CASCADE or SET NULL; CASCADE tables added to `SALON_PURGE_PLAN` in dependency order; PGlite-compatible SQL; hand-written Schema.ts mappings. **No fake `9998_draft.sql` numbering.** If main gains a migration before merge: rebase BOTH migration PRs as one paired unit, renumber, update journal/pins, replay all migrations, rerun both suites + combined verification. Migrations A and B are separate reviewable PRs but **one atomic owner review gate** — B is not approvable while A's schema/ledger/concurrency behavior is unresolved.

## 14. Git / rebase / integration protocol

1. Fresh isolated worktrees branched from current `origin/main`; the stale shared checkout is never used for implementation. 2. Stage files explicitly; never `git add -A`. 3. Never `drizzle-kit generate`. 4. Let release-bot movement settle before final branch updates; rebase through normal protections; never bypass CI/branch protection. 5. Conventional commits (commitlint runs per PR). 6. Record base/head/tree SHAs for every PR. 7. **Linear-by-gate execution (Rev 2.2)**: PRs within a gate are built sequentially (A1→A2; B1→B2→B3; C1→C2→C3→C4; D1), each on its predecessor; the track is NOT maintained as one giant ten-PR unmerged stack unless the owner explicitly authorizes that. After every gate: STOP for owner review/authorization; wait for release-bot movement to settle; fetch latest main; each subsequent gate begins from the authoritative approved base of the prior gate; rebuild the ephemeral local-only integration state (latest `origin/main` + current approved PR heads in dependency order); run the gate battery; produce one consolidated report. Push the integration branch only if CI requires it.

## 15. Final PR sequence (~10 PRs in 4 gates)

| PR | Scope | Migration | Depends on |
|---|---|---|---|
| **A1** | Canonical architecture doc; `planDefinitions/billingOffers/promotions/topupOffers/stripePriceMap/legacyPlanAdapter` + tests; no behavior change, no env | — | — |
| **A2** | Segment calculator (`smsSegments.ts`, hand-rolled isomorphic, vector-tested incl. extension-char boundary); templates + worst-case CI test + salon-name cap; sender resolver + eligibility (credits stubbed); Canada-only destination policy; capability-split health checks; BYO dormancy guards; `hasSmsInfrastructure()` Messaging-Service fix; preview endpoint; env vars (`TWILIO_MESSAGING_SERVICE_SID`, `LUSTER_SMS_SENDER_IDENTITY`, `COMMUNICATIONS_SMS_ENABLED`, `SMS_BYO_MODE_ENABLED`, `SMS_PILOT_*`, all optional, 5 touch points each); **mechanical dark-by-default tests** | — | A1 |
| **B1** | Migration A + full credit engine (ledger/reservation settle-on-accept/grants/refunds/identity-HMAC/promotion claims) + credit-window scheduler (§6) + purge-plan/pin updates + PGlite suites + throwaway-Postgres concurrency suite + CI job `sms-credit-ledger-postgres` | **A** | Gate A approved base |
| **B2** | Migration B + intent model/dispatcher/rate limits (Redis, degrade-closed)/callback monotonic hardening + settle-on-accept wiring/unknown-outcome + cost/FX reconciliation (outbox `twilio` provider + owner-email gate)/platform control/ops health/`/api/communications/dispatch` cron | **B** | B1 (linear) |
| **B3** | Inbound rewrite (shared/BYO branch, STOP/START/HELP/CANCEL, attribution, retention), `smsConsent.ts`, Advanced Opt-Out copy constants, consent-copy sign-off artifacts | — | B2 |
| **C1** | `communicationSettings.ts` (+staffOverrides) + SettingsModal Communications view + segment counter; reminder rules + scheduling-revision rematerialization; quiet hours; call-site migration (SMS.ts facade + synchronous smart-reminder exception + copy rewrites; re-inventory call sites at v1.55.1); reminders cron → reconciler; deposit-hold gating on `awaiting_payment`; referral-invite suspension | — | Gate B approved base |
| **C2** | `/api/webhooks/stripe-billing` + `STRIPE_BILLING_WEBHOOK_SECRET`; same-second event rules; checkout rewrite (offer/promotion keys, attempt state, claim-before-checkout, renewal + rate-protection disclosure); annual + founding promotion mechanics (40%-off-once); billing reconciliation job; **billing dark switches `BILLING_SUBSCRIPTIONS_ENABLED`/`BILLING_TOPUPS_ENABLED` enforced server-side before Stripe**; pricing route behind `PUBLIC_PRICING_ENABLED` (`'pricing'` → `RESERVED_PUBLIC_SEGMENTS`); billing status UI (delete `ComparePlansModal`); UsageBillingModal skeleton | — | C1 (linear within gate) |
| **C3** | Top-up checkout + fulfillment + refund/dispute arms + purchase history + `'topups'` view | — | C2 |
| **C4** | Usage + history APIs (cursor pagination, masking) + views; low-balance warnings (post-debit tiers, email + in-app notification, never SMS); super-admin communications report (margin/FX) + control surface + kill-switch/rate-limit visibility (warning dedupe against Migration A columns — no new migration) | — | C3 (linear) |
| **D1** | Isla pilot readiness ONLY: allowlist gate tests, dry-run verification harness, production configuration runbook (§20), pilot sequence (§21), rollback checklist, rollout ladder (§22), toll-free readiness checklist | — | Gate C approved base |

## 16. Owner review gates

- **Gate A** (after A1+A2): architecture + dark foundations approved. Exit: catalogue tests green; dark-by-default mechanically proven; no behavior change demonstrated. STOP; owner report; no migrations before approval.
- **Gate B** (after B1+B2+B3): financial + delivery core. Exit: both migrations reviewed as one atomic unit; concurrency suites green on real Postgres; settle-on-accept + refund flows proven; **shared-number consent/STOP copy signed off**. STOP; owner report.
- **Gate C** (after C1–C4): product/Stripe/owner surfaces. Exit: checkout/promotion math test vectors green ($89.94/$149.94/$269.94); reconciliation drift-report demonstrated; pricing route proven dark; no live Stripe resources. STOP; owner report.
- **Gate D** (after D1): pilot readiness. STOP. Merging, deploying, production configuration, Stripe resource creation and pilot execution each require separate explicit authorization.

## 17. Testing matrix (per domain; repo patterns binding)

Catalogue: key immutability/uniqueness; offer/promotion eligibility windows + caps; promotion math vectors (reject $74.95/$124.95/$224.95); public projections contain no Stripe IDs; retired-offer checkout rejection. Credit windows: §6.8 list. Ledger/reservation: spend order; virtual expiry; append-only trigger; CHECKs; settle-on-accept; sync-reject release; terminal refund exactly-once under replay/reorder; unknown-outcome resolution (adopt vs release); reaper skip rules; segment mismatch absorb; dispute negative-availability blocks reserve. Grants: starter-once across every §3.1 reset vector incl. salon recreate under same identity (Clerk + HMAC paths); window replay; upgrade-diff collapse; missed-window skip; annual parity. Webhook: claim/reclaim/poison; livemode; same-second distinct events processed; `<` staleness; anomaly hold; top-up replay. Checkout attempts: active-attempt reuse; `ACTIVE_SUBSCRIPTION_EXISTS`; attempt-derived idempotency keys; expired-attempt replacement; replay cannot double-complete. Promotion claims: reserve-before-Checkout; cap enforcement; release on failure/expiry; cancel/resubscribe cannot re-claim. Identity: owner transfer preserves eligibility; multi-salon single grant; +tag/dot addresses treated as distinct; HMAC rotation attaches new fingerprint to same identity without re-eligibility. Status entitlement: every §6.5a row exercised (incl. anomalous `trialing`). Segments: GSM boundary vectors; extension-char concat straddle; UCS-2; emoji; empty; template worst-case ≤ audience max. Sender/eligibility: mode-first resolution table test; **BYO continuity independent of shared env / pilot allowlist / `COMMUNICATIONS_SMS_ENABLED` (explicit tests)**; BYO onboarding-vs-continuity separation; no `freeSoloEnabled`/legacy-chain reads; Canada-only + `DESTINATION_NOT_SUPPORTED`; pilot allowlist. Segment reconciliation: all four §7.7 cases incl. overpredict refund exactly-once and unresolved-retry. Refund recovery: valid-lot original-expiry refund; expired-lot `delivery_recovery` 30-day lot; purchased stays non-expiring; refund never exceeds debit. Dark switches: subscription/top-up Checkout reject before Stripe when disabled; placeholder IDs always reject; preview/local cannot resolve prod mappings. Low-balance: `warning_epoch` reset on grant/top-up; tier monotonicity within an epoch. Consent/inbound: STOP suppresses across salons; START vs salon consent; CANCEL appointment-byte-identical; HELP; ordinary reply mutates nothing + stores no body; attribution 0/1/n; signature rejection mutates nothing. Intents/scheduling: dedupe identities; reschedule/cancel invalidation; last-minute skip; quiet-hours shift + stale expiry; §11.3 DST matrix; scheduling-revision rematerialization on tz/rules/quiet-hours change; notAfter enforcement; blocked→top-up release only-if-relevant. Callbacks: monotonic ranks; duplicate/out-of-order; refund exactly-once; FX fields recorded; twilio outbox failure sends no owner email. Surfaces: settings save flows; masking (no raw phone/email/error codes in responses); pagination cursors; low-balance tier dedupe; kill-switch visibility. Security/tenancy: cross-salon balance/history/send/purchase isolation; no client-supplied Stripe IDs or amounts; audit rows present; preview/local cannot reach production providers.

## 18. Concurrency matrix (throwaway-Postgres suites + CI jobs `sms-credit-ledger-postgres`, `communications-dispatch-postgres`)

| Race | Expected |
|---|---|
| 25-way reserve on 1 remaining credit | exactly 1 held, 24 `blocked_no_credit`, never negative |
| settle-on-accept vs terminal-failure callback ordering | debit once, refund at most once |
| duplicate window grant (same key) | one ledger row |
| duplicate starter/promotion claim, two salons same identity | one grant / one claim |
| parallel subscription-checkout requests, one salon | one active attempt; second reuses or `ACTIVE_SUBSCRIPTION_EXISTS` |
| parallel promotion claims at the redemption cap | cap never exceeded |
| two workers, one due intent | one `messages.create`, one reservation |
| expired lease w/ delivery row present | `send_outcome_unknown`, never re-send |
| two simultaneous terminal callbacks | one refund |
| STOP committed before dispatcher's final pre-provider check | reservation released, provider never called |
| STOP committed after Twilio acceptance | accepted message stands; all subsequent shared-sender messages suppressed (observable linearization, no retroactive-cancel claims) |
| kill switch flipped around the final check | same linearization semantics as STOP |
| reaper vs in-flight accept | no release after proven acceptance |

Dispatcher policy: per-salon concurrency 1; cross-salon configurable; fair claiming; bounded batches. Batch reservation API is DEFERRED unless benchmarks fail targets: no double spend; no negative authorization; p95 reservation txn <~100 ms in harness; 100-intent single-salon batch clears within one worker interval; no unexplained lock timeouts.

## 19. Observability budgets

Correctness (all zero): duplicate starter/monthly/top-up grants; duplicate debits/refunds; unauthorized negative balance; cross-tenant credit/message access; sends past stale notAfter; reservation released after proven acceptance. Queue/settlement: oldest due transactional intent normally <10 min; acceptance→settled debit normally <1 min; `send_outcome_unknown` >30 min ⇒ alert; expired pre-send reservations reconciled next worker interval; callback status never regresses. Cost: every pilot outbound reconciles provider segments+price within 24h; any pilot `segment_mismatch_underpredicted` OR `segment_mismatch_overpredicted` ⇒ immediate alert + investigation; unresolved (missing/zero/unusable actuals) reconciliations older than the documented budget ⇒ alert; rollout expansion requires explained mismatch rate below a documented threshold; USD provider costs retain original currency + CAD conversion (rate, source, timestamp). Consent/security (all zero): invalid-signature mutations; STOP bypasses; inbound appointment mutations; sends to unsupported destinations; production sends from preview/local.

## 20. Production configuration runbook requirements (documented in D1, NEVER executed this track)

**Safe activation order (Rev 2.2 — normative):**
1. Create/configure provider resources (Twilio Messaging Service, local-number attachment, Advanced Opt-Out with approved copy, inbound + status callback URLs; Stripe Products/Prices for all monthly+annual offers, the 40%-off-once founding Coupon, top-up Prices; `stripe-billing` webhook endpoint + secret) while ALL application switches remain OFF.
2. Add environment values (`TWILIO_MESSAGING_SERVICE_SID`, secrets, etc.).
3. Keep `platform_communication_control` disabled.
4. Configure the Isla pilot allowlist.
5. Configure Isla's communication settings.
6. Create the authorized starter grant idempotently.
7. Deploy and run readiness checks while dispatch remains disabled.
8. Keep `PUBLIC_PRICING_ENABLED` / `BILLING_SUBSCRIPTIONS_ENABLED` / `BILLING_TOPUPS_ENABLED` disabled unless separately authorized.
9. Enable the shared-sender mode-level capability (`COMMUNICATIONS_SMS_ENABLED`) while platform operational control remains disabled.
10. Prove no message can dispatch.
11. Enable `platform_communication_control` as the FINAL send-enabling action.
12. Send one controlled owner test.

**Rollback priority:** platform control OFF → mode-specific shared sender OFF → environment hard stop. Each runbook step lists owner, verification command, and rollback.

## 21. Isla pilot gates (execution requires separate authorization)

Core sequence: 1 shared number SMS-capable → 2 Messaging Service ready → 3 number attached → 4 Advanced Opt-Out on → 5 callbacks configured → 6 env in production → 7 activation per §20 order → 8 only Isla allowlisted → 9 Isla starter grant (100) → 10 one test SMS to the owner's own number → 11 verify reservation → 12 verify acceptance+settlement → 13 verify delivery callback → 14 verify cost reconciliation → 15 STOP → 16 START → 17 ordinary reply → 18 prove no other salon can send → 19 booking succeeds with SMS disabled → 20 email independent.

Additional explicit checks (Rev 2.2): zero-credit cutoff; booking still succeeds when SMS blocked; email still sends when SMS blocked; bucket spending order observed; platform kill switch; salon kill switch; allowlist blocks another salon; invalid Twilio signature ⇒ zero mutation; duplicate callback ⇒ no duplicate refund; actual segment + cost reconciliation; billing APIs remain dark unless separately authorized; duplicate subscription Checkout reuses the active attempt; live subscription cannot create another subscription; promotion claim cannot reserve twice; STOP-before-final-check prevents the send; STOP-after-acceptance suppresses subsequent sends. No real customer message until all pass.

## 22. Rollout ladder

Isla → 5 beta salons → 20 beta salons → paid-plan launch → Free starter rollout → (future, separate) toll-free migration. Each expansion requires §19 budgets held: no duplicate sends, ledger reconciles, global STOP proven, cost reconciliation working, no cross-tenant leak, no unexplained segment mismatch, acceptable queue latency, kill switches proven.

## 23. Owner decisions and defaults

| Decision | Default (approved unless contradicted) |
|---|---|
| Dispute treatment | Full credit reversal; may go negative |
| Normal refund treatment | Reverse only remaining unused purchased value |
| Credit spend order | monthly → promotional → delivery_recovery → administrative → starter → purchased |
| Existing BYO continuity | Preserve current live BYO behavior until deliberate migration |
| Client template max | 1 segment |
| Owner/technician template max | ≤2 segments |
| Legacy `reminderLeadHours` | Seed first rule from existing value, then deprecate |
| Referral invites on shared sender | Suspend at launch; native/manual fallback |
| Ordinary replies | No auto-response, no appointment mutation |
| Pilot destination | Canada only |
| Dedicated salon numbers | Out of scope |
| Toll-free | Future verified migration |
| Auto-recharge | Disabled (design-compatible) |
| Public pricing | Dark until §12 gates pass |
| Annual cancellation | Access through paid-through; renewal stops |
| Founding promotion | One first annual term; 40%-off-once implementation |
| Starter identity retention | Durable identifiers/keyed HMAC only, documented retention |
| Reservation batching | Deferred pending benchmarks |
| `delivery_recovery` spend position | After promotional, before administrative; 30-day expiry |
| Billing dark switches | `BILLING_SUBSCRIPTIONS_ENABLED` / `BILLING_TOPUPS_ENABLED` / `PUBLIC_PRICING_ENABLED` all default OFF; server-side enforcement, page-hiding is never the boundary |
| BYO continuity vs onboarding | Continuity never gated by shared config; new onboarding gated by `SMS_BYO_MODE_ENABLED` (default off) |

**Genuinely open (owner input needed, none block Gate A):** (1) consent/STOP disclosure copy final wording (§10.2) — required before Gate B approval; (2) feature matrix + tax + publication copy (§12) — required before pricing publication only. (Destination-country resolution is RESOLVED in Rev 2.1 §9.5.)

## 24. Deferred / out-of-scope

Promotional/marketing SMS, MMS, AI receptionist, two-way inbox, dedicated numbers, automatic toll-free migration, arbitrary free-form templates, uncontrolled overages, auto-top-up, US destinations, feature-matrix migration, automated menu-migration tooling, Smart Fit/deposit/catalog/Figma/broad-UI work, self-service partial annual refunds, legacy webhook route retirement (future cleanup), physical deletion of boilerplate residue (future cleanup).

## 25. Review-feedback adjudication appendix

| # | Review point | Verdict | Grounds |
|---|---|---|---|
| 1 | Separate PlanDefinition / BillingOffer / PromotionDefinition (annual support) | ACCEPTED | Rev 1's single `PlanVersion` couldn't express cadence or promotions; restructure is code-only (catalogue was already code, not DB) |
| 2 | Founding promo = 40%-off-once vs annual Price (not 50% coupon) | ACCEPTED | Math verified: 6/10 of annual; vectors added to reject the $74.95-class outcomes |
| 3 | Annual subscribers get monthly credit windows (anchor+clamp engine, paid_through) | ACCEPTED | New §6 engine; grants moved off invoice events entirely — one engine for both cadences (stronger than the reviewer's minimum) |
| 4 | Settle on Twilio acceptance, refund on terminal failure | ACCEPTED | Supersedes Rev 1's delivery-callback settlement; simplifies reaper; commercial rule stated §7.4 |
| 5 | Same-second Stripe events must not be dropped (`<` not `<=`, type-specific, authoritative re-retrieve) | ACCEPTED WITH MODIFICATION | Event-ID claim idempotency already existed in Rev 1; only the staleness fence and ambiguity-retrieval are new |
| 6 | Batch credit reservation API (Gemini) | REJECTED (deferred) | Premature financial complexity; per-salon lock + fairness + benchmarks with explicit acceptance targets (§18); revisit only on measured failure |
| 7 | Timezone/settings changes must rematerialize future intents | ACCEPTED | New `scheduling_revision` fingerprint column + reconciler invalidation (§11.2) |
| 8 | Global STOP cross-salon disclosure copy | ACCEPTED | Made a Gate B approval precondition (§10.2, §16) |
| 9 | Canada-only destination policy; +1 ≠ Canada | ACCEPTED | New `destination_country` + `DESTINATION_NOT_SUPPORTED`; resolution mechanism = open Gate A decision |
| 10 | 11-PR uninterrupted stack → ~10 PRs in 4 owner gates | ACCEPTED | Rev 1 PR1/PR2→A1, PR3→A2, PR4→B1, PR5→B2, PR6→B3, PR7→C1, PR8→C2, PR9→C3, PR10→C4, PR11→D1; per-gate ephemeral integration branches added |
| 11 | Raw SHA-256 email identity → versioned keyed HMAC + identity preference order | ACCEPTED WITH MODIFICATION | Clerk-ID-primary already in Rev 1; HMAC replaces raw hash; dedicated secret; separate promotion-redemption records added |
| 12 | Rev 2 top-up prices ($1 lower each tier) | ACCEPTED | §3.5 normative; Rev 1 prices void |
| 13 | "PR4 is the only migration" contradiction | ACCEPTED (removed) | Two carriers were already the Rev 1 final reconciliation; Rev 2 states it once, normatively (§13) |
| 14 | `awaiting_payment` missing (Rev 1 conflict) | RESOLVED BY REPO MOVEMENT | Landed in 0066 with `depositHoldExpiresAt`; deposit-hold gating now reads appointment status (§11.1) |
| 15 | Billing webhook at `/api/webhooks/stripe/billing` | ACCEPTED WITH MODIFICATION | Renamed `/api/webhooks/stripe-billing` to match the landed `stripe-connect` sibling convention; separate secret confirmed by `STRIPE_CONNECT_WEBHOOK_SECRET` precedent |
| 16 | FX/cost reporting (USD provider vs CAD pricing) | ACCEPTED | §19 + FX columns in Migration B |
| 17 | Mechanical no-real-provider guarantee | ACCEPTED | Dark env default + control-row default false + empty allowlist + placeholder-only IDs + PGlite isolation + mocked SDKs + build/test dark assertions, delivered in Gate A/B (not deferred to D1) |
| 18 | Pricing page behind dark flag until feature matrix/tax/copy approved | ACCEPTED | §12; Rev 1's public pricing PR becomes dark-flagged C2 scope; legacy tiers stay authoritative |
| 19 | `RATE_LIMITED` reason | ACCEPTED | Carried from Rev 1 adjudication into the final enum (§9.6) |
| 20 | Fake draft migration numbering (`9998_draft.sql`) | ACCEPTED (prohibited) | Loader/journal would treat them as real; real numbering assigned at the migration gate from fresh origin/main (§13) |

### Rev 2.1 amendments (ChatGPT correctness fixes + Grok boundary/identity/operational observations; overlapping Gemini concerns were already resolved in Rev 2)

| # | Amendment | Verdict | Grounds |
|---|---|---|---|
| 21 | Paid-through boundary: `paid_through >= window_end`, half-open `[start, end)` | ACCEPTED | Rev 2's `>= window_start` authorized an unpaid month at exact boundary equality (§6.4) |
| 22 | Late-payment semantics (grant current window once if fully covered; never backfill expired windows) | ACCEPTED | §6.5 |
| 23 | Normative subscription-status entitlement table (8 statuses incl. anomalous `trialing`) | ACCEPTED | §6.5a; one contract drives scheduler, API, sender eligibility, UI, reconciliation |
| 24 | Durable `billing_credit_window` history table | ACCEPTED | Exactly-once evidence must not live only in mutable subscription fields (§6.5b) |
| 25 | Durable `billing_checkout_attempt` + server-derived Stripe idempotency keys | ACCEPTED | Double-click/retry/parallel-session/duplicate-remote-subscription protection (§8.5) |
| 26 | Parallel paid subscriptions prohibited (`ACTIVE_SUBSCRIPTION_EXISTS`; reconciliation alerts on duplicate remote subs, never silently picks) | ACCEPTED | §8.5; upgrades never create a second Stripe subscription |
| 27 | Promotion claim-before-Checkout lifecycle (`billing_promotion_claim`, reserve→redeem/release/expire) | ACCEPTED | Redemption-only recording cannot enforce caps or once-per-business under parallel Checkout (§7.3); replaces Rev 2's `billing_promotion_redemption` |
| 28 | 24-month founding rate protection formalized (`rate_protected_through`, service-period-start rule, distinct from first-term promo) | ACCEPTED | §3.9; promotion / protection / renewal price stored and displayed separately |
| 29 | Canonical durable business identity (`billing_business_identity` + versioned links; owner transfer, multi-salon, email-normalization rules — no +tag stripping, no Gmail-dot tricks, IDNA-canonical) | ACCEPTED | §7.3; email alone is never "the business" |
| 30 | HMAC rotation must not reset eligibility (new version = new fingerprint link on the SAME identity; documented key lifecycle) | ACCEPTED | §7.3 |
| 31 | Starter/promotion anti-abuse retention = minimum necessary for offer enforcement + financial/audit obligations, documented horizon and deletion | ACCEPTED | §7.3 (master prompt received through its §15; the retention principle stated there is incorporated — any further sections beyond the received text can be supplied and folded in) |
| 32 | Destination-country resolution decided now: explicit stored country + smallest safe phone library (repo has none — verified) + vendored CA NANP dataset as secondary validation; no paid per-send lookup | ACCEPTED | §9.5; removed from open owner decisions |
| 33 | Expanded credit-window boundary/leap-year/outage test vectors | ACCEPTED | §6.8, §18 |

### Rev 2.2 amendments (completion gate — omissions from the Rev 2.1 instruction, now incorporated)

| # | Amendment | Verdict | Grounds |
|---|---|---|---|
| 34 | Sender-mode-first resolution; BYO continuity independent of shared env/allowlist/`COMMUNICATIONS_SMS_ENABLED`; continuity vs onboarding separated | ACCEPTED | Rev 2.1 §9.4 validated shared config before mode; would have coupled live BYO sends to shared-sender rollout (§9.4) |
| 35 | Three-case segment reconciliation + unresolved handling; overpredict refunds (`segment-overpredict-refund:{res}:{lot}`) | ACCEPTED | Rev 2.1 §7.7 only covered underprediction (§7.7) |
| 36 | Expired-lot terminal-failure refunds → `delivery_recovery` bucket (30-day expiry); purchased stays non-expiring; refund ≤ original debit; keys `sms-refund-recovery:{res}:{lot}` | ACCEPTED | Refunding into an expired lot would strand value or resurrect expired allowances (§7.4, §7.2) |
| 37 | Honest STOP/kill-switch linearization (final pre-provider check; no retroactive-cancel claims) | ACCEPTED | "Send loses" was unprovable as stated; races are now observable and testable (§10.9, §18) |
| 38 | Server-side billing dark switches; page-hiding is not the control boundary; placeholder IDs always reject; preview/local cannot resolve prod mappings | ACCEPTED | §12; enforced before any Stripe call |
| 39 | Durable low-balance-warning state on `sms_credit_account` (`warning_epoch`/`last_warning_tier`/`last_warning_at`) in Migration A | ACCEPTED | C4 must not need a third migration for warning dedupe (§7.1) |
| 40 | Corrected production activation order (provider resources first, switches OFF; platform control is the FINAL send-enabler; rollback priority defined) | ACCEPTED | Rev 2.1 §20 flip order enabled sending before readiness proof (§20) |
| 41 | Linear-by-gate PR execution; no ten-PR standing stack without explicit authorization; per-gate settle/fetch/integration/battery/report | ACCEPTED | §14, §15, §16 |
| 42 | Expanded Isla pilot checks (16 additional explicit verifications) | ACCEPTED | §21 |
| 43 | Migration A table list reconciled (complete primitive enumeration; exactly two carriers) | ACCEPTED | §13 |
