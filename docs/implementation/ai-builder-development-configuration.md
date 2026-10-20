# Current isolated AI builder configuration

Use the existing `codex/ai-business-setup` worktree. These instructions supersede the original Astra/CAD40 configuration snapshot. Do not pull Production variables or copy production credentials into this worktree.

The only configuration file read by the checker is this worktree's ignored `.env.development.local`. It must be a regular file with mode `0600`; symlinks and group/world-readable files are rejected before reading. The checker never modifies it or prints credential values. Keep `APP_ENV=development`, `BILLING_PLAN_ENV=dev` and the existing loopback Development database on port55432. The standalone renderer receives no database, Clerk, Stripe or provider credentials.

## Check the existing configuration

```sh
npx tsx scripts/check-custom-site-trial-config.ts
npx tsx scripts/check-custom-site-trial-config.ts --verify-budget
npx tsx scripts/check-custom-site-trial-config.ts --verify-provider
```

The default check reports only presence/shape, explicit local isolation, the current canonical model IDs and configured cap. Intake/small edits use `gpt-6-luna`; generation/visual extraction uses `gpt-6.1-sol`. The combined approved testing ceiling is CAD80, but that is not a new local allowance. Preserve the existing local CAD11.384406 allocation and hosted CAD68.615594 allocation. Neither file editing nor this checker raises or resets the persisted budget.

`--verify-budget` attests the fixed loopback database and Development marker, then reads the existing ledger in a read-only transaction. It reports its effective cap, charged/retained usage, pending calls and remaining allowance. Unknown provider usage remains counted. It never creates or releases a budget/reservation. It does not inspect the hosted ledger or claim an up-to-the-minute combined expense.

`--verify-provider` performs only authenticated GET requests for both configured model IDs. It starts no generation, uploads nothing and makes no purchase. Model availability does not by itself prove image-input compatibility or output quality; real owner-workflow trials are documented separately.

## Authentication and sandbox payment configuration

OpenAI and matching Clerk Development credentials have now passed isolated real-owner trials. Actual signup, verification, fresh password sign-in through More and the AI introduction, saved draft reload, exact approval and original customer bookings are recorded in the [genuine owner checkpoints](../../artifacts/ai-credits/genuine-owner-https-checkpoint/README.md). That evidence supersedes the earlier rejected-key/placeholder finding; it does not establish hosted or Production authentication.

The owner-approved Development-only rotation is complete. The replacement authenticates to the expected Development instance; the previous key now returns HTTP401. Fresh genuine password sign-in, saved-site reopening and refresh passed through desktop More and the iPhone-profile AI introduction. Only this worktree's ignored private Development configuration was updated. Other consumers' old configuration remains stale until securely refreshed. See the [rotation and Stripe acceptance checkpoint](../../artifacts/ai-credits/development-rotation-stripe-checkpoint/README.md). Never send replacement secrets through chat or task messages.

If access to configure the Development instance is needed, run locally:

```sh
clerk auth login
```

After login, configure matching **Development** `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` through the Clerk development-key workflow/local editor. Do not paste secrets into chat, terminal command arguments, source files or recordings. A CLI login does not itself replace these application keys or prove signup. The actual isolated signup/verified-email/salon-resume journey must then be tested with synthetic accounts and the exact Development auth hosts allowed by its test harness.

Stripe sandbox keys and the distinct CAD10/20/50 one-time AI-credit prices are configured privately for this local Development environment. Actual owner-facing Stripe card payments, signed provider webhooks, exact credit fulfillment, partial/full refunds, duplicate-event guards and mobile cancellation passed. These real test purchases are recorded separately from the earlier synthetic recovery grant.

