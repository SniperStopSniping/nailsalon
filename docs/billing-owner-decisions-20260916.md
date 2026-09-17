# Billing — owner decisions of 2026-09-16

Record only. This file decides nothing; it writes down what the owner approved on 2026-09-16, in
the scope in which it was approved, and — with equal weight — what each approval does **not**
authorize. Where an approval corresponds to a question in
`~/Documents/luster-billing-final-safety-review-20260915/FINAL_IMPLEMENTATION_HANDOFF.md` §7, the
`O`-number is cited so the two records cannot drift.

Billing is dark in production throughout (`www.lustergel.app/api/health` → `billing.dark true`).
Nothing below changes that.

---

## 1. Durable `billing_customer` mapping per salon and environment, including a reviewed migration

Handoff §3 / §7 **O12**. Implemented by **PR-3** (`migrations/0078_billing_customer.sql`,
`src/libs/billing/billingCustomer.ts`, `Schema.ts`, the checkout/top-up/portal customer resolution,
the projection tenant guard and the reconcile `customer_mismatch` path).

**Authorizes:** adopting a canonical, tenant-scoped `billing_customer` table keyed per salon and per
plan environment as the new track's own customer identity; writing the migration by hand; having it
reviewed (payment-safety review **and** a schema review of cascade, plan-env check and uniques)
before merge.

**Does NOT authorize:** applying that migration to production (see §6); creating, editing or
deleting any Stripe Customer; any change to `salon.stripeCustomerId`, which stays legacy-owned; any
other new table. A `billing_customer` table is not created or referenced by this PR — it is PR-3's.

## 2. Reuse and adoption only from verified, environment-matching new-track evidence

Handoff §3.4 / §7 **O13**. Implemented by **PR-3**.

**Authorizes:** adopting an existing Stripe Customer into `billing_customer` only from evidence this
track can verify — a `billing_subscription` row, or new-track metadata whose deployment/plan
environment matches the runtime — and, explicitly, accepting that a genuine legacy subscriber who
joins the new track receives a **separate** Stripe Customer.

**Does NOT authorize:** reusing `salon.stripeCustomerId`, ever, for a new-track charge, link or
portal session; inferring ownership from an email address; adopting a customer from an environment
that does not match the runtime; back-filling existing salons.

## 3. Exact checkout and portal postimage updates, correct refusal responses, remaining origin fixes

Handoff §7 **O10** (with §2.3 refusal typing and the X5 hosted-origin fix). Implemented by **PR-3**
(a different worktree and a different PR from this one).

**Authorizes:** editing the two reviewed-postimage-pinned routes
(`src/app/api/billing/checkout/route.ts`, `src/app/api/billing/portal/route.ts`) and registering the
exact new blob hashes in `CI.yml`, each against an independent payment-safety review; correcting the
refusal responses so an attempt conflict surfaces under its own code rather than
`ACTIVE_SUBSCRIPTION_EXISTS`; finishing the hosted-origin correction and `returnUrl` validation.

**Does NOT authorize:** any behaviour change beyond those items; removing or loosening an existing
refusal; a postimage hash added without the review record; touching `checkout/topup/route.ts` beyond
the CI allowlist entry it already has.

## 4. Owner-only subscription, top-up and cancellation actions

Handoff §7 **O7** (Y1). Implemented by **PR-6**, before any production switch.

**Authorizes:** gating the three money actions — start a subscription, buy a top-up, cancel — behind
`requireAdminOwner`, the policy `adminAuth.ts` already states.

**Does NOT authorize:** exposing any of those actions to owners now; enabling them in any
environment; changing who may read billing state.

## 5. The narrow D19c amendment, including the settings and Portal companion

Handoff §2.2/§2.5/§2.8/§2.10 and §7 **O1** (+ **O10** for the legacy route's postimage). Implemented
by **this PR (PR-A / handoff PR-5)**.

Owner wording: approval of "the narrow D19c amendment: isolate new-track checkout/subscription/
invoice events from legacy mutation, preserve genuine legacy behavior, and include the
settings/Portal companion", with "No broader contract amendment is approved."

**Authorizes:** the two guards inside `src/app/api/webhooks/stripe/route.ts` (Guard A — the
`metadata.purpose` marker on a Checkout Session and on a Subscription; Guard B — one indexed read
proving local `billing_subscription` ownership); replacing that route's CI zero-diff pin with a
reviewed-postimage hash; the read-only display companion
(`src/libs/billing/salonBillingDisplay.ts`) wired into the admin and super-admin settings responses;
and the three Rev 2.3 contract edits (§5 rewrite, §5 companion append, §8.1) plus the §24 note.

**Does NOT authorize:** any other change to the legacy route — it gains no event-id table, no shared
state with `/api/webhooks/stripe-billing`, and no new behaviour beyond skipping; rewriting
`salon.billingMode` or any legacy column from the new track; making `billingMode` editable
(`canEditBillingMode` stays `false`, `billingMode` stays in the admin route's `FORBIDDEN_FIELDS`);
amending §8.2, §8.4, any `stripe-connect` text, or anything about customer identity; retiring the
legacy route — the §5 isolation exception is not retirement and does not advance it.

---

## 6. Recorded explicitly, as limits on all five approvals

- **Production migration or application is NOT authorized.** Approving the `billing_customer`
  migration is approval to write and review it, not to run it. Applying it to production is a
  separate, owner-executed step under the guarded procedure.
- **No provider configuration, no secrets, no payments, no grants, no rehearsal, no activation.** No
  Stripe or Vercel resource is created, edited or read as part of these approvals; no environment
  variable value is set; no `BILLING_*_ENABLED` switch is flipped; no starter grant is issued; the
  Preview rehearsal is not authorized by any of the five (it needs its own written authorization,
  handoff §7 **G9**).
- **Pricing and tax switches stay off.** `PUBLIC_PRICING_ENABLED` and
  `BILLING_TAX_COLLECTION_ENABLED` remain unset in every scope.
- **No broader contract amendment is approved.** Rev 2.3 carries exactly the edits listed in §5
  above and nothing else.

## 7. Implementation index

| # | Approval | Implemented by | Migration |
|---|---|---|---|
| 1 | `billing_customer` mapping + reviewed migration (O12) | PR-3 | 0078 — written and reviewed; **not applied** |
| 2 | Verified-evidence reuse/adoption only (O13) | PR-3 | — |
| 3 | Checkout/portal postimages, refusals, origin fixes (O10) | PR-3 | — |
| 4 | Owner-only money actions (O7 / Y1) | PR-6 | — |
| 5 | Narrow D19c amendment + settings/Portal companion (O1, O10) | **PR-A (this PR)** | none |

**Migration index 0078** was reallocated to `billing_customer` from the retired PR #223, whose own
`0078` was dropped when that PR was retired. No other index is reserved by these approvals.
