# Owner menu assistant — validation record

## Scope

First bounded slice from `OWNER_AI_ASSISTANT_PLAN.md`: salon-aware menu ordering,
exact preview, Apply, durable transactional receipt and guarded undo. The chat
interpreter supports explicit ordering requests and selections; it does not call
a language model. No provider provisioning or inference charges are introduced.

Base: `5779b937d629a6ae58d123eac16948e57a740427` (`origin/main`, refreshed before
work). Isolated branch: `feat/owner-assistant-menu-order`. The original checkout
and existing Stripe worktrees are untouched. No merge, rollout or production
data changes are authorized.

## Delivery constraint

### September 15 migration review: additional compatibility blocker

**Migration 0078 is not approved for installation or allowlisting.** The
follow-up review reproduced a PostgreSQL deadlock between two ordinary service
writers, without calling any assistant action. This supersedes the earlier
disabled-code review's conclusion for purposes of migration approval.

The AFTER-row trigger takes the shared salon revision-row lock after a writer
has already locked its service row. A family-style transaction changes service
A and holds the revision lock; a second transaction locks service B and waits
for that revision; the first then tries to change B. PostgreSQL aborts one with
SQLSTATE `40P01`. Running the same ordinary writer schedule without the trigger
completes successfully. Both transactions were explicitly rolled back in the
diagnostic, preserving the baseline rows. A passing reproduction test means
the incompatibility was reproduced, **not** that the migration is safe.

The existing family writer in `src/libs/ownerCatalogFamilies.server.ts` applies
multiple service updates sequentially and does not have the assistant helper's
bounded transaction retry. Installing the trigger can therefore turn an
ordinary owner save into an error even when `OWNER_ASSISTANT_ENABLED` is unset
or false. Data rollback is necessary but does not satisfy ordinary-workflow
compatibility.

The narrow follow-up preserves the 0076 SQL hash and 0076/0077 journal positions;
their historical upgrade test still targets exactly the original 78-entry
ledger through 0077. It no longer mistakes those historical positions for the
repository's permanent migration tail. The new migration's independent
PostgreSQL proof owns its later install/upgrade behavior.

The CI allowlists and the Preview fixture tool's exact migration/deletion
contracts remain unchanged: admitting an incompatible trigger is not justified.
The next design decision is how to avoid introducing this shared lock into
ordinary writers, or establish a complete, tested writer lock/retry discipline.
That requires a separate bounded implementation and migration review; it is not
an unreviewed schema redesign in this contract-only follow-up.

The refreshed main is still `5779b937`; no competing 0078 was found in available
worktrees or open PR branches. The CI task was notified about shared-file
ownership and that no CI edit would proceed. Shared historical test ownership
was noted on PR #193. The active billing work's product/test files were not
changed.

### Required checks and preview distinction

GitHub's effective branch rules (`Protect production main#`, ruleset 19559560)
require `Build with 20.x`, `Build with 22.6`, `Run all tests (20.x)`,
`Full Vitest Suite`, and `Booking entitlement override PostgreSQL concurrency`,
with strict current-head/base checks and resolved review conversations.
**Vercel Agent Review is not a required status check or required reviewer.**
Its insufficient-credit skip is not a waived required gate; no credit was
purchased and no repository setting was changed.

The repository PR template separately asks for a healthy Vercel preview. That
evidence has not been obtained for this disabled slice. Local synthetic browser
fixtures and authenticated-route tests do not establish an authenticated hosted
owner journey. This remains explicitly unverified; it is not waived by the
absence of Vercel Agent Review in the ruleset.

The unchanged CI migration guard (`.github/workflows/CI.yml`, new migration tag
allowlist) permits migrations only through the currently reviewed packets. The
new explicit owner-assistant migration is not on that list. It therefore needs
a corrected locking design and migration approval before this PR can pass that gate.
This PR must not be merged while that gate fails. No bypass, hidden schema
creation, CI change or modification of an applied migration is part of this work.

The migration is needed for durable receipts and a database-enforced menu
revision that observes service writes outside the assistant. Even with the UI
disabled, applying its trigger has database effects; production application is
explicitly deferred. Local validation uses only a newly created disposable
database or in-memory PGlite.

## Follow-up verification

The dedicated PostgreSQL migration suite passes **6/6, zero skips**, run
serially with `--no-file-parallelism`:
its control temporarily removes and restores the trigger in this disposable
cluster. Fresh and historical-upgrade databases have random task-owned names
and are dropped after the test. It checks all service columns across upgrade,
existing reorder with and without the new schema, stable historical ledger,
ordinary writes, reassignment, salon cascades and actor deletion restriction.
The known-deadlock test intentionally expects `40P01`; it is diagnostic evidence,
not an acceptance test claiming compatibility. Migration SQL is unchanged.

Affected historical/fixture rerun: **33 passed, 11 failed** across two files.
All nine historical migration tests pass; eleven fixture failures retain the
exact 0077 contract. Type checking, changed-source lint, secret scan and diff
whitespace checks pass locally. No new browser claim accompanies this test-only
follow-up. Exact-head hosted results are recorded on PR #223.

## Initial slice evidence (before this follow-up)

