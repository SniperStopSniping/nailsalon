# Isolated hosted Preview preparation

The owner approved continuing the release work on2026-10-18. Configuration changes below affect only `codex/ai-business-setup` in Vercel Preview and the separate Preview renderer project. No Production credentials, settings, migrations or salon data were accessed or changed.

## Applied and verified

- Branch-specific Development Clerk, Stripe sandbox and testing OpenAI configuration was applied without printing or reading back its secret values. Matching sandbox prices were verified as active, one-time CAD10/20/50 prices with `livemode:false`. Existing metering FX/version policy and the Preview deployment marker were carried over. AI self-serve/intake/publication entry flags were explicitly configured; purchases remain disabled.
- Metadata verification confirmed Preview-only branch scope and unchanged unrelated Preview records. No Vercel Development or Production environment values were read or written.
- The existing dedicated Preview PostgreSQL endpoint was freshly verified with a trusted certificate and its Preview marker. The106-entry migration ledger exactly matched the candidate prefix; all17 appointment email addresses use synthetic domains and the customer table had0 records.
- A private PostgreSQL18.6 custom-format backup of the application/Drizzle schemas was saved and its archive catalog verified. Its SHA256 and size are recorded without uploading the archive or its contents. No backup restoration is claimed.
- The **actual guarded repository command** applied migrations107–112. All preexisting projected columns of business, catalog, staff assignments, appointments, assets, drafts, approvals, receipts, AI calls and budgets retained their fingerprints. The new wallet tables started empty; credit/mapping defaults and existing budget caps were verified. A second actual migration invocation was a no-op.
- The renderer was deployed from a clean committed archive of37459a5e to a separate **Preview** URL. Its HTTP body and CSP exactly match the committed handler/runtime/font bytes; no cookie was set, network access is disabled, and the frame keeps its opaque sandbox. The existing test alias was not switched during this preparation step.
- A dedicated **sandbox** Stripe webhook was registered with the same pinned2024-06-20 API version and a restricted credit-event list. Its signing key was stored privately in the exact Preview branch. Real delivery is **not yet verified**; purchases remain off.

[Configuration](configuration-proof.json) · [Backup](backup-proof.json) · [Schema upgrade](migration-proof.json) · [No-op replay](migration-replay-proof.json) · [Renderer](renderer-proof.json) · [Sandbox endpoint](sandbox-webhook-proof.json).

## Pre-push history check

The complete review range, unlike the earlier tree-only check, flagged one older manifest field named `candidate-secret-scan-proof.json`. At10bf877e its value was verified as the SHA256 of the referenced immutable evidence file, not a credential. Current manifests already use explicit path/sha256 entries.

The existing scanner fingerprint mechanism was extended for only this exact path, normalized key and verified digest. New adversarial coverage rejects changed values, other keys, moved paths and adjacent provider secrets. No history rewrite, generic digest exemption or disabled scan was used. The first fingerprint attempt used the raw key rather than the existing normalized key and failed its new test; correcting that binding produced36 passing scanner tests. An obsolete range process that had loaded the first registry was explicitly stopped before rerunning; it was not restarted because of an observation timeout.

The final scanner result is recorded in [scanner proof](scanner-proof.json). Application, renderer, domain and dependency sources remain byte-identical to the previously tested application6584d6b4; this follow-up changes only the scanner and its tests, plus curated evidence.

## Remaining verification

This is infrastructure preparation, not a completed hosted owner journey or Production-readiness declaration. The new builder deployment, exact test-alias routing, native hosted authentication/uploads/generation/revisions, signed Stripe delivery and owner checkout, original booking completion, required combined CI and release reviews still need to pass. Earlier local/native/model results remain separately attributed in the [combined checkpoint](../combined-local-candidate-checkpoint/README.md).

Raw keys, private archives, uploads, provider payloads and complete operational logs remain outside Git. The manifest uses explicit path/sha256 entries.
