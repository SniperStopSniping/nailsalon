# SaaS Readiness Snapshot

## Current Position

This product is ready for:
- founder-led onboarding
- managed multi-salon rollout
- niche vertical SaaS sales where setup is still concierge-assisted

This product is not fully ready for:
- low-touch self-serve acquisition
- zero-support salon onboarding
- a buyer expecting a completely productized generic SaaS asset

## Why It Is Already Valuable

The repo already contains:
- multi-tenant salon isolation
- customer, staff, admin, and super-admin roles
- live booking flows
- reminders
- rewards and referrals
- Stripe subscription plumbing
- feature gating and billing enforcement hooks
- super-admin operational surfaces

That makes it materially stronger than a template or demo app.

## Biggest Gaps To Close Next

1. Productize onboarding
   - add a real new-salon setup flow with starter templates and fewer manual ops steps
2. Harden browser QA
   - repeatedly verify booking, reschedule, cancel, admin, and staff flows in real browser runs
3. Tighten operations
   - keep env verification, migrations, cron setup, monitoring, and launch docs aligned with the actual deployed product
4. Remove boilerplate residue
   - keep public docs and naming consistently focused on the nail salon product, not the original starter kit
5. Expand retention-driving features
   - deposits, calendar sync, imports/exports, stronger analytics, and richer client history

## Practical Sellability View

If you are selling:
- **codebase only / little to no recurring revenue**
  - this is best framed as a vertical SaaS asset, not a proven SaaS business
- **live salons with retained usage and revenue**
  - this becomes a different category of sale and should be valued off actual MRR/ARR and retention instead of just product quality

## Operational Rule

Treat the app as launch-ready only when all of these are true:
- `npm run check-types` passes
- `npm run ops:verify:launch` passes
- pending migrations are applied
- cron and monitoring are configured
- real booking and reminder smoke tests succeed in production
