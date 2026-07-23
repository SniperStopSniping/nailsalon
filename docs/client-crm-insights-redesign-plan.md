# Client CRM and Insights Redesign — Phase 0 Plan

**Status:** Phase 0–2 implemented; entitlement checkpoint verified; Phase 3 not started
**Scope:** Owner Client CRM, Client Insights, and owner revenue summary correctness
**Phase 0 rule:** This document changes no production behavior, schema, or data.

## 1. Outcome and fixed decisions

The existing Clients app remains the single owner destination. Its top-level switch becomes **Clients | Client Insights**; this is not a new bottom-navigation or app-grid destination.

- **Clients** owns the searchable client list and selected-client workspace.
- **Client Insights** owns client health, follow-ups, and persisted-data segments.
- **Owner Today** gains a core operational financial summary headed by **Revenue today**, **Revenue this week**, and **Revenue this month**.
- **Analytics** remains the detailed salon-wide reporting app. Client Insights may link to it but must not duplicate revenue reporting.
- The main money metric is **Completed appointment revenue**, never “profit.”
- Initial implementation uses the current schema and indexes. Schema/index changes require measured evidence and a later plan.
- Delivery order is Phase 0 plan → Phase 1 correctness → Phase 2 Owner cards → full quality gates → CRM/Insights UI.

## 2. Verified current-state inventory

| Capability | Current status and source | Decision |
|---|---|---|
| Client list | Shipped in `src/components/admin/ClientsModal.tsx`; paginated search and Recent/Visits/Spent/A–Z sorting use `GET /api/admin/clients`. | Keep fast and operational. |
| Owner client profile | Shipped in `ClientsModal.tsx` and `GET/PATCH /api/admin/clients/[id]`; includes contact data, stats, preferences, notes, flags, photos, and limited appointment history. | Extract into a responsive six-section workspace. |
| Client Hub | Shipped as Overview/Follow-ups/Segments/Reports in `ClientHubPanel.tsx`; mounted inside Clients. | Rename to Client Insights, remove Reports/revenue, and make health/segments actionable. |
| Follow-ups | Client Hub fetches `/api/admin/marketing`; Marketing and Today use `buildRetentionQueue`. | One server snapshot/rule path; do not independently recompute counts. |
| Segments | Counts only; current rules live inline in `api/admin/client-hub/route.ts`. | Move to one typed rules module used by both counts and filtered client lists. |
| Client money | Client Hub shows lifetime revenue/discount/tax/tips/paid/outstanding. | Remove salon-wide money from Client Insights. |
| Detailed analytics | Shipped in Analytics with Daily/Weekly/Monthly/Yearly navigation. | Keep as the drill-down reporting surface. |
| Owner revenue summary | Added in Phase 2, but initially coupled to the optional Analytics module. | Keep eight basic operational figures on Owner Today for every authorized owner/admin; gate only advanced Analytics. |
| Activity timeline | Not present. Underlying appointments, audit rows, payments, communications, photos, and reviews exist. | Add a read-only, paginated v1 timeline. |
| Rewards | Rewards and review-reward data exist in separate owner surfaces. | Show summary and deep link in profile Overview; do not duplicate management. |
| Rich preferences | Split between `salon_client` and the separate `client_preferences` model used by the staff profile. | Surface safely without dual-writing; consolidation is deferred. |
| True profit/P&L | No expense, COGS, processing-fee, refund, or complete payroll ledger exists. | Do not calculate or label profit. |

Current test coverage includes `ClientsModal.test.tsx`, `api/admin/client-hub/route.integration.test.ts`, `analyticsDateRange.test.ts`, `queries.clientStats.integration.test.ts`, `api/admin/marketing/route.integration.test.ts`, and `api/staff/client/[phone]/route.test.ts`. There is no dedicated `ClientHubPanel` component suite or owner-card suite.

## 3. Architecture map

