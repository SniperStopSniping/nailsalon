# Larger owner photos and reliable visual editing

This checkpoint continues the existing AI builder. All writes, model trials and bookings used the attested loopback Development database and fictional Velour Studio. No hosted deployment, production migration/data change, payment, customer communication or new infrastructure purchase occurred.

## What an owner can do

Photos and transparent logos up to 20 MB now use shared local preparation in the conversation attachment dialog and manual photo controls. Larger inputs retain their proportions and alpha channel, respect decoded-pixel limits, and become bounded uploads without cropping, stretching or enlargement. Photograph/logo preparation bounds the longest edge to 2400 pixels; original Canva artwork retains its separate full-page preparation. The existing authorized server validation/storage still runs. Files already under 3 MB retain the original upload path. This does not recover detail absent from the original image or promise that the generated design never crops photography deliberately.

Preparation/upload/save progress is visible. A lost successful attachment save can be retried at the six-page limit without counting the already-selected pages again. Changing an attachment from inspiration to public photographs requires a fresh rights confirmation. Uploads themselves make no AI call.

The actual owner trial found a more important iterative-edit failure: “Keep the burgundy and ivory design. Make the two photos larger and overlap them in the studio section. Keep my logo, services and the rest of the design.” The intake model answered as though the editable frontend were fixed Canva artwork and made no revision. That paid failure is retained. The application now routes clear website-only visual edits directly to the existing validated generator and supplies an authoritative current editing mode for other requests. Actual preserved artwork stays excluded. Numeric/mixed business requests, questions, future changes and publication do not use this shortcut. Existing authorization, scoped reads, revision checks, metering and draft/live boundaries remain in force.

## Actual owner acceptance

The owner supplied the business, city, solo work, hours and both services through chat. Two existing repository demonstration nail photos were explicitly uploaded as test inputs, along with a developer-authored transparent **input logo**. These are not claims of fictional Velour's actual work or newly verified photo licensing. The supplied burgundy NailMe screenshot was attached as third-party inspiration; its brand, policies, text and photographs were not copied. No developer-created or secretly repaired frontend was substituted for model output.

| Owner action | Revision | Observed result |
| --- | --- | --- |
| Business intake | 2 | Velour Studio, Toronto, solo, Tuesday–Saturday 10–18, BIAB CAD65/75 minutes and Gel Manicure CAD50/60 minutes |
| Larger landscape and EXIF-rotated portrait uploads | 3–4 | 3.84-MB landscape became 1200×799; 3.10-MB JPEG became upright 960×1280. The observer's initial absent-brief error was fixed; UI retry reused the successful uploads. |
| Transparent logo | 5 | 16.81-MB, 4096×1024 original became 2400×600; alpha and transparent corner retained |
| Inspiration upload and first generation | 6–7 | Real Sol source `fc26fa87-794c-4dcf-bfbb-acf8ec730ead`; all three selected images used; no source repair |
| Original overlap request | 7 | Real intake no-op failure described above; not reported as success |
| Identical overlap request after application fix | 8 | One real Luna source revision; no intake call; business details unchanged |
| Less crowded mobile, retain desktop overlap | 9 | Source `2c1f785c-f0b1-4a75-af6c-ef972f1dc0c7`; desktop image overlap measured 73,264 CSS square pixels; phone uses a simpler stacked arrangement |
| Review/approve/publish, deliberately lose successful response | 10 | Recovered one exact publication receipt after refresh; no duplicate service rows |
| Original customer booking in Chromium | 10 | One HTTP201; BIAB 6500 cents/75 minutes; eligible staff; original 10-minute buffer |
| Edit with AI, then “Keep the design, but change BIAB to $70.” | 11–12 | Same service/source identities, 7000-cent draft; anonymous live website still showed 6500 cents |
| Exact review and approval | 13 | Original canonical BIAB updated to 7000 cents |
| Original customer booking in WebKit | 13 | One HTTP201; same service identity at 7000 cents/75 minutes; earlier appointment/snapshot still 6500 cents |
| Manual larger-photo replacement in WebKit | 14–15 | Shared preparation accepted 3.84-MB input; new draft source, CSS/JS and business settings preserved; no AI call/live change |
| Restore final AI design through Previous designs | 16 | All original photos/layout restored; 7000-cent business draft preserved; public revision 13 unchanged |

Both preview sizes loaded all selected images, had no horizontal overflow, and retained correct proposed service bindings. Instagram's phone-width tap attempted the saved destination; test networking blocked external navigation. Animation and reduced-motion checks passed. WebKit's restored preview and booking are fresh-browser/saved-state evidence, not real Clerk cross-device authentication.

