# Billing identity HMAC key lifecycle

Governing contract: [luster-billing-communications-rev-2-2.md](luster-billing-communications-rev-2-2.md) §7.3 ("HMAC rotation MUST NOT reset eligibility... Document key version, activation date, retirement date, retained verification period, deletion process"). Plan: [luster-billing-remaining-work-plan.md](luster-billing-remaining-work-plan.md) §5 P8c, §6 D10. This is the §7.3 deliverable referenced there. Companion: [BILLING_PRODUCTION_RUNBOOK.md](BILLING_PRODUCTION_RUNBOOK.md) §4 (where `BILLING_IDENTITY_HMAC_SECRET`/`_VERSION` are provisioned).

## 1. What this key protects, and what it does not

`BILLING_IDENTITY_HMAC_SECRET` (with `BILLING_IDENTITY_HMAC_VERSION`) produces the **fallback** verified-email fingerprint used to resolve a durable `billing_business_identity` when no stronger identifier is available. Contract §7.3's resolution preference order is:

1. verified Clerk owner ID,
2. durable verified business/salon identity,
3. Stripe Customer ID where relevant,
4. **versioned keyed HMAC email fingerprint** (this key) — fallback only.

It exists to enforce the once-per-business starter grant (§3.1) and founding-promotion claim (§3.3/§7.3) even when the stronger identifiers above are unavailable for a given business. It is **never** a substitute for those stronger identifiers, and it is **never** a general-purpose customer identity key — its only consumer is `src/libs/billing/businessIdentity.ts`'s HMAC-fallback resolution path.

It is a **dedicated** secret: never a reused Clerk, OAuth, Stripe, or any other integration secret, and never an unkeyed SHA-256 of the email (contract §7.3, verbatim: "never a reused OAuth/Clerk/Stripe/integration secret; never unkeyed SHA-256"). Sharing it, or falling back to an unkeyed hash if it is ever absent, would let anyone who can compute an unkeyed hash of a target email test membership against the anti-abuse table — the whole point of keying it.

## 2. Key register

| Version | Activation date | Retirement date | Retained-verification window end | Deletion date |
|---|---|---|---|---|
| v1 | **not yet provisioned** — `BILLING_IDENTITY_HMAC_SECRET`/`BILLING_IDENTITY_HMAC_VERSION=1` are unset in every environment as of this writing (verified read-only: `src/libs/Env.ts` declares both optional, no default) | — | — | — |

**This table has exactly one row today, and that row is entirely unprovisioned.** No key has ever been activated in this repository's history for this purpose. When v1 is actually provisioned (runbook §4), this row updates to the real activation date — do not backdate it, and do not invent a date here to make the table look complete.

When a rotation eventually happens, add a new row (v2, v3, ...) rather than overwriting v1's row — the whole point of this register is that every version that ever protected a link in `billing_business_identity_link` stays visible here for as long as that link's retained-verification window (§3) has not closed.

## 3. Rotation procedure

Contract §7.3, verbatim: **"HMAC rotation MUST NOT reset eligibility: a new `BILLING_IDENTITY_HMAC_VERSION` attaches a NEW versioned fingerprint link to the EXISTING identity (old-version fingerprints retained verifiable for the anti-duplication retention horizon); rotation never creates a second business identity."**

Mechanically, per `billing_business_identity_link`'s schema (migration 0069, `link_type='email_hmac'` + `hmac_key_version` column — see [luster-billing-remaining-work-plan.md](luster-billing-remaining-work-plan.md) §3's "contract-text drift" note: the contract's `email_hmac_v{N}` shorthand became `link_type='email_hmac'` plus a separate `hmac_key_version` integer column, a deliberate schema choice, not a gap):

1. **Generate a new secret.** `openssl rand -base64 32` (or equivalent) — never derive it from, or reuse, the retiring secret.
2. **Set both new env values together, in the SAME deploy, per environment:** `BILLING_IDENTITY_HMAC_SECRET` = the new secret, `BILLING_IDENTITY_HMAC_VERSION` = previous version + 1. These two must change atomically — a mismatched pair (new secret, old version number, or vice versa) would silently mislabel fingerprints.
3. **What happens automatically, in code, on the next resolution:** the business-identity resolver (`src/libs/billing/businessIdentity.ts`) computes a **NEW** fingerprint (new secret) tagged with the **NEW** `hmac_key_version`, and inserts it as an **additional** `billing_business_identity_link` row (`link_type='email_hmac'`, new `hmac_key_version`) attached to the **SAME** `billing_business_identity` the old fingerprint(s) already point to (resolved via whichever stronger identifier — Clerk ID, salon, Stripe customer — is available at that moment; if none is, resolution against an OLD-version fingerprint is what proves it's the same identity — see step 4). It never deletes, overwrites, or invalidates the old-version link row.
4. **Verification window (why old versions stay readable, not just stored):** for the retained-verification window (§4 below — **length itself is PENDING D10**), a lookup that can only match an OLD-version fingerprint (no stronger identifier available, and the NEW secret's fingerprint of that same email does not yet have a link row because this business hasn't triggered a re-resolution since rotation) must still resolve correctly to the existing identity. This is why the register in §2 keeps every version's secret retrievable (from Vercel's env history / secret manager, not from this document) through the end of its window — verifying an old fingerprint requires being able to compute it, which requires the old secret.
5. **Update the register (§2):** add the new version's row with its activation date; add a retirement date to the row it replaces (the date this rotation's deploy went live).
6. **Provisioning is a runbook step, not a code change.** No migration, no code deploy is required for a rotation beyond the two env values — the schema and resolver already support an arbitrary number of versions per identity.

