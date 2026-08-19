# ADR 0003 — Rule Priority Ordering

**Status:** Accepted (Owner-ratified).

## Context
`catalog_rule.priority` existed in the landed schema and was read by nothing. Rules
were loaded with no `ORDER BY` and their array order flowed into the catalog revision
hash — so the same unchanged catalog could hash differently as Postgres row order
shifted with plan changes, firing spurious "catalog changed" conflicts against the
exact decision that hash exists to gate.

## Decision
Deterministic evaluation order is **`(priority ASC, id ASC)`**.

- **Lower numeric priority evaluates first** — higher precedence.
- Ties break deterministically on ascending rule id.

This is explicit contract, not an implementation detail. **Do not reverse it.**

Ordering is applied **in the resolver core**, so correctness does not depend on the
database returning rows in any particular order. The SQL `ORDER BY` is
defence-in-depth, not the guarantee.

## Consequences
Ordering must never be inferred from database default order. Duplicate rules with the
same public shape but different params resolve deterministically by id rather than by
whichever row the planner returned first.
