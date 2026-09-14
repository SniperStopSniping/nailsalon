# CI speed audit — 2026-09-14

Audited main at `52f47a630fe983bac27c1bfcf860a4556bbb8cab`, the live repository ruleset, workflow job/step timestamps, recent main commits and release logs before editing. This work changes only CI scheduling and its regression checks. It does not change release, provider configuration, application code, dependency manifests or database workflows.

## Measured baseline

Two consecutive successful runs of the small booking-logo PR #198:

| Measurement | [34801580909](https://github.com/SniperStopSniping/nailsalon/actions/runs/34801580909) | [34802869130](https://github.com/SniperStopSniping/nailsalon/actions/runs/34802869130) |
| --- | ---: | ---: |
| Entire CI, creation to completion | 21m16s | 17m53s |
| Run all tests job | 19m25s | 16m00s |
| Full Vitest job | 11m02s | 6m16s |
| E2E production build step | 3m36s | 2m47s |
| Onboarding confirmation + geometry, SMS, reviews, Storybook | 5m59s | 4m36s |
| Database-backed E2E step | 5m53s | 4m55s |
| Type checking step | 1m03s | 50s |
| UIQI follow-on job | 1m17s | 1m17s |

The PR's second head merged origin/main; the first ran on `5d77bbb5`, the second on `00e01c2a`. Combined CI elapsed was 39m09s before merge, excluding the main CI run. Timing ranges are observations, not percentile estimates.

## Rules and releases

[Ruleset 19559560](https://github.com/SniperStopSniping/nailsalon/rules/19559560) is active on main: strict up-to-date required checks, required PRs and resolved conversations, no deletion or force-push, and a deploy-key bypass. Required contexts are `Build with 20.x`, `Build with 22.6`, `Run all tests (20.x)`, `Full Vitest Suite`, and `Booking entitlement override PostgreSQL concurrency`. Classic branch protection returns 404; the ruleset is the protection source. All contexts remain intact.

`release.yml` runs after successful main CI. `package.json` configures semantic-release changelog, npm (publication disabled), git and GitHub plugins. The git plugin commits versions/changelog onto main through a deploy key. Recent examples are `05f7d68c` (1.98.1) and `290fa31f` (1.98.2), both with `[skip ci]`. The release run for 1.98.2 took 61 seconds, but moved main after the preceding merge. Skipping CI on that commit does not prevent strict PR staleness.

Release checkout is not pinned to `workflow_run.head_sha`; a newer main could be checked out than the successful triggering CI. There is no release concurrency group. Fixing this alongside removing version commits deserves a separate release-policy design and approval, including tag provenance and handling overlapping successful main runs. It is deliberately unchanged here.

## Implemented free changes

- PR-only supersession cancellation, keyed by workflow/event/PR number. Non-PR groups use unique run IDs; main runs cannot cancel one another or any PR. No external agent cancellation commands.
- Full Vitest runs in three exhaustive file shards with fail-fast disabled. `Full Vitest Suite` explicitly requires successful completion of the entire matrix.
- Move unchanged prototype type/unit/browser tests, SMS/review browser tests, Storybook, and onboarding geometry into an independent job. Its own runner prevents port/process/database interference. Production E2E retains the existing PostgreSQL/Redis guards, fixtures, workers, browser projects and provider restrictions.
- Preserve `Run all tests (20.x)` as an explicit aggregate requiring both application and component execution. Skipped/cancelled/failed prerequisites fail the gate; UIQI continues to depend on the original aggregate IDs.
- Share the existing bounded browser installation scripts as a composite action, including privileged process cleanup and lock checks. Both consumers still install OS dependencies and all browsers. No browser cache is introduced: the measured browser download is only 15–17 seconds and cache restore can cost as much.
- Cache prototype npm downloads using both committed lockfiles. Keep `npm ci`; no shared node_modules, database, browser result, coverage, or compiled application artifacts.
- Add executable regression tests for aggregate failure propagation, reviewed-head checkout, shard topology, and cancellation scope.

Expected whole-run duration is roughly 12–15 minutes (about 4–7 minutes faster), depending on runner contention. Three Vitest shards reduce that job's expected duration by roughly 3–6 minutes. There are more runner setups, so wall-clock improvement is not a claim of lower total runner-minutes. Standard hosted Linux runners are free for this public repository; no paid runner, account change or Vercel change is included.

## Deliberately retained work

Node 20 and 22.6 builds remain independent. The E2E build uses a different environment from the build matrix; reusing that artifact without proving environment equivalence could change behavior. Full unit tests, changed-file coverage instrumentation, explicit appointment regression, UIQI execution, bundle secret scans and every PostgreSQL/migration/concurrency job remain. Similar test commands sometimes use different database engines or instrumentation and are not interchangeable duplicates.

## Recommendations requiring approval

- Tag/GitHub-release-only versioning would avoid version commits, but changes the checked-in version/changelog contract. Audit version consumers, release permissions and exact tested-SHA provenance before implementation.
- A merge queue can handle concurrent merging while preserving integration coverage. GitHub currently requires an organization-owned public repository (or eligible private organization plan); this repository is public and personally owned. An organization transfer and `merge_group` evidence design require approval. Do not simply disable strict up-to-date checks or reuse earlier-head statuses.
- Paid larger runners and Vercel production build/deployment changes require separate approval. No estimate of production-live improvement is claimed without deployment measurements.

References: [merge queue eligibility](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue), [concurrency semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency), [standard runner pricing](https://docs.github.com/en/enterprise-cloud%40latest/actions/reference/workflows-and-actions/workflow-syntax).

The delivery PR records optimized run IDs, exact head, measured results and verification limitations. Compare creation-to-completion for total CI, and started-to-completed job/step timestamps for bottlenecks. Do not compare a cancelled or failed run as a speed win.