**What rotation is NOT for:** it is not a mechanism to "reset" a business's eligibility, and it must never be paired with deleting that business's old-version link rows as a way to let a starter grant or founding promotion be re-claimed. The once-per-business enforcement lives in `billing_business_identity` (via `billing_starter_grant.business_identity_id` and `billing_promotion_claim`'s cap), not in any single link row — deleting a link row does not, and must not be made to, free up a new claim.

## 4. Retained-verification window

The retained-verification window is the period after a version's retirement during which its secret must remain available (for computing/verifying old fingerprints, §3 step 4) before it may be deleted (§5). Its length is a business/legal retention decision, not a technical one — see §6.

**Structural note:** nothing in the code enforces a maximum window today. `billing_business_identity_link` rows never expire on their own, and no scheduled job purges them (the same "no automatic purge exists" gap this document flags for the underlying identity/promotion records in §6). A retained-verification window is only actually enforced once the owner sets one and it is written into an as-yet-unbuilt purge job — until then, the honest state is "indefinite by default, not by design."

## 5. Deletion process

Deleting a retired key version means removing its secret value from wherever it is stored (Vercel's environment variable history, or a secret manager, per however the owner actually stores retired secrets — this repository's env conventions do not currently define a "retired secret archive," so the owner's chosen storage location is authoritative, not this document). Deleting the secret does **not** delete the `billing_business_identity_link` rows that version produced — those rows (an HMAC digest, not the email itself; contract §7.3: "Raw email is never stored in anti-abuse tables") remain in the database as historical evidence of a prior successful identity resolution, under the retention rules in §6.

**Sequencing (do not delete out of order):**
1. Confirm the version's retirement date (§2) plus its retained-verification window (§4) has fully elapsed.
2. Confirm no code path still attempts a fresh resolution keyed to that version specifically (rotation always resolves against the CURRENT version going forward — the only reason an old secret is ever needed post-retirement is to verify/match an existing old-version link row during the window, never to mint a new one).
3. Delete the secret value from storage. Record the deletion date in the register (§2).
4. Do **not** delete the `billing_business_identity_link` rows themselves as part of this step — that is a separate, much larger retention decision (§6), not a key-management action.

## 6. Retention horizon — PENDING owner decision D10: no horizon is in force, no automatic purge exists, do not assume a default

Contract §7.3, verbatim: **"Retention: starter/promotion anti-abuse records are retained for the minimum period necessary to enforce the published once-per-business offers and financial/audit obligations, with a documented horizon and deletion process."** Plan §6, D10: **"Anti-abuse record retention horizon (keyed email fingerprints — a privacy/legal commitment) | No default; P8c documents the horizon as PROPOSED."**

**Current, verified state (read-only, this worktree, at time of writing):**
- No `BILLING_IDENTITY_HMAC_SECRET` has ever been provisioned (§2) — there is, today, no anti-abuse fingerprint data of this kind in any environment to retain.
- No scheduled job purges `billing_business_identity_link`, `billing_starter_grant`, or `billing_promotion_claim` rows. `/api/billing/windows/evaluate` and `/api/billing/reconcile` (the two billing cron routes) do not touch these tables — their only unconditional/scheduled table maintenance is `billing_stripe_event.raw_payload` purging (G13, unrelated to identity retention) and, once `BILLING_SUBSCRIPTIONS_ENABLED='true'`, `expireLapsedLots`/`expireStaleClaims` (credit-lot and promotion-claim-reservation bookkeeping, also unrelated to identity retention).
- This document does **not** propose a specific horizon (a number of days/months/years). Doing so would be inventing an owner decision the plan explicitly marks as having no default — the instruction that authorized this document is equally explicit that D10 is not approved and must be documented as pending, never defaulted.

**What IS safe to state now, without inventing a horizon:**
- Financial/audit obligations (contract §7.3's second retention basis) are a separate, likely LONGER floor than any privacy-driven horizon the owner sets — do not let a future privacy horizon accidentally undercut a legal/audit retention requirement without the owner explicitly reconciling the two.
- Whatever horizon the owner eventually sets, the deletion process it drives should follow the same evidence-before-action discipline `scripts/billing-integrity-check.ts` and the super-admin starter-grant endpoint's `mode: 'plan'`-before-`'apply'` sequencing already establish for production data (§6/§8 of the runbook): read-only inspection and an explicit, reviewed, non-bulk operation — never a blind `DELETE ... WHERE created_at < now() - interval`.

**Action required before this section can move past PENDING:** the owner must supply (1) a specific retention horizon (or an explicit statement that none applies beyond the financial/audit floor), and (2) sign-off on where the deletion job lives (a new cron route, folded into an existing one, or a manual operator script) — at which point this document should be updated in place, in a separately reviewed change, not assumed here.
