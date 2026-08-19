# ADR 0001 — Catalog Rule Semantics

**Status:** Accepted (Owner-ratified). Supersedes the pre-PR2 wording in the frozen L1 plan §6.4/§14.

## Context
The frozen L1 plan and the contract actually landed by PR2 (`catalogRuleContract.ts`,
migration `0073`) disagreed about two of the six rule types. The plan described
`include` as a *visibility* gate carrying `params.presentation: 'hide' | 'disable'`,
and gave `autoAdd` to `requires`. The landed contract does the opposite: `0073:271`
defines `include` as *"selecting the subject brings the object add-on with it
(auto-added when `params.autoAdd` is true)"*, `requires` maps to a params schema with
no `autoAdd`, and `presentation` is a `.strict()` enum of `surface | silent` that
**rejects** `'hide'`/`'disable'`. The plan's truth table was therefore not
implementable against the landed contract.

## Decision
**The landed PR2 contract wins.** Six rule types, no more:

| Type | Meaning | Public effect |
|---|---|---|
| `include` | **bundling** — selecting the subject may bring the object add-on in | `auto_add` when `params.autoAdd`; otherwise **no projection** (a mere offer) |
| `exclude` | subject makes the object unavailable | `disable` + reason — **never `hide`** |
| `requires` | **validation** — subject valid only with the object selected | `require` |
| `mutually_exclusive` | subject and object cannot coexist | `disable` |
| `max_quantity` | caps quantity of the object | `limit_quantity` |
| `requires_capability` | subject needs a capable technician | **none — server-private** |

`presentation` is `surface | silent`: an **announcement/explanation policy**, not a
visibility axis. `hide` remains in the public effect union but is currently produced
by no rule type.

**No material customer-visible change may be silent.** If an effect changes selection,
required items, price, duration, quantity ceiling, eligibility, provider/time options,
or the ability to continue, it must surface an explanation — `presentation: 'silent'`
may not suppress it. `silent` is legal only where the change is materially invisible.

No expression language, no boolean trees, no price- or duration-adjusting rule types.

## Consequences
`exclude` disables rather than hides so the `unavailable_with_selection` reason has
somewhere to live — a hidden element cannot explain itself. `requires_capability`
produces no public projection because a public `require` with no target would
advertise that a hidden gate exists.
