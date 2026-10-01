# Luster video production

The first customer-booking tutorial is a **66.1-second narrated reference for creative approval**. Clean and captioned 1920×1080/30 fps MP4s, SRT/WebVTT/ASS captions, a thumbnail, original recordings, cached narration and editable timelines are provided locally. Other seven videos are gated on user approval. Technical verification and remaining acceptance limitations are recorded in `QA.md` and `manifests/verification.json`.

## Application and release

Filmed application SHA: `3980197563c4ddc5774f6c5dcbfb8fe9f8827a6a`. Branch: `codex/luster-video-production`, created from that freshly fetched `origin/main` revision. The original checkout and unrelated changes were preserved. No application UI, domain logic, schema, authentication, or billing changes were made.

Required checks passed for the filmed base. GitHub recorded a successful Production deployment of that exact SHA, and its deployment health endpoint returned the matching short SHA. The live domain advanced to `f980091` during this task; it is not the filmed revision. The isolated local production build passed. No tooling-branch deployment is evidence of a completed video.

See `manifests/release.json`, `manifests/verification.json`, and ignored `qa/` evidence. Application release verification is separate from user approval of the video, which is pending.

## Local setup

Use Node 20.19.4, Python 3, and the committed root package lock. `HUSKY=0 npm ci --no-audit --no-fund` completed. Existing Playwright supplies Chromium and WebKit. PostgreSQL 16 and Redis use task-only loopback ports 55441 and 6391; Next uses `http://localhost:3141`. The last disk check showed 76 GiB available.

Private service state is outside Git at `~/.codex/luster-video-runtime/atelier-20260930`, mode 0700; credential/session files use mode 0600. The runtime validates the exact task database, development marker, local origins, Clerk Development keys, disabled delivery settings, and an allowlist of environment names. It rejects production targets, fallback environment files, unexpected provider configuration, and remote Redis. It does not inherit arbitrary provider secrets.

From the repository root, on a **fresh task runtime only**:

```sh
export PATH="/Users/me/.nvm/versions/node/v20.19.4/bin:$PATH"
python3 production/luster-videos/demo/runtime.py prepare --clerk-env /absolute/path/to/development-keys.env
python3 production/luster-videos/demo/runtime.py initialize
python3 production/luster-videos/demo/runtime.py migrate
python3 production/luster-videos/demo/runtime.py verify
node production/luster-videos/demo/auth-prepare.mjs
node production/luster-videos/demo/auth-prepare.mjs --apply
python3 production/luster-videos/demo/runtime.py seed-plan
python3 production/luster-videos/demo/runtime.py seed-apply
python3 production/luster-videos/demo/runtime.py build
python3 production/luster-videos/demo/runtime.py start
```

Review the machine-specific executable paths in `demo/runtime.py` before moving machines. `prepare` reuses an identified runtime without resetting it. There is no general cleanup/reset command. Do not casually reseed the recorded environment: the hero and note are persisted evidence.

Auth provisioning creates/reuses only the marked synthetic Clerk Development user and organization. `demo/auth-session.mjs` uses existing Clerk testing support and genuine owner authorization, storing the private browser session in `local/video-runtime/owner-state.json`. Never distribute that file. The existing onboarding integration flag completes the Development organization session task; production authentication was not changed.

SMS, email, payments, calendar synchronization, provider webhooks, and scheduled workers are disabled or unconfigured server-side. Local failed email attempts have `RESEND_NOT_CONFIGURED`; there are no provider message IDs or sent/delivered records. No customer data was copied.

## Demo and capture

`manifests/demo-data.json` describes separate solo/team fixtures, fictional clients, services, hours, stable IDs, and America/Toronto timezone. Solo omits technician selection. The three-technician team journey still needs UI verification.

The real public flow created Sarah Morgan's BIAB Overlay plus optional Simple Nail Art for October 2, 2026 at 10:00 a.m., 90 minutes, CAD 75 in fictional salon pricing. The owner rescheduled the **same appointment** to 1:00 p.m. and saved “Prefers short almond shape and sheer pink finishes.” Reload checks passed. `qa/hero-booking.json` and `qa/continuity-report.json` connect the recording to persisted records.

