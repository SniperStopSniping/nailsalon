# Luster Implementation Handoff — Audit Baseline & Phased Plan

> Produced by the Phase-0 audit session (2026-07-18). Read this before touching anything.
> Audit method: 11 read-only domain audits + adversarial verification (213 status claims, 2 corrected) + plan synthesis.

## Phases 3–4 production readiness — VERIFIED (2026-07-19 07:35 EDT)

**Database and migration state:** migration `0058_checkout_payments_tax` is already applied to, and recorded exactly once in, the intended shared Neon database. A read-only PostgreSQL-catalog audit verified every object introduced by 0058: all 14 additive nullable `appointment` columns; the `appointment_final_item`, `appointment_payment`, and `appointment_payment_link` tables; their expected column types, nullability, and safe defaults; all five indexes (including the unique payment-link token index); primary keys; eight foreign keys with the expected delete actions; and all six named CHECK constraints. No migration was executed during this readiness pass.

**0059 is absent:** the repository contains no 0059 migration file, snapshot, journal entry, untracked migration artifact, or text reference under the migration directories. The journal ends at idx 58 / `0058_checkout_payments_tax`. The shared database migration history contains the exact 0058 record and no record newer than the journal's 0058 timestamp.

**Production connection and deployment:** Vercel Production `DATABASE_URL` was refreshed from the intended Neon pooled connection, preserving Production scope and the variable name. Production was redeployed after that refresh. The latest Production deployment reports `READY`; its public `/api/health` endpoint returns HTTP 200 / `status: ok`, with the database and required Clerk/password-auth, Redis, Resend, and Google Calendar checks passing. Read-only browser smoke checks confirmed the public landing page and owner sign-in route render without application-error markers. No customer data was created, edited, or deleted.

**Validation:** full Vitest suite **979/979 passing across 204 files**, with `DATABASE_URL` removed and the repository's fail-closed Vitest guard forcing isolated in-memory PGlite; typecheck clean (`tsc --noEmit`); full lint clean (`eslint .`); production build clean (`DATABASE_URL` forced empty; final Next.js build artifact produced). No automated test or build connected to Neon.

**Readiness status:** Phase 3 and Phase 4 are **ready to deploy**. They are **not yet ready to use in Production** because the currently healthy Production deployment commit predates both phase commits. Remaining deployment step: deploy the approved branch/commit containing Phase 3 (`7d214f3`) and Phase 4 (`7fc2035`), then repeat non-mutating health and UI smoke checks. Limitation: no state-changing Production workflow or real-customer checkout was exercised, by design.

## Foreign migration 0059 — REMOVED (2026-07-19 cleanup session)

**What happened:** untracked `migrations/0059_outstanding_nighthawk.sql` (1,386 lines) + `migrations/meta/0059_snapshot.json` and an uncommitted idx-59 `_journal.json` entry appeared mid-Phase-3, not created by the Claude session (consistent with the concurrent codex agent running `drizzle-kit generate`; drizzle meta snapshots stop at 0009, so `generate` emits a full-schema dump).

**Why it was unsafe:** it re-created the entire schema — 43 `CREATE TABLE` statements and **10 `CREATE TYPE` statements with no `IF NOT EXISTS`**, which would fail immediately against the shared prod DB (all 10 enums already exist) and abort a `db:migrate` run mid-stream; it also contained `DROP INDEX IF EXISTS "unique_client_salon_prefs"`, which would have silently dropped a live index. It was fully redundant with committed history (it even re-created the 0058 objects).

**Cleanup (all three pieces were uncommitted, so removal changed no tracked history):** deleted `migrations/0059_outstanding_nighthawk.sql` and `migrations/meta/0059_snapshot.json`; restored `migrations/meta/_journal.json` to its committed state (ends at idx 58, `0058_checkout_payments_tax`). Repo-wide scan confirms zero remaining 0059 references. **0058 was inspected and left untouched** — additive-only (23 `IF NOT EXISTS` adds, zero DROP/ALTER-COLUMN/DELETE), valid, and required by Phase 3 code. It has since been applied and verified on the intended shared Neon database; see the production-readiness section above.

**Verified after removal:** migration-dependent PGlite integration suites (checkout, pay-page, client-stats, booking-conflict-guard, DB isolation — 29/29, each applying the full `migrations/` folder), Phase 3 unit/component suites (108/108 across 15 files), typecheck clean.

**Standing rule:** never run `drizzle-kit generate` in this repo until the meta snapshots are rebuilt — hand-write migrations (0056–0058 precedent).

## Phase 5 — Client Hub core — COMPLETE (2026-07-19, commit `6f42e62`)

**Shipped:** Clients app gains a compact **Clients | Client Hub** toggle (no new nav destination, per the approved IA). Hub areas: **Overview / Follow-ups / Segments / Reports** (`ClientHubPanel.tsx` + admin-only `GET /api/admin/client-hub`).

**Permissions:** route guarded by `requireAdminSalon` (salon isolation integration-tested, 403 cross-tenant); the Hub renders only inside the admin Clients modal, so staff surfaces never see it; financial figures (revenue/outstanding) only travel through this admin route.

