# Sol handoff: top-up checkout retry safety

Base: `77231193` (latest `origin/main` at implementation start). Contract:
[luster-billing-communications-rev-2-2.md](luster-billing-communications-rev-2-2.md), C3 and §§8.5, 9.

## Implemented

- Top-up reservation uses a per-salon `FOR NO KEY UPDATE` lock, compatible with payment-ledger foreign-key locks. Only the new attempt's creator inserts a purchase and calls Stripe. Subscription attempts remain independent.
- Repeated matching requests reuse a verified open session, including tenant, offer, attempt and purchase bindings. Different offers return `409 CHECKOUT_IN_PROGRESS`.
- Unbound attempts, provider/retrieval errors and local binding failures return `409 CHECKOUT_PENDING_RECONCILIATION`. Their attempt and purchase remain held; neither local TTL nor subscription expiry releases them.
- Verified expiry updates purchase and attempt atomically. Early expiry delivery retries until binding exists. Fulfillment completes the attempt; previously fulfilled/reversed purchases retain grant evidence permitting a later intentional purchase. Paid-but-unfulfilled sessions stay held.
- Multiple active attempts fail closed with an anomaly report. No migration, pricing, subscription redesign, legacy webhook, Connect or UI changes.

## Operational boundary

Billing switches and provider configuration are unchanged. No production, deployment, merge or activation action is included. Unknown outcomes deliberately require a later, separately reviewed reconciliation step; never clear a hold or issue a replacement based only on age. All creation errors are conservatively held, including errors that might ultimately prove safe to retry.

The current billing webhook does not handle `checkout.session.async_payment_succeeded`; a completed-but-unpaid top-up remains held. This phase does not add automatic unknown-outcome or asynchronous-payment recovery. Investigate persisted attempt/session identifiers and verified Stripe evidence before any future repair. Never guess an unbound purchase from its offer.

## Validation

Route regressions cover duplicate/reused attempts, offer conflicts, tenant and dark-switch rejection, mapping checks, uncertain provider responses, binding failure, metadata mismatch, expiry, early webhook delivery, fulfillment, refunds and disputes. A guarded disposable-Postgres suite exercises genuine overlapping requests and lock compatibility; the existing PostgreSQL CI job includes it.

Final validation on Node 20.19.4:

- Focused billing suite: **77 passed** across top-up route (24), subscription checkout (16), billing webhook (7), subscription projection (7), credit grants (23). Command: `npx vitest run --no-file-parallelism src/app/api/billing/checkout/topup/route.test.ts src/app/api/billing/checkout/route.test.ts src/app/api/webhooks/stripe-billing/route.test.ts src/libs/billing/billingSubscriptionProjection.test.ts src/libs/billing/creditGrants.test.ts`.
- Strengthened standalone PostgreSQL suite: **3 passed**, including eight initial requests waiting on the same salon lock, tenant independence during remote I/O, and deterministic expiry/fulfillment lock compatibility. Uses the existing guarded `CONCURRENCY_TEST_DATABASE_URL` pattern.
- An earlier combined credit + top-up PostgreSQL run passed 11 tests. After strengthening, the final combined rerun was blocked by host **ENOSPC** while writing WAL/cache; it is not a final green combined gate.
- `npm run check-types`: passed with the repository's synthetic CI provider placeholders. Scoped ESLint and `npm run lint`: passed. `npm run security:check-secrets -- --tree`: passed (2,534 tracked files).
- `npm run test:all -- --maxWorkers=2 --minWorkers=1`: attempted, exited 1 during host disk exhaustion; incomplete, **not green**. Full-suite and final combined PostgreSQL gates must be rerun before delivery beyond this local review branch.
- Browser tests/build/remote CI/preview were not run. This phase changes no browser UI. No branch push, deployment, merge or activation was performed.

Fresh `npm ci` failed due to disk exhaustion. Checks used an existing compatible dependency tree through a local ignored symlink, without changing the lockfile. The first reused tree was stale; final checks used the installed Next 15.5.25 tree. The disposable PostgreSQL cluster created for these tests was stopped and removed. No user-owned files or services were cleaned up.
