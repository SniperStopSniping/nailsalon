# Combined dependency validation checkpoint

Application commit tested: `ae00b859c9430bea8017c9c71556f8ed8e23a880`.
The release branch now combines the owner-builder fixes and evidence with the
dependency candidate through `3c62319cc862f1f1db774de952b1f384d34fb3f8`.
No production merge, migration, deployment or data change occurred.

The preserved package set uses Drizzle0.45.4, next-intl4.14.9, Next15.5.28 and
Sentry10.76.2. Compatibility fixes retain the default English locale and classify
wrapped database failures by their bounded underlying SQLSTATE, with sanitized
migration diagnostics. Constraint and booking tests verify persisted outcomes;
the security and concurrency gates were not disabled. The initial upstream93b05eff
build failed a nullability check; the explicit fail-closed3c62319c correction is
included here. That failed source is not represented as a successful build.

Fresh checks on this combined source passed:

- 308 PGlite/unit assertions across11 files, zero failures and zero pending tests.
- 72 browser checks:18 credits/pricing/team,50 owner entry and4 AI entry/manual-path
  cases, including Chromium and mobile WebKit.
- 24 CI/renderer font and CSP contract tests, zero skips.
- Full TypeScript on Node24, commitlint and the13-commit secret scan aftereb7327.

[Machine-readable scope and dependency proof](proof.json).
Dependencies were cloned into an owned private copy-on-write tree, preserving both
original installed trees; no new global tool or package installation was required.
Browser screenshots were retained privately rather than replacing earlier evidence.

These selected tests use scripted providers/component fixtures. They do not replace
fresh real-provider tests, native PostgreSQL concurrency checks, full exact-head CI
or the combined production-mode build. Those gates remain pending. The existing
[hosted recommendation-to-booking evidence](../hosted-recommendation-checkpoint/README.md)
belongs to the earliereb7327 runtime and is kept under that attribution.

Scope includes manual per-service preparation/cleanup controls that preserve the
separate global booking buffer, save/resume/review, disabled review during a pending
booking-link save, and the account-entry anchor. Owner approval and private draft
boundaries remain intact. The combined source is not a production-readiness claim.
