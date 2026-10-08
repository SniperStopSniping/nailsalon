# Client payment-row review flags — S25 / S28

## Observed cause

The profile API used `canonicalSummary?.depositBlockedCode ?? fallback`.
A successfully resolved canonical summary deliberately returns a null block
code, so it was replaced with FINANCIAL_SNAPSHOT_RECONCILIATION_REQUIRED.
The existing client UI treats any non-null block code as under review.
This could hide valid appointment figures while independent summary tiles
still showed authoritative settled values. It is a presentation flag defect,
not evidence of a missing or duplicated payment.

## Scoped correction

Preserve the canonical block code, including null, whenever a summary exists.
Use the existing snapshot/payment-ledger fallback only when no canonical
summary exists. No change to authorization, queries, tax/deposit/payment
calculations, stored financial data or client identity. The existing payment-row metrics now put each value on a separate line with readable spacing, correcting a label/value collision observed during browser review.
No migration or provider activation is required.

## Verification

- The actual GET route runs against mocked database rows and the real
  canonical financial builders. Before the fix, four valid scenarios fail:
  upcoming, completed, completed with paid deposit, and supported legacy
  invoice evidence. Four unresolved scenarios already pass their protections.
- After the fix, all 45 profile-route tests pass, including eight new financial
  scenarios and existing unauthorized/wrong-tenant behavior. Missing currency
  and tax evidence, mismatched cached tender, a foreign-salon payment and a
  deposit currency conflict remain blocked with the expected code.
- 132 focused financial/profile unit tests pass. The existing real client
  component also shows valid amounts and hides unresolved amounts in browser
  coverage; those browser responses are synthetic contracts, not live data.
- Final local browser/build/type/lint, screenshots and release state are kept
  in the dated external evidence folder. These notes do not claim deployment.

Evidence: /Users/me/Documents/Codex/2026-10-08/client-financial-review-flag/.
The full audit remains the dated reference; this fix does not resolve all
legacy financial or shared-contact investigations.