| Feature | UI | API/service | Existing DB sources | Required tests |
|---|---|---|---|---|
| Reporting foundation | No Phase 1 UI | Shared salon-timezone range, revenue, comparison, and provenance helpers; additive `financials.currentPeriods` projection on existing `GET /api/admin/analytics` | `appointment`, `appointment_payment`, salon booking settings | Pure range/provenance tests and PGlite integration matrix |
| Owner revenue cards | `OwnerTodayWorkspace.tsx`, with independent loading/error/refresh state | Private, dynamic `GET /api/admin/financial-summary`, authorized by `requireAdminSalon` and deliberately independent of the Analytics entitlement | Completed appointments and non-void payments | Core API auth/tenancy/cache tests; component loading/error/empty/provenance tests; proof that Today does not request advanced Analytics |
| Client Insights overview | Refactored `ClientHubPanel` or extracted `client-insights/` components | Existing `/api/admin/client-hub` may remain as an internal compatibility route, but delegates to a shared Client Insights service | `salon_client`, appointments, services, communications, consent | PGlite count semantics; component states and navigation |
| Segment drill-down | Segment cards open the Clients list with the filter visible and removable | Extend `GET /api/admin/clients` with a validated segment ID; count and list call the same rules module | Same snapshot as Insights counts | Count/list identity, pagination, search-within-segment, tenancy |
| Follow-ups | Actionable due cards in Client Insights; Marketing remains the full campaign workspace | Shared retention snapshot feeds Client Insights, Marketing, and Today | `salon_client`, active appointments, `client_communication`, retention settings, consent | Suppression, snooze, blocked/future-booking exclusions, cross-surface equality |
| Responsive profile | Six desktop sections; three mobile tabs | Keep `GET/PATCH /api/admin/clients/[id]`; split heavy activity into a cursor endpoint | `salon_client`, appointments/services, photos, flags | Existing profile regression tests plus responsive browser coverage |
| Activity timeline v1 | Timeline section/mobile Activity tab | Add `GET /api/admin/clients/[id]/activity?cursor=&limit=` | Appointment lifecycle, audit log, payments, communications, photos, reviews | Source mapping/order/cursor, tenancy, redaction/sanitization, empty/error UI |
| Book again | Profile header/Overview action | Reuse existing booking modal and appointment actions | Latest eligible completed appointment snapshots | Prefill contract: client + base service + technician only |
| Rewards summary | Profile Overview card with link | Reuse existing rewards/reviews APIs or add a narrow read projection | `reward`, `review`, `salon_client.loyaltyPoints` | Honest counts/status and navigation; no duplicated mutation tests |

All new server projections remain protected by `requireAdminSalon`. The eight Owner Today figures are core operational information for authorized salon owner/admin workspace users; charts, comparisons, custom ranges, service mix, and technician reporting preserve the existing Analytics entitlement policy. Staff visibility/redaction behavior is unchanged.

## 4. Metric audit and canonical contract

### 4.1 Current inconsistencies to correct

- Client Hub money has no date predicate: it is lifetime, despite sitting beside month-to-date and current-state client metrics (`api/admin/client-hub/route.ts`).
- Hub appointment counts exclude soft-deleted appointments, while its money, top-service, and category queries do not.
- Hub due/overdue calls `buildRetentionQueue` with `communications: []`; Marketing passes real communication history. A sent, dismissed, converted, or snoozed item can therefore count in Insights but be absent from Marketing.
- “New this month” uses server-local `new Date(year, month, 1)`, not salon-local boundaries.
- Hub total clients is derived from a query capped at 5,000; category rows are capped at 10,000.
- Analytics uses salon timezone but Sunday-start weeks. Its visible weekly chart labels begin Monday.
- Analytics and staff money components hard-code USD in places, while Client Hub defaults to CAD. None reliably renders the salon’s configured currency.
- Per-client `totalSpent` is paid-only completed service value, while Hub revenue includes completed unpaid/partial rows; the two figures are not designed to reconcile.
- Staff “Week” and “Month” earnings controls are rolling 7/30-day ranges, not calendar week/month, and “They Made Us” subtracts commission only. It is not profit.

### 4.2 Completed appointment revenue

For a requested salon-local period:

1. Include appointments belonging to the salon where:
   - `status = 'completed'`;
   - `deleted_at IS NULL`;
   - payment status is not `comp`;
   - `start_time` is inside `[start, end)`.
2. Attribute revenue to `appointment.startTime`, matching the existing Analytics service-date convention. Do not use payment time for revenue or `completedAt`, which is nullable on legacy rows.
3. Amount per appointment:
   - finalized: `finalPriceCents`;
   - legacy fallback: `totalPrice` only when `finalPriceCents` is null;
   - unresolved: neither value is usable.
