# Verification and limitations

Recorded October 15–16, 2026 in a dedicated local Luster worktree and isolated PostgreSQL/Redis runtime. This is a review library, not proof of a production deployment. Nothing was merged, deployed or published.

## Finished media

- 67 current branded MP4s and 67 matching covers. 43 complete-action workflows, 10 saved-setup guides and 14 read-only guides.
- 1080 × 1920, 30 FPS constant frame rate, H.264/YUV420P, silent MP4 with fast-start metadata. Duration range: 16.8–34.033 seconds; approximately 20.8 minutes total.
- Every current export passed ffprobe dimensions/rate/duration checks, SHA-256 comparison, full video decode and cover-dimension validation. See `verification/library-export-checks.json`.
- All captured frames use the same 390 × 844 viewport and page scale factor 1. The phone remains at a fixed scale. Actual pointer events drive the hand; the compositor verifies that no tap was removed by a cut. Text geometry checks enforce headline width, explanation width and spacing. See `verification/source-layout-checks.json`.
- Beginning/middle/end samples were inspected across the workflows. Important booking, service, no-show and saved-result transitions were checked using the detailed tap/step contact sheets. Changed exports were re-inspected after opening waits were trimmed. This does not mean every second was watched in realtime.
- Setup disclosure text was separated from the brand tagline. Opening navigation waits were edited out while retaining real taps and actual settled screens. Some older opening shots still contain a brief, genuine dashboard data-card refresh.

The gallery is tested separately for desktop/mobile layout, search, priority filtering, file metadata and advancing playback. `verification/gallery-checks.json` records the actual browser results. Bundled Playwright Chromium lacks the H.264 decoder in this host; supported system Chrome and WebKit are used for playback verification. The MP4s passed full FFmpeg decode independently.

## Verified workflows and concrete outcomes

| Area | Evidence |
|---|---|
| Online/manual/walk-in booking | Real synthetic bookings created through Luster UI; actual appointment IDs and persisted states captured. |
| Rescheduling/cancellation | Existing synthetic visits moved/cancelled; normal cancellation remains separate from no-show. Secure guest rescheduling updated the original row. |
| Checkout/history | A synthetic $65 cash checkout is completed/paid with zero balance. The same invoice remained preserved after client archival. No card charge occurred. |
| Services/add-ons | Luster Gel Manicure created and edited to $60/60 minutes. French Tips, Chrome, Glitter and Removal from Another Salon saved as optional extras and independently reopened. |
| Booking design | Styles, colours, fonts, layout/menu and address privacy saved as drafts and privately previewed. Publication was performed only on the local fixture. |
| Approval | Supported salon-wide “Review each request first” setting saved. A real guest request was created as pending and then confirmed by the owner. Inactive per-service catalog modes were not treated as enforced. |
| Smart Fit | Actual 12% offer selected and saved at its discounted service price, with the configured synthetic tax reflected in the final total. Separate first-visit offers do not stack; the fixture turned that offer off through the owner UI for this take. |
| Shared no-shows | Confirmed nonattendance reported before the appointment; actual response said shared. Another authorized synthetic salon displayed the limited recorded-history count. Corrections revoked contributions. A secure customer review request suspended its contribution. |
| Starter texts | Actual isolated one-time 100-credit grant. Second claim: granted=false, already_claimed; balance remained 100. Email/phone verification was prepared on the exact Development-only synthetic owner without delivering an OTP text. |
| Communications | Preferences, reminder timing, review settings and wording saved. Manual text is draft-only. No SMS/email delivery is implied. |
| Staff/clients/reporting | Owner-managed schedules, service assignments, profile creation, notes/preferences/flags, archive and real read-only reports exercised. Zero-data and financial-review states remain honest. |

A stopped no-show retake created an extra synthetic rehearsal report. It was corrected through the existing authorized correction API rather than reset or deleted; its audit trail remains. The last fully verified customer-review recording was retained. The second authorized salon’s active shared count was independently checked as zero. See `verification/rehearsal-report-correction.json`.

## Application checks