The design has a burgundy split photographic hero, an ivory editorial studio section, serif/italic hierarchy, overlapping nail photos, responsive service cards and the actual transparent wordmark. It is an original interpretation of the reference, not an exact reproduction. System fonts, a different hero proportion and deliberate photo cropping remain visible differences. A later approved price change is live-bound, not printed into HTML; neither original appointment snapshot changed.

## Evidence, usage and checks

- Viewable first/final desktop and mobile results, photo composition, exact review, both receipts and safe measurements: `artifacts/ai-credits/photo-owner-checkpoint/`.
- Full original recordings and failed attempts remain private outside Git in `/tmp/luster-ai-photo-owner-evidence-20261018/`. Immutable model output/source history remains in the isolated database. No private session/key/raw provider output is included in the curated manifest.
- Seven real OpenAI calls, including the failed intake, cost an estimated **USD0.085273** from measured tokens at pinned Standard rates. Trial accounting is **CAD0.170546**, using its conservative 2-CAD/USD conversion; synthetic retail usage is CAD0.238767 with the separate frozen retail conversion. These are estimates/accounting, not invoices or live FX. Initial Sol generation took 105.621 seconds; the final mobile edit took 40.074 seconds; the price edit took 3.131 seconds.
- Local allowance remains CAD11.384406, charged/retained CAD8.269810 with zero pending calls. The frozen hosted allowance remains CAD68.615594; the shared cap stays CAD80. Hosted spending was not re-read, no allowance was reset/increased, and no unknown hold was released.
- **214** focused upload, PDF, component, intent and draft tests passed; **13** attested disposable PostgreSQL publication/concurrency cases and **7** origin/loopback cases passed. TypeScript, scoped ESLint and whitespace checks passed. Deterministic provider doubles are separate from the real calls above.
- Clean source commit `195b57a7` passed the full archived optimized build, including type checking and static-page generation. The actual credential scanner passed 4,568 tracked files and 599 generated files; 617 public static/HTML/RSC files contained zero server-canary matches. Machine-readable proof is `optimized-build.json` beside the screenshots. Webpack reported a non-fatal disk-full cache-write warning; the build and scanner still completed successfully. Larger trials were held until disk space became available again. Neither proposed cache directory was removed.

## Optimized private-photo verification

The first optimized browser attempt was interrupted and did not prove a result. A subsequent real WebKit owner check exposed a private-media configuration problem before rendering; its failure is retained privately. The clean archive lacked the external Development upload directory. After explicitly supplying it, the media reader still denied every optimized `NODE_ENV=production` build, including the attested local Development application.

The local test harness now accepts only `/tmp/luster-custom-site-private-media` through `LUSTER_ISOLATED_HTTPS_MEDIA_DIR`, verifies its owner/non-symlink identity, and passes that one non-secret setting to the app. The renderer receives no media-directory permission or credentials. No `.env` file or provider key is copied. The real media reader can read existing uploads in an explicitly marked local optimized Development runtime. Hosted and ambiguous optimized runtimes retain their denial; Cloudinary production write behavior and tenant-owned storage-key validation are unchanged. Five negative runtime cases and a cross-salon read case verify this boundary. A failed design GET also reports a loading failure instead of incorrectly claiming a save failed, without exposing internal diagnostics.

The 71 media-storage/environment checks, ten custom-owner API checks, source TypeScript, scoped lint and whitespace checks passed. The follow-up optimized build/browser result is recorded separately when complete; the earlier passing static build is not evidence that this newly found browser issue was already fixed.

```sh
LUSTER_ISOLATED_HTTPS_CHECK=true \
LUSTER_ISOLATED_HTTPS_MEDIA_DIR=/tmp/luster-custom-site-private-media \
node scripts/ai-https-check.mjs serve /tmp/luster-ai-https-check-<verified-build>
```

Read-only Vercel inspection still resolves the intended `isla-nail-studio` project, CLI64.5.0, Node24, production branch `main` and disabled automatic Preview deployment. Preview's inherited Clerk/Stripe values remain unreadable Secrets, and its separate common Redis value remains unattested. No setting was changed or secret copied. Real Clerk Development login/signup and the deferred Stripe sandbox key, remaining reference-quality acceptance, hosted isolation, remote CI/review and protected-main release remain open. The push/deployment hold remains. This checkpoint does not declare the complete paid builder production-ready.