AI credits use the separate billing endpoint `/api/webhooks/stripe-billing` and **`STRIPE_BILLING_WEBHOOK_SECRET`**, not the legacy `STRIPE_WEBHOOK_SECRET` or Connect signing secret. The local acceptance used an official Stripe CLI listener forwarding only to loopback; its signing secret was saved privately and the listener is now stopped. This is not a hosted endpoint or Production payment configuration. Paid flags were enabled only in the isolated acceptance processes. Hosted/Production flags and all other payment products/prices remain unchanged. Never copy live payment credentials into a trial.

Optional credential-format gates:

```sh
npx tsx scripts/check-custom-site-trial-config.ts --require-owner-credentials
npx tsx scripts/check-custom-site-trial-config.ts --require-payment-credentials
```

These gates fail for missing/placeholders/wrong-mode credentials. Their output always leaves `ownerSignupVerified` and `paymentAcceptanceVerified` false: plausible credential shapes do not prove provider acceptance or a functioning customer journey.

Production is separate. Its server-only builder key, verified isolated renderer and matching live payment configuration require the existing release process. For this release, the owner explicitly requested reuse of the existing working OpenAI builder credential. Authenticated, non-billable GETs verified both configured model IDs; that key is now staged as a Production-only Vercel Secret without revealing or copying back its value. The local configuration was unchanged, no Development Clerk or Stripe sandbox key was copied, and all AI/purchase activation switches remain off. This does not establish Production runtime acceptance or authorize copying Production secrets into Development.

The owner approved production release after the remaining gates pass. Production should use `CUSTOM_SITE_PRODUCTION_FUNDING_MODE=paid_credits`, with `CUSTOM_SITE_PRODUCTION_BUDGET_CAD` absent: each salon's verified net paid credits fund its provider usage, rather than a lifetime CAD50 ceiling shared by all customers. Half of those net credits fund expense using the request's frozen conversion. Refunds/disputes reduce funding; recovery grants and sandbox purchases do not add it. Pending, failed and unknown expenses remain counted for that salon, and its paid credit reservation and existing failure fuse are still required. Fixed-cap mode remains available for an explicitly approved alternative; specifying both modes fails closed. Neither mode inherits the separate CAD80 test allowance. Stripe receives customer payments while OpenAI charges the operator's provider account separately. Leave purchases disabled until all required acceptance and release gates pass. No command on this page deploys or applies migrations.

## Verified on 2026-10-18

The earlier configuration-only check passed 20 deterministic guard cases, TypeScript, scoped ESLint and whitespace checks. Both configured model GETs returned200 with the exact requested identifiers; that check started no generation. Its rejected Clerk-key result and CAD9.454164 usage snapshot are historical, superseded by the genuine owner trials linked above.

The later owner trials made six actual OpenAI calls and completed original bookings; the optimized HTTPS return visits and subsequent Stripe acceptance made no model calls. At the final model-expense ledger check, the persisted CAD11.384406 allocation had CAD9.578990 charged/retained, zero pending and CAD1.805416 remaining. Unknown expenses remain counted. The older CAD40 file value does not override that smaller persisted allocation. The hosted CAD68.615594 allocation remains separate and unchanged. These are recorded test snapshots, not a new allowance or an up-to-the-minute combined expense. Stripe sandbox acceptance is now recorded in the checkpoint above; hosted and Production payment readiness remain separate. Credential-shape checks intentionally do not set owner signup or payment acceptance to verified; the corresponding real workflows provide that evidence separately.

The subsequent [Stripe-funded owner-generation checkpoint](../../artifacts/ai-credits/paid-owner-generation-checkpoint/README.md) made two further real OpenAI calls through the owner chat, saved/reviewed/published revision18 locally, and completed an original Luster booking in WebKit. Its mixed Stripe/recovery wallet was debited CAD0.220708. The conservative operator ledger now retains CAD9.736638, pending zero, leaving CAD1.647768 of the unchanged local allocation. This supersedes the preceding local usage snapshot, not its recorded historical result. Preview was inspected read-only and still lacks the newer AI-credit/metering and staff/add-on publication schema. Neither configuration-shape checks nor the successful local journey authorize hosted migrations, configuration writes or deployment.
