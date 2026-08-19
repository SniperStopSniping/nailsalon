# ADR 0006 — Draft / Live Resolution

**Status:** Accepted (Owner-ratified).

## Context
Owners need to preview unpublished presentation. Previews built on a second resolver
drift from the real page and become a liability.

## Decision
- Public visitors resolve against the **live** source, always.
- An authenticated, tenant-authorized owner preview may select the **draft** source.
- **Both feed the same resolver core.** No preview-specific semantics, no alternate
  pricing path, no second authorization matrix — source selection reuses the existing
  owner-preview primitives.
- Draft data must never reach an unauthenticated caller.

**The catalog has no draft/live staging.** Services and add-ons write straight to live
rows; only booking-page config and content are staged. An authorized owner requesting
a draft catalog therefore receives an explicit *unimplemented* error — **never live
data silently labelled as draft.**

## Consequences
Source selection is an explicit parameter with exactly one implemented catalog value
today, so adding catalog staging later is additive. The product must not imply that
unpublished menu changes are being previewed — they are not, and currently cannot be.
