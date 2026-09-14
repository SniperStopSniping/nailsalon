# Billing track — Gate A/B/C merge record and owner notices

Companion to [luster-billing-remaining-work-plan.md](luster-billing-remaining-work-plan.md) (phase P0). Recorded 2026-09-14 from `origin/main` @ `9c95e70b` (v1.98.3). SHAs are computed from each merge commit (`base` = first parent, `head` = second parent, `tree` = `head^{tree}`) and cross-checked against the PR bodies where those recorded them (C1–C4 match exactly).

## 1. Merged PRs (§14 item 6 record)

| PR | Contract row | Merged | Merge commit | Base (`^1`) | Head (`^2`) | Head tree | PR body |
|---|---|---|---|---|---|---|---|
| #109 | A1 catalogue | 2026-08-17 | `e032c3cb663d` | `29332f9d5435` | `1ea3e9404637` | `eec22fed94ce` | not recorded |
| #110 | A2 shared-sender foundation | 2026-08-17 | `8127845b4628` | `dc1a082f5c5f` | `25414476ef9c` | `d518dd9f0ac6` | not recorded |
| #111 | B1 financial core (Migration A) | 2026-08-17 | `0267a0d1afe4` | `03690b6efd3f` | `55fd1ccab1e3` | `2988c50352cc` | not recorded |
| #118 | B1 repair (cumulative evidence) | 2026-08-17 | `1be973c66f70` | `34efe525335b` | `47c4dbcd0338` | `043ac55c42b7` | not recorded |
| #112 | B2 comms pipeline (Migration B) | 2026-08-17 | `1acf9989a67e` | `17c7f1d5941d` | `d93c3314161e` | `5eef68bce203` | not recorded |
| #113 | B3 consent/inbound | 2026-08-17 | `4dfb3e5dc3be` | `3d6c98565a87` | `f9f2da74763a` | `6a76dceb7e58` | not recorded |
| #117 | C1 communications settings | 2026-08-17 | `13020aebc672` | `cb337555b6df` | `9353bfeac1d6` | `b17c4d0cffd4` | matches |
| #120 | C2 checkout / billing webhook / scheduler / pricing | 2026-08-17 | `afbd132da388` | `2f1b948e9f2a` | `f8c1a5b627fa` | `172d796f39a5` | matches |
| #121 | C3 top-ups | 2026-08-17 | `e216e75de4c5` | `5f3efd0c440f` | `b7d47989e428` | `e077c601293b` | matches |
| #122 | C4 usage / warnings / operations | 2026-08-17 | `da08f2793fdc` | `a13a90d94850` | `017f43136917` | `c413cfe3eee5` | matches |
| #195 | top-up checkout retry safety | 2026-09-13 | `1b6ffeb32916` | `772311939c2c` | `ec4e1f64e56b` | `f75d51242349` | not recorded |

No D1 PR exists. Migration tail at this record: `0077_review_requests` (78 journal entries).

## 2. Owner notices

1. **Gate C exit condition not met at merge (§16).** "Reconciliation drift-report demonstrated" was never produced: `/api/billing/reconcile` was merged deliberately unregistered and has not been run against seeded drift. Plan phase P4 discharges this by running the extended reconciler against a disposable Postgres with seeded drift and appending the report to §3 of this file. No re-ratification is requested; this is a disclosure.
2. **The billing webhook secret is the first live-traffic control.** `/api/webhooks/stripe-billing` is gated only by `STRIPE_BILLING_WEBHOOK_SECRET`; it does not consult `BILLING_SUBSCRIPTIONS_ENABLED` or `BILLING_TOPUPS_ENABLED`. Provisioning the secret makes the route process events (including in-process credit-window grants). Plan §9 sequences P1, P3a–c, P4 and P6 before that step.
3. **Live billing code paths.** `grantStarterCredits` (`src/libs/billing/creditGrants.ts`) runs inside today's onboarding transactions; `creditLedger.ts`/`creditReservation.ts` serve live SMS sends; `/api/billing/portal` and the legacy `/api/webhooks/stripe` route serve live legacy-flow customers. Dark phases do not edit them (plan §7).

## 3. Reconciliation drift-report demonstration (P4)

Discharges the §16 Gate C exit condition (owner notice §2.1 above). Run 2026-09-14 against a disposable, throwaway PostgreSQL 16 container (`docker run --rm -d -e POSTGRES_PASSWORD=demo -e POSTGRES_USER=demo -e POSTGRES_DB=luster_demo -p 55440:5432 postgres:16-alpine`; stopped and removed immediately after), migrated to the current tail (`0077_review_requests`). The container never held production data and was destroyed on completion.

**Method.** A throwaway vitest integration test (not committed — a one-off demonstration script, run and deleted in the same session) mocked the Stripe SDK layer only (`@/libs/stripe`, `@/libs/billing/stripePriceMap`), pointed `@/libs/DB` at the disposable container via `drizzle-orm/node-postgres`, seeded three `billing_subscription` rows with deliberate drift, and invoked the P4 `/api/billing/reconcile` route handler directly (CRON_SECRET-authorized, `BILLING_SUBSCRIPTIONS_ENABLED='true'`, `BILLING_TOPUPS_ENABLED` unset):