4. `finalPriceCents` represents the completed services/add-ons/custom items after discount and **net of tax**. Tips and tax never inflate revenue.
5. Collection state does not change completed appointment revenue. Paid, partial, and unpaid completed work remains revenue; collection is a separate metric.

This extends the intent of `src/libs/revenueSql.ts` but must add an explicit reusable eligibility predicate and source metadata rather than silently applying `COALESCE`.

### 4.3 Provenance

Every revenue result returns source counts and provenance metadata:

- `finalized`: all included rows use `finalPriceCents`;
- `legacy`: all included rows use the booked-total fallback;
- `mixed`: both finalized and legacy rows contribute;
- `unresolvedAppointmentCount > 0`: at least one otherwise eligible row has no usable amount;
- empty range: all source counts and amounts are zero.

The UI shows no badge for finalized-only or empty data. Legacy/mixed data with no unresolved rows shows **Estimated history**. Any unresolved row takes precedence and shows **Incomplete history**. It must never silently present an incomplete aggregate as exact.

### 4.4 Time ranges and comparison periods

- Timezone: salon IANA timezone from booking settings.
- Currency: salon-configured ISO currency, formatted through `formatMoney`; API responses include the currency.
- Today: salon-local day start through the shared request `now`.
- This week: salon-local **Monday** start through `now`; the calendar week is Monday–Sunday.
- Month to date: salon-local first of the month through `now`.
- Query boundaries are half-open `[start, end)`.
- Previous-period deltas compare equal elapsed durations:
  - today-so-far versus the same elapsed duration of the prior local day;
  - week-so-far versus the same elapsed duration of the prior Monday-start week;
  - month-so-far versus the same elapsed duration from the prior month’s start, clipped at that month’s end.
- A zero/empty previous period produces no percentage, not a fabricated `100%`.
- DST, leap day, month-length, year-boundary, and timezone-east/west-of-UTC cases are required tests.

The existing `analyticsDateRange.ts` and timezone helpers should be generalized rather than creating another date convention. Analytics must move to the same Monday-start contract when the shared helper lands.

### 4.5 Supporting financial metrics

- **Cash collected:** sum `appointment_payment.amountCents` where `voidedAt IS NULL`, attributed by `recordedAt` inside the selected range. This is cash flow and may relate to appointments outside the service-date range.
- **Tax collected:** completed appointment `taxAmountCents`, displayed separately from revenue.
- **Tips:** completed appointment `tipCents`, displayed separately from revenue.
- **Completed outstanding:** sum the independently clamped remaining payable amount for each completed, non-comp, non-deleted appointment: `max(service revenue + tax + tip - positive non-void payments, 0)`. Cancelled, no-show, and ordinary future appointment balances are excluded. An overpayment on one appointment cannot offset another appointment’s debt. Rows without sufficient checkout/payment facts are unresolved rather than silently zero.
- **Upcoming booked balance:** separate service-only booked balance for future non-deleted pending/confirmed appointments, less recorded non-void payments. It is not completed outstanding and must not be labeled “due.”
- **Deposit due:** unsupported because there is no persisted per-appointment deposit requirement/source.
- **Refunds/net cash:** deferred because voids are corrections and no refund ledger exists.
- **Profit:** unsupported until expenses, payroll rules, fees, COGS, and refunds are modeled.

## 5. Final information architecture

### Clients

- Sticky search, sort, and optional active segment filter.
- Desktop: persistent client list on the left and selected-client workspace on the right.
- Mobile: list → full-screen profile drill-in, preserving search, sort, scroll, and selected segment on back.
- Profile header actions: **Book again**, text/contact, and existing status-aware appointment actions.

### Client Insights

- **Overview:** client-health summary and high-value persisted-data segment cards.
- **Follow-ups:** the same suppression-aware queue as Marketing/Today, with due age, last service, channel state, and Review/Text, Snooze, Dismiss, Book, and Open-client actions where already supported.
- **Segments:** grouped persisted-data cohorts; selecting one opens the filtered Clients list.
- No Reports tab and no salon-wide revenue cards.
- Optional “View detailed analytics” link when Analytics is entitled and enabled.

Client Insights must lazy-load follow-ups/segment lists rather than blocking Overview on the current unconditional Hub + Marketing `Promise.all`.