**Reporting calculations:** revenue = `revenueCentsSql()` over completed rows (net of tax, comp = 0, legacy fallback to booked total); discounts = `COALESCE(final_discount, discount_amount)`; tax collected, tips, amount paid reported separately — **tax never counted as revenue or spending**; outstanding = `final+tax+tip−amount_paid` only where a checkout recorded payments (legacy rows honestly excluded); rates = real counts over finished appointments, null → "Not enough data yet"; due/overdue reuse `buildRetentionQueue` (ONE follow-up definition with Marketing/Today); Follow-ups tab renders the same `/api/admin/marketing` groups. Segments computed only from persisted data — birthday/source segments absent (no fields).

**Tests:** suite 979 → **982** (205 files): `client-hub/route.integration.test.ts` (PGlite — finalized-value metrics incl. tax/tips exclusion + outstanding math + no-show/cancellation rates, honest segments + shared-engine overdue + no fabricated segments, tenancy 403); existing ClientsModal suite (11) passes with the toggle. Typecheck/lint/build clean. Browser pass deferred alongside Phase 4's.

**Deferred (rest of approved P5):** per-client Activity timeline (real audit events), profile field additions needing schema (tags beyond adminFlags, source, birthday, custom fields, products used), manual add-client route, shared phone-variant helper unification, and the profile-header quick-action rework — next session.

## Phase 4 — COMPLETE (2026-07-19, commit `7fc2035` on `feat/more-workspace-integrations`)

**Shipped: Marketing + assisted manual messaging.** `MarketingModal` rebuilt from a bare "Retention" settings editor into **Home / Follow-ups / Campaigns / Results / Reviews** (schema: none; no Automations section because nothing new sends automatically).

**Messaging modes (unchanged core rule):** manual native-SMS remains the only marketing channel — Luster identifies the client, the tech taps **Review and text**, an editable preview opens (friendly insertion chips: first name / salon name / booking link / offer / expiry — always resolved values, never raw `{placeholders}`), the native Messages app opens prefilled, and the tech sends manually. Opening is recorded ONLY as `prepared`; an explicit "Did you send?" records `marked_sent`/`not_sent`. Desktop fallback: copy-phone/copy-message. Automatic texting status comes from the shared resolver (`src/libs/textingStatus.ts`, extracted from IntegrationsModal — behavior identical, now hardened against malformed health payloads); Ready still requires provisioned number AND enabled module. Marketing email remains "Not available yet" with no toggle; transactional email untouched.

**Follow-ups:** `GET /api/admin/marketing` reuses `buildRetentionQueue`/`buildAppointmentReminderQueue` (ONE computation path with Today workspace; future-booking exclusions preserved), enriched with last completed service (junction snapshot) and transactional-SMS consent visibility (display-only). Groups: Due to return / Win-back stage 1 (42d) / Win-back stage 2 (56d) / Reminders due. Unsupported cohorts (birthday — no DOB field; cancelled-not-rebooked; new-client-no-second; fill-an-opening = Smart Fit) deliberately omitted. Row actions: Review and text, Snooze 7d, Dismiss, Open client (new `onOpenMarketingClient` threading via AdminModalHost). Win-back texting for an unconfigured offer routes to Campaigns.

**Campaigns:** six/eight-week promos presented as a staged **Win-back sequence** ("after 42 days" / "after 56 days if the client still has not booked") — purely presentational; identical `RetentionSettings` persistence (enabled/timing/discounts/expiry/codes/eligible services/templates/single-use preserved; PromotionEditor + validation + PATCH unchanged; `initialPromotionStage` deep-link still lands/highlights). Promotion interpolation extracted to `src/libs/promotionMessage.ts` (shared with ClientCommunicationActions — no drift).

**Data usage / Results (measurable only):** manual ledger counts (Opened for sending = prepared / Marked sent / Not sent / Booking linked = converted, 30d), win-back campaigns per stage (minted, redeemed, discounts given, completed visits, **finalized revenue via `revenueCentsSql()` with tax reported separately and labeled "not revenue"**), automatic `notification_delivery` counts labeled as appointment messages, not marketing. Link clicks and manual delivery are not tracked and are absent by design. Reviews view keeps the Google-link config + honest copy (no sent/posted claims); directions live only in Settings → Locations.

**Tests:** suite 965 → **979 passing** (204 files); typecheck/lint/build clean. New: `textingStatus.test.ts` (Ready-requires-both ladder, malformed-payload safety), `marketing/route.integration.test.ts` (PGlite: live-engine grouping + future-booking exclusion + consent/last-service enrichment; finalized-revenue/tax separation off a redeemed campaign; server-side tenancy 403), `MarketingModal.test.tsx` rewritten (12 tests: home honesty incl. no-email-toggle, follow-up row fields, prepared-not-sent contract with edited-body sms: URL, desktop copy fallback, unconfigured-offer routing, results honesty incl. no click metrics, staged-sequence save-shape preservation, promo deep-link focus, 8w≥6w validation, reviews honesty + no parking duplicate). IntegrationsModal/ClientCommunicationActions suites pass unchanged (refactors behavior-neutral). The production-readiness pass above subsequently repeated the full isolated suite and completed non-mutating Production browser/health smoke checks.

**Deferred:** appointment-change composer template; bulk campaign sending (unsupported — not added); birthday/cancelled cohorts (need schema/product decisions); marketing-email delivery.

## Phase 3 (P3a+P3b) — COMPLETE (2026-07-19, commit `7d214f3` on `feat/more-workspace-integrations`)

