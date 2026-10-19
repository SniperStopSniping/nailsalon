# AI builder: optimized HTTPS acceptance

This checkpoint tests application commit `7d3dbf20` using a clean Git archive,
an isolated loopback database, synthetic accounts, and the previously saved
real-model Merlot website. It makes no additional model call. It does not
demonstrate a new AI generation, real Clerk signup, or a Stripe purchase.

## Owner-facing improvement

A failed network request now explains that the connection dropped and directs
the owner to reload saved changes. An unsent message is preserved. Intentional
abort/cancellation and structured server errors keep their existing behavior.
Publication still reconciles a lost successful response by reading its exact
saved revision, rather than approving or publishing again.

The focused owner-interface suite passed 32 cases, including this error,
unsent-message retention, interrupted AI polling, and lost-publication-response
recovery. The native workflow/harness suite passed 32 cases with zero skips.
Scoped lint and TypeScript checking passed. These are local results, not remote
CI acceptance.

## Browser and renderer boundary

The builder uses `https://luster-builder.test:3443`; the credential-free renderer
uses `https://luster-render.test:3444`. Both listeners bind only to loopback.
A separate local CONNECT proxy accepts only these two exact HTTPS authorities.
It cannot forward database ports or arbitrary hosts. Browser requests retain
native cookie handling, TLS origins and content-security-policy enforcement.
Only the synthetic certificate is accepted in test browser contexts. No hosts
file, system certificate trust, browser web-security setting, dependency,
production credential, or hosted configuration is changed.

An earlier URL-replaying test adapter dropped WebKit's owner cookie and correctly
received 404. That failure is retained. Replacing the adapter with the bounded
CONNECT proxy allowed the actual authenticated owner screen to load. No
application authorization gate was changed to make this pass.

The app runs with AI, credit purchases, and external communications disabled.
Manual editing, review, exact approval, publication, and ordinary customer
booking use the existing application and database implementation.

## Completed browser journey

[Machine-readable results and retained failed attempts](../../artifacts/ai-credits/optimized-https/evidence.json)
separate the build, browser, server/database, and provider boundaries.

1. Owner editing reopened current published settings at revision 12. In WebKit,
   a deliberately interrupted Review request displayed the new connection copy,
   retained the unsent message, and recovered the same saved revision through
   **Reload saved changes**. Desktop and phone-width screenshots were captured.
2. Through the manual service controls, BIAB changed from CAD75 to CAD65 in
   draft revision 13. Its real private preview showed the proposed CAD65 and
   75-minute duration; live rows remained CAD75. An independent anonymous
   WebKit page still displayed CAD75. The custom source artifact remained
   `fba0a6d4-d886-40b7-b6f7-034defb65334` throughout the price change.
3. WebKit displayed exact review and approved revision 13. The harness awaited
   the real successful publish commit, then deliberately dropped its response.
   The app recovered through its saved-state read and retained the published
   result after refresh. There is exactly one revision-13 receipt; earlier
   receipts for revisions 7 and 11 remain intact.
4. An anonymous phone-width WebKit browser selected the generated site's real
   BIAB service, then used the original service step, artist assignment,
   calendar, customer form and confirmation control. HTTP201 created exactly
   one new appointment, `appt_a05f511e-9fc9-4cb2-b970-d67cfb3b97f5`, at
   **6500 cents / 75 minutes**. The test also submitted one separate deliberate
   negative API probe, which returned **400 / INVALID_SELECTION** for a
   `setup_preview_…` service identity. Thus the raw request count is two,
   comprising one actual UI booking and one rejected probe.
5. Full-row fingerprints prove the earlier CAD65 and CAD75 appointments were
   unchanged. The original staff/service assignment was enforced. The four
   earlier real-provider calls remain the same four calls; this checkpoint
   incurred **zero additional model usage**.

The private desktop/mobile renderer also proved a secure context, blocked
parent-cookie and frame-storage access, and a real browser `connect-src` CSP
violation when attempting a foreign fetch. Virtual preview service identities,
proposed prices/durations, horizontal overflow, keyboard menu operation and
reduced-motion behavior were checked. This is saved-site acceptance, not a new
generation or a claim of visual fidelity to another reference.

