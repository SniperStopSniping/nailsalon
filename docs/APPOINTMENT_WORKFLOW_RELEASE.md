# Appointment completion and mobile management

## Defect and contract

A real booked service used a 72-character opaque catalog ID. Completion alone limited `finalItems[].catalogServiceId` and `catalogAddOnId` to 64 characters although the catalog and booking contracts use text IDs. The normal checkout payload therefore failed validation before appointment or financial processing. A synthetic $35 appointment reproduced the exact `finalItems[0].catalogServiceId` rejection.

The shared client/server completion schema accepts opaque IDs unchanged. The server validates retained catalog references against the locked appointment's salon before writing. Archived same-salon references remain valid; missing and wrong-salon references receive the same safe response. Existing completion replay guards still run first. No database migration is needed.

Payment methods remain optional under the existing contract. Blank actual-time inputs are omitted. Required photos, financial reconciliation, tax, permissions, state transitions, and replay protection remain authoritative on the server. No live appointment was used for mutation testing.

## Owner interaction

Opening an appointment shows its summary and state-aware actions. Editing is deliberate, with dirty-change protection. Communications and supporting details are collapsed; review status remains accessible with a full-width action beneath its explanation. Destructive actions remain distinct.

Checkout starts with service totals and payment recording. Owners can record payment later explicitly. Service editing, discounts/tips/tax, photos, actual time, and private notes remain available through expandable sections. Required after-photo controls open immediately. Optional photos retain the existing explicit skip flow. Before Review, safe field validation explains missing or invalid information and opens the relevant section. The server repeats validation and remains the authority.

A lost completion response is described as uncertain, not as proof of failure. Retrying the existing completion endpoint retains its completed-state replay protection; the UI also prevents concurrent submissions. This does not introduce a new payment or checkout engine.

## Release boundaries

Deploy through protected main after exact-head CI and independent review. Preserve the prior production writer boundary, existing recovery safeguards, billing-dark state, salon automation settings, and the separate RT-20 billing investigation. No migrations, settings activation, real messages, model evaluations, or real bookings/payments are required to validate this change.

Synthetic component, integration, and browser tests cover the changed contract and mobile interactions. Full test/CI results and exact release provenance belong in the PR and release evidence, not inferred from a successful compile alone.
