# Customer-booking reference quality report

Status: completed first-video reference, awaiting user creative approval. The remaining seven videos have not been produced. This report distinguishes measured checks from pending human acceptance.

## Delivered reference

- `exports/tutorial-booking.clean.mp4` and `exports/tutorial-booking.captioned.mp4`: **66.100 seconds**, 1920×1080, square pixels, 30 fps, 1,983 frames, H.264/AAC, yuv420p, fast-start metadata.
- Matching reviewed SRT, WebVTT and editable ASS captions; thumbnail; final narration script; original recording and cached WAV sections; editable scene/audio configuration; source archive.
- Both versions include titles, real-click hand annotations and readable “AI-generated narration · Fictional demo salon · AI nail imagery” disclosure. No background music.
- Clean SHA-256: `c5647930dbe4e4cdcba4f06cd10f65d37a432a20fd1dd4eb7794a6505975f54c`.
- Captioned SHA-256: `9be0fdaeb1d5c22aeb8ddaa814f96118f9baab4fbe765cb3441d44356fbb195d`.

## Product truth and continuity

Filmed application: `3980197563c4ddc5774f6c5dcbfb8fe9f8827a6a`. Its approved Production deployment was independently matched to that SHA; filming used the isolated local build. No application source or release behavior changed for this edit.

Atelier Nail Studio — Demo is fictional. Sarah Morgan booked BIAB Overlay with optional Simple Nail Art through the real guest flow for October 2, 2026 at 10:00 a.m. America/Toronto, 90 minutes, fictional CAD 75. The solo configuration has no technician-selection step or optional marketing-consent field. Narration follows the actual service → extras → date/time → appointment summary → contact details → required agreement → confirmation sequence.

Appointment `appt_a60f8bff-b3b7-4fc9-a3b9-7b080e788e4b` persisted, appeared for the authorized owner, and was rescheduled to 1:00 p.m. without duplication or changing its client association. The old slot was available and the new slot occupied. The fictional client note survived reload. These owner-side checks are separate evidence; the customer tutorial stays entirely in the public flow.

The task database and Redis are local, independently identified and isolated. No production customer data was used. Outbound providers and jobs are disabled/unconfigured server-side. Local failed email attempts report `RESEND_NOT_CONFIGURED`; no sent/delivered/provider-message records exist. The recording does not claim that a notification was sent.

## Visual, audio and export checks

All 66 one-second samples of the final sequence and targeted hand-press/caption frames were visually reviewed without sound. Close-ups enlarge actual controls through saved editorial crops. Captions use no more than two lines in the left panel and do not cover the active interface. All seven hand clicks map to the actual recorded control/action, including the required agreement and confirm button. Full-page establishing and labelled outcome-preview shots retain context. No DOM injection or filming-only application restyling was used.

Raw VP8 footage is 25 fps, container 780×1688, with effective content **390×844**. The 1080p export scales this real source; it is not a native high-resolution capture. This limitation is disclosed rather than inferred away from DPR 2. Active control labels are readable in the reviewed close-ups; physical-phone acceptance is pending.

Nine natural-speed cached narration sections are aligned with measured duration and saved pauses. Ten TTS requests include one explicit pronunciation correction: the original BIAB take omitted A; corrected input uses “B. I. A. B.” and captions retain “BIAB.” Two bounded audio-capable model reviews listened to the complete audio; corrected review confirmed all four letters and an intact ending. Their subjective opinions of naturalness varied, so human voice approval remains pending. Local Whisper timestamps supported manually checked canonical words and line breaks. No specific person's voice was cloned.

Both exports fully decode with no errors or unintended whole-frame black. Audio measures **−18.06 LUFS** and **−1.5 dBTP**, without clipping. Clean/captioned versions have identical compressed AAC audio hashes. Browser playback of the clean MP4 reached 66.1 seconds with sound enabled, no media error, and correct 1920×1080 metadata. The captioned export also reached its end with sound muted and no media error. Browser playback is technical verification; it does not stand in for a human listening review.

Evidence: `qa/reference-technical.json`, `qa/tutorial-booking.json`, `qa/audio-alignment.json`, `qa/audio-listening-*.json`, `qa/final-frames/`, `qa/hero-booking.json`, `qa/continuity-report.json`, `qa/reschedule-slot-verification.json`, `qa/booking-ui-verification.json`.

## Tests, review and budget

Production tooling: **54 Python tests passed**. Isolated app production build, type check, targeted ESLint and real continuity checks passed. Chromium/WebKit mobile emulation was exercised, distinct from physical-device testing. Full application suites/builds and required CI passed at tooling checkpoint `bef62647b3cd67f14f181bfa77f51cf262242868`; fresh final tooling commit checks are recorded separately in the verification manifest. Draft PR #338 remains subject to repository review and merge gates. No new application deployment is required for the already approved filmed base.

Incremental allowance: CAD 50 all-in. Ten TTS calls and two audio reviews; conservative committed reservations CAD 12, retry headroom CAD 5; estimated API charges CAD 1.20. **Actual billing is unavailable and pending**, not reported as zero or equated with reservations. No subscriptions, purchases, top-ups or automatic retries. Rebuild uses cached source/audio and makes zero paid calls by default.

## Pending acceptance and deviations

- User approval of voice, framing, caption style, pauses and pacing; full-motion viewing with and without sound by a human.
- Reviewer unfamiliar with Luster repeats the task without extra instruction. No such reviewer was available; self-review is not a passed substitute.
- Physical-device review, native 200% text scaling and visually sufficient keyboard-focus review remain pending.
- Draft isolation/publication/first-publication confirmation/copy-link and immediate-save behavior; team screens and eligible follow-up queue remain later-video preparation checks, not verified by this tutorial.
- The real public root starts with services, rather than a separate salon marketing homepage. Location cards show the existing short business label “Atelier Studio”; the page header carries “Atelier Nail Studio — Demo.” Source content was not altered in the edit.
- No preference field, attached client-photo gallery, messaging delivery, payment, review, rewards, reporting or AI receptionist capability is claimed in this reference.

Retain the AI narration and synthetic-imagery disclosure in publication notes. Public posting and website embedding are outside this delivery. Produce the remaining seven only after creative approval of this reference.
