# SMS top-ups with free founding core access

October 8, 2026. This is a preparation and acceptance guide, not evidence that
payments have been configured or activated. The readiness CLI only reads
evidence; it never changes a switch, sends a message or charges a card.

## Current product contract

Founding core access stays free for life under its existing eligibility rules.
The existing 100 starter texts are separate from optional purchased credits.
Do not create a core subscription or annual coupon to enable SMS purchases.
Do not introduce expiry, monthly resets, automatic purchases or recurring billing.

The server-owned `src/libs/billing/topupCatalog.ts` defines the three current
one-time CAD packages:

| Carrier key | Credits | Price | Stripe unit amount |
| --- | ---: | ---: | ---: |
| `topup_100_2026_10` | 100 | $20 CAD | 2000 |
| `topup_200_2026_10` | 200 | $30 CAD | 3000 |
| `topup_500_2026_10` | 500 | $50 CAD | 5000 |

Each Price must be one-time, in CAD, and match the server catalogue. Keep the
environment-specific identifiers in `BILLING_STRIPE_PRICE_IDS.topups`, with
the carrier `env` matching `BILLING_PLAN_ENV`. Never commit identifiers or
secret values. Existing historical mappings remain valid and must be retained
for outstanding purchases, refunds and reconciliation; their retired offers
cannot be selected for a new purchase. New setup does not require inventing
prices for those retired offers.

## Readiness targets

| Target | Environment | Core subscriptions | Text top-ups | Required price catalogue |
| --- | --- | --- | --- | --- |
| `rehearse-topups` | Preview / Stripe test mode | Off | On in isolated test environment | Three active top-up packages |
| `activate-topups` | Production / Stripe live mode | Off | Still off before activation | Three active top-up packages |
| `rehearsal` | Legacy combined Preview rehearsal | On | On | Legacy subscriptions and active top-ups |
| `activate-subscriptions` | Legacy production subscription preparation | Off | Existing rule retained | Legacy subscriptions and active top-ups |

The last two targets are retained for compatibility. They are not steps in
the current free-core SMS rollout. Public pricing and tax collection switches
stay off for the top-up targets. The command does not permit a Preview label
to prove production readiness.

## Isolated test preparation

1. Use the intended Preview deployment and isolated test data with the test
   Stripe account. Provision its three test-mode Prices and existing dedicated
   `/api/webhooks/stripe-billing` endpoint. Preserve its exact handled-event
   list from `billingWebhookEvents.ts`, ownership marker and dedicated signing
   secret. Do not reuse the deposit/legacy webhook identity.
2. Keep `BILLING_SUBSCRIPTIONS_ENABLED`, `PUBLIC_PRICING_ENABLED` and
   `BILLING_TAX_COLLECTION_ENABLED` off. Enable only `BILLING_TOPUPS_ENABLED`
   in this controlled test scope. Preserve identity, schema and integrity gates.
3. Collect private evidence for the same deployed SHA and origin: pulled env
   file, value-free endpoint and portal exports, integrity report and manual
   cron invocation proof. The subscription-window cron must return its billing
   disabled skip; reconciliation must run and not report that skip. Preview
   cron registration alone is not invocation evidence.
4. Run the existing CLI with `--target rehearse-topups`, `--env-source deployed`
   and `--environment preview`, supplying all evidence flags described in
   `scripts/billing-readiness-check.ts`. Its exit must be 0 before recording
   readiness. Exit 4 means a supplied condition failed; 5 means evidence is
   missing/unreadable; 6 means the source or invocation cannot prove the target.

The portal export must still show plan switching disabled. The deployment,
test/live mode, price-carrier digest, dedicated webhook secret distinction,
exact event list, cron response bodies and clean ledger-integrity checks remain
required. A local shell, invented response or screenshots cannot replace them.

## Payment and balance acceptance

Use an authorized test owner and controlled Stripe test checkout. Do not enter
production owner credentials into an unfamiliar Preview origin.

- More -> balance -> each offered package -> Checkout -> paid return: the exact
  purchase is confirmed and the correct salon balance refreshes.
- Pending/delayed payment stays pending until verified paid evidence arrives.
- Cancelled and failed checkout grant no credits.
- Replayed webhook and reconciliation produce one purchase grant.
- The history row, last successful package and concurrent sends remain accurate.
- Switching salons does not leak a balance, purchase or history to another salon.
- Founding starter credits remain a one-time grant. No real client message is
  needed to test purchase completion.

The CLI verifies configuration evidence, not that these customer/payment
outcomes occurred. Retain those results separately.

## Production preparation and activation

Provision the intended live-mode identifiers and dedicated endpoint only after
the controlled rehearsal. Repeat evidence collection for the production SHA
and canonical origin. Run `--target activate-topups --env-source deployed
--environment production` with the evidence flags. Core subscriptions and
top-ups must both still be off for this pre-activation check.

Only after the required results and production configuration are reviewed,
enable the text top-up switch through the normal production release process.
Keep core subscriptions off. After activation, the pre-activation target will
correctly fail because the top-up switch is already on; use the deployed SHA,
runtime health, integrity checks and controlled acceptance as separate evidence.

To stop new purchases, turn off `BILLING_TOPUPS_ENABLED`. Preserve verified
webhook processing and reconciliation for already-created purchases; do not
delete historical credit or purchase records. No database migration is required
by the readiness change.