**Shipped: the Appointment Completion / Checkout / Photos / Tax / Payments phase.** "Mark completed" now opens a dedicated **Complete appointment** checkout flow (`src/components/appointments/CheckoutSheet.tsx`) on every surface — admin bookings/calendar/clients, staff agenda, and the staff canvas (which lost its divergent `CompleteAppointmentSheet`). The vague "No after photo / Go back" dead-end is gone; the in-flow prompt ("Add an after photo? — Save the finished set to the client's history") offers **Add photo** (working uploader) / **Complete without photo**, and the QuickEditSheet Photos card now renders whenever an uploader is wired (first photo reachable).

**Completion architecture.** One completion route (`PATCH /api/appointments/[id]/complete`), reworked: non-strict zod accepts the full checkout payload (`finalItems[]`, `actualStartAt/EndAt` [finish≥start, ≤24h], `discountCents+reason`, `taxExempt+reason` [admin-only], `tipCents`, `payments[]`, `paymentStatusIntent:'comp'` [admin-only], `expectedTotalDueCents`); **a body with none of the new fields behaves exactly as before** (paid, final=booked total — legacy clients unaffected; the old staff-sheet shape incl. `performedServiceIds`+`finalPriceCents` keeps its entered price as money truth). All checkout writes (final items, tax snapshot, payment rows, `amount_paid_cents`, audit rows) happen **inside the CAS transaction** — idempotent replays short-circuit and insert nothing. Server recomputes totals; drift vs `expectedTotalDueCents` → 409 `TOTALS_MISMATCH` with the server breakdown. Photo gate is graded: `salon_policies.require_after_photo_to_finish='required'` (super-admin override wins) hard-blocks ignoring `skipPhotoValidation`; `optional`/`off` keep the historical soft gate. Support routes: `GET /checkout` (context: booked items [immutable snapshot], final items, catalog, resolved tax config, photos, payments+balance, e-Transfer + `LSTR-xxxxxx` reference, coarse permissions), `POST /payments` (partial payments; `FOR UPDATE` + recompute-from-source, never increments; fraud/points fire once on the fully-paid transition), `POST /payments/[id]/void` (admin), `POST /reopen` (admin; keeps snapshots+payments; next completion replaces final items wholesale), `DELETE /photos/[photoId]` (admin or uploading staff; best-effort Cloudinary delete; clears matching artifacts slot).

**Final item model.** New `appointment_final_item` table (kind service|addon|custom, nullable catalog FKs, name/qty/unit price/line total/duration/taxable/sort). The booked `appointment_services`/`appointment_add_on` snapshots are now **immutable** — the destructive `rewritePerformedItems` is deleted; legacy performed-ids are translated into final items instead. Display rule everywhere: `finalItems.length ? finalItems : bookedItems`.