```sh
node production/luster-videos/demo/auth-session.mjs
node production/luster-videos/demo/verify-booking-ui.mjs
node production/luster-videos/demo/verify-continuity.mjs
```

The continuity script checks the specific captured appointment/date and persisted state; owner UI evidence was separately collected. Refresh dates for a new take. Capture defaults to rehearsal, stopping before submission:

```sh
node production/luster-videos/demo/capture-booking.mjs
# Only on a verified fresh fixture without a hero receipt/booking:
node production/luster-videos/demo/capture-booking.mjs --book
```

`--book` refuses a second hero. Rebuild from saved media instead of booking again. The raw file is 780×1688, VP8, 25 fps, but effective app content is **390×844**, at the top left. DPR 2 did not increase detail. The timeline crops padding and uses saved editorial close-ups around active controls in a 920-pixel-high panel without altering the interface. The establishing shot retains the full page. Crop positions and hand-click mappings are explicit editable data. Recapture at higher effective resolution if final readability review requires it.

## Assets and disclosure

The user authorized AI photography because no approved photo files were available. `manifests/assets.json` records the generated manicure image, checksum and provenance. It depicts fictional work; no salon/customer photos or testimonials are used. Ignored copies are `assets/atelier-ai-nails.png` and `public/video-assets/atelier-ai-nails.png`. Include these locally in the media handoff; do not commit or deploy them in the application bundle.

Every planned export displays **AI-generated narration · Fictional demo salon · AI nail imagery** near the opening. Retain the disclosure in publication notes. System Verdana is the resolved local font dependency; no font file is redistributed. Confirm a permitted equivalent before rebuilding on another OS.

## Narration and costs

Required names in ignored, mode-0600 root `.env.video.local`: `OPENAI_API_KEY` and `VIDEO_NARRATION_FUNDED=true`. Configure locally, never in chat. The user confirmed available API funds; API authentication/model listing and successful `gpt-4o-mini-tts` / `marin` generation were verified. The private narration key is excluded from the app runtime.

`manifests/costs.json` separates estimates, reservations and actual charges under the CAD 50 all-in cap. Ten speech requests (nine original sections plus one explicit BIAB pronunciation correction) and two bounded automated audio listening reviews were made. CAD 12 remains conservatively reserved, with CAD 5 retry headroom. Planning estimate: CAD 1.20 all-in. Actual provider billing is pending; reservations and estimates are not invoices. Audio QA reports contain metered token usage. No subscriptions, purchases, top-ups, or automatic retries were made.

Before paid generation, verify current official pricing, funding, model/voice access, and all-in FX/tax allowance, then update evidence and manifest gates. The producer uses a locked fixed ledger, bounded requests, one explicit attempt per uncached section, no automatic retries, and conservative reservations counted after generation. Tests use temporary ledgers. Do not delete/reset the real ledger to recover budget.

```sh
# Offline plan: no credentials, API calls, ledger writes, or audio generation.
python3 production/luster-videos/tools/narration.py --sections narration-scripts/tutorial-booking.sections.json
# Only after verified prerequisites and manifest gates:
python3 production/luster-videos/tools/narration.py --sections narration-scripts/tutorial-booking.sections.json --generate
```

Original WAV sections are retained, including the superseded BIAB take. Measured alignment is saved in `narration/tutorial-booking-aligned.wav`; the final SRT/WebVTT/ASS cues are based on the corrected spoken audio. Older `.template.srt/.vtt` files are planning examples only.

## Offline editing

FFmpeg and FFprobe 9.0.2 were checked with an actual H.264/AAC encode. Use the full build: minimal Homebrew FFmpeg lacks required text/subtitle filters. No global PATH change is needed.

```sh
export VIDEO_FFMPEG=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg
export VIDEO_FFPROBE=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe
python3 -m unittest discover -s production/luster-videos/tests -v
python3 production/luster-videos/tools/video_pipeline.py validate --timeline timelines/tutorial-booking.json
python3 production/luster-videos/tools/video_pipeline.py render --timeline timelines/tutorial-booking.json --internal-silent-draft
```

