# Uploaded reference generation checkpoint — 2026-10-15

The supplied 137×1280 screenshot was uploaded through the hosted owner interface,
selected with authorized salon photographs, and sent to the configured OpenAI
`gpt-6-astra` generator. No generated source was manually authored or repaired.

First saved artifact: `cd8f0fb5-0f73-426d-aaa7-7ea2c92efd50`, draft revision10.
Owner request time:112.162seconds. First output passed validation.
Provider usage:4654input/8585output tokens, USD0.487418 estimated.
Exact original output remains in private evidence; usage.json records its hash.

The first output preserves the grey canvas, pink bubble hierarchy, torn black/white
poster structure, tilted nail photographs, contact/hours cards, original bear
illustration and service section. It replaces the reference business's content
with the synthetic salon and owned photos. Mobile has no horizontal overflow but
needs more compact hours/hero and a decorative flower text collision corrected.
This is not a pixel-exact recreation; the low-resolution input limits detail.
Files19/20 retain the upload, request, and first desktop/mobile result.

Found and corrected upload handoff problems:
- Explicit saved-image feedback and Create my website action beside the brief.
- Uploaded reference selections now reach both main-chat generation paths.
- Unused uploads are visibly selected after refresh, including another device.
- Missing essential business details have an actionable owner-facing explanation.
- Server checks reference ownership before any model call.

Validation:34 UI/integration tests plus38 API/renderer/payload/security tests passed.
Five PostgreSQL concurrency cases were skipped without the dedicated test database;
they are not counted as passed. TypeScript and scoped ESLint passed.
Real hosted refinement, exact publication and another original-flow booking are
pending at this checkpoint. Existing published revision8 and appointments remain
unchanged while revision10 is private.

## Hosted refinement timeout and correction

The main-chat refinement correctly sent all three selected image identities but
hit the provider's120-second timeout after121.888seconds at the owner interface.
No new source or revision was saved; revision10 remains intact. Unknown provider
usage stays conservatively charged at the reserved maximum in the shared ledger.
The failed request screenshot is21-klaws-chat-input.png.

The application now permits up to180seconds per custom-source call within a
270-second overall deadline. Business conversation and generation share that
deadline. Token counting consumes the same allowance; any automatic repair gets
only the remaining time, and no additional paid call starts with under30seconds
remaining. One repair maximum and the existing spending cap are unchanged.
New deterministic tests cover deadline reduction and refusing an unaffordable
(in time) repair.48 focused tests and TypeScript passed; scoped lint passed.
A real-provider retry on this version is still pending.


## Completed hosted result

Direct test website: https://luster-ai-builder-test.vercel.app/ai-test-1270644eedefa092/book/service

Application commit `ae128fae8b484dc22890f3db129fa34d4027b071`, Preview deployment
`dpl_4bHBLktFSj3reJQh1xWwb8sigeEq`. Upload handoff fix is `f6331ce6`.
The alias is still the isolated test application. No production merge, deployment,
migration or live salon changes occurred.

The same owner chat request succeeded after the timeout fix in145.331seconds:
- Model: OpenAI `gpt-6-astra`;12748input/9951output tokens;USD0.510325 known cost.
- New artifact:`f453c89a-9e0f-46bf-a6ce-dce1140f2605`, parent is the first result.
- Draft revision11; first result passed validation without repair or source edits.
- All three selected images reached chat generation. Refresh preserved the result.
- Business, hours, services/prices/durations and booking rules matched before/after.

Visual assessment: the new mobile masthead is shorter, hours are grouped into
Tue–Sat10am–6pm/Mon+Sunclosed from current business data, and the flower no longer
collides with text. The grey backdrop, black/white torn poster panels, pink bubble
hierarchy, tilted photo collage and pink booking banner remain. Desktop1280px and
mobile390px showed no horizontal overflow. Public mobile was checked without a
Luster owner session. The rendered bear is an original flat illustration rather
than the reference's dimensional graphic. Authorized photographs, synthetic salon
branding and two real configured services replace the other business's content.
This is a composition match, not a pixel-exact reproduction of a137px-wide image.

Exact review showed only a custom website version change. Publication receipt:
`175fd51e-d7b4-4a90-86e0-2f526b7144a6`, revision11. A new customer browser selected
the canonical BIAB service from the generated card, continued through original
service/staff/time/confirmation pages and received HTTP201 plus visible appointment
confirmation. The persisted appointment is CAD65/75minutes with the eligible
technician; both earlier appointments and both service identities were preserved.
See reference-booking-evidence.json. No customer SMS, email or payment was sent.

Evidence:21b files show the actual chat/input and refined previews,23 exact review,
24 publication,25–28 public website/original booking/customer confirmation. The
reference-comparison.html gallery places the original beside generated previews.
The app generated both saved versions; no hand-authored source replaced either.
One browser harness retry was needed because it enumerated checkboxes before assets
loaded; it made no provider call. Some iframe element captures were clipped by
Playwright; final public viewport screenshots avoid that capture issue.

Cumulative17 provider attempts:10 earlier local plus7 hosted, including one timed
out call. Known provider usage totalsUSD5.316379. Conservative cap accounting is
CAD12.523330, includingCAD1.890572 reserved for the failed call with unknown usage.
The initialCAD40 cap is unchanged; remaining maximum allowance is aboutCAD27.48.
This is usage-based accounting plus a reserve, not a final provider invoice.

48 focused tests passed after the deadline change; prior26 renderer/payload/security
tests also passed. TypeScript and scoped lint passed. On the application commit,
both CI builds and all Vitest shards passed. Some broader browser checks were still
running and two PostgreSQL jobs failed; no all-CI-green or merge claim is made.
The earlier f633 entitlement job failed before testing due to the public ECR image
quota. PR455 remains a draft. Full builder release gaps listed in README remain.
