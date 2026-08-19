# ADR 0004 — Public Catalog Boundary

**Status:** Accepted (Owner-ratified).

## Context
The catalog's internal model carries tenant identifiers, rule identities and
priorities, owner-authored notes, capability graphs and raw JSON params. None of it
may reach a browser. Boundaries maintained by convention erode; a single `{...row}`
spread is enough.

## Decision
The public DTO is an **allowlist**, never a filtered copy of a database row.

**Never public:** rule IDs · rule priorities · internal notes · capability IDs · raw
private params · tenant internals · audit IDs · payment/deposit internals · DB-only
fields.

`PublicCatalogRuleProjection` carries exactly: `projectionKey`, `effect`, `trigger`,
`serviceScopeId`, `targetAddOnId?`, `maxQuantity?`, `reasonCode`, `reasonText`,
`presentation`. `projectionKey` is opaque, deterministic, and **never derived from the
internal rule id**.

**Capability privacy is structural, not filtered.** `CatalogRuleCoreInput` has no
`capabilityId` field at all — it carries `hasCapabilityRequirement: boolean`. The
shared core cannot leak a capability id because it is never given one. `params` and
`priority` exist on that input type (server→core) and are not public.

The core is DB-free, synchronous and browser-safe. The server wrapper owns DB access,
tenant authorization, private enrichment and projection.

## Consequences
Enforced by `catalogPublicDtoBoundary.test.ts`, which builds **real** projector output
and scans it recursively — both a denylist of sensitive names and a per-shape
allowlist, so a future field added by a spread is caught even if its name is
innocuous.
