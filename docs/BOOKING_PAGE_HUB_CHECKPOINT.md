# Booking Page hub checkpoint

Branch: `codex/booking-page-hub`. Base: protected main `044e8c3`.
Worktree: `/Users/me/nailsalon-worktrees/booking-page-hub` (the 2026-09-05 continuation below was produced in a remote session on the same branch history; the original workspace was not touched).

## Working first stage

- Authenticated `/admin/website?salon=…` hub, with tenant authorization before setup lookup.
- Explicit publication/draft status, canonical draft Preview, live link/copy, publish destination.
- Six focused destinations; independent existing site/menu/style/palette fields, no service mutations.
- Shared Services/Portfolio links; separate customer policy and operational settings destinations.
- More puts Booking Page first, reliable icon colour fallback, Time-off requests naming.
- Settings adds a Website layout & colours shortcut, and saved-preview management returns to the hub. The legacy Branding entry stays available because it also owns booking-message controls; removing it caused CI regressions and was corrected.
- Existing long editor stays available for compatibility; focused links remove its large static preview and unrelated controls.
- Existing draft-only guided setup restrictions remain enforced. Published snapshots must NOT simply be unlocked.

## Remaining before calling the entire approved plan complete

- Your Information now groups existing visibility into identity/location/contact/hours accordions plus other public content. Complete current-value editing and upload controls still need connecting; existing settings destinations remain available.
- Published sites now have a guided sequence through the focused current-data editors, not the historic onboarding snapshot. Navigation waits for field saves and stays put on failure. The old onboarding snapshot remains draft-only; complete business-value editing is still pending.
- Existing policy editor is linked; full structured onboarding policy editing needs parity verification.
- Add translated copy for new hub/editor labels, richer owner-data selector previews, and complete mobile browser/save/publish regression coverage. `tests/e2e/booking-page-hub.e2e.ts` now covers authenticated hub → appearance → hub → contact at four widths; it has not yet run in the disposable full-app environment.
- Run repository gates, verify immutable hosted Preview, and only then consider protected-main release. Do not present this checkpoint as production deployed.

## Checks

- Focused hub/navigation/visibility/appearance run: **8 files, 88 tests passed**. Changed-source `npm run test`: **8 files, 87 tests passed** (overlapping coverage; do not add the totals).
- `npm run check-types` passed using the repository-approved CI provider placeholders and explicit test runtime; no real credentials or database were used.
- `npm run lint`: zero errors, three existing fast-refresh warnings.
- Initial CI `33937019795` passed both builds but failed ten Settings index cases because the Branding entry had been redirected. Restored the existing entry and added a separate website shortcut. **All 28 Settings index tests now pass**, plus the visibility/route checks (35 tests in that rerun). Final CI rerun required.
- The new four-size authenticated hub E2E is included in the existing Chromium/mobile-WebKit CI command, not left as an unexecuted orphan test. Await the next CI run before claiming mobile success.
- No production changes, credentials, migrations, charges, or customer fixtures.
- Temporary headed UI harness under `/tmp/luster-booking-hub-ui.yTebiu` did not pass: it omitted the app Tailwind theme configuration (`border-border` unavailable). It was stopped; do not count this as mobile verification or change production styling to accommodate the harness. Use the real isolated Next app for the next browser check.
- Draft PR: https://github.com/SniperStopSniping/nailsalon/pull/159. Initial checkpoint `5541b0a` pushed. Leave the PR in draft until the remaining scope and real-browser checks are complete.

## Continued delivery

- CI 33937700419: full Vitest passed. E2E never started because adding a test to package.json violated the frozen dependency manifest pair. Restored the manifest exactly and added the test to the workflow's existing argument list instead; no gate or dependency protection was relaxed. An unrelated lifecycle PostgreSQL test timed out at 5 seconds; rerun required.
- Guided current-data review and safe save-before-navigation: **54 tests passed** in the page/hub pair, including failure retention. Focused source lint passed.
- Your Information now reads the current tenant's saved identity, primary address, contact, hours and timezone into its accordions (including values hidden publicly). The optional owner-only GET is authorized before reading locations/technicians; wrong-tenant coverage included. Editing still uses the existing settings destinations; no new general-profile writer or unsafe snapshot replay was introduced. The location shortcut no longer claims the old editor exposes three privacy modes—it does not yet.
- Open live site / Copy link now use the canonical server URL helper, including custom domains. Focused route/hub/editor/visibility suite: **5 files, 88 tests passed**. This supersedes, not adds to, the smaller 54-test run.
- Vercel CI/CD skill applied to the workflow change. Production release still requires all CI, mobile and immutable Preview gates.
- Guided review now defers Publish/Revert to its final step and has mobile navigation assertions. Hours in the owner summary are ordered Monday–Sunday (not JSONB key order). Final affected suite remains **88 passing tests**, scoped lint clean; TypeScript passed after adding current-value reads.
- Hosted Preview checkpoint `23c23f8013d7328bd398de0ff0dfd2add815ee52`: `dpl_GoJZx1WGFrfVVdwRNhQDKqxvzw14` is READY at https://isla-nail-studio-fdo5su1za-sniperstopsnipings-projects.vercel.app . The initially observed HTTP 200 was Vercel's building page, **not** application verification. Post-READY route checks are tracked separately; do not count the building page as a passing app check.
- CI runs `33939588164` and `33939893351` were still running the full journey at this checkpoint. The earlier PostgreSQL timeout passed on rerun. Required release gates remain pending, not waived.
- CI `33939588164` subsequently passed all gates, including 51 browser tests on `fbad40f`. **Coverage correction:** its four hub viewport cases ran in Chromium only; the mobile-WebKit project's existing `testMatch` excluded the hub file. Added the hub explicitly to that project's filter. Do not claim iPhone/WebKit success until the subsequent run executes and passes it.
- The same WebKit project also requires `@owner-preview-webkit`; the hub cases now carry that tag. Verified with Playwright `--list`: **four Chromium and four mobile-WebKit cases** (plus shared setup/teardown). Listing proves admission only, not execution success.

