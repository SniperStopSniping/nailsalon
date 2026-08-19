# Architecture Decision Records

Short, durable records of decisions that are expensive to rediscover and dangerous to
silently reverse. Each ADR states the decision, why it was taken, and — where one
exists — the **machine guard** that enforces it.

An ADR is not a plan. It records what was settled, not what is intended.

| ADR | Decision | Enforced by |
|---|---|---|
| [0001](0001-catalog-rule-semantics.md) | Catalog rule semantics (six landed types) | `catalogResolverCore.test.ts` |
| [0002](0002-quantity-resolution.md) | Quantity resolution and precedence | `catalogResolverCore.test.ts` |
| [0003](0003-rule-priority-ordering.md) | Rule priority ordering | `catalogResolverCore.test.ts` |
| [0004](0004-public-catalog-boundary.md) | Public catalog DTO boundary | `catalogPublicDtoBoundary.test.ts` |
| [0005](0005-catalog-revision-and-fingerprint.md) | Revision vs material fingerprint | `catalogFingerprint*.test.ts` |
| [0006](0006-draft-live-resolution.md) | Draft/live source selection | `catalogResolver.server.test.ts` |
| [0007](0007-production-schema-readiness.md) | Production schema readiness | `schemaReadinessCore.test.ts` |
| [0008](0008-database-guard-classification-and-recovery.md) | DB guard: attestation vs. availability classification, bounded warm-runtime recovery | `runtimeDatabaseGuard.test.ts`, `runtimeDatabasePoolRecovery.test.ts` |
