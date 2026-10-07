# Luster owner entry — visual review, 7 October 2026

## Scope

A shared mobile visual system for the founding offer, Clerk owner sign-in and salon workspace selector. Blush canvas, cream cards, plum primary actions, Newsreader headings and Inter body text; restrained champagne detail. Customer booking themes and the approved Isla page are not restyled.

- Owner sign-in retains the existing Clerk component, password/recovery/verification flows and organization resolution. The new-salon link uses the existing onboarding feature gate and canonical onboarding route.
- The selector retains real membership roles and statuses, dashboard/public/booking destinations, reversible list hiding, confirmation, retry, restore and logout. Existing salon logos are included in the read model; missing or failed logos use botanical placeholders. Authorization decisions are unchanged.
- The hosted and prototype offer share one component. The real onboarding action now records an explicit owner-authorized lifetime core-software claim. Optional text subscriptions, top-ups, AI and phone usage retain their existing paid paths. The prototype remains an isolated visual fixture.

## Release dependencies — do not merge until resolved

1. **Claim semantics:** the user explicitly authorized the lifetime implementation on 7 October. Migration 0097 adds a durable, unique per-salon claim with immutable terms: core software $0/month for life, unlimited email, 100 one-time texts per verified business, and paid additional SMS/AI/phone/other usage. No old interest is automatically enrolled. Current-site ownership and membership are locked in the claim transaction; the claim deadline is the end of January 1, 2027 in Toronto. Existing claims and retries survive that date. The canonical verified-business grant controls the 100 texts; pending verification never prevents the core claim. Client confirmation requires the actual persisted entitlement response. Release still requires migration, current CI, hosted Preview and protected-main gates.
2. **Clerk providers:** read-only inspection of the production public instance configuration on 7 October found Google disabled and no Apple provider. Render only configured Clerk providers; do not add inert buttons or enable providers as an appearance change. Production uses a live key. Development screenshots correctly retain Clerk's development badge.
3. **Independent pricing work:** PR #349 is separate, remains untouched and proposes 50 starter texts. This brief and current main specify 100. Do not merge the older allowance under this visual change.

## Review and checks

Screenshots use the actual components with clearly isolated synthetic salon data and the real Clerk development widget. No customer data, messages, payments, or live account changes were used. Captures cover 320, 375, 390, 430 and 1280 pixels. The optional social buttons cannot be verified against production until configured.

The local review fixture is `tests/browser/ownerEntry/`. The fixture's ignored `.env.local` accepts a Clerk development publishable key for sign-in review; no key is committed. Offer and selector browser checks do not require a key.

Commands:

```sh
node node_modules/playwright/cli.js test --config tests/browser/ownerEntry/playwright.config.ts
```

The prototype's `tests/e2e/founding-offer.spec.ts` exercises the current Quick Book fixture through the offer, close/focus restoration and synthetic dashboard continuation at mobile and desktop widths. It establishes UI continuation, not lifetime entitlement activation.

Existing organization-resolution, membership scope, removal/restore, API response and onboarding persistence/retry tests remain relevant. All authentication and billing configuration stays outside this patch.

## Lifetime-claim verification (7 October 2026)

- 167 focused application tests passed: owner authorization, missing verification, retry/idempotency, cutoff, old-client false confirmation prevention, tenant-scoped status, and optional paid text plans/top-ups.
- Seven real PostgreSQL tests passed with zero skips on a new local disposable cluster. Twelve simultaneous retries create one claim and one 100-text grant; independent keys converge; revoked owners are denied after lock release; legacy conflicts serialize; purchased credits persist, SMS still meters and top-ups remain possible.
- 46 migration/fixture checks passed, including upgrading prior migration ledgers and preserving restrictive fixture safeguards.
- 32 Chromium/WebKit visual interaction checks passed at 320–1280px. These use isolated component fixtures and do not claim hosted backend verification.
- No customer booking, message, payment, provider activation or production entitlement was created during local checks.
