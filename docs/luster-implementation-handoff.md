# Luster Implementation Handoff — Audit Baseline & Phased Plan

> Produced by the Phase-0 audit session (2026-07-18). Read this before touching anything.
> Audit method: 11 read-only domain audits + adversarial verification (213 status claims, 2 corrected) + plan synthesis.

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

1. **Local vitest hits the real shared prod Neon DB.** `.env.local`/`.env.development` contain a live `DATABASE_URL`; `vitest.config.mts:20` loads all env (`loadEnv('', cwd, '')`); setup never clears it → `DB.ts` picks the real Pool, not PGlite. Until fixed (Phase 0): run tests with `DATABASE_URL=` blank.
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