Silent rendering writes only to `work/internal-drafts/` with an unavoidable **INTERNAL SILENT DRAFT — NOT APPROVAL READY** label. Normal rendering refuses missing narration or recordings. Offline rebuilding from the saved sections:

```sh
python3 production/luster-videos/tools/align_narration.py --config timelines/tutorial-booking.audio.json
python3 production/luster-videos/tools/video_pipeline.py subtitles --timeline timelines/tutorial-booking.json
python3 production/luster-videos/tools/video_pipeline.py render --timeline timelines/tutorial-booking.json
python3 production/luster-videos/tools/video_pipeline.py qa --timeline timelines/tutorial-booking.json
python3 production/luster-videos/tools/qa_reference.py
python3 production/luster-videos/tools/package_reference.py
```

Rebuilds use saved media and make no paid calls. Scene order/ranges, duration, crop, zoom, framing, titles, narration, captions and export settings are editable JSON. Tutorial click annotations use a white hand pointer with a charcoal outline and a short champagne pulse. Each scene stores the actual control position and visually aligned source time; the introductory outcome preview has no clicks. Both clean and captioned versions inherit the same pointer animation. Original vector cursor graphics are in `graphics/`; the installed root `sharp` package rasterizes them into ignored render cache files. No app DOM or styling is modified. See `manifests/cursor-evidence.json` for source-frame evidence. Target: H.264/AAC, yuv420p, constant 30 fps, fast-start MP4, 1920×1080 landscape or 1080×1920 vertical.

## Inventory and acceptance

| Item | Location | State |
|---|---|---|
| Real customer recording | `recordings/tutorial-booking/f1488ebdc5ea5e73afc707c6f4c1a369.webm` | Captured, 98.16 seconds |
| Editable cut | `timelines/tutorial-booking.json` | 66.1 seconds; measured audio and reviewed caption cues |
| Silent internal preview | `work/internal-drafts/tutorial-booking.silent.not-approval-ready.mp4` | Internal only |
| Narration text/config | `narration-scripts/tutorial-booking.md`, `.sections.json` | Final script, corrected BIAB pronunciation, cached original WAVs |
| Reference MP4s | `exports/tutorial-booking.clean.mp4`, `.captioned.mp4` | Rendered; user approval pending |
| Reference subtitles/thumbnail | `subtitles/tutorial-booking.srt`, `.vtt`, `.ass`; `thumbnails/tutorial-booking.png` | Provided |
| Local raw evidence | `qa/` | Ignored |
| Durable verification | `manifests/verification.json`, `feature-coverage.json` | Partial acceptance documented |

The full audio has automated listening/transcript review; the first review caught a missing A in BIAB, which was corrected. Local Whisper.cpp base.en transcriptions support reviewed sentence/phrase caption boundaries. Audio model judgments about naturalness vary; human creative listening approval remains pending. Visual review uses full-sequence contact sheets, control/caption frames, and browser playback verification. No human unfamiliar reviewer or physical-device test is available; these acceptance items remain pending. Native 200% text scaling, visually sufficient keyboard focus, design publication/link and team/follow-up checks are listed separately, not passed by implication.

Produce the other seven videos only after user approval of the completed reference. Website embedding, public posting, ad purchases and a later feature library are outside scope.


## Reference review and handoff

Open `exports/review.html` through a loopback-only static server or play either MP4 directly. The source archive includes the selected generated photo, raw recording, original cached WAVs, aligned audio, scripts, editable scene/audio/caption configuration, subtitles, thumbnail, reports and rebuild documentation. It excludes environment files, private auth/runtime state, fonts, speech-model weights and unrelated application files. The archive and large media are ignored by Git.

Local speech timestamp dependency: installed `whisper-cli` / Whisper.cpp with `ggml-base.en.bin` cached under ignored `work/models/`. Source: https://github.com/ggml-org/whisper.cpp and https://huggingface.co/ggerganov/whisper.cpp . It is optional for rebuilding the edit because the reviewed cues are saved. No weights or font files are redistributed.