The user requested checkpoints because account usage is low. Preserve this branch and the original dirty workspace; do not consume reset credits without explicit authorization.

## Continuation (2026-09-05, after `154513a`)

CI `33940457926` on `154513a` **failed**: all eight hub browser cases (4× Chromium, 4× mobile-WebKit — so the WebKit admission itself worked) stopped on `Guided review · Step 2 of 6`. The JSX rendered `Step2 of6` because line breaks between text and expressions swallow the spaces. Fixed by rendering one template string. Every other job was green.

### Implemented

- **Three-mode address privacy.** `LOCATION_DISPLAY_MODES` is now `full_address | after_booking | city_only` (`src/libs/bookingPageContent.ts`), stored in the existing `settings.bookingPageContent.{draft,live}.locationDisplayMode` — no column, no migration. `applyLocationDisplayMode`/`applyPhoneDisplayMode` redact everything except `full_address`, so `after_booking` is byte-identical to `city_only` for anyone browsing (address, postal code, phone, directions URL, arrival instructions, serialized Quick Book profile and `SalonContent`). `resolveConfirmedBookingLocationDisplayMode` (`src/libs/salonContent.ts`) is the only place `after_booking` becomes `full_address`, and it is called only from surfaces reached with a verified appointment capability: the private manage page (`[locale]/[slug]/manage/[token]`, new "Where to go" row with directions + entrance/transit lines) and its `.ics` `LOCATION:` line. Signed-in customer sessions are never treated as a booking; `city_only` stays city-only even there. Onboarding now maps `public → full_address`, `after_booking → after_booking`, `hidden → city_only` (`persistence.server.ts`), so the onboarding choice is no longer collapsed.
- **Your Information editing.** New owner-only route `PATCH/GET /api/admin/salon/information` (`getSalonBySlug` → `requireAdmin` → owner membership or super admin) writes business name, logo URL, phone, email, Instagram (username normalized with the onboarding resolver into `bookingExperience.socialLinks.instagram` via targeted `jsonb_set`), contact permissions (`settings.sharedProfile.*` per key) and weekly hours (salon row **and** primary location; technician schedules untouched). `src/components/admin/BookingPageInformationEditor.tsx` renders the four accordions with the actual saved values, explicit Save per section, retained edits on failure, and reuses the existing writers for everything else: `/api/admin/location` (street address), `PUT /api/admin/technicians/[id]` (nail-tech name), `POST /api/admin/technicians/[id]/avatar` (profile photo), `GET /api/admin/portfolio` (logo picker from the shared library), `/api/admin/salon/settings` `bookingConfig.timezone`, and the booking-page content draft for the three privacy radios. It never calls `/api/admin/profile` (the private account). Non-owner admins get the read-only summary plus visibility switches. The slug and public URL are read-only (locked after publish).
- **Guided review.** The information editor registers a flush; "Save & next step" saves dirty sections first and stays put with the existing message on failure. The irreversible salon-level "Publish my salon" banner now appears only outside the guided sequence or on its final step.
- **Hub fixes.** `?app=portfolio` is now an accepted dashboard URL app, so Photos & Gallery (and the More tile) actually open the shared Portfolio library; the hub public URL honours the hub locale; Staff Ops subtitle no longer duplicates the new "Time-off requests" title.
- Legacy full editor: its "Location shown as" picker now offers the same three choices.

### Verified locally (remote container, disposable PostgreSQL 16 on 127.0.0.1:55432, CI placeholder env, `CI=true`)

- Vitest, every touched module (20 files): **327 passed**, plus the new/extended suites re-run after the status gate and fail-closed changes (salonContent 24, manage page 23, information route 24, information editor 11, bookingPageContent 11).
- `tsc --noEmit` with the CI placeholder env: 0 errors (`npm run check-types` needs that env; without it `next typegen` stops at the runtime-environment guard, which is not a type error). `npm run build` passes.
- ESLint on every changed file: 0 errors (fast-refresh and `<img>` warnings match the existing pattern).
- Playwright, `tests/e2e/booking-page-hub.e2e.ts`, chromium project against the production build: **6 passed** (setup, teardown, 320/375/390/430px). The journey now edits Instagram and restores it, toggles address privacy, reloads, verifies persistence and the "not published" note, restores the original, and opens Photos & Gallery. The 320px run found and fixed a real horizontal overflow in the Hours rows.
- Not verified here: the mobile-webkit project. WebKit cannot be downloaded in this container (`cdn.playwright.dev` is blocked by egress policy); CI's mobile-webkit job (already admitted for this file) is the WebKit evidence. No physical iPhone/VoiceOver check was performed.

### Known residual risks (unchanged behaviour, documented)

- Re-claiming an onboarding draft (`existingSiteStrategy` continue/replace) still re-applies snapshot values through `syncQuickBookProfilePresentationDraft`; the hub never calls the claim route and "Review saved setup" stays gated to unpublished sites, so dashboard edits on a published site cannot be overwritten from the hub.
- Customer confirmation email/SMS carry no address (pre-existing); the manage link in them leads to the capability-scoped page that now shows it.