## 6. Responsive selected-client workspace

Desktop uses exactly six navigable sections:

1. **Overview** — identity/contact, client since/last visit, visits, paid service spend, average spend definition, client health, upcoming appointment, rewards summary/link, flags, and primary actions.
2. **Timeline** — communications, reviews, appointment lifecycle/audit status, payments, and photo events in reverse chronological order.
3. **Appointments** — upcoming, completed, and recent issues with pagination and existing manage/checkout/rebook actions.
4. **Preferences** — preferred technician, sensitivities, nail preferences, tags, rebook interval, and read-only richer preference data where present.
5. **Payments** — appointment-level finalized revenue, tax, tips, recorded payments, void state, and completed outstanding; no refund/deposit claims.
6. **Notes & Photos** — current internal notes/status plus the nail-history gallery.

Mobile folds these into:

- **Overview**
- **Activity** — Timeline + Appointments + Payments
- **Details** — Preferences + Notes & Photos

The header and mobile tab bar stay sticky; controls remain at least 44px; focus, keyboard order, reduced motion, safe areas, empty/error/loading states, and back-navigation state are explicit acceptance criteria. The current nested fixed profile layer in `ClientsModal.tsx` should be extracted before visual expansion.

### Timeline v1 source rules

- Appointment lifecycle and immutable `appointment_audit_log` status events.
- Non-void payment recordings and explicit payment-void events.
- Client communications using their real prepared/sent/not-sent/snoozed/dismissed/converted timestamps.
- Photo uploads and reviews.
- Events expose a typed source, stable source ID, timestamp, title, concise metadata, and appointment link where applicable.
- Message snapshots remain token-sanitized; payment references and other sensitive values are not unnecessarily exposed.
- Mutable client notes are **not** historical and must not appear as past timeline events.
- Rewards remain a summary/deep link in Overview rather than a synthetic timeline.

### Book again

“Book again” reuses the existing new-appointment modal and prefills only:

- client identity;
- the previous appointment’s base service;
- the previous/preferred technician.

It does not carry add-ons, custom items, prior price, discount/promotion, date, payment, tax, or tip.

## 7. Shared Client Insights segment rules

Create one typed segment registry/service. It supplies both aggregate counts and the exact client IDs/query predicate used by `GET /api/admin/clients?segment=...`; count and list must not drift.

| Segment | Canonical persisted-data rule |
|---|---|
| New this month | `salon_client.createdAt` within salon-local month-to-date bounds |
| Returning | `totalVisits >= 2` |
| Due to return | `buildRetentionQueue` stage `rebook`, including real communication suppression |
| Overdue | `buildRetentionQueue` stage `promo_6w` or `promo_8w` |
| No future appointment | No non-deleted future pending/confirmed appointment and no current in-progress appointment |
| Not seen in 60 days | Non-null `lastVisitAt` at least 60 elapsed days ago |
| Not seen in 90 days | Non-null `lastVisitAt` at least 90 elapsed days ago |
| Cancelled in last 30 days | Distinct client with a non-deleted cancelled appointment updated in the rolling 30-day window; `updatedAt` is used because no cancellation-event column exists |
| Previous no-shows | `noShowCount > 0` |
| Service affinity | Distinct client with a non-deleted completed appointment whose persisted category snapshot matches Builder gel, Manicure/Hands, Pedicure/Feet, or Extensions |
| Transactional text consent | Latest consent row for salon + recipient + SMS + `appointment_transactional` is granted |

Rules:

- Count distinct `salonClientId`; use normalized-phone fallback only for legacy appointments without stable identity and test deduplication.
- Due/overdue and other outreach-oriented cohorts exclude blocked clients and anyone with an active future/in-progress appointment.
- Segments may overlap; the UI does not imply a partition.
- Birthday, acquisition source, and marketing-consent cohorts remain absent because their required persisted fields do not exist.
- Remove hard caps as semantic count limits. Pagination belongs to list output; query performance is measured separately.
- Return `asOf`, `timeZone`, and a rules/version identifier so count/list behavior is auditable.

## 8. Owner Today revenue cards

Place one compact operational section in `OwnerTodayWorkspace` after the agenda, so the immediate schedule remains the first task:

- **Revenue today**
- **Revenue this week**
- **Revenue this month**

