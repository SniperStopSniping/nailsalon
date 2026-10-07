# Luster / Isla combined review — 7 October 2026

## Scope and source

Review-only integration from current `origin/main` at `939866949b91f1e17f4d1b1fb1fb2eb4a1cf3735` (1.139.2). The user explicitly deferred credentials and production release. No protected-main merge, production migration, live booking, message, call or payment is authorized by this review.

The seven existing draft histories were merged without conflicts in a new clean worktree. Their original branches and worktrees remain preserved:

| Draft | Exact source | Scope |
| --- | --- | --- |
| #365 | edcbff4a7bc74a4cf10767f339b1312ada5e16aa | Coherent entry screens and durable lifetime core-software claim; optional usage remains paid |
| #366 | 8a91ceb195915e76dbbaf685a7ac450bb5ddf05a | Custom Isla editor controls match the commissioned renderer |
| #367 | 2b9f9af332ae168891c46c24b53a7b456d0401ec | Availability search cancellation, recovery and changed-duration handling |
| #368 | bb1d62c5415129fa808ea634e3ad4bea3abc22e7 | Reminder timing, recipient and sample-credit clarity; shorter option and Undo |
| #369 | fa6109e6 | Calendar block form survives refresh with date, artist and feedback |
| #370 | 201b90f0a7da85afa3fd76125e166e78af1e7531 | Unlimited locations, hidden email validation, parent draft and focus retention |
| #371 | 8fc181bba0e66cf174b20e2011b951bafc3b86f7 | Canonical policy placement and accurate private-preview wording |

The combined application tree was checked at `333b7b9c03bd10405bc1efbcdf0ddc194953205d`; subsequent review documentation does not change application code.

## Combined local evidence

- 523 focused tests across 25 changed unit files passed.
- 96 Chromium/WebKit browser cases passed: owner entry 32, editor 28, reminders 18 and actual optimized-app availability 18.
- TypeScript, optimized production build, scoped lint (zero errors; five existing warnings) and normal secret scan passed. No checks were waived.
- Actual 390px and 1440px screenshots show the integrated editor and private public preview. At 390px there is no document-level horizontal overflow. Policy placement is respected; the private-preview banner does not falsely imply unpublished changes.
- Additive migration 0097 was applied only after exact attestation of a new loopback synthetic database clone. Readback: 97 migrations and zero lifetime claims. This is not a production migration or a new hosted claim.
- Original branch evidence separately covers lifetime PostgreSQL concurrency, calendar/location persistence and restoration, reminder save/reload while off, and policy on/off/save/reload/restore.

Private environment files, tokens, original private customer screenshots and raw database output are excluded from this repository and the shareable report.

## Acceptance boundaries

Normal authenticated hosted onboarding/claim, the hosted Isla tenant 404, real provider delivery/settlement/calendar/voice recovery, physical devices and owner-only assistant access remain recorded limitations. Staff phone login is deliberately retired, not bypassed.

At the review checkpoint, #365/#366/#367/#369 checks passed. #368/#370 fail the same existing onboarding saved-history assertion (`final_preview` visible but stored history count is 0 instead of 1); all three matching desktop/mobile/small-mobile cases passed on this combined tree locally, but the hosted failure and its root cause remain unresolved. #371 and this combined branch require their own fresh hosted checks. A local pass does not override an unresolved hosted gate.

This draft combines the changes for review; it does not authorize merging both this PR and all seven component PRs. Choose a single delivery path later and recheck source, CI, preview, migrations and review conversations before any protected-main merge.

## Review artifacts

The self-contained PDF, editable Markdown, screenshot manifest, screen/flow index and consolidated blocker list are retained in the task's final review package. Stable references S01–S126 and F01–F16 distinguish historical evidence, current isolated observations, design opinions and unverified configurations.
