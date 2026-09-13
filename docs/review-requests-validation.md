# Review requests validation and migration coordination

## Migration allocation

`origin/main` ends at migration 0075. Stripe D6-R1 has an immutable 0076
identity that was already attested in its isolated PostgreSQL ledger:

| Order | Migration | Journal timestamp | SHA256 |
| --- | --- | --- | --- |
| 0076 | `0076_deposit_shadow_evidence` | `1787476392670` | `3626d5427a18d1762ae6e4807cb9a31f8dc093c22cc700b7a6a712a4945f1765` |
| 0077 | `0077_review_requests` | `1787562792670` | `e29f8ccd755e19c938086186d04c816c710eaefc90ef2a5b42a36f464366a5fd` |

This branch imports the exact Stripe 0076 SQL as a SQL-only prerequisite. It
does not import Stripe runtime code, schema mappings, jobs, or provider paths.
The Review SQL is unchanged apart from its forward-only identity. The journal
now has 78 entries. CI and preview-fixture guards pin the new final identity,
and the D6.1 migration test verifies the exact Stripe SHA256 before Review 0077.

The PostgreSQL migrator selects by journal timestamp. The increasing 0076 then
0077 order therefore works for a database at 0075 and for a database that has
already recorded the Stripe 0076 identity. Do not apply 0077 to a retained
database carrying the abandoned `0076_review_requests` ledger identity: that
requires explicit ledger/schema reconciliation. Shared Development, Preview,
and Production ledgers remain outside this branch and must be checked under the
database runbook before application. This PR remains draft and does not apply a
migration anywhere.

## Safety test evidence

The migrated PGlite review service/dispatcher suites exercise server completion
cutoffs, no historical scheduling, shared manual/automatic identity, repeated
scheduling, post-scheduling client suppression, consent revocation and global
STOP, insufficient credits, provider rejection, and uncertain outcomes. Provider
calls are mocked. Route tests cover tenant authorization. Browser/component
checks are distinct from authenticated application tests.

The authenticated review journey is included in the existing mobile WebKit
project and CI E2E command. It requires the repository's attested disposable
PostgreSQL fixture, uses the existing super-admin password session and salon
impersonation path, and does not verify Clerk's interactive sign-in. It never
invokes the dispatcher and requires absent Twilio credentials. It verifies
persisted owner settings, completedAt-based scheduling, completion/submission
replays, Send now, queued feedback, and automation-off cancellation. Screenshots
are written to Playwright output. Delivery failure/STOP behavior is exercised by
the separate mocked-provider integration suite, not by sending browser messages.

See the PR handoff for the exact tested head, executed test counts, browser
artifacts, and unresolved gates. A test's presence is not evidence it passed.


## Executed local browser evidence

The real application iPhone WebKit run passed all four tests (two review journeys
plus existing authentication setup and teardown) in 13.0 seconds. The hardened test rejects external browser
targets and verifies the application can read its fresh attested fixture before
changing settings. It used the
existing super-admin password login and salon impersonation, real settings and
review APIs, and the real completion API. The completion checkout UI itself and
interactive Clerk sign-in were not part of this test. No dispatcher was invoked.
Screenshots cover the saved owner settings, actual recipient preview, and queued
appointment action. The cancelled request and intent remain in the database;
the action returns to manual eligibility because that request was proven unsent.

The independent component browser suite passed four tests across mobile Chromium
and iPhone WebKit. It uses production components/CSS with synthetic intercepted
APIs. It covers edited message/link previews, confirmation, exactly one Send now
POST, refreshed sent/suppressed feedback, credit-blocked and failed explanations,
44px buttons and no horizontal overflow. Screenshots were visually inspected.
This suite found the hidden credit-blocking explanation; that display was repaired.

The local application database was bound only to `::1:55432`, separate from
Stripe's `127.0.0.1:55432`. The launcher used IPv6-first DNS with family fallback
disabled, and the existing disposable-target guard plus live identity attestation
before migrations/seeding. Only synthetic reserved-range clients were created;
Twilio credentials were absent and `COMMUNICATIONS_SMS_ENABLED=false`. Automation
was disabled after testing. No hosted database or real client was contacted.
