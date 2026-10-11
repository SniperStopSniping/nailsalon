# Permanent free core: release contract

The October 11, 2026 product decision replaces the limited founding window with a free core booking platform and no monthly software subscription. AI voice is permanently excluded from future feature plans; the existing AI text assistant remains.

## Scoped change

- Current offer, onboarding handoff and usage copy: no future software price, claim deadline, or voice/phone upsell. Optional one-time SMS purchases never expire.
- New core-access records use terms version 2, with no acquisition deadline. The existing offer and API identifiers remain compatible with saved onboarding drafts.
- Version 1 records remain immutable historical evidence. Returning salons retain their original claim and access. No text allowance is reset.
- The verified-business 100-text eligibility, credit ledger, pricing, authorization, locks and idempotency rules remain unchanged. No payment or subscription is created by a core claim.
- SMS packages remain 100/$20 CAD, 200/$30 CAD and 500/$50 CAD.

## Database / release order

Migration `0098_permanent_free_core_terms` changes only two checks on `founding_lifetime_claim`. It accepts v1 and v2 and validates the version-specific terms. It does not update or delete records, change balances, or grant credits. The old application can still write v1 after migration, allowing a migrate-first rollout or an application rollback without reversing the schema.

1. Test on a disposable PostgreSQL database and a fresh production child branch. Compare existing claim and ledger fingerprints before/after.
2. Apply to the attested Preview database through `npm run db:migrate:preview`; verify journal tail and checks.
3. Verify the exact PR-head Preview and all required CI/review gates.
4. From a clean committed checkout, apply the guarded Production migration before the application release. Confirm exactly this migration is pending, expected host/branch, no nonproduction marker, short lock timeout and a recovery point. Recheck unchanged existing claims/credits.
5. Merge normally into protected main, verify Production Git SHA and schema readiness, then verify the deployed copy and owner journey.

Do not reverse the schema checks after v2 records exist. Roll back application code if necessary while retaining the compatible checks. Never delete customer records to satisfy migration checks.

## Local evidence

- 135 focused tests, including a real migration from v1 and unchanged historical claim readback, passed.
- Seven disposable PostgreSQL concurrency/authorization/credit-preservation cases passed, with zero skips.
- Nine onboarding offer-sheet tests passed.
- 50 Chromium/WebKit owner-entry checks passed across narrow mobile and desktop sizes, keyboard actions and readability.
- Build, explicit typecheck, scoped lint (existing warnings only), whitespace and source/generated secret scans passed.
- The first browser pass saw a local hot-reload navigation during the readability audit while source was still being edited; the complete final pass passed after edits stopped.

These results prove the recorded isolated cases, not real owner authentication, message delivery, payment acceptance, or a physical-device journey. Hosted gates, remote migration rehearsal and release evidence must be recorded separately before claiming deployment.