**Tax engine.** One pure pipeline (`src/libs/checkoutTotals.ts`): items → discount (clamped, prorated across taxable/non-taxable by largest remainder) → taxable subtotal → tax (exact integer math, half-up; inclusive mode decomposes `round(gross·r/(10000+r))`) → tip (never taxed) → payments → balance. **Invariants: `finalPriceCents` is ALWAYS net-of-tax post-discount revenue; `totalDue = finalPriceCents + taxAmountCents + tipCents`.** Config in `salon.settings.payments.tax` (`src/libs/taxConfig.ts`): enabled (default **OFF** for every salon, never inferred from address), name, rateBps, pricesIncludeTax, per-type taxable defaults, `scheduledChange{rateBps,effectiveFrom}` resolved at checkout time. Completion freezes a full snapshot onto the appointment (enabled/name/rateBps/inclusive/amount/taxable-subtotal/exempt+reason) — settings changes never recalculate completed rows; historical rows keep NULL (= not recorded). Settings UI: **Settings → Payments & taxes** (new `'payments'` view; explicit-save; single-key `jsonb_set` write so concurrent saves never clobber; the Phase-2 index test's no-tax assertion was updated to "tax appears only via this row").

**Payment states.** `paymentStatus` text values now `pending | partially_paid | paid | comp` (comp = admin-only, requires zero payments, counts 0 revenue). Legacy completions still hard-code 'paid'; checkout-mode derives from recorded payments vs totalDue (zero-due ⇒ paid). Frozen semantics preserved: fraud/points only ever run on completed+paid rows (at completion when fully paid, else at the payment that reaches fully paid); the fraud partial index needs no change. Payment history = `appointment_payment` rows (amount, method incl. new `online`/`gift_card`, reference, note, actor, voided_at) — corrections are voids, never deletes; `amount_paid_cents` is always recomputed from non-voided rows under a row lock.

**e-Transfer (manual-only — honest limits).** `salon.settings.payments.etransfer`: enabled, recipient email/mobile, display name, autodeposit (informational only), instructions, require-reference, QR-page toggle. Checkout shows recipient/amount/reference with copy buttons + QR. Public page `/[locale]/(unauth)/pay/[token]` (served as `/pay/<token>`, localePrefix as-needed) via `appointment_payment_link`: 256-bit opaque token sha256-hashed at rest (`lusterSecurity.createOpaqueToken`), one active link per appointment (re-mint supersedes), auto-revoked on full payment and reopen; page shows salon-side facts only (name, live balance, recipient, reference, instructions) — **no client PII**; salon confirms payments manually; **no bank verification exists or is claimed**. A future Interac Request Money provider slots in as a new payment `method` + confirmation writer without touching checkout.

**Reporting switch.** `revenueCentsSql()` (`src/libs/revenueSql.ts`) = `CASE WHEN comp THEN 0 ELSE COALESCE(final_price_cents, total_price) END`, applied to: admin analytics (revenue/series/leaderboard + new `revenue.taxCollected` reported separately), admin technicians ×3 (+per-tech clients), staff earnings, fraud velocity. Client spending/loyalty (`updateSalonClientStats`) now count **paid-only** at the final price — tax excluded by construction; the loyalty reconcile absorbs the one-time delta (floors at 0, keeps bonuses). Super-admin export gains final/tip/status/method/amount-paid/tax columns. Hardcoded-USD formatters (admin dashboard, ClientsModal, ServicesModal) replaced with `formatMoney` (CAD default). Rewards pending-points preview intentionally stays on booked totals (pre-completion rows).

**Schema/migrations.** Hand-written `migrations/0058_checkout_payments_tax.sql` (+ journal entry; **do NOT run `drizzle-kit generate`** — meta snapshots end at 0009, see the 0059 warning above). Additive-nullable only: 14 appointment columns (actual times, tax snapshot ×8, final subtotal/discount/reason, amount_paid) + `appointment_final_item`, `appointment_payment`, `appointment_payment_link` (CHECK constraints; PGlite-safe). **Already applied and catalog-verified on the intended shared Neon database. Do not reapply it.** Old rows: NULL = not recorded; nothing recalculated; existing photos/reports/completions load unchanged (integration-tested).

**Tests.** Suite grew 885 → **965 passing** (202 files); typecheck, changed-scope lint, production build clean. New: `checkoutTotals` (13 incl. rounding table + invariant property test), `taxConfig`, `formatMoney`, complete-route unit (8: graded photo gate, admin-only fields, time validation, comp+payments) + **PGlite integration** (14: atomic full-payload write w/ junctions untouched, idempotent replay inserts nothing, legacy-body exact parity, tax-enabled legacy snapshot, unpaid-skips-fraud, paid-fires-once, performed-ids translation, over-payment 422, TOTALS_MISMATCH 409, comp, partial→paid, void recompute, reopen/re-complete), payments/void/reopen, photo DELETE perms, confirm dual-write (photo-truth fix: presign confirms now also write `appointment_photo`), pay-page integration (PII-free payload, hash-at-rest, cross-token 404, revoke-on-paid, supersede), `SettingsModal.payments` (7), `CheckoutSheet` (11: live totals, custom items, discount, time validation, both photo-prompt modes, partial payment, e-Transfer/QR gating, success/receipt), stats-basis integration (paid-only + reconcile), updated `useAppointmentActions`/`QuickEditSheet`/`ActionBar` tests (assertions strengthened, none weakened). E2e: checkout journey appended to `core.admin-appointment-ops.e2e.ts` (**updated, not executed** — same env constraint as P1; flow browser-verified live at 375×812 on the PGlite dev server end-to-end: Payments & taxes save, checkout with custom item + HST 13% + tip + partial e-Transfer + QR page in a second tab, success, record-remaining-payment → paid, receipt with both payment rows, pay-link auto-revocation).

**Deferred:** receipt email sending ("Complete and send receipt" not offered); draft/save-as-in-progress checkout persistence; multi-rate (GST+PST) tax split; provider payment integrations (Interac Request Money etc. — model is provider-ready, nothing fabricated); staff per-user permission flags (coarse staff/admin split: staff get full checkout on own appointments; tax exempt/comp/void/reopen/photo-removal-of-others = admin-only).

## Phase 2 — COMPLETE (2026-07-18, commit `efbaa39` on `feat/more-workspace-integrations`)

**Shipped: Settings index + focused views, and Settings/Luster separation.** (Database test-isolation fix landed separately as `c9769ab`.)

**Settings restructure** (`SettingsModal.tsx` — every field, validation rule, permission gate, and save action preserved verbatim; only navigation changed):
- Index groups: Business (Locations & directions, Branding & appearance), Booking (Booking rules — with live "15 min · CAD"-style status, Booking flow when not free-solo), Team (Staff & schedules → opens Staff app; Staff visibility, entitlement-gated), Notifications, Features (Modules & programs, entitlement-gated), Integrations (single "Manage integrations" row → Integrations app; no provider setup duplicated), About (Version display-only, Terms/Privacy wired to real pages), profile card → Account view.
- Save models unchanged: explicit-save (Locations, Booking rules, Notifications, new Owner profile) now disable Save while unchanged and keep the 2.5s transient "saved" feedback; autosave toggles (Modules, Programs, Staff visibility, Booking flow) untouched.
- Unsaved-change guard: focused views with unsaved edits warn on Back (Keep editing / Discard). Limitation: the guard covers in-modal Back navigation; closing the whole modal via drag/Escape is not intercepted.
- **Locations is the single directions source**: parking & entry instructions editor moved from Marketing into Settings → Locations (same `PATCH /api/admin/retention/settings` API, saves only `parkingInstructions`); MarketingModal now shows a pointer instead of a duplicate field. Canadian postal codes format readably on edit (`m5v1l7` → `M5V 1L7`, verified live) without rewriting untouched stored values; non-Canadian values never modified. Only fields the backend supports are exposed (name/address/city/state/zip + parking) — unit/entry/accessibility/map-link fields do not exist in the schema and were not fabricated.
- **Account view**: previously inert profile card now edits owner name+email via existing `POST /api/admin/profile` (server validation surfaces inline, incl. 409 email conflicts); billing status display moved here from Programs; **Stripe billing portal wired** (`POST /api/billing/portal`, shown only for `billingMode==='STRIPE'` salons with a salonId); **checkout deliberately NOT wired** — `PricingPlanList` price IDs are unconfigured boilerplate (FIXMEs, placeholder `price_123`), so wiring purchase buttons would fabricate a broken billing capability; Compare Plans stays display-only with contact copy. Deferred until real Stripe prices exist.
- **No Payments & Taxes group** — the instruction's guard applies: zero tax/payment/e-Transfer/deposit/receipt backend exists (see §F); exposing controls waits for Phase 3. Index test asserts no such controls render.

**Luster separation**: page regrouped into Learn (Builder Gel Foundations, Technique Guides) and Shop & wholesale (Shop Builder Gel) — real, env-overridable links only; explicit code comment forbids fabricated rewards/points/certifications/ambassador content; integrations pointer row + legacy `?google=/?twilio=` redirects retained from Phase 1; owner marketing consent unchanged and separate from client consent.

**Files**: `SettingsModal.tsx` (restructure + `formatCanadianPostalCode` + `ParkingInstructionsCard`), `MarketingModal.tsx` (parking removed, section retitled "Reviews"), `AdminModalHost.tsx` + `admin/page.tsx` (pass `salonId`, `onOpenApp`), `admin/luster/page.tsx`. Tests: new `SettingsModal.index.test.tsx` (10 tests: groups, no-payments-controls, integrations hop, terms/privacy links, unsaved guard, parking single-source PATCH shape, profile save, billing gating ×2, postal format ×2) and `luster/page.test.tsx` (3 tests: real content/no integrations/no fabrication, separate owner consent, legacy redirect); notifications/merchandising tests adapted to navigate the index (assertions unweakened); MarketingModal tests assert parking is gone. **Full suite 885/885 green on PGlite; typecheck, lint, production build clean.** Browser-verified at 375×812: index groups, guard flow, disabled-until-dirty saves, live postal formatting, Luster page.

## Phase 1 — COMPLETE (2026-07-18, commit `43714ed` on `feat/more-workspace-integrations`)

**Shipped: More workspace launcher + Integrations app + P0 fast-forward + time-off correctness fix.**
`main` was fast-forwarded to `origin/main` (`54af837`, v1.12.0) first; phase work lives on branch `feat/more-workspace-integrations` (not merged, not pushed).

**Decisions (deltas vs. the original phase brief):**
- The proposed five-app More list (Client Hub/Marketing/Integrations/Luster/Settings) was NOT adopted verbatim, per the approved IA review: the existing gated tiles (Analytics, Reviews, Rewards, Staff, Staff Ops) are preserved, Client Hub is deferred to Phase 5 (ClientsModal enrichment, no tile), and **Integrations is the one new app**. Final grid: Luster, Integrations, Marketing, Settings + the entitlement-gated tiles.
- No Payments row on the Integrations home: no client-payment integration exists (Stripe routes are platform SaaS billing). A footnote states clients pay in person; nothing implies Interac/bank verification.
- Deep-linking implemented as `?app=<id>` on the existing single-page workspace (pushed history entry; browser Back closes the modal) rather than a new route tree — preserves the modal-host architecture.
- Sub-views inside Integrations (Google/Texting/Email) are internal state, not URLs; OAuth callbacks deep-link into the right sub-view via `?app=integrations&google=…|twilio=…`.

**Routes/components changed:** new `src/components/admin/IntegrationsModal.tsx` (+test); `AppGrid.tsx` rebuilt as a 2-column card launcher with descriptions/focus/pressed states (+new test); `AdminModalHost.tsx` routes the `integrations` app; `admin/page.tsx` gained URL↔modal sync (`URL_APP_IDS`, `urlBlockedAppIds` role gating, `openAppViaUrl`) and its Today-workspace "Setup & integrations" button now opens the Integrations app; `admin/luster/page.tsx` slimmed to education/resources/consent with safe redirects for legacy `?google=`/`?twilio=` params; Google/Twilio OAuth callback routes redirect to `/en/admin?app=integrations&…`; `admin/time-off-requests/[id]/route.ts` approval now transactionally + idempotently inserts `technician_time_off`.

**Behaviours preserved:** bottom nav untouched; all existing tiles + `hiddenAppIds` entitlement gating (now memoized, same rules); tab-opened modals (Clients/Services/Calendar) unchanged and not URL-synced; Google connect/calendar-selection/save API contracts unchanged (UI ported verbatim from the Luster page); Twilio provisioning flow ported unchanged; manual texting described honestly (no Twilio required, no delivery confirmation, "Manual ready" — never "disconnected"); automatic texting only "Ready" when a number is provisioned AND the smsReminders module is enabled; marketing email shown "Not available yet" with no toggle; real badges only.

**Tests:** 189 unit files / 869 tests pass (run with `DATABASE_URL=` blank → PGlite); typecheck clean; lint clean (one pre-existing react-refresh warning class); production build succeeds. New: `AppGrid.test.tsx`, `IntegrationsModal.test.tsx` (status matrix incl. manual-without-Twilio and automatic-not-ready cases), integrations case in `AdminModalHost.test.tsx`, approval/denial/idempotency cases in the time-off route test. E2e `core.owner-mobile-workspace.e2e.ts` extended (tile visible → open → URL asserted → `goBack` closes); **the Playwright spec was updated but not executed** (needs a running prod server + super-admin auth env) — the same flow was verified manually in a live browser at 375×812 against the PGlite dev server, including deep-link load, callback-notice view, and Back-button close (one real bug found & fixed there: a ref was cleared before its lazy state updater ran, so Back didn't close the modal).

**Deferred/limitations:** Google disconnect is wired with confirm (was an orphaned route); AppModal's closed sheet can briefly linger off-screen in dev (StrictMode/AnimatePresence quirk — e2e asserts viewport exit, not DOM removal); manual-texting device support is a user-agent heuristic (phones/tablets = Ready, desktop = "Unsupported on this device"); the `?twilio=authorized` legacy param is honored via redirect but provisioning UI keys off connection status `pending` (which the callback always writes); vitest→prod-DB hazard NOT yet fixed in config (open question #2 still pending — tests must keep running with `DATABASE_URL=` blank); Settings/Luster deep separation is Phase 2.

## Repo state at audit time

- Branch `main` @ `6fe2e8a`, clean tree, **19 commits behind `origin/main` (`a5c6fbb`, v1.11.0)** — fast-forward before any work.
- Upstream delta (audited in full): service library / starter menu / template onboarding, three-pill booking categories (migrations **0056/0057**, `service.bookingCategory/templateKey/featuredOrder`, `add_on.templateKey`), public-availability repair (`getPublicBookableServiceIds` assignment filtering), Google-event conversion fixes (soft-gate bypass, overlap-block removal, idempotency-lock release via `DEL_IF_OWNER_LUA`), merchandising settings (`salon.settings.merchandising`, jsonb_set concurrency-safe PATCH).
- Stash `stash@{0}` "Build fix: adminAuth import type syntax" = behavior-free refactor of `src/libs/adminAuth.ts`. Leave it.
- Concurrent agents are active: many `codex/*` branches, Cursor worktrees, `/private/tmp/luster-publish` (codex), `.claude/worktrees/pr1-booking`. Verify git state before edits; stage explicitly; **never `git add -A`**.

## ⚠️ Critical hazards

1. **RESOLVED (commit `c9769ab`) — vitest can no longer reach a real database.** The risk was real: `vitest.config.mts` loaded `DATABASE_URL` from `.env.local`/`.env.development` into every worker, and CI's test job injects it from secrets, so `DB.ts` selected a real `pg` Pool. Now three independent layers force PGlite for all Vitest runs: the config strips `DATABASE_URL` from loaded `.env` files, `vitest-setup.ts` deletes shell/CI-inherited values, and `DB.ts` throws (never connects) if a URL still reaches it under `process.env.VITEST`. `src/libs/DB.testIsolation.test.ts` pins the contract. Verified: full suite (190 files / 872 tests) passes by default with the real `.env.local` in place, and with a fake shell-exported `DATABASE_URL`. Local dev, production runtime, drizzle CLI migrations, and CI's e2e server (which legitimately uses the job-level `DATABASE_URL`) are untouched. Remaining limitation: Playwright e2e intentionally runs against a live server whose database is the environment's choice — that is out of scope for unit-test isolation; typecheck and `next build` create no DB clients (no static page imports `DB.ts`).
2. **Dev and prod share one Neon database.** Every migration/seed/backfill script is a production operation. All `db:*` scripts target real data.
3. **Migrations 0056/0057 (upstream)**: code assumes they are applied to the shared DB — confirm before authoring 0058.

## Architecture map (condensed)

- Next.js App Router + Drizzle (Neon PG; PGlite only when `DATABASE_URL` empty) + Clerk. 140 API routes, **no server actions**. Live routes are the `[locale]` tree.
- **Owner** = single-page workspace `src/app/[locale]/admin/page.tsx`; bottom nav `OwnerWorkspaceNav` (Today/Calendar/Clients/Services/More); More = `AppGrid` tiles → fullscreen modals via `AdminModalHost` (Luster tile routes to `/admin/luster`). Tiles gated by `salon.features` entitlements (`hiddenAppIds`).
- **Staff** = multi-route `[locale]/(auth)/staff/*` + `StaffBottomNav` (Home/Photos/Schedule/Earnings). Staff auth rides `LEGACY_OTP_AUTH_ENABLED` (410 when off — possibly dormant in prod).
- **Super-admin** = server-gated org table + `SalonFeatureAccessManager` (writes `salon.features`).
- **Public** = booking funnel `(unauth)/book/*` + `[locale]/[slug]/*` tenant pages.
- **DB**: 53 tables/9 enums in `src/models/Schema.ts` (+0056/0057 upstream). Two photo tables (`appointment_photo`, `appointment_artifacts`), two status columns on appointment (`status` + `canvasState`), snapshot junctions for services/add-ons, discount snapshot columns, retention tables (0055), Google Calendar ×4, `integration_outbox`, `notification_delivery`, `communication_consent`, sessions ×3, audit logs ×3, `fraud_signal`.
- **Crons** (`vercel.json`, `CRON_SECRET`): `/api/reminders/process` (15m), `/api/integrations/outbox/process` (5m — Google outbound **and** inbound). `/api/autopost/process` exists, unscheduled.
- **Auth guards**: `requireActiveAdminSalon`/`requireAdminSalon` (admin, salonId never from client), `requireStaffSession`+`staffApiGuards` (salon-scoped), client sessions phone-only (platform-wide by design; scope per-salon in queries), `requireSuperAdmin` on all 21 super-admin routes. Admin *pages* are client-side gated; security lives at the API layer.

## Working behaviours — preserve exactly

- Manual native-SMS composer: `clientSmsComposer.ts` (`buildNativeSmsUrl` :294-307, iOS `&body=`/other `?body=`; 7 editable templates) + `ClientCommunicationActions` "Did you send?" loop → `client_communication` status machine (one-active-retention-stage constraint). **Works with zero Twilio env; never auto-send; never convert manual→automatic.**
- Retention/win-back: live-computed queues (no cron) in `retentionAssistant`; campaign tokens sha256-hashed, single-use, FOR-UPDATE redemption in booking write; suppression via communication history.
- Booking write: Redis idempotency lock (+ upstream failure-release), advisory-lock transaction (`bookingConflictGuard`), 0054 unique+EXCLUDE constraints, 120-min hardcoded min notice.
- Completion: CAS idempotent write (`WHERE status IN ('confirmed','in_progress') AND completed_at IS NULL`); `paymentStatus='paid'` hard-coded (fraud index + first-visit eligibility depend on it — **freeze semantics**).
- Google Calendar: per-salon OAuth (encrypted refresh token), outbox push w/ 8-retry backoff + owner-email on failure, polled inbound + review queue + conversion, Luster-wins conflicts.
- Discount chain: first-visit 25% / rewards / retention campaigns → snapshot columns (`discountType/discountAmountCents/discountPercent/discountLabel/subtotalBeforeDiscountCents`). Smart Fit must reuse these (new `discountType` value), never a parallel system.
- Feature gating 3-layer model (`featureGating.ts`: entitlement ∧ module-enable ∧ visibility); audit logs (PII-redacting); fraud signals (non-blocking); staff visibility redaction (`getEffectiveVisibility`); `salon_client` existence gate on phone-keyed staff routes (fixed a real cross-tenant leak — replicate the pattern).

## Capability matrices

### Appointment completion (§C)

| Capability | Status |
|---|---|
| Final services/add-ons at checkout | Partially working — staff `CompleteAppointmentSheet` only; totals not recomputed |
| Custom line items | Not implemented (free-form `finalPriceCents` override only) |
| Actual start time | Partially working (`startedAt` only if Start invoked) |
| Actual finish time | Working (`completedAt`) |
| Actual duration | Not implemented (derivable only) |
| Final price | Partially working — captured, **never read by reporting** (reports use `totalPrice`) |
| Discounts | Working (booking-time; snapshotted) |
| Tips | Working (capture → analytics + earnings) |
| Payment status | Partially working (binary `pending|paid`, hard-coded paid) |
| Payment method | Partially working (manual record incl. `e_transfer`; never aggregated) |
| Partial payment / outstanding balance | Not implemented |
| e-Transfer instructions / QR pages | Not implemented |
| Tax configuration / snapshots | **Not implemented — zero tax code anywhere** |
| Historical receipt snapshots | Partially working (price/name/discount snapshots; no tax, no receipt view) |
| Deposits | Not implemented (dead JSONB shells; UI "Coming soon") |

Key defects: three divergent completion UIs (staff sheet full-form + always `skipPhotoValidation`; agenda sends `{paymentStatus:'paid'}` only; canvas empty body); dead `/transition {to:'complete'}` branch skips all money/points/fraud/review side effects; points/fraud use booked `totalPrice` (`complete/route.ts:495`); generic `PATCH /[id]` doesn't sync `canvasState` (client-cancel path); **two disconnected photo systems** — staff-home PhotoModal writes `appointment_artifacts` while every display reads `appointment_photo`, and QuickEditSheet upload buttons render only when a photo already exists (first photo unreachable via UI).

### Messaging (§D)

| Capability | Status |
|---|---|
| Manual native SMS composer | Working |
| Automatic Twilio SMS (confirm/remind/cancel/notices) | Working (entitlement + consent gated; free-solo w/o Connect number silently no-ops) |
| Manual email composer | Not implemented |
| Booking confirmation email | Working (Resend, deduped, outbox-retried) |
| Reminder email (day-before/same-day) | Working (cron; independent of SMS entitlement) |
| Appointment-change email (client) | Not implemented (SMS-only) |
| Cancellation email (client) | Not implemented (owner/tech get one) |
| Owner/staff email alerts | Working (channel-configurable; owner default off, tech default SMS) |
| Marketing email | Not implemented (consent captured, no send path) |
| Review-request / Rebooking / Win-back messages | Working — **manual composer only** |

OTP (Twilio Verify): Present but unused — 410 unless `LEGACY_OTP_AUTH_ENABLED='true'`; Clerk is primary auth.

### Integrations (§E)

| Integration | State |
|---|---|
| Google Calendar | Working, per-salon two-way; gaps: disconnect route has no UI, polling only, dead drafts table (0049), `googleCalendar` flag unenforced |
| Twilio | Working (Connect provisioning, signature-verified webhooks); legacy sender path env-dependent |
| Resend | Working, transactional only, optional env |
| Stripe | SaaS billing for owners only; checkout/portal routes have **zero UI callers**; no client payments |
| Square / Interac / online client payments | Not implemented |
| Cloudinary | Working (server upload + signed direct upload); assets never deleted (orphans) |
| Meta autopost | Present but unscheduled worker; `META_*` env undeclared in Env.ts |
| Redis | Working, fail-closed (locks, rate limits, idempotency) |
| Sentry / Logtail / Checkly | Working (Checkly hard-codes `islanailsalon.com`) |

### Tax & payments (§F)

No tax subsystem, no payments/receipts/deposits tables, no partial payments/refunds/balances. Money = integer cents on `appointment`. Revenue reports sum `totalPrice` not `finalPriceCents`; admin dashboard hardcodes USD vs booking CAD. **Extend, don't duplicate:** tax config → `salon.settings` JSONB; snapshots → nullable appointment columns; e-Transfer → instruction text only (enum value exists); receipts → render from existing snapshots.

## IA decision (§G)

Proposed More = {Client Hub, Marketing, Integrations, Luster, Settings} is rejected as written (would delete 5 working gated tiles). Approved shape: bottom nav unchanged; More = existing grid **+ one Integrations tile/modal** (move Google/Twilio setup out of `/admin/luster`; update OAuth callback redirect; wire orphaned disconnect route); Client Hub = enrich `ClientsModal` in place; Marketing = rename/expand existing modal (currently titled "Retention"); Luster route slimmed to brand/education/upgrade/consent; Settings improved in place (wire inert ProfileCard/About rows + upgrade CTA).

## Phases (approved)

- **P0 — Fast-forward & safety:** ff-merge to `a5c6fbb`; confirm 0056/0057 applied; force vitest onto PGlite (clear `DATABASE_URL` in test setup); green baseline. *Line numbers in this doc shift after P0 — re-locate anchors.*
- **P1 — More + Integrations:** Integrations tile + `IntegrationsModal` (connect/status/calendars/disconnect, Twilio status, `integrationHealth`); move out of `/admin/luster`; fix OAuth callback redirect (keep `?google=` handling in both for one release); **time-off approval fix** — approval must insert `technician_time_off` transactionally (today approved requests never block availability). Schema: none.
- **P2 — Settings/Luster separation:** wire ProfileCard, About rows, upgrade CTA (`/api/billing/checkout|portal`, STRIPE-mode only); Luster = brand only. Schema: none.
- **P3a — One completion flow + one photo truth:** shared checkout sheet for all surfaces; block `/transition to:complete` (409); sync canvasState in generic PATCH; photo confirm route dual-writes `appointment_photo`; fix QuickEditSheet chicken-and-egg. Preserve CAS, skip hatch, policy gates, autopost, review prompt, outbox enqueues. Schema: none. Add missing `photos/confirm` route test + first photo e2e.
- **P3b — Money/tax/e-Transfer/reporting:** tax config in `salon.settings` JSONB (enabled, bps rate, inclusive/exclusive, label); migration 0058: `appointment` + `tax_rate_bps_snapshot`, `tax_cents`, `amount_paid_cents` (nullable = "not recorded" on historical rows); checkout subtotal→tax→tip→total + e-Transfer instruction text (display only); reporting/points/fraud on `COALESCE(final_price_cents, total_price)`; currency fix; minimal snapshot-rendered receipt.
- **P4 — Marketing + assisted manual messaging:** honest umbrella modal; outreach history view; new manual composer template(s) (e.g. appointment-change notice); zero new auto-sends; first retention/composer e2e. Schema: none.
- **P5 — Client Hub in ClientsModal:** communication timeline (admin-only/redacted), retention badges, manual add-client (`POST /api/admin/clients` → `createSalonClient`), shared phone-variant helper (stats writer uses 5 variants; staff route 3; per-tech spend raw — unify). Schema: none.
- **P6 — Smart Fit planning (doc only):** precedence slot in `resolveAutomaticBookingDiscount`; reuse discount snapshot columns (`discountType='smart_fit'`).
- **P7 — Smart Fit implementation:** per spec; server-side re-validation at booking write; precedence matrix tests.
- **P8 — Independent final audit:** re-run 11-domain methodology; full suites; iOS composer device pass; confirm vitest still can't reach the real DB.

## Deferred / rejected

Deferred: partial payments (reserve `amount_paid_cents` only), add-on CRUD UI, breaks UI (`technician_blocked_slot` is read by availability but nothing ever inserts rows), configurable min-notice / max-advance window, legacy multi-service buffer gap. Rejected this cycle: deposits, marketing email, auto-send of retention/win-back, desktop sidebar/nav rebuild, Client Hub as a nav destination.

## Key risks (full detail in plan file)

Shared prod DB (additive nullable migrations only) · history compatibility (never recompute old rows; NULL = not recorded) · messaging consent (no sends outside `sendSMS`; composer must work Twilio-free) · Google sync (don't break callback redirect or drop outbox enqueues; re-read `appointments/route.ts` post-P0) · permissions (server-derived salonId everywhere; visibility redaction on staff surfaces) · frozen semantics (`totalPrice`, `paymentStatus='paid'`) · availability engine untouched P1–P5 · races (idempotency lock, CAS, 0054, presign replay; photo dual-write idempotent) · mobile nav e2e guardrail (`core.owner-mobile-workspace`, testids `owner-nav-*`/`admin-app-tile-*`).

## Open questions (need answers from the owner/environment)

1. Are 0056/0057 applied to the shared prod DB?
2. Is the real `DATABASE_URL` in `.env.local` intentional?
3. Tax regime: combined rate vs GST+PST; inclusive vs exclusive default; label.
4. e-Transfer instructions: checkout only, or also in confirmation email?
5. Count of `appointment_artifacts` rows without `appointment_photo` counterparts (backfill needed?).
6. Is `LEGACY_OTP_AUTH_ENABLED` set in prod? (Staff surface dormant if not.)
7. Which Twilio sender is live (Connect vs legacy)? Is Resend configured?
8. Confirm keeping Analytics/Reviews/Rewards/Staff/Staff Ops tiles in More.
