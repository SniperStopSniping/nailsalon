# Shared L1 public booking authority

## Scope

Normal public booking and the customer assistant now use `validatePublicBookingSelection` and `resolveL1BookingAuthority`. A future channel must use these booking-domain entry points and the existing appointment creator; model output and presentation totals are never creation or payment authority.

The existing catalog resolver supplies variants, inherited bindings, groups, quantities, automatic additions, constraints, price and duration. The server adapter also verifies active service assignments and concrete technician capabilities. Required-binding enforcement retains the salon's existing policy, including inactive required targets. Unsupported consultation mode fails closed, consistent with the existing service editor/API contract.

The service page uses the same pure resolver for presentation. Booking configuration's pure functions are extracted without changing their behavior, keeping database imports outside the browser. Manual and AI review preserve the original requested choices separately from resolver-added options.

## Authority at each stage

| Stage | Authority |
| --- | --- |
| Menu and option controls | Public L1 snapshot; effective inherited bindings and groups |
| Selection and displayed totals | Existing pure catalog resolver |
| Quote and technician choices | Shared server adapter; active assignments and capabilities |
| Availability | Shared quote duration and eligible technician intersection |
| Final review | Revalidated selection with material fingerprint |
| Creation and deposit hold | Serializable transaction repeats L1 resolution and quote checks using its transaction handle |
| Appointment and payment amount | Canonical quote plus existing discount, tax and deposit authorities |
| Stale selection | Typed conflict; manual returns to service/time selection, AI returns to review |

An L1 booking cannot use the legacy service basket shape to bypass the selection authority. Non-L1 salons retain that path. Existing appointment records are not migrated or rewritten. Existing reschedule/history workflows remain scoped to their established stored-appointment contracts.

## Production catalog inventory

Read-only inventory on 2026-09-18 independently reattested the established Neon Production target. No customer, appointment or payment rows were read for this inventory, and no catalog changes were made.

Isla was the only L1 salon: 11 active services, 15 active add-ons, 52 effective bindings, no child variants, no active groups, no public catalog rules, and no capability rules. All 11 initial selections retained their existing price/duration. The synthetic 45-minute service plus automatic 5-minute option correction therefore demonstrates an existing engine defect; it does not introduce a price or duration change to Isla's current initial menu. Synthetic tests cover richer L1 states without modifying Isla.

The correction intentionally makes stale/missing L1 review acknowledgments fail closed. It is a booking correctness change, not a new pricing product rule. Billing and customer-assistant activation remain separate release controls.

## Verification

Contract tests execute the actual manual validator and customer proposal adapter against isolated PGlite. Real disposable PostgreSQL tests cover creation, stale catalog and capability changes, mutation between preflight and transaction, replay, concurrent slot claims, STOP suppression and authoritative deposit caps. Provider boundaries are stubbed and cannot send messages or payments.

The customer browser harness drives real handlers on disposable PostgreSQL in Chromium and WebKit, retaining legacy and L1 journeys. The standalone public-booking browser suite targets the actual local Next application and positively attests its disposable fixture database before any synthetic writes.

Run results and exact release-head CI must be recorded in the PR. Customer AI stays disabled until the separately authorized Isla-only activation checks pass.
