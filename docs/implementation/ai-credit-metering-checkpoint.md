# Prepaid AI usage development checkpoint

This is a delivery record for the credit-metering phase. It does not mark the
complete paid builder as released. All flags remain off in the checked-in
example; no production migration, deployment, payment or model call was made
for this phase.

## Implemented behavior

- Both the owner chat and the auxiliary design screen show the CAD2 maximum
  before sending. The server accepts only that published maximum, freezes the
  request identity, revision, model rates and accounting conversion, then holds
  up to that amount from the salon's balance. The model cannot raise the limit.
- Intake, extracted menus, generated custom source and bounded automatic repair
  share the admitted request. Exact multimodal token counting happens before
  each provider call, with a conservative cost bound inside the remaining hold.
  Requests explicitly use Standard processing; usage from an unconfirmed or
  different provider tier is treated as unknown.
- A saved domain receipt is required for settlement. Measured usage is charged
  once; unused credits become available. Failed or unknown work is not charged
  to the customer. Provider expense evidence remains private for accounting.
- Duplicate or lost-response requests do not repeat a model call. If a saved
  result's settlement fails, reading the balance or retrying that exact request
  resolves the existing receipt. An interrupted request expires after six
  minutes; reconciliation releases its hold and revokes late draft writes.
- Every admission and draft write repeats owner/salon authorization. An internal
  execution token permits refunding a previously admitted failure even if its
  owner's membership has since changed; it does not grant further draft access.
- Manual controls, reviewing/applying extracted details, restoring a saved
  design and ordinary bookings do not call the provider or consume AI credits.
  Price changes continue through the shared service draft and exact publication
  review. They do not change the live catalog during generation.
- Paid editing uses bounded conversation context instead of the old lifetime
  200-turn / 30-design pilot limits. Production admission pauses after ten
  refunded/unknown/capped requests with provider-call evidence within 24 hours.
  A separate existing endpoint rate limit bounds rapid new requests.
- The auxiliary design screen clears submitted text immediately, retains the
  exact request across a lost response and refresh, and checks it before
  starting another generation. This complements the main chat's saved-request
  recovery. Tiny credit-history charges are shown as less than one cent.

## Configuration and rollout boundary

Migration `0108_ai_request_metering.sql` extends the existing credit reservation
and AI expense tables. It is additive, leaves old holds valid, and does not
rewrite services, appointments, billing subscriptions or SMS credits. Apply it
before enabling metering. Do not edit previously committed migration `0107`.

Server-only configuration:

- `AI_CREDITS_ENABLED=true` exposes the paid wallet and requires paid admission.
- `AI_CREDIT_METERING_ENABLED=true` enables reservation/settlement. It is also
  required for production provider configuration and for credit purchases.
- `AI_CREDIT_PURCHASES_ENABLED=true` enables verified one-time CAD10/20/50 packs
  only after the other flags and Stripe configuration are ready.
- `AI_CREDIT_USD_TO_CAD_MILLIONTHS` and `AI_CREDIT_PRICING_VERSION` define a
  reviewed internal accounting conversion. Existing reservations retain their
  frozen version when the configuration changes.
- Existing dedicated `OPENAI_API_KEY_CUSTOM_SITES` remains server-only.
- Existing Stripe environment checks and server-carried
  `AI_CREDIT_STRIPE_PRICE_IDS` require sandbox prices/keys in development and
  Preview. Never copy production payment credentials into local development.

Non-production provider trials still consume the original shared operator
trial ledger and CAD80 hard ceiling; the wallet does not create a fresh trial
allowance. Production paid calls are funded by their prepaid reservation.
Operator expense values must be reconciled across isolated environments before
further real-provider trials.

## Verification and remaining release gates

Deterministic provider doubles exercise real PGlite draft persistence,
extraction review, service-price edits, generated-source validation and repair,
paid history limits, frozen prices, failed usage, permission revocation, lost
responses, stale edits and settlement recovery. Hand-authored source is a
validation fixture, never evidence of successful AI design generation.

The attested disposable PostgreSQL suite separately exercises seven wallet/
metering races and seven publication/conversation concurrency cases. Browser
credit checks use the real React interface with synthetic payment responses on
desktop Chromium, phone Chromium and iPhone WebKit; they do not prove real
Stripe checkout.

Local phase results: 406 focused unit/integration/component tests passed; the
seven PostgreSQL-only wallet cases skipped in that invocation passed separately
alongside seven publication concurrency cases (14 passed, zero skips). All 12
browser checks passed on the final unchanged-source run. Sixteen native CI
contract checks, scoped ESLint, TypeScript and the working-tree secret scan
passed. An earlier browser run was invalidated by a development-server reload
while formatting source; it is not included as passing evidence.

Still required before paid release: configure the isolated Stripe test key and
complete real sandbox checkout/webhook/refund trials; finish the normal
onboarding/More entries and supported staff/settings experience; repeat real
owner-facing model generation and booking acceptance with tracked usage;
verify preview infrastructure isolation; pass remote CI/review/release gates.
Disabling new AI admission must preserve saved sites and original bookings.
