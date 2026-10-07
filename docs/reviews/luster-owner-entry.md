# Luster owner entry — visual review, 7 October 2026

## Scope

A shared mobile visual system for the founding offer, Clerk owner sign-in and salon workspace selector. Blush canvas, cream cards, plum primary actions, Newsreader headings and Inter body text; restrained champagne detail. Customer booking themes and the approved Isla page are not restyled.

- Owner sign-in retains the existing Clerk component, password/recovery/verification flows and organization resolution. The new-salon link uses the existing onboarding feature gate and canonical onboarding route.
- The selector retains real membership roles and statuses, dashboard/public/booking destinations, reversible list hiding, confirmation, retry, restore and logout. Existing salon logos are included in the read model; missing or failed logos use botanical placeholders. Authorization decisions are unchanged.
- The hosted and prototype offer share one component and one founding-interest action. No new tiers, payment collection, SMS delivery, ledger change, migration, or entitlement activation is included.

## Release dependencies — do not merge until resolved

1. **Claim semantics:** the current server action persists `founding_interest`, not a lifetime entitlement. The requested “Claim my free lifetime plan” presentation is ready for review, but must not be released as a working lifetime claim without a matching, verified entitlement contract. The user has been asked whether to extend scope to that implementation or keep the offer in review and release the other two screens first.
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