- **`sub_g30_a`** — `paid_through` LAG: local `paid_through` left at "now"; the mocked remote subscription's `latest_invoice` is a PAID invoice whose line-item period ends ~40 days out.
- **`sub_g30_b`** — status/cancellation drift: local `status='active'`, `cancel_at_period_end=false`; the mocked remote subscription reports `status='past_due'`, `cancel_at_period_end=true`.
- **`sub_g30_c`** — stuck pending downgrade: local `billing_offer_key='pro_2026_08_monthly'` with `pending_offer_key='starter_2026_08_monthly'`; the mocked remote subscription's price resolves (via a mocked reverse lookup) to `starter_2026_08_monthly` — Stripe is already billing the parked offer.

**Result — exact JSON response** (`purged: 0` because no `billing_stripe_event` rows were seeded in this demonstration; the purge step itself is separately covered by `src/app/api/billing/reconcile/route.test.ts`):

```json
{
  "purged": 0,
  "summary": {
    "checked": 3,
    "drift": [
      {
        "stripeSubscriptionId": "sub_g30_a",
        "field": "paid_through_behind",
        "local": "2026-09-14T05:37:51.984Z",
        "remote": "2026-10-24T05:37:51.000Z",
        "repaired": true
      },
      {
        "stripeSubscriptionId": "sub_g30_a",
        "field": "next_grant_drift",
        "local": "null",
        "remote": "2026-10-09T05:37:51.984Z",
        "repaired": false
      },
      {
        "stripeSubscriptionId": "sub_g30_b",
        "field": "status",
        "local": "active",
        "remote": "past_due",
        "repaired": true
      },
      {
        "stripeSubscriptionId": "sub_g30_b",
        "field": "cancelAtPeriodEnd",
        "local": "false",
        "remote": "true",
        "repaired": true
      },
      {
        "stripeSubscriptionId": "sub_g30_b",
        "field": "next_grant_drift",
        "local": "null",
        "remote": "2026-10-09T05:37:51.984Z",
        "repaired": false
      },
      {
        "stripeSubscriptionId": "sub_g30_c",
        "field": "pending_offer_applied_remotely",
        "local": "starter_2026_08_monthly",
        "remote": "starter_2026_08_monthly",
        "repaired": true
      },
      {
        "stripeSubscriptionId": "sub_g30_c",
        "field": "next_grant_drift",
        "local": "null",
        "remote": "2026-10-09T05:37:51.984Z",
        "repaired": false
      }
    ],
    "duplicateRemoteCustomers": 0
  }
}
```

**Reading it.** Every seeded drift was detected and, per §8.6, repaired ONLY through the existing idempotent transitions (`applyInvoicePaymentSucceeded` for `sub_g30_a`'s paid-through lag; `projectSubscriptionSnapshot` for `sub_g30_b`'s status/cancellation drift; `applyInvoicePaymentSucceeded`'s pending-offer-application branch for `sub_g30_c`'s stuck downgrade) — `repaired: true` on each. All three rows also carry a `next_grant_drift` entry (`repaired: false`, report-only by design, §6.4): none of the three had ever been evaluated by `/api/billing/windows/evaluate` in this from-scratch seed, so `next_credit_grant_at` was `null` against a non-null computed window boundary — exactly the drift that field exists to surface. `duplicateRemoteCustomers: 0` because none of the three shared a Stripe customer id in this seed (the duplicate-alert path itself has its own dedicated seeded test in `src/app/api/billing/reconcile/route.test.ts`).

## 4. PROPOSED contract amendments (Rev 2.3) — NOT ratified, NOT authorized

Recorded for owner ratification only. Nothing below is implemented until the owner ratifies it (plan decision D19).

| # | Proposal | Contract text affected | Why |
|---|---|---|---|
| a | Real Stripe Price/Coupon IDs are carried by an env-keyed server-only variable (`BILLING_STRIPE_PRICE_IDS` = `{ env, offers, topups, coupons }`, rejected at boot when `env !== BILLING_PLAN_ENV`), with the committed `stripePriceMap.ts` tables staying null placeholders | §4 (mapping "via `BILLING_PLAN_ENV`"), §12 (preview/local cannot resolve prod mappings) | §4 forbids committing live IDs, so activation has no carrier today; the boot check keeps the isolation structural |
| b | Register `/api/billing/windows/evaluate` and `/api/billing/reconcile` as Vercel crons while billing is dark (routes answer `200 skipped`) | §20 (no cron-registration step) | Only if plan decision D3 = yes; costs ~120 cold-start invocations/day against the shared database |
| c | Add a purpose guard to the legacy `/api/webhooks/stripe` `checkout.session.completed` handler (ignore `metadata.purpose ∈ {plan_subscription, sms_topup}`) | §5, §8.1 ("byte-identical / untouched this track"), §24 (retirement deferred) | The legacy handler is purpose-blind and would rewrite salon billing columns for new-track sessions if it still receives them; the ops-side alternative (endpoint event filtering) needs no amendment |
| d | Delete the Rev-1 pricing boilerplate (`src/templates/Pricing.tsx`, `src/features/billing/Pricing*`, `AppConfig.PricingPlanList`, `src/types/Subscription.ts`, `PLAN_ID`, related i18n namespaces) | §24 ("physical deletion of boilerplate residue (future cleanup)") | Dead code that invents feature limits §12 forbids |