- 258 focused regression tests passed for dashboard/manual appointment entry, public time selection, SMS health copy, staff save feedback, payments settings, portfolio, client controls and no-show reporting/risk/dialog behavior.
- The additional catalog-readiness fix passed 109 service/API tests. It exposes the authorized server catalog decision, hides ineffective controls for ordinary salons, preserves explicitly enabled catalog editors and sends ordinary owners to working salon-wide approval settings.
- Four enabled-catalog browser cases passed at 320/1280 pixels in Chromium and WebKit. Four ordinary-salon browser cases then passed at the same widths/browsers, including a saved salon-wide approval setting and no horizontal overflow. Only affected cases were rerun after their fixture was corrected.
- Full Next.js builds, standalone type checking, scoped lint and whitespace checks passed for the application fixes. The first remote type-check failure was corrected to use a typed Testing Library exact-name expression.
- Remote CI on `657d9d13` completed successfully. The later `46e47c0c` run caught an outdated browser fixture that assumed every salon had active service-level catalog modes. Its fixture now explicitly distinguishes enabled catalog mode from ordinary salons; the corrected cases pass locally. That run also encountered a WebKit internal navigation error in an unrelated booking-theme media case. Historical PR/CI evidence is retained in `verification/ci-summary.json`; current PR checks must be read for the final head rather than treating earlier evidence as a merge gate.

All 84 tutorial JavaScript/TypeScript recipe modules also passed scoped ESLint; JavaScript syntax and Python compilation passed.

No full local test-suite rerun was needed; relevant regression evidence was reused and affected tests were run. Application code changes are documented in `UX_IMPROVEMENTS.md` and `CHANGED_FILES.md`.

## Blocked or limited verification

| Workflow | Exact requirement before filming a successful outcome |
|---|---|
| Google Calendar connection | A nonproduction Google OAuth configuration and authorized synthetic calendar; then verify connect, event sync and disconnect. Current UI says Not available yet. |
| SMS top-up purchase | Isolated Stripe test checkout plus verified test webhook/credit fulfillment. Purchases are disabled here; no successful purchase is invented. |
| Deposit refund/collection | Charge-ready Stripe test connected account and a synthetic paid deposit. Amount/readiness guides exist; activation, collection and refund are not filmed. |
| Advanced catalog rules/per-service modes | An explicitly enabled, supported catalog rollout. Ordinary salons use the legacy domain. Earlier saved-only footage is archived and excluded. The new UI hides ineffective controls. |

Additional gaps: full fresh owner signup/email-code authentication, actual client photo upload/provider storage, nonzero staff payouts, live inbound STOP handling, nonzero Smart Fit attribution and external Luster Studio link destinations were not filmed. The inventory distinguishes these from the covered profile/settings/read-only workflows. Conditional AI pilots are disabled and excluded. Retired review rewards, memberships, customer/staff accounts, unfinished loyalty/referrals/Discover/social posting/captions and AI voice are excluded.

The same development owner is authorized at two synthetic salons. Runtime cross-salon warning propagation was verified; a second distinct human-owner Clerk account was not used. Backend tenant-isolation/concurrency checks remain separate evidence.

## Source traceability

Baseline main: `ad28e325b646b19dea481aec83d3d6d5ff5dbac5`. Application candidates: `f7fc1382`, test correction `657d9d13`, catalog-readiness fix `46e47c0c`. PR: https://github.com/SniperStopSniping/nailsalon/pull/456 .

57 current takes retain the exact compiled build identity and reconstructable source patch. Ten early/recovered takes record the baseline SHA but do not retain a directly captured compiled-build identity. This is a traceability gap, not a claim that those ten were recorded on the final source. Their actual UI actions/results and current output integrity were verified. Re-record affected clips when matching a released build. The manifest lists the scope per take, and source patch snapshots are kept in `verification/source-patches/`.

Feature Preview badges remain on changed/unreleased workflows and the PR #449 no-show demonstration until the matching deployment is independently verified. A local video does not confirm hosted-preview or production behavior.

## Before posting

Watch the selected export full-screen on a physical iPhone and in Instagram’s actual Story/Reel composer. Browser viewport tests do not prove physical readability or the placement of changing platform overlays. The upper instruction region is intentionally prominent; platform chrome may cover edge branding/footer details. Check bottom navigation taps and tiny native controls on the target device before approving the posting template.

All footage is synthetic. Provider-dependent successful outcomes must be recorded in a safe sandbox before being marketed as demonstrated. User approval of the final design and of posting remains separate from these technical checks.
