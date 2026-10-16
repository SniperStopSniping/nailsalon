# UX improvements found during tutorial walkthroughs

Source baseline: `ad28e325b646b19dea481aec83d3d6d5ff5dbac5`. Synthetic local owner and customer flows only. Application changes are unreleased Feature Preview until approved release; no production settings, data or contracts changed.

| Finding | Evidence | Change | Verification |
|---|---|---|---|
| A future manual booking closes into an empty Today page with no save acknowledgement | Real creation of Sarah’s appointment; `manual-appointment-5.png` / rehearsal source | Tenant-scoped Appointment saved notice, View calendar shortcut and accessible Dismiss; clear stale notice when starting a new booking | 76 dashboard/appointment tests; actual saved result re-recorded on mobile |
| SMS readiness copy still refers to monthly plans | Marketing & Messages real paused-state screen | Explain SMS credits and preserve the balance; remove plan/subscription implication without changing readiness/entitlements | 14 integration-health tests |
| Public summary repeats the sole service before its add-on | Real availability journey: BIAB Overlay + BIAB Overlay: Simple Nail Art | Omit the repeated service prefix for a single base service; retain disambiguation for multiple services and add-on quantities | 64 booking-time tests including new single/multiple-service cases |
| Customer buffer wording calls cleanup time preparation | Real availability response reserves 90-minute service + 15-minute buffer, while technician setup has 15-minute cleanup | Describe time reserved by the salon, preserving canonical durations and slot calculations | Updated time-step assertion within the 64 passing tests |
| Technician service saves lose their success message during a full-screen parent refresh | Actual successful PUT followed by the Services tab remounting | Refresh technician metadata in the background after service saves; retain the tab and its acknowledgement | Parent refresh regression, two tests; real assignment save re-recorded successfully |
| Deposit setup text promises an unconnected activation will wait, but the server rejects activation | Actual local 409 STRIPE_ACCOUNT_NOT_CONNECTED; no charge attempted | Explain saving the amount first, connecting a charge-ready account, then enabling deposits | 24 payment-settings tests; backend readiness checks unchanged |
| Portfolio allowance text promises paid upgrades and unavailable drag controls | Source inspection of the allowance states and actual photo-grid controls | Describe the existing allowance, preserve retained photos, and direct owners to support | 14 portfolio tests, including retained over-allowance photos and truthful controls |
| Private flags describe a person as a problem client | Owner client-controls screen | Use Important client flag and Private flag note; explicitly state salon-only visibility | 43 client tests, including permission gates and the unchanged flag/block payloads |

## Validation

258 focused tests passed: dashboard/new appointment 76; booking-time 64; integration health 14; staff detail 2; payments/portfolio 38; client management 43; no-show rules/dialog/risk display 21. The final full Next.js build and type checks passed after all application changes. Scoped ESLint passed with zero errors and eight existing warnings. `git diff --check` passed.

No full-suite result or provider delivery is inferred from these checks. The no-show runtime separately verified an eligible pre-start report, a second authorized synthetic salon's count of one, correction, and a recalculated count of zero. The synthetic cash checkout read back as paid, 6,500 cents recorded, zero remaining balance.

## Production tooling refinements

Actual pointerdown timestamps now drive hand annotations; initial dashboard data readiness is awaited. The compositor trims short startup lead-ins while preserving dashboard navigation and the real click/result. Text layout checks enforce legibility and consistent spacing. Native mobile profile-section controls are demonstrated through their actual accessible combobox.

## Boundaries and remaining verification

No API contract, schema, pricing, entitlement, ledger, no-show eligibility or appointment transition changed. No real messages or funds moved. UI changes require a reviewed PR, required CI and preview checks before any merge/deployment. Full application builds/type checks are recorded separately from runtime/provider readiness. Provider setup/delivery and physical-iPhone review are not inferred from local success.
