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

## Complete the missing authentication/payment configuration

OpenAI already works in the isolated real-owner trials. Local Clerk Development credentials remain invalid/incomplete: the server key was rejected with401 and the public key points to a placeholder host. To authorize secure access to the Development instance, run locally:

```sh
clerk auth login
```

After login, configure matching **Development** `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` through the Clerk development-key workflow/local editor. Do not paste secrets into chat, terminal command arguments, source files or recordings. A CLI login does not itself replace these application keys or prove signup. The actual isolated signup/verified-email/salon-resume journey must then be tested with synthetic accounts and the exact Development auth hosts allowed by its test harness.

Stripe sandbox setup remains deferred. When authorized, provide matching sandbox `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, the sandbox endpoint's `STRIPE_WEBHOOK_SECRET`, and the distinct fixed CAD10/20/50 one-time pack price map through the existing environment-specific billing configuration. Never copy live payment credentials into a trial. Real sandbox checkout/webhook/refund acceptance must pass before enabling paid purchases. Existing synthetic recovery grants are not evidence of a successful checkout.

Optional credential-format gates:

```sh
npx tsx scripts/check-custom-site-trial-config.ts --require-owner-credentials
npx tsx scripts/check-custom-site-trial-config.ts --require-payment-credentials
```

These gates fail for missing/placeholders/wrong-mode credentials. Their output always leaves `ownerSignupVerified` and `paymentAcceptanceVerified` false: plausible credential shapes do not prove provider acceptance or a functioning customer journey.

Production is separate. The dedicated production key, verified isolated renderer, matching live payment configuration and explicit `CUSTOM_SITE_PRODUCTION_BUDGET_CAD` require the existing approval/release process. The CAD80 test approval does not authorize production API use. Leave purchases disabled until all required acceptance and release gates pass. No command on this page deploys or applies migrations.

## Verified on 2026-10-18

Twenty deterministic guard cases, TypeScript, scoped ESLint and whitespace checks passed. Both configured model GETs returned200 with the exact requested identifiers; no generation started. The read-only database attestation passed with CAD9.454164 charged/retained, zero pending and CAD1.930242 remaining. The local file still contains its older CAD40 value; the persisted CAD11.384406 allocation is the smaller enforced cap, and the checker reports that difference without rewriting the file. The owner-credential gate correctly exited1 because Clerk Development credentials are not configured. Stripe sandbox credentials also remain placeholders. These checks do not substitute for real signup or checkout acceptance.
