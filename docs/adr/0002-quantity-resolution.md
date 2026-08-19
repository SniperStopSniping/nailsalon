# ADR 0002 — Quantity Resolution

**Status:** Accepted (Owner-ratified).

## Context
Four sources could plausibly cap a quantity: the add-on's own `maxQuantity`,
`service_add_on.maxQuantityOverride`, a `max_quantity` catalog rule, and the server's
own fallback in `bookingQuote.ts`. Group `maxSelections` was a fifth thing that looked
like a cap but is not one. A public resolver that disagreed with the server would
offer customers quantities the server rejects.

## Decision
**Distinct-selection count and per-item quantity are different axes.**
`add_on_group.maxSelections` limits **how many distinct add-ons** may be selected in
that group. It is **never** a per-item quantity ceiling.

Per-item ceiling mirrors `bookingQuote.ts` exactly:
- `pricingType === 'per_unit'` ⇒ `maxQuantityOverride ?? addOn.maxQuantity ?? 10`
- anything else ⇒ exactly **1** (the server rejects any `quantity !== 1`)

An applicable `max_quantity` rule may **tighten** this and may **never loosen** it.
The strictest applicable cap wins.

**No silent clamping.** A quantity above the effective ceiling returns a typed,
anchored violation with a recovery action. The resolver never quietly reduces a
customer's selection.

## Consequences
The `10` is inherited server behaviour, not a chosen number — it exists so the public
resolver cannot offer what the server would reject with `invalid_add_on`. A
service-subject cap must be keyed by `(serviceId, addOnId)`: keying it by add-on alone
leaks the cap onto every other service offering that add-on **and** loses it where no
`service_add_on` row exists. Both directions were real defects, found by adversarial
review after the test suite was fully green.
