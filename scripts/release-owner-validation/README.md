# Isolated invited-owner release validation

This harness tests **b81137ef8bdc55e58030abe109d2d468f6c85e54**, copied and Git-blob verified from `$GITHUB_WORKSPACE/application`, using the original Next config in Development mode. The harness itself is checked out at the exact PR head under `$GITHUB_WORKSPACE/harness`. This is functional Development acceptance, not production-build, deployment, load-capacity, email/SMS-delivery or payment proof.

The pull_request-only workflow admits only owner-authored `codex/fresh-owner-release-validation-20261021` in `SniperStopSniping/nailsalon`, with both actor and triggering actor `SniperStopSniping`. The controller independently checks event metadata, clean harness head SHA and clean fixed application SHA. These are operational restrictions; the repository owner must review the exact executable PR head before authorizing CI. There is no `pull_request_target`, dispatch, push, deployment or write token.

Dependencies and one browser engine per matrix job install before credentials enter any step. A bounded, credential-free Ubuntu24.04 prerequisite step explicitly installs PostgreSQL16/client16 and Redis from the runner's existing signed apt sources, prevents package default-service starts and stops/checks those defaults on the exclusive ephemeral runner. It emits fixed before/after tool-presence booleans and fails if native tools remain absent; PostgreSQL16 executables must resolve at `/usr/lib/postgresql/16/bin`. No Docker, package version substitution or fallback database. Native availability and current repository secrets remain unverified until CI.

Existing `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` repository secrets enter only the runtime step, in environment memory. Empty/live keys, wrong decoded public frontend, wrong Development instance ID or organization policy drift fail before fixture changes. Required existing binding is instance `ins_36SfkrDmDOTiW6pXA8Qo6RzsSfe`, frontend `musical-muskox-47.clerk.accounts.dev`. No new secrets or provider configuration. The application child receives a fresh explicit environment, not CI bypass flags. Public Clerk key in compiled client chunks is its normal public binding; server key/testing token, cookies/passwords and invitation tokens must never be persisted.

Runner-only resource envelope: at least **7GiB physical RAM**, **5GiB currently available RAM**, **4GiB initial free disk**, **4GiB combined owned RSS**, **2GiB disk floor**, **20-minute controller deadline**; Next heap1536MiB, bootstrap/browser heaps256MiB. This separate CI envelope does not alter historical local UI or booking-load limits. Desktop waits at most60s for two samples below3GiB owned RSS before launching Chromium; full resource guards remain active. WebKit skips that observation wait. Matrix max2 means two independent runners, one worker/retries0 each.

Services bind only owned loopback ports PG55432/Redis56381/Next56512. PostgreSQL uses a fresh random SCRAM password via inherited pipe, native PGDATA/system-ID/empty-client attestation, the actual nonproduction marker and113 native migrations. Durability remains fsync/full_page_writes on. Redis persistence is off. Two unique hash-backed create_salon invites are seeded locally without an email API. The real browser performs signup, verification, organization/wizard, publish, booking, owner completion, session revoke401, sign-in and persisted resume. Every existing journey assertion is retained by the browser harness.

Server and browser workers preload the reviewed exact-host Node transport fence; browser routing additionally fences HTTP and rejects WebSockets. Allowed egress: owned loopback plus exact Clerk API/frontend, and read-only font GET/HEAD. This is a trusted-code guard, not a kernel firewall or native-browser sandbox. Billing/SMS/AI/Google integrations remain inert/absent; no real customer/provider obligations are created.

Linux PID ownership uses `/proc/<pid>/stat` start ticks plus ancestry, never historical group IDs alone. Cleanup independently stops every proven owned child/group, never signals unknown members, and waits the reviewed bounded TERM/KILL grace. Partial failure discovers only the two exact fresh emails and independently proves newly created org name/timestamp/creator/single membership, excluding baseline organization IDs, before deletion. Cleanup uncertainty fails and retains owned temporary work for review. Ephemeral CI teardown is not provider-cleanup proof. Hard runner termination/cancellation can prevent signal handlers, finally and remote cleanup. A mode600 run-context.json journal records only runTag/start time/fixed instance/project/application+harness/event SHA/run ID before signup, supporting independently reviewed orphan reconciliation; it contains no credentials or email values. Even always-upload may not run after forced termination. There is no automatic post-cancellation provider cleanup guarantee; independent baseline exclusion and fresh-owner invariants remain mandatory for manual reconciliation. An empty baseline is refused before fixtures/signup.

Only fixed numeric/enum diagnostics and sanitized browser/result JSON may upload, via four exact filename globs. Raw child stdio is discarded under byte caps and fixed classifier counters. No stdout lines, DOM, screenshots, trace, video, storageState, credentials or whole work directories upload. The exclusive run directory lives under `$RUNNER_TEMP/release-owner-validation-safe`; mode700 directories and mode600 result files. Retained owned work is excluded from artifact paths.

Offline checks (no native services/provider calls):

```
python3 scripts/release-owner-validation/offline-contract.py
node --max-old-space-size=128 scripts/release-owner-validation/node-egress-guard.contract.cjs
python3 scripts/release-owner-validation/portability-contract.py
```

CI performs preparation before reading secrets, then invokes:

```
python3 harness/scripts/release-owner-validation/controller.py --execute --resource-reviewed --cleanup-created --project desktop-chromium
```

Use `iphone-13-webkit` in its independent matrix runner. Do not execute locally, trigger CI, commit/push, merge or deploy without root's review and authorization. `bundle-sha256.json` pins this directory's executable/support files; `BROWSER_PINS` pins the four browser executables. The workflow and exact PR head require independent review as well.