The three primary cards show Completed appointment revenue. A compact secondary section shows Collected today, Completed outstanding, Tips today, Tax today, and Discounts today. Upcoming balance remains available to Analytics/payment details and is never presented as overdue debt. Deposit due and refunds are not shown because their required ledgers do not exist.

`GET /api/admin/financial-summary` is a private, force-dynamic, non-cacheable owner/admin endpoint. It uses `requireAdminSalon`, returns only the authorized salon’s currency, timezone, current periods, completed outstanding, and provenance, and does not apply the Analytics module guard. `OwnerTodayWorkspace` owns its loading, retry, last-good, and mutation-driven refresh behavior.

The full `GET /api/admin/analytics` request is not made merely to populate Owner Today. Advanced Analytics loads only when its entitled visible surface is opened, avoiding duplicate reporting queries on the Today screen.

The cards:

- use the canonical metric/range service;
- use salon currency and timezone;
- never call the value profit, gross cash, or amount paid;
- use **Estimated history** for legacy/mixed data without unresolved rows;
- give unresolved data precedence with **Incomplete history** and explain that unavailable financial details prevented inclusion;
- show the overall no-activity state only when all eight displayed figures are zero;
- refresh after appointment completion/reopen/payment mutations through existing dashboard events;
- do not copy the Analytics chart or create a second detailed report.

### 8.1 Entitlement checkpoint

The Phase 2 implementation initially inherited the `analyticsDashboard` gate because the admin page obtained these figures from `GET /api/admin/analytics`. That route calls `requireAdminSalon` and then `guardModuleOr403({ module: 'analyticsDashboard' })`; the page skipped the request when the module was disabled. Consequently, all eight cards disappeared together.

The Owner Today workspace is available to active salon `owner` and `admin` memberships through the shared admin authorization path, plus authorized super-admin access/impersonation. It is not a staff-dashboard surface. The existing core Today route is not Analytics-gated, but previously exposed schedules and appointment counts rather than comparable aggregate financial information.

Final entitlement structure:

- the eight operational figures are available to every authorized Owner Today user;
- Analytics continues to control comparisons, charts, custom ranges, service mix, and technician performance;
- disabling Analytics hides only advanced reporting, not the operational summary;
- no entitlement, role, or tenant setting is silently modified to achieve this split.

## 9. Duplication and reuse plan

Reuse or centralize:

- `revenueSql.ts` intent, extended with eligibility and provenance.
- `analyticsDateRange.ts`, `getDateKeyInTimeZone`, and `getZonedDayBounds`, generalized to the Monday-start/equal-elapsed contract.
- `formatMoney` with API-provided salon currency; remove new hard-coded USD/CAD formatting.
- `buildRetentionQueue` and Marketing’s complete communication snapshot.
- Existing `GET/PATCH /api/admin/clients/[id]`, `useAppointmentActions`, `AppointmentQuickEditSheet`, `CheckoutSheet`, and `NewAppointmentModal`.
- Appointment/service snapshot fields, immutable appointment audit rows, payment rows, communication ledger, photos, and reviews.
- Existing Reviews, Rewards, Marketing, and Analytics destinations via deep links rather than cloned management UI.

Do not silently merge the two preference models. Initially:

- `salon_client` remains the owner-editable source for notes, sensitivities, nail preferences, tags, preferred technician, and rebook interval.
- `client_preferences` may be shown as additional read-only client/style preferences.
- Dual writes and migration to one canonical model are deferred until conflict and ownership rules are approved.

## 10. Risks and controls

| Risk | Control |
|---|---|
| Changed totals undermine trust | Lock metric fixtures and provenance before UI; show explicit legacy/unresolved metadata. |
| Revenue is confused with cash or profit | Fixed terminology, separate cash/tax/tips/outstanding, explanatory copy and tests. |
| DST/week/month drift | One injected `now`, salon timezone, half-open bounds, Monday-start and boundary matrix tests. |
| Deleted/comp/wrong-status leakage | One shared eligibility predicate and exclusion-matrix integration tests. |
| Insights counts differ from filtered lists/Marketing | One segment registry and one retention snapshot with real communications. |
| Large salons exceed current in-memory caps | Remove semantic limits, keep pagination, inspect query plans and latency before proposing indexes. |
| Legacy identity is phone-based | Prefer `salonClientId`, normalize/dedupe fallback, report unresolved identity coverage. |
| Timeline leaks PII/tokens | Admin tenancy on every join, sanitized messages, minimal payment metadata, bounded cursor pagination. |
| Profile refactor breaks appointment workflows | Reuse existing action hooks/sheets and retain current regression suites before layout work. |
| Financial access or cache leakage | Require authorized salon membership/impersonation for the core summary, force dynamic evaluation, send private no-store headers, and keep advanced Analytics entitlement-gated. |
| Dirty worktree causes accidental scope expansion | Small file-scoped commits; inspect diffs before every commit; never reset unrelated changes. |

