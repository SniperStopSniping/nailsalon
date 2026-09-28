# All-plan features and lifetime SMS allowance

All plans include the built salon features. Plan differences are the existing SMS allowances: Free has 100 credits once per owner/business identity and no monthly refill; Starter/Pro/Elite retain 200/400/800 credits per monthly credit window. One SMS credit covers one message segment. Global provider controls, consent, owner preferences, payment readiness, and unfinished feature flags remain enforced. This change does not enable subscription billing or paid top-ups.

Super-admin → salon → Billing & Programs → Add texts grants a chosen number of non-expiring administrative credits with a reason and atomic audit record. Repeated submissions use one request identifier. These bonuses do not reset lifetime eligibility and do not send messages.

Deposits become available on every plan. Existing active deposit setups continue. Settings previously saved while deposits were unavailable require a fresh owner confirmation after payment setup; unlocking availability must not begin dormant collection. The audited super-admin deposit endpoint remains an emergency suspension control, separate from plan access; resuming it does not confirm an owner's dormant rules.

## Lifetime identity rollout

1. Apply `0094_billing_phone_identity` using the guarded database runbook after a verified backup. It extends the existing durable identity constraints; no prior migration is edited.
2. Provision a dedicated `BILLING_IDENTITY_HMAC_SECRET` and version `1` if there is no existing key. Retain existing key material if there is. Never print secrets or generate a new key over an existing one.
3. Keep `BILLING_STARTER_IDENTITY_READY=false` during reconciliation. Salon creation succeeds, but new free allowances stay pending. Existing credit balances and explicitly granted administrative credits remain usable.
4. Read authenticated `GET /api/super-admin/billing/starter-identity-readiness`. It returns counts only, including historical claims without current-key verified email or phone links. It never grants credits.
5. Existing owners with claimed allowances use Usage & Billing → Claim 100 free texts after verifying primary email and phone through their Clerk account. This attaches verified contact links to the same durable identity and reports already claimed. It does not issue another allowance. For a salon with unspent starter credits the card instead says Verify your free-text allowance. Do not fingerprint arbitrary salon contact fields or unverified legacy admin phone values.
6. Investigate identity conflicts without auto-merging businesses. A purged identity with unrecoverable verified contacts is an unresolved release blocker for the across-recreated-accounts guarantee. Do not assert completeness from same-Clerk tests alone.
7. Enable `BILLING_STARTER_IDENTITY_READY=true` only when the authenticated report shows `ready:true` and the verified contact linkage has been reviewed. Re-read after deployment. This environment control is separate from subscription billing activation.

New starter claims require both contacts verified by Clerk and a complete configured keyring. Email OR phone matches reuse the existing identity; a combined-pair-only check would allow switching one contact to obtain another allowance. Conflicting matches fail closed. Evidence survives salon deletion.

The historical super-admin starter backfill is a privileged correction tool. After the new lifetime policy is enabled it refuses identities lacking both current-key contact links. Use Add texts for discretionary credits rather than using the starter backfill as a replacement for owner verification.

## Key rotation

`BILLING_IDENTITY_HMAC_PREVIOUS_KEYS` is a secret JSON array, for example `[{"version":1,"secret":"previous-dedicated-key"}]`. Rotate the current secret/version and retained array atomically. Every preceding version must be present before new automatic grants are allowed. Both email and phone lookup compute retained fingerprints, so recreation with a new Clerk account still matches older evidence. Keep all keys needed for the lifetime offer. Never publish key values in this document, logs, or client bundles.

Before deployment: run focused unit/integration tests, typecheck, changed-source lint, appointment regressions, and the mobile super-admin credit journey with mocked mutation responses. No test should send SMS, create a provider charge, or grant production credits.
