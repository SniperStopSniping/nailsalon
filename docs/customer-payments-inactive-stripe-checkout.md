# Inactive Stripe checkout adapter and booking preview handoff

## Scope

`src/libs/customerPayments/inactiveStripe/` implements Stripe SDK Checkout Session
creation and exact-ID retrieval, but is not imported by an application route,
page, worker, webhook consumer or the protected offline provider graph. The SDK
adapter itself has no application database, durable operation journal or financial
posting authority.
The existing deposit and billing handlers are unchanged. A separate closed-test
durable fence now exercises this immutable operation contract; see
`customer-payments-durable-checkout-fence.md`. It does not invoke this SDK adapter
or give its observations provider or financial authority.

The later closed SDK reservation lane joins the installed SDK kernel to a durable
journal using only scripted HTTP responses. It remains nonfinancial and
unregistered; see `customer-payments-durable-sdk-reservation.md`.

The factory requires an explicit `enabled: true` test purpose, a caller-supplied
test credential and fixed platform/connected-account/return-origin binding. It
never loads credentials from environment files or the global Stripe client.
`NODE_ENV=test` is mandatory; production and unsupported deployment markers are
rejected before client construction and again before requests. This is an
unregistered engineering seam, not a production feature toggle or permission to
operate a provider account. No real credential or provider request was used to
validate it.

## Request and response contract

- Use existing payment snapshot math, explicit experimental salon-paid fee policy
  and immutable operation/request/quote/context identities. Customer-paid fees,
  unknown currencies and unsupported monetary configurations fail closed.
- Freeze request parameters and use one stable idempotency identity. A process-local
  reservation prevents duplicate requests/appointments in that process. Reused
  provider objects are detected after observation and held for review. This does
  **not** replace durable journal fencing or survive process restarts.
- Pin installed Stripe 16.12.0 to API `2024-06-20`. Before creation, read the expected
  platform identity, test balance mode, connected-account identity/readiness and
  connected test balance mode. The bounded account contract requires CA/CAD,
  full Dashboard, merchant-paid fees and Stripe responsibility for requirements
  and payment losses. It does not require the transfers capability. Read-only
  reconciliation retains identity/mode/controller checks, but can inspect its
  existing Session if creation readiness later becomes paused.
- Quote authority expires within five minutes. A separate explicit Session expiry
  respects Stripe's 30-minute minimum and 24-hour maximum. It never extends the
  quote. Existing previews therefore cannot safely launch checkout until durable
  booking reservations and late-payment handling are integrated.
- Recheck the exact operation's quote and runtime at actual HTTP send, after the
  SDK's asynchronous preparation. Latch each mutation to at most one POST. The
  SDK retries initial ECONNRESET/EPIPE even with maxNetworkRetries=0; the wrapper
  removes raw transport error details/codes so that hidden mutation retry cannot
  occur. No dependency code was changed.
- Validate actual SDK response scope, Session identity, amount, currency and
  expiry. Expanded PaymentIntent/Charge evidence checks relationships and fee
  amounts. Null/unexpanded intents remain explicitly incomplete. A failed card
  attempt may evolve to a later successful charge; an observed captured identity
  cannot be replaced. A zero application fee is omitted from the request.
- Timeouts, malformed responses and uncertain results do not establish absence
  or authorize another create. Exact-ID retrieval needs a previously bound
  Session. Ownership-conflict review survives concurrent and failed reads.
- Diagnostic results always carry `providerOriginVerified: false` and
  `financialPostingAllowed: false`. Session status, metadata and successful
  redirects cannot settle a booking. Provider URLs and unrelated response data
  are not returned as a ready-to-launch customer checkout.

## Booking integration

A fresh confirmed, deposit-free booking can show a server-gated link to its
existing authoritative test quote/tip preview. It reuses only the server-issued
private manage URL on the current origin and adds a stable preview anchor.
There is no new booking POST field, automatic quote request, payment preference,
Pay button or successful-payment claim.

Pending/unknown bookings, required deposits/holds, recovered receipts, changed
booking contexts and unavailable/invalid links are excluded. Submitted deposit
fingerprints and existing deposit redirects are unchanged. URLs on another
canonical host are deliberately suppressed rather than rewritten. The manage
page still revalidates the capability, current booking and financial state.
Production and absent preparation flags show no new handoff.

## Verification and remaining work

Final checkpoint verification is recorded in `customer-payments-integration-gates.md`.
All SDK tests use a closed fake HTTP implementation and network traps with public
dummy credentials. This is installed-SDK wire-contract coverage, not a successful
Stripe sandbox payment, authenticated application journey or live readiness.

Still required: durable real-operation ownership/fencing, verified provider ingress
and canonical settlement, real refund and review workflows, booking reservation and
late-payment recovery, real checkout selection/receipt UX, isolated application DB
and credential binding, permitted provider tests, policy decisions, migrations,
release review and separately approved deployment/activation. Sandbox connected
account ownership/onboarding remains an external prerequisite. Do not weaken
country, readiness, signature or financial holds to bypass that prerequisite.