Local validation uses Node 20.19.4, provider placeholders from the existing CI
contract, in-memory PGlite, and a new PostgreSQL 16 cluster bound only to
127.0.0.1:55439 with database `owner_assistant_disposable`. No existing database
or owner account is used. The optional PostgreSQL test lane refuses an
unconfirmed target or any different host, port or database name.

| Evidence | Result |
| --- | --- |
| Real component → route → SQL flow | Passed: exact preview causes no service writes; Apply commits one operation; repeated Apply returns the same result; Undo restores every service field except normal `updatedAt` metadata |
| PGlite domain and migration tests | Passed: exact ranks, no-op, wrong actor/tenant, revoked membership, insertion/deletion/edit staleness, expiry, ABA edit, receipt-write rollback including revision, ordinary reorder before 0078 tables exist |
| PostgreSQL concurrency tests | Passed: parallel Apply produces one apply and one replay; subsequent ordinary reorder prevents Undo; a manual writer holds a service lock, Apply is observed waiting via `pg_stat_activity`, and after the writer commits Apply rejects stale with the operation still ready |
| Owner guard and route tests | Passed: explicit owner only, unauthenticated/collaborator/foreign owner/impersonation rejection, flag-off short circuit, strict payloads, resolved actor/salon context, private no-store responses |
| Parser/component tests | Passed: ambiguous names require selection, duplicate names have stable IDs, null-ranked services preserve canonical order, stale context refresh, delayed salon-switch response rejection, lost-response recovery/replay permits later requests |
| Browser interaction/layout | Passed in desktop Chromium, mobile Chromium and mobile WebKit: request, before/after card, Apply, receipt and Undo; no page errors or horizontal overflow. API responses are synthetic in this browser fixture. Agent-browser checked the isolated fixture; mobile screenshot was visually inspected. |
| Type checking and production build | Passed locally using CI provider placeholders; final commit hooks repeat type checking |
| Focused ESLint and whitespace checks | Passed for the new/modified feature and test files |
| Full local Vitest run | **Not green:** 683 files passed, 2 failed, 19 skipped; 8,111 tests passed, 14 failed, 180 skipped, 1 todo. Subsequent focused runs cover final feature changes. |

The full-suite failures are caused by introducing the new migration into
contracts pinned to the previous tail. Eleven fail in
`src/libs/previewServiceImageFixtures.test.ts` because its guarded fixture tool
requires exactly 78 migrations ending at `0077_review_requests`. Three fail in
`src/models/d6_1TaxSnapshotSchema.integration.test.ts`, which pins that same tail
for its Stripe prerequisite/upgrade assertions. These are consequences of this
PR's migration, not claimed pre-existing failures. The follow-up fixes the three historical migration assertions while preserving
their original target and hash. The eleven fixture failures remain intentionally
blocked pending a compatible migration and exact contract review.

The initial transaction/UI review found no blocking findings in that scope.
The subsequent independent installed-migration review supersedes that assessment:
0078 is blocked by the reproduced ordinary-writer deadlock. Hosted checks are recorded
on the PR; this document does not claim all CI gates passed.

### Reproduce the bounded flow

```sh
npx vitest run src/components/admin/ownerAssistant src/app/api/admin/owner-assistant src/libs/ownerAssistant src/libs/adminAuth.ownerRole.test.ts src/app/api/salon/services/route.test.ts
npx playwright test --config tests/browser/owner-assistant/playwright.config.ts
```

For the optional real PostgreSQL lane, create a **new disposable** loopback
database matching the guard, then set `OWNER_ASSISTANT_TEST_DATABASE_URL` and
`OWNER_ASSISTANT_DISPOSABLE_DATABASE_CONFIRMED=true`. Never use `DATABASE_URL`
to route these tests to a shared environment. The browser fixture is separate
from a live authenticated dashboard; it does not establish Clerk/hosted-owner
end-to-end evidence. No live-owner rollout is part of this review.

### Limitations kept explicit

- Assistant disabled unless the server flag is exactly `true`; no deployed
  environment flag was changed. The migration itself is not feature-gated.
- Commands use the displayed English `Move … before/after …` grammar; UI copy
  supports English and French. This is one deterministic action, not general AI.
- Preview expires after 15 minutes; Undo is refused after any service mutation,
  even an unrelated service edit. No-op does not normalize old numeric/null ranks.
- Receipt/recovery state survives closing the mounted panel, not a page reload.
  Records remain durable in the database; a history/reload UI is deferred.
- Local role revocation is serialized against assistant writes. Immediate
  external Clerk session revocation is not atomic with a database transaction.
- Full authenticated Next.js mobile owner journeys are deferred until isolated
  credentials and an approved migrated Preview environment are available.
- Appointment regression is not separately rerun: appointment workflows are
  unchanged and their unit tests were included in the full suite. No scheduling
  engine, Friday diagnosis implementation, payment, refund or messaging action
  is introduced.

## Remaining decisions

- Correct the ordinary-writer locking regression, then obtain migration and exact
  allowlist/fixture-contract approval. The present follow-up is authorized but
  does not make an incompatible migration eligible for approval.
- Review and application of the migration in disposable Preview infrastructure;
  no production migration is included in this task.
- Whether/when to enable a limited owner pilot. `OWNER_ASSISTANT_ENABLED` remains
  false by default; this task authorizes no live-owner activation.
- Retention/cleanup policy for operation receipts before broader rollout.
- Broader language-model integration and other owner actions remain deferred.
