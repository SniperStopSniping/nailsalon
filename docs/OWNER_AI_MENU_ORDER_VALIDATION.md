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

The unchanged CI migration guard (`.github/workflows/CI.yml`, new migration tag
allowlist) permits migrations only through the currently reviewed packets. The
new explicit owner-assistant migration is not on that list. It therefore needs
a separately authorized CI allowlist review before this PR can pass that gate.
This PR must not be merged while that gate fails. No bypass, hidden schema
creation, CI change or modification of an applied migration is part of this work.

The migration is needed for durable receipts and a database-enforced menu
revision that observes service writes outside the assistant. Even with the UI
disabled, applying its trigger has database effects; production application is
explicitly deferred. Local validation uses only a newly created disposable
database or in-memory PGlite.

## Evidence

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
PR's migration, not claimed pre-existing failures. Neither the fixture contract
nor the Stripe migration tests are changed here. They need a separately scoped
contract update and review alongside the CI allowlist before merge.

The independent safety reviewer found no remaining blocking code findings for
a disabled, review-ready PR after checking the final transaction and UI-state
changes. This is not activation or merge approval. Hosted checks are recorded
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

- Separate authorization/review for the migration allowlist addition in CI.
- Review and application of the migration in disposable Preview infrastructure;
  no production migration is included in this task.
- Whether/when to enable a limited owner pilot. `OWNER_ASSISTANT_ENABLED` remains
  false by default; this task authorizes no live-owner activation.
- Retention/cleanup policy for operation receipts before broader rollout.
- Broader language-model integration and other owner actions remain deferred.