| Evidence | View |
| --- | --- |
| Connection recovery | [Phone error](../../artifacts/ai-credits/optimized-https/connection-error-mobile.png), [Recovered draft](../../artifacts/ai-credits/optimized-https/connection-recovered.png) |
| Actual saved AI website | [Desktop](../../artifacts/ai-credits/optimized-https/draft-desktop.png), [Phone](../../artifacts/ai-credits/optimized-https/draft-mobile.png) |
| Draft/live separation | [Private CAD65](../../artifacts/ai-credits/optimized-https/draft-service-price.png), [Unchanged public CAD75](../../artifacts/ai-credits/optimized-https/unchanged-public-price.png) |
| Exact approval and retry recovery | [Review](../../artifacts/ai-credits/optimized-https/exact-review.png), [Recovered publication](../../artifacts/ai-credits/optimized-https/recovered-publication.png) |
| Original booking result | [Completed booking](../../artifacts/ai-credits/optimized-https/original-booking-completed.png) |

Several harness attempts failed and remain recorded. Besides the WebKit cookie
issue, an early route handler bypassed the original network mapper; later API
probes used an IP address that the new proxy correctly refused. Two error-copy
assertions used ambiguous text/alert locators even though the screenshot showed
the correct error. Their corrected runs exercised actual recovery before being
counted as passed. One real CAD75 booking completed before its separate negative
probe failed; it was preserved rather than treated as absent or retried blindly.
No generated source was repaired to make these checks pass. The earlier manual
wording-edit and history-restore tests were explicitly manual owner actions.

## Optimized credential check

The complete optimized build passed on Node22.23.2. The scanner actually checked
**4,505 tracked files and 596 optimized generated files**. A separate scan of
**614 public static/HTML/RSC files**, totaling 8,485,056 bytes, found zero
server-canary matches. This does not substitute for hosted Node24 acceptance.

The build helper now runs this verification automatically after a successful
build. It scans the archived commit's file list using a separate private Git
index, preserving the active worktree's index even after the branch advances.
It resolves macOS's `/tmp` symlink before invoking the scanner and requires a
real scanner report; an empty successful process exit is rejected. An initial
silent scanner invocation was detected and retained privately, then replaced
with an executed scan. It was not accepted as passing evidence.

This optimized run uses the saved generated SVG composition and canonical data.
Its older development-local inspiration thumbnail cannot be served under the
Production media-storage guard without a supported isolated storage adapter.
That guard was preserved. These results do not verify optimized photo/PDF/Canva
storage or image fidelity; those remain explicitly outstanding.

## Reproducing the isolated check

Use existing installed dependencies and the already-attested disposable local
database. Do not substitute a hosted or production database. The build helper
requires committed application source and archives the exact current commit.

```sh
LUSTER_ISOLATED_HTTPS_CHECK=true node scripts/ai-https-check.mjs build
LUSTER_ISOLATED_HTTPS_CHECK=true node scripts/ai-https-check.mjs verify /tmp/luster-ai-https-check-<returned-id>
LUSTER_ISOLATED_HTTPS_CHECK=true node scripts/ai-https-check.mjs serve /tmp/luster-ai-https-check-<returned-id>
```

Use the private synthetic fixture with `LUSTER_REAL_AI_TRIAL=true` and
`LUSTER_REAL_AI_HTTPS=true`. The existing owner-UI runner supports saved preview,
manual changes, history restoration, publication, connection recovery, and
original booking. HTTPS mode refuses new paid generation commands. Keep fixture
sessions, certificates, server canaries and uncurated recordings private.

## Release boundaries

No push, deployment, production migration, live-salon write, real payment,
outbound message, or new billable model call is included in this checkpoint.
The matching Clerk Development pair and deferred Stripe sandbox key are still
needed for their real-provider acceptance journeys. Owned Canva/PDF/photo/style
acceptance, the introductory recording, hosted isolation and renderer update,
remote CI/review and protected-main production release remain separate work.
