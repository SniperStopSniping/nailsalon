# Owner introduction and real build recording

The public AI introduction now contains an optional, captioned recording made from the actual owner application. It uses a fictional sample business, real OpenAI generation and a real synthetic appointment in the attested loopback Development database. It does not demonstrate a Stripe purchase or real Clerk sign-up. No production deployment, production migration, live-salon change or new service purchase occurred.

## Genuine owner workflow

The owner entered Vale Studio, Toronto, solo work, Tuesday–Saturday 10:00–18:00, BIAB CAD65/75 minutes and gel manicures CAD50/60 minutes in chat. A second message requested an original warm-white/charcoal editorial website, oversized type, an off-centre hero and delicate nail outlines. Sol generated artifact `01b0b3ce-7e3a-4c67-86ad-d40a2f2322cb` at revision 3. No design fixture, copied photography or manually repaired frontend was used.

The owner then asked for clearer phone navigation. The application saved model-generated revision 4, artifact `b83b0d0f-0b63-4e41-9730-a073531132e3`, without changing business configuration. “Keep the design, but change BIAB to $70” updated the existing service draft at revision 5 while retaining that source identity and unrelated settings. Exact owner approval published revision 6. An anonymous customer selected the generated bound BIAB button and completed the original service/availability/confirmation flow. One browser POST returned HTTP 201 and saved CAD70/75 minutes with eligible synthetic staff.

Six actual provider calls across the four chat requests used a Standard-rate usage estimate of USD0.134269. The first design request accounted for USD0.060288; the phone revision USD0.072387; typed intake USD0.000834; the price edit USD0.000760. The first Sol source call took 108.706 seconds. The recording explicitly shortens waits and does not promise that speed. Provider raw outputs, source revisions and hashes remain privately retained; no automatic model repair was required in this case.

## Public entry and authentication boundary

Browser testing found that the former `(auth)` route eagerly initiated Clerk's Development handshake even when a visitor only wanted to watch the introduction. The route now lives at `src/app/[locale]/ai-website/page.tsx`, preserving its URL. Anonymous visitors without an account query or Clerk session render the public introduction without calling `auth()` or mounting Clerk.

Selecting sign-in/sign-up, or returning with a bare or instance-suffixed Clerk session cookie, still establishes Clerk middleware context and validates identity through the SDK. Cookie presence itself grants no permission. The original shared Clerk layout body was extracted unchanged into `OwnerClerkProvider`; the existing auth layout re-exports it. Owner/admin/preview/API authorization is unchanged. Account links jump to `#account` so the user does not need to scroll past the introduction again to find the selected form.

The duplicate four-card explanation was removed; the recording and optional transcript cover those steps. The concise credit explanation, More → Luster AI return path, CAD10/20/50 choices, manual fallback, request limit and saved-draft behavior remain. The recording has native controls, inline playback, no autoplay, `preload=none`, English captions, an always-available written walkthrough and a real generated-site poster. VP9 WebM and H.264 MP4 sources cover browsers with different decoder support. No custom video-player framework was added.

## Recording provenance and checks

`artifacts/ai-credits/builder-walkthrough/video-edit.json` records every source recording/screenshot hash, exact trim, speed, framing and output hash. The final recording is about one minute. Original browser footage is cropped to remove Development indicators and some margin; waits are cut or accelerated. The actual review/publication screenshots and final receipt are held for readability. These are normal edits to real captures, not recreated screens or edits to generated source. All synthetic record inputs are owned original test content; the supplied Dynasty/other-salon photographs are absent.

The public files are in `public/assets/videos/`. Browser playback proofs are in `artifacts/ai-credits/builder-walkthrough/playback.json`; real AI/bookkeeping evidence is in `owner-evidence.json`. Original captures are retained under `/tmp/luster-ai-walkthrough-owner-evidence-20261018/`, restricted to the local user. Keys, auth cookies and private provider outputs are not embedded in the recording or committed evidence.

Validation completed for this checkpoint:

- 53 focused entry, middleware and existing owner-auth component tests passed. Anonymous introduction, account queries, cookie-backed context, existing private owner/preview behavior and feature-disabled access are covered separately.
- Current source TypeScript, scoped ESLint and whitespace checks passed. A stale generated type stub for the moved route was removed. A raw `next typegen` invocation correctly failed the explicit-environment guard; the subsequent source check passed. The fresh optimized build uses the existing sanitized/attested harness instead of inheriting secret-bearing local files.
- Desktop Chromium and phone-width WebKit decoded the video and loaded captions/transcript with no horizontal overflow and zero Clerk service requests on the public introduction. Installed Chrome also decoded the MP4 after an injected WebM network failure. Final asset hashes are attached to the playback proof.
- Saved Canva review reopened through **Make more changes**, then passed its reference landmarks, contacts and service bindings in WebKit at revision 7 without an AI call. The earlier attempt to open its already-published screen as though it were still a draft failed only at the harness's missing preview-link assumption. This is saved-state/cross-engine evidence, not real Clerk cross-device authentication.

Remote CI, hosted resource isolation/Preview, real Clerk account/cross-device testing, Stripe sandbox checkout/webhook acceptance, remaining reference/photo/PDF quality cases and protected-main production release remain open. The installed Clerk CLI is linked to Luster but its session is expired; the owner has been asked to run `clerk auth login`. No CLI upgrade was made. Account testing will use the official [Clerk Playwright testing flow](https://clerk.com/docs/guides/development/testing/playwright/overview) and reserved test identities, with Development credentials only. Stripe test-key configuration remains deferred at the owner's request.

The shared AI trial ceiling remains CAD80. The separate local allocation was not increased or reset. This checkpoint does not declare the whole paid builder complete or deployed.