## 11. Phased implementation

### Phase 0 — Plan

- Approve this metric, IA, source, responsive, and delivery contract.
- No production code, schema, or data changes.

### Phase 1 — Correctness foundation

- Implement shared salon-timezone ranges, Monday weeks, equal-elapsed comparisons, currency, eligibility, revenue provenance, cash, and balance projections.
- Correct soft-deleted/status leakage in the reporting paths touched by this phase.
- Preserve the existing Analytics API fields while adding explicit reporting metadata.
- Add pure and PGlite financial contract tests before any new UI.
- Do not redesign Client Hub, Client Insights, client profiles, or unrelated Analytics UI in this phase.

### Phase 2 — Owner Today cards

- Preserve the additive Analytics response for compatibility, but load the eight core Owner Today figures through the independent private financial-summary endpoint.
- Render explicit loading, retryable error, last-good, all-eight-zero empty, estimated-history, and incomplete-history states.
- Do not request advanced Analytics until its entitled UI is opened.
- Verify mutation-driven refresh.

### Mandatory gate before CRM UI

- Targeted new tests.
- Full Vitest suite, including PGlite migration-backed integration tests.
- Typecheck, lint, and production build.
- Authenticated browser smoke at mobile and desktop widths.
- No migration or production-data mutation.

### Phase 3 — Client Insights

- Change copy to Clients | Client Insights.
- Replace passive Hub Overview/Reports with client-health Overview, actionable Follow-ups, and clickable Segments.
- Implement the shared Client Insights segment registry/snapshot and make Marketing/Insights counts use real communication suppression.
- Remove the Hub’s silent 5,000/10,000 semantic count caps while retaining paginated list output.
- Extend the Clients API with validated segment filtering.
- Lazy-load non-overview data and preserve navigation state.

### Phase 4 — Responsive client workspace

- Extract the current monolithic client detail.
- Deliver the six desktop sections and three mobile tabs.
- Add honest rewards summary/link and constrained Book again.
- Preserve all existing appointment, checkout, flag, note, and photo workflows.

### Phase 5 — Activity and financial detail

- Add cursor-paginated Timeline v1.
- Add the Payments section with finalized/legacy provenance, tax/tips, recorded payments, and completed outstanding.
- Add browser accessibility/responsive regression coverage and final performance review.

## 12. Deferred features

- True net profit, expenses, COGS/supply usage, card fees, rent, complete hourly/salary payroll, and P&L.
- Refund recording/net cash and deposit requirements/due balances.
- Birthday, acquisition source, marketing-consent, custom-field, and custom lifecycle-stage segments.
- Preference-model merge/dual-write migration.
- Historical note revisions; current notes have no immutable event source.
- Manual add-client workflow and duplicate-client merge.
- Bulk messaging, delivery claims, click tracking, or marketing email automation.
- Cohort retention/LTV forecasting, attribution, exports, and custom report builder.
- New indexes until production-like query plans and latency show a concrete need.

## 13. Delivery strategy and definition of done

- Deliver narrow, reviewable phases; backend contracts land before their consumers.
- Prefer additive response fields and compatibility adapters before removing old Hub fields.
- Do not create a new navigation destination or duplicate Analytics/Marketing/Rewards/Reviews management.
- Keep all SQL tenant-scoped and all list/detail/activity routes authorized from server-derived salon identity.
- Use fixed clocks and deterministic timezone fixtures in tests.
- Document every changed metric label and range in release notes.
- A phase is done only when its behavior is source-backed, its empty/error/unavailable states are truthful, full required gates pass, and unrelated dirty-worktree changes remain untouched.
