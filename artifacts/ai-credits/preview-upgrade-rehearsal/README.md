# Local rehearsal of the AI pilot schema upgrade

This is additional release evidence after the fresh Stripe-funded owner checkpoint at `2e6c3002`. It does **not** authorize or perform a hosted migration, environment update, deployment or Production action.

The real Preview previously lacked the wallet tables, metering fields and publication identity maps ([read-only observation](../paid-owner-generation-checkpoint/preview-schema-proof.json)). We reproduced the pre-wallet state locally through migration `0106_setup_shared_previews_cap_80`, without copying any hosted records or credentials.

[Passing native PostgreSQL proof](migration-proof.json) covers the exact repository Preview command:

```text
scripts/development-database-command.ts migrate:preview
```

The new opt-in [rehearsal script](../../../scripts/rehearse-ai-credit-upgrade.ts) first uses the existing strict disposable-target parser and live server/session attestation. It requires the exact IPv4 local CI server/database identity. It creates a randomly named scratch database, initializes its Preview marker, and installs the106-entry old migration journal. It never changes the existing CI database or the paid-owner Development database. No provider credentials are forwarded to the migration command.

The scratch fixture contains a synthetic salon, canonical service/staff assignment, customer, historical booking at CAD65 versus its current CAD70 service, immutable synthetic design/reference records, a published draft/approval/receipt, and an existing trial usage record/cap. These are migration fixtures, **not model output, verified image files, or a genuine owner publication**. No new website-generation or visual-fidelity claim is made here.

The successful run proved:

- An intentional ledger-table conflict fails after the upgrade begins. PostgreSQL rolls back the new wallet account/purchase tables, leaves the106-entry migration journal unchanged, and preserves all prior fixture fingerprints.
- Removing that synthetic conflict and rerunning the **unmodified actual Preview migration command** succeeds. All six pending migrations107–112 apply; the final journal has112 entries.
- Existing business settings, catalog/staff assignments, customer/appointment snapshots, source/design records and approved publication fields remain unchanged. The historical appointment stays CAD65 while the current service stays CAD70.
- New wallet tables start empty; no credits are granted, charged or retroactively assigned. Old trial-call fields and the CAD68.615594 trial cap are unchanged. New receipt maps default to empty objects.
- Running the command again is a no-op: no duplicate journal rows, changed saved records or spending changes.
- The scratch database is removed, and the original disposable CI database's tracked table fingerprints still match. A separate [cleanup and isolation check](cleanup-and-isolation-proof.json) found no rehearsal databases remaining and confirmed the paid owner's saved revision, booking, credit balance and operator usage are unchanged.

[Four refusal checks](refusal-proof.json) separately exercised a missing rehearsal opt-in, hosted hostname, the paid-owner database name and a missing disposable marker. All exited1 **before TCP/unapproved IPC access**. The test observer permitted only the local Unix pipe used by the installed TypeScript loader. No hosted database or actual owner-trial database was accessed.

The final rehearsal source hash is recorded in the passing proof. Scoped ESLint, full TypeScript checking and diff checks passed. No packages were installed and this rehearsal used no paid APIs.

Early test-harness attempts failed on an incorrectly encoded JSON array and incomplete local Preview environment markers. The refusal observer initially counted the TypeScript loader's local Unix pipe as network access. Those harness defects were corrected. A temporary private diagnostic was removed from `migrate-development.ts`; the passing run verifies the migration runner/guards and SQL are unchanged from the recorded Git source. Failed-run diagnostics stay private outside Git.

To repeat, supply the existing local **disposable CI** connection using its normal private runner and set `LUSTER_DISPOSABLE_DATABASE=true` plus `LUSTER_AI_UPGRADE_REHEARSAL=true`, then run:

```text
node --import tsx scripts/rehearse-ai-credit-upgrade.ts
```

The script also requires `CONCURRENCY_TEST_DATABASE_URL` and a local CI role allowed to create its own scratch database. It rejects hosted targets and other database names. Do not substitute a hosted URL or add credentials to this document. Success prints the private evidence-directory path.

This is a local upgrade rehearsal, not an exact hosted-database clone, hosted migration result, complete recovery-from-every-failure proof, or Production release clearance. The hosted database must be freshly attested and its migration ledger checked within an authorized rollout. Preview configuration writes, hosted migrations/deployments, combined release verification and Production payment/release gates remain outstanding.
