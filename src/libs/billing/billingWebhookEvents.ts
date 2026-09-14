/**
 * The Stripe BILLING webhook's handled event-type allowlist — extracted from
 * `src/app/api/webhooks/stripe-billing/route.ts` (P8c) so it can be reused
 * by `src/libs/billing/readinessCheck.ts` and its CLI
 * (`scripts/billing-readiness-check.ts`) without importing the route module
 * itself (Next.js route files may only export the handful of reserved route
 * symbols — HTTP method handlers, `dynamic`, etc. — and no other named
 * export, so the constant has to live here).
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §8.4.
 * Plan: docs/luster-billing-remaining-work-plan.md §3 G01/G05/G42, §5 P3a.
 *
 * Deliberately NOT `import 'server-only'`: unlike the rest of `src/libs/
 * billing`, this module is plain literal string data with no secrets, no
 * database access and no Stripe SDK use, and it must stay importable from a
 * plain `tsx` process — `scripts/billing-readiness-check.ts` runs outside
 * Next.js's server-component bundling, where the `server-only` package's
 * default export throws unconditionally (see readinessCheck.ts's file
 * header for the same constraint applied to that module).
 *
 * Keep this list and the route's runtime behaviour in exact sync: the route
 * imports `BILLING_WEBHOOK_HANDLED_TYPES` and does nothing else with it
 * (`new Set(BILLING_WEBHOOK_HANDLED_TYPES)`, consulted only via `.has()`),
 * so editing this file IS editing the route's handled-type set.
 */

export const BILLING_WEBHOOK_HANDLED_TYPES = [
  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'charge.refunded',
  'refund.updated',
  'charge.dispute.created',
  'charge.dispute.closed',
] as const;

export type BillingWebhookHandledType = (typeof BILLING_WEBHOOK_HANDLED_TYPES)[number];
