/**
 * Luster L1 PR4 — §12. The reconciliation order every booking submission
 * (`POST /api/appointments`) actually follows before any persistence or
 * side effect. Pure documentation-as-code: no I/O, no DB, importable from a
 * test without pulling in `server-only`.
 *
 * THIS DESCRIBES WHAT THE CODE DOES, NOT A FREELY CHOSEN SEQUENCE. Every
 * position below is either (a) load-bearing today, or (b) a hard, verified
 * dependency that makes the alternative order impossible, not merely
 * unwise. See `bookingSubmissionOrder.test.ts` for the check that keeps
 * this constant honest against `route.ts` — both a structural (source-order)
 * signal and, for the one transition most worth proving, a genuine
 * behavioural one.
 *
 *   1. catalogSelection      — NEW (PR4, §13). Fresh catalog resolution vs.
 *                              the client's acknowledgment. Dormant unless
 *                              `resolveCatalogDomainView(features) === 'l1'`
 *                              (dark for every salon today). Runs
 *                              PRE-TRANSACTION, first — genuinely first, not
 *                              merely documented first: it needs nothing
 *                              route.ts hasn't already resolved by the time
 *                              the salon and canonical client identity are
 *                              known, so nothing else in this list has a
 *                              reason to precede it. Also structural: the
 *                              PR3-frozen functions it calls
 *                              (`catalogResolver.server.ts`) run their own
 *                              top-level DB queries and were never built to
 *                              accept a caller's `tx`, so it CANNOT run
 *                              nested inside `runSerializedBookingTransaction`
 *                              (confirmed by a real deadlock while building
 *                              this PR, on this suite's single-connection
 *                              PGlite harness). "Before any persistence or
 *                              side effect" still holds: nothing is written
 *                              until the transaction opens, well after this
 *                              returns.
 *   2. policyAcknowledgment  — EXISTING, NOT REDESIGNED. Preliminary
 *                              (`preliminaryRequiredPolicy`) then
 *                              authoritative in-tx
 *                              (`assertCurrentBookingPolicyAcknowledgment`).
 *   3. financialQuote        — EXISTING, NOT REDESIGNED. Preliminary
 *                              (`validatePublicBookingSelection`) then
 *                              authoritative in-tx quote/deposit resolution.
 *   4. availability          — EXISTING, NOT REDESIGNED. Pre-tx soft check
 *                              (`finalDecision` / `canTechnicianTakeAppointment`)
 *                              then the in-tx hard lock
 *                              (`lockTechnicianAndAssertSlotFree`), now
 *                              consuming the §16 blocking predicate
 *                              (`appointmentBlocking.ts`).
 *   5. requestApprovalTerms  — NEW (PR4, §14/§15). Runs AFTER availability —
 *                              this is NOT a free ordering choice PR4 made;
 *                              it is a HARD DEPENDENCY. `resolveExplicit
 *                              RequestApprovalActivation` reads `technician`
 *                              (the resolved, non-null technician —
 *                              `pickAnyAvailableTechnician(finalPolicy)`
 *                              when none was explicitly requested) and
 *                              `finalPolicy` (`loadBookingPolicy`'s result:
 *                              `overridesByTechnician`, `timeOffTechnicianIds`,
 *                              `blockedSlotsByTechnician`,
 *                              `appointmentsByTechnician`) — both of which
 *                              are PRODUCED BY the availability step, not
 *                              merely checked by it. `finalPolicy` is a
 *                              `const` declared inside that step; referencing
 *                              it any earlier in the same function body is a
 *                              "used before its declaration" error, not a
 *                              style choice — the two steps cannot be
 *                              reordered without deleting and re-deriving
 *                              the schedule data request-approval eligibility
 *                              itself depends on. PARTIALLY wired:
 *                                - WIRED: `resolveExplicitRequestApprovalActivation`
 *                                  (eligibility + `resolveRequestApprovalDeadline`).
 *                                  Rejects an ineligible/not-request-bookable
 *                                  slot with 400 `REQUEST_NOT_BOOKABLE`
 *                                  BEFORE the transaction opens.
 *                                - STILL UNWIRED: `computeRequestApprovalTerms`
 *                                  / `haveRequestApprovalTermsChanged` (the
 *                                  client-shown-terms comparison / 409
 *                                  `REQUEST_APPROVAL_TERMS_CHANGED` contract)
 *                                  — no public UI exists yet to show a
 *                                  customer these terms or send one back
 *                                  (PR7), so there is nothing for this half
 *                                  to compare against. Built and tested,
 *                                  ready for that PR.
 *                              Dormant for every real salon regardless: it
 *                              only fires once a resolved service's
 *                              `confirmationMode` is explicitly
 *                              `'request_approval'` — impossible today, no
 *                              owner editor exists (PR6).
 *   6. persistence           — EXISTING. The appointment insert + snapshots.
 *
 * Steps 2-4 keep their EXISTING relative order in `route.ts` — the spec
 * calls all three "already exists — do not redesign", and reordering a
 * transaction this security-and-money-sensitive without an explicit mandate
 * would itself be exactly the kind of improvisation PR4 is not authorized
 * to do. What this order actually pins: step 1 runs before everything
 * (a free choice, since nothing forces otherwise, but genuinely enforced —
 * see the test); steps 2-4 are unchanged main; step 5 runs after step 4
 * BECAUSE IT MUST, not by convention.
 */
export const BOOKING_RECONCILIATION_ORDER = [
  'catalogSelection',
  'policyAcknowledgment',
  'financialQuote',
  'availability',
  'requestApprovalTerms',
  'persistence',
] as const;

export type BookingReconciliationStep = typeof BOOKING_RECONCILIATION_ORDER[number];
